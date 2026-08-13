'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const engineSource = read('assets/js/ai/phf-ai-engine.js');
const floatingSource = read('assets/js/ai/phf-ai-floating.js');
const sandboxSource = read('assets/js/ai/phf-ai-sandbox.js');
const css = read('assets/css/phf-ai-sandbox.css');

function compact(value){ return String(value || '').replace(/\s+/g, ''); }
function cssRule(selector){
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\{([^}]+)\\}'));
  assert(match, 'Missing CSS rule: ' + selector);
  return compact(match[1]);
}

function tick(){ return new Promise(resolve => setTimeout(resolve, 0)); }

(async function(){
  const dom = new JSDOM('<!doctype html><html><body><div id="standard"></div></body></html>', {
    url: 'http://localhost/admin', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const requests = [];
  let resolveChat;
  window.fetch = (url, options) => {
    requests.push({ url, options });
    if (url === '/api/ai/chat') {
      return new Promise(resolve => { resolveChat = () => resolve({ ok: true, json: async () => ({ ok: true, reply: 'Đã rõ.' }) }); });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ok: true, conversations: [] }) });
  };
  window.phfGetSessionRole = () => 'admin';
  window.phfGetCurrentUser = () => ({ fullName: 'Nguyễn Văn An', email: 'an@example.com' });
  window.phfWhenAuthReady = () => Promise.resolve(window.phfGetCurrentUser());
  window.matchMedia = query => ({ matches: false, media: query, addListener(){}, removeListener(){} });
  window.eval(engineSource);

  const standard = window.document.getElementById('standard');
  window.PHFAiEngine.mount(standard, {});
  assert(standard.textContent.includes('Tôi có thể hỗ trợ gì cho bạn hôm nay?'), 'Sandbox/default empty state changed unexpectedly.');
  assert(!standard.querySelector('[data-ai-suggestion]'), 'Floating suggestions leaked into the shared default engine view.');
  assert(standard.querySelector('[data-ai-send]').textContent.includes('Gửi'), 'Default sandbox send button changed unexpectedly.');

  window.eval(floatingSource);
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  const widget = window.document.getElementById('phfAiFloatingWidget');
  assert(widget && !widget.hidden, 'Admin floating widget must be visible.');
  const toggle = widget.querySelector('[data-ai-floating-toggle]');
  toggle.click();
  const panel = widget.querySelector('[data-ai-floating-panel]');
  assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(panel.getAttribute('aria-hidden'), 'false');
  assert(panel.textContent.includes('Chào Nguyễn Văn An'), 'Safe session display name was not used.');
  assert(panel.textContent.includes('Trợ lý nhân sự PHF'), 'New floating header subtitle is missing.');
  assert.strictEqual(panel.querySelectorAll('[data-ai-suggestion]').length, 3, 'Floating must expose three quick actions.');
  assert.strictEqual(panel.querySelector('[data-ai-input]').getAttribute('placeholder'), 'Nhắn PHF AI…');
  assert.strictEqual(panel.querySelector('[data-ai-send]').getAttribute('aria-label'), 'Gửi câu hỏi');
  assert(panel.querySelector('[data-ai-send] svg'), 'Floating send action must use the inline up-arrow SVG.');
  assert(!panel.querySelector('[data-ai-send]').textContent.trim(), 'Floating send action must not contain visible text.');
  assert(widget.querySelector('[data-ai-floating-history] svg') && widget.querySelector('[data-ai-floating-close] svg'), 'Header actions must use inline SVG icons.');
  assert.strictEqual(toggle.querySelector('img').getAttribute('src'), 'assets/logo/phf-ai-mark-icon-v2.png?v=1.45.12_ai_mark_recompose');
  assert.strictEqual(panel.querySelector('.phf-ai-mark img').getAttribute('src'), toggle.querySelector('img').getAttribute('src'), 'Header and floating button must use the same canonical logo markup.');

  const suggestion = panel.querySelector('[data-ai-suggestion]');
  suggestion.click();
  suggestion.click();
  assert.strictEqual(requests.filter(item => item.url === '/api/ai/chat').length, 1, 'Suggestion must use the guarded shared submit flow without double submit.');
  const chatBody = JSON.parse(requests.find(item => item.url === '/api/ai/chat').options.body);
  assert.strictEqual(chatBody.messages[0].content, 'Tóm tắt nhân sự hôm nay');
  resolveChat();
  await tick(); await tick();

  const input = panel.querySelector('[data-ai-input]');
  input.value = 'Dòng một';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  assert.strictEqual(requests.filter(item => item.url === '/api/ai/chat').length, 1, 'Shift+Enter must not submit.');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.strictEqual(requests.filter(item => item.url === '/api/ai/chat').length, 2, 'Enter must use the shared submit flow.');
  resolveChat();
  await tick(); await tick();
  panel.querySelector('[data-ai-new]').click();
  assert(panel.textContent.includes('Chào Nguyễn Văn An'), 'New conversation must restore the floating empty state.');
  widget.querySelector('[data-ai-floating-history]').click();
  await tick();
  assert(!panel.querySelector('[data-ai-history-view]').hidden, 'History action must open the existing history view.');
  panel.querySelector('[data-ai-history-close]').click();
  assert(panel.querySelector('[data-ai-history-view]').hidden, 'History close action must restore chat view.');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.strictEqual(panel.getAttribute('aria-hidden'), 'true', 'Escape must close the floating panel.');

  assert(floatingSource.includes("variant: 'floating'"), 'Floating mount must explicitly select the floating variant.');
  assert(sandboxSource.includes("PHFAiEngine.mount(root.querySelector('[data-ai-engine-root]'), {})"), 'Sandbox must keep the default shared-engine mount.');
  assert(floatingSource.includes('var ALLOWED_ROLES = { admin: true };'), 'Existing Admin-only gate changed.');
  assert(floatingSource.includes('assets/logo') === false, 'Floating must consume the shared logo source rather than introduce another asset path.');
  assert(engineSource.includes('assets/logo/phf-ai-mark-icon-v2.png'), 'PHF AI logo source of truth changed.');
  assert(!engineSource.includes('Bé Cam') && !floatingSource.includes('Bé Cam'), 'Forbidden mascot copy found.');
  assert(css.includes('@media(prefers-reduced-motion:reduce)'), 'Reduced-motion support is required.');
  assert(css.includes('.phf-ai-floating .phf-ai-suggestion:') || css.includes('.phf-ai-floating .phf-ai-suggestion{'), 'Suggestion styling must stay scoped to floating.');

  const panelRule = cssRule('.phf-ai-floating-panel');
  assert(panelRule.includes('right:24px;bottom:120px;width:min(400px,calc(100vw-40px));height:min(600px,calc(100vh-158px));'), 'Desktop panel geometry must exactly match the pre-redesign HEAD canonical values.');
  const toggleRule = cssRule('.phf-ai-floating-btn');
  assert(toggleRule.includes('width:60px;height:60px;border-radius:50%;border:0;background:transparent;box-shadow:none;') && toggleRule.includes('padding:4px;'), 'Floating logo button container must match HEAD.');
  const toggleImageRule = cssRule('.phf-ai-floating-btn img');
  assert(toggleImageRule.includes('width:56px;height:56px;object-fit:contain;display:block;filter:drop-shadow(04px10pxrgba(150,74,10,.35))'), 'Floating logo image style must match HEAD.');
  const headerMarkRule = cssRule('.phf-ai-floating-panel-head .phf-ai-mark');
  assert(headerMarkRule.includes('width:44px;height:44px;border-radius:14px;padding:0;box-sizing:border-box'), 'Header logo container must match HEAD.');
  assert(cssRule('.phf-ai-floating-panel-head .phf-ai-mark img').includes('width:30px;height:30px'), 'Header logo image dimensions must match HEAD.');
  const composerRule = cssRule('.phf-ai-floating .phf-ai-composer-shell');
  const inputRule = cssRule('.phf-ai-floating .phf-ai-input');
  assert(composerRule.includes('border:1pxsolid#d9dfdb') && composerRule.includes('box-shadow:none'), 'Composer outer must be the only bordered surface.');
  assert(inputRule.includes('border:0!important') && inputRule.includes('outline:0') && inputRule.includes('background:transparent') && inputRule.includes('box-shadow:none!important'), 'Composer textarea must not draw a second surface or focus ring.');
  const composerFocusRule = cssRule('.phf-ai-floating .phf-ai-composer-shell:focus-within');
  assert(composerFocusRule.includes('border-color:#7fa68c') && composerFocusRule.includes('box-shadow:none') && composerFocusRule.includes('outline:0'), 'Composer focus must only change the outer border color.');
  assert(!css.includes('.phf-ai-floating textarea:focus-visible'), 'Textarea must not receive the generic floating focus outline.');

  console.log('PHF AI floating redesign contract: variant, accessibility, submit flow, sandbox isolation — PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
