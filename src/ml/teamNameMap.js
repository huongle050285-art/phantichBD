// Mỗi nguồn dữ liệu (API-Football, The Odds API, football-data.org) có thể
// gọi tên 1 đội hơi khác nhau (vd "Man City" / "Manchester City" / "Manchester
// City FC"). Thay vì lập 1 bảng ánh xạ CỨNG cho từng nguồn (dễ sai lệch vì
// mình không gọi được API thật để kiểm tra chuỗi chính xác), module này CHUẨN
// HÓA tên đội (bỏ dấu, bỏ FC/AFC, bỏ dấu câu...) rồi so khớp với danh sách 20
// đội Ngoại hạng Anh hiện tại + 1 bảng biệt danh phổ biến. Cách này chịu được
// sai khác nhỏ về cách viết tên giữa các nguồn.
//
// LƯU Ý BẢO TRÌ: danh sách 20 đội thay đổi mỗi mùa (đội lên hạng/xuống hạng).
// Cập nhật mảng CURRENT_PL_CLUBS bên dưới vào đầu mỗi mùa giải mới.
export const CURRENT_PL_CLUBS = [
  'Arsenal',
  'Aston Villa',
  'Bournemouth',
  'Brentford',
  'Brighton and Hove Albion',
  'Chelsea',
  'Coventry City',
  'Crystal Palace',
  'Everton',
  'Fulham',
  'Hull City',
  'Ipswich Town',
  'Leeds United',
  'Liverpool',
  'Manchester City',
  'Manchester United',
  'Newcastle United',
  'Nottingham Forest',
  'Sunderland',
  'Tottenham Hotspur',
];

// Biệt danh / cách viết tắt phổ biến -> tên chuẩn. Giữ cả các đội không còn ở
// Ngoại hạng Anh mùa này (vd Wolves, West Ham) để bảng ánh xạ vẫn hoạt động
// đúng khi dùng cho DỮ LIỆU LỊCH SỬ (huấn luyện mô hình từ mùa 2022-2024).
const ALIASES = {
  'man city': 'Manchester City',
  'manchester city fc': 'Manchester City',
  'man utd': 'Manchester United',
  'man united': 'Manchester United',
  'manchester united fc': 'Manchester United',
  spurs: 'Tottenham Hotspur',
  tottenham: 'Tottenham Hotspur',
  brighton: 'Brighton and Hove Albion',
  'brighton hove albion': 'Brighton and Hove Albion',
  'brighton & hove albion': 'Brighton and Hove Albion',
  wolves: 'Wolverhampton Wanderers',
  'nottm forest': 'Nottingham Forest',
  "nott'm forest": 'Nottingham Forest',
  forest: 'Nottingham Forest',
  newcastle: 'Newcastle United',
  leeds: 'Leeds United',
  'west brom': 'West Bromwich Albion',
  'west bromwich albion': 'West Bromwich Albion',
  'sheffield utd': 'Sheffield United',
  'sheffield united': 'Sheffield United',
  'west ham': 'West Ham United',
  leicester: 'Leicester City',
  norwich: 'Norwich City',
  southampton: 'Southampton',
  ipswich: 'Ipswich Town',
  hull: 'Hull City',
  coventry: 'Coventry City',
  sunderland: 'Sunderland',
};

// Danh sách "toàn bộ đội từng/đang ở Ngoại hạng Anh" dùng để so khớp — gồm 20
// đội hiện tại + các đội xuất hiện trong dữ liệu lịch sử 2022-2024 (để khớp
// tên lúc huấn luyện mô hình).
const ALL_KNOWN_CLUBS = Array.from(
  new Set([
    ...CURRENT_PL_CLUBS,
    'Wolverhampton Wanderers',
    'West Ham United',
    'Leicester City',
    'Southampton',
    'Norwich City',
    'Burnley',
    'West Bromwich Albion',
    'Sheffield United',
    'Watford',
  ])
);

function stripDiacritics(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeTeamName(raw) {
  if (!raw) return '';
  let s = stripDiacritics(String(raw)).toLowerCase();
  s = s.replace(/&/g, 'and');
  s = s.replace(/\b(fc|afc|cf)\b/g, ''); // bỏ hậu tố câu lạc bộ
  s = s.replace(/['.]/g, ''); // bỏ dấu nháy đơn, dấu chấm
  s = s.replace(/[^a-z0-9\s]/g, ' '); // bỏ ký tự lạ còn sót
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const NORMALIZED_CLUB_LOOKUP = new Map(ALL_KNOWN_CLUBS.map((c) => [normalizeTeamName(c), c]));
const NORMALIZED_ALIASES = new Map(Object.entries(ALIASES).map(([k, v]) => [normalizeTeamName(k), v]));

// Trả về tên chuẩn (canonical) khớp với 1 chuỗi tên đội bất kỳ từ API nào, hoặc
// null nếu không khớp được đội nào (caller nên xử lý như "không xác định").
export function resolveTeamName(raw) {
  const norm = normalizeTeamName(raw);
  if (!norm) return null;

  if (NORMALIZED_CLUB_LOOKUP.has(norm)) return NORMALIZED_CLUB_LOOKUP.get(norm);
  if (NORMALIZED_ALIASES.has(norm)) return NORMALIZED_ALIASES.get(norm);

  // So khớp gần đúng: tên chuẩn có chứa trọn cụm từ đang tìm hoặc ngược lại
  // (vd "brighton" nằm trong "brighton and hove albion").
  for (const [normClub, canonical] of NORMALIZED_CLUB_LOOKUP.entries()) {
    if (normClub.includes(norm) || norm.includes(normClub)) return canonical;
  }
  for (const [normAlias, canonical] of NORMALIZED_ALIASES.entries()) {
    if (normAlias.includes(norm) || norm.includes(normAlias)) return canonical;
  }

  return null;
}
