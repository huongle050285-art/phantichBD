import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_KEY = process.env.API_FOOTBALL_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;
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

async function getUpcomingMatchesCached() {
  const key = 'upcoming-matches';
  const cached = getCached(key);
  if (cached) return cached;

  if (!ODDS_API_KEY || ODDS_API_KEY === 'dan_key_cua_ban_o_day') {
    throw new Error(
      'Chưa cấu hình ODDS_API_KEY trong .env. Lấy key miễn phí tại https://the-odds-api.com'
    );
  }

  // markets: h2h = kèo 1X2 (Chủ/Hòa/Khách), spreads = kèo châu Á (handicap).
  // "spreads" của The Odds API cho bóng đá chính là kèo châu Á: mỗi đội có 1
  // "point" (mức chấp, vd -1.5 / +1.5) và 1 tỉ lệ (price) đi kèm.
  const events = await callOddsApi(`/sports/${ODDS_API_SPORT}/odds/`, {
    regions: 'eu',
    markets: 'h2h,spreads',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
  });

  // Tìm bookmaker ĐẦU TIÊN có market mong muốn — không phải bookmaker nào cũng
  // có kèo châu Á, nên dò riêng cho từng loại market thay vì chỉ lấy bookmaker[0].
  function findMarket(bookmakers, marketKey) {
    for (const bm of bookmakers || []) {
      const market = bm.markets?.find((m) => m.key === marketKey);
      if (market) return { bookmaker: bm, market };
    }
    return null;
  }

  const matches = (events || []).map((ev) => {
    let odds = null;
    let prediction = null;
    let asianHandicap = null;

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

    return {
      id: ev.id,
      commenceTime: ev.commence_time,
      homeTeam: ev.home_team,
      awayTeam: ev.away_team,
      odds,
      asianHandicap,
      prediction,
    };
  });

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
