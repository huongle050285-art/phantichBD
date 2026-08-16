import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { callApiFootball } from './apiClient.js';

const LEAGUE_ID = process.env.LEAGUE_ID || 39; // 39 = Premier League
const SEASON = process.env.SEASON || 2023;

/**
 * Endpoint /odds trả về theo trang (paging), mỗi trang tối đa ~10 trận.
 * Hàm này tự động lặp qua các trang cho tới khi lấy hết.
 * LƯU Ý: gói free API-Football giới hạn 100 request/ngày, nên nếu 1 mùa giải
 * có nhiều trang, hãy cân nhắc giới hạn MAX_PAGES bên dưới để tiết kiệm quota.
 */
async function fetchAllOddsPages() {
  const MAX_PAGES = Number(process.env.MAX_ODDS_PAGES || 5); // chỉnh lại nếu cần
  let page = 1;
  let allOdds = [];

  while (page <= MAX_PAGES) {
    const url = new URL('https://v3.football.api-sports.io/odds');
    const params = { league: LEAGUE_ID, season: SEASON, page };

    // dùng callApiFootball nhưng cần biết tổng số trang -> gọi trực tiếp 1 lần rồi lặp
    const res = await fetch(
      `${url.origin}${url.pathname}?league=${LEAGUE_ID}&season=${SEASON}&page=${page}`,
      { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } }
    );
    const json = await res.json();

    if (json.errors && Object.keys(json.errors).length > 0) {
      console.warn('[Cảnh báo /odds]', JSON.stringify(json.errors));
    }

    allOdds = allOdds.concat(json.response || []);
    console.log(
      `Trang ${json.paging?.current}/${json.paging?.total} - lấy được ${json.response?.length || 0} bản ghi odds`
    );

    if (!json.paging || json.paging.current >= json.paging.total) break;
    page += 1;
  }

  return allOdds;
}

async function main() {
  console.log(`Đang lấy tỉ lệ kèo (odds) Premier League mùa ${SEASON}...`);

  const odds = await fetchAllOddsPages();

  await writeFile(
    new URL('../data/odds.json', import.meta.url),
    JSON.stringify(odds, null, 2)
  );

  console.log(`Đã lưu ${odds.length} bản ghi odds vào data/odds.json`);
}

main().catch((err) => {
  console.error('Lỗi khi lấy odds:', err.message);
  process.exit(1);
});
