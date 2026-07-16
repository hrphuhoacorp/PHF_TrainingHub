# Mã lưu trữ không còn nạp trong bản chính

`app.js` ở thư mục gốc là mã của giai đoạn cũ và hiện không được `index.html` nạp.

- Khi chạy bằng `server.js`, đường dẫn trực tiếp tới `app.js` đã bị chặn để tránh vô tình bật lại luồng cũ.
- Không xóa file này trong bản vá nhỏ để vẫn có thể đối chiếu lịch sử nếu cần.
- Khi đóng gói Official v1, nên chuyển file này vào thư mục lưu trữ ngoài gói triển khai.
