# RUNBOOK — Tài khoản TEST cho Admin/Developer (smoke test Training Hub)

## Kết luận xác minh (không suy đoán, dựa trên source hiện tại)

Đã trace toàn bộ hạ tầng quản lý tài khoản trước khi kết luận — **không cần viết code mới**.
Mọi thao tác yêu cầu (tạo, đổi mật khẩu, khoá/xoá) đã có sẵn, dùng đúng nghiệp vụ Admin hiện hành:

- Tạo tài khoản: `createAccountByAdmin` — `lib/auth.js:1025`, route `POST /api/auth/accounts/create`
  (`server.js:293-296`, `api/auth/accounts.js`). Yêu cầu quyền `requireWebOperatorSession`
  (Admin hoặc Quản lý) + `assertAccountMutationAllowed` — **chỉ Admin thật** mới được tạo
  `role:'admin'`, Quản lý không tạo được tài khoản Admin.
- Đổi mật khẩu: `resetPasswordByAdmin` — `lib/auth.js:1011`, route
  `POST /api/auth/accounts/reset-password`.
- Khoá tài khoản: `updateAccountByAdmin` với `status:'inactive'`/`'locked'` — `lib/auth.js:770-923`,
  route `POST /api/auth/accounts/update`.
- Xoá tài khoản: `deleteAccountByAdmin` — `lib/auth.js:925`, route
  `POST /api/auth/accounts/delete`. **Chỉ xoá `user_accounts`**, không đụng bảng `employees`.
- Xoá sạch hồ sơ nhân viên liên kết (progress, test_results, evaluation_records,
  commitment_records, các bảng Classroom, activity_log...): action `deleteEmployee` —
  `lib/db.js:1248` (`deleteEmployeeFromSupabase`). Hàm này **từ chối xoá** nếu còn tài khoản
  liên kết (`EMPLOYEE_ACCOUNT_LINKED`) — bắt buộc xoá tài khoản trước, xoá hồ sơ nhân viên sau.
  UI gọi hàm này đã có sẵn ở màn "Hồ sơ đánh giá → Xóa học viên" (`assets/js/phf-evaluation.js:1276`).
- `role` hợp lệ: chỉ `learner` / `manager` / `admin` (`lib/auth.js:38-41`) — không có role
  "test" riêng, và **không cần** thêm role riêng: phân biệt Kho/Bán hàng đã dùng đúng field
  `department` (giống nhân viên thật), không phải role.
- Định danh chương trình đào tạo (`defaultProgram`) chỉ nhận `new_sales` hoặc `phf_class`
  (`lib/auth.js:331-344`) — đây là cổng "có vào được Training Hub hay không", không phải chọn
  phòng ban. Phòng ban (Kho/Bán hàng) lấy từ field `department` khi tạo tài khoản, hệ thống tự
  tạo hồ sơ `employees` liên kết với đúng `department` đó (`createEmployeeProfileForAccount`,
  `lib/auth.js:346-370`).
- Màn Admin quản lý tài khoản (`assets/js/phf-account-admin-safe.js`) đã có sẵn field nhập
  `department`, `trainingAudience`, `hubAssignmentStatus`, `defaultProgram` khi tạo/sửa tài khoản
  — không cần thêm UI.

## Nguyên tắc bắt buộc khi tạo tài khoản TEST

- **Không dùng Gmail thật** — dùng domain nội bộ không tồn tại thật, ví dụ `@phf-test.internal`.
- **Không trùng** với bất kỳ nhân viên thật nào (tên, SĐT, mã nhân viên).
- Đặt tên rõ ràng để không ai nhầm với dữ liệu thật: `fullName` bắt đầu bằng `TEST_`.
- Không đưa các tài khoản này vào phân công Checklist/Classroom thật (không gán ca, không gán
  chấm điểm KPI thật).
- Dọn sạch ngay sau khi dùng xong theo đúng 2 bước ở mục "Xoá" bên dưới — không để tồn tại lâu
  dài trong dữ liệu Production.

## Cách tạo 3 tài khoản TEST (qua UI Admin hiện có, không cần API tay)

| Việc | TEST_ADMIN | TEST_BAN_HANG | TEST_KHO |
|---|---|---|---|
| Vào | Quản lý tài khoản → Tạo tài khoản | như trái | như trái |
| Họ tên | `TEST_ADMIN` | `TEST_BAN_HANG` | `TEST_KHO` |
| Email | `test-admin@phf-test.internal` | `test-banhang@phf-test.internal` | `test-kho@phf-test.internal` |
| SĐT | không cần (accountType admin gốc bỏ qua) | số giả hợp lệ, ví dụ `0900000001` | `0900000002` |
| Vai trò (role) | `admin` | `learner` | `learner` |
| Phòng ban (department) | — | `Bán hàng` (đúng chữ, khớp metadata bài học) | `Kho` |
| Phạm vi đào tạo (defaultProgram) | — | `new_sales` | `new_sales` |
| Đối tượng đào tạo (trainingAudience) | — | `Nhân sự mới` | `Nhân sự mới` |
| Trạng thái Hub (hubAssignmentStatus) | — | `active` | `active` |

Chỉ Admin thật mới tạo được `TEST_ADMIN` (role admin) — Quản lý không tạo được, đúng chặn có sẵn.

## Cách đổi mật khẩu test

Quản lý tài khoản → chọn tài khoản `TEST_*` → **Đặt lại mật khẩu**. Hệ thống trả về mật khẩu tạm
(`temporaryPassword`) — gửi Claude qua kênh riêng, không dán vào file trong repo.

## Cách khoá tạm (không xoá)

Quản lý tài khoản → chọn tài khoản `TEST_*` → **Trạng thái = Ngưng hoạt động**. Tài khoản không
đăng nhập được nhưng dữ liệu vẫn giữ, dùng lại được sau.

## Cách xoá sạch hoàn toàn (đúng thứ tự, bắt buộc)

1. Quản lý tài khoản → chọn tài khoản `TEST_*` → **Xoá tài khoản** (xoá `user_accounts`).
2. Vào **Hồ sơ đánh giá** → tìm đúng hồ sơ `TEST_*` (lúc này không còn tài khoản liên kết) →
   **Xóa học viên** để xoá sạch `employees` + toàn bộ dữ liệu con (progress, test_results,
   evaluation_records, commitment_records, activity_log, các bảng Classroom).

Nếu làm ngược thứ tự (xoá hồ sơ nhân viên trước khi xoá tài khoản), hệ thống sẽ từ chối với lỗi
`EMPLOYEE_ACCOUNT_LINKED` — đây là chặn an toàn có sẵn, không phải lỗi.

## Cách đưa cho Claude dùng để smoke test

Không hard-code mật khẩu vào repo. Cung cấp qua biến môi trường theo đúng quy ước đã có sẵn của
`scripts/phf-production-smoke-test.js`:

```
PHF_SMOKE_BASE_URL=https://<domain-production>
PHF_SMOKE_ADMIN_EMAIL=test-admin@phf-test.internal
PHF_SMOKE_ADMIN_PASSWORD=<mật khẩu tạm mới nhất>
PHF_SMOKE_MANAGER_EMAIL=   (bỏ trống nếu không có)
PHF_SMOKE_LEARNER_EMAIL=test-banhang@phf-test.internal    (hoặc test-kho@phf-test.internal)
PHF_SMOKE_LEARNER_PASSWORD=<mật khẩu tạm mới nhất>
```

Vì `PHF_SMOKE_*` chỉ hỗ trợ 1 learner cùng lúc, khi cần test cả Kho lẫn Bán hàng thì chạy 2 lượt
với `PHF_SMOKE_LEARNER_EMAIL` khác nhau, hoặc cung cấp trực tiếp URL + email + password qua kênh
chat riêng để Claude gọi `/api/auth/login` thủ công (giống cách `phf-production-smoke-test.js`
đang làm ở dòng gọi `POST /api/auth/login`).

## Backlog sau Pilot

- Nếu về sau cần nhiều tài khoản TEST hơn hoặc dùng thường xuyên, có thể cân nhắc thêm cờ
  `metadata.isTestAccount` để lọc/ẩn khỏi báo cáo tự động — hiện tại chưa cần vì tần suất thấp và
  quy trình xoá sạch 2 bước ở trên đã đủ an toàn.

Không tự thêm role/accountType mới, không tự đổi hành vi tạo/xoá tài khoản hiện có — tài liệu này
chỉ mô tả đúng cách dùng hạ tầng sẵn có.
