'use strict';
/* Regression test for the checklist template hydration race (P0 hotfix).
   Loads the real assets/js/checklist/phf-checklist-app.js in a sandbox with
   window.__phfLocalData already populated before the script runs - this
   reproduces the cold-load race where /api/data resolves before the
   lazily-loaded route module (phf-url-router.js ensureRouteModule) finishes
   downloading. Before the fix this threw "Cannot read properties of
   undefined (reading 'hydratedSource')" from the eager top-level
   templateCatalog() call, aborting the IIFE before window.phfRenderChecklist
   was assigned - which is what made phf-url-router.js time out with
   PHF_CHECKLIST_RENDERER_TIMEOUT ("Chưa thể mở Checklist"). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const filePath = 'assets/js/checklist/phf-checklist-app.js';
const source = fs.readFileSync(path.join(root, filePath), 'utf8');

function buildSandbox(preHydratedData) {
  const noop = function(){};
  const localStorageStore = {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.console = console;
  sandbox.addEventListener = noop;
  sandbox.removeEventListener = noop;
  sandbox.dispatchEvent = noop;
  sandbox.PHF_BUILD_INFO = { version: 'test', fingerprint: 'test' };
  sandbox.document = {
    documentElement: { setAttribute: noop, getAttribute: function(){return null;} },
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: function(){return null;},
    querySelectorAll: function(){return [];},
    getElementById: function(){return null;},
    createElement: function(){return {style:{},setAttribute:noop,addEventListener:noop,classList:{add:noop,remove:noop}};},
    body: {classList:{add:noop,remove:noop}},
    readyState: 'complete'
  };
  sandbox.location = { pathname: '/admin/checklist', search: '', hash: '', origin: 'http://localhost' };
  sandbox.history = { pushState: noop, replaceState: noop, state: null };
  sandbox.localStorage = {
    getItem: function(k){return Object.prototype.hasOwnProperty.call(localStorageStore,k)?localStorageStore[k]:null;},
    setItem: function(k,v){localStorageStore[k]=String(v);},
    removeItem: function(k){delete localStorageStore[k];}
  };
  sandbox.navigator = { userAgent: 'node-test' };
  sandbox.matchMedia = null;
  sandbox.MutationObserver = function(){ return { observe: noop, disconnect: noop }; };
  sandbox.fetch = function(){ return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({}); } }); };
  sandbox.URL = URL;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.requestAnimationFrame = function(fn){ return setTimeout(fn,0); };
  sandbox.CSS = { escape: function(v){ return String(v); } };
  sandbox.__phfLocalData = preHydratedData || null;
  return vm.createContext(sandbox);
}

function loadInSandbox(preHydratedData) {
  const context = buildSandbox(preHydratedData);
  const script = new vm.Script(source, { filename: filePath });
  script.runInContext(context);
  return context;
}

let failures = 0;
function check(condition, message) {
  if (!condition) { console.error('FAIL: ' + message); failures++; }
  else console.log('PASS: ' + message);
}

/* Case 1: window.__phfLocalData already populated when the module executes
   (cold-load race). Must not throw, and the router-polled renderer must be
   registered - otherwise phf-url-router.js's waitForRouteModule times out
   with PHF_CHECKLIST_RENDERER_TIMEOUT. */
try {
  const raceData = { checklistTemplatesReady: false, checklistTemplates: [], employees: [] };
  const ctx = loadInSandbox(raceData);
  check(true, 'cold-load race (data pre-populated) does not throw');
  check(typeof ctx.window.phfRenderChecklist === 'function', 'window.phfRenderChecklist is registered after cold-load race');
} catch (e) {
  check(false, 'cold-load race (data pre-populated) does not throw - got ' + e.constructor.name + ': ' + e.message);
}

/* Case 2: window.__phfLocalData not yet populated (the normal/F5 path where
   the fetch has not resolved yet). Must also not throw. */
try {
  const ctx = loadInSandbox(null);
  check(true, 'normal path (data not yet loaded) does not throw');
  check(typeof ctx.window.phfRenderChecklist === 'function', 'window.phfRenderChecklist is registered on normal path');
} catch (e) {
  check(false, 'normal path (data not yet loaded) does not throw - got ' + e.constructor.name + ': ' + e.message);
}

if (failures) {
  console.error(failures + ' check(s) failed.');
  process.exit(1);
}
console.log('All checks passed.');
