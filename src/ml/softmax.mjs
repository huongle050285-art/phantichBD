// Hồi quy logistic đa lớp (softmax regression) — mô hình "học máy" nhẹ nhất
// có thể để phân loại 3 lớp (Chủ thắng / Hòa / Khách thắng) từ các đặc trưng
// đã tính trong features.mjs. Viết thuần JS, không cần thư viện AI nặng, để
// chạy nhanh và không cần cài đặt gì thêm trên server (kể cả Render free).
//
// Đây KHÔNG phải mạng nơ-ron / deep learning — là 1 mô hình tuyến tính đơn
// giản nhưng được HUẤN LUYỆN THẬT trên dữ liệu lịch sử (gradient descent tối
// thiểu hoá sai số giữa dự đoán và kết quả thật), khác hẳn công thức tính tay
// (implied probability) đang dùng ở "Dự đoán BD".

export function standardize(X, mean, std) {
  return X.map((row) => row.map((v, i) => (v - mean[i]) / (std[i] || 1)));
}

export function computeMeanStd(X) {
  const n = X.length;
  const dim = X[0].length;
  const mean = new Array(dim).fill(0);
  for (const row of X) for (let i = 0; i < dim; i++) mean[i] += row[i] / n;

  const std = new Array(dim).fill(0);
  for (const row of X) for (let i = 0; i < dim; i++) std[i] += (row[i] - mean[i]) ** 2 / n;
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i]) || 1;

  return { mean, std };
}

function softmaxRow(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

// Dự đoán xác suất 3 lớp [Home, Draw, Away] cho 1 hàng đặc trưng ĐÃ chuẩn hoá.
export function predictProbs(xRow, weights, bias) {
  const logits = weights.map((w, k) => w.reduce((s, wj, j) => s + wj * xRow[j], bias[k]));
  return softmaxRow(logits);
}

// X: mảng các hàng đặc trưng ĐÃ chuẩn hoá (standardize). Y: mảng nhãn one-hot
// [1,0,0] cho Home / [0,1,0] Draw / [0,0,1] Away. Trả về { weights, bias, history }.
export function trainSoftmax(X, Y, { epochs = 500, lr = 0.1, lambda = 0.01 } = {}) {
  const n = X.length;
  const dim = X[0].length;
  const K = 3;

  let weights = Array.from({ length: K }, () => new Array(dim).fill(0));
  let bias = new Array(K).fill(0);

  const history = [];

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = Array.from({ length: K }, () => new Array(dim).fill(0));
    const gradB = new Array(K).fill(0);
    let lossSum = 0;

    for (let i = 0; i < n; i++) {
      const probs = predictProbs(X[i], weights, bias);
      for (let k = 0; k < K; k++) {
        const err = probs[k] - Y[i][k]; // d(loss)/d(logit_k)
        gradB[k] += err / n;
        for (let j = 0; j < dim; j++) gradW[k][j] += (err * X[i][j]) / n;
      }
      // cross-entropy chỉ tính trên lớp đúng (Y[i][k]=1)
      const trueClass = Y[i].indexOf(1);
      lossSum += -Math.log(Math.max(probs[trueClass], 1e-12));
    }

    // L2 regularization (không phạt bias)
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < dim; j++) gradW[k][j] += lambda * weights[k][j];
    }

    for (let k = 0; k < K; k++) {
      bias[k] -= lr * gradB[k];
      for (let j = 0; j < dim; j++) weights[k][j] -= lr * gradW[k][j];
    }

    if (epoch % 50 === 0 || epoch === epochs - 1) {
      history.push({ epoch, trainLogLoss: lossSum / n });
    }
  }

  return { weights, bias, history };
}

export function evaluate(X, Y, weights, bias) {
  let correct = 0;
  let logLossSum = 0;
  for (let i = 0; i < X.length; i++) {
    const probs = predictProbs(X[i], weights, bias);
    const predicted = probs.indexOf(Math.max(...probs));
    const trueClass = Y[i].indexOf(1);
    if (predicted === trueClass) correct += 1;
    logLossSum += -Math.log(Math.max(probs[trueClass], 1e-12));
  }
  return { accuracy: correct / X.length, logLoss: logLossSum / X.length };
}
