// "Bảng sao kê dự đoán" — tự động ghi lại "chốt kèo" + 3 tỉ số dự đoán của
// khung "Phân tích phong độ & đối đầu" cho MỌI trận từng hiển thị ở chế độ
// "Trận sắp diễn ra", rồi sau này tự đối chiếu với kết quả thật (lấy từ
// football-data.org, dùng lại đúng dữ liệu đã tải cho "Dự đoán ML"/thống kê,
// không gọi thêm API nào) để đánh dấu trúng/trật.
//
// Lưu vào data/predictions-log.json — CẢNH BÁO: ổ đĩa Render free bị xoá sạch
// mỗi khi deploy code mới, nên file này KHÔNG tự "sống sót" qua các lần cập
// nhật code sau này (khác với data/model.json, vốn là file tĩnh không đổi).
// Người dùng cần tự bấm nút "Tải về sao kê" (xem /api/predictions-log/download
// bên dưới) để backup định kỳ, rồi kéo file đó lên GitHub cùng lúc với code mới
// nếu muốn giữ lại lịch sử cũ.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTeamName } from './teamNameMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, '..', '..', 'data', 'predictions-log.json');

// Khớp kết quả thật trong vòng +/- 4 ngày quanh giờ bóng lăn dự kiến — đủ rộng
// để bù trường hợp trận bị hoãn/dời giờ nhẹ, vẫn đủ hẹp để không khớp nhầm
// sang lần gặp nhau khác (2 đội trong Ngoại hạng Anh chỉ gặp lại sau vài tháng).
const RESOLVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 4;

function loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const raw = readFileSync(LOG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[Bảng sao kê] Lỗi đọc data/predictions-log.json:', err.message);
    return [];
  }
}

function saveLog(log) {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Bảng sao kê] Lỗi ghi data/predictions-log.json:', err.message);
  }
}

function resultSide(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

// Ghi lại 1 dự đoán mới — chỉ ghi 1 LẦN DUY NHẤT cho mỗi trận (theo `id`), để
// không bị "chốt kèo" đổi liên tục mỗi lần kèo/phong độ cập nhật trước giờ đấu
// (ghi đúng nhận định tại thời điểm trận ĐẦU TIÊN xuất hiện trong danh sách).
export function recordPrediction({ id, homeTeam, awayTeam, commenceTime, verdict, topScorelines }) {
  if (!id || !verdict || !topScorelines?.length) return;

  const log = loadLog();
  if (log.some((e) => e.id === id)) return;

  log.push({
    id,
    homeTeam,
    awayTeam,
    commenceTime,
    loggedAt: new Date().toISOString(),
    verdictSide: verdict.side,
    verdictLabel: verdict.label,
    topScorelines: topScorelines.map((s) => ({ home: s.home, away: s.away, probabilityPct: s.probabilityPct })),
    status: 'pending',
    resolvedAt: null,
    actualHomeGoals: null,
    actualAwayGoals: null,
    actualWinnerSide: null,
    verdictCorrect: null,
    scorelineHitIndex: null, // -1 = không tỉ số nào trong 3 khớp, >=0 = vị trí khớp
  });
  saveLog(log);
}

function findActualResult(matches, entry) {
  const home = resolveTeamName(entry.homeTeam);
  const away = resolveTeamName(entry.awayTeam);
  if (!home || !away) return null;

  const target = new Date(entry.commenceTime).getTime();
  return (
    matches.find((m) => {
      if (m.homeTeam !== home || m.awayTeam !== away) return false;
      const dt = Math.abs(new Date(m.date).getTime() - target);
      return dt < RESOLVE_WINDOW_MS;
    }) || null
  );
}

// Đối chiếu mọi dự đoán đang "pending" với danh sách trận ĐÃ KẾT THÚC của mùa
// hiện tại (currentSeasonMatches, lấy từ football-data.org — xem src/server.js).
// Gọi hàm này mỗi lần /api/upcoming chạy (đã có sẵn currentSeasonMatches trong
// tay), không cần lịch chạy riêng.
export function resolvePendingPredictions(currentSeasonMatches) {
  if (!currentSeasonMatches?.length) return;

  const log = loadLog();
  let changed = false;

  for (const entry of log) {
    if (entry.status !== 'pending') continue;

    const match = findActualResult(currentSeasonMatches, entry);
    if (!match) continue;

    entry.status = 'resolved';
    entry.resolvedAt = new Date().toISOString();
    entry.actualHomeGoals = match.homeGoals;
    entry.actualAwayGoals = match.awayGoals;
    entry.actualWinnerSide = resultSide(match.homeGoals, match.awayGoals);
    entry.verdictCorrect = entry.actualWinnerSide === entry.verdictSide;
    entry.scorelineHitIndex = entry.topScorelines.findIndex(
      (s) => s.home === match.homeGoals && s.away === match.awayGoals
    );
    changed = true;
  }

  if (changed) saveLog(log);
}

// Trả về toàn bộ sao kê, mới nhất trước — cho /api/predictions-log.
export function getLog() {
  return loadLog()
    .slice()
    .sort((a, b) => new Date(b.commenceTime) - new Date(a.commenceTime));
}

export function getLogFilePath() {
  return LOG_PATH;
}
