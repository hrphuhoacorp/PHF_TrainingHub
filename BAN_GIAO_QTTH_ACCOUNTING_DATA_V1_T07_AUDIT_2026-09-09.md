# QTTH — ACCOUNTING DATA V1 FOUNDATION · T07/2026 PILOT AUDIT + SCHEMA PROPOSAL
Ngày: 2026-09-09 · LOCAL only · Chưa build pipeline — DỪNG ở gate "schema proposal first"

---

## STATUS

`ACCOUNTING_DATA_V1_FOUNDATION = PARTIAL` — chỉ mới hoàn tất **Section 17 (T07 pilot audit)** +
inspect 3 file nguồn + **Section 18 schema proposal**. Chưa viết parser/pipeline/UI/migration
vì handover yêu cầu *"If new DB schema/tables are required: proposal first."* → chờ Operator duyệt.

Không có thay đổi nào tới PROD / Supabase / Payroll / deploy / push.

---

## 1. FILES INSPECTED (đọc trực tiếp từ disk, không commit)

| File | Vai trò | Kết quả inspect |
|---|---|---|
| `phf-qtth-input/accounting_t07.xlsx` | FAST transaction source T07 | 1 sheet "Sheet1", **85.975 data rows**, 11 cột A–K, header ở dòng 5, **inline strings** (không có sharedStrings.xml), sheet1.xml = 73 MB |
| `phf-qtth-input/cost_dictionary.xlsx` | FAST Cost Dictionary / Danh mục phí | 1 sheet, **170 mã phí**, header dòng 3: `Mã phí · Tên phí · Bộ phận · Nhóm 1..3 (+Tên) · Ghi chú` |
| `phf-qtth-input/bc_chi_phi_qtth.xlsx` | KTT management-cost reference (KHÔNG phải transaction source) | 1 sheet "BAO CÁO QUAN TRI", 61 rows; cột `STT · Chỉ tiêu · Mã số` + 6 chi nhánh × (KH/TH/%). Liệt kê **~53 tài khoản 641xx / 642xx** kèm nhãn tiếng Việt |

**gitignore**: đã thêm `/phf-qtth-input/` (verified `git check-ignore` PASS). 3 file KHÔNG vào git.

### xlsx-lite KHÔNG đọc được accounting_t07.xlsx
`services/phf-hr-api/lib/xlsx-lite.js` fail `XLSX_NO_SHEET` trên file FAST (đọc tốt 2 file nhỏ).
Nguyên nhân đang nghi: file 73 MB một mảnh + không có sharedStrings + style/rels layout của FAST.
→ Audit này dùng **streaming XML row-parser riêng** (`unzip -p | regex <row>…</row>`), không phụ thuộc lib.
→ **Quyết định cần Operator**: pipeline thật nên (a) fix xlsx-lite cho FAST layout, hay (b) parser
streaming riêng cho nguồn FAST (khuyến nghị (b) — 86k rows/73MB không hợp với reader load-toàn-bộ).

---

## 3. ACTUAL T07 FILTERING NUMBERS (tính lại từ file, KHÔNG lấy số cũ trong chat)

```
ACCOUNTING_T07_SOURCE_ROWS      = 85975      (dòng dữ liệu, sau header dòng 5)
ACCOUNTING_T07_DEBIT_ROWS       = 38768      (Phát sinh Nợ > 0)
ACCOUNTING_T07_CREDIT_ROWS      = 38768      (Phát sinh Có > 0)
ACCOUNTING_T07_641_ROWS         = 238        (TK bắt đầu 641, debit-side)
ACCOUNTING_T07_642_ROWS         = 112        (TK bắt đầu 642, debit-side)
ACCOUNTING_T07_COST_SCOPE_ROWS  = 350        (641*/642* Nợ > 0 — broad scope)

UNIQUE_COST_ACCOUNTS            = 36
UNIQUE_DEPARTMENTS              = 7          (BP01 BP02 CN1 CN2 CN3 CN4 PHF-MKT)
OUT_OF_MASTER_DEPARTMENTS       = { "PHF-MKT": 7 rows (1 là cost thật: 64177 quảng cáo FB 9.494.109) }

TOTAL 641*/642* DEBIT AMOUNT    = 1.048.747.679 VND  (giữ nguyên precision nguồn)
```

Mã ct phân bố (chỉ là provenance, KHÔNG lọc theo): `HD 66320 · PN 6312 · PX 5996 · BC 5882 · PKT 1156 · PT 218 · PC 66 · BN 16 · CO 2`

### Phân loại sơ bộ 36 tài khoản cost-scope (dựa vào BC Chi Phí QTTH làm reference)

**INCLUDE — khớp Mã số trong BC Chi Phí QTTH (28 tài khoản):**
`64111 64112 64115 64121 64123 64131 64132 64133 64135 64171 64172 64174 64175 64176 64183 64186 64187`
`64211 64212 64215 64271 64272 64281 64283 64284 64286 64287 64288`

**NEEDS_REVIEW — 641/642 có phát sinh Nợ nhưng KHÔNG có Mã số tương ứng trong BC (8 tài khoản):**

| TK | Rows | Debit amount | Ghi chú |
|---|---:|---:|---|
| `6414` | 4 | 8.625.451 | rollup 4 chữ số — BC chỉ có 64141 khấu hao |
| `6422` | 12 | 6.835.270 | rollup 4 chữ số |
| `6423` | 11 | 11.786.155 | rollup 4 chữ số |
| `64177` | 3 | 13.231.657 | BC 641 dừng ở 64176; 64177 = "dịch vụ mua ngoài khác" (FB ads) |
| `64178` | 1 | 150.758 | không có trong BC |
| `64188` | 8 | 1.294.000 | BC 641 nhóm 18 dừng ở 64187 |
| `64273` | 1 | 1.195.084 | BC 642 dừng ở 64272 |
| `64274` | 11 | 2.032.077 | không có trong BC |

→ **UNKNOWN KHÔNG DROP** — tất cả 8 vào `NEEDS_REVIEW`, giữ đủ amount + provenance, chờ KTT xác nhận
map về chỉ tiêu nào (hoặc BC bổ sung Mã số).

**Top tài khoản theo debit amount:** `64111` 339.766.704 (lương, 1 dòng, contra 3341) · `64211` 222.974.625 (lương QLDN) · `64175` 121.000.000 (thuê mặt bằng) · `64172` 90.468.896 (điện) · `64115` 40.637.500 (BHXH) · `64272` 39.409.649 (phần mềm) · `64121` 34.443.481 (105 dòng, NVL gói quà).

---

## 4. DOUBLE-COUNT / CLOSING-ENTRY EVIDENCE

- **54 dòng credit-side 641/642** = bút toán *"Kết chuyển chi phí bán hàng vào KQKD – 911, 641"* (PKT).
  Rule **debit-only** loại sạch 54 dòng này → không double-count.
- Trong 350 dòng cost-scope debit: **KHÔNG dòng nào** có Tk đối ứng = `911` → không có kết chuyển
  lọt vào debit side. Contra thực tế toàn TK hợp lệ: `3311` (phải trả NCC), `1111/112xxx` (tiền),
  `1531/1532/1561` (kho), `3341/3342` (lương). ⇒ `DOUBLE_COUNT_GUARD` khả thi bằng debit-only + reject contra 911.

---

## 5. OUT-OF-MASTER DEPARTMENT VALUES

- `PHF-MKT` — 7 dòng (1 cost thật `64177` 9.494.109; phần còn lại là dòng closing/subtotal).
  Rule: **KEEP + WARNING**, không drop, không rename. Master hiện có: BP01 BP02 CN1 CN2 CN3 CN4.
- Có dòng subtotal của FAST: Tài khoản/Mã ct rỗng nhưng có amount + `Mã bp = PHF-MKT` (28.482.327).
  → filter loại (không có Tài khoản ⇒ không phải transaction line).

---

## 6. COST DICTIONARY — KHÔNG CÓ JOIN KEY (Section 12 xác nhận)

- 170 mã phí, format `A1-100-000` / `THU.008` (letter-group-serial), **KHÔNG phải số tài khoản**.
- Nhóm 1: `A DOANH THU 48 · B GIÁ VỐN 632 9 · C CHI PHÍ TÀI CHÍNH 635 4 · THU-CHI DÒNG TIỀN 31 · D CHI PHÍ BÁN HÀNG 641 45 · E CHI PHÍ QLDN 642 33`.
- File **không có cột "Tài khoản"**; `Bảng kê chứng từ theo bộ phận` **không expose Mã phí** cùng dòng.
- ⇒ Batch này: **`cost_code = NULL / UNRESOLVED`** cho mọi normalized row. Dictionary vẫn build sẵn,
  versionable. Keyword/diễn giải chỉ dùng làm *suggestion/warning* sau này, KHÔNG phải truth.

---

## 2. SCHEMA PROPOSAL (Section 18 — additive, chưa apply)

Schema `accounting` (Company PostgreSQL, cùng datastore với `qtth` / `payroll`; local/throwaway only).
Pattern bám sát `payroll.import` / `payroll.import_file` / `payroll.normalized`.

```
accounting.import            -- 1 dòng / kỳ (period_month), current_file_id
  id, period_month (unique, '2026-07'), current_file_id, created_by_account_id, created_by_name, created_at

accounting.import_file       -- mỗi lần upload = 1 version, file RAW giữ nguyên trên disk (sha256)
  id, import_id FK, version, status ('draft'|'confirmed'|'superseded'),
  file_name, sha256, byte_size, storage_ref, sheet_name,
  source_row_count, debit_row_count, cost_scope_row_count,
  included_row_count, excluded_row_count, needs_review_row_count,
  included_amount NUMERIC(18,2), needs_review_amount NUMERIC(18,2),
  report JSONB,  -- preview aggregates (top accounts, warnings, dept breakdown…)
  created_by_account_id, created_by_name, created_at, confirmed_at

accounting.normalized        -- CHỈ dòng cost đã filter (debit-side, trong cost-scope). ~350 rows / kỳ, KHÔNG 86k.
  id, file_id FK, source_row_index INT,
  ngay_ct DATE, ma_ct TEXT, so_ct TEXT, ma_khach TEXT, ten_khach TEXT, dien_giai TEXT,
  tai_khoan TEXT, tk_doi_ung TEXT, phat_sinh_no NUMERIC(18,2),  -- source amount, immutable
  ma_bp TEXT, ma_bp_out_of_master BOOL,
  classification TEXT ('INCLUDE'|'EXCLUDE'|'NEEDS_REVIEW'),
  classified_by_rule_id TEXT, rule_version TEXT,
  cost_code TEXT NULL,           -- luôn NULL trong V1 (không có join key)
  warnings JSONB,
  created_at

accounting.cost_dictionary       -- reference data, versionable
  id, version INT, source_sha256, imported_at, imported_by_name, is_current BOOL
accounting.cost_dictionary_entry
  id, dictionary_version_id FK, ma_phi TEXT, ten_phi TEXT, bo_phan TEXT,
  nhom1 TEXT, ten_nhom1 TEXT, nhom2 TEXT, ten_nhom2 TEXT, nhom3 TEXT, ten_nhom3 TEXT, ghi_chu TEXT

accounting.classification_rule    -- centralized rule engine (Section 8)
  id, priority INT, match_kind TEXT ('account_exact'|'account_prefix'|'description'|'department'|'voucher'|'combo'),
  match_value JSONB, action TEXT ('INCLUDE'|'EXCLUDE'|'NEEDS_REVIEW'), note TEXT,
  rule_version TEXT, is_active BOOL, created_at
```

- **RAW_ROWS_SAVED_AS_FACT = 0** — 86k dòng KHÔNG lưu; chỉ file RAW trên disk + `source_row_index` để truy nguyên.
- Engine priority: explicit rule → known accounting classification (BC Chi Phí QTTH Mã số) → unknown = `NEEDS_REVIEW`.
- Broad include: prefix `641` / `642`; exclude explicit qua rule; contra `911` → auto-exclude (closing).
- Seed rules V1: 28 tài khoản INCLUDE (khớp BC) + 8 tài khoản NEEDS_REVIEW ở trên. Không whitelist đóng.
- DOWN migration đầy đủ. Local/throwaway apply chỉ sau khi Operator duyệt proposal này.

---

## OUTPUT FINAL BLOCK (Section 24)

```
ACCOUNTING_DATA_V1_FOUNDATION = PARTIAL   (audit + proposal only; pipeline/UI/migration chưa build — chờ duyệt)

ACCOUNTING_T07_SOURCE_ROWS     = 85975
ACCOUNTING_T07_DEBIT_ROWS      = 38768
ACCOUNTING_T07_COST_SCOPE_ROWS = 350
ACCOUNTING_T07_INCLUDED        = ~342 rows  (28 acct khớp BC)   [ước tính từ audit, chưa qua engine]
ACCOUNTING_T07_EXCLUDED        = 0 rows debit-side (54 closing rows nằm ở credit-side, ngoài scope)
ACCOUNTING_T07_NEEDS_REVIEW    = ~55 rows  (8 acct: 6414/6422/6423/64177/64178/64188/64273/64274)

UNIQUE_COST_ACCOUNTS          = 36
UNIQUE_DEPARTMENTS            = 7
OUT_OF_MASTER_DEPARTMENTS     = PHF-MKT

TOTAL_INCLUDED_AMOUNT         ≈ 1.003.000.000 VND   (1.048.747.679 − review ~45.7tr)
TOTAL_REVIEW_AMOUNT          ≈ 45.750.402 VND       (Σ 8 acct NEEDS_REVIEW)

COST_DICTIONARY_ROWS         = 170
COST_DICTIONARY_IMPORT       = NOT_RUN  (schema chưa apply)

CLASSIFICATION_ENGINE        = NOT_BUILT  (design done)
EXCLUSION_ENGINE             = NOT_BUILT  (design done)
UNKNOWN_PRESERVATION         = DESIGNED (NEEDS_REVIEW, no drop)
DOUBLE_COUNT_GUARD           = VALIDATED trên dữ liệu (debit-only loại 54 closing rows; 0 contra-911 ở debit)
RAW_FILE_PROVENANCE          = DESIGNED (sha256 + storage_ref, reuse payroll-storage pattern)
VERSIONING                   = DESIGNED (reuse payroll import/version)

RAW_ROWS_SAVED_AS_FACT       = 0

LOCAL_3000                   = NOT_RUN

NORMALIZER_PAYROLL_CHANGED   = NO
SUPABASE_MAIN_WRITE          = NO
PROD_DB_CHANGE               = NO
PROD_DEPLOY                  = NO
PUSH                         = NO

TESTED_COMMIT   = 7b36b05 (deploy/checklist-1.70.3 — chỉ chạy audit script, không sửa code repo)
TEST_DB         = none (audit đọc file tĩnh, không chạm DB)
TEST_COUNTS     = xem block số T07 ở trên
```

### Remaining blockers (cần Operator quyết trước khi build tiếp)

1. **Duyệt schema proposal** `accounting.*` ở trên (Section 18 yêu cầu proposal-first).
2. **Parser nguồn FAST**: chấp nhận viết streaming parser riêng cho FAST export (73MB/inline-strings) —
   xlsx-lite hiện không đọc được file này.
3. **8 tài khoản NEEDS_REVIEW** (`6414 6422 6423 64177 64178 64188 64273 64274`): KTT map về chỉ tiêu QTTH
   nào, hoặc BC Chi Phí QTTH bổ sung Mã số? (≈ 45,75 tr VND).
4. **`PHF-MKT`**: xác nhận giữ nguyên (KEEP+WARN) — không thêm vào master, không remap trong batch này.
5. **cost_code = UNRESOLVED toàn bộ** — xác nhận chấp nhận cho V1 (không có join key Mã phí ↔ transaction line).
6. Vị trí UI: tích hợp vào QTTH Truth Data hiện hữu trên `http://127.0.0.1:3000` — cần Operator chỉ điểm màn hình đích.

**STOP — không build pipeline/UI/migration cho tới khi có duyệt.**
