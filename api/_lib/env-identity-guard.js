'use strict';

/*
 * PHF HR — Supabase project identity classifier + boot-time visibility guard.
 *
 * MỤC ĐÍCH (Phase 2 — Hard Gate Environment, PHF_HR_ENVIRONMENT_SUPABASE_
 * SOURCE_OF_TRUTH_2026-08-26.md mục 17/18): mọi runtime phải LOG/IDENTIFY
 * project Supabase đang trỏ tới TRƯỚC khi thao tác nhạy cảm — không được để
 * việc trỏ nhầm MAIN/SANDBOX xảy ra trong im lặng.
 *
 * KHÔNG chặn cứng (fail-closed) ở đây — khác hẳn scripts/task-oracle-dev-
 * only.js (guard đó dành cho SCRIPT TEST, đúng nghĩa fail-closed tuyệt đối
 * vì script test KHÔNG BAO GIỜ có lý do chính đáng để chạm MAIN). Module này
 * dành cho ENTRYPOINT LOCAL/DEV (server.js) — nơi vận hành viên đôi khi có
 * lý do chính đáng để chạy local nhắm MAIN (debug sự cố thật, xem dữ liệu
 * thật) — nên chỉ đảm bảo KHÔNG BAO GIỜ im lặng, không tự đoán ý định rồi
 * chặn nhầm 1 workflow hợp lệ.
 *
 * Exact-hostname match (WHATWG URL, không phải substring/includes()) — cùng
 * chuẩn đã dùng ở scripts/task-oracle-dev-only.js, tránh false-positive/
 * false-negative từ subdomain giả mạo, domain nối đuôi, hay ref nằm trong
 * path/query của host khác.
 */

const MAIN_HOSTNAME = 'byhpcexmjzqpctyvfczd.supabase.co';
const SANDBOX_HOSTNAME = 'pxkjvawdrixgoukhyvnk.supabase.co';

function classifySupabaseUrl(rawUrl) {
  const text = String(rawUrl == null ? '' : rawUrl).trim();
  if (!text) return { label: 'MISSING', hostname: '' };

  let parsed;
  try {
    parsed = new URL(text);
  } catch (e) {
    return { label: 'MALFORMED', hostname: '' };
  }

  const hostname = String(parsed.hostname || '').toLowerCase();
  if (hostname === MAIN_HOSTNAME) return { label: 'MAIN', hostname };
  if (hostname === SANDBOX_HOSTNAME) return { label: 'SANDBOX', hostname };
  return { label: 'UNKNOWN', hostname };
}

/*
 * logSupabaseIdentityOnce(contextLabel) — in 1 dòng banner KHÔNG THỂ BỎ LỠ
 * (console.warn, không phải console.log, để nổi bật trong terminal) xác
 * định rõ project nào đang được dùng — gọi 1 lần lúc boot entrypoint local.
 * KHÔNG log bất kỳ secret/key nào — chỉ classification + hostname (hostname
 * của Supabase project KHÔNG phải bí mật, nó xuất hiện công khai trong mọi
 * request URL).
 */
function logSupabaseIdentityOnce(contextLabel) {
  const result = classifySupabaseUrl(process.env.SUPABASE_URL);
  const prefix = `[PHF ENV IDENTITY GUARD]${contextLabel ? ' ' + contextLabel : ''}`;

  if (result.label === 'MAIN') {
    console.warn(`${prefix} ĐANG TRỎ VÀO PHF_HR_MAIN (Production thật) — hostname=${result.hostname}. Mọi thao tác ghi từ tiến trình này sẽ ảnh hưởng dữ liệu thật. Nếu đây không phải chủ ý, dừng ngay và kiểm tra lại .env.`);
  } else if (result.label === 'SANDBOX') {
    console.warn(`${prefix} đang trỏ vào PHF_HR_SANDBOX (test/dev) — hostname=${result.hostname}.`);
  } else if (result.label === 'MISSING') {
    console.warn(`${prefix} SUPABASE_URL rỗng/thiếu — không xác định được project.`);
  } else if (result.label === 'MALFORMED') {
    console.warn(`${prefix} SUPABASE_URL không phải URL hợp lệ — không xác định được project.`);
  } else {
    console.warn(`${prefix} SUPABASE_URL trỏ vào project KHÔNG NẰM trong danh sách đã biết (không phải MAIN, không phải SANDBOX) — hostname=${result.hostname}. Xác nhận lại đây có đúng là project dự kiến không.`);
  }

  return result;
}

/*
 * assertSandboxTargetOrFailClosed(contextLabel) — Phase 2A Hard Gate
 * (PHF_HR_ENVIRONMENT_ACCESS_MATRIX_PHASE2_2026-08-26.md, phát hiện
 * scripts/seed.js + scripts/phf-migrate-user-accounts-to-supabase.js có
 * thể ghi PHF_HR_MAIN theo mặc định, không guard).
 *
 * KHÁC logSupabaseIdentityOnce() (chỉ cảnh báo, không chặn) — hàm này
 * FAIL-CLOSED TUYỆT ĐỐI: LUÔN in project identity trước (cùng cơ chế
 * logSupabaseIdentityOnce), rồi throw NGAY nếu classification KHÔNG PHẢI
 * đúng 'SANDBOX' — không có nhánh "mặc định cho qua" cho bất kỳ giá trị
 * nào khác (MAIN, MISSING, MALFORMED, UNKNOWN đều bị chặn như nhau).
 * Đây là whitelist tuyệt đối (chỉ đúng 1 project được phép), không phải
 * blacklist MAIN đơn thuần — cùng triết lý scripts/task-oracle-dev-only.js.
 *
 * Caller PHẢI gọi hàm này TRƯỚC BẤT KỲ createClient()/DB operation nào —
 * nếu throw ở đây (uncaught, tại module top-level), phần code phía dưới
 * (bao gồm mọi upsert/insert/update/rpc) không bao giờ được thực thi.
 */
function assertSandboxTargetOrFailClosed(contextLabel) {
  const result = logSupabaseIdentityOnce(contextLabel);
  if (result.label !== 'SANDBOX') {
    throw new Error(
      'PHF_ENV_GUARD_FAIL_CLOSED: SUPABASE_URL không phải PHF_HR_SANDBOX ' +
      '(nhận diện=' + result.label + ', hostname=' + (result.hostname || '(không xác định)') + '). ' +
      (contextLabel ? contextLabel + ' ' : '') +
      'CHỈ được phép chạy khi SUPABASE_URL trỏ ĐÚNG SANDBOX (' + SANDBOX_HOSTNAME + '). ' +
      'Từ chối thực thi — không có bất kỳ DB operation (createClient/insert/update/upsert/delete/rpc) nào chạy sau dòng này.'
    );
  }
  return result;
}

module.exports = { classifySupabaseUrl, logSupabaseIdentityOnce, assertSandboxTargetOrFailClosed, MAIN_HOSTNAME, SANDBOX_HOSTNAME };
