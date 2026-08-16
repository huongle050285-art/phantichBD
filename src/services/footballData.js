// Client cho football-data.org — nguồn DUY NHẤT trong 3 API đang dùng có
// KẾT QUẢ TRẬN ĐẤU + BẢNG XẾP HẠNG của MÙA GIẢI HIỆN TẠI trên gói free
// (API-Football free chỉ tới hết mùa 2024, The Odds API chỉ có tỉ lệ kèo).
// Dùng để tính phong độ + đối đầu "thật" cho khối "Dự đoán ML".
//
// Đăng ký key miễn phí (chỉ cần email): https://www.football-data.org/client/register
import { createCache } from '../cache.js';
import { resolveTeamName } from '../ml/teamNameMap.js';

const BASE_URL = 'https://api.football-data.org/v4';
const COMPETITION = 'PL'; // Premier League
const KEY = process.env.FOOTBALL_DATA_KEY;

// TTL dài hơn cache kèo (60 phút) — dữ liệu phong độ/bảng xếp hạng gói free đã
// "delayed" sẵn (không real-time) nên không cần làm mới liên tục, và giúp đỡ
// tốn quota (10 request/phút) mỗi khi server "thức dậy" sau khi ngủ trên Render.
const cache = createCache(60 * 60 * 1000);

function isConfigured() {
  return Boolean(KEY) && KEY !== 'dan_key_cua_ban_o_day';
}

async function callFootballData(pathName, params = {}) {
  const url = new URL(BASE_URL + pathName);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const res = await fetch(url, { headers: { 'X-Auth-Token': KEY } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`football-data.org HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// Trận đấu đã kết thúc của mùa hiện tại, đã chuẩn hoá tên đội — dùng để tính
// phong độ + đối đầu (features.mjs). Trận nào không khớp được tên đội sẽ bị bỏ qua.
export async function getFinishedMatchesCached() {
  if (!isConfigured()) {
    throw new Error(
      'Chưa cấu hình FOOTBALL_DATA_KEY trong .env. Lấy key miễn phí tại https://www.football-data.org/client/register'
    );
  }

  return cache.getOrLoad('fd-finished-matches', async () => {
    const json = await callFootballData(`/competitions/${COMPETITION}/matches`, { status: 'FINISHED' });
    const matches = [];
    for (const m of json.matches || []) {
      const homeTeam = resolveTeamName(m.homeTeam?.name || m.homeTeam?.shortName);
      const awayTeam = resolveTeamName(m.awayTeam?.name || m.awayTeam?.shortName);
      const homeGoals = m.score?.fullTime?.home;
      const awayGoals = m.score?.fullTime?.away;
      if (!homeTeam || !awayTeam || homeGoals === null || awayGoals === null || homeGoals === undefined) continue;
      matches.push({ date: m.utcDate, homeTeam, awayTeam, homeGoals, awayGoals });
    }
    return matches;
  });
}

// Bảng xếp hạng hiện tại — dùng để hiển thị thêm thông tin tham khảo (vị trí,
// điểm, chuỗi kết quả gần nhất) bên cạnh khối "Dự đoán ML".
export async function getStandingsCached() {
  if (!isConfigured()) {
    throw new Error(
      'Chưa cấu hình FOOTBALL_DATA_KEY trong .env. Lấy key miễn phí tại https://www.football-data.org/client/register'
    );
  }

  return cache.getOrLoad('fd-standings', async () => {
    const json = await callFootballData(`/competitions/${COMPETITION}/standings`);
    const table = json.standings?.find((s) => s.type === 'TOTAL')?.table || [];
    return table.map((row) => ({
      team: resolveTeamName(row.team?.name || row.team?.shortName) || row.team?.name,
      position: row.position,
      playedGames: row.playedGames,
      points: row.points,
      won: row.won,
      draw: row.draw,
      lost: row.lost,
      goalDifference: row.goalDifference,
      form: row.form, // vd "W,W,D,L,W" — chuỗi kết quả 5 trận gần nhất theo football-data.org
    }));
  });
}

export { isConfigured as isFootballDataConfigured };
