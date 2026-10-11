import { writeFileSync, mkdirSync } from 'node:fs';
import { callApiFootball } from './apiClient.js';

const LEAGUE_ID = process.env.LEAGUE_ID || 39;
const SEASON = process.env.SEASON || 2024;
const MAX_PAGES = Number(process.env.MAX_ODDS_PAGES || 5);

async function main() {
  console.log(`Đang tải tỉ lệ kèo mùa ${SEASON}...`);
  let page = 1;
  let all = [];
  while (page <= MAX_PAGES) {
    const odds = await callApiFootball('/odds', { league: LEAGUE_ID, season: SEASON, page });
    all = all.concat(odds || []);
    page += 1;
    if (!odds || odds.length === 0) break;
  }
  mkdirSync('data', { recursive: true });
  writeFileSync('data/odds.json', JSON.stringify(all, null, 2));
  console.log(`Đã lưu ${all.length} mục kèo vào data/odds.json`);
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
