// Chạy tuần tự cả 3 script fetch cũ (tuỳ chọn, không bắt buộc cho web app).
import { spawnSync } from 'node:child_process';

const scripts = ['src/fetchFixtures.js', 'src/fetchOdds.js', 'src/fetchPredictions.js'];

for (const script of scripts) {
  console.log(`\n=== Chạy ${script} ===`);
  const result = spawnSync('node', [script], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Script ${script} lỗi, dừng lại.`);
    process.exit(result.status || 1);
  }
}
