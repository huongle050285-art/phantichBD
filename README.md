# EPL Odds & Predictions — Web App

Web app nhỏ hiển thị **lịch thi đấu**, **tỉ lệ kèo (odds)** và **dự đoán trận đấu** cho giải **Ngoại hạng Anh**, dùng **3 API miễn phí** (mỗi API chỉ hỗ trợ một phần dữ liệu trên gói free, nên kết hợp cả 3 mới đủ):

- **[API-Football](https://www.api-football.com/)** — dùng cho chế độ **"Theo mùa giải"** VÀ làm dữ liệu huấn luyện cho mô hình ML. Gói free có dự đoán thật (mô hình riêng của họ) nhưng **chỉ cho phép truy cập mùa 2022-2024** (đã xác nhận qua lỗi `"Free plans do not have access to this season"` khi thử mùa khác) — không có dữ liệu mùa hiện tại.
- **[The Odds API](https://the-odds-api.com/)** — dùng cho chế độ **"Trận sắp diễn ra"** (mặc định khi mở trang). Đây là nguồn duy nhất có **tỉ lệ kèo mùa giải hiện tại** trên gói free, gồm **kèo 1X2**, **kèo châu Á (Asian Handicap)** và **kèo tài xỉu (Over/Under)**. Không có sẵn dự đoán, nên "Dự đoán BD" hiển thị được server **tự tính từ tỉ lệ kèo 1X2** (implied probability). Lưu ý: không phải trận nào/nhà cái nào cũng có đủ cả 3 loại kèo.
- **[football-data.org](https://www.football-data.org/)** — dùng cho khối **"Dự đoán ML"** và khung **"Phân tích phong độ & đối đầu"**. Đây là nguồn DUY NHẤT trong 3 API có **kết quả trận đấu + bảng xếp hạng của MÙA GIẢI HIỆN TẠI** trên gói free — dùng để tính phong độ 5 trận gần nhất và thành tích đối đầu 2 đội "thật" (API-Football không có mùa hiện tại, The Odds API không có kết quả).

### "Dự đoán BD" — phân tích kết hợp 3 loại kèo (rule-based)

Mỗi trận trong chế độ "Trận sắp diễn ra" có khối **"Dự đoán BD"**, tự động kết hợp cả 3 loại kèo (1X2 + châu Á + tài xỉu, khi có đủ dữ liệu) thành: đội được đánh giá cao hơn + chênh lệch bao nhiêu bàn, nhận định thị trường tài xỉu nghiêng Tài/Xỉu, và 1 tỉ số gợi ý.

**Đây KHÔNG phải mô hình AI/machine learning** — là một **bộ quy tắc thống kê đơn giản** tính trực tiếp từ tỉ lệ kèo hiện có tại thời điểm xem trang, không "học" gì từ lịch sử.

### "Dự đoán ML" (beta) — mô hình học máy thật

Khối thứ 2, **"Dự đoán ML"**, là một mô hình **hồi quy logistic đa lớp (softmax regression)** được **huấn luyện thật** từ ~1000 trận đấu Ngoại hạng Anh mùa 2022-2024: mô hình học mối liên hệ giữa phong độ gần đây + thành tích đối đầu của 2 đội và kết quả thật của trận đấu (thắng/hòa/thua). Khi dự đoán 1 trận sắp diễn ra, mô hình dùng phong độ + đối đầu **của mùa hiện tại** (lấy từ football-data.org) làm đầu vào.

**Giới hạn cần biết** (cũng hiển thị ngay trong app):
- Dữ liệu học chỉ có ~1000 trận (2022-2024) — độ chính xác thật đo được (hiển thị ngay trong khối "Dự đoán ML", thường quanh 50-55%) chỉ nhỉnh hơn "luôn đoán đội chủ nhà thắng" một chút.
- Đội mới lên hạng (chưa từng đá Ngoại hạng Anh trong dữ liệu học, hoặc chưa đá trận nào mùa này) → khối ML sẽ báo rõ "chưa có dữ liệu" thay vì đoán bừa.
- Vì API-Football free mãi mãi chỉ cho tới mùa 2024, đây là mô hình "học 1 lần", **không tự động cập nhật** theo thời gian.

### "Phân tích phong độ & đối đầu" — số liệu thô + ước tính 3 tỉ số (Poisson)

Khối thứ 3, mới thêm, hiển thị trực tiếp:
- **5 trận gần nhất của mỗi đội** (ngày, đối thủ, tỉ số, kết quả Thắng/Hòa/Thua) — lấy từ football-data.org, mùa hiện tại.
- **Lịch sử đối đầu** giữa 2 đội (tối đa 5 lần gặp gần nhất, không giới hạn mùa).
- **1 nhận định** kết hợp phong độ ghi/thủng bàn gần đây + kèo chấp châu Á (nếu có) để nói đội nào đang được đánh giá nhỉnh hơn.
- **"Chốt kèo"** — 1 dòng nổi bật ngay phía trên danh sách tỉ số, trả lời thẳng "đội nào sẽ thắng" (hoặc "Hòa" nếu xác suất hòa đang cao nhất trong 3 khả năng home/draw/away), kèm % — đây cũng chính là giá trị được tự động ghi vào "Bảng sao kê dự đoán" (xem bên dưới).
- **3 tỉ số có khả năng xảy ra cao nhất**, ước tính bằng mô hình thống kê Poisson: coi số bàn mỗi đội ghi được là 1 biến ngẫu nhiên Poisson với giá trị kỳ vọng suy ra từ phong độ ghi/thủng bàn sân nhà/sân khách gần đây, sau đó "nắn" lại kỳ vọng đó cho khớp một phần với mức chấp của kèo châu Á (nếu trận có kèo) — đây là cách tiếp cận phổ biến trong phân tích bóng đá thống kê (không phải mô hình đã "học", mà là 1 phép tính thống kê tường minh, có thể giải thích từng bước).

Khi 1 đội chưa có trận nào mùa này (đội mới lên hạng, đầu mùa giải), khối này vẫn hiển thị nhưng dùng mức trung bình toàn giải để ước tính, và ghi rõ "chưa có trận nào mùa này" thay vì bịa số liệu.

### "Đồng thuận (ML + Thống kê)" — gộp "Dự đoán ML" và "Phân tích phong độ & đối đầu"

Khối thứ 4 **không tính toán gì mới** — chỉ lấy 2 kết quả % thắng/hòa/thua đã tính sẵn ở "Dự đoán ML" (mô hình đã học) và "Phân tích phong độ & đối đầu" (thống kê Poisson + kèo chấp) rồi **trung bình cộng** lại thành 1 chỉ số duy nhất, kèm theo 1 nhãn mức độ đồng thuận:

- **Đồng thuận mạnh** (xanh lá): cả 2 nguồn cùng nghiêng về 1 đội, và mức chênh lệch % giữa 2 cách tính khá nhỏ — 2 góc nhìn khá thống nhất.
- **Đồng thuận** (xanh dương): cả 2 nguồn cùng nghiêng về 1 đội, nhưng mức % lệch nhau khá nhiều giữa 2 cách tính.
- **Trái chiều** (đỏ): 2 nguồn nghiêng về 2 đội khác nhau — nên tham khảo thận trọng hơn.
- **Chỉ 1 nguồn** (xám): 1 trong 2 khối chưa đủ dữ liệu (vd. chưa chạy `npm run train`, hoặc đội chưa có dữ liệu mùa này) — khối "Đồng thuận" tự động chỉ dùng nguồn còn lại, có ghi chú rõ.

Đây là kỹ thuật "ensemble" cơ bản (trung bình nhiều ước lượng độc lập), **không huấn luyện lại mô hình**, không cần thêm API key, không ảnh hưởng tới `data/model.json` hiện có.

Cả 4 khối ("Dự đoán BD", "Đồng thuận", "Dự đoán ML", "Phân tích phong độ & đối đầu") hiển thị **song song**, không thay thế nhau, để bạn tự đối chiếu. **Không phải lời khuyên cá cược**, chỉ mang tính tham khảo/thử nghiệm.

### "Bảng sao kê dự đoán" — tự động lưu lại lịch sử trúng/trật

Ở cuối trang (dưới "Danh sách trận đấu") có thêm bảng **"Bảng sao kê dự đoán"**, tự động:
1. **Ghi lại** "chốt kèo" + 3 tỉ số dự đoán của khung "Phân tích phong độ & đối đầu" cho MỖI trận, ngay lần đầu tiên trận đó xuất hiện ở "Trận sắp diễn ra" (chỉ ghi 1 lần, không đổi theo thời gian).
2. Khi trận đấu đã có kết quả thật (football-data.org), bảng tự **đối chiếu**: "Đúng chốt kèo" (xanh)/"Sai chốt kèo" (đỏ) tuỳ việc đội thắng thật có khớp với đội được "chốt" hay không, và nếu 1 trong 3 tỉ số dự đoán **khớp chính xác** kết quả thật, ô đó được **bôi vàng** kèm nhãn "Đúng tỉ số!".
3. Trận chưa đấu xong hiển thị trạng thái "Đang chờ".

**Lưu ý quan trọng về nơi lưu dữ liệu:** bảng này lưu vào file `data/predictions-log.json` **trên server** (dùng chung cho mọi người xem trang). Khác với `data/model.json` (file tĩnh, không đổi), file này được server **tự ghi thêm liên tục khi app đang chạy** — mà ổ đĩa Render free bị xoá sạch mỗi lần bạn deploy code mới, nên **mọi dòng được ghi sau lần upload gần nhất sẽ mất** nếu không backup trước khi cập nhật code. Để tránh mất lịch sử:
- Bấm nút **"Tải về sao kê"** ở góc bảng (gọi `/api/predictions-log/download`) để tải file `predictions-log.json` hiện tại về máy — nên làm **trước mỗi lần** bạn chuẩn bị upload code mới lên GitHub.
- Kéo file đã tải về đó vào đúng thư mục `data/` khi upload code mới (giống hệt cách bạn đang giữ lại `data/model.json`), để lần deploy tiếp theo khởi động với đúng lịch sử cũ thay vì bảng trống.

Gồm 2 phần:
- **Backend (Express, `src/server.js`)** — giữ cả 3 API key an toàn phía server (không lộ ra trình duyệt), tự cache kết quả để tiết kiệm quota, expose API nội bộ (`/api/upcoming`, `/api/fixtures`, `/api/odds`, `/api/predictions/:id`, `/api/predictions-log`, `/api/predictions-log/download`) cho frontend gọi.
- **Frontend (`public/`)** — trang HTML/CSS/JS thuần, có dropdown "Xem" để chuyển giữa 2 chế độ, có dark mode tự động.

Ngoài ra vẫn còn 3 script cũ (`fetch:fixtures`, `fetch:odds`, `fetch:predictions`, dùng API-Football) để xuất dữ liệu ra file JSON nếu cần — không bắt buộc cho web app.

## 1. Đăng ký 3 API key miễn phí

**API-Football** (cho chế độ "Theo mùa giải" + huấn luyện mô hình ML):
1. Vào https://dashboard.api-football.com/register, tạo tài khoản (email + mật khẩu, hoặc Google/GitHub).
2. Xác nhận email nếu được yêu cầu.
3. Đăng nhập vào dashboard, bấm vào thẻ **"API-BÓNG ĐÁ"** → copy **API Key**. Gói **Free** (100 request/ngày) đã tự kích hoạt sẵn.

**The Odds API** (cho chế độ "Trận sắp diễn ra"):
1. Vào https://the-odds-api.com/, tìm ô **"Get a free API key"**, chỉ cần nhập email (không cần thẻ tín dụng, không cần mật khẩu).
2. Mở email vừa nhận (kiểm tra cả mục Spam), key sẽ có sẵn trong đó.

**football-data.org** (cho khối "Dự đoán ML" và "Phân tích phong độ & đối đầu"):
1. Vào https://www.football-data.org/client/register, đăng ký chỉ với email (không cần thẻ).
2. Key sẽ hiện ngay sau khi đăng ký, hoặc gửi qua email xác nhận.

## 2. Cài đặt

```bash
cd epl-odds-project
npm install
cp .env.example .env
```

Mở file `.env`, dán 3 key vào:

```
API_FOOTBALL_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LEAGUE_ID=39
SEASON=2024
ODDS_API_KEY=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
FOOTBALL_DATA_KEY=zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz
```

`SEASON` chỉ dùng cho chế độ "Theo mùa giải" — **giữ trong khoảng 2022-2024**. Thiếu `ODDS_API_KEY` → chế độ "Trận sắp diễn ra" báo lỗi. Thiếu `FOOTBALL_DATA_KEY` → mọi thứ khác vẫn chạy bình thường, chỉ riêng khối "Dự đoán ML" và "Phân tích phong độ & đối đầu" hiển thị "chưa đủ dữ liệu".

## 3. Huấn luyện mô hình "Dự đoán ML" (chỉ cần chạy 1 LẦN DUY NHẤT)

```bash
npm run train
```

Lệnh này tự tải dữ liệu 3 mùa 2022-2024 từ API-Football (chỉ 3 request, không đáng lo hạn mức 100/ngày), tính toán và huấn luyện mô hình, rồi lưu kết quả vào `data/model.json`. Mất khoảng 1-2 phút. Vì dữ liệu lịch sử 2022-2024 không đổi, **không cần chạy lại lệnh này sau này**. Nếu bỏ qua bước này, app vẫn chạy bình thường, chỉ riêng khối "Dự đoán ML" sẽ hiển thị "chưa có mô hình" (khối "Phân tích phong độ & đối đầu" không cần bước này, chỉ cần `FOOTBALL_DATA_KEY`).

## 4. Chạy web app ở máy local

```bash
npm start
```

Mở trình duyệt vào **http://localhost:3000**. Trang mặc định vào chế độ "Trận sắp diễn ra".

Muốn server tự khởi động lại khi sửa code, dùng `npm run dev` thay cho `npm start`.

## 5. Đưa lên internet (deploy miễn phí với Render)

[Render](https://render.com/) hiện có gói **free** cho web service Node.js, không cần thẻ tín dụng, 750 giờ chạy/tháng. Lưu ý: sau ~15 phút không có ai truy cập, app sẽ "ngủ" và mất khoảng 1 phút để khởi động lại ở lượt truy cập tiếp theo — bình thường với gói free.

1. Đưa code (thư mục này) lên một repo GitHub. **Không upload file `.env`** vì nó chứa các API key riêng của bạn. **NHỚ upload cả file `data/model.json`** sau khi chạy `npm run train` — nếu không, bản trên Render sẽ không có "Dự đoán ML". Từ lần cập nhật code thứ 2 trở đi, nếu đã dùng "Bảng sao kê dự đoán" một thời gian, **nhớ bấm "Tải về sao kê" rồi upload `data/predictions-log.json` kèm theo** — nếu không, lịch sử trúng/trật ghi được từ lần deploy trước sẽ bị xoá sạch (xem chi tiết ở mục "Bảng sao kê dự đoán" phía trên).
2. Vào https://render.com, đăng ký/đăng nhập (có thể dùng tài khoản GitHub).
3. Chọn **New → Web Service**, kết nối tới repo GitHub vừa tạo.
4. Cấu hình:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variables:** thêm `API_FOOTBALL_KEY`, `ODDS_API_KEY`, `FOOTBALL_DATA_KEY`, `LEAGUE_ID=39`, `SEASON=2024` — **đây là chỗ dán key an toàn**, không phải trong code.
5. Bấm **Create Web Service**. Sau vài phút bạn có 1 URL dạng `https://ten-app-cua-ban.onrender.com` — chia sẻ link này cho bất kỳ ai.

Mỗi lần push code mới lên GitHub, Render sẽ tự deploy lại bản mới. Lưu ý: ổ đĩa của Render free bị xóa sạch mỗi lần deploy lại — vì vậy `data/model.json` PHẢI nằm trong repo GitHub (không tự sinh ra trên server).

## 6. Về giới hạn của các gói miễn phí

- **API-Football free:** 100 request/ngày, **chỉ hỗ trợ mùa 2022-2024**.
- **The Odds API free:** 500 credit/tháng. Có dữ liệu **mùa hiện tại** nhưng không có kết quả/thống kê đội.
- **football-data.org free:** 10 request/phút, có Ngoại hạng Anh trong danh sách giải đấu miễn phí, dữ liệu "delayed" (không real-time, nhưng đủ dùng cho phong độ/bảng xếp hạng). Server cache dữ liệu này 60 phút để không vượt hạn mức.
- Server tự cache tất cả nguồn (`CACHE_TTL_MS` cho kèo, mặc định 15 phút) để nhiều người xem cùng lúc không làm tốn quota nhanh.

## 7. Script xuất dữ liệu ra file JSON (tuỳ chọn)

Nếu muốn có bản dữ liệu tĩnh để phân tích riêng, vẫn có thể dùng 3 script cũ (dùng API-Football, nên cũng giới hạn mùa 2022-2024):

```bash
npm run fetch:fixtures      # lưu data/fixtures.json
npm run fetch:odds          # lưu data/odds.json
npm run fetch:predictions   # lưu data/predictions.json (cần chạy fetch:fixtures trước)
npm run fetch:all           # chạy tuần tự cả 3
```
