// Ước lượng "tỉ số có khả năng xảy ra cao nhất" bằng mô hình Poisson — cách
// thống kê phổ biến trong phân tích bóng đá: coi số bàn mỗi đội ghi được là 1
// biến ngẫu nhiên Poisson với giá trị kỳ vọng (lambda) suy ra từ phong độ ghi
// bàn/thủng lưới gần đây, rồi "nắn" lại kỳ vọng đó cho khớp với mức chấp của
// kèo châu Á (nếu có) — kết hợp cả 2 nguồn thông tin thay vì chỉ dùng 1.
//
// Đây vẫn là 1 PHÉP TÍNH THỐNG KÊ TƯỜNG MINH (không phải mô hình "đã học" như
// src/ml/predict.js) — mọi bước đều có thể giải thích được, phù hợp để hiển thị
// kèm lý do trong khung "Phân tích phong độ & đối đầu".

const MIN_LAMBDA = 0.25;
const MAX_LAMBDA = 4.5;
const MAX_GOALS_GRID = 6; // xét tỉ số từ 0-0 tới 6-6, đủ bao phủ > 97% xác suất thực tế

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function poissonPmf(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  // tính theo log để tránh tràn số với k lớn: log P = -lambda + k*ln(lambda) - ln(k!)
  let logFactorial = 0;
  for (let i = 2; i <= k; i++) logFactorial += Math.log(i);
  const logP = -lambda + k * Math.log(lambda) - logFactorial;
  return Math.exp(logP);
}

// homeHomeForm/awayAwayForm: kết quả từ features.mjs#computeForm (đã tự có
// giá trị mặc định hợp lý khi chưa đủ dữ liệu, không cần xử lý null ở đây).
// asianHandicap: { homePoint, ... } hoặc null nếu trận chưa có kèo châu Á.
export function projectScorelines({ homeHomeForm, awayAwayForm, asianHandicap }) {
  const statsLambdaHome = (homeHomeForm.gf + awayAwayForm.ga) / 2;
  const statsLambdaAway = (awayAwayForm.gf + homeHomeForm.ga) / 2;
  const statsMargin = statsLambdaHome - statsLambdaAway;
  const totalGoals = statsLambdaHome + statsLambdaAway;

  let lambdaHome = statsLambdaHome;
  let lambdaAway = statsLambdaAway;
  let marketMargin = null;

  if (asianHandicap && Number.isFinite(Number(asianHandicap.homePoint))) {
    // homePoint âm nghĩa là đội nhà được đánh giá cao hơn đúng bằng độ lớn đó
    // (vd -1.5 -> nhà được kỳ vọng thắng cách biệt ~1.5 bàn).
    marketMargin = -Number(asianHandicap.homePoint);
    const blendedMargin = 0.5 * statsMargin + 0.5 * marketMargin;
    lambdaHome = clamp((totalGoals + blendedMargin) / 2, MIN_LAMBDA, MAX_LAMBDA);
    lambdaAway = clamp((totalGoals - blendedMargin) / 2, MIN_LAMBDA, MAX_LAMBDA);
  } else {
    lambdaHome = clamp(lambdaHome, MIN_LAMBDA, MAX_LAMBDA);
    lambdaAway = clamp(lambdaAway, MIN_LAMBDA, MAX_LAMBDA);
  }

  // Lưới xác suất Poisson(home) x Poisson(away), độc lập — cách xấp xỉ chuẩn
  // trong các mô hình tỉ số bóng đá đơn giản (bỏ qua hiệu ứng tương quan nhỏ
  // giữa 2 đội mà các mô hình phức tạp hơn như Dixon-Coles mới tính tới).
  const grid = [];
  let gridTotal = 0;
  for (let h = 0; h <= MAX_GOALS_GRID; h++) {
    for (let a = 0; a <= MAX_GOALS_GRID; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      grid.push({ home: h, away: a, p });
      gridTotal += p;
    }
  }

  const normalized = grid.map((c) => ({ ...c, prob: c.p / gridTotal }));
  const topScorelines = normalized
    .slice()
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 3)
    .map((c) => ({ home: c.home, away: c.away, probabilityPct: Math.round(c.prob * 1000) / 10 }));

  let homeWinProb = 0;
  let drawProb = 0;
  let awayWinProb = 0;
  for (const c of normalized) {
    if (c.home > c.away) homeWinProb += c.prob;
    else if (c.home === c.away) drawProb += c.prob;
    else awayWinProb += c.prob;
  }

  return {
    lambdaHome,
    lambdaAway,
    marketMargin,
    statsMargin,
    topScorelines,
    homeWinProb: Math.round(homeWinProb * 100),
    drawProb: Math.round(drawProb * 100),
    awayWinProb: Math.round(awayWinProb * 100),
  };
}
