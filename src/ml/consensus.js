// Gộp "Dự đoán ML" (mô hình hồi quy logistic đã huấn luyện) và "Phân tích
// phong độ & đối đầu" (thống kê Poisson, có thêm kèo chấp châu Á) thành 1 chỉ
// số đồng thuận — KHÔNG huấn luyện lại gì cả, chỉ kết hợp 2 đầu ra xác suất đã
// tính sẵn. Đây là kỹ thuật "ensemble" cơ bản trong ML/thống kê: trung bình
// cộng của 2 ước lượng độc lập thường đáng tin hơn chỉ dùng 1 ước lượng, và
// mức độ 2 nguồn ĐỒNG Ý hay TRÁI CHIỀU với nhau tự nó cũng là 1 thông tin hữu
// ích (2 nguồn trái chiều -> nên thận trọng hơn khi tham khảo).

function favoriteOf(home, draw, away) {
  if (home >= draw && home >= away) return 'home';
  if (away >= draw && away >= home) return 'away';
  return 'draw';
}

export function buildConsensus({ mlPrediction, statsPanel, homeTeam, awayTeam }) {
  const mlOk = mlPrediction?.available;
  const statsOk = statsPanel?.available && statsPanel.winDrawAway;

  if (!mlOk && !statsOk) {
    return { available: false, reason: 'Chưa có đủ dữ liệu từ cả "Dự đoán ML" lẫn "Phân tích phong độ & đối đầu".' };
  }

  if (mlOk && !statsOk) {
    return {
      available: true,
      source: 'ml-only',
      homeWinProb: mlPrediction.homeWinProb,
      drawProb: mlPrediction.drawProb,
      awayWinProb: mlPrediction.awayWinProb,
      note: 'Chỉ dựa trên "Dự đoán ML" — "Phân tích phong độ & đối đầu" chưa đủ dữ liệu cho trận này.',
    };
  }

  if (!mlOk && statsOk) {
    return {
      available: true,
      source: 'stats-only',
      homeWinProb: statsPanel.winDrawAway.home,
      drawProb: statsPanel.winDrawAway.draw,
      awayWinProb: statsPanel.winDrawAway.away,
      note: 'Chỉ dựa trên "Phân tích phong độ & đối đầu" — "Dự đoán ML" chưa có mô hình (chạy "npm run train"?).',
    };
  }

  // Cả 2 nguồn đều có -> trung bình cộng đơn giản, minh bạch, dễ giải thích.
  const homeWinProb = Math.round((mlPrediction.homeWinProb + statsPanel.winDrawAway.home) / 2);
  const drawProb = Math.round((mlPrediction.drawProb + statsPanel.winDrawAway.draw) / 2);
  const awayWinProb = Math.round((mlPrediction.awayWinProb + statsPanel.winDrawAway.away) / 2);

  const mlFavorite = favoriteOf(mlPrediction.homeWinProb, mlPrediction.drawProb, mlPrediction.awayWinProb);
  const statsFavorite = favoriteOf(statsPanel.winDrawAway.home, statsPanel.winDrawAway.draw, statsPanel.winDrawAway.away);
  const agree = mlFavorite === statsFavorite;

  const maxGap = Math.max(
    Math.abs(mlPrediction.homeWinProb - statsPanel.winDrawAway.home),
    Math.abs(mlPrediction.awayWinProb - statsPanel.winDrawAway.away)
  );

  let agreement;
  let note;
  const sideLabel = { home: homeTeam, away: awayTeam, draw: 'Hòa' };
  if (agree && maxGap < 15) {
    agreement = 'strong-agree';
    note = `Cả "Dự đoán ML" và "Phân tích phong độ & đối đầu" đều nghiêng về ${sideLabel[mlFavorite]} — 2 góc nhìn khá thống nhất.`;
  } else if (agree) {
    agreement = 'agree';
    note = `Cả 2 nguồn đều nghiêng về ${sideLabel[mlFavorite]}, nhưng mức độ chênh lệch khá khác nhau giữa 2 cách tính.`;
  } else {
    agreement = 'disagree';
    note = `"Dự đoán ML" nghiêng về ${sideLabel[mlFavorite]}, trong khi "Phân tích phong độ & đối đầu" lại nghiêng về ${sideLabel[statsFavorite]} — 2 nguồn trái chiều, nên tham khảo thận trọng hơn.`;
  }

  return {
    available: true,
    source: 'both',
    homeWinProb,
    drawProb,
    awayWinProb,
    agreement,
    note,
  };
}
