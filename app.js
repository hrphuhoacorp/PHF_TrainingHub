/* PHF Training Hub Local Prototype - app.js
   Lưu dữ liệu local vào data.json qua server.js.
   Không thay thế luồng giao diện gốc trong index.html. */

(function () {
  console.log('PHF app.js loaded');

  const API = '/api/data';
  const PASS_SCORE = 80;
  const PHF_ADMIN_QUERY = new URLSearchParams(window.location.search || '').get('admin') === '1' || (window.location.search || '').includes('admin=1');

  // Luồng học viên thường luôn tắt quản trị. Chỉ mở quản trị khi vào link có ?admin=1.
  if (!PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true') {
    localStorage.removeItem('phfAdminTestMode');
    localStorage.removeItem('phfStep2FinalPassed');
    localStorage.removeItem('phfStep3FinalPassed');
    localStorage.removeItem('phfStep4FinalPassed');
    if (localStorage.getItem('phfEmployeeId') === 'admin-test-phf') {
      localStorage.removeItem('phfEmployeeId');
      localStorage.removeItem('phfEmployeeProfile');
    }
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function learnerIdFromPhone(phone) {
    const digits = normalizePhone(phone);
    return digits.length >= 8 ? `hv-${digits}` : '';
  }

  let localData = null;
  let employeeId = localStorage.getItem('phfEmployeeId') || 'demo-nv-001';
  localStorage.setItem('phfEmployeeId', employeeId);

function activePageId() {
  if (typeof window.phfCurrentLessonIndex === 'number' && window.phfCurrentLessonIndex >= 0) {
    return 'lesson:' + window.phfCurrentLessonIndex;
  }

  function cleanLabel(el) {
    if (!el) return '';

    const title =
      el.getAttribute('data-title') ||
      el.getAttribute('aria-label') ||
      el.querySelector('h1,h2,h3,h4,.title,.lesson-title,.module-title,strong')?.textContent ||
      '';

    const subtitle =
      el.querySelector('.subtitle,.desc,.lesson-desc,.module-desc,small,p')?.textContent ||
      '';

    const fallback = el.textContent || '';

    return (title || subtitle ? `${title} - ${subtitle}` : fallback)
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*-\s*/g, ' - ')
      .trim();
  }

  const activeItem = document.querySelector(
    '.phf-nav-item.active, .nav-step.active, .todo-item.active, [data-go].active, [data-page].active'
  );

  if (activeItem) {
    return (
      activeItem.getAttribute('data-go') ||
      activeItem.getAttribute('data-page') ||
      activeItem.id ||
      cleanLabel(activeItem)
    );
  }

  const activePage = document.querySelector('.page.active');
  if (activePage && activePage.id) {
    return activePage.id;
  }

  const activeStepCard = document.querySelector('.step-card.active, .module-card.active, .learning-card.active');
  if (activeStepCard) {
    return (
      activeStepCard.getAttribute('data-go') ||
      activeStepCard.getAttribute('data-page') ||
      activeStepCard.id ||
      cleanLabel(activeStepCard)
    );
  }

  return 'welcomePage';
}

  function text(selector) {
    const el = document.querySelector(selector);
    return el ? (el.value || '').trim() : '';
  }

  function makeEmployeeId(name) {
    const source = name && name.trim() ? name.trim() : employeeId;

    return source
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'demo-nv-001';
  }

function collectEmployee() {
  const adminMode = PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true';

  if (adminMode) {
    employeeId = 'admin-test-phf';
    localStorage.setItem('phfEmployeeId', employeeId);

    const adminEmployee = {
      id: employeeId,
      fullName: 'Admin Test PHF',
      branch: 'Văn phòng',
      birthday: '',
      phone: '',
      department: 'Admin/HCNS',
      position: 'Admin test - mở khóa toàn bộ'
    };

    localStorage.setItem('phfEmployeeProfile', JSON.stringify(adminEmployee));
    return adminEmployee;
  }

  const fullNameEl = document.getElementById('fullName');
  const branchEl = document.getElementById('branch');
  const dobEl = document.getElementById('dob');
  const phoneEl = document.getElementById('phone');
  const departmentEl = document.getElementById('department');
  const studyStartDateEl = document.getElementById('studyStartDate');

  const savedEmployee = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}');

  const rawName = fullNameEl ? (fullNameEl.value || '').trim() : '';

  const rawBranch = branchEl
    ? (
        branchEl.tagName === 'SELECT'
          ? (branchEl.options[branchEl.selectedIndex]?.text || branchEl.value || '')
          : (branchEl.value || '')
      ).trim()
    : '';

  const rawBirthday = dobEl ? (dobEl.value || '').trim() : '';
  const rawPhone = phoneEl ? (phoneEl.value || '').trim() : '';
  const rawDepartment = departmentEl ? (departmentEl.value || '').trim() : '';
  const rawStudyStartDate = studyStartDateEl ? (studyStartDateEl.value || '').trim() : '';
  const finalStudyStartDate = rawStudyStartDate || savedEmployee.studyStartDate || localStorage.getItem('phfStudyStartDate') || '';
  if (rawStudyStartDate) { localStorage.setItem('phfStudyStartDate', rawStudyStartDate); }

  const normalizedName = rawName.replace(/\s+/g, ' ').trim();

  const finalFullName = normalizedName || savedEmployee.fullName || 'Nhân viên demo PHF';
  const finalBranch = rawBranch || savedEmployee.branch || 'Chưa phân chi nhánh';
  const finalBirthday = rawBirthday || savedEmployee.birthday || '';
  const finalPhone = rawPhone || savedEmployee.phone || '';
  const finalDepartment = rawDepartment || savedEmployee.department || '';

  const normalizedPhone = normalizePhone(finalPhone || rawPhone);

  // Với học viên, ưu tiên số điện thoại làm mã nhận diện để lần sau mở lại đúng hồ sơ/tiến độ.
  // Nếu chưa có SĐT thì tạm dùng họ tên như cơ chế cũ để không làm gián đoạn dữ liệu test.
  if (normalizedPhone.length >= 8) {
    employeeId = `hv-${normalizedPhone}`;
    localStorage.setItem('phfEmployeeId', employeeId);
  } else if (normalizedName) {
    employeeId = normalizedName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'demo-nv-001';

    localStorage.setItem('phfEmployeeId', employeeId);
  }

  const employee = {
    id: employeeId,
    fullName: finalFullName,
    branch: finalBranch,
    birthday: finalBirthday,
    phone: finalPhone,
    department: finalDepartment,
    studyStartDate: finalStudyStartDate,
    position: 'Nhân viên bán hàng mới'
  };

  if (normalizedName || rawBranch || rawBirthday || rawPhone || rawDepartment || rawStudyStartDate) {
    localStorage.setItem('phfEmployeeProfile', JSON.stringify(employee));
  }

  return employee;
}

  function getVisibleText(selector) {
    const el = document.querySelector(selector);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

function detectTestResult() {
  try {
    if (window.__phfLastStep2TestResult) {
      const last = window.__phfLastStep2TestResult;

      return {
        page: last.page || activePageId(),
        score: typeof last.score === 'number' ? last.score : null,
        correct: typeof last.correct === 'number' ? last.correct : null,
        total: typeof last.total === 'number' ? last.total : null,
        passScore: last.passScore || PASS_SCORE,
        status: last.status || (
          typeof last.score === 'number' && last.score >= PASS_SCORE ? 'Đạt' : 'Chưa đạt'
        ),
        resultText: last.resultText || ''
      };
    }

    const page = activePageId();

    const resultText = [
      getVisibleText('#step2TestResult'),
      getVisibleText('.b3-result.pass'),
      getVisibleText('.b3-result.fail'),
      getVisibleText('.test-result-box'),
      getVisibleText('.b2-result.pass'),
      getVisibleText('.b2-result.fail')
    ].filter(Boolean).join(' | ');

    if (!resultText) {
      return {
        page,
        score: null,
        correct: null,
        total: null,
        passScore: PASS_SCORE,
        status: 'Chưa có kết quả',
        resultText: ''
      };
    }

    const scoreMatch = resultText.match(/(\d{1,3})\s*\/\s*100|điểm\s*(\d{1,3})|(\d{1,3})\s*%/i);
    const score = scoreMatch ? Number(scoreMatch[1] || scoreMatch[2] || scoreMatch[3]) : null;

    const correctMatch = resultText.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*câu/i);
    const correct = correctMatch ? Number(correctMatch[1]) : null;
    const total = correctMatch ? Number(correctMatch[2]) : null;

    const passed =
      /đạt|pass|mở bước|hoàn thành/i.test(resultText) &&
      !/chưa đạt|không đạt|fail/i.test(resultText);

    return {
      page,
      score,
      correct,
      total,
      passScore: PASS_SCORE,
      status: passed || (score !== null && score >= PASS_SCORE) ? 'Đạt' : 'Chưa đạt',
      resultText
    };
  } catch (err) {
    console.warn('PHF detectTestResult error:', err);

    return {
      page: activePageId(),
      score: null,
      correct: null,
      total: null,
      passScore: PASS_SCORE,
      status: 'Lỗi đọc kết quả test',
      resultText: ''
    };
  }
}

  function completedPagesFromDom() {
    return Array.from(document.querySelectorAll('.nav-step.done, .phf-nav-item.done, .todo-item.done, .active'))
      .map(el => el.getAttribute('data-go') || el.getAttribute('data-page') || el.id || '')
      .filter(Boolean);
  }

async function saveLocal(type) {
  try {
    const testResult = type === 'test' ? detectTestResult() : null;

    const isStep2Passed =
      testResult &&
      (
        testResult.status === 'Đạt' ||
        (typeof testResult.score === 'number' && testResult.score >= PASS_SCORE)
      );

    if (isStep2Passed) {
      localStorage.setItem('phfStep2FinalPassed', 'true');
  localStorage.setItem('phfStep3FinalPassed', 'true');
  localStorage.setItem('phfStep4FinalPassed', 'true');
    }

    const step2Passed = localStorage.getItem('phfStep2FinalPassed') === 'true';
    const step3Passed = localStorage.getItem('phfStep3FinalPassed') === 'true';
    const adminMode = PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true';

    const completedPages = completedPagesFromDom();
    const unlockedSteps = [activePageId()];

    if (step2Passed || adminMode) {
      completedPages.push('GD2');
      completedPages.push('step2FinalTest');
      completedPages.push('Bước 2 - Đã đạt test cuối');

      unlockedSteps.push('GD3');
      unlockedSteps.push('Bước 3 - Quy trình');
    }

    if (step3Passed || adminMode) {
      completedPages.push('GD3');
      completedPages.push('Bước 3 - Đã đạt bài kiểm tra');

      unlockedSteps.push('GD4');
      unlockedSteps.push('Bước 4 - Thực hành');
    }

    const step4Passed = localStorage.getItem('phfStep4FinalPassed') === 'true';
    if (step4Passed || adminMode) {
      completedPages.push('GD4');
      completedPages.push('Bước 4 - Đã đạt bài kiểm tra cuối');

      unlockedSteps.push('GD5');
      unlockedSteps.push('Bước 5 - Đánh giá');
    }

    if (adminMode) {
      ['GD1', 'GD2', 'GD3', 'GD4', 'GD5'].forEach(function (step) {
        unlockedSteps.push(step);
        completedPages.push(step + ' - Admin test mở khóa');
      });

      unlockedSteps.push('Bước 1 - Hội nhập');
      unlockedSteps.push('Bước 2 - CSKH & Kỹ năng');
      unlockedSteps.push('Bước 3 - Quy trình');
      unlockedSteps.push('Bước 4 - Thực hành');
      unlockedSteps.push('Bước 5 - Đánh giá');

      completedPages.push('ADMIN_TEST_UNLOCK_ALL');
    }

    const employeeForSave = collectEmployee();
    const isAdminSave = (PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true') || employeeForSave.id === 'admin-test-phf';
    const phoneDigits = normalizePhone(employeeForSave.phone || '');

    // Khi chạy thật, không ghi hồ sơ học viên demo nếu chưa có SĐT nhận diện.
    // Tránh sinh các dòng như “chua-phan-chi-nhanh” trong Supabase.
    if (!isAdminSave && phoneDigits.length < 8) {
      updateSaveBadge('Nhập SĐT để lưu hồ sơ');
      return;
    }

    const payload = {
      type: type || 'autosave',
      employee: employeeForSave,
      currentPage: activePageId(),
      completedPages: Array.from(new Set(completedPages)),
      unlockedSteps: Array.from(new Set(unlockedSteps)),
      testResult: testResult
    };

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    localData = json.data || localData;
    window.__phfLocalData = localData;

    if (json.ok) {
      if (isStep2Passed) {
        updateSaveBadge('Đã lưu · Mở GĐ3');
      } else {
        updateSaveBadge('Đã lưu');
      }
    } else {
      console.warn('PHF save failed:', json);
      updateSaveBadge('Chưa lưu được');
    }
  } catch (err) {
    updateSaveBadge('Không kết nối server.js');
    console.warn('PHF local save error:', err);
  }
}

  window.phfSaveProgressNow = function(type) {
    try { saveLocal(type || 'navigation'); } catch (err) { console.warn('PHF save progress now error:', err); }
  };

  async function loadLocal() {
    try {
      const res = await fetch(API);
      localData = await res.json();
      window.__phfLocalData = localData;
      updateSaveBadge('Đã kết nối dữ liệu');
    } catch (err) {
      updateSaveBadge('Chạy npm start để lưu data');
    }
  }

  function updateSaveBadge(text) {
    let badge = document.getElementById('phfLocalSaveBadge');

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'phfLocalSaveBadge';
      badge.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:99999;background:#064533;color:#fff;border-radius:999px;padding:9px 12px;font:700 12px Segoe UI,Arial;box-shadow:0 10px 24px rgba(5,63,49,.2);opacity:.92';
      document.body.appendChild(badge);
    }

    badge.textContent = text;
  }

  function delayedSave(type, delay) {
    clearTimeout(window.__phfLocalSaveTimer);
    window.__phfLocalSaveTimer = setTimeout(function () {
      saveLocal(type);
    }, delay || 500);
  }

  const originalFakeSave = window.fakeSave;

  window.fakeSave = function (msg) {
    saveLocal('manual');

    if (typeof originalFakeSave === 'function') {
      originalFakeSave(msg || 'Đã lưu thử');
    } else {
      if (window.phfToast) { window.phfToast('success','Đã lưu', (msg || 'Đã lưu thử') + '.'); } else { console.log((msg || 'Đã lưu thử') + '.'); }
    }
  };

document.addEventListener('click', function (e) {
  const target = e.target.closest('button, [data-go], .phf-nav-item, .nav-step, .todo-item, .chip');
  if (!target) return;

  const text = ((target.id || '') + ' ' + (target.textContent || '')).toLowerCase();

  const isTestButton = /grade|test|nộp|chấm|hoàn thành/.test(text);
  const isInfoButton = /xác nhận thông tin|vào bước 1/.test(text);

  /*
    Không lưu ngay khi bấm nút test.
    Để logic chấm điểm gốc trong index.html chạy trước,
    tránh làm đơ nút Chấm điểm bài test.
  */
  if (isTestButton) {
    setTimeout(function () {
      saveLocal('test');
    }, 1500);
    return;
  }

  setTimeout(function () {
    saveLocal(isInfoButton ? 'employee-info' : 'navigation');
  }, 350);
});

  document.addEventListener('change', function () {
    delayedSave('form-change', 500);
  });

  document.addEventListener('input', function () {
    delayedSave('form-input', 700);
  });

loadLocal().then(function () {
  updateSaveBadge('Đã kết nối dữ liệu');
  // Không tự lưu ngay lúc mở trang trước khi nhận diện học viên.
  // Nếu lưu quá sớm, current_page cũ có thể bị ghi đè về màn chào mừng/thông tin.
  if (PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true') {
    saveLocal('page-open-admin');
  } else if (typeof window.phfShowLearnerGate === 'function') {
    window.phfShowLearnerGate(false);
  }
});


/* PATCH: Cổng học viên bằng SĐT - tìm lại hồ sơ từ Supabase/data */
function phfFindEmployeeByPhone(phone) {
  const digits = normalizePhone(phone);
  if (!digits || !localData || !Array.isArray(localData.employees)) return null;
  const targetId = learnerIdFromPhone(digits);
  return localData.employees.find(function (e) {
    const empPhone = normalizePhone(e.phone || e.phoneNumber || '');
    return e.id === targetId || empPhone === digits;
  }) || null;
}

function phfProgressFor(employeeIdToFind) {
  if (!localData || !localData.progress) return null;
  return localData.progress[employeeIdToFind] || null;
}


function phfReadInfoFormProfile(phoneFallback) {
  const saved = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}');
  const fullNameEl = document.getElementById('fullName');
  const dobEl = document.getElementById('dob');
  const phoneEl = document.getElementById('phone');
  const departmentEl = document.getElementById('department');
  const branchEl = document.getElementById('branch');
  const studyStartDateEl = document.getElementById('studyStartDate');

  const rawPhone = phoneEl ? (phoneEl.value || '') : (phoneFallback || saved.phone || '');
  const digits = normalizePhone(rawPhone || phoneFallback || saved.phone || '');
  const id = learnerIdFromPhone(digits) || saved.id || employeeId;

  const branchValue = branchEl
    ? (branchEl.tagName === 'SELECT'
        ? (branchEl.options[branchEl.selectedIndex]?.text || branchEl.value || '')
        : (branchEl.value || ''))
    : (saved.branch || '');

  return {
    id: id,
    fullName: fullNameEl ? ((fullNameEl.value || '').trim() || saved.fullName || '') : (saved.fullName || ''),
    branch: (branchValue || saved.branch || '').trim(),
    birthday: dobEl ? ((dobEl.value || '').trim() || saved.birthday || '') : (saved.birthday || ''),
    phone: digits || rawPhone || saved.phone || '',
    department: departmentEl ? ((departmentEl.value || '').trim() || saved.department || '') : (saved.department || ''),
    studyStartDate: studyStartDateEl ? ((studyStartDateEl.value || '').trim() || saved.studyStartDate || localStorage.getItem('phfStudyStartDate') || '') : (saved.studyStartDate || localStorage.getItem('phfStudyStartDate') || ''),
    position: saved.position || 'Nhân viên bán hàng mới'
  };
}

function phfStoreProfile(profile) {
  if (!profile) return null;
  const phoneDigits = normalizePhone(profile.phone || '');
  const id = learnerIdFromPhone(phoneDigits) || profile.id || employeeId;
  const normalized = {
    id: id,
    fullName: profile.fullName || profile.full_name || profile.name || '',
    branch: profile.branch || '',
    birthday: profile.birthday || profile.dob || '',
    phone: phoneDigits || profile.phone || '',
    department: profile.department || '',
    studyStartDate: profile.studyStartDate || profile.study_start_date || '',
    position: profile.position || 'Nhân viên bán hàng mới'
  };
  employeeId = id;
  localStorage.setItem('phfEmployeeId', id);
  localStorage.setItem('phfEmployeeProfile', JSON.stringify(normalized));
  if (normalized.studyStartDate) localStorage.setItem('phfStudyStartDate', normalized.studyStartDate);
  return normalized;
}

async function phfSaveProfileDirect(profile, type) {
  const stored = phfStoreProfile(profile);
  if (!stored || normalizePhone(stored.phone).length < 8) return null;
  try {
    const payload = {
      type: type || 'employee-phone-profile',
      employee: stored,
      currentPage: activePageId(),
      completedPages: [],
      unlockedSteps: ['GD1', 'Bước 1 - Hội nhập'],
      testResult: null,
      skipProgress: true
    };
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (json && json.data) { localData = json.data; window.__phfLocalData = localData; }
    updateSaveBadge(json && json.ok ? 'Đã lưu hồ sơ học viên' : 'Chưa lưu được hồ sơ');
    return json;
  } catch (err) {
    console.warn('PHF save profile direct error:', err);
    updateSaveBadge('Không lưu được hồ sơ');
    return null;
  }
}

function phfApplyEmployeeProfile(emp, phoneFallback) {
  const phone = emp.phone || phoneFallback || '';
  const id = emp.id || learnerIdFromPhone(phone) || employeeId;
  employeeId = id;
  localStorage.setItem('phfEmployeeId', id);

  const profile = {
    id: id,
    fullName: emp.fullName || emp.full_name || emp.name || '',
    branch: emp.branch || '',
    birthday: emp.birthday || emp.dob || '',
    phone: phone,
    department: emp.department || '',
    studyStartDate: emp.studyStartDate || emp.study_start_date || '',
    position: emp.position || 'Nhân viên bán hàng mới'
  };
  localStorage.setItem('phfEmployeeProfile', JSON.stringify(profile));
  if (profile.studyStartDate) localStorage.setItem('phfStudyStartDate', profile.studyStartDate);

  ['fullName','phone','department','branch','studyStartDate'].forEach(function (field) {
    const el = document.getElementById(field);
    if (!el) return;
    const key = field === 'fullName' ? 'fullName' : field;
    if (profile[key]) el.value = profile[key];
  });
  const dob = document.getElementById('dob');
  if (dob && profile.birthday) dob.value = profile.birthday;

  const progress = phfProgressFor(id);
  const completed = (progress && progress.completedPages) || [];
  const unlocked = (progress && progress.unlockedSteps) || [];
  const joined = completed.concat(unlocked).join(' | ');
  if (/GD3|Bước 3|step2FinalTest|Bước 2 - Đã đạt/i.test(joined)) localStorage.setItem('phfStep2FinalPassed', 'true');
  if (/GD4|Bước 4|Bước 3 - Đã đạt/i.test(joined)) localStorage.setItem('phfStep3FinalPassed', 'true');
  if (/GD5|Bước 5|Bước 4 - Đã đạt/i.test(joined)) localStorage.setItem('phfStep4FinalPassed', 'true');

  return { profile: profile, progress: progress };
}

function phfGoToResume(progress) {
  if (progress && progress.currentPage && typeof window.phfGoByCurrentPage === 'function') {
    if (window.phfGoByCurrentPage(progress.currentPage)) return;
  }
  const completed = (progress && progress.completedPages || []).join(' | ');
  const unlocked = (progress && progress.unlockedSteps || []).join(' | ');
  const joined = completed + ' | ' + unlocked;
  const lessonMatch = joined.match(/lesson:(\d+)/i);
  if (lessonMatch && typeof window.phfGo === 'function') {
    return window.phfGo(Number(lessonMatch[1]));
  }

  if (/GD5|Bước 5/i.test(unlocked) && typeof window.phfGo === 'function') return window.phfGo(LESSON_STAGE_INDEX(4));
  if (/GD4|Bước 4/i.test(unlocked) && typeof window.phfGo === 'function') return window.phfGo(LESSON_STAGE_INDEX(3));
  if (/GD3|Bước 3/i.test(unlocked) && typeof window.phfGo === 'function') return window.phfGo(LESSON_STAGE_INDEX(2));
  if (typeof window.phfGo === 'function') window.phfGo(1);
}

function LESSON_STAGE_INDEX(stage) {
  const lessons = window.PHF_LESSONS || [];
  const idx = lessons.findIndex(function (x) { return x && x.stage === stage; });
  return idx >= 0 ? idx : 0;
}

function phfShowLearnerGate(force) {
  if (PHF_ADMIN_QUERY && localStorage.getItem('phfAdminTestMode') === 'true') return;
  if (document.getElementById('phfLearnerGate')) return;

  const saved = JSON.parse(localStorage.getItem('phfEmployeeProfile') || '{}');
  if (!force && normalizePhone(saved.phone || '').length >= 8) {
    const found = phfFindEmployeeByPhone(saved.phone);
    if (found) {
      const applied = phfApplyEmployeeProfile(found, saved.phone);
      updateSaveBadge('Đã nạp hồ sơ học viên');
      phfGoToResume(applied.progress);
      // Không lưu lại ngay khi vừa nạp hồ sơ, tránh ghi đè trang đang học bằng trang cũ.
      return;
    }
  }

  const gate = document.createElement('div');
  gate.id = 'phfLearnerGate';
  gate.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(5,38,30,.72);display:grid;place-items:center;padding:22px';
  gate.innerHTML = `
    <div style="width:min(560px,96vw);background:#fff;border-radius:24px;padding:24px;border:1px solid #d9eadf;box-shadow:0 24px 80px rgba(0,0,0,.22);font-family:Segoe UI,Arial;color:#18372d">
      <div style="font-weight:900;color:#064533;font-size:22px;margin-bottom:6px">Tiếp tục học tại PHF Training Hub</div>
      <div style="color:#536d62;font-weight:650;line-height:1.55;margin-bottom:16px">Nhập số điện thoại để hệ thống tìm lại hồ sơ và tiến độ học. Nếu chưa có hồ sơ, hệ thống sẽ chuyển sang màn nhập thông tin người học.</div>
      <label style="font-weight:850;color:#064533">Số điện thoại học viên</label>
      <input id="phfLookupPhone" type="tel" placeholder="Ví dụ: 09xxxxxxxx" style="width:100%;margin:8px 0 12px;border:1px solid #cfe5d7;border-radius:14px;padding:13px 14px;font:700 15px Segoe UI,Arial;outline:none" />
      <div id="phfLookupMsg" style="min-height:22px;color:#b42318;font-weight:750;margin-bottom:10px"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
        <button id="phfLookupNew" type="button" style="border:1px solid #cfe5d7;background:#f4fbf7;color:#064533;border-radius:999px;padding:11px 15px;font-weight:900;cursor:pointer">Tạo hồ sơ mới</button>
        <button id="phfLookupBtn" type="button" style="border:0;background:#064533;color:#fff;border-radius:999px;padding:12px 18px;font-weight:900;cursor:pointer">Tiếp tục học</button>
      </div>
    </div>`;
  document.body.appendChild(gate);

  const input = gate.querySelector('#phfLookupPhone');
  const msg = gate.querySelector('#phfLookupMsg');
  setTimeout(function(){ input && input.focus(); }, 100);

  function continueWithPhone(createIfMissing) {
    const digits = normalizePhone(input.value || '');
    if (digits.length < 8) {
      msg.textContent = 'Vui lòng nhập đúng số điện thoại để nhận diện học viên.';
      return;
    }
    const id = learnerIdFromPhone(digits);
    const found = phfFindEmployeeByPhone(digits);
    if (found && !createIfMissing) {
      const applied = phfApplyEmployeeProfile(found, digits);
      gate.remove();
      updateSaveBadge('Đã tìm thấy hồ sơ');
      phfGoToResume(applied.progress);
      // Không lưu lại ngay khi vừa nạp hồ sơ, tránh ghi đè trang đang học bằng trang cũ.
      return;
    }

    employeeId = id;
    localStorage.setItem('phfEmployeeId', id);
    const profile = { id: id, phone: digits, fullName: '', branch: '', birthday: '', department: '', studyStartDate: '', position: 'Nhân viên bán hàng mới' };
    phfStoreProfile(profile);
    phfSaveProfileDirect(profile, 'learner-phone-init');
    gate.remove();
    updateSaveBadge(found ? 'Mở hồ sơ để cập nhật' : 'Chưa có hồ sơ · vui lòng nhập thông tin');
    if (typeof window.phfGo === 'function') window.phfGo(1);
    setTimeout(function(){
      const phoneEl = document.getElementById('phone');
      if (phoneEl) phoneEl.value = digits;
    }, 200);
  }

  gate.querySelector('#phfLookupBtn').addEventListener('click', function(){ continueWithPhone(false); });
  gate.querySelector('#phfLookupNew').addEventListener('click', function(){ continueWithPhone(true); });
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter') continueWithPhone(false); });
}

window.phfShowLearnerGate = phfShowLearnerGate;


// Lưu chắc hồ sơ ở màn Thông tin người học trước khi chuyển trang.
document.addEventListener('click', function(e) {
  const btn = e.target.closest('button, [data-go]');
  if (!btn) return;
  const go = btn.getAttribute('data-go') || '';
  const label = (btn.textContent || '').toLowerCase();
  if (go === 'ruleTimePage' || /xác nhận thông tin/.test(label)) {
    const profile = phfReadInfoFormProfile();
    phfStoreProfile(profile);
    phfSaveProfileDirect(profile, 'employee-info-confirm');
  }
}, true);

// Cập nhật localStorage ngay khi nhập form để F5 không mất hồ sơ.
document.addEventListener('input', function(e) {
  if (e.target && ['fullName','dob','phone','department','branch','studyStartDate'].includes(e.target.id)) {
    phfStoreProfile(phfReadInfoFormProfile());
  }
}, true);

document.addEventListener('change', function(e) {
  if (e.target && ['fullName','dob','phone','department','branch','studyStartDate'].includes(e.target.id)) {
    phfStoreProfile(phfReadInfoFormProfile());
  }
}, true);

/* PATCH: Chấm điểm bài test Bước 2 - không đụng index.html */
document.addEventListener('click', function (e) {
  const btn = e.target.closest('#gradeStep2Test');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();

  const questions = Array.from(document.querySelectorAll('.step2-question'));
  const resultEl = document.getElementById('step2TestResult');

  if (!questions.length) {
    if (resultEl) {
      resultEl.innerHTML = 'Không tìm thấy câu hỏi test Bước 2. Vui lòng kiểm tra lại nội dung trang.';
    }
    return;
  }

  let answered = 0;
  let correct = 0;

  questions.forEach(function (q) {
    const correctAnswer = (q.getAttribute('data-correct') || '').trim().toLowerCase();
    const checked = q.querySelector('input[type="radio"]:checked');

    q.style.borderColor = '#d9eadf';
    q.style.background = '#fbfdfc';

    if (checked) {
      answered += 1;

      if ((checked.value || '').trim().toLowerCase() === correctAnswer) {
        correct += 1;
        q.style.borderColor = '#8ccfa2';
        q.style.background = '#f0fbf4';
      } else {
        q.style.borderColor = '#efb4a8';
        q.style.background = '#fff7f4';
      }
    }
  });

  if (answered < questions.length) {
    if (resultEl) {
      resultEl.innerHTML =
        'Anh/chị đã chọn <b>' + answered + '/' + questions.length +
        '</b> câu. Vui lòng chọn đủ câu trước khi chấm điểm.';
    }
    updateSaveBadge('Chưa chọn đủ câu');
    return;
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= PASS_SCORE;

  if (resultEl) {
    resultEl.innerHTML =
      'Kết quả: <b>' + correct + '/' + questions.length + ' câu đúng</b> · ' +
      '<b>' + score + '/100 điểm</b> · ' +
      (passed
        ? '<span style="color:#0b6b48;font-weight:900">Đạt</span>'
        : '<span style="color:#b42318;font-weight:900">Chưa đạt</span>') +
      '<br><span style="color:#536d62">Điểm đạt yêu cầu: 80/100 điểm.</span>';
  }

  window.__phfLastStep2TestResult = {
    page: activePageId(),
    score: score,
    correct: correct,
    total: questions.length,
    passScore: PASS_SCORE,
    status: passed ? 'Đạt' : 'Chưa đạt',
    resultText: resultEl ? resultEl.textContent.replace(/\s+/g, ' ').trim() : ''
  };

  updateSaveBadge('Đã chấm test');

  setTimeout(function () {
    saveLocal('test');
  }, 300);
}, true);


/* PATCH: Admin test mode - mở khóa để test giao diện, không cần làm bài thật */
function enableAdminTestMode() {
  localStorage.setItem('phfAdminTestMode', 'true');
  localStorage.setItem('phfStep2FinalPassed', 'true');
  localStorage.setItem('phfEmployeeId', 'admin-test-phf');
  localStorage.setItem('phfEmployeeProfile', JSON.stringify({
    id: 'admin-test-phf',
    fullName: 'Admin Test PHF',
    branch: 'Văn phòng',
    birthday: '',
    phone: '',
    department: 'Admin/HCNS',
    position: 'Admin test - mở khóa toàn bộ'
  }));

  updateSaveBadge('Admin test · đang lưu');
  saveLocal('admin-test-unlock');
}

function disableAdminTestMode() {
  localStorage.removeItem('phfAdminTestMode');
  localStorage.removeItem('phfStep2FinalPassed');
  localStorage.removeItem('phfStep3FinalPassed');
  localStorage.removeItem('phfStep4FinalPassed');
  localStorage.removeItem('phfEmployeeId');
  localStorage.removeItem('phfEmployeeProfile');
  updateSaveBadge('Đã tắt quản trị');
  setTimeout(function () {
    if (PHF_ADMIN_QUERY) {
      window.location.href = window.location.pathname;
    } else {
      location.reload();
    }
  }, 500);
}

function addAdminTestButton() {
  if (document.getElementById('phfAdminTestButton')) return;

  const box = document.createElement('div');
  box.id = 'phfAdminTestBox';
  box.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;gap:8px;align-items:center';

  const btn = document.createElement('button');
  btn.id = 'phfAdminTestButton';
  btn.type = 'button';
  btn.textContent = localStorage.getItem('phfAdminTestMode') === 'true'
    ? 'Quản trị: Đang bật'
    : 'Bật quản trị';
  btn.style.cssText =
    'border:0;border-radius:999px;padding:10px 13px;background:#7a4b00;color:#fff;font:800 12px Segoe UI,Arial;box-shadow:0 10px 24px rgba(0,0,0,.18);cursor:pointer';

  const off = document.createElement('button');
  off.type = 'button';
  off.textContent = 'Tắt quản trị';
  off.style.cssText =
    'border:0;border-radius:999px;padding:10px 11px;background:#f3eadc;color:#7a4b00;font:800 12px Segoe UI,Arial;box-shadow:0 10px 24px rgba(0,0,0,.10);cursor:pointer';

  btn.addEventListener('click', function () {
    enableAdminTestMode();
    btn.textContent = 'Quản trị: Đang bật';
  });

  off.addEventListener('click', function () {
    disableAdminTestMode();
  });

  box.appendChild(btn);
  box.appendChild(off);
  document.body.appendChild(box);
}

// Chỉ hiện công cụ quản trị khi mở bằng link đặc biệt: ?admin=1.
// Luồng học viên thường sẽ không thấy nút Quản trị để tránh test/lưu sai tiến độ.
if (PHF_ADMIN_QUERY) {
  addAdminTestButton();
  enableAdminTestMode();
}


/* PATCH: Chấm điểm và làm gọn phần cuối bài kiểm tra Bước 3 */
function gradeStep3Test() {
  const screen = document.getElementById('b3TestPage') || document.getElementById('mainLesson');
  if (!screen) return;

  const questions = Array.from(screen.querySelectorAll('.b3-test .b3-mini[data-answer]'));
  const resultEl = screen.querySelector('#b3Result');
  const nextBtn = screen.querySelector('#goB3Complete');

  if (!questions.length) {
    if (resultEl) {
      resultEl.className = 'b3-result fail';
      resultEl.innerHTML = 'Không tìm thấy câu hỏi bài kiểm tra Bước 3. Vui lòng kiểm tra lại nội dung trang.';
    }
    return;
  }

  let answered = 0;
  let correct = 0;

  questions.forEach(function (q) {
    const correctAnswer = (q.getAttribute('data-answer') || '').trim().toLowerCase();
    const checked = q.querySelector('input[type="radio"]:checked');

    q.classList.remove('b3-correct', 'b3-incorrect');

    if (checked) {
      answered += 1;
      if ((checked.value || '').trim().toLowerCase() === correctAnswer) {
        correct += 1;
        q.classList.add('b3-correct');
      } else {
        q.classList.add('b3-incorrect');
      }
    }
  });

  if (answered < questions.length) {
    if (resultEl) {
      resultEl.className = 'b3-result fail';
      resultEl.innerHTML =
        'Anh/chị đã chọn <b>' + answered + '/' + questions.length +
        '</b> câu. Vui lòng chọn đủ câu trước khi chấm điểm.';
    }
    if (nextBtn) nextBtn.style.display = 'none';
    updateSaveBadge('Chưa chọn đủ câu');
    return;
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= PASS_SCORE;

  if (resultEl) {
    resultEl.className = 'b3-result ' + (passed ? 'pass' : 'fail');
    resultEl.innerHTML =
      '<b>Kết quả:</b> ' + correct + '/' + questions.length + ' câu đúng · ' +
      '<b>' + score + '/100 điểm</b> · ' +
      (passed
        ? '<span style="color:#0b6b48;font-weight:900">Đạt</span>'
        : '<span style="color:#b42318;font-weight:900">Chưa đạt</span>') +
      '<br><span style="color:#536d62">Điểm đạt yêu cầu: 80/100 điểm.</span>';
  }

  if (passed) {
    localStorage.setItem('phfStep3FinalPassed', 'true');
  }

  if (nextBtn) {
    nextBtn.style.display = passed ? 'inline-flex' : 'none';
  }

  window.__phfLastStep2TestResult = {
    page: activePageId(),
    score: score,
    correct: correct,
    total: questions.length,
    passScore: PASS_SCORE,
    status: passed ? 'Đạt' : 'Chưa đạt',
    resultText: resultEl ? resultEl.textContent.replace(/\s+/g, ' ').trim() : ''
  };

  updateSaveBadge(passed ? 'Đã chấm · Đạt Bước 3' : 'Đã chấm · Chưa đạt');

  setTimeout(function () {
    saveLocal('test');
  }, 300);
}

document.addEventListener('click', function (e) {
  const gradeBtn = e.target.closest('#gradeB3Test');
  if (gradeBtn) {
    e.preventDefault();
    gradeStep3Test();
    return;
  }

  const completeBtn = e.target.closest('#goB3Complete');
  if (completeBtn) {
    e.preventDefault();
    const nextMainBtn = document.querySelector('#mainLesson .actions .btn-primary');
    if (nextMainBtn) {
      nextMainBtn.click();
    }
  }
}, true);

document.addEventListener('change', function (e) {
  if (!e.target.matches('#b3Test input[type="radio"]')) return;
  const mini = e.target.closest('.b3-mini');
  if (mini) {
    mini.classList.remove('b3-correct', 'b3-incorrect');
  }
});


/* PATCH: Chấm điểm bài kiểm tra cuối Bước 4 - ẩn đáp án, đạt mới hoàn thành */
function gradeStep4FinalTest() {
  const screen = document.getElementById('b4FinalTest') || document.getElementById('mainLesson');
  if (!screen) return;

  const questions = Array.from(screen.querySelectorAll('.b4-final-test .b4-quiz[data-correct]'));
  const resultEl = screen.querySelector('#b4FinalResult');
  const nextBtn = screen.querySelector('#goB4Complete');

  if (!questions.length) {
    if (resultEl) {
      resultEl.className = 'b4-result fail';
      resultEl.innerHTML = 'Không tìm thấy câu hỏi bài kiểm tra cuối Bước 4. Vui lòng kiểm tra lại nội dung trang.';
    }
    return;
  }

  let answered = 0;
  let correct = 0;

  questions.forEach(function (q) {
    const correctAnswer = (q.getAttribute('data-correct') || '').trim().toLowerCase();
    const checked = q.querySelector('input[type="radio"]:checked');

    q.classList.remove('b4-correct', 'b4-incorrect');

    if (checked) {
      answered += 1;
      if ((checked.value || '').trim().toLowerCase() === correctAnswer) {
        correct += 1;
        q.classList.add('b4-correct');
      } else {
        q.classList.add('b4-incorrect');
      }
    }
  });

  if (answered < questions.length) {
    if (resultEl) {
      resultEl.className = 'b4-result fail';
      resultEl.innerHTML =
        'Anh/chị đã chọn <b>' + answered + '/' + questions.length +
        '</b> câu. Vui lòng chọn đủ câu trước khi chấm điểm.';
    }
    if (nextBtn) nextBtn.style.display = 'none';
    updateSaveBadge('Chưa chọn đủ câu');
    return;
  }

  const score = Math.round((correct / questions.length) * 100);
  const passed = score >= PASS_SCORE;

  if (resultEl) {
    resultEl.className = 'b4-result ' + (passed ? 'pass' : 'fail');
    resultEl.innerHTML =
      '<b>Kết quả:</b> ' + correct + '/' + questions.length + ' câu đúng · ' +
      '<b>' + score + '/100 điểm</b> · ' +
      (passed
        ? '<span style="color:#0b6b48;font-weight:900">Đạt</span>'
        : '<span style="color:#b42318;font-weight:900">Chưa đạt</span>') +
      '<br><span style="color:#536d62">Điểm đạt yêu cầu: 80/100 điểm.</span>';
  }

  if (passed) {
    localStorage.setItem('phfStep4FinalPassed', 'true');
  }

  if (nextBtn) {
    nextBtn.style.display = passed ? 'inline-flex' : 'none';
  }

  window.__phfLastStep2TestResult = {
    page: activePageId(),
    score: score,
    correct: correct,
    total: questions.length,
    passScore: PASS_SCORE,
    status: passed ? 'Đạt' : 'Chưa đạt',
    resultText: resultEl ? resultEl.textContent.replace(/\s+/g, ' ').trim() : ''
  };

  updateSaveBadge(passed ? 'Đã chấm · Đạt Bước 4' : 'Đã chấm · Chưa đạt');

  setTimeout(function () {
    saveLocal('test');
  }, 300);
}

document.addEventListener('click', function (e) {
  const gradeBtn = e.target.closest('#gradeB4Final');
  if (gradeBtn) {
    e.preventDefault();
    gradeStep4FinalTest();
    return;
  }

  const completeBtn = e.target.closest('#goB4Complete');
  if (completeBtn) {
    e.preventDefault();
    const nextMainBtn = document.querySelector('#mainLesson .actions .btn-primary');
    if (nextMainBtn) {
      nextMainBtn.click();
    }
  }
}, true);

document.addEventListener('change', function (e) {
  if (!e.target.matches('#b4FinalTest input[type="radio"]')) return;
  const card = e.target.closest('.b4-quiz');
  if (card) {
    card.classList.remove('b4-correct', 'b4-incorrect');
  }
});


/* PATCH: Trộn thứ tự đáp án cho tất cả bài kiểm tra thật
   - Không đổi đáp án đúng; chỉ đảo vị trí các lựa chọn hiển thị.
   - Không trộn phần ôn nhanh/câu hỏi gợi ý nếu không có data-correct/data-answer.
   - Không trộn thứ tự câu hỏi để người học vẫn dễ theo dõi số câu. */
function phfShuffleArray(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function phfShuffleTestAnswers(root) {
  const scope = root || document;
  const questionCards = Array.from(scope.querySelectorAll(
    '.step2-question[data-correct], .b3-test .b3-mini[data-answer], .b4-final-question[data-correct], .b4-final-test .b4-quiz[data-correct]'
  ));

  questionCards.forEach(function (card) {
    if (card.getAttribute('data-phf-shuffled') === '1') return;

    const labels = Array.from(card.children).filter(function (child) {
      return child && child.tagName === 'LABEL' && child.querySelector('input[type="radio"]');
    });

    if (labels.length < 2) return;

    card.setAttribute('data-phf-shuffled', '1');
    phfShuffleArray(labels).forEach(function (label) {
      card.appendChild(label);
    });
  });
}

function phfStartShuffleObserver() {
  phfShuffleTestAnswers(document);

  const main = document.getElementById('mainLesson') || document.body;
  if (!main || window.__phfShuffleObserverStarted) return;

  window.__phfShuffleObserverStarted = true;
  const observer = new MutationObserver(function () {
    phfShuffleTestAnswers(main);
  });

  observer.observe(main, { childList: true, subtree: true });

  document.addEventListener('click', function () {
    setTimeout(function () { phfShuffleTestAnswers(main); }, 80);
  }, true);
}

phfStartShuffleObserver();


})();