// "Bảng sao kê dự đoán" — tự động ghi lại "chốt kèo" + 3 tỉ số dự đoán của
// khung "Phân tích phong độ & đối đầu" cho MỌI trận từng hiển thị ở chế độ
// "Trận sắp diễn ra", rồi sau này tự đối chiếu với kết quả thật (lấy từ
// football-data.org, dùng lại đúng dữ liệu đã tải cho "Dự đoán ML"/thống kê,
// không gọi thêm API nào) để đánh dấu trúng/trật.
//
// Có 2 nơi lưu trữ, chọn tự động theo cấu hình (giống frameSnapshots.js):
// 1) Firebase Firestore (nếu đã cấu hình FIREBASE_SERVICE_ACCOUNT_BASE64) —
//    bền vững qua mọi lần deploy. Nên dùng khi đã chuyển sang Firebase.
// 2) File data/predictions-log.json (mặc định) — CẢNH BÁO: ổ đĩa Render free
//    bị xoá mỗi lần deploy code mới, cần tự bấm "Tải về sao kê" để backup
//    định kỳ, rồi kéo file đó lên GitHub cùng lúc với code mới nếu muốn giữ
//    lại lịch sử cũ.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTeamName } from './teamNameMap.js';
import { isFirestoreEnabled, getDb } from '../firestoreDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, '..', '..', 'data', 'predictions-log.json');
const COLLECTION = 'predictionsLog';

// Khớp kết quả thật trong vòng +/- 4 ngày quanh giờ bóng lăn dự kiến — đủ rộng
// để bù trường hợp trận bị hoãn/dời giờ nhẹ, vẫn đủ hẹp để không khớp nhầm
// sang lần gặp nhau khác (2 đội trong Ngoại hạng Anh chỉ gặp lại sau vài tháng).
const RESOLVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 4;

function resultSide(homeGoals, awayGoals) {
  if (homeGoals > awayGoals) return 'home';
  if (awayGoals > homeGoals) return 'away';
  return 'draw';
}

function buildNewEntry({ id, homeTeam, awayTeam, commenceTime, verdict, topScorelines }) {
  return {
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
  };
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

function resolveEntry(entry, match) {
  entry.status = 'resolved';
  entry.resolvedAt = new Date().toISOString();
  entry.actualHomeGoals = match.homeGoals;
  entry.actualAwayGoals = match.awayGoals;
  entry.actualWinnerSide = resultSide(match.homeGoals, match.awayGoals);
  entry.verdictCorrect = entry.actualWinnerSide === entry.verdictSide;
  entry.scorelineHitIndex = entry.topScorelines.findIndex(
    (s) => s.home === match.homeGoals && s.away === match.awayGoals
  );
}

// --- Lưu file JSON local (mặc định, khi chưa cấu hình Firestore) ---

function loadLogLocal() {
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

function saveLogLocal(log) {
  try {
    const dir = path.dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LOG_PATH, JSON.stringify(log, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Bảng sao kê] Lỗi ghi data/predictions-log.json:', err.message);
  }
}

function recordPredictionLocal(params) {
  const log = loadLogLocal();
  if (log.some((e) => e.id === params.id)) return;
  log.push(buildNewEntry(params));
  saveLogLocal(log);
}

function resolvePendingPredictionsLocal(currentSeasonMatches) {
  const log = loadLogLocal();
  let changed = false;

  for (const entry of log) {
    if (entry.status !== 'pending') continue;
    const match = findActualResult(currentSeasonMatches, entry);
    if (!match) continue;
    resolveEntry(entry, match);
    changed = true;
  }

  if (changed) saveLogLocal(log);
}

function getLogLocal() {
  return loadLogLocal()
    .slice()
    .sort((a, b) => new Date(b.commenceTime) - new Date(a.commenceTime));
}

// --- Firestore (khi đã cấu hình FIREBASE_SERVICE_ACCOUNT_BASE64) ---

async function recordPredictionFirestore(params) {
  const ref = getDb().collection(COLLECTION).doc(String(params.id));
  const snap = await ref.get();
  if (snap.exists) return; // Đã ghi "chốt kèo" cho trận này từ trước — giữ nguyên.
  await ref.set(buildNewEntry(params));
}

async function resolvePendingPredictionsFirestore(currentSeasonMatches) {
  const pendingSnap = await getDb().collection(COLLECTION).where('status', '==', 'pending').get();
  if (pendingSnap.empty) return;

  const batch = getDb().batch();
  let changed = false;

  pendingSnap.forEach((doc) => {
    const entry = doc.data();
    const match = findActualResult(currentSeasonMatches, entry);
    if (!match) return;
    resolveEntry(entry, match);
    batch.set(doc.ref, entry);
    changed = true;
  });

  if (changed) await batch.commit();
}

async function getLogFirestore() {
  const snapshot = await getDb().collection(COLLECTION).get();
  const log = [];
  snapshot.forEach((doc) => log.push(doc.data()));
  return log.sort((a, b) => new Date(b.commenceTime) - new Date(a.commenceTime));
}

// --- API dùng chung (server.js chỉ cần gọi các hàm này) ---

// Ghi lại 1 dự đoán mới — chỉ ghi 1 LẦN DUY NHẤT cho mỗi trận (theo `id`), để
// không bị "chốt kèo" đổi liên tục mỗi lần kèo/phong độ cập nhật trước giờ đấu
// (ghi đúng nhận định tại thời điểm trận ĐẦU TIÊN xuất hiện trong danh sách).
export async function recordPrediction({ id, homeTeam, awayTeam, commenceTime, verdict, topScorelines }) {
  if (!id || !verdict || !topScorelines?.length) return;
  const params = { id, homeTeam, awayTeam, commenceTime, verdict, topScorelines };

  if (isFirestoreEnabled()) {
    try {
      await recordPredictionFirestore(params);
      return;
    } catch (err) {
      console.error('[Bảng sao kê] Lỗi ghi Firestore, bỏ qua lần ghi này:', err.message);
      return;
    }
  }
  recordPredictionLocal(params);
}

// Đối chiếu mọi dự đoán đang "pending" với danh sách trận ĐÃ KẾT THÚC của mùa
// hiện tại (currentSeasonMatches, lấy từ football-data.org — xem src/server.js).
// Gọi hàm này mỗi lần /api/upcoming chạy (đã có sẵn currentSeasonMatches trong
// tay), không cần lịch chạy riêng.
export async function resolvePendingPredictions(currentSeasonMatches) {
  if (!currentSeasonMatches?.length) return;

  if (isFirestoreEnabled()) {
    try {
      await resolvePendingPredictionsFirestore(currentSeasonMatches);
      return;
    } catch (err) {
      console.error('[Bảng sao kê] Lỗi đối chiếu kết quả qua Firestore:', err.message);
      return;
    }
  }
  resolvePendingPredictionsLocal(currentSeasonMatches);
}

// Trả về toàn bộ sao kê, mới nhất trước — cho /api/predictions-log.
export async function getLog() {
  if (isFirestoreEnabled()) {
    try {
      return await getLogFirestore();
    } catch (err) {
      console.error('[Bảng sao kê] Lỗi đọc Firestore:', err.message);
      return [];
    }
  }
  return getLogLocal();
}

// Chỉ có ý nghĩa khi đang ở chế độ file JSON local (không dùng Firestore).
export function getLogFilePath() {
  return LOG_PATH;
}
