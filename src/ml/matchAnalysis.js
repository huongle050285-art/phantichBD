// Khung "Phân tích phong độ & đối đầu" — hiển thị TRỰC TIẾP các số liệu thô
// (bàn thắng/thua từng trận gần đây, lịch sử đối đầu) cho người dùng tự xem,
// thay vì chỉ đưa ra 1 con số % như "Dự đoán BD"/"Dự đoán ML". Kết hợp thêm
// kèo châu Á (nếu có) để đưa ra 1 nhận định đội nào nhỉnh hơn + 3 tỉ số có khả
// năng xảy ra cao nhất (mô hình Poisson, xem src/ml/scoreProjection.mjs).
import { resolveTeamName } from './teamNameMap.js';
import { computeForm, getRecentMatchResults, getH2HMatches } from './features.mjs';
import { projectScorelines } from './scoreProjection.mjs';

function fmtPoint(p) {
  const n = Number(p);
  return n > 0 ? `+${n}` : `${n}`;
}

// "Chốt kèo" — 1 dòng ngắn gọn, nổi bật, đặt NGAY PHÍA TRÊN danh sách 3 tỉ số
// dự đoán, trả lời thẳng câu hỏi "đội nào sẽ thắng?" (hoặc "Hòa" nếu xác suất
// hòa cao nhất trong 3 khả năng) — khác với `favoriteTeam` ở buildVerdictNotes
// bên dưới (chỉ so sánh chủ/khách, bỏ qua khả năng hòa, dùng cho câu nhận định
// dài trong danh sách `notes`).
function computeVerdict({ homeTeam, awayTeam, homeWinProb, drawProb, awayWinProb }) {
  let side;
  if (homeWinProb >= drawProb && homeWinProb >= awayWinProb) side = 'home';
  else if (awayWinProb >= drawProb && awayWinProb >= homeWinProb) side = 'away';
  else side = 'draw';

  const team = side === 'home' ? homeTeam : side === 'away' ? awayTeam : null;
  const prob = side === 'home' ? homeWinProb : side === 'away' ? awayWinProb : drawProb;
  const label = side === 'draw' ? `Hòa (${prob}%)` : `${team} thắng (${prob}%)`;

  return { side, team, prob, label };
}

function buildVerdictNotes({ homeTeam, awayTeam, homeHomeForm, awayAwayForm, asianHandicap, homeWinProb, awayWinProb }) {
  const notes = [];

  notes.push(
    homeHomeForm.gamesCount > 0
      ? `${homeTeam} (sân nhà, ${homeHomeForm.gamesCount} trận gần nhất): ghi ${homeHomeForm.gf.toFixed(1)} · thủng ${homeHomeForm.ga.toFixed(1)} bàn/trận.`
      : `${homeTeam}: chưa có trận sân nhà nào mùa này — dùng mức trung bình giải để ước tính.`
  );
  notes.push(
    awayAwayForm.gamesCount > 0
      ? `${awayTeam} (sân khách, ${awayAwayForm.gamesCount} trận gần nhất): ghi ${awayAwayForm.gf.toFixed(1)} · thủng ${awayAwayForm.ga.toFixed(1)} bàn/trận.`
      : `${awayTeam}: chưa có trận sân khách nào mùa này — dùng mức trung bình giải để ước tính.`
  );

  if (asianHandicap && Number.isFinite(Number(asianHandicap.homePoint))) {
    notes.push(`Kèo châu Á hiện tại: chấp ${fmtPoint(asianHandicap.homePoint)} cho ${homeTeam}.`);
  }

  const diff = homeWinProb - awayWinProb;
  let favoriteTeam = null;
  if (Math.abs(diff) < 8) {
    notes.push('Kết hợp phong độ ghi/thủng bàn và kèo chấp (nếu có), 2 đội khá cân bằng — khó nghiêng hẳn về bên nào.');
  } else {
    favoriteTeam = diff > 0 ? homeTeam : awayTeam;
    const strength = Math.abs(diff) > 25 ? 'rõ rệt' : 'nhẹ';
    notes.push(`Kết hợp phong độ ghi/thủng bàn và kèo chấp (nếu có), ${favoriteTeam} được đánh giá nhỉnh hơn ${strength}.`);
  }

  return { notes, favoriteTeam };
}

export function buildMatchStatsPanel({ matches, homeTeamRaw, awayTeamRaw, matchTime, asianHandicap }) {
  const homeTeam = resolveTeamName(homeTeamRaw);
  const awayTeam = resolveTeamName(awayTeamRaw);
  if (!homeTeam || !awayTeam) {
    return { available: false, reason: `Không xác định được tên đội (${homeTeamRaw} / ${awayTeamRaw}).` };
  }

  const list = matches || [];
  const t = matchTime ?? Date.now();

  const homeRecent = getRecentMatchResults(list, homeTeam, t, 5);
  const awayRecent = getRecentMatchResults(list, awayTeam, t, 5);
  const h2h = getH2HMatches(list, homeTeam, awayTeam, t, 5);

  const homeHomeForm = computeForm(list, homeTeam, t, 'home', 5);
  const awayAwayForm = computeForm(list, awayTeam, t, 'away', 5);

  const projection = projectScorelines({ homeHomeForm, awayAwayForm, asianHandicap });

  const { notes, favoriteTeam } = buildVerdictNotes({
    homeTeam,
    awayTeam,
    homeHomeForm,
    awayAwayForm,
    asianHandicap,
    homeWinProb: projection.homeWinProb,
    awayWinProb: projection.awayWinProb,
  });

  const verdict = computeVerdict({
    homeTeam,
    awayTeam,
    homeWinProb: projection.homeWinProb,
    drawProb: projection.drawProb,
    awayWinProb: projection.awayWinProb,
  });

  return {
    available: true,
    homeTeam,
    awayTeam,
    homeRecent,
    awayRecent,
    h2h,
    favoriteTeam,
    // "Chốt kèo" — hiển thị nổi bật ngay phía trên 3 tỉ số dự đoán, và cũng là
    // giá trị được ghi vào "Bảng sao kê" (src/ml/predictionLog.js) để sau này
    // đối chiếu trúng/trật khi trận đấu có kết quả thật.
    verdict,
    topScorelines: projection.topScorelines,
    // % thắng/hòa/thua suy ra từ cùng mô hình Poisson dùng để chọn 3 tỉ số ở
    // trên — phơi ra riêng để src/ml/consensus.js có thể gộp với "Dự đoán ML"
    // thành 1 chỉ số đồng thuận, không cần tính lại.
    winDrawAway: { home: projection.homeWinProb, draw: projection.drawProb, away: projection.awayWinProb },
    notes,
    hasCurrentSeasonData: homeRecent.length > 0 || awayRecent.length > 0 || h2h.length > 0,
  };
}
