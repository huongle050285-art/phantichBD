# EPL Odds & Predictions — Web App

Web app nhỏ hiển thị **lịch thi đấu**, **tỉ lệ kèo (odds)** và **dự đoán trận đấu** cho giải **Ngoại hạng Anh**, dùng **2 API miễn phí** (mỗi API chỉ hỗ trợ một phần dữ liệu trên gói free, nên kết hợp cả 2 mới đủ):

- **[API-Football](https://www.api-football.com/)** — dùng cho chế độ **"Theo mùa giải"**. Gói free có dự đoán thật (mô hình riêng của họ) nhưng **chỉ cho phép truy cập mùa 2022-2024** (đã xác nhận qua lỗi `"Free plans do not have access to this season"` khi thử mùa khác) — không có dữ liệu mùa hiện tại.
- **[The Odds API](https://the-odds-api.com/)** — dùng cho chế độ **"Trận sắp diễn ra"** (mặc định khi mở trang). Đây là nguồn duy nhất có **tỉ lệ kèo mùa giải hiện tại** trên gói free, gồm cả **kèo 1X2** và **kèo châu Á (Asian Handicap)**. Không có sẵn dự đoán, nên "dự đoán" hiển thị được server **tự tính từ tỉ lệ kèo 1X2** (implied probability — cách quy đổi kèo sang % xác suất chuẩn trong ngành cá cược). Lưu ý: không phải trận nào/nhà cái nào cũng có kèo châu Á — coverage của market này trên The Odds API không đầy đủ bằng kèo 1X2.

Gồm 2 phần:
- **Backend (Express, `src/server.js`)** — giữ cả 2 API key an toàn phía server (không lộ ra trình duyệt), tự cache kết quả ~15 phút để tiết kiệm quota, expose API nội bộ (`/api/upcoming`, `/api/fixtures`, `/api/odds`, `/api/predictions/:id`) cho frontend gọi.
- **Frontend (`public/`)** — trang HTML/CSS/JS thuần, có dropdown "Xem" để chuyển giữa 2 chế độ, có dark mode tự động.

Ngoài ra vẫn còn 3 script cũ (`fetch:fixtures`, `fetch:odds`, `fetch:predictions`, dùng API-Football) để xuất dữ liệu ra file JSON nếu cần — không bắt buộc cho web app.

## 1. Đăng ký 2 API key miễn phí

**API-Football** (cho chế độ "Theo mùa giải"):
1. Vào https://dashboard.api-football.com/register, tạo tài khoản (email + mật khẩu, hoặc Google/GitHub).
2. Xác nhận email nếu được yêu cầu.
3. Đăng nhập vào dashboard, bấm vào thẻ **"API-BÓNG ĐÁ"** → copy **API Key** hiện ra ở đó. Gói **Free** (100 request/ngày) đã tự kích hoạt sẵn.

**The Odds API** (cho chế độ "Trận sắp diễn ra"):
1. Vào https://the-odds-api.com/, tìm ô **"Get a free API key"**, chỉ cần nhập email (không cần thẻ tín dụng, không cần mật khẩu).
2. Mở email vừa nhận (kiểm tra cả mục Spam), key sẽ có sẵn trong đó.

## 2. Cài đặt

```bash
cd epl-odds-project
npm install
cp .env.example .env
```

Mở file `.env`, dán 2 key vào:

```
API_FOOTBALL_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LEAGUE_ID=39
SEASON=2024
ODDS_API_KEY=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

`SEASON` chỉ dùng cho chế độ "Theo mùa giải" — **giữ trong khoảng 2022-2024** vì đó là giới hạn của gói free API-Football. Nếu chỉ điền `API_FOOTBALL_KEY` mà chưa có `ODDS_API_KEY`, chế độ "Trận sắp diễn ra" (mặc định) sẽ báo lỗi cho tới khi bạn điền đủ 2 key — chế độ "Theo mùa giải" vẫn chạy bình thường.

## 3. Chạy web app ở máy local

```bash
npm start
```

Mở trình duyệt vào **http://localhost:3000**. Trang mặc định vào chế độ "Trận sắp diễn ra" — hiện các trận gần nhất kèm kèo và dự đoán (tính từ kèo) ngay lập tức, không cần bấm gì thêm. Chuyển sang "Theo mùa giải" ở dropdown "Xem" nếu muốn xem lịch sử một mùa cụ thể (bấm "Xem dự đoán" ở từng trận để tải dự đoán thật từ API-Football).

Muốn server tự khởi động lại khi sửa code, dùng `npm run dev` thay cho `npm start`.

## 4. Đưa lên internet (deploy miễn phí với Render)

[Render](https://render.com/) hiện có gói **free** cho web service Node.js, không cần thẻ tín dụng, 750 giờ chạy/tháng. Lưu ý: sau ~15 phút không có ai truy cập, app sẽ "ngủ" và mất khoảng 1 phút để khởi động lại ở lượt truy cập tiếp theo — bình thường với gói free.

1. Đưa code (thư mục này) lên một repo GitHub (`git init`, `git add .`, `git commit`, `git push`). **Không commit file `.env`** (đã có `.gitignore` chặn sẵn) vì nó chứa 2 API key riêng của bạn.
2. Vào https://render.com, đăng ký/đăng nhập (có thể dùng tài khoản GitHub).
3. Chọn **New → Web Service**, kết nối tới repo GitHub vừa tạo.
4. Cấu hình:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:** thêm `API_FOOTBALL_KEY`, `ODDS_API_KEY`, `LEAGUE_ID=39`, `SEASON=2024` — **đây là chỗ dán key an toàn**, không phải trong code.
5. Bấm **Create Web Service**. Sau vài phút bạn có 1 URL dạng `https://ten-app-cua-ban.onrender.com` — chia sẻ link này cho bất kỳ ai.

Mỗi lần push code mới lên GitHub, Render sẽ tự deploy lại bản mới.

## 5. Về giới hạn của các gói miễn phí

- **API-Football free:** 100 request/ngày, **chỉ hỗ trợ mùa 2022-2024** (mùa hiện tại/tương lai và tham số "next" đều bị chặn — lỗi thật từ API: `"Free plans do not have access to this season / the Next parameter"`). Tỉ lệ kèo cho mùa đã kết thúc thường trống dù không mùa nào báo lỗi. Vì vậy chế độ "Theo mùa giải" chủ yếu hữu ích để xem lịch sử trận đấu + dự đoán thật, không phải để xem kèo.
- **The Odds API free:** 500 credit/tháng (mỗi lần gọi `/api/upcoming` tốn khoảng 1 credit tuỳ số vùng/thị trường yêu cầu — mặc định app chỉ xin vùng `eu`, thị trường `h2h` để tiết kiệm). Có dữ liệu **mùa hiện tại** nhưng **không có** endpoint dự đoán, nên "dự đoán" trong chế độ này là con số **tự tính** từ tỉ lệ kèo, không phải mô hình AI.
- Server tự cache cả 2 nguồn ~15 phút (`CACHE_TTL_MS` trong `.env`) để nhiều người xem cùng lúc không làm tốn quota nhanh.

## 6. Script xuất dữ liệu ra file JSON (tuỳ chọn)

Nếu muốn có bản dữ liệu tĩnh để phân tích riêng, vẫn có thể dùng 3 script cũ (dùng API-Football, nên cũng giới hạn mùa 2022-2024):

```bash
npm run fetch:fixtures      # lưu data/fixtures.json
npm run fetch:odds          # lưu data/odds.json
npm run fetch:predictions   # lưu data/predictions.json (cần chạy fetch:fixtures trước)
npm run fetch:all           # chạy tuần tự cả 3
```
