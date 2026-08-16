import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { callApiFootball } from './apiClient.js';

// Endpoint /predictions chỉ nhận 1 fixture id mỗi lần gọi, nên cần đọc danh sách
// trận đấu đã lưu từ fetchFixtures.js rồi lặp qua từng trận.
// Gói free: 100 request/ngày -> giới hạn số trận xử lý mỗi lần chạy bằng MAX_FIXTURES.

const MAX_FIXTURES = Number(process.env.MAX_FIXTURES || 20);
const DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 300); // tránh gọi quá dồn dập

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let fixtures;
  try {
    const raw = await readFile(new URL('../data/fixtures.json', import.meta.url), 'utf-8');
    fixtures = JSON.parse(raw);
  } catch (err) {
    console.error(
      'Không đọc được data/fixtures.json. Hãy chạy "npm run fetch:fixtures" trước.'
    );
    process.exit(1);
  }

  const subset = fixtures.slice(0, MAX_FIXTURES);
  console.log(
    `Sẽ lấy dự đoán cho ${subset.length}/${fixtures.length} trận (giới hạn bởi MAX_FIXTURES=${MAX_FIXTURES})`
  );

  const predictions = [];

  for (const item of subset) {
    const fixtureId = item.fixture?.id;
    if (!fixtureId) continue;

    try {
      const response = await callApiFootball('/predictions', { fixture: fixtureId });
      if (response && response.length > 0) {
        predictions.push({ fixtureId, prediction: response[0] });
      }
    } catch (err) {
      console.warn(`Bỏ qua fixture ${fixtureId}: ${err.message}`);
    }

    await delay(DELAY_MS);
  }

  await writeFile(
    new URL('../data/predictions.json', import.meta.url),
    JSON.stringify(predictions, null, 2)
  );

  console.log(`Đã lưu ${predictions.length} dự đoán vào data/predictions.json`);
}

main().catch((err) => {
  console.error('Lỗi khi lấy predictions:', err.message);
  process.exit(1);
});
