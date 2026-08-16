// Nạp mô hình đã huấn luyện (data/model.json, tạo bởi scripts/train.mjs) lúc
// server khởi động, và tính dự đoán cho 1 trận sắp diễn ra dựa trên phong độ +
// đối đầu hiện tại (lấy từ football-data.org). Nếu chưa chạy `npm run train`
// (chưa có file model.json) thì mọi dự đoán trả về `available: false` thay vì
// làm sập server — tính năng "Dự đoán BD" (rule-based) vẫn hoạt động bình thường.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveTeamName } from './teamNameMap.js';
import { buildFeatureVector } from './features.mjs';
import { standardize, predictProbs } from './softmax.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.join(__dirname, '..', '..', 'data', 'model.json');

let cachedModel; // undefined = chưa thử nạp, null = đã thử nhưng không có file

function loadModel() {
  if (cachedModel !== undefined) return cachedModel;

  if (!existsSync(MODEL_PATH)) {
    console.warn(
      '[Dự đoán ML] Chưa thấy data/model.json — chạy "npm run train" 1 lần để tạo mô hình. ' +
        'Khối "Dự đoán ML" sẽ hiển thị "chưa có mô hình" cho tới khi đó.'
    );
    cachedModel = null;
    return cachedModel;
  }

  try {
    const raw = readFileSync(MODEL_PATH, 'utf-8');
    cachedModel = JSON.parse(raw);
    console.log(
      `[Dự đoán ML] Đã nạp mô hình (huấn luyện lúc ${cachedModel.trainedAt}, ` +
        `độ chính xác kiểm tra ${(cachedModel.metrics.valAcc * 100).toFixed(1)}%).`
    );
  } catch (err) {
    console.error('[Dự đoán ML] Lỗi đọc data/model.json:', err.message);
    cachedModel = null;
  }
  return cachedModel;
}

// matches: lịch sử trận đấu mùa hiện tại (đã chuẩn hoá tên đội), dùng để tính
// phong độ + đối đầu tại THỜI ĐIỂM DỰ ĐOÁN (không phải lúc huấn luyện).
export function predictMatch({ matches, homeTeamRaw, awayTeamRaw, matchTime }) {
  const model = loadModel();
  if (!model) {
    return { available: false, reason: 'Chưa có mô hình đã huấn luyện (chạy "npm run train" để tạo).' };
  }

  const homeTeam = resolveTeamName(homeTeamRaw);
  const awayTeam = resolveTeamName(awayTeamRaw);
  if (!homeTeam || !awayTeam) {
    return {
      available: false,
      reason: `Không xác định được tên đội (${homeTeamRaw} / ${awayTeamRaw}) để tra cứu phong độ.`,
    };
  }

  const { vector, meta } = buildFeatureVector({
    matches: matches || [],
    homeTeam,
    awayTeam,
    matchTime: matchTime ?? Date.now(),
  });

  const [xStd] = standardize([vector], model.mean, model.std);
  const [homeWinProb, drawProb, awayWinProb] = predictProbs(xStd, model.weights, model.bias);

  const cappedFormNote = (label, form) =>
    form.gamesCount === 0 ? `${label}: chưa có dữ liệu trận nào mùa này (dùng giá trị trung bình giải)` : null;

  return {
    available: true,
    homeWinProb: Math.round(homeWinProb * 100),
    drawProb: Math.round(drawProb * 100),
    awayWinProb: Math.round(awayWinProb * 100),
    modelMeta: {
      trainedAt: model.trainedAt,
      valAcc: model.metrics.valAcc,
      nTrain: model.metrics.nTotalFit,
    },
    coldStartNotes: [cappedFormNote(homeTeamRaw, meta.homeForm), cappedFormNote(awayTeamRaw, meta.awayForm)].filter(
      Boolean
    ),
  };
}
