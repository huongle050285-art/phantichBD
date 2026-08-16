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

    const withOdds = state.upcomingMatches.filter((m) => m.odds).length;
    setStatus(
      `${state.upcomingMatches.length} trận sắp diễn ra · ${withOdds} trận có kèo · cập nhật ${new Date().toLocaleTimeString('vi-VN')}`
    );
  } catch (err) {
    tableWrap.innerHTML = `<div class="error">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</div>`;
    setStatus('');
  }
}

function renderUpcomingTable() {
  if (state.upcomingMatches.length === 0) {
    tableWrap.innerHTML = '<div class="empty">Không có trận đấu nào sắp diễn ra.</div>';
    return;
  }

  const total = state.upcomingMatches.length;
  const withOdds = state.upcomingMatches.filter((m) => m.odds).length;
  const withPrediction = state.upcomingMatches.filter((m) => m.prediction).length;
  tileTotal.textContent = total;
  tileUpcoming.textContent = total;
  tileWithOdds.textContent = withOdds;
  tilePredictions.textContent = withPrediction;

  // Kèo châu Á: hiển thị mức chấp (point) của đội chủ nhà + tỉ lệ 2 bên.
  // Point dương nghĩa là đội đó được chấp (kèo dưới), âm là đội đó chấp đối thủ (kèo trên).
  function fmtPoint(p) {
    const n = Number(p);
    return n > 0 ? `+${n}` : `${n}`;
  }
  function renderHandicapCell(m) {
    if (!m.asianHandicap) return '<span class="status-badge">Chưa có kèo châu Á</span>';
    const h = m.asianHandicap;
    return `
      ${escapeHtml(m.homeTeam)} ${fmtPoint(h.homePoint)} @ ${h.homeOdd}<br/>
      ${escapeHtml(m.awayTeam)} ${fmtPoint(h.awayPoint)} @ ${h.awayOdd}
      <div class="status-badge">${escapeHtml(h.bookmaker)}</div>
    `;
  }

  const rows = state.upcomingMatches
    .slice()
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime))
    .map((m) => {
      const oddsCell = m.odds
        ? `${m.odds.home} / ${m.odds.draw} / ${m.odds.away}<div class="status-badge">${escapeHtml(m.odds.bookmaker)}</div>`
        : '<span class="status-badge">Chưa có kèo</span>';

      const predCell = m.prediction
        ? renderMeter(m.prediction)
        : '<span class="status-badge">Không có dữ liệu</span>';

      return `
        <tr>
          <td class="num">${fmtDate(m.commenceTime)}</td>
          <td><div class="teams">${escapeHtml(m.homeTeam)} vs ${escapeHtml(m.awayTeam)}</div></td>
          <td class="num">${oddsCell}</td>
          <td class="num">${renderHandicapCell(m)}</td>
          <td>${predCell}</td>
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
          <th>Kèo châu Á (Handicap)</th>
          <th>Dự đoán (tính từ kèo)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
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

async function init() {
  try {
    const health = await fetchJson('/api/health');
    const defaultSeason = health.defaultSeason;

    const seasons = [defaultSeason - 2, defaultSeason - 1, defaultSeason];
    seasonSelect.innerHTML = seasons
      .map((s) => `<option value="${s}" ${s === defaultSeason ? 'selected' : ''}>${s}</option>`)
      .join('');

    applyMode(modeSelect.value);
  } catch (err) {
    tableWrap.innerHTML = `<div class="error">Không kết nối được tới server: ${escapeHtml(err.message)}</div>`;
  }
}

modeSelect.addEventListener('change', () => applyMode(modeSelect.value));
seasonSelect.addEventListener('change', () => loadSeasonData(Number(seasonSelect.value)));
refreshBtn.addEventListener('click', () => applyMode(modeSelect.value));

init();
