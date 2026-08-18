'use strict';

/* PHF AI Sandbox - KNL Framework/Grade/Assignment/Assessment READ-ONLY
   adapter cho DeepSeek tool-calling (Batch 2). KHONG tao permission engine
   moi, KHONG tu query Supabase - moi ham o day chi la lop mong goi LAI
   dung service KNL da co san va tu resolve quyen qua CHINH cac ham do:

   - get_knl_framework / get_knl_grade_requirements: doc lai
     lib/knl-frameworks.js#listKnlFrameworks/getKnlFrameworkVersion va
     lib/knl-foundation.js#getKnlGradeMatrix - CA 2 tu gate bang
     requireManageFrameworkForSession() (lib/knl-permissions.js), tuc la
     CHI tai khoan co quyen "Quan ly cau truc KNL" (hoac Admin qua
     admin_recovery) moi doc duoc noi dung framework/grade qua AI - GIONG
     HET quyen UI Quan tri KNL dang doi hoi hom nay. Day KHONG phai gioi
     han moi tu AI - Batch 2 CHU DINH khong noi long quyen nay qua tool
     (xem TRACE report phan "Permission").
   - get_employee_knl_assignment: doc lai lib/knl-assignments.js#
     listKnlFrameworkAssignments() (tu gate Admin - CHINH XAC quyen UI
     Assignment KNL hien doi hoi), sau do LOC KET QUA DA CO SAN theo 1
     nhan vien/vi tri cu the (KHONG tao truy van moi, chi reshape ket qua
     admin da duoc phep doc).
   - get_employee_knl_assessment: doc lai lib/knl-surveys.js#
     listKnlSurveyCampaigns()/getKnlSurveyTicket() - CA 2 tu resolve quyen
     qua resolveActorGrant()+requireAccessKnl()+subjectMatchesScope() voi
     peopleScope that cua tai khoan (indistinguishable "khong co du lieu"
     vs "ngoai pham vi quyen" o phia AI - KHONG confirm/phu nhan su ton
     tai du lieu ngoai pham vi, giong dung cach get_department_directory/
     get_branch_directory dang xu ly INCOMPLETE). */

const { listKnlFrameworks, getKnlFrameworkVersion } = require('./knl-frameworks');
const { getKnlGradeMatrix } = require('./knl-foundation');
const { listKnlFrameworkAssignments } = require('./knl-assignments');
const { listKnlSurveyCampaigns, getKnlSurveyTicket } = require('./knl-surveys');
const { resolveActorGrant, requireManageFrameworkForSession } = require('./knl-permissions');

/* PHF AI V2 Batch 2 (2026-08-18) - cache ngan han (30s) CHI cho noi dung
 * framework/grade (khong doi thuong xuyen, KHONG phai du lieu ca nhan/thu
 * nhap - TUYET DOI khong dung pattern nay cho income). An toan permission:
 * requireManageFrameworkForSession() LUON duoc goi TRUOC khi tra ket qua tu
 * cache - cache CHI bo qua vong doc Supabase lap lai (5 bang cho
 * getKnlFrameworkVersion, 2 bang cho getKnlGradeMatrix), KHONG BAO GIO bo
 * qua permission check, du cache hit hay miss. Loi ich ro nhat: cau hoi
 * kieu "B3 khac B2 o dau" goi get_knl_grade_requirements 2 lan (B2 roi B3)
 * cho CUNG 1 versionId trong CUNG 1 luot - lan 2 dung lai bundle/matrix da
 * tai o lan 1 thay vi doc lai Supabase. Cache o TANG NAY (khong sua
 * lib/knl-frameworks.js/lib/knl-foundation.js dung chung voi Admin UI that)
 * de gioi han dung blast radius trong file AI-only nay. */
const CATALOG_CACHE_TTL_MS = 30000;
function makeTtlCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) { store.delete(key); return undefined; }
      return hit.data;
    },
    set(key, data) { store.set(key, { data, expiresAt: Date.now() + ttlMs }); }
  };
}
const versionBundleCache = makeTtlCache(CATALOG_CACHE_TTL_MS);
const gradeMatrixCache = makeTtlCache(CATALOG_CACHE_TTL_MS);

const MAX_FILTER_CHARS = 80;
const MAX_EMPLOYEE_CODE_CHARS = 32;
const MAX_ITEMS_RETURNED = 60;
const MAX_CONTENT_CHARS = 220;

function text(value) { return String(value == null ? '' : value).trim(); }
function cleanFilter(value) { return text(value).slice(0, MAX_FILTER_CHARS); }
function cleanEmployeeCode(value) { return text(value).slice(0, MAX_EMPLOYEE_CODE_CHARS).toUpperCase(); }
function norm(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}
function truncate(value) {
  const s = text(value);
  return s.length > MAX_CONTENT_CHARS ? s.slice(0, MAX_CONTENT_CHARS) + '…' : s;
}

async function selfEmployeeCode(session) {
  const resolved = await resolveActorGrant(session);
  return resolved.identity.employeeCode || '';
}

// Tim framework+version THEO frameworkCode/name nguoi dung neu (khong can
// biet nhan vien cu the) - uu tien version published+locked moi nhat
// (dung dinh nghia "san sang dung" da co san o
// lib/knl-surveys.js#listPublishedVersions), fallback version moi nhat
// hien co (danh dau ro isPublished:false) neu framework chua co ban
// published nao - de tai khoan quan ly cau truc (dang o ta ban CHINH ho
// quan ly) van xem duoc du lieu dang lam, khong bi chan hoan toan.
function pickBestVersion(framework) {
  const versions = Array.isArray(framework.versions) ? framework.versions : [];
  if (!versions.length) return null;
  const published = versions.filter(v => v.status === 'published' && v.isLocked === true)
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
  if (published) return { version: published, isPublished: true };
  const latest = [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  return { version: latest, isPublished: false };
}

// LOAI TRU framework status='inactive' (KNL library cleanup - nhieu framework
// legacy/v1 duoc dat inactive nhung VAN giu ten hien thi giong het ban chinh
// dang dung, vd "TBP Gói quà" active vs "TBP Gói quà" legacy da inactive -
// neu khong loc, .find() co the boc trung ban legacy tuy thu tu updated_at,
// AI se doc nham noi dung cu). Khong loai o findVersionIdByAssignment (duoi)
// vi assignment la hanh dong Admin co chu dich rieng, ngoai pham vi batch nay.
async function findFrameworkByCode(session, frameworkCode) {
  const code = norm(frameworkCode);
  if (!code) return null;
  const { frameworks } = await listKnlFrameworks(session);
  const active = (frameworks || []).filter(f => f.status !== 'inactive');
  return active.find(f => norm(f.code) === code || norm(f.name) === code || norm(f.name).includes(code) || code.includes(norm(f.code))) || null;
}

/* HOTFIX (2026-08-18) - khi get_knl_framework/get_knl_grade_requirements
 * KHONG the resolve duoc bo KNL/version nao (khong co frameworkCode/title/
 * department/employeeCode kem, HOAC nguoi hoi khong co assignment dang
 * active) - truoc day tra ve not_found "cut", model khong co gi de hoi lai
 * (vd "B3 khac B2 o dau" hoi TRUC TIEP, khong neu ten bo KNL nao, tai khoan
 * dang hoi (vd Admin) khong co employeeCode/assignment de tu suy). Fix
 * GENERIC (khong hard-code B2/B3 hay bat ky bo KNL cu the nao): tra kem
 * danh sach ten cac bo KNL active hien co (chi code+name, DU LIEU DINH
 * NGHIA da duoc phep doc qua listKnlFrameworks() - CUNG mot lenh goi/quyen
 * findFrameworkByCode() da dung o tren, KHONG mo quyen moi) de vong tra loi
 * thu 2 cua model co the hoi lai nguoi dung ro rang "ban muon xem bo KNL
 * nao trong danh sach nay?" thay vi im lang tra loi khong duoc. */
async function listActiveFrameworkOptions(session) {
  const { frameworks } = await listKnlFrameworks(session);
  return (frameworks || []).filter(f => f.status !== 'inactive').map(f => ({ code: f.code, name: f.name }));
}

// Tim version qua ASSIGNMENT (nhan vien cu the HOAC vi tri theo
// title/department, khong can biet mot nhan vien dich danh - dung dung
// cho cau hoi kieu "Ca truong dung Bo KNL nao?"). Doc lai NGUYEN VEN
// listKnlFrameworkAssignments() (Admin-gated, tra toan bo) roi LOC trong
// bo nho - khong tao truy van Supabase moi.
async function findVersionIdByAssignment(session, { employeeCode, title, department }) {
  // PHF AI V2 Batch 2 (2026-08-18) - truoc day 1 lan goi listKnlFrameworkAssignments()
  // KHONG tham so (tai TOAN BO bang assignment) roi loc CA employee LAN
  // position tu CUNG 1 ket qua. Gio nhanh employeeCode dung truy van CO
  // employeeCode (chi doc dung dong can, xem lib/knl-assignments.js) - chi
  // khi KHONG tim thay (hoac cau hoi la theo vi tri) moi fallback sang full-
  // list cho nhanh position (khong co truong rieng de query truc tiep vi vi
  // tri nam trong organization_snapshot JSON tu do - full-list la CACH DUY
  // NHAT khong nhan doi logic khop title/department that vao SQL).
  if (employeeCode) {
    const code = norm(employeeCode);
    const { assignments } = await listKnlFrameworkAssignments(session, { employeeCode: code });
    const direct = (assignments || []).filter(a => a.status === 'active' && a.targetType === 'employee' && norm(a.employeeCode) === code);
    if (direct.length) {
      const primary = direct.find(a => a.isPrimary) || direct[0];
      return { versionId: primary.versionId, matches: direct, matchKind: 'employee' };
    }
  }

  if (title || department) {
    const { assignments } = await listKnlFrameworkAssignments(session);
    const active = (assignments || []).filter(a => a.status === 'active');
    const titleNorm = norm(title);
    const deptNorm = norm(department);
    const byPosition = active.filter(a => {
      if (a.targetType !== 'position') return false;
      const snap = a.organizationSnapshot || {};
      const titleOk = !titleNorm || norm(snap.title).includes(titleNorm);
      const deptOk = !deptNorm || norm(snap.department) === deptNorm;
      return titleOk && deptOk;
    });
    if (byPosition.length) {
      const versionIds = [...new Set(byPosition.map(a => a.versionId))];
      return { versionId: byPosition[0].versionId, matches: byPosition, matchKind: 'position', conflicting: versionIds.length > 1 ? versionIds : null };
    }
  }
  return null;
}

async function loadVersionBundle(session, versionId) {
  // requireManageFrameworkForSession() LUON chay TRUOC, du cache hit hay
  // miss - permission KHONG BAO GIO bi cache bo qua (chi vong doc Supabase
  // ben duoi moi duoc cache).
  await requireManageFrameworkForSession(session);
  const cached = versionBundleCache.get(versionId);
  if (cached) return cached;
  const bundle = await getKnlFrameworkVersion(session, { versionId });
  versionBundleCache.set(versionId, bundle);
  return bundle;
}

async function loadGradeMatrixCached(session, versionId) {
  await requireManageFrameworkForSession(session);
  const cached = gradeMatrixCache.get(versionId);
  if (cached) return cached;
  const matrix = await getKnlGradeMatrix(session, { versionId });
  gradeMatrixCache.set(versionId, matrix);
  return matrix;
}

/* get_knl_framework - noi dung cau truc (nhom nang luc/hang muc/dinh nghia
   M-level) cua 1 bo KNL. Input: frameworkCode (ten/ma bo KNL) HOAC
   employeeCode (mac dinh chinh nguoi hoi neu bo trong ca 2) HOAC title/
   department (tra cuu theo vi tri, khong can dich danh 1 nguoi). */
async function getKnlFrameworkForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  const frameworkCode = cleanFilter(input.frameworkCode);
  const title = cleanFilter(input.title);
  const department = cleanFilter(input.department);
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!frameworkCode && !title && !department && !employeeCode) {
    employeeCode = await selfEmployeeCode(session);
  }

  let framework = null;
  let versionId = null;
  let resolvedBy = '';
  let conflicting = null;

  if (frameworkCode) {
    framework = await findFrameworkByCode(session, frameworkCode);
    if (framework) { resolvedBy = 'frameworkCode'; }
  }
  if (!framework && (employeeCode || title || department)) {
    const found = await findVersionIdByAssignment(session, { employeeCode, title, department });
    if (found) { versionId = found.versionId; resolvedBy = found.matchKind === 'employee' ? 'employeeAssignment' : 'positionAssignment'; conflicting = found.conflicting || null; }
  }

  if (!versionId && framework) {
    const picked = pickBestVersion(framework);
    if (!picked) return { available: false, asOf, reason: 'framework_no_version', frameworkCode, employeeCode };
    versionId = picked.version.id;
  }

  if (!versionId) {
    const availableFrameworks = await listActiveFrameworkOptions(session);
    return { available: false, asOf, reason: 'not_found', frameworkCode, employeeCode, title, department, availableFrameworks };
  }

  const bundle = await loadVersionBundle(session, versionId);
  const columns = (bundle.columns || []).filter(c => c.type === 'level' && c.isActive !== false).sort((a, b) => a.levelNumber - b.levelNumber);
  const items = (bundle.items || []).filter(i => i.isActive !== false).slice(0, MAX_ITEMS_RETURNED);
  const groups = (bundle.groups || []).filter(g => g.isActive !== false);
  const contentByItemColumn = new Map((bundle.levelContents || []).map(c => [c.itemId + '|' + c.columnId, c.content]));

  return {
    available: true,
    asOf,
    resolvedBy,
    conflicting,
    framework: { code: bundle.framework.code, name: bundle.framework.name, status: bundle.framework.status },
    version: { id: bundle.version.id, versionNumber: bundle.version.versionNumber, status: bundle.version.status, isLocked: bundle.version.isLocked, isPublished: bundle.version.status === 'published' && bundle.version.isLocked === true },
    levels: columns.map(c => ({ levelNumber: c.levelNumber, label: c.label })),
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      items: items.filter(i => i.groupId === g.id).map(i => ({
        name: i.name,
        description: i.description || '',
        levelContent: columns.map(c => ({ levelNumber: c.levelNumber, label: c.label, content: truncate(contentByItemColumn.get(i.id + '|' + c.id) || '') }))
      }))
    })).filter(g => g.items.length)
  };
}

/* get_knl_grade_requirements - Bac nhan su (B1..Bn, doc lap voi M-level)
   va yeu cau cua 1 bac cu the theo tung hang muc nang luc. Cung logic
   resolve framework/version nhu get_knl_framework o tren. gradeCode bat
   buoc de tra ve chi tiet yeu cau (khong gradeCode -> chi tra danh sach
   cac bac hien co, tranh payload qua lon). */
async function getKnlGradeRequirementsForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  const frameworkCode = cleanFilter(input.frameworkCode);
  const title = cleanFilter(input.title);
  const department = cleanFilter(input.department);
  const gradeCode = cleanFilter(input.gradeCode);
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!frameworkCode && !title && !department && !employeeCode) {
    employeeCode = await selfEmployeeCode(session);
  }

  let versionId = null;
  let frameworkInfo = null;
  if (frameworkCode) {
    const framework = await findFrameworkByCode(session, frameworkCode);
    if (framework) {
      const picked = pickBestVersion(framework);
      if (picked) { versionId = picked.version.id; frameworkInfo = { code: framework.code, name: framework.name }; }
    }
  }
  if (!versionId && (employeeCode || title || department)) {
    const found = await findVersionIdByAssignment(session, { employeeCode, title, department });
    if (found) versionId = found.versionId;
  }
  if (!versionId) {
    const availableFrameworks = await listActiveFrameworkOptions(session);
    return { available: false, asOf, reason: 'not_found', frameworkCode, employeeCode, title, department, availableFrameworks };
  }

  const [bundle, matrix] = await Promise.all([loadVersionBundle(session, versionId), loadGradeMatrixCached(session, versionId)]);
  if (!frameworkInfo) frameworkInfo = { code: bundle.framework.code, name: bundle.framework.name };
  const grades = (matrix.grades || []).sort((a, b) => a.sortOrder - b.sortOrder);

  if (!gradeCode) {
    return {
      available: true,
      asOf,
      framework: frameworkInfo,
      version: { id: bundle.version.id, versionNumber: bundle.version.versionNumber },
      grades: grades.map(g => ({ gradeCode: g.gradeCode, gradeNumber: g.gradeNumber, label: g.label })),
      note: 'Chưa nêu bậc cụ thể - chỉ trả danh sách bậc hiện có, gọi lại kèm gradeCode để lấy chi tiết yêu cầu từng hạng mục.'
    };
  }

  const grade = grades.find(g => norm(g.gradeCode) === norm(gradeCode) || norm(g.label).includes(norm(gradeCode)));
  if (!grade) return { available: false, asOf, reason: 'grade_not_found', frameworkCode: frameworkInfo.code, gradeCode, availableGrades: grades.map(g => g.gradeCode) };

  const columns = new Map((bundle.columns || []).filter(c => c.type === 'level').map(c => [c.id, c]));
  const itemsById = new Map((bundle.items || []).map(i => [i.id, i]));
  const groupsById = new Map((bundle.groups || []).map(g => [g.id, g]));
  const contentByItemColumn = new Map((bundle.levelContents || []).map(c => [c.itemId + '|' + c.columnId, c.content]));

  const requirements = (matrix.requirements || [])
    .filter(r => r.gradeId === grade.id)
    .slice(0, MAX_ITEMS_RETURNED)
    .map(r => {
      const item = itemsById.get(r.itemId);
      const group = item ? groupsById.get(item.groupId) : null;
      const column = columns.get(r.requiredColumnId);
      return {
        groupName: group ? group.name : '',
        itemName: item ? item.name : '',
        requiredLevelNumber: r.requiredLevelNumber,
        requiredLevelLabel: column ? column.label : '',
        requiredLevelContent: truncate(contentByItemColumn.get(r.itemId + '|' + r.requiredColumnId) || '')
      };
    });

  return {
    available: true,
    asOf,
    framework: frameworkInfo,
    version: { id: bundle.version.id, versionNumber: bundle.version.versionNumber },
    grade: { gradeCode: grade.gradeCode, gradeNumber: grade.gradeNumber, label: grade.label },
    requirementCount: requirements.length,
    requirements
  };
}

/* get_employee_knl_assignment - Bo KNL/version dang duoc ap dung cho 1
   nhan vien (mac dinh chinh nguoi hoi). Doc lai NGUYEN VEN
   listKnlFrameworkAssignments() (Admin-gated) - KHONG mo quyen moi, chi
   loc ket qua da duoc phep doc xuong dung 1 nguoi. */
async function getEmployeeKnlAssignmentForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!employeeCode) employeeCode = await selfEmployeeCode(session);
  if (!employeeCode) return { found: false, asOf, employeeCode: '', reason: 'employee_code_required' };

  const found = await findVersionIdByAssignment(session, { employeeCode });
  if (!found) return { found: false, asOf, employeeCode, reason: 'no_active_assignment' };

  const bundle = await loadVersionBundle(session, found.versionId);
  return {
    found: true,
    asOf,
    employeeCode,
    matchKind: found.matchKind,
    framework: { code: bundle.framework.code, name: bundle.framework.name },
    version: { id: bundle.version.id, versionNumber: bundle.version.versionNumber, status: bundle.version.status }
  };
}

/* get_employee_knl_assessment - danh gia nang luc (Survey V1) DA NOP gan
   nhat cua 1 nhan vien (mac dinh chinh nguoi hoi). Day la TU DANH GIA
   (self-reported qua phieu khao sat), KHONG phai danh gia da duoc quan ly
   xac nhan - luon tra ve kem nhan ro isSelfReported:true de model/UI
   khong bien no thanh "diem nang luc chinh thuc". Neu khong tim thay
   phieu SUBMITTED trong pham vi duoc phep xem (tu scopedTickets/
   subjectMatchesScope da co san o lib/knl-surveys.js), tra
   assessmentAvailable:false - KHONG phan biet "khong co du lieu" voi
   "ngoai pham vi quyen" de khong lo dinh nguoi khac co/khong co du lieu. */
async function getEmployeeKnlAssessmentForAi(session, args) {
  const input = args && typeof args === 'object' ? args : {};
  const asOf = new Date().toISOString();
  let employeeCode = cleanEmployeeCode(input.employeeCode);
  if (!employeeCode) employeeCode = await selfEmployeeCode(session);
  if (!employeeCode) return { assessmentAvailable: false, asOf, employeeCode: '', reason: 'employee_code_required' };

  const { tickets } = await listKnlSurveyCampaigns(session);
  const code = norm(employeeCode);
  const submitted = (tickets || [])
    .filter(t => norm(t.employeeCode) === code && t.status === 'SUBMITTED')
    .sort((a, b) => text(b.lastSubmittedAt || b.submittedAt).localeCompare(text(a.lastSubmittedAt || a.submittedAt)));

  if (!submitted.length) return { assessmentAvailable: false, asOf, employeeCode, reason: 'no_submitted_ticket_in_scope' };

  const latest = submitted[0];
  const detail = await getKnlSurveyTicket(session, { ticketId: latest.id });
  const itemsById = new Map((detail.items || []).map(i => [i.id, i]));
  const groupsById = new Map((detail.groups || []).map(g => [g.id, g]));
  const levelsByNumber = new Map((detail.levels || []).map(l => [l.levelNumber, l]));

  const items = (detail.responses || []).slice(0, MAX_ITEMS_RETURNED).map(r => {
    const item = itemsById.get(r.itemId);
    const group = item ? groupsById.get(item.groupId) : null;
    const level = r.selectedLevelNumber != null ? levelsByNumber.get(r.selectedLevelNumber) : null;
    return {
      groupName: group ? group.name : '',
      itemName: item ? item.name : '',
      selectedLevelNumber: r.selectedLevelNumber,
      selectedLevelLabel: level ? level.label : '',
      suitability: r.suitability || '',
      comment: r.comment || ''
    };
  });

  return {
    assessmentAvailable: true,
    isSelfReported: true,
    asOf,
    employeeCode,
    campaignName: detail.campaign ? detail.campaign.name : '',
    frameworkSnapshot: latest.frameworkSnapshot || {},
    submittedAt: latest.lastSubmittedAt || latest.submittedAt || '',
    itemCount: items.length,
    items
  };
}

module.exports = {
  getKnlFrameworkForAi,
  getKnlGradeRequirementsForAi,
  getEmployeeKnlAssignmentForAi,
  getEmployeeKnlAssessmentForAi
};
