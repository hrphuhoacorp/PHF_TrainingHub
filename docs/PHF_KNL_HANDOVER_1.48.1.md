# PHF KNL handover — close Batch 2

## Release state

- Production baseline đã xác nhận: `1.48.0`, commit `a29a1e772fc178056cbaacc9dedd3d5f1928e4a4`.
- Navigation close-out target: `1.48.1`. Commit canonical là HEAD của `origin/main` chứa tài liệu này (`git rev-parse origin/main`); không ghi hash tự tham chiếu vào chính commit.
- Batch 1 và Batch 2 hoàn tất. Batch 3, Survey và Assessment **chưa implement**.

## Schema hiện hữu

Migration đã chạy Production:

1. `scripts/PHF_KNL_PERMISSIONS_1.0.sql` — grants, people scope và audit quyền KNL.
2. `scripts/PHF_KNL_FRAMEWORK_VERSION_DYNAMIC_1.47.0.sql` — framework/version/cấu trúc động và audit/guards.
3. `scripts/PHF_KNL_ASSIGNMENT_SOURCE_MANIFEST_1.48.0.sql` — source manifest idempotent và assignment theo version.

Quan hệ Batch 1:

`knl_frameworks` 1 → N `knl_framework_versions` 1 → N `knl_competency_groups` 1 → N `knl_competency_items`.

Mỗi version đồng thời có N `knl_structure_columns` (`item`, optional `description`, `level` 1..N). Nội dung giao điểm item/mức nằm ở `knl_item_level_contents`, tham chiếu đúng `version_id + item_id + column_id`; FK/guard ngăn liên kết chéo version. `knl_structure_audit` lưu lịch sử mutation cấu trúc.

Batch 2 bổ sung `knl_source_manifests`, source key/hash trên framework/version/group/item/column/content, `knl_framework_assignments` và `knl_framework_assignment_history`.

## Assignment contract

- Assignment luôn tham chiếu một `knl_framework_versions.id` cụ thể.
- Target là `employee` theo exact `employee_code`, hoặc `position` theo stable `position_ref`; không dùng tên người/display text làm key.
- Một nhân sự có thể nhận nhiều framework version. Cùng `version + target` là idempotent; chỉ một assignment primary active trên một target.
- `organization_snapshot` là bằng chứng tại thời điểm gán, không phải organization master.
- Organization/people chỉ đọc qua adapter `checklist_employee_assignments`; tuyệt đối không ghi ngược Checklist.
- Production hiện chưa có `position` tách biệt trong source (chỉ có title), nên position assignment phải trả conflict; không suy title thành position.

## Seed Production

Đã seed idempotent: **11 framework / 11 version / 33 group / 132 item / 632 level content**. Seed lần hai trả `UNCHANGED 11`, counts không tăng.

Framework đã nạp:

1. Nhân viên bán hàng tại cửa hàng
2. NV Giám sát
3. Trưởng nhóm Gói quà
4. Thủ kho
5. Nhân viên Marketing
6. Leader MKT
7. Nhân viên Content
8. Nhân viên Media
9. Nhân viên Design
10. Kế toán trưởng
11. Trưởng nhóm Thu mua

Có **21 source `NEEDS_REVIEW`** và 3 source `EXCLUDED`. Không có record `NEEDS_REVIEW` được ghi Production; không tự resolve, merge, overwrite hay seed các source này. Manifest executor chỉ gọi 11 candidate `READY`.

## Permission, scope và immutable rules

- Admin có recovery access KNL; quản trị framework/permission toàn hệ thống. Seed và assignment còn có backend guard `session.role === admin` fail-closed.
- Preset TBP/NV hiện không có `manage_framework`; không được seed/chỉnh assignment. People scope được enforce server-side trước filter client: `self`, danh sách `employee_code`, department/branch hoặc `all_company` theo grant hiện hành.
- `income_view` là capability nhạy cảm cũ, không phải nội dung KNL: Admin mặc định true nhưng có thể bị explicit override false; vai trò khác mặc định false và khi cấp phải có `incomeScope` rõ ràng. Không đổi/drop income view hoặc history cũ.
- Không đưa lương, bậc lương, 85% thử việc, income hay compensation vào framework/content/Survey KNL.
- Chỉ Draft chưa khóa được sửa. Published hoặc `is_locked=true` là bất biến; muốn chỉnh phải clone thành Draft version mới. Draft chưa được tham chiếu có thể hard delete; cấu trúc đã tham chiếu phải soft-disable/version mới. Delete guard đầy đủ khi có Survey là trách nhiệm Batch 3.

## API/service/file quan trọng

- Router/UI: `assets/js/phf-url-router.js`, `assets/js/knl/phf-knl-app.js`, `assets/css/phf-knl.css`.
- API parity: `api/data.js` và `server.js`.
- Framework/version: `lib/knl-frameworks.js`.
- Assignment/seed: `lib/knl-assignments.js`.
- Permission/scope: `lib/knl-permissions.js`, `lib/knl-scope.js`, `lib/knl-people.js`.
- Manifest chính thức: `assets/data/knl-source-manifest-2026-08-09.json`; generator `scripts/build-knl-source-manifest.js`.
- Tests: `scripts/test-knl-framework-batch1.js`, `scripts/test-knl-batch2.js`, `scripts/test-knl-permissions-scope.js`.
- Action Batch 1: list/get/create/save/clone/publish framework/version; CRUD/reorder/disable group-item-column và level content.
- Action Batch 2: preview/seed/list source manifests; list assignment targets/assignments; save assignment.

## Boundaries bắt buộc

- Checklist: chỉ đọc `checklist_employee_assignments`; không copy score, không update organization, không tạo assignment Checklist.
- Employee Master: không tạo master KNL, không sửa 5 bảng hồ sơ, import, sensitive fields hoặc organization mapping.
- Auth/account: không đổi session role, auth contract, account API hay permission preset thành chức danh/chức vụ.
- Không sửa Classroom, Training Hub, Checklist UI hoặc PHF AI ngoài integration read-only đã chốt.
- IA: một menu trái là một domain nghiệp vụ. “Gán & áp dụng” là tab/sub-navigation trong domain “Bộ KNL”; route compatibility `/admin/knl/gan-ap-dung` phải được giữ.

## Contract dự kiến Batch 3 — chưa implement

Batch 3 chỉ bắt đầu khi có yêu cầu riêng. Tối thiểu phải thiết kế Survey tham chiếu snapshot/version cố định; response gồm mức chọn, `Phù hợp / Chưa rõ / Không phù hợp`, góp ý; history/audit; Admin all-company, TBP đúng people scope, NV chỉ phiếu mình; version đã phát sinh Survey/Assessment bị khóa; delete guard chuyển từ hard delete sang version mới/soft-disable. Không retrofit Survey vào version theo cách làm thay đổi snapshot và không bắt đầu Assessment trong cùng batch nếu chưa được chốt.
