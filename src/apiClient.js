import 'dotenv/config';

const BASE_URL = 'https://v3.football.api-sports.io';

const API_KEY = process.env.API_FOOTBALL_KEY;

if (!API_KEY || API_KEY === 'dan_key_cua_ban_o_day') {
  console.error(
    '[Lỗi cấu hình] Chưa thấy API_FOOTBALL_KEY hợp lệ.\n' +
      '  1. Copy file .env.example thành .env\n' +
      '  2. Dán API key miễn phí của bạn (lấy tại https://dashboard.api-football.com) vào biến API_FOOTBALL_KEY\n'
  );
  process.exit(1);
}

/**
 * Gọi một endpoint của API-Football (v3).
 * @param {string} path - ví dụ: "/fixtures", "/odds", "/predictions"
 * @param {Record<string, string|number>} params - query params
 * @returns {Promise<any>} phần "response" trong JSON trả về
 */
export async function callApiFootball(path, params = {}) {
  const url = new URL(BASE_URL + path);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  const res = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API-Football trả về lỗi HTTP ${res.status}: ${text}`);
  }

  const json = await res.json();

  // API-Football trả về lỗi logic (vd: hết quota, sai tham số) trong field "errors"
  // dù HTTP status vẫn là 200.
  if (json.errors && Object.keys(json.errors).length > 0) {
    console.warn('[API-Football cảnh báo/lỗi]', JSON.stringify(json.errors));
  }

  console.log(
    `[API-Football] ${path} -> ${json.results ?? 0} kết quả | ` +
      `còn lại ${json.paging?.current ?? '-'}/${json.paging?.total ?? '-'} trang | ` +
      `quota: request hôm nay ${res.headers.get('x-ratelimit-requests-remaining') ?? '?'} còn lại`
  );

  return json.response;
}
