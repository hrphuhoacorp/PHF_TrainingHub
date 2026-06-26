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
    const active = document.querySelector('.page.active');
    return active ? active.id : 'welcomePage';
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
  const fullNameEl = document.getElementById('fullName');
  const branchEl = document.getElementById('branch');
  const dobEl = document.getElementById('dob');
  const phoneEl = document.getElementById('phone');
  const departmentEl = document.getElementById('department');

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

  if (normalizedName) {
    employeeId = normalizedName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'demo-nv-001';

    localStorage.setItem('phfEmployeeId', employeeId);
  }

  return {
    id: employeeId,
    fullName: normalizedName || 'Nhân viên demo PHF',
    branch: rawBranch || 'Chưa phân chi nhánh',
    birthday: rawBirthday,
    phone: rawPhone,
    department: rawDepartment,
    position: 'Nhân viên bán hàng mới'
  };
}

  function getVisibleText(selector) {
    const el = document.querySelector(selector);
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function detectTestResult() {
    const page = activePageId();

    const resultText = [
      getVisibleText('#step2TestResult'),
      getVisibleText('.b3-result.pass'),
      getVisibleText('.b3-result.fail'),
      getVisibleText('.test-result-box'),
      getVisibleText('.b2-result.pass'),
      getVisibleText('.b2-result.fail')
    ].filter(Boolean).join(' | ');

    if (!resultText) return null;

    const scoreMatch = resultText.match(/(\d{1,3})\s*\/\s*100|điểm\s*(\d{1,3})|(\d{1,3})\s*%/i);
    const score = scoreMatch ? Number(scoreMatch[1] || scoreMatch[2] || scoreMatch[3]) : null;

    const passed =
      /đạt|pass|mở bước|hoàn thành/i.test(resultText) &&
      !/chưa đạt|không đạt|fail/i.test(resultText);

    return {
      page,
      score,
      passScore: PASS_SCORE,
      status: passed || (score !== null && score >= PASS_SCORE) ? 'Đạt' : 'Chưa đạt',
      resultText
    };
  }

  function completedPagesFromDom() {
    return Array.from(document.querySelectorAll('.nav-step.done, .phf-nav-item.done, .todo-item.done, .active'))
      .map(el => el.getAttribute('data-go') || el.getAttribute('data-page') || el.id || '')
      .filter(Boolean);
  }

  async function saveLocal(type) {
    try {
      const payload = {
        type: type || 'autosave',
        employee: collectEmployee(),
        currentPage: activePageId(),
        completedPages: completedPagesFromDom(),
        unlockedSteps: [activePageId()],
        testResult: type === 'test' ? detectTestResult() : null
      };

      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      localData = json.data || localData;

      updateSaveBadge(json.ok ? 'Đã lưu' : 'Chưa lưu được');
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

    setTimeout(function () {
      const text = (target.id || '') + ' ' + (target.textContent || '');
      const isTestButton = /grade|test|nộp|chấm|hoàn thành/i.test(text);
      const isInfoButton = /xác nhận thông tin|vào bước 1/i.test(text);

      saveLocal(isTestButton ? 'test' : isInfoButton ? 'employee-info' : 'navigation');
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
})();