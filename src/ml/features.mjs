// Tính "đặc trưng" (features) cho 1 trận đấu, dùng CHUNG cho cả lúc huấn
// luyện (scripts/train.mjs, chạy trên dữ liệu lịch sử 2022-2024) và lúc dự
// đoán thật (src/ml/predict.js, src/ml/matchAnalysis.js — chạy trên dữ liệu
// mùa hiện tại từ football-data.org). Dùng chung 1 bộ hàm để tránh lệch logic
// giữa các nơi.
//
// Input `matches`: mảng các trận đã đấu xong, mỗi phần tử dạng
//   { date: 'YYYY-MM-DD' (hoặc ISO), homeTeam, awayTeam, homeGoals, awayGoals }
// homeTeam/awayTeam PHẢI là tên đã chuẩn hóa qua teamNameMap.resolveTeamName.

export const FEATURE_NAMES = [
  'homePpgL5',
  'awayPpgL5',
  'homeGdL5',
  'awayGdL5',
  'homeHomePpgL5',
  'awayAwayPpgL5',
  'homeGfL5',
  'homeGaL5',
  'awayGfL5',
  'awayGaL5',
  'h2hHomeWinRate',
  'h2hAvgGoalDiff',
];

// Giá trị trung bình toàn giải khi 1 đội chưa có đủ (hoặc chưa có) lịch sử —
// tránh trả về null/NaN khiến mô hình lỗi (vd đội mới lên hạng đầu mùa).
const LEAGUE_AVG_PPG = 1.35; // ~ trung bình điểm/trận của 1 đội tại Ngoại hạng Anh
const LEAGUE_AVG_GOALS = 1.4; // ~ trung bình bàn thắng/trận (tấn công hoặc phòng ngự)
const NEUTRAL_H2H_WIN_RATE = 0.45; // đối đầu chưa từng gặp -> nhỉnh hơn chút cho đội chủ nhà (lợi thế sân nhà)
const NEUTRAL_H2H_GOAL_DIFF = 0;

function toTime(d) {
  return new Date(d).getTime();
}

function pointsFor(teamGoals, oppGoals) {
  if (teamGoals > oppGoals) return 3;
  if (teamGoals === oppGoals) return 1;
  return 0;
}

function resultLetter(teamGoals, oppGoals) {
  if (teamGoals > oppGoals) return 'W';
  if (teamGoals === oppGoals) return 'D';
  return 'L';
}

// Lấy tối đa N trận GẦN NHẤT của 1 đội, trước 1 thời điểm cho trước, tính theo
// mọi sân (nếu venueFilter = null) hoặc chỉ sân nhà/sân khách.
function recentMatchesForTeam(matches, team, beforeTime, venueFilter, limit) {
  const relevant = [];
  for (const m of matches) {
    const t = toTime(m.date);
    if (!(t < beforeTime)) continue;
    const isHome = m.homeTeam === team;
    const isAway = m.awayTeam === team;
    if (!isHome && !isAway) continue;
    if (venueFilter === 'home' && !isHome) continue;
    if (venueFilter === 'away' && !isAway) continue;
    relevant.push({ ...m, _time: t, _isHome: isHome });
  }
  relevant.sort((a, b) => b._time - a._time); // gần nhất trước
  return relevant.slice(0, limit);
}

// Phong độ 1 đội: điểm/trận trung bình + hiệu số + số bàn ghi/thủng trung bình,
// tính trên tối đa `limit` trận gần nhất (mọi sân, hoặc lọc theo sân nếu có venueFilter).
export function computeForm(matches, team, beforeTime, venueFilter = null, limit = 5) {
  const recent = recentMatchesForTeam(matches, team, beforeTime, venueFilter, limit);
  if (recent.length === 0) {
    return { ppg: LEAGUE_AVG_PPG, gf: LEAGUE_AVG_GOALS, ga: LEAGUE_AVG_GOALS, gd: 0, gamesCount: 0 };
  }

  let points = 0;
  let gf = 0;
  let ga = 0;
  for (const m of recent) {
    const teamGoals = m._isHome ? m.homeGoals : m.awayGoals;
    const oppGoals = m._isHome ? m.awayGoals : m.homeGoals;
    points += pointsFor(teamGoals, oppGoals);
    gf += teamGoals;
    ga += oppGoals;
  }
  const n = recent.length;
  return {
    ppg: points / n,
    gf: gf / n,
    ga: ga / n,
    gd: (gf - ga) / n,
    gamesCount: n,
  };
}

// Chi tiết từng trận gần nhất của 1 đội (để HIỂN THỊ ra giao diện — khác với
// computeForm ở trên vốn chỉ trả về số liệu TỔNG HỢP). Mỗi phần tử:
// { date, opponent, venue: 'home'|'away', goalsFor, goalsAgainst, result: 'W'|'D'|'L' }
export function getRecentMatchResults(matches, team, beforeTime, limit = 5) {
  const recent = recentMatchesForTeam(matches, team, beforeTime, null, limit);
  return recent.map((m) => {
    const goalsFor = m._isHome ? m.homeGoals : m.awayGoals;
    const goalsAgainst = m._isHome ? m.awayGoals : m.homeGoals;
    return {
      date: m.date,
      opponent: m._isHome ? m.awayTeam : m.homeTeam,
      venue: m._isHome ? 'home' : 'away',
      goalsFor,
      goalsAgainst,
      result: resultLetter(goalsFor, goalsAgainst),
    };
  });
}

function recentH2HMatches(matches, teamA, teamB, beforeTime, limit) {
  const relevant = [];
  for (const m of matches) {
    const t = toTime(m.date);
    if (!(t < beforeTime)) continue;
    const isPair =
      (m.homeTeam === teamA && m.awayTeam === teamB) || (m.homeTeam === teamB && m.awayTeam === teamA);
    if (!isPair) continue;
    relevant.push({ ...m, _time: t });
  }
  relevant.sort((a, b) => b._time - a._time);
  return relevant.slice(0, limit);
}

// Danh sách chi tiết các lần đối đầu gần nhất giữa 2 đội cụ thể — để HIỂN THỊ
// (vd "20/03/2026: Arsenal 2-1 Chelsea"). Giữ nguyên chiều sân nhà/khách lúc
// trận đó diễn ra (khác với computeH2H bên dưới, vốn quy đổi góc nhìn).
export function getH2HMatches(matches, teamA, teamB, beforeTime, limit = 5) {
  return recentH2HMatches(matches, teamA, teamB, beforeTime, limit).map((m) => ({
    date: m.date,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeGoals: m.homeGoals,
    awayGoals: m.awayGoals,
  }));
}

// Thành tích đối đầu giữa 2 đội cụ thể (không phân biệt ai đá sân nhà lúc đối
// đầu trước đó), tính trên tối đa `limit` lần gặp gần nhất.
export function computeH2H(matches, homeTeam, awayTeam, beforeTime, limit = 5) {
  const recent = recentH2HMatches(matches, homeTeam, awayTeam, beforeTime, limit);

  if (recent.length === 0) {
    return { homeWinRate: NEUTRAL_H2H_WIN_RATE, avgGoalDiff: NEUTRAL_H2H_GOAL_DIFF, gamesCount: 0 };
  }

  let homeWins = 0;
  let goalDiffSum = 0; // luôn quy đổi về góc nhìn của `homeTeam` (đội đá sân nhà ở TRẬN ĐANG XÉT)
  for (const m of recent) {
    const homeTeamWasHome = m.homeTeam === homeTeam;
    const homeTeamGoals = homeTeamWasHome ? m.homeGoals : m.awayGoals;
    const awayTeamGoals = homeTeamWasHome ? m.awayGoals : m.homeGoals;
    if (homeTeamGoals > awayTeamGoals) homeWins += 1;
    goalDiffSum += homeTeamGoals - awayTeamGoals;
  }
  const n = recent.length;
  return {
    homeWinRate: homeWins / n,
    avgGoalDiff: goalDiffSum / n,
    gamesCount: n,
  };
}

// Ghép tất cả lại thành 1 vector đặc trưng (đúng thứ tự FEATURE_NAMES) cho 1
// trận `homeTeam` (sân nhà) gặp `awayTeam` (sân khách), diễn ra tại `matchTime`.
export function buildFeatureVector({ matches, homeTeam, awayTeam, matchTime }) {
  const homeForm = computeForm(matches, homeTeam, matchTime, null, 5);
  const awayForm = computeForm(matches, awayTeam, matchTime, null, 5);
  const homeHomeForm = computeForm(matches, homeTeam, matchTime, 'home', 5);
  const awayAwayForm = computeForm(matches, awayTeam, matchTime, 'away', 5);
  const h2h = computeH2H(matches, homeTeam, awayTeam, matchTime, 5);

  const vector = [
    homeForm.ppg,
    awayForm.ppg,
    homeForm.gd,
    awayForm.gd,
    homeHomeForm.ppg,
    awayAwayForm.ppg,
    homeForm.gf,
    homeForm.ga,
    awayForm.gf,
    awayForm.ga,
    h2h.homeWinRate,
    h2h.avgGoalDiff,
  ];

  return {
    vector,
    meta: { homeForm, awayForm, homeHomeForm, awayAwayForm, h2h },
  };
}
