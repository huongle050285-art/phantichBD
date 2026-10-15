import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFinishedMatchesCached, isFootballDataConfigured } from './services/footballData.js';
import { predictMatch } from './ml/predict.js';
import { buildMatchStatsPanel } from './ml/matchAnalysis.js';
import { buildConsensus } from './ml/consensus.js';
import { recordPrediction, resolvePendingPredictions, getLog, getLogFilePath } from './ml/predictionLog.js';
import { getOrLockSnapshot, getAllSnapshots, getSnapshotFilePath } from './ml/frameSnapshots.js';
import { isFirestoreEnabled } from './firestoreDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lưới an toàn: 1 lỗi kết nối cấp thấp bất ngờ (vd socket Firestore bị ngắt
// giữa đường) KHÔNG được làm sập cả server — chỉ log lại rồi tiếp tục chạy.
// (Đã gặp thực tế khi test: lỗi mạng tới Firestore có thể thoát ra ngoài
// dạng "uncaughtException"/"unhandledRejection" thay vì bị try/catch bắt
// bình thường — xem ghi chú trong src/firestoreDb.js.)
process.on('unhandledRejection', (err) => {
  console.error('[Lỗi không bắt được - unhandledRejection] Server vẫn tiếp tục chạy:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[Lỗi không bắt được - uncaughtException] Server vẫn tiếp tục chạy:', err?.message || err);
});

const API_KEY = process.env.API_FOOTBALL_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY;
const PORT = process.env.PORT || 3000;
const LEAGUE_ID = process.env.LEAGUE_ID || 39; // 39 = Premier League
const DEFAULT_SEASON = process.env.SEASON || 2024;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000); // 15 phút
const MAX_ODDS_PAGES = Number(process.env.MAX_ODDS_PAGES || 5);
const BASE_URL = 'https://v3.football.api-sports.io';
// The Odds API — dùng cho chế độ "Trận sắp diễn ra" vì có dữ liệu MÙA HIỆN TẠI
// trên gói free (khác API-Football, gói free chỉ cho phép mùa 2022-2024).
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ODDS_API_SPORT = 'soccer_epl';

if (!API_KEY || API_KEY === 'dan_key_cua_ban_o_day') {
  console.error(
    '[Lỗi cấu hình] Chưa thấy API_FOOTBALL_KEY hợp lệ trong .env.\n' +
      '  1. Copy .env.example thành .env\n' +
      '  2. Dán API key miễn phí (lấy tại https://dashboard.api-football.com) vào API_FOOTBALL_KEY'
  );
  process.exit(1);
}

if (!ODDS_API_KEY || ODDS_API_KEY === 'dan_key_cua_ban_o_day') {
  console.warn(
    '[Cảnh báo cấu hình] Chưa thấy ODDS_API_KEY trong .env — chế độ "Trận sắp diễn ra" sẽ không hoạt động.\n' +
      '  Lấy key miễn phí tại https://the-odds-api.com rồi dán vào ODDS_API_KEY trong .env.\n' +
      '  (Chế độ "Theo mùa giải" vẫn chạy bình thường vì chỉ cần API_FOOTBALL_KEY.)'
  );
}

if (!FOOTBALL_DATA_KEY || FOOTBALL_DATA_KEY === 'dan_key_cua_ban_o_day') {
  console.warn(
    '[Cảnh báo cấu hình] Chưa thấy FOOTBALL_DATA_KEY trong .env — khối "Dự đoán ML" sẽ hiển thị "chưa đủ dữ liệu".\n' +
      '  Lấy key miễn phí tại https://www.football-data.org/client/register rồi dán vào FOOTBALL_DATA_KEY trong .env.\n' +
      '  (Các tính năng khác vẫn chạy bình thường mà không cần key này.)'
  );
}

// --- Cache RAM đơn giản, có TTL, để không gọi API-Football liên tục mỗi khi ---
// --- có người mở trang web (gói free chỉ 100 request/ngày). ---
const cache = new Map(); // key -> { data, expiresAt }

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function callApiFootball(pathName, params = {}) {
  const url = new URL(BASE_URL + pathName);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if (!res.ok) {
    throw new Error(`API-Football HTTP ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    console.warn(`[API-Football] cảnh báo ${pathName}:`, JSON.stringify(json.errors));
  }
  return json;
}

async function getFixturesCached(season) {
  const key = `fixtures:${season}`;
  const cached = getCached(key);
  if (cached) return cached;

  const json = await callApiFootball('/fixtures', { league: LEAGUE_ID, season });
  setCached(key, json.response);
  return json.response;
}

async function getOddsCached(season) {
  const key = `odds:${season}`;
  const cached = getCached(key);
  if (cached) return cached;

  let page = 1;
  let all = [];
  while (page <= MAX_ODDS_PAGES) {
    const json = await callApiFootball('/odds', { league: LEAGUE_ID, season, page });
    all = all.concat(json.response || []);
    if (!json.paging || json.paging.current >= json.paging.total) break;
    page += 1;
  }
  setCached(key, all);
  return all;
}

// ---- The Odds API (chế độ "Trận sắp diễn ra") ----
// LƯU Ý: API-Football free chỉ cho phép mùa 2022-2024 (đã xác nhận qua lỗi
// "Free plans do not have access to this season/Next parameter"), nên KHÔNG
// dùng được để lấy trận mùa hiện tại. The Odds API free có dữ liệu hiện tại.

// Chuyển tỉ lệ kèo decimal (vd 2.10) thành % xác suất, đã chuẩn hoá bỏ biên lợi
// nhuận nhà cái (overround) — đây là cách tính "implied probability" chuẩn.
function oddsToImpliedProbability({ home, draw, away }) {
  const rawHome = 1 / home;
  const rawDraw = 1 / draw;
  const rawAway = 1 / away;
  const sum = rawHome + rawDraw + rawAway; // > 1 vì có biên lợi nhuận nhà cái
  return {
    home: Math.round((rawHome / sum) * 100),
    draw: Math.round((rawDraw / sum) * 100),
    away: Math.round((rawAway / sum) * 100),
  };
}

async function callOddsApi(pathName, params = {}) {
  const url = new URL(ODDS_API_BASE + pathName);
  url.searchParams.set('apiKey', ODDS_API_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url);
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining !== null) {
    console.log(`[The Odds API] còn lại ${remaining} request trong tháng`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`The Odds API HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// "Dự đoán BD" — KHÔNG phải mô hình máy học huấn luyện trên dữ liệu lịch sử,
// mà là bộ quy tắc thống kê kết hợp 3 loại kèo (1X2 + châu Á + tài xỉu) thành
// 1 nhận định + tỉ số gợi ý dễ đọc. Nói rõ điều này trong UI để không gây hiểu
// lầm đây là "AI" theo nghĩa mô hình huấn luyện.
function fmtPoint(p) {
  const n = Number(p);
  return n > 0 ? `+${n}` : `${n}`;
}

function buildAnalysis({ homeTeam, awayTeam, prediction, asianHandicap, totals }) {
  if (!asianHandicap && !prediction && !totals) return null;

  const notes = [];
  let favoriteTeam = null;
  let marginGoals = null;

  if (asianHandicap) {
    const homePoint = Number(asianHandicap.homePoint);
    marginGoals = Math.abs(homePoint);
    favoriteTeam = homePoint < 0 ? homeTeam : homePoint > 0 ? awayTeam : null;
    if (favoriteTeam) {
      const underdog = favoriteTeam === homeTeam ? awayTeam : homeTeam;
      notes.push(
        `Kèo châu Á (chấp ${fmtPoint(homePoint)} cho ${homeTeam}) cho thấy ${favoriteTeam} được đánh giá nhỉnh hơn ${underdog} khoảng ${marginGoals} bàn.`
      );
    } else {
      notes.push('Kèo châu Á ở mức 0 (kèo hòa) — 2 đội được đánh giá ngang sức.');
    }
  } else if (prediction) {
    favoriteTeam = prediction.home >= prediction.away ? homeTeam : awayTeam;
  }

  if (totals) {
    const leanText = totals.leanOver ? 'nghiêng Tài (Over)' : 'nghiêng Xỉu (Under)';
    notes.push(`Kèo tài xỉu ở mức ${totals.point} bàn, thị trường ${leanText} (${totals.overProb}% Tài / ${totals.underProb}% Xỉu).`);
  }

  let suggestedScore = null;
  if (favoriteTeam && marginGoals !== null && totals) {
    const total = Math.max(1, Math.round(totals.point));
    const margin = Math.min(Math.round(marginGoals), total); // không để hiệu số > tổng bàn
    const favGoals = Math.round((total + margin) / 2);
    const dogGoals = Math.max(0, total - favGoals);
    suggestedScore =
      favoriteTeam === homeTeam ? { home: favGoals, away: dogGoals } : { home: dogGoals, away: favGoals };
    // Không push câu "tỉ số gợi ý" vào notes — frontend hiển thị suggestedScore
    // riêng thành 1 badge nổi bật, tránh lặp lại thông tin.
  }

  if (notes.length === 0) return null;

  return {
    favoriteTeam,
    marginGoals,
    suggestedScore,
    notes, // mảng các câu nhận định riêng biệt, để frontend tự trình bày
  };
}

async function getUpcomingMatchesCached() {
  const key = 'upcoming-matches';
  const cached = getCached(key);
  if (cached) return cached;

  if (!ODDS_API_KEY || ODDS_API_KEY === 'dan_key_cua_ban_o_day') {
    throw new Error(
      'Chưa cấu hình ODDS_API_KEY trong .env. Lấy key miễn phí tại https://the-odds-api.com'
    );
  }

  // markets: h2h = kèo 1X2 (Chủ/Hòa/Khách), spreads = kèo châu Á (handicap),
  // totals = kèo tài xỉu (Over/Under tổng số bàn thắng).
  // "spreads" của The Odds API cho bóng đá chính là kèo châu Á: mỗi đội có 1
  // "point" (mức chấp, vd -1.5 / +1.5) và 1 tỉ lệ (price) đi kèm.
  const events = await callOddsApi(`/sports/${ODDS_API_SPORT}/odds/`, {
    regions: 'eu',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
  });

  // Tìm bookmaker ĐẦU TIÊN có market mong muốn — không phải bookmaker nào cũng
  // có đủ cả 3 loại kèo, nên dò riêng cho từng loại market thay vì chỉ lấy bookmaker[0].
  function findMarket(bookmakers, marketKey) {
    for (const bm of bookmakers || []) {
      const market = bm.markets?.find((m) => m.key === marketKey);
      if (market) return { bookmaker: bm, market };
    }
    return null;
  }

  // Dữ liệu trận đấu mùa hiện tại (kết quả thật) để tính phong độ + đối đầu
  // cho khối "Dự đoán ML" và khung "Phân tích phong độ & đối đầu" — tải 1 LẦN
  // cho cả danh sách, không phải mỗi trận. Nếu football-data.org chưa cấu hình
  // hoặc lỗi, các khối liên quan của MỌI trận sẽ trả về available:false kèm lý
  // do, không làm hỏng phần còn lại của trang.
  let currentSeasonMatches = null;
  let currentSeasonMatchesError = null;
  if (isFootballDataConfigured()) {
    try {
      currentSeasonMatches = await getFinishedMatchesCached();
    } catch (err) {
      currentSeasonMatchesError = err.message;
      console.warn('[football-data.org] cảnh báo:', err.message);
    }
  } else {
    currentSeasonMatchesError = 'Chưa cấu hình FOOTBALL_DATA_KEY trong .env.';
  }

  // Đối chiếu các dự đoán đã ghi trước đó ("Bảng sao kê") với kết quả thật —
  // chạy ngay khi có currentSeasonMatches mới, không cần lịch chạy riêng.
  if (currentSeasonMatches) {
    await resolvePendingPredictions(currentSeasonMatches);
  }

  // Tính TOÀN BỘ nội dung hiển thị (kèo + 4 khối dự đoán) cho 1 trận tại thời
  // điểm gọi hàm — dùng để "chốt" (xem frameSnapshots.js) chứ KHÔNG gọi thêm
  // API nào (tái dùng đúng `events`/`currentSeasonMatches` đã tải sẵn cho cả
  // danh sách, phía trên).
  function computeFramePayload(ev) {
    let odds = null;
    let prediction = null;
    let asianHandicap = null;
    let totals = null;

    const h2h = findMarket(ev.bookmakers, 'h2h');
    if (h2h) {
      const homeOdd = h2h.market.outcomes.find((o) => o.name === ev.home_team)?.price;
      const awayOdd = h2h.market.outcomes.find((o) => o.name === ev.away_team)?.price;
      const drawOdd = h2h.market.outcomes.find((o) => o.name === 'Draw')?.price;
      if (homeOdd && awayOdd && drawOdd) {
        odds = { bookmaker: h2h.bookmaker.title, home: homeOdd, draw: drawOdd, away: awayOdd };
        prediction = oddsToImpliedProbability({ home: homeOdd, draw: drawOdd, away: awayOdd });
      }
    }

    const spreads = findMarket(ev.bookmakers, 'spreads');
    if (spreads) {
      const homeSide = spreads.market.outcomes.find((o) => o.name === ev.home_team);
      const awaySide = spreads.market.outcomes.find((o) => o.name === ev.away_team);
      if (homeSide && awaySide) {
        asianHandicap = {
          bookmaker: spreads.bookmaker.title,
          homePoint: homeSide.point,
          homeOdd: homeSide.price,
          awayPoint: awaySide.point,
          awayOdd: awaySide.price,
        };
      }
    }

    const totalsMarket = findMarket(ev.bookmakers, 'totals');
    if (totalsMarket) {
      const overSide = totalsMarket.market.outcomes.find((o) => o.name === 'Over');
      const underSide = totalsMarket.market.outcomes.find((o) => o.name === 'Under');
      if (overSide && underSide) {
        const rawOver = 1 / overSide.price;
        const rawUnder = 1 / underSide.price;
        const sum = rawOver + rawUnder;
        totals = {
          bookmaker: totalsMarket.bookmaker.title,
          point: overSide.point,
          overOdd: overSide.price,
          underOdd: underSide.price,
          overProb: Math.round((rawOver / sum) * 100),
          underProb: Math.round((rawUnder / sum) * 100),
          leanOver: rawOver > rawUnder,
        };
      }
    }

    const analysis = buildAnalysis({ homeTeam: ev.home_team, awayTeam: ev.away_team, prediction, asianHandicap, totals });

    const matchTime = new Date(ev.commence_time).getTime();

    const mlPrediction = currentSeasonMatches
      ? predictMatch({
          matches: currentSeasonMatches,
          homeTeamRaw: ev.home_team,
          awayTeamRaw: ev.away_team,
          matchTime,
        })
      : { available: false, reason: currentSeasonMatchesError || 'Chưa có dữ liệu mùa hiện tại.' };

    const statsPanel = currentSeasonMatches
      ? buildMatchStatsPanel({
          matches: currentSeasonMatches,
          homeTeamRaw: ev.home_team,
          awayTeamRaw: ev.away_team,
          matchTime,
          asianHandicap,
        })
      : { available: false, reason: currentSeasonMatchesError || 'Chưa có dữ liệu mùa hiện tại.' };

    // "Đồng thuận" — gộp mlPrediction + statsPanel (vừa tính ở trên) thành 1
    // chỉ số duy nhất, không gọi lại API hay tính toán lại gì nặng.
    const consensus = buildConsensus({
      mlPrediction,
      statsPanel,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
    });

    return {
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
      commenceTime: ev.commence_time,
      odds,
      asianHandicap,
      totals,
      prediction,
      analysis,
      mlPrediction,
      statsPanel,
      consensus,
    };
  }

  const matches = await Promise.all(
    (events || []).map(async (ev) => {
      const matchTime = new Date(ev.commence_time).getTime();
      // The Odds API tự loại các trận đã đấu xong khỏi danh sách — nên hễ trận
      // còn xuất hiện ở đây mà đã quá giờ bóng lăn thì chắc chắn đang live.
      const isLive = matchTime <= Date.now();

      // "full" — chốt ngay lần đầu trận xuất hiện, không đổi về sau dù kèo/phong
      // độ có cập nhật tiếp. "live" — chốt thêm 1 lần nữa, riêng, ngay lần đầu
      // phát hiện trận đã live (giữ nguyên bản "full" gốc, không đụng tới).
      const fullFrame = await getOrLockSnapshot(ev.id, 'full', () => computeFramePayload(ev));
      const liveFrame = isLive ? await getOrLockSnapshot(ev.id, 'live', () => computeFramePayload(ev)) : null;

      // Ghi vào "Bảng sao kê" dựa trên khung "full" (không đổi theo thời gian,
      // đúng với tinh thần ledger) — recordPrediction tự bỏ qua nếu đã ghi rồi.
      if (fullFrame.statsPanel?.available && fullFrame.statsPanel?.verdict) {
        await recordPrediction({
          id: ev.id,
          homeTeam: fullFrame.homeTeam,
          awayTeam: fullFrame.awayTeam,
          commenceTime: fullFrame.commenceTime,
          verdict: fullFrame.statsPanel.verdict,
          topScorelines: fullFrame.statsPanel.topScorelines,
          consensus: fullFrame.consensus,
        });
      }

      return {
        id: ev.id,
        commenceTime: ev.commence_time,
        homeTeam: ev.home_team,
        awayTeam: ev.away_team,
        isLive,
        frames: {
          full: fullFrame,
          live: liveFrame,
        },
      };
    })
  );

  setCached(key, matches);
  return matches;
}

async function getPredictionCached(fixtureId) {
  const key = `prediction:${fixtureId}`;
  const cached = getCached(key);
  if (cached) return cached;

  const json = await callApiFootball('/predictions', { fixture: fixtureId });
  const result = json.response?.[0] || null;
  setCached(key, result);
  return result;
}

const app = express();

app.get('/api/health', (req, res) => {
  res.json({ ok: true, league: Number(LEAGUE_ID), defaultSeason: Number(DEFAULT_SEASON) });
});

app.get('/api/fixtures', async (req, res) => {
  const season = req.query.season || DEFAULT_SEASON;
  try {
    const fixtures = await getFixturesCached(season);
    res.json({ season: Number(season), count: fixtures.length, fixtures });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/odds', async (req, res) => {
  const season = req.query.season || DEFAULT_SEASON;
  try {
    const odds = await getOddsCached(season);
    res.json({ season: Number(season), count: odds.length, odds });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Danh sách trận sắp diễn ra + kèo + "dự đoán" (implied probability từ kèo),
// lấy từ The Odds API — nguồn duy nhất có dữ liệu mùa giải hiện tại trên gói free.
app.get('/api/upcoming', async (req, res) => {
  try {
    const matches = await getUpcomingMatchesCached();
    res.json({ count: matches.length, matches });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// "Bảng sao kê dự đoán" — toàn bộ lịch sử chốt kèo + 3 tỉ số đã dự đoán, kèm
// trạng thái trúng/trật (nếu trận đã có kết quả). Xem src/ml/predictionLog.js.
app.get('/api/predictions-log', async (req, res) => {
  try {
    res.json({ entries: await getLog() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tải dữ liệu "Bảng sao kê" về máy. Nếu ĐÃ cấu hình Firebase Firestore, dữ
// liệu đã bền vững sẵn (không cần backup tay) — nút này vẫn giữ lại để tải
// 1 bản JSON xem/lưu ngoài khi cần. Nếu CHƯA cấu hình Firestore, file
// data/predictions-log.json nằm trên ổ đĩa tạm của Render free, cần tự bấm
// tải định kỳ rồi kéo lên GitHub cùng đợt code mới nếu muốn giữ lịch sử cũ.
app.get('/api/predictions-log/download', async (req, res) => {
  try {
    if (isFirestoreEnabled()) {
      const entries = await getLog();
      if (!entries.length) {
        res.status(404).json({ error: 'Chưa có dữ liệu sao kê nào được ghi lại.' });
        return;
      }
      res.setHeader('Content-Disposition', 'attachment; filename="predictions-log.json"');
      res.json(entries);
      return;
    }

    const filePath = getLogFilePath();
    res.download(filePath, 'predictions-log.json', (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Chưa có dữ liệu sao kê nào được ghi lại.' });
      }
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Tải dữ liệu "Chốt kèo theo khung" về máy — cùng cơ chế với
// /api/predictions-log/download phía trên (Firestore nếu đã cấu hình, hoặc
// file data/frame-snapshots.json nếu chưa).
app.get('/api/frame-snapshots/download', async (req, res) => {
  try {
    if (isFirestoreEnabled()) {
      const all = await getAllSnapshots();
      if (!Object.keys(all).length) {
        res.status(404).json({ error: 'Chưa có khung nào được chốt.' });
        return;
      }
      res.setHeader('Content-Disposition', 'attachment; filename="frame-snapshots.json"');
      res.json(all);
      return;
    }

    const filePath = getSnapshotFilePath();
    res.download(filePath, 'frame-snapshots.json', (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Chưa có khung nào được chốt.' });
      }
    });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Lấy dự đoán cho 1 trận: /api/predictions/12345
app.get('/api/predictions/:fixtureId', async (req, res) => {
  const { fixtureId } = req.params;
  try {
    const prediction = await getPredictionCached(fixtureId);
    res.json({ fixtureId: Number(fixtureId), prediction });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Lấy dự đoán cho nhiều trận cùng lúc (giới hạn 10 trận/lần để tiết kiệm quota)
app.post('/api/predictions/bulk', express.json(), async (req, res) => {
  const fixtureIds = Array.isArray(req.body?.fixtureIds) ? req.body.fixtureIds.slice(0, 10) : [];
  try {
    const results = {};
    for (const id of fixtureIds) {
      results[id] = await getPredictionCached(id);
    }
    res.json({ predictions: results });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`\nServer đang chạy tại http://localhost:${PORT}`);
  console.log(`Mùa giải mặc định: ${DEFAULT_SEASON} | Cache TTL: ${CACHE_TTL_MS / 1000}s\n`);
});
