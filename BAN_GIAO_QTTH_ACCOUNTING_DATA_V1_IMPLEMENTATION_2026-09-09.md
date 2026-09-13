# QTTH — ACCOUNTING DATA V1 FOUNDATION · IMPLEMENTATION HANDOVER
Ngày: 2026-09-09 · Branch `feat/qtth-accounting-data-v1` (off `7b36b05`) · **NOT pushed** · LOCAL ONLY

Theo phê duyệt Operator/ChatGPT 2026-09-09 ("APPROVED TO CONTINUE"). Đã build toàn bộ
foundation + test offline trên file nguồn thật. Live-DB e2e là bước deployer (máy này
không có docker/local stack đang chạy).

---

## OUTPUT FINAL (handover §24)

```
ACCOUNTING_DATA_V1_FOUNDATION = PASS (offline)   ·   live-DB e2e = PENDING_DEPLOYER

ACCOUNTING_T07_SOURCE_ROWS     = 85975
ACCOUNTING_T07_DEBIT_ROWS      = 38768
ACCOUNTING_T07_COST_SCOPE_ROWS = 350
ACCOUNTING_T07_INCLUDED        = 299     amount = 1.003.597.227 VND
ACCOUNTING_T07_EXCLUDED        = 0       amount = 0            (54 dòng kết chuyển 911 nằm ở credit-side → debit-only loại sạch)
ACCOUNTING_T07_NEEDS_REVIEW    = 51      amount = 45.150.452 VND   (8 tài khoản)

UNIQUE_COST_ACCOUNTS          = 36
UNIQUE_DEPARTMENTS            = 6 (trên dòng cost-scope: BP01 BP02 CN1 CN2 CN4 + PHF-MKT)
OUT_OF_MASTER_DEPARTMENTS     = PHF-MKT

TOTAL_INCLUDED_AMOUNT        = 1.003.597.227 VND
TOTAL_REVIEW_AMOUNT          = 45.150.452 VND

COST_DICTIONARY_ROWS         = 170
COST_DICTIONARY_IMPORT       = PASS (parser offline; live import = e2e step)

CLASSIFICATION_ENGINE        = PASS   (14 rule, priority 10→90, SEED = migration seed 1:1)
EXCLUSION_ENGINE             = PASS   (contra_prefix 911 → EXCLUDE; 0 hit vì closing ở credit-side — guard vẫn active)
UNKNOWN_PRESERVATION         = PASS   (mọi cost-scope row có verdict; unknown → NEEDS_REVIEW, không drop)
DOUBLE_COUNT_GUARD           = PASS   (debit-only; 0 dòng normalized có Tk đối ứng 911)
RAW_FILE_PROVENANCE          = PASS   (sha256 + storage_ref, file .xlsx lưu nguyên trên PHF_HR_ATTACHMENT_ROOT)
VERSIONING                   = PASS   (import/import_file version; re-upload cùng sha = replay; confirm → supersede + delta)

RAW_ROWS_SAVED_AS_FACT       = 0      (chỉ 350 dòng cost-scope vào accounting.normalized; 85975 dòng nguồn KHÔNG lưu)

LOCAL_3000                   = READY (route + FE screen wired; browser gate = operator)

NORMALIZER_PAYROLL_CHANGED   = NO
SUPABASE_MAIN_WRITE          = NO
PROD_DB_CHANGE               = NO
PROD_DEPLOY                  = NO
PUSH                         = NO

TESTED_COMMIT   = 048f9d7 (feat/qtth-accounting-data-v1, NOT pushed)
TEST_DB         = none live — offline engine chạy trực tiếp trên phf-qtth-input/accounting_t07.xlsx
TEST_COUNTS     = scripts/qtth-accounting-v1-offline-checks.js → 24/24 PASS
                  regression: qtth-batch01 6/6 · qtth-batch01b render 26/26 · payroll offline 32/32 · payroll cost render 28/28
```

---

## 1. FILES CHANGED

### Migration (mới — CHƯA apply)
- `migrations/phf_hr_qtth_accounting_v1.sql` — schema `accounting`: `import`, `import_file`,
  `normalized`, `delta`, `cost_dictionary`, `cost_dictionary_entry`, `classification_rule`
  (+ 14 seed rule). Additive. Grants `phf_hr_app` only. Append-only trigger trên `delta`,
  no-TRUNCATE trên `normalized`. `phf_hr_owner` role guard, transactional, `ON_ERROR_STOP`.
- `migrations/phf_hr_qtth_accounting_v1_DOWN.sql` — data-destructive DOWN, review only.

### phf-hr-api service (mới)
- `services/phf-hr-api/lib/qtth-accounting-fast-xlsx.js` — **streaming** reader cho FAST export.
  Inflate ZIP entry `xl/worksheets/sheet1.xml` bằng `zlib.createInflateRaw()` theo chunk,
  cắt `<row>…</row>` incremental, chỉ đọc layout cột cố định A..K. Bộ nhớ hằng số
  (test: +~1–2 MB heap cho sheet 73 MB). xlsx-lite KHÔNG đọc được file này (`<sheet>`
  không self-closing + không có sharedStrings + 73 MB một mảnh).
- `services/phf-hr-api/lib/qtth-accounting-classify.js` — `SEED_RULES` (1:1 với migration seed)
  + `buildClassifier(rules)` (priority ASC, first match; unknown → NEEDS_REVIEW) +
  `inCostScope` (debit>0 & 641*/642*) + `isOutOfMasterDepartment`.
- `services/phf-hr-api/lib/qtth-accounting-normalize.js` — `runFunnel(buffer, {rules})`:
  stream → debit filter → cost scope → classify → giữ chỉ cost-scope rows → §16 preview report.
- `services/phf-hr-api/lib/qtth-accounting-dictionary.js` — parse "Danh mục phí" (xlsx-lite, file nhỏ).
- `services/phf-hr-api/lib/qtth-accounting-storage.js` — RAW file store (sha256, atomic, no URL, 32 MB cap).
- `services/phf-hr-api/lib/qtth-accounting.js` — service, 8 action:
  `accounting.uploadPreview / confirm / status / preview / listNormalized / listRules /
  importDictionary / dictionaryStatus`. Rules nạp từ DB, fallback SEED nếu bảng trống.

### Wiring
- `services/phf-hr-api/lib/qtth-service.js` — thêm vòng lặp wire `accountingService.ACTIONS`
  (cùng dev-lock + `requirePermissionManager` như payroll).
- `services/phf-hr-api/server.js` — error catch nhận `isAccountingError` & họ hàng.
- `api/_lib/qtth-actions.js` — `ACCOUNTING_ACTION_MAP` (7 action JSON nhỏ qua /api/data) +
  `accountingUploadPreviewViaBridge(session,{periodMonth,fileName,buffer})` export cho endpoint nhị phân.
- `api/_lib/qtth-accounting-endpoint.js` (mới) — endpoint nhị phân `POST /api/qtth-accounting-upload?period=YYYY-MM`,
  raw body .xlsx (~4 MB — KHÔNG lọt /api/data 1 MB), session manager/admin, forward qua bridge.
- `api/task-attachment.js` — thêm route marker `qtth-accounting-upload` (dùng chung function, giữ Vercel Hobby budget).
- `server.js` — route local `/api/qtth-accounting-upload`.
- `vercel.json` — rewrite `/api/qtth-accounting-upload` → `/api/task-attachment?__phf_route=qtth-accounting-upload`.

### Frontend
- `assets/js/qtth/phf-qtth-accounting.js` (mới) — màn "Dữ liệu chi phí kế toán":
  chọn kỳ · upload (endpoint nhị phân) · phễu lọc KPI · top tài khoản · bảng CHỜ RÀ SOÁT ·
  lý do loại trừ · phân bổ Mã bp (cảnh báo ngoài danh mục) · xác nhận/phiên bản ·
  drill-down INCLUDE/NEEDS_REVIEW (≤500 dòng, KHÔNG render 86k) · Danh mục phí · bộ quy tắc.
- `assets/js/qtth/phf-qtth-payroll.js` — dispatcher `sub === 'accounting'` → `phfQtthRenderAccounting`;
  landing card "Chứng từ kế toán" → active "Dữ liệu chi phí kế toán".
- `assets/js/phf-url-router.js` — route `/{admin,ql,hv}/qtth/truth-data/accounting`.
- `index.html` — `<script defer src="assets/js/qtth/phf-qtth-accounting.js?v=1.71.0_qtth_accounting_v1">`.
- `scripts/phf-check-js.js` — thêm vào `MANUAL_VERSIONED_ASSETS`.

### Tests / ops
- `scripts/qtth-accounting-v1-offline-checks.js` — 24 check trên file nguồn thật (no DB/network).
- `scripts/qtth-accounting-v1-live-local-e2e-dev.js` — live e2e (throwaway phf_hr_e2e, tunnel 15432).
- `scripts/deployer-apply-accounting-v1-throwaway.sh` — apply migration vào throwaway.
- `scripts/qtth-batch01-offline-checks.js` — nới parity check cho `accounting.*`.
- `.gitignore` — `+/phf-qtth-input/` (3 file nguồn Operator không vào git).

Route local: **`http://127.0.0.1:3000/admin/qtth/truth-data/accounting`** — "Dữ liệu chi phí kế toán".

---

## 2. SCHEMA / MIGRATION

`accounting.*` — additive, chưa apply ở đâu. Local/throwaway apply:
```
bash scripts/deployer-apply-accounting-v1-throwaway.sh        # trên máy có docker (ssh claude-phf)
```
KHÔNG PROD migration.

---

## 3. ACTUAL T07 FILTERING NUMBERS

| Bước | Dòng | Số tiền (VND) |
|---|---:|---:|
| Nguồn (không lưu) | 85.975 | — |
| Phát sinh Nợ | 38.768 | — |
| Trong phạm vi chi phí (641*/642* Nợ) | 350 | 1.048.747.679 |
| **Đưa vào (INCLUDE)** | **299** | **1.003.597.227** |
| **Chờ rà soát (NEEDS_REVIEW)** | **51** | **45.150.452** |
| Loại trừ (EXCLUDE) | 0 | 0 |

`normalized` rows lưu = 350. `RAW_ROWS_SAVED_AS_FACT = 0`.

---

## 4. ACCOUNTS NEEDING OPERATOR REVIEW (KTT)

51 dòng / 8 tài khoản — giữ đủ số tiền, chờ KTT map về chỉ tiêu QTTH nào (hoặc BC bổ sung Mã số):

| Tài khoản | Dòng | Số tiền | Ghi chú |
|---|---:|---:|---|
| `64177` | 3 | 13.231.657 | BC 641 dừng ở 64176 — "dịch vụ mua ngoài khác" (gồm 1 dòng PHF-MKT FB ads 9.494.109) |
| `6423`  | 11 | 11.786.155 | rollup 4 chữ số |
| `6414`  | 4  | 8.625.451  | rollup 4 chữ số |
| `6422`  | 12 | 6.835.270  | rollup 4 chữ số |
| `64274` | 11 | 2.032.077  | không có trong BC |
| `64188` | 8  | 1.294.000  | BC nhóm 18 dừng ở 64187 |
| `64273` | 1  | 1.195.084  | BC 642 dừng ở 64272 |
| `64178` | 1  | 150.758    | không có trong BC |

Xem chi tiết dòng: màn Accounting → "Xem dòng chờ rà soát", hoặc
`node scripts/qtth-accounting-v1-live-local-e2e-dev.js` (in drilldown).

---

## 5. OUT-OF-MASTER DEPARTMENT VALUES

`PHF-MKT` — KEEP + WARNING (không remap, không drop). Master: BP01 BP02 CN1 CN2 CN3 CN4.
Cột `accounting.normalized.ma_bp_out_of_master = true` cho các dòng này; preview report
liệt kê trong `warnings` + `totals.outOfMasterDepartments`.

---

## 6. REMAINING BLOCKERS

1. **Deployer**: `bash scripts/deployer-apply-accounting-v1-throwaway.sh` → rồi
   `node scripts/qtth-accounting-v1-live-local-e2e-dev.js` (cần tunnel 15432 + .env.test DEV + e2e db env).
2. **Browser gate** trên `http://127.0.0.1:3000/admin/qtth/truth-data/accounting`
   (START-PHF-LOCAL.cmd): upload `accounting_t07.xlsx` → kiểm phễu → xác nhận →
   drill-down → nhập `cost_dictionary.xlsx`.
3. **KTT** rà 8 tài khoản NEEDS_REVIEW ở mục 4 (≈ 45,75 tr).
4. **Operator xác nhận** PHF-MKT giữ nguyên; `cost_code = UNRESOLVED` toàn bộ cho V1.
5. `phf-check-js` full-repo lint — chạy nền, chưa có kết quả cuối khi viết bàn giao;
   `node -c` từng file mới đã PASS.

**STOP** — không tiếp tục sang reporting/dashboard.
