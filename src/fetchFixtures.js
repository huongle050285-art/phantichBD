import { writeFileSync, mkdirSync } from 'node:fs';
import { callApiFootball } from './apiClient.js';

const LEAGUE_ID = process.env.LEAGUE_ID || 39;
const SEASON = process.env.SEASON || 2024;

async function main() {
  console.log(`Đang tải lịch thi đấu mùa ${SEASON}...`);
  const fixtures = await callApiFootball('/fixtures', { league: LEAGUE_ID, season: SEASON });
  mkdirSync('data', { recursive: true });
  writeFileSync('data/fixtures.json', JSON.stringify(fixtures, null, 2));
  console.log(`Đã lưu ${fixtures.length} trận vào data/fixtures.json`);
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
