# PHF HR / PHF TASK — CUTOVER HANDOVER CHECKPOINT
**Ngày:** 2026-08-27 | **Đọc file này TRƯỚC KHI làm bất cứ gì. KHÔNG làm lại Gate 0/1/1B/1C/1D hay B1-B4 từ đầu.**

> ⚠️ **CẢNH BÁO QUAN TRỌNG NHẤT CỦA FILE NÀY:** phiên trước có đưa ra 1 khung report giả định B3/B4 đã PASS/CLOSED với "23/23 operations". **Điều đó KHÔNG đúng sự thật** — xem mục A. Handover này ghi đúng trạng thái thật, đã tự đọc lại toàn bộ lịch sử hội thoại + `git log`/`git status`/hash file trước khi viết, không suy đoán.

---

## A. EXECUTIVE STATUS (SỰ THẬT, không phải khung report được đề nghị)

```
Gate 0/1/1B/1C/1D (server company preparation) = CLOSED (PASS_WITH_LIMITATION ở vài mục — xem mục F)
B1 (schema baseline + Finding A/B validation)   = CLOSED
B2 (build phf_hr_verify: foundation + 2 remediation + category snapshot + ACL + parity capture) = CLOSED, PASS
B3 (real-DB verify 14 operations)               = IN_PROGRESS — CHƯA CLOSED
B4 (drop phf_hr_verify, verify residue=0)       = NOT_STARTED

REAL_DB_VERIFY = PARTIAL
  - Rerun #1 (candidate hash 5f787d23...): FAIL tại operation #1 (createDraftTask), SQLSTATE 23502, priority NULL.
  - Rerun #2 (candidate hash ab0ae951...): 11 operation đầu + Finding1 (4/4) + T1 cleanup PASS,
    sau đó FAIL tại T2 fixture (TASK_DEADLINE_REQUIRED — lỗi SCRIPT, không phải write-path).
  - Sau rerun #2, đã sửa B3 script (T2/T3 thiếu flowType/deadline), commit 564654f.
  - CHƯA CÓ rerun #3. KHÔNG có bằng chứng "toàn bộ 14 operation PASS" trong bất kỳ lần chạy nào.

OPERATIONS_PASS = KHÔNG XÁC ĐỊNH ĐƯỢC CON SỐ CUỐI — lần gần nhất có evidence (rerun #2) xác nhận PASS: 
  createDraftTask(T1)+idempotency replay, publish, progress, comment, add/remove link, add/remove related,
  transfer primary, change deadline, permission assignment, T1 cleanup cancel, + Finding1 4/4 điểm kiểm actor_account_id.
  KHÔNG có bằng chứng cho: T2 cancel (op #12), T3 complete/reopen/cancel (op #13/#14).

VERIFY_DB_DROPPED = NO — chưa từng chạy DROP DATABASE phf_hr_verify. Nhiều khả năng database này VẪN CÒN TỒN TẠI trên server, có thể còn chứa fixture T1 (đã cancelled) từ rerun #2.
VERIFY_RESIDUE = KHÔNG XÁC ĐỊNH được là 0 — vì B4 chưa chạy.

TASK_CUTOVER = NOT_DONE
DEPLOYMENT  = NOT_DONE
PUSH        = NOT_DONE
```

**Việc đầu tiên chat mới cần làm KHÔNG PHẢI là viết cutover plan — mà là chạy B3 rerun #3 tới khi PASS thật 14/14, rồi mới B4.** Xem mục I.

---

## B. EXACT VERIFIED CANDIDATE

Toàn bộ commit local, **chưa push**, trên branch `task/create-ticket-v1-local`, thứ tự cũ→mới:

| Commit | Nội dung |
|---|---|
| `875480b` | Safety-net: lưu lại toàn bộ code write-path/read-path/attachment đã có sẵn trên đĩa (chưa track git) |
| `f415245` | Sửa 1 test stale (category NOT_FOUND error code) |
| `d41a4ae` | **Finding 1 fix**: bổ sung `assigned_by_account_id`/`added_by_account_id` còn thiếu ở 4 chỗ INSERT |
| `f9f5fd5` | Chuẩn bị plan B1-B4 (Method B isolated verify DB) — chưa chạy |
| `c94593f` | Chuẩn bị query validate Finding A (encoding) + Finding B (data classification) — chưa chạy |
| `bb3bf04` | Migration remediation #1: grant parity (4 quyền thiếu) |
| `8c85093` | Migration remediation #2: actor-identity nullability (2 cột) |
| `14b0463` | **Fix bug thật #1**: `createDraftTask` priority default (candidate code + regression test) |
| `564654f` | **Fix bug thật #2**: B3 script T2/T3 thiếu `flowType`/`deadline` (chỉ script, không đụng candidate) |

**Commit `14b0463` là candidate logic cuối cùng cho write-path** (`lib/task-write.js`) — đây là commit chứa TOÀN BỘ fix đã biết tính đến giờ (Finding 1 + priority default). `564654f` chỉ sửa script verify, không sửa candidate.

**Hash đã tự tính lại và xác nhận khớp ngay trước khi viết file này (`sha256sum`, live):**
```
lib/task-write.js (candidate cuối)          = ab0ae951f2a9e22667965d5d1f97266e36ac31a2aa0b787790b03fe1c6db8973
lib/db.js (không đổi từ đầu, chưa cần sửa)  = 048faf8fa8df1c08c465954d4fbedae7f94ce678a7ff1fc8cd2069aa0eec1d4b
phf-hr-verify-b3-14-ops-dev.js (script cuối) = 73ccea4e28daaee5f8abff74cd0ac628cf859f4f5766796eae0874436a1b9e4b
```

---

## C. FINDINGS + FIXES (đã đóng, có evidence)

### 1. Finding 1 (HIGH) — actor_account_id bị bỏ sót
4 chỗ INSERT (`createDraftTask` primary assignee, `addTaskRelated`, `transferTaskPrimary`, `addTaskLink`) chỉ ghi `*_employee_code`, bỏ sót `*_account_id` — mất audit trail thật cho mọi actor Admin-only.
**FIXED** (commit `d41a4ae`). **Real-DB đã verify PASS 4/4** trong rerun #2 (evidence: `1c_FINDING1_...`, `5b_FINDING1_...`, `7b_FINDING1_...`, `9b_FINDING1_...` — tất cả PASS trước khi B3 fail ở T2).

### 2. Priority default bug (HIGH, real-DB-only, mock không bắt được)
`createDraftTask` không normalize `priority` — omit/blank → `NULL` tường minh trong INSERT → vô hiệu hoá `DEFAULT 'thuong'` của cột → SQLSTATE 23502.
**FIXED** (commit `14b0463`, khớp lại đúng semantics `text(input.priority) || 'thuong'` từ `api/_lib/task-core.js:1022`). Regression test mock-harness PASS (3 case mới, 316/316 tổng). **Real-DB: đã verify PASS ở rerun #2** (operation #1 pass sau fix — không fail lại ở priority nữa).

### 3. Grant-parity drift
`phf_hr` (127 grant) vs `phf_hr_verify` build từ foundation (123 grant) — thiếu 4 quyền: `categories.DELETE`, `code_counters.INSERT`, `links.UPDATE`, `permission_grants.UPDATE` cho `phf_hr_app`.
**Remediation migration mới** (`migrations/phf_hr_task_runtime_grants_remediation_v1.sql`, forward-only, không sửa `phf_hr_task_foundation_v1.sql`). **Parity đã verify PASS = 127/127** sau khi apply lên `phf_hr_verify` (B2).

### 4. Actor-identity schema drift
`permission_grants.created_by_employee_code` và `permission_grant_history.changed_by_employee_code`: Production = NULLABLE (đã sửa tay, không migration nào ghi lại), foundation local = NOT NULL. Production nullable là ĐÚNG (cần cho actor Admin-only, có evidence 7 dòng thật trên Production đã ghi thành công với employee_code NULL).
**Remediation migration mới** (`migrations/phf_hr_task_actor_identity_remediation_v1.sql`, forward-only). **Parity đã verify PASS** (`is_nullable=YES` cả 2 cột, constraintdef khớp Production character-for-character).

### 5. Encoding Finding A — FALSE ALARM
`notifications.priority` default/CHECK hiển thị mojibake (`'Trung bÃ¬nh'`) trên terminal — tự giải mã hex byte-level (`C3AC`="ì" đúng UTF-8, `E1BAA9`="ẩ" đúng UTF-8) xác nhận **bytes lưu trong DB hoàn toàn đúng UTF-8**, chỉ là lỗi hiển thị terminal/truyền tải. `PHF_HR_ENCODING = PASS`. Không cần fix gì.

### 6. `phf_hr` contamination — CONFIRMED_TEST_ONLY, KHÔNG cleanup trong checkpoint này
10 task + toàn bộ assignees/events/comments/links/attachments liên quan + 3 category dư (`ZZGATE12*`) + 4 permission_assignments + 7 permission_grants trên **Production `phf_hr`** — đã tự đọc raw data, phân loại: **CONFIRMED_TEST = 10/10 task (100%)**, **CONFIRMED_REAL = 0**, **UNKNOWN = 0**. Bằng chứng: title có `[TEST...]`, actor code dạng `TEST_*`/`ZZGATE12*` (không khớp định dạng employee code thật), reason field tường minh `"(fixture only)"`. **Lưu ý:** 5/10 task đang ở status `published` (không phải cancelled) — residue "sống", chưa dọn. **KHÔNG tự cleanup trong checkpoint này** — cần GO riêng.

---

## D. REPRODUCIBLE BUILD RECIPE (đã verify parity ở B2, chưa verify hết B3)

Thứ tự đúng để dựng `phf_hr_verify` hoặc môi trường sạch tương lai:
```
1. CREATE DATABASE <tên_db>;
2. psql -d <tên_db> -f migrations/phf_hr_task_foundation_v1.sql
3. psql -d <tên_db> -f migrations/phf_hr_task_runtime_grants_remediation_v1.sql
4. psql -d <tên_db> -f migrations/phf_hr_task_actor_identity_remediation_v1.sql
5. psql -d <tên_db> -f migrations/phf_hr_task_categories_snapshot_v1.sql
6. GRANT CONNECT ON DATABASE <tên_db> TO phf_hr_app;
   GRANT CONNECT ON DATABASE <tên_db> TO phf_hr_runtime;
   REVOKE CONNECT, TEMPORARY ON DATABASE <tên_db> FROM PUBLIC;
7. Capture schema (services/phf-hr-api/phf-hr-verify-b1-schema-inspect-dev.sql) → tự diff với phf_hr baseline
8. B3 real-DB verify (services/phf-hr-api/phf-hr-verify-b3-14-ops-dev.js, PHF_HR_DB_NAME phải đúng tên_db, KHÔNG BAO GIỜ = phf_hr)
9. DROP DATABASE <tên_db>; (chỉ khi mục đích là môi trường tạm — KHÔNG áp dụng nếu đây là bước chuẩn bị Production thật)
```
Bước 2-6 = **PASS thật, có evidence** (B2 CLOSED). Bước 7 = **PASS thật** (schema parity capture đã đối chiếu). Bước 8 = **CHƯA HOÀN TẤT** (xem mục A). Bước 9 = **CHƯA CHẠY**.

---

## E. REAL-DB VERIFY EVIDENCE (chỉ ghi những gì THẬT có)

```
Rerun #1 (hash 5f787d23...): FAIL op#1 createDraftTask, SQLSTATE 23502 (priority NULL)
Rerun #2 (hash ab0ae951...):
  setup_createTaskCategory = PASS
  1_createDraftTask (T1, ADMIN actor) = PASS
  1b_replay_no_duplicate = PASS
  1c_FINDING1_createDraftTask_account_id = PASS
  2_publishTask = PASS
  3_updateTaskProgress = PASS
  4_addTaskComment = PASS
  5_addTaskLink = PASS
  5b_FINDING1_addTaskLink_account_id = PASS
  6_removeTaskLink_event = PASS
  7_addTaskRelated = PASS
  7b_FINDING1_addTaskRelated_account_id = PASS
  8_removeTaskRelated = PASS
  9_transferTaskPrimary = PASS
  9b_FINDING1_transferTaskPrimary_account_id = PASS
  10_changeTaskDeadline = PASS
  11_setTaskPermissionAssignment = PASS
  T1_cleanup_cancel = PASS
  12_cancelTask (T2) = FAIL — createDraftTask T2 thiếu deadline → TASK_DEADLINE_REQUIRED (lỗi SCRIPT, đã fix ở 564654f)
  13_completeTask, 14_reopenTask, T3_cleanup_cancel = CHƯA CHẠY TỚI

T1 (fixture đầu tiên): rất có thể vẫn còn trên phf_hr_verify ở trạng thái cancelled (chưa xác nhận lại — cần B4/kiểm tra trước khi rerun #3 để tránh nhầm với dữ liệu rerun mới nếu re-run không dùng RUN_TAG mới).
Category fixture verify + permission assignment fixture: đã tạo ở rerun #2, KHÔNG có cleanup, còn tồn tại trên phf_hr_verify.
```

---

## F. CURRENT SERVER ARCHITECTURE (chỉ ghi có evidence, không suy đoán RAM/CPU vật lý)

```
Server: VM (VirtualBox/KVM xác nhận qua lspci+DMI+systemd-detect-virt), Ubuntu 24.04.4, PostgreSQL 17.10.
RAM/CPU VẬT LÝ HOST: KHÔNG BAO GIỜ xác nhận được trong toàn bộ phiên (guest không có kênh nào đọc host) —
  KHÔNG bịa số liệu, đây là NO_ACCESS thật, ghi nhận là operational condition, không phải blocker cutover.
Guest: 1.9GiB RAM / 2 vCPU (đã đo nhiều lần, ổn định trong các cửa sổ ngắn quan sát được).

Docker containers (3):
  phf-postgres  — PostgreSQL 17.10, databases: phfcrm, phf_hr (+ phf_hr_verify nếu chưa DROP)
  phf-hr-api    — Node/Kestrel? KHÔNG, đây là Node (task-write.js candidate), publish 127.0.0.1:11000
  phf-api (CSKH)— ASP.NET Core/Kestrel (.NET, xác nhận Server: Kestrel header + cgroup docker), publish 0.0.0.0:10000

Port 5432 (Postgres): bind 0.0.0.0/[::], firewall DOCKER-USER đã APPLY 2 rule (ACCEPT tailscale0, DROP non-tailscale)
  — deployer báo "đã chạy nhưng chưa test public-block từ nguồn ngoài Tailscale" → FIREWALL_5432 = PARTIAL, chưa full PASS.
Port 11000 (phf-hr-api): chỉ 127.0.0.1, không expose ngoài — an toàn theo thiết kế.
Port 10000 (CSKH): 0.0.0.0, qua nginx reverse proxy api.phuhoafresh.info.vn.

phf_hr / phfcrm isolation: REVOKE CONNECT,TEMPORARY FROM PUBLIC đã áp cho cả 2 database (Gate S2, xác nhận lại B1.2).
  KNOWN LIMITATION chưa vá: CSKH runtime role = postgres (cluster superuser) → bypass mọi ACL, ngoài phạm vi Task cutover.

Runtime role behavior: phf_hr_runtime (LOGIN, NOINHERIT) → SET LOCAL ROLE phf_hr_app trong mỗi transaction
  (pattern "zero privilege trước SET ROLE", xác nhận đúng thiết kế qua B3 rerun #2 chạy thành công 17 operation đầu).

Backup: pg_dumpall + /opt/phf-crm + /data/phf-media qua rclone Google Drive, retention 30 ngày, lịch thật KHÔNG xác
  nhận được (không nằm trong crontab deployer hay /etc/cron.d — nhiều khả năng crontab root, chưa đọc được).
  /home/phf-storage (file đính kèm PHF-HR tương lai) CHƯA nằm trong backup scope — gap CHƯA vá.
```

---

## G. DO NOT TOUCH (bắt buộc giữ nguyên)

```
api/_lib/task-core.js   — CPU WIP cũ, +76 dòng, uncommitted, KHÔNG reset/checkout/stash/commit đè
api/data.js             — CPU WIP cũ, +80 dòng, uncommitted, KHÔNG reset/checkout/stash/commit đè
```
- **Không quay lại CPU 97% forensic** — đã CLOSED_WITHOUT_ROOT_CAUSE, không có evidence mới thì không đào lại.
- **Không tự cleanup 10 task/3 category/4 permission_assignments/7 permission_grants test residue trên `phf_hr`** — đã phân loại CONFIRMED_TEST nhưng cleanup cần GO riêng.
- **Không sửa WebApp CSKH** (container `phf-api`, port 10000).
- **Không chạm `phfcrm`** dưới bất kỳ hình thức nào.
- **Không chạy migration nào ngoài 4 file đã liệt kê ở mục D** mà chưa có GO riêng.
- **Không push, không deploy** nếu chưa có GO tường minh.
- **Không tự coi B3/B4 là PASS/CLOSED** chỉ vì đã có nhiều fix — cần rerun thật và thấy đủ 14/14 operation PASS trong CÙNG 1 lần chạy, rồi mới sang B4.

---

## H. CUTOVER PLAN — CHỈ PLAN, CHƯA EXECUTE

**Điều kiện tiên quyết CHƯA đạt:** B3 rerun sạch 14/14 + B4 DROP thành công + residue=0. Cutover Production KHÔNG được bắt đầu trước khi 2 điều kiện này có evidence thật.

### Files cần deploy khi tới lúc (candidate source = commit `14b0463`, KHÔNG phải bất kỳ commit nào khác)
```
services/phf-hr-api/lib/db.js
services/phf-hr-api/lib/task-write.js       ← candidate đã fix Finding1 + priority (hash ab0ae951...)
services/phf-hr-api/lib/task-read.js
services/phf-hr-api/lib/task-query-executor.js
services/phf-hr-api/lib/attachment-policy.js
services/phf-hr-api/lib/attachment-service.js
services/phf-hr-api/lib/attachment-storage.js
services/phf-hr-api/lib/auth-middleware.js
services/phf-hr-api/lib/logger.js
services/phf-hr-api/lib/config.js
services/phf-hr-api/server.js
services/phf-hr-api/package.json / package-lock.json
```

### Migration cần APPLY lên Production `phf_hr` — PHÂN BIỆT RÕ, KHÔNG TỰ GIẢ ĐỊNH
```
CẦN APPLY THẬT (Production hiện CHƯA có state này):
  Không có — cả 2 remediation (grant-parity, actor-identity) đều đóng gap giữa
  foundation-file và Production, mà PRODUCTION ĐÃ CÓ SẴN state đúng (chỉnh tay từ trước,
  không qua migration file nào). Chạy 2 file này lên `phf_hr` sẽ là NO-OP (GRANT/ALTER
  COLUMN DROP NOT NULL đều idempotent) — AN TOÀN nếu lỡ chạy, nhưng KHÔNG BẮT BUỘC vì
  Production đã đúng trạng thái đích rồi.

DÙNG LÀM RECIPE REPRODUCIBLE (cho môi trường mới/tương lai), KHÔNG PHẢI mutation cần thiết cho Production hiện tại:
  phf_hr_task_foundation_v1.sql              — Production đã có (Gate S2, 24/08)
  phf_hr_task_runtime_grants_remediation_v1.sql — Production đã có state đúng sẵn (chỉnh tay)
  phf_hr_task_actor_identity_remediation_v1.sql — Production đã có state đúng sẵn (chỉnh tay)
  phf_hr_task_categories_snapshot_v1.sql     — Production đã có 13 category

MUTATION THẬT CÒN THIẾU trên Production (không phải schema, là runtime):
  - services/phf-hr-api container cần redeploy với candidate code mới (hiện container đang chạy
    bản NÀO chưa xác nhận — cần so hash /app/lib/task-write.js trong container TRƯỚC khi deploy,
    đã có lệnh chuẩn bị: `docker exec phf-hr-api sha256sum /app/lib/task-write.js /app/lib/db.js`)
  - main app (api/data.js) hiện CHƯA gọi phf-hr-api cho write-path — toàn bộ 14 operation vẫn
    đi qua api/_lib/task-core.js (Supabase) — đây là phần LỚN NHẤT còn thiếu cho cutover thật,
    ngoài phạm vi các gate đã làm (B1-B4 chỉ verify phf-hr-api viết đúng, CHƯA đấu nối main app
    gọi sang phf-hr-api cho ghi dữ liệu Task)
```

### Server path/container/image target
```
Database: phf_hr (KHÔNG phải phf_hr_verify — đó chỉ là môi trường test tạm)
Container: phf-hr-api (docker-compose.yml đã có, publish 127.0.0.1:11000)
```

### Build/restart strategy tối thiểu (CHƯA làm, chỉ ghi kế hoạch)
```
1. Backup phf_hr thật (pg_dumpall hoặc pg_dump -d phf_hr) trước khi đổi bất cứ gì
2. docker cp hoặc rebuild image với candidate code mới vào phf-hr-api
3. docker restart phf-hr-api (hoặc docker-compose up -d --build)
4. Smoke test ngay (xem dưới) trước khi coi là xong
```

### Smoke tests (tối thiểu, CHƯA chạy)
```
- GET /healthz → 200, target đúng
- Auth gate: request không có Bearer token → 401 (đã có sẵn 62 test route mock-harness cover case này)
- 1 lần gọi thật createDraftTask qua API (không phải trực tiếp task-write.js) → xác nhận response đúng shape
- 1 lần gọi thật listTasks/read path → xác nhận đọc được task vừa tạo
- Category CRUD (Gate 12) smoke
- Permission assignment smoke
```

### CSKH regression check (bắt buộc trước khi coi cutover xong)
```
- curl https://api.phuhoafresh.info.vn/ → mã trạng thái không đổi so với trước deploy
- Xác nhận port 10000 không bị ảnh hưởng (deploy chỉ đụng container phf-hr-api, không đụng phf-api)
```

### F5/router liên quan frontend
```
Main app (assets/js/task/phf-task-app.js) hiện gọi POST /api/data → api/data.js → task-core.js (Supabase).
Việc nối sang phf-hr-api cho WRITE path (không chỉ read-bridge đã có sẵn cho listTasks) CHƯA làm —
đây là 1 hạng mục riêng, lớn, ngoài phạm vi B1-B4, cần thiết kế/GO riêng trước khi động tới.
```

### Rollback (nếu cutover thật từng chạy và cần lùi lại)
```
docker-compose down phf-hr-api (hoặc restart lại image cũ nếu đã tag version)
KHÔNG có DB rollback cần thiết nếu chỉ redeploy container (không có DB migration nào chạy ở bước cutover container)
Nếu đã lỡ chạy 2 remediation migration lên phf_hr thật (dù NO-OP theo phân tích trên) và muốn rollback:
  KHÔNG có file _DOWN.sql cho 2 remediation này — cần viết riêng nếu thật sự cần (chưa có, vì đánh giá là an toàn/no-op)
```

### Stop conditions
```
- CSKH health check FAIL sau deploy → rollback ngay, không debug trên Production
- Bất kỳ smoke test nào FAIL → STOP, không tiếp tục, không tự sửa trên Production
- Nếu B3 rerun #3 (trên phf_hr_verify) còn FAIL bất kỳ operation nào → KHÔNG được tiến tới cutover
```

---

## I. EXACT NEXT STEP

**Review final cutover plan + candidate diff against current server/container, then request GO before any Production deploy.**

Cụ thể hơn (không mâu thuẫn với câu trên, chỉ làm rõ trình tự): bước kỹ thuật đầu tiên cần làm trước khi có gì để "review" là **chạy B3 rerun #3** (candidate hash `ab0ae951...`, script hash `73ccea4e...`, đã stage sẵn quy trình ở mục D bước 8) cho tới khi PASS thật 14/14, rồi **B4** (DROP DATABASE phf_hr_verify, xác nhận residue=0) — 2 bước này chưa xong nên "final cutover plan" ở mục H vẫn chỉ là khung, chưa phải kế hoạch đã verify đầy đủ.

---

## J. NEW CHAT STARTER PROMPT

```
Đọc file PHF_HR_TASK_CUTOVER_HANDOVER_2026-08-27.md trước khi làm bất cứ gì.

KHÔNG làm lại Gate 0/1/1B/1C/1D hay B1/B2 — đã CLOSED, có evidence trong file.
KHÔNG tự suy đoán B3/B4 là PASS/CLOSED — file đã ghi rõ B3 đang IN_PROGRESS (2 bug thật đã
tìm và fix, nhưng CHƯA có 1 lần rerun nào PASS đủ 14/14), B4 CHƯA chạy lần nào.

Giữ nguyên DO NOT TOUCH (mục G) — đặc biệt api/_lib/task-core.js và api/data.js (CPU WIP cũ,
uncommitted, KHÔNG reset/checkout/stash/commit đè). KHÔNG quay lại CPU forensic. KHÔNG tự
cleanup test residue trên phf_hr Production. KHÔNG chạm phfcrm/CSKH.

EXACT NEXT STEP: chạy B3 rerun #3 (candidate services/phf-hr-api/lib/task-write.js hash
ab0ae951f2a9e22667965d5d1f97266e36ac31a2aa0b787790b03fe1c6db8973, script
phf-hr-verify-b3-14-ops-dev.js hash 73ccea4e28daaee5f8abff74cd0ac628cf859f4f5766796eae0874436a1b9e4b)
trên phf_hr_verify cho tới khi PASS thật 14/14, rồi chạy B4 (DROP DATABASE, verify residue=0).
Chỉ sau khi có evidence thật 2 việc đó mới bắt đầu review cutover plan (mục H trong file
handover) và xin GO cho bất kỳ Production deploy nào.

KHÔNG deploy/push nếu chưa có GO tường minh. Chỉ READ-ONLY/chuẩn bị cho tới khi có GO cho bước
mutation cụ thể.
```
