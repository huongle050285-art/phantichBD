// Kết nối (tuỳ chọn) tới Firebase Firestore — dùng để lưu "Bảng sao kê dự
// đoán" và "Chốt kèo theo khung" ở một nơi KHÔNG bị xoá mỗi lần Render deploy
// lại code (khác với file JSON trong thư mục data/, vốn sống trên ổ đĩa tạm
// của Render free tier).
//
// Module này CHỦ ĐỘNG không bắt buộc — nếu không cấu hình biến môi trường
// FIREBASE_SERVICE_ACCOUNT_BASE64, isFirestoreEnabled() trả về false và 2
// module gọi module này (predictionLog.js, frameSnapshots.js) sẽ tự quay về
// lưu file JSON local như trước giờ. Nhờ vậy app vẫn chạy được bình thường
// khi chưa thiết lập Firebase (vd lúc mới tải code về chạy thử ở máy riêng).
//
// Cách lấy giá trị cho FIREBASE_SERVICE_ACCOUNT_BASE64: xem hướng dẫn trong
// README.md (mục "Lưu dữ liệu bền vững bằng Firebase Firestore").
// Dùng đúng các "subpath export" hiện đại của firebase-admin v14 (modular
// API) — import mặc định "import admin from 'firebase-admin'" rồi gọi
// admin.credential.cert()/admin.firestore() theo kiểu cũ KHÔNG hoạt động ở
// bản này (đã xác nhận bằng cách chạy thử trực tiếp): admin.credential là
// undefined, và admin.firestore không phải 1 function.
import { initializeApp, cert } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';

let app = null;
let db = null;
let initTried = false;
let initErrorMessage = null;

function init() {
  if (initTried) return;
  initTried = true;

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) return; // Chưa cấu hình — giữ db = null, coi như "tắt" Firestore.

  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(json);
    app = initializeApp({
      credential: cert(serviceAccount),
    });
    // preferRest: true — dùng HTTPS/REST thay vì gRPC mặc định. Quan trọng
    // trên môi trường container/mạng bị giới hạn (vd Render free, hoặc môi
    // trường có proxy) vì lỗi kết nối gRPC đôi khi thoát ra ngoài dạng lỗi
    // socket cấp thấp (không phải Promise reject bình thường), có thể làm
    // sập cả tiến trình Node nếu không bắt đúng cách. REST tránh được vấn đề
    // này — lỗi mạng sẽ trả về đúng dạng Promise reject, bắt được bằng
    // try/catch như code trong predictionLog.js/frameSnapshots.js.
    db = initializeFirestore(app, { preferRest: true });
    console.log('[Firestore] Đã kết nối Firebase Firestore — dữ liệu sẽ lưu bền vững, không cần backup tay nữa.');
  } catch (err) {
    initErrorMessage = err.message;
    console.error(
      '[Firestore] Lỗi đọc FIREBASE_SERVICE_ACCOUNT_BASE64, sẽ dùng file JSON local thay thế:',
      err.message
    );
  }
}

// true = Firestore đã cấu hình và kết nối thành công, các module khác nên
// dùng Firestore. false = chưa cấu hình (hoặc lỗi) — dùng file JSON local.
export function isFirestoreEnabled() {
  init();
  return !!db;
}

export function getDb() {
  init();
  return db;
}

export function getFirestoreInitError() {
  init();
  return initErrorMessage;
}

export function getFirebaseApp() {
  init();
  return app;
}
