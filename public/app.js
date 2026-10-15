// Frontend đơn giản: gọi các endpoint /api/* của server (server giữ API key,
// tự cache dữ liệu). Có 2 chế độ xem, dùng 2 nguồn dữ liệu khác nhau vì mỗi
// gói API free chỉ hỗ trợ một phần dữ liệu:
//
//  - "upcoming" (mặc định): các trận sắp diễn ra, nguồn The Odds API — nơi
//    DUY NHẤT có dữ liệu MÙA HIỆN TẠI trên gói free. Kèo + "dự đoán" (tính
//    từ kèo, gọi là implied probability) trả về cùng lúc trong 1 lần gọi,
//    không cần tải thêm gì nữa.
//  - "season": lịch thi đấu + dự đoán thật (mô hình của API-Football) theo
//    1 mùa cụ thể — nhưng gói free API-Football CHỈ hỗ trợ mùa 2022-2024
//    (không phải mùa hiện tại), và tỉ lệ kèo cho mùa đã kết thúc thường
//    KHÔNG có sẵn. Dự đoán ở chế độ này tải "lazy" theo từng trận (bấm nút)
//    để tiết kiệm quota 100 request/ngày.

const modeSelect = document.getElementById('mode-select');
const seasonLabel = document.getElementById('season-label');
const seasonSelect = document.getElementById('season-select');
const refreshBtn = document.getElementById('refresh-btn');
const statusText = document.getElementById('status-text');
const modeHint = document.getElementById('mode-hint');
const tableWrap = document.getElementById('table-wrap');

const tileTotal = document.getElementById('tile-total');
const tileUpcoming = document.getElementById('tile-upcoming');
const tileWithOdds = document.getElementById('tile-with-odds');
const tilePredictions = document.getElementById('tile-predictions');

const ledgerWrap = document.getElementById('ledger-wrap');
const ledgerDownloadBtn = document.getElementById('ledger-download-btn');

const MODE_HINTS = {
  upcoming:
    'Các trận sắp diễn ra mùa hiện tại (nguồn: The Odds API). "Dự đoán" ở đây được tính trực tiếp từ tỉ lệ kèo (implied probability), không phải mô hình AI riêng.',
  season:
    'Lịch thi đấu + dự đoán thật theo mùa giải cụ thể (nguồn: API-Football). Gói free chỉ hỗ trợ mùa 2022-2024, và tỉ lệ kèo cho mùa đã kết thúc thường KHÔNG có sẵn.',
};

let state = {
  mode: 'upcoming',
  season: null,
  upcomingMatches: [],
  fixtures: [],
  oddsByFixtureId: new Map(),
  predictionsByFixtureId: new Map(),
};

function setStatus(msg) {
  statusText.textContent = msg;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

// Tìm kèo 1X2 (Match Winner) từ bookmaker đầu tiên có sẵn cho 1 trận (dữ liệu API-Football)
function extractMatchWinnerOdds(oddsEntry) {
  if (!oddsEntry || !oddsEntry.bookmakers?.length) return null;
  for (const bm of oddsEntry.bookmakers) {
    const bet = bm.bets?.find((b) => b.name === 'Match Winner');
    if (bet) {
      const home = bet.values.find((v) => v.value === 'Home')?.odd;
      const draw = bet.values.find((v) => v.value === 'Draw')?.odd;
      const away = bet.values.find((v) => v.value === 'Away')?.odd;
      if (home && draw && away) {
        return { bookmaker: bm.name, home, draw, away };
      }
    }
  }
  return null;
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMeter(percent) {
  // percent: { home, draw, away } dạng số nguyên 0-100
  const { home, draw, away } = percent;
  return `
    <div class="meter" title="Chủ nhà ${home}% · Hòa ${draw}% · Khách ${away}%">
      <div class="seg" style="width:${home}%;background:var(--series-home)"></div>
      <div class="seg" style="width:${draw}%;background:var(--series-draw)"></div>
      <div class="seg" style="width:${away}%;background:var(--series-away)"></div>
    </div>
    <span class="meter-pct">${home}% · ${draw}% · ${away}%</span>
  `;
}

// ---- Chế độ "Trận sắp diễn ra" (The Odds API) ----
async function loadUpcoming() {
  setStatus('Đang tải các trận sắp diễn ra...');
  tableWrap.innerHTML = '<div class="loading">Đang tải dữ liệu...</div>';
  state.mode = 'upcoming';

  try {
    const res = await fetchJson('/api/upcoming');
    state.upcomingMatches = res.matches || [];
    renderTable();

    const withOdds = state.upcomingMatches.filter((m) => m.frames?.full?.odds).length;
    setStatus(
      `${state.upcomingMatches.length} trận sắp diễn ra · ${withOdds} trận có kèo · cập nhật ${new Date().toLocaleTimeString('vi-VN')}`
    );
  } catch (err) {
    tableWrap.innerHTML = `<div class="error">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</div>`;
    setStatus('');
  }
}

// Kèo châu Á: point dương nghĩa là đội đó được chấp (kèo dưới),
// âm là đội đó chấp đối thủ (kèo trên).
function fmtPoint(p) {
  const n = Number(p);
  return n > 0 ? `+${n}` : `${n}`;
}

function renderUpcomingTable() {
  if (state.upcomingMatches.length === 0) {
    tableWrap.innerHTML = '<div class="empty">Không có trận đấu nào sắp diễn ra.</div>';
    return;
  }

  const total = state.upcomingMatches.length;
  const withOdds = state.upcomingMatches.filter((m) => m.frames?.full?.odds).length;
  const withPrediction = state.upcomingMatches.filter((m) => m.frames?.full?.prediction).length;
  tileTotal.textContent = total;
  tileUpcoming.textContent = total;
  tileWithOdds.textContent = withOdds;
  tilePredictions.textContent = withPrediction;

  const cards = state.upcomingMatches
    .slice()
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime))
    .map((m) => renderMatchCard(m))
    .join('');

  tableWrap.innerHTML = `<div class="match-list">${cards}</div>`;
}

// Mỗi trận có 1 khung "Cả trận" (luôn có) và tối đa 1 khung "Hiện tại (Live)"
// (chỉ xuất hiện khi trận đã bắt đầu diễn ra) — xem src/ml/frameSnapshots.js.
// CẢ 2 khung đều đã được backend "CHỐT" (khoá) ngay từ lần đầu xuất hiện,
// không đổi theo biến động kèo/phong độ về sau — vì vậy mỗi khung tự hiển thị
// thời điểm đã chốt (`lockedAt`) để người xem biết đây là ảnh chụp tại 1 thời
// điểm cụ thể, không phải số liệu "sống" cập nhật liên tục.
function renderMatchCard(m) {
  const full = m.frames?.full;
  const live = m.frames?.live;

  const fullSection = full
    ? `
      <div class="frame-section">
        <div class="frame-label">
          <span class="frame-badge full">📌 Cả trận</span>
          <span class="frame-locked-at">Chốt lúc ${fmtDate(full.lockedAt)}</span>
        </div>
        ${renderOddsGrid(full, m.homeTeam, m.awayTeam)}
        ${renderAnalysisPanel(full)}
        ${renderConsensusPanel(full)}
        ${renderMlPanel(full)}
        ${renderStatsPanel(full)}
      </div>
    `
    : '';

  const liveSection = live
    ? `
      <div class="frame-section live-frame">
        <div class="frame-label">
          <span class="frame-badge live">🔴 Hiện tại (Live)</span>
          <span class="frame-locked-at">Chốt lúc ${fmtDate(live.lockedAt)} (ngay khi trận bắt đầu)</span>
        </div>
        ${renderOddsGrid(live, m.homeTeam, m.awayTeam)}
        ${renderAnalysisPanel(live)}
        ${renderConsensusPanel(live)}
        ${renderMlPanel(live)}
        ${renderStatsPanel(live)}
      </div>
    `
    : '';

  return `
    <div class="match-card">
      <div class="match-card-head">
        <div class="teams">${escapeHtml(m.homeTeam)} vs ${escapeHtml(m.awayTeam)}${m.isLive ? '<span class="live-indicator">● ĐANG DIỄN RA</span>' : ''}</div>
        <div class="num">${fmtDate(m.commenceTime)}</div>
      </div>

      ${fullSection}
      ${liveSection}
    </div>
  `;
}

function renderOddsGrid(frame, homeTeam, awayTeam) {
  const oddsValue = frame.odds
    ? `${frame.odds.home} / ${frame.odds.draw} / ${frame.odds.away}<div class="status-badge">${escapeHtml(frame.odds.bookmaker)}</div>`
    : '<span class="status-badge">Chưa có kèo</span>';

  const handicapValue = frame.asianHandicap
    ? `${escapeHtml(homeTeam)} ${fmtPoint(frame.asianHandicap.homePoint)} @ ${frame.asianHandicap.homeOdd}<br/>` +
      `${escapeHtml(awayTeam)} ${fmtPoint(frame.asianHandicap.awayPoint)} @ ${frame.asianHandicap.awayOdd}` +
      `<div class="status-badge">${escapeHtml(frame.asianHandicap.bookmaker)}</div>`
    : '<span class="status-badge">Chưa có kèo châu Á</span>';

  const totalsValue = frame.totals
    ? `Mức ${frame.totals.point} bàn<br/>Tài @ ${frame.totals.overOdd} / Xỉu @ ${frame.totals.underOdd}` +
      `<div class="status-badge">${escapeHtml(frame.totals.bookmaker)}</div>`
    : '<span class="status-badge">Chưa có kèo tài xỉu</span>';

  return `
    <div class="match-odds-grid">
      <div class="odds-block">
        <div class="odds-block-label">Kèo 1X2 (Chủ / Hòa / Khách)</div>
        <div class="odds-block-value">${oddsValue}</div>
      </div>
      <div class="odds-block">
        <div class="odds-block-label">Kèo châu Á (Handicap)</div>
        <div class="odds-block-value">${handicapValue}</div>
      </div>
      <div class="odds-block">
        <div class="odds-block-label">Kèo tài xỉu (Over/Under)</div>
        <div class="odds-block-value">${totalsValue}</div>
      </div>
    </div>
  `;
}

function renderAnalysisPanel(frame) {
  if (!frame.prediction && !frame.analysis) {
    return '<div class="analysis-panel"><span class="status-badge">Chưa đủ dữ liệu để phân tích</span></div>';
  }

  const meterHtml = frame.prediction ? renderMeter(frame.prediction) : '';
  const scoreBadge = frame.analysis?.suggestedScore
    ? `<span class="analysis-score-badge">Tỉ số gợi ý: ${frame.analysis.suggestedScore.home} - ${frame.analysis.suggestedScore.away}</span>`
    : '';
  const notesHtml =
    frame.analysis?.notes?.length > 0
      ? `<ul class="analysis-notes">${frame.analysis.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : '';

  return `
    <div class="analysis-panel">
      <div class="analysis-header">
        <span class="analysis-title">Dự đoán BD</span>
        ${meterHtml}
      </div>
      ${scoreBadge}
      ${notesHtml}
      <div class="analysis-disclaimer">Tính từ tỉ lệ kèo hiện có, chỉ mang tính tham khảo — không phải lời khuyên cá cược.</div>
    </div>
  `;
}

// "Đồng thuận" — trung bình cộng của "Dự đoán ML" (mô hình đã học) và "Phân
// tích phong độ & đối đầu" (thống kê Poisson, có kèo chấp). Không tính toán gì
// mới, chỉ gộp 2 kết quả backend đã tính sẵn (m.consensus, xem src/ml/consensus.js).
const AGREEMENT_LABELS = {
  'strong-agree': 'Đồng thuận mạnh',
  agree: 'Đồng thuận',
  disagree: 'Trái chiều',
};
function renderConsensusPanel(frame) {
  const c = frame.consensus;
  if (!c) return '';

  if (!c.available) {
    return `
      <div class="consensus-panel">
        <div class="consensus-header">
          <span class="consensus-title">Đồng thuận (ML + Thống kê)</span>
          <span class="consensus-badge single-source">Chưa đủ dữ liệu</span>
        </div>
        <div class="consensus-note">${escapeHtml(c.reason || 'Không xác định.')}</div>
      </div>
    `;
  }

  const meterHtml = renderMeter({ home: c.homeWinProb, draw: c.drawProb, away: c.awayWinProb });
  const badgeClass = c.source === 'both' ? c.agreement : 'single-source';
  const badgeLabel = c.source === 'both' ? AGREEMENT_LABELS[c.agreement] : 'Chỉ 1 nguồn';

  return `
    <div class="consensus-panel">
      <div class="consensus-header">
        <span class="consensus-title">Đồng thuận (ML + Thống kê)</span>
        <span class="consensus-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      ${meterHtml}
      <div class="consensus-note">${escapeHtml(c.note || '')}</div>
    </div>
  `;
}

// "Dự đoán ML" — kết quả từ mô hình học máy (hồi quy logistic) huấn luyện từ
// dữ liệu lịch sử 2022-2024, dùng phong độ + đối đầu MÙA HIỆN TẠI (football-data.org)
// để dự đoán. Khác với "Dự đoán BD" ở trên (chỉ tính từ tỉ lệ kèo tức thời).
function renderMlPanel(frame) {
  const ml = frame.mlPrediction;
  if (!ml) return '';

  if (!ml.available) {
    return `
      <div class="ml-panel">
        <div class="ml-header">
          <div class="ml-title-group">
            <span class="ml-title">Dự đoán ML</span>
            <span class="ml-beta-tag">Beta</span>
          </div>
        </div>
        <div class="ml-unavailable">Chưa đủ dữ liệu: ${escapeHtml(ml.reason || 'không xác định.')}</div>
      </div>
    `;
  }

  const meterHtml = renderMeter({ home: ml.homeWinProb, draw: ml.drawProb, away: ml.awayWinProb });
  const accPct = ml.modelMeta?.valAcc != null ? Math.round(ml.modelMeta.valAcc * 100) : null;
  const notesHtml =
    ml.coldStartNotes?.length > 0
      ? `<ul class="ml-notes">${ml.coldStartNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
      : '';

  return `
    <div class="ml-panel">
      <div class="ml-header">
        <div class="ml-title-group">
          <span class="ml-title">Dự đoán ML</span>
          <span class="ml-beta-tag">Beta</span>
        </div>
        ${meterHtml}
      </div>
      ${accPct !== null ? `<div class="ml-meta">Mô hình học từ ${ml.modelMeta.nTrain} trận (2022-2024) · độ chính xác đo thật: ${accPct}%</div>` : ''}
      ${notesHtml}
    </div>
  `;
}

// "Phân tích phong độ & đối đầu" — số liệu THÔ (bàn thắng/thua từng trận gần
// đây, lịch sử đối đầu), kết hợp kèo chấp châu Á để ước tính 3 tỉ số khả dĩ
// nhất (mô hình Poisson, xem src/ml/scoreProjection.mjs ở backend).
function renderFormBadges(recentMatches) {
  if (!recentMatches || recentMatches.length === 0) {
    return '<span class="stats-empty-note">Chưa có trận nào mùa này.</span>';
  }
  // recentMatches đã sắp xếp gần nhất trước -> đảo lại để đọc trái sang phải theo thời gian
  const ordered = recentMatches.slice().reverse();
  const badges = ordered
    .map((r) => `<span class="form-badge ${r.result}" title="${fmtDateShort(r.date)}: ${r.goalsFor}-${r.goalsAgainst} vs ${escapeHtml(r.opponent)}">${r.result}</span>`)
    .join('');
  const list = recentMatches
    .map(
      (r) =>
        `<li><span>${fmtDateShort(r.date)} ${r.venue === 'home' ? 'vs' : '@'} ${escapeHtml(r.opponent)}</span><span class="num">${r.goalsFor}-${r.goalsAgainst}</span></li>`
    )
    .join('');
  return `
    <div class="stats-form-badges">${badges}</div>
    <ul class="stats-match-list">${list}</ul>
  `;
}

function renderH2HList(h2h, homeTeam) {
  if (!h2h || h2h.length === 0) {
    return '<span class="stats-empty-note">Chưa tìm thấy lần đối đầu nào gần đây.</span>';
  }
  const items = h2h
    .map((m) => {
      const isHomeTeamHome = m.homeTeam === homeTeam;
      return `<li><span>${fmtDateShort(m.date)} ${escapeHtml(m.homeTeam)} ${isHomeTeamHome ? '(sân nhà)' : ''}</span><span class="num">${m.homeGoals}-${m.awayGoals}</span></li>`;
    })
    .join('');
  return `<ul class="stats-match-list">${items}</ul>`;
}

function renderStatsPanel(frame) {
  const sp = frame.statsPanel;
  if (!sp) return '';

  if (!sp.available) {
    return `
      <div class="stats-panel">
        <div class="stats-title">Phân tích phong độ &amp; đối đầu</div>
        <div class="stats-empty-note">Chưa đủ dữ liệu: ${escapeHtml(sp.reason || 'không xác định.')}</div>
      </div>
    `;
  }

  const scorelineChips = sp.topScorelines?.length
    ? `<div class="scoreline-chips">${sp.topScorelines
        .map(
          (s) =>
            `<span class="scoreline-chip"><span class="score">${s.home}-${s.away}</span><span class="pct">${s.probabilityPct}%</span></span>`
        )
        .join('')}</div>`
    : '<span class="stats-empty-note">Chưa đủ dữ liệu để ước tính tỉ số.</span>';

  return `
    <div class="stats-panel">
      <div class="stats-title">Phân tích phong độ &amp; đối đầu</div>
      <div class="stats-teams-grid">
        <div class="stats-team-col">
          <div class="stats-team-name">${escapeHtml(sp.homeTeam)} (sân nhà)</div>
          ${renderFormBadges(sp.homeRecent)}
        </div>
        <div class="stats-team-col">
          <div class="stats-team-name">${escapeHtml(sp.awayTeam)} (sân khách)</div>
          ${renderFormBadges(sp.awayRecent)}
        </div>
      </div>
      <div class="stats-h2h">
        <div class="stats-h2h-title">Lịch sử đối đầu gần đây</div>
        ${renderH2HList(sp.h2h, sp.homeTeam)}
      </div>
      ${sp.notes?.length ? `<ul class="stats-verdict-notes">${sp.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      ${sp.verdict ? `<div class="verdict-line"><span class="verdict-label">Chốt kèo:</span> <span class="verdict-value">${escapeHtml(sp.verdict.label)}</span></div>` : ''}
      <div class="stats-h2h-title">3 tỉ số có khả năng xảy ra cao nhất</div>
      ${scorelineChips}
    </div>
  `;
}

// ---- Chế độ "Theo mùa giải" (API-Football) ----
async function loadSeasonData(season) {
  setStatus('Đang tải danh sách trận đấu...');
  tableWrap.innerHTML = '<div class="loading">Đang tải dữ liệu...</div>';
  state.mode = 'season';

  try {
    const [fixturesRes, oddsRes] = await Promise.all([
      fetchJson(`/api/fixtures?season=${season}`),
      fetchJson(`/api/odds?season=${season}`),
    ]);

    state.season = season;
    state.fixtures = fixturesRes.fixtures || [];
    state.oddsByFixtureId = new Map(
      (oddsRes.odds || []).map((entry) => [entry.fixture.id, entry])
    );
    state.predictionsByFixtureId = new Map();

    renderTable();
    setStatus(
      `${state.fixtures.length} trận · ${oddsRes.odds?.length || 0} trận có kèo · cập nhật ${new Date().toLocaleTimeString('vi-VN')}`
    );
  } catch (err) {
    tableWrap.innerHTML = `<div class="error">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</div>`;
    setStatus('');
  }
}

function renderPredictionCell(fixtureId) {
  const pred = state.predictionsByFixtureId.get(fixtureId);
  if (pred === undefined) {
    return `<button class="btn-load-pred" data-fixture-id="${fixtureId}">Xem dự đoán</button>`;
  }
  if (pred === null) {
    return '<span class="status-badge">Không có dữ liệu dự đoán</span>';
  }
  const percentRaw = pred.predictions?.percent;
  if (!percentRaw) return '<span class="status-badge">Không có dữ liệu dự đoán</span>';

  const toNum = (s) => parseInt(String(s).replace('%', ''), 10) || 0;
  const percent = {
    home: toNum(percentRaw.home),
    draw: toNum(percentRaw.draw),
    away: toNum(percentRaw.away),
  };
  const winnerName = pred.predictions?.winner?.name;

  return `
    ${renderMeter(percent)}
    ${winnerName ? `<div class="status-badge">Dự đoán thắng: ${escapeHtml(winnerName)}</div>` : ''}
  `;
}

function renderSeasonTable() {
  if (state.fixtures.length === 0) {
    tableWrap.innerHTML = '<div class="empty">Không có trận đấu nào cho mùa giải này.</div>';
    tileTotal.textContent = 0;
    tileUpcoming.textContent = 0;
    tileWithOdds.textContent = 0;
    tilePredictions.textContent = 0;
    return;
  }

  const total = state.fixtures.length;
  const now = Date.now();
  const upcoming = state.fixtures.filter((f) => new Date(f.fixture.date).getTime() > now).length;
  tileTotal.textContent = total;
  tileUpcoming.textContent = upcoming;
  tileWithOdds.textContent = state.oddsByFixtureId.size;
  tilePredictions.textContent = state.predictionsByFixtureId.size;

  const rows = state.fixtures
    .slice()
    .sort((a, b) => new Date(a.fixture.date) - new Date(b.fixture.date))
    .map((f) => {
      const id = f.fixture.id;
      const oddsEntry = state.oddsByFixtureId.get(id);
      const odds = extractMatchWinnerOdds(oddsEntry);
      const oddsCell = odds
        ? `${odds.home} / ${odds.draw} / ${odds.away}<div class="status-badge">${escapeHtml(odds.bookmaker)}</div>`
        : '<span class="status-badge">Chưa có kèo</span>';

      return `
        <tr data-fixture-id="${id}">
          <td class="num">${fmtDate(f.fixture.date)}</td>
          <td>
            <div class="teams">${escapeHtml(f.teams.home.name)} vs ${escapeHtml(f.teams.away.name)}</div>
            <div class="status-badge">${escapeHtml(f.fixture.status?.long || '')}</div>
          </td>
          <td class="num">${oddsCell}</td>
          <td class="pred-cell">${renderPredictionCell(id)}</td>
        </tr>
      `;
    })
    .join('');

  tableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Thời gian</th>
          <th>Trận đấu</th>
          <th>Kèo 1X2 (Chủ / Hòa / Khách)</th>
          <th>Dự đoán</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  tableWrap.querySelectorAll('.btn-load-pred').forEach((btn) => {
    btn.addEventListener('click', () => loadPrediction(Number(btn.dataset.fixtureId)));
  });
}

async function loadPrediction(fixtureId) {
  const row = tableWrap.querySelector(`tr[data-fixture-id="${fixtureId}"] .pred-cell`);
  if (row) row.innerHTML = '<span class="status-badge">Đang tải...</span>';

  try {
    const json = await fetchJson(`/api/predictions/${fixtureId}`);
    state.predictionsByFixtureId.set(fixtureId, json.prediction);
  } catch (err) {
    state.predictionsByFixtureId.set(fixtureId, null);
    console.error(err);
  }

  if (row) row.innerHTML = renderPredictionCell(fixtureId);
  tilePredictions.textContent = state.predictionsByFixtureId.size;
}

function renderTable() {
  if (state.mode === 'upcoming') {
    renderUpcomingTable();
  } else {
    renderSeasonTable();
  }
}

function applyMode(mode) {
  modeHint.textContent = MODE_HINTS[mode] || '';
  const isSeason = mode === 'season';
  seasonLabel.style.display = isSeason ? '' : 'none';
  seasonSelect.style.display = isSeason ? '' : 'none';

  if (isSeason) {
    loadSeasonData(Number(seasonSelect.value));
  } else {
    loadUpcoming();
  }
}

// ---- "Bảng sao kê dự đoán" — lịch sử chốt kèo + 3 tỉ số dự đoán, trúng/trật ----
async function loadLedger() {
  try {
    const res = await fetchJson('/api/predictions-log');
    renderLedgerTable(res.entries || []);
  } catch (err) {
    ledgerWrap.innerHTML = `<div class="error">Không tải được bảng sao kê: ${escapeHtml(err.message)}</div>`;
  }
}

function renderLedgerScorelines(entry) {
  return `
    <div class="ledger-scorelines">
      ${entry.topScorelines
        .map((s, idx) => {
          const isHit = entry.status === 'resolved' && entry.scorelineHitIndex === idx;
          return `<span class="ledger-scoreline${isHit ? ' hit' : ''}">${s.home}-${s.away}<span style="opacity:.65">${s.probabilityPct}%</span></span>`;
        })
        .join('')}
    </div>
  `;
}

function renderLedgerStatus(entry) {
  if (entry.status !== 'resolved') {
    return '<span class="ledger-status pending">Đang chờ</span>';
  }
  const verdictBadge = entry.verdictCorrect
    ? '<span class="ledger-status hit-status">Đúng chốt kèo</span>'
    : '<span class="ledger-status miss-status">Sai chốt kèo</span>';
  const scoreBadge =
    entry.scorelineHitIndex >= 0
      ? '<span class="ledger-status hit-status">Đúng tỉ số!</span>'
      : '';
  return `${verdictBadge} ${scoreBadge}`;
}

// Mức độ "Dự đoán ML" và "Phân tích phong độ & đối đầu" đồng ý với nhau, ghi
// lại NGAY LÚC chốt kèo (xem src/ml/consensus.js + src/ml/predictionLog.js) —
// cũng là 1 phần của "chốt", không tính lại sau này. Entry ghi lại TRƯỚC khi
// có tính năng này (consensusAgreement = undefined) sẽ không hiện badge.
const CONSENSUS_BADGES = {
  'strong-agree': { label: 'Đồng thuận mạnh', cls: 'strong' },
  agree: { label: 'Đồng thuận', cls: 'normal' },
  disagree: { label: 'Trái chiều', cls: 'conflict' },
  'ml-only': { label: 'Chỉ 1 nguồn (ML)', cls: 'single' },
  'stats-only': { label: 'Chỉ 1 nguồn (Thống kê)', cls: 'single' },
};

function renderLedgerConsensus(entry) {
  const info = CONSENSUS_BADGES[entry.consensusAgreement];
  if (!info) return '';
  return `<span class="ledger-consensus ${info.cls}">${info.label}</span>`;
}

// Gộp nhóm theo NGÀY (giờ địa phương người xem) để chèn 1 dòng tiêu đề ngày
// trước mỗi nhóm trận — sắp xếp từ sớm nhất đến muộn nhất.
function dayKeyOf(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function fmtDayHeading(iso) {
  const d = new Date(iso);
  const text = d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderLedgerTable(entries) {
  if (!entries.length) {
    ledgerWrap.innerHTML =
      '<div class="ledger-empty">Chưa có dự đoán nào được ghi lại. Mỗi trận sẽ tự động được thêm vào đây khi lần đầu xuất hiện ở "Trận sắp diễn ra".</div>';
    return;
  }

  const sorted = entries.slice().sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));

  let lastDayKey = null;
  const rows = sorted
    .map((e) => {
      const dayKey = dayKeyOf(e.commenceTime);
      const dayHeaderRow =
        dayKey !== lastDayKey
          ? `<tr class="ledger-day-row"><td colspan="6">${fmtDayHeading(e.commenceTime)}</td></tr>`
          : '';
      lastDayKey = dayKey;

      return `
        ${dayHeaderRow}
        <tr>
          <td class="teams">${escapeHtml(e.homeTeam)} vs ${escapeHtml(e.awayTeam)}</td>
          <td class="num">${fmtDate(e.commenceTime)}</td>
          <td>${escapeHtml(e.verdictLabel)}${renderLedgerConsensus(e)}</td>
          <td>${renderLedgerScorelines(e)}</td>
          <td class="num">${e.status === 'resolved' ? `${e.actualHomeGoals}-${e.actualAwayGoals}` : '<span class="status-badge">Chưa đá</span>'}</td>
          <td>${renderLedgerStatus(e)}</td>
        </tr>
      `;
    })
    .join('');

  ledgerWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Trận đấu</th>
          <th>Ngày đá</th>
          <th>Chốt kèo</th>
          <th>3 tỉ số dự đoán</th>
          <th>Kết quả thật</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

ledgerDownloadBtn.addEventListener('click', () => {
  window.location.href = '/api/predictions-log/download';
});

async function init() {
  try {
    const health = await fetchJson('/api/health');
    const defaultSeason = health.defaultSeason;

    const seasons = [defaultSeason - 2, defaultSeason - 1, defaultSeason];
    seasonSelect.innerHTML = seasons
      .map((s) => `<option value="${s}" ${s === defaultSeason ? 'selected' : ''}>${s}</option>`)
      .join('');

    applyMode(modeSelect.value);
    loadLedger();
  } catch (err) {
    tableWrap.innerHTML = `<div class="error">Không kết nối được tới server: ${escapeHtml(err.message)}</div>`;
  }
}

modeSelect.addEventListener('change', () => applyMode(modeSelect.value));
seasonSelect.addEventListener('change', () => loadSeasonData(Number(seasonSelect.value)));
refreshBtn.addEventListener('click', () => {
  applyMode(modeSelect.value);
  loadLedger();
});

init();
