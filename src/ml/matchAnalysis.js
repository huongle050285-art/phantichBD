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

  return {
    available: true,
    homeTeam,
    awayTeam,
    homeRecent,
    awayRecent,
    h2h,
    favoriteTeam,
    topScorelines: projection.topScorelines,
    notes,
    hasCurrentSeasonData: homeRecent.length > 0 || awayRecent.length > 0 || h2h.length > 0,
  };
}
