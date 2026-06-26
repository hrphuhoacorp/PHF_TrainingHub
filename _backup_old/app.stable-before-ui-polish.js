/* PHF Training Hub Local Prototype - app.js
   Lưu dữ liệu local vào data.json qua server.js.
   Không thay thế luồng giao diện gốc trong index.html. */

(function () {
  console.log('PHF app.js loaded');

  const API = '/api/data';
  const PASS_SCORE = 80;

  let localData = null;
  let employeeId = localStorage.getItem('phfEmployeeId') || 'demo-nv-001';
  localStorage.setItem('phfEmployeeId', employeeId);

function activePageId() {
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
  const adminMode = localStorage.getItem('phfAdminTestMode') === 'true';

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

  const normalizedName = rawName.replace(/\s+/g, ' ').trim();

  const finalFullName = normalizedName || savedEmployee.fullName || 'Nhân viên demo PHF';
  const finalBranch = rawBranch || savedEmployee.branch || 'Chưa phân chi nhánh';
  const finalBirthday = rawBirthday || savedEmployee.birthday || '';
  const finalPhone = rawPhone || savedEmployee.phone || '';
  const finalDepartment = rawDepartment || savedEmployee.department || '';

  if (normalizedName) {
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
    position: 'Nhân viên bán hàng mới'
  };

  if (normalizedName || rawBranch || rawBirthday || rawPhone || rawDepartment) {
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
    }

    const step2Passed = localStorage.getItem('phfStep2FinalPassed') === 'true';
    const adminMode = localStorage.getItem('phfAdminTestMode') === 'true';

    const completedPages = completedPagesFromDom();
    const unlockedSteps = [activePageId()];

    if (step2Passed || adminMode) {
      completedPages.push('GD2');
      completedPages.push('step2FinalTest');
      completedPages.push('Bước 2 - Đã đạt test cuối');

      unlockedSteps.push('GD3');
      unlockedSteps.push('Bước 3 - Quy trình');
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

    const payload = {
      type: type || 'autosave',
      employee: collectEmployee(),
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
  async function loadLocal() {
    try {
      const res = await fetch(API);
      localData = await res.json();
      updateSaveBadge('Đã kết nối data.json');
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
      alert((msg || 'Đã lưu thử') + '.');
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
  updateSaveBadge('Đang thử lưu...');
  saveLocal('page-open');
});

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
  localStorage.removeItem('phfEmployeeId');
  localStorage.removeItem('phfEmployeeProfile');
  updateSaveBadge('Đã tắt Admin test');
  setTimeout(function () { location.reload(); }, 500);
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
    ? 'Admin test: Đang bật'
    : 'Bật Admin test';
  btn.style.cssText =
    'border:0;border-radius:999px;padding:10px 13px;background:#7a4b00;color:#fff;font:800 12px Segoe UI,Arial;box-shadow:0 10px 24px rgba(0,0,0,.18);cursor:pointer';

  const off = document.createElement('button');
  off.type = 'button';
  off.textContent = 'Tắt';
  off.style.cssText =
    'border:0;border-radius:999px;padding:10px 11px;background:#f3eadc;color:#7a4b00;font:800 12px Segoe UI,Arial;box-shadow:0 10px 24px rgba(0,0,0,.10);cursor:pointer';

  btn.addEventListener('click', function () {
    enableAdminTestMode();
    btn.textContent = 'Admin test: Đang bật';
  });

  off.addEventListener('click', function () {
    disableAdminTestMode();
  });

  box.appendChild(btn);
  box.appendChild(off);
  document.body.appendChild(box);
}

if (location.search.includes('admin=1') || localStorage.getItem('phfAdminTestMode') === 'true') {
  addAdminTestButton();
  if (location.search.includes('admin=1')) {
    enableAdminTestMode();
  }
} else {
  addAdminTestButton();
}

})();