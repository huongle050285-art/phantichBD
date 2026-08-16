import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { callApiFootball } from './apiClient.js';

const LEAGUE_ID = process.env.LEAGUE_ID || 39; // 39 = Premier League
const SEASON = process.env.SEASON || 2023;

async function main() {
  console.log(`Đang lấy lịch thi đấu Premier League mùa ${SEASON}...`);

  const fixtures = await callApiFootball('/fixtures', {
    league: LEAGUE_ID,
    season: SEASON,
  });

  await writeFile(
    new URL('../data/fixtures.json', import.meta.url),
    JSON.stringify(fixtures, null, 2)
  );

  console.log(`Đã lưu ${fixtures.length} trận đấu vào data/fixtures.json`);
}

main().catch((err) => {
  console.error('Lỗi khi lấy fixtures:', err.message);
  process.exit(1);
});
