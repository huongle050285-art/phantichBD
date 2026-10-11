import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { callApiFootball } from './apiClient.js';

async function main() {
  if (!existsSync('data/fixtures.json')) {
    console.error('Chưa có data/fixtures.json — chạy "npm run fetch:fixtures" trước.');
    process.exit(1);
  }
  const fixtures = JSON.parse(readFileSync('data/fixtures.json', 'utf-8'));
  console.log(`Đang tải dự đoán cho ${fixtures.length} trận...`);

  const predictions = {};
  for (const f of fixtures) {
    const id = f.fixture.id;
    try {
      const res = await callApiFootball('/predictions', { fixture: id });
      predictions[id] = res?.[0] || null;
    } catch (err) {
      console.warn(`Lỗi lấy dự đoán cho trận ${id}:`, err.message);
      predictions[id] = null;
    }
  }

  writeFileSync('data/predictions.json', JSON.stringify(predictions, null, 2));
  console.log('Đã lưu data/predictions.json');
}

main().catch((err) => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
