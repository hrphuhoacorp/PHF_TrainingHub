PHF TRAINING HUB - LOCAL PROTOTYPE FULL FLOW

Mục đích:
- Bản chạy local trên laptop bằng VSCode.
- Giữ đủ flow giao diện/nội dung từ màn chào mừng đến hoàn tất Bước 1-5.
- Không dùng database thật.
- Dữ liệu demo được lưu thử vào data.json.

Cách chạy:
1. Giải nén ZIP.
2. Mở folder PHF_TrainingHub_LocalPrototype_FULL bằng VSCode.
3. Mở Terminal trong VSCode.
4. Chạy lệnh:
   npm start
5. Mở trình duyệt:
   http://localhost:3000

Ghi chú:
- Bản này không cần npm install vì server.js dùng sẵn Node.js native.
- Nếu máy báo thiếu Node.js thì cài Node.js LTS trước.
- File data.json sẽ tự cập nhật khi anh thao tác, nhập thông tin, chuyển trang, nộp test hoặc lưu đánh giá.
- Nếu muốn reset dữ liệu test, đóng server rồi sửa/xóa nội dung data.json, hoặc thay lại bằng data.json gốc trong ZIP.

Các file chính:
- index.html: toàn bộ giao diện/nội dung Training Hub đã chốt.
- app.js: lớp lưu dữ liệu local vào data.json, không thay thế giao diện gốc.
- server.js: server local chạy http://localhost:3000 và API đọc/ghi data.json.
- data.json: dữ liệu demo nhân viên, tiến độ, điểm test, trạng thái đạt/chưa đạt.
- package.json: lệnh npm start.
