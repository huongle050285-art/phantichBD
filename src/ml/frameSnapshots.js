// "Chốt kèo theo khung" — khoá lại TOÀN BỘ nội dung hiển thị của 1 trận (kèo
// 1X2/châu Á/tài xỉu + cả 4 khối dự đoán: Dự đoán BD, Dự đoán ML, Phân tích
// phong độ & đối đầu, Đồng thuận) ngay LẦN ĐẦU TIÊN 1 "khung" (frame) xuất
// hiện, rồi không bao giờ tính lại/ghi đè nữa — ai xem trang vào bất kỳ lúc
// nào sau đó cũng thấy ĐÚNG những gì đã chốt ban đầu cho khung đó, không bị
// đổi theo biến động kèo/phong độ về sau.
//
// 2 khung hiện có:
//   - "full": chốt ngay lần đầu trận xuất hiện ở "Trận sắp diễn ra".
//   - "live": chốt ngay lần đầu phát hiện trận đã bắt đầu diễn ra (commence
//     time đã qua — The Odds API tự loại các trận đã đấu xong khỏi danh sách,
//     nên hễ trận còn xuất hiện mà đã quá giờ bóng lăn thì chắc chắn đang live).
//
// Khác với src/ml/predictionLog.js ("Bảng sao kê dự đoán" — chỉ lưu "chốt
// kèo" + 3 tỉ số để tính trúng/trật về sau): module này lưu TOÀN BỘ nội dung
// hiển thị của 1 khung, phục vụ việc hiển thị match card không đổi theo thời
// gian. 2 file lưu riêng biệt, không ảnh hưởng tới nhau.
//
// CẢNH BÁO (giống data/predictions-log.json): ổ đĩa Render free bị xoá sạch
// mỗi lần deploy code mới — nên data/frame-snapshots.json cũng cần tải về
// backup trước khi upload code mới, nếu không muốn các khung đã chốt bị tính
// lại từ đầu sau mỗi lần cập nhật.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'data', 'frame-snapshots.json');

function loadAll() {
  if (!existsSync(SNAPSHOT_PATH)) return {};
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error('[Chốt kèo theo khung] Lỗi đọc data/frame-snapshots.json:', err.message);
    return {};
  }
}

function saveAll(all) {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(all, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Chốt kèo theo khung] Lỗi ghi data/frame-snapshots.json:', err.message);
  }
}

function keyFor(id, frame) {
  return `${id}::${frame}`;
}

// Lấy snapshot đã chốt cho (id, frame), hoặc null nếu khung đó CHƯA từng chốt.
export function getSnapshot(id, frame) {
  const all = loadAll();
  return all[keyFor(id, frame)] || null;
}

// Chốt 1 snapshot MỚI — payload là { homeTeam, awayTeam, commenceTime, odds,
// asianHandicap, totals, prediction, analysis, mlPrediction, statsPanel,
// consensus }. Nếu (id, frame) đã từng chốt trước đó, giữ NGUYÊN bản gốc,
// không ghi đè (đây chính là cơ chế "chốt ngay từ đầu, không thay đổi").
export function recordSnapshot(id, frame, payload) {
  const all = loadAll();
  const key = keyFor(id, frame);
  if (all[key]) return all[key];

  const entry = { ...payload, frame, lockedAt: new Date().toISOString() };
  all[key] = entry;
  saveAll(all);
  return entry;
}

// Lấy snapshot đã chốt cho (id, frame) nếu có, hoặc chốt mới từ
// `computePayload()` (chỉ gọi hàm tính toán khi THỰC SỰ cần, để không tính
// toán thừa cho những khung đã chốt rồi).
export function getOrLockSnapshot(id, frame, computePayload) {
  const existing = getSnapshot(id, frame);
  if (existing) return existing;
  return recordSnapshot(id, frame, computePayload());
}

export function getSnapshotFilePath() {
  return SNAPSHOT_PATH;
}
