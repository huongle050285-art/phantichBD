// "Chốt kèo theo khung" — mỗi trận có 1 khung "full" (cả trận, chốt ngay lần
// đầu trận xuất hiện) và tuỳ lúc 1 khung "live" (chốt ngay lần đầu phát hiện
// trận đã bắt đầu). Một khi đã chốt, dữ liệu KHÔNG BAO GIỜ bị tính lại hay
// ghi đè — đây là nguyên tắc cốt lõi của tính năng này.
//
// Có 2 nơi lưu trữ, chọn tự động theo cấu hình:
// 1) Firebase Firestore (nếu đã cấu hình FIREBASE_SERVICE_ACCOUNT_BASE64) —
//    bền vững, không bị xoá khi Render deploy lại code. Nên dùng khi đã
//    chuyển sang Firebase (xem README.md).
// 2) File data/frame-snapshots.json (mặc định, khi chưa cấu hình Firebase) —
//    CẢNH BÁO: ổ đĩa Render free bị xoá mỗi lần deploy, cần tự bấm "Tải về
//    dữ liệu các khung đã chốt" ở footer để backup trước khi cập nhật code.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isFirestoreEnabled, getDb } from '../firestoreDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'data', 'frame-snapshots.json');
const COLLECTION = 'frameSnapshots';

function keyFor(id, frame) {
  return `${id}::${frame}`;
}

// --- Lưu file JSON local (mặc định, khi chưa cấu hình Firestore) ---

function loadAllLocal() {
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

function saveAllLocal(all) {
  try {
    const dir = path.dirname(SNAPSHOT_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(all, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Chốt kèo theo khung] Lỗi ghi data/frame-snapshots.json:', err.message);
  }
}

function getOrLockSnapshotLocal(id, frame, computePayload) {
  const all = loadAllLocal();
  const key = keyFor(id, frame);
  if (all[key]) return all[key];

  const entry = { ...computePayload(), frame, lockedAt: new Date().toISOString() };
  all[key] = entry;
  saveAllLocal(all);
  return entry;
}

function getAllLocal() {
  return loadAllLocal();
}

// --- Firestore (khi đã cấu hình FIREBASE_SERVICE_ACCOUNT_BASE64) ---

async function getOrLockSnapshotFirestore(id, frame, computePayload) {
  const key = keyFor(id, frame);
  const ref = getDb().collection(COLLECTION).doc(key);
  const snap = await ref.get();
  if (snap.exists) return snap.data();

  const entry = { ...computePayload(), frame, lockedAt: new Date().toISOString() };
  await ref.set(entry);
  return entry;
}

async function getAllFirestore() {
  const snapshot = await getDb().collection(COLLECTION).get();
  const all = {};
  snapshot.forEach((doc) => {
    all[doc.id] = doc.data();
  });
  return all;
}

// --- API dùng chung (server.js chỉ cần gọi các hàm này) ---

// Trả về khung đã chốt nếu đã có, hoặc tính mới (gọi computePayload()) rồi
// chốt luôn lần đầu tiên. Lần gọi sau với cùng (id, frame) LUÔN trả về đúng
// dữ liệu đã chốt lần đầu, không gọi lại computePayload().
//
// Nếu đã cấu hình Firestore nhưng xảy ra lỗi khi đọc/ghi (mất mạng, sai
// quyền,...), hàm KHÔNG tự chuyển sang file JSON local (để tránh 1 khung bị
// chốt rải rác ở 2 nơi khác nhau) — thay vào đó trả về dữ liệu tính tạm cho
// lần gọi này (không lưu lại), và log lỗi để kiểm tra. Lần gọi kế tiếp (khi
// Firestore hoạt động lại) sẽ chốt đúng như bình thường.
export async function getOrLockSnapshot(id, frame, computePayload) {
  if (isFirestoreEnabled()) {
    try {
      return await getOrLockSnapshotFirestore(id, frame, computePayload);
    } catch (err) {
      console.error('[Chốt kèo theo khung] Lỗi Firestore, tạm tính (không lưu) cho lần này:', err.message);
      return { ...computePayload(), frame, lockedAt: new Date().toISOString(), unsaved: true };
    }
  }
  return getOrLockSnapshotLocal(id, frame, computePayload);
}

// Trả về TOÀN BỘ các khung đã chốt — dùng cho endpoint backup/download.
export async function getAllSnapshots() {
  if (isFirestoreEnabled()) {
    try {
      return await getAllFirestore();
    } catch (err) {
      console.error('[Chốt kèo theo khung] Lỗi đọc Firestore:', err.message);
      return {};
    }
  }
  return getAllLocal();
}

// Chỉ có ý nghĩa khi đang ở chế độ file JSON local (không dùng Firestore).
export function getSnapshotFilePath() {
  return SNAPSHOT_PATH;
}
