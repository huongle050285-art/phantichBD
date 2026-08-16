// Chạy tuần tự cả 3 bước: fixtures -> odds -> predictions
// Dùng khi muốn lấy toàn bộ dữ liệu trong 1 lệnh: npm run fetch:all
// LƯU Ý: sẽ tốn quota nhanh hơn nếu chạy hết 1 lần trên gói free (100 req/ngày).

import { execFileSync } from 'node:child_process';

const steps = [
  ['node', ['src/fetchFixtures.js']],
  ['node', ['src/fetchOdds.js']],
  ['node', ['src/fetchPredictions.js']],
];

for (const [cmd, args] of steps) {
  console.log(`\n=== Đang chạy: ${cmd} ${args.join(' ')} ===`);
  execFileSync(cmd, args, { stdio: 'inherit' });
}

console.log('\nHoàn tất! Kiểm tra thư mục data/ để xem kết quả.');
