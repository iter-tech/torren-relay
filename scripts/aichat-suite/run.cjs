// Headless-Chrome proof for EXT-D10. Real extension files, real world separation:
//   content/aiChatBridge.js -> MAIN world at document start (addInitScript)
//   content/aiChatKey.js    -> ISOLATED world "tenlane" at document start (CDP worldName)
//   designTokens/constants/logger/inlinePanel/aiChat -> same ISOLATED world after load
// Only getLoadRecord / readMainCardElements / isAuthGateActiveSync are stubbed.
//
// SETUP (once, in this folder — node_modules/ is gitignored):
//   npm install react@18.3.1 react-dom@18.3.1 --no-save
// RUN:
//   node scripts/aichat-suite/run.cjs
// PLAYWRIGHT_CORE and CHROME env vars override the two paths below. Nothing here touches Amazon:
// the page is served from 127.0.0.1 by this script.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE ||
  'C:/Users/Ігор/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');

const REPO = path.resolve(__dirname, '..', '..');
const HERE = __dirname;
const OUT = process.env.AICHAT_OUT || path.join(require('os').tmpdir(), 'aichat-suite');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const rd = (p) => fs.readFileSync(p, 'utf8');

const L = ['0a1b', '1c2d', '2e3f', '3a4b', '4c5d', '5e6f'].map(p => p + '0000-1111-4222-8333-444455556666');
const SETS = {
  full:  { loads: L.map((id, i) => ({ id, dse: [true, true, false, true, true, true][i], pay: 700 + i * 10 })),
           candidates: [L[0], L[1], L[3]], wolist: [L[0], L[1], L[2], L[3], L[4]] },
  noctx: { loads: L.slice(0, 3).map((id, i) => ({ id, dse: true, pay: 800 + i })), candidates: [], wolist: [] },
  three: { loads: [{ id: L[0], dse: true, pay: 900 }, { id: L[1], dse: false, pay: 901 }, { id: L[2], dse: undefined, pay: 902 }],
           candidates: [L[0]], wolist: [L[0], L[1], L[2]] },
};
SETS.provideronly = SETS.full;   // EXT-D10.1: decoy Provider only, nothing consumes it
SETS.nopanel = SETS.full;        // EXT-D10.1: real context consumed, chat panel never renders

// The first version (commit aaad6d3), for the regression run — read from git, never from disk copies.
const OLD_COMMIT = 'aaad6d3';
const gitShow = (rel) => require('child_process').execFileSync('git', ['-C', REPO, 'show', OLD_COMMIT + ':' + rel], { encoding: 'utf8' });

function pageHtml(v) {
  const s = SETS[v];
  return `<!doctype html><html><head><meta charset="utf-8"><title>mock board</title></head><body>
<div id="root"></div>
<script>window.__MOCK_LOADS=${JSON.stringify(s.loads)};window.__MOCK_CANDIDATES=${JSON.stringify(s.candidates)};window.__MOCK_WOLIST=${JSON.stringify(s.wolist)};</script>
<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/mock-app.js"></script>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  if (u.pathname === '/react.js') return send('text/javascript', rd(path.join(HERE, 'node_modules/react/umd/react.development.js')));
  if (u.pathname === '/react-dom.js') return send('text/javascript', rd(path.join(HERE, 'node_modules/react-dom/umd/react-dom.development.js')));
  if (u.pathname === '/mock-app.js') return send('text/javascript', rd(path.join(HERE, 'mock-app.js')));
  if (u.pathname.startsWith('/loadboard/')) return send('text/html', pageHtml(u.searchParams.get('variant') || 'full'));
  // EXT-D10.2: the REAL popup, served from the repo, so the phrase editor can be checked against what
  // the chat dropdown wrote. Same origin as the board → same localStorage-backed chrome.storage shim.
  if (u.pathname.startsWith('/ext/')) {
    const rel = decodeURIComponent(u.pathname.slice(5));
    const abs = path.join(REPO, rel);
    if (!abs.startsWith(REPO) || !fs.existsSync(abs)) { res.writeHead(404); return res.end(); }
    const type = /\.html$/.test(rel) ? 'text/html' : /\.css$/.test(rel) ? 'text/css' : /\.js$/.test(rel) ? 'text/javascript' : 'application/octet-stream';
    return send(type, fs.readFileSync(abs));
  }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  console.log('  (server 404: ' + u.pathname + ')');
  res.writeHead(404); res.end();
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// chrome.* for the test: storage.sync / storage.local on localStorage (shared by the board page's
// isolated world and the popup page — same origin), onChanged within a page AND across pages via the
// 'storage' event. Everything else is a harmless no-op.
const CHROME_SHIM = `
  var __chromeShim = (function () {
    var listeners = [];
    function read(area) { try { return JSON.parse(localStorage.getItem('shim:' + area) || '{}'); } catch (e) { return {}; } }
    function write(area, obj) { localStorage.setItem('shim:' + area, JSON.stringify(obj)); }
    function fire(changes, area) { listeners.slice().forEach(function (fn) { try { fn(changes, area); } catch (e) {} }); }
    function area(name) {
      return {
        get: function (keys, cb) {
          var all = read(name), out = {};
          if (keys === null || keys === undefined) out = all;
          else if (typeof keys === 'string') { if (keys in all) out[keys] = all[keys]; }
          else if (Array.isArray(keys)) keys.forEach(function (k) { if (k in all) out[k] = all[k]; });
          else Object.keys(keys).forEach(function (k) { out[k] = (k in all) ? all[k] : keys[k]; });
          var p = Promise.resolve(out); if (cb) setTimeout(function () { cb(out); }, 0); return p;
        },
        set: function (obj, cb) {
          var all = read(name), changes = {};
          Object.keys(obj).forEach(function (k) { changes[k] = { oldValue: all[k], newValue: obj[k] }; all[k] = obj[k]; });
          write(name, all);
          setTimeout(function () { fire(changes, name); if (cb) cb(); }, 0);
          return Promise.resolve();
        },
        remove: function (keys, cb) { var all = read(name); [].concat(keys).forEach(function (k) { delete all[k]; }); write(name, all); if (cb) setTimeout(cb, 0); return Promise.resolve(); },
        clear: function (cb) { write(name, {}); if (cb) setTimeout(cb, 0); return Promise.resolve(); }
      };
    }
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf('shim:') !== 0) return;
      var name = e.key.slice(5), o = JSON.parse(e.oldValue || '{}'), n = JSON.parse(e.newValue || '{}'), ch = {};
      Object.keys(Object.assign({}, o, n)).forEach(function (k) { if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) ch[k] = { oldValue: o[k], newValue: n[k] }; });
      if (Object.keys(ch).length) fire(ch, name);
    });
    var noop = function () {};
    var ev = { addListener: noop, removeListener: noop, hasListener: function () { return false; } };
    return {
      storage: { sync: area('sync'), local: area('local'), session: area('session'),
                 onChanged: { addListener: function (fn) { listeners.push(fn); }, removeListener: function (fn) { listeners = listeners.filter(function (x) { return x !== fn; }); } } },
      runtime: { lastError: undefined, id: 'test', getManifest: function () { return { version: '1.1.0', name: 'Tenlane Relay' }; },
                 getURL: function (p) { return p; }, sendMessage: function (m, cb) { if (typeof cb === 'function') setTimeout(function () { cb(undefined); }, 0); return Promise.resolve(); },
                 onMessage: ev, connect: function () { return { postMessage: noop, onMessage: ev, onDisconnect: ev, disconnect: noop }; } },
      tabs: { query: function (q, cb) { if (cb) cb([]); return Promise.resolve([]); }, sendMessage: noop, create: noop, onUpdated: ev },
      alarms: { create: noop, onAlarm: ev }
    };
  })();
  // In a page's main world a plain 'var chrome' does not replace Chrome's own window.chrome.
  try { Object.defineProperty(window, 'chrome', { value: __chromeShim, configurable: true, writable: true }); }
  catch (e) { Object.assign(window.chrome, __chromeShim); }
  var chrome = window.chrome;
`;

const STUBS = (records) => `
  var __REC = ${JSON.stringify(records)};
  function getLoadRecord(id) { return Object.prototype.hasOwnProperty.call(__REC, id) ? __REC[id] : null; }
  function isAuthGateActiveSync() { return true; }
  function readMainCardElements() {
    var out = []; document.querySelectorAll('div.load-card').forEach(function (el) {
      var idEl = el.firstElementChild; if (idEl && idEl.id) out.push({ id: idEl.id, el: el }); });
    return out;
  }
` + CHROME_SHIM;

async function openVariant(browser, variant, order, errors, srcs) {
  srcs = srcs || {};
  const keySrc    = srcs.key    || rd(REPO + '/content/aiChatKey.js');
  const bridgeSrc = srcs.bridge || rd(REPO + '/content/aiChatBridge.js');
  const aiChatSrc = srcs.aiChat || rd(REPO + '/content/aiChat.js');
  const context = srcs.context || await browser.newContext();
  // Nothing leaves the machine: every request that is not to this test server is aborted.
  await context.route('**/*', r => (/^http:\/\/127\.0\.0\.1:/.test(r.request().url()) ? r.continue() : r.abort()));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(variant + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(variant + ' console: ' + m.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  let isoCtx = null;
  cdp.on('Runtime.executionContextCreated', e => { if (e.context.name === 'tenlane') isoCtx = e.context.id; });
  const addIso = () => cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: keySrc, worldName: 'tenlane' });
  const addMain = () => page.addInitScript({ content: bridgeSrc });
  if (order === 'isolated-first') { await addIso(); await addMain(); } else { await addMain(); await addIso(); }

  await page.goto(`http://127.0.0.1:${server.address().port}/loadboard/?variant=${variant}${srcs.query || ''}`);
  await page.waitForSelector('div.load-card');
  for (let i = 0; i < 50 && !isoCtx; i++) await sleep(20);
  const iso = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: isoCtx, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('isolated eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const records = {};
  // Record payout = the card's payout + 5.40, so a phrase rendered from OUR record ("button") is
  // distinguishable from one rendered from the price the chat shows ("chat").
  SETS[variant].loads.forEach(l => {
    records[l.id] = l.dse === undefined ? { id: l.id, payout: l.pay + 5.4 } : { id: l.id, demandSupportEnabled: l.dse, payout: l.pay + 5.4 };
  });
  // Isolated-world idle scripts, in manifest order, with the few cross-file globals stubbed.
  const scripts = [rd(REPO + '/utils/designTokens.js'), rd(REPO + '/utils/constants.js'), rd(REPO + '/utils/logger.js'),
                   STUBS(records), rd(REPO + '/utils/phrases.js'), aiChatSrc];
  if (!srcs.aiChat) scripts.push(rd(REPO + '/content/aiChatPhrases.js'));   // not with the OLD files
  scripts.push(rd(REPO + '/content/inlinePanel.js'));
  for (const src of scripts) {
    await iso(src + '\n;void 0');
  }
  await iso('aiChat.paintCards(); true');
  return { context, page, iso };
}

async function cardBtn(page, id) { return page.$(`[id="${id}"] [data-testid="ext-ai-chat-card"]`); }
async function state(page) {
  return page.evaluate(() => ({
    load: window.__mockState && window.__mockState.workOpportunityForDemandSupport && window.__mockState.workOpportunityForDemandSupport.id,
    open: window.__mockState && window.__mockState.setIsChatBoxOpen,
    badge: window.__mockState && window.__mockState.setShowBadgeOnIcon,
    kept: window.__mockState && window.__mockState.untouchedField,
    chatLog: window.__mockChatLog.map(e => e.id.slice(0, 4)),
    selected: [...document.querySelectorAll('[data-mock-selected="true"]')].length,
    chatDom: (document.getElementById('mock-chat') || {}).textContent || null,
    panel: !!document.querySelector('.chat-box-position'),
    decoyLoad: window.__mockDecoyState && window.__mockDecoyState.workOpportunityForDemandSupport
      ? window.__mockDecoyState.workOpportunityForDemandSupport.id.slice(0, 4) : null,
  }));
}

async function suite(browser, order) {
  const errors = [];
  console.log(`\n=== handshake order: ${order} ===`);
  const { context, page, iso } = await openVariant(browser, 'full', order, errors);

  check(`[${order}] key exchange completed before page scripts`, await iso('aiChatKeyring.ready()'));

  // Page-side spy: records every message on window, as a hostile page or extension could.
  await page.evaluate(() => { window.__spied = []; window.addEventListener('message', e => { if (e.data && e.data.type) window.__spied.push(JSON.parse(JSON.stringify(e.data))); }); });

  const withBtn = [];
  for (const id of L) if (await cardBtn(page, id)) withBtn.push(id.slice(0, 4));
  check(`[${order}] card button only on demandSupportEnabled loads (0a1b,1c2d,3a4b,4c5d,5e6f)`,
        JSON.stringify(withBtn) === JSON.stringify(['0a1b', '1c2d', '3a4b', '4c5d', '5e6f']), withBtn);

  // Eligible order: 1st L0, 2nd L1, 3rd L3, 4th L4, 5th L5.
  const plan = [['3rd', L[3], 'amazon-candidate-list'], ['5th', L[5], 'amazon-card-props'],
                ['4th', L[4], 'amazon-wo-list'], ['1st', L[0], 'amazon-candidate-list']];
  for (const [nth, id, expectSource] of plan) {
    const b = await cardBtn(page, id);
    await b.click();
    await sleep(900);
    const st = await state(page);
    const label = await b.textContent();
    const ev = (await iso('aiChat.debugLog()')).slice(-1)[0];
    check(`[${order}] click ${nth} eligible (${id.slice(0, 4)}) → chat state holds that load, open, PANEL VISIBLE`,
          st.load === id && st.open === true && st.badge === false && st.kept === 'kept' && st.panel === true,
          { load: st.load && st.load.slice(0, 4), open: st.open, kept: st.kept, panel: st.panel });
    check(`[${order}]   the unconsumed decoy context was NOT written`, st.decoyLoad === null, st.decoyLoad);
    check(`[${order}]   diagnostics: 1 consumed / 1 provider-only, chosen 0, verified by state + panel, keys + types logged`,
          ev && ev.contexts === '1 consumed / 1 provider-only' && ev.chosen === 0 &&
          /^state yes, panel \.chat-box-position/.test(ev.verify || '') &&
          /setIsChatBoxOpen/.test(ev.keysBefore || '') && /setIsChatBoxOpen:boolean/.test(ev.types || ''),
          ev && { contexts: ev.contexts, chosen: ev.chosen, verify: ev.verify, keysBefore: ev.keysBefore, types: ev.types });
    check(`[${order}]   Amazon-side effect ran for it; card NOT selected; button says "Chat opened"`,
          st.chatLog[st.chatLog.length - 1] === id.slice(0, 4) && st.selected === 0 && label === 'Chat opened', { chatLog: st.chatLog, selected: st.selected, label });
    check(`[${order}]   logged ai-chat-open, source ${expectSource}`,
          ev && ev.result === 'opened' && ev.source === expectSource && ev.loadId === id.slice(0, 4) + '***', ev);
  }
  const before = await state(page);

  // Forgeries from the page world.
  const genuine = await page.evaluate(() => window.__spied.filter(m => m.type === 'tenlane-aichat-open-v1'));
  check(`[${order}] the page CAN see our signed requests (so secrecy of the key is what matters)`, genuine.length === 4, genuine.length);
  await page.evaluate(({ L1, g }) => {
    const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
    // 1. unsigned / zero signature
    window.postMessage({ type: 'tenlane-aichat-open-v1', requestId: hex(16), loadId: L1, ts: Date.now(), sig: '0'.repeat(64) }, '*');
    // 2. exact replay of our last genuine request
    window.postMessage(g[g.length - 1], '*');
    // 3. genuine signature, load id swapped
    window.postMessage(Object.assign({}, g[0], { loadId: L1 }), '*');
    // 4. genuine signature, fresh requestId
    window.postMessage(Object.assign({}, g[0], { requestId: hex(16), ts: Date.now() }), '*');
    // 5. LoadFetcher's own message type
    window.postMessage({ type: 'LOADFETCHER_OPEN_AI_CHAT', payload: { loadId: L1 } }, '*');
  }, { L1: L[1], g: genuine });
  await sleep(1200);
  let after = await state(page);
  check(`[${order}] 5 forged/replayed/foreign messages from the page → chat state unchanged`,
        after.load === before.load && after.chatLog.length === before.chatLog.length, { load: after.load && after.load.slice(0, 4), chatLogLen: after.chatLog.length });

  // Page tries to take over the handshake after load: hello → does the isolated side leak the key?
  const leaked = await page.evaluate(async ({ L1 }) => {
    let seen = null;
    const spy = e => { if (e.detail) seen = e.detail; };
    document.addEventListener('tenlane-aichat-key', spy);
    document.dispatchEvent(new CustomEvent('tenlane-aichat-hello'));
    await new Promise(r => setTimeout(r, 50));
    document.removeEventListener('tenlane-aichat-key', spy);
    // and plants its OWN key, then signs with it
    const mine = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    document.dispatchEvent(new CustomEvent('tenlane-aichat-key', { detail: mine }));
    const k = await crypto.subtle.importKey('raw', new Uint8Array(mine.match(/../g).map(x => parseInt(x, 16))), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const m = { type: 'tenlane-aichat-open-v1', requestId: [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''), loadId: L1, ts: Date.now() };
    const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(['open', m.requestId, m.loadId, m.ts].join('\n')));
    m.sig = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    window.postMessage(m, '*');
    return seen;
  }, { L1: L[1] });
  await sleep(1200);
  after = await state(page);
  check(`[${order}] page "hello" gets no key, and a page-planted key signs nothing we accept`,
        (leaked === null || leaked === 'removed') && after.load === before.load, { leaked, load: after.load && after.load.slice(0, 4) });

  // Panel row: the REAL buildActionBar() from inlinePanel.js, decorated as renderPanelFromData does.
  const panel = await iso(`(function () {
    var host = document.createElement('div'); host.id = 'ext-inline-panel'; document.body.appendChild(host);
    var out = {};
    [['${L[4]}', 'elig'], ['${L[2]}', 'inelig']].forEach(function (p) {
      var bar = buildActionBar(); host.appendChild(bar);
      var b = aiChat.decoratePanelBar(bar, p[0]);
      out[p[1]] = { hasButton: !!b, order: Array.prototype.map.call(bar.children, function (c) { return c.getAttribute('data-testid'); }),
                    className: b ? b.className : null };
    });
    return out;
  })()`);
  check(`[${order}] panel row: "AI Chat" after camera/map/post on an eligible load, same button class`,
        panel.elig.hasButton && panel.elig.order.join() === 'ext-action-camera,ext-action-map,ext-action-post,ext-action-ai-chat' &&
        /ext-action-btn/.test(panel.elig.className), panel.elig);
  check(`[${order}] panel row: no "AI Chat" on the non-negotiable load`, !panel.inelig.hasButton, panel.inelig.order);
  await page.click('#ext-inline-panel [data-testid="ext-action-ai-chat"]');
  await sleep(900);
  after = await state(page);
  check(`[${order}] panel button opens the chat on its load (4c5d)`, after.load === L[4] && after.open === true, after.load && after.load.slice(0, 4));

  if (order === 'isolated-first') {
    await page.setViewportSize({ width: 900, height: 520 });
    await page.screenshot({ path: path.join(OUT, 'shot-full.png') });
  }
  check(`[${order}] no page errors`, errors.length === 0, errors);
  await context.close();
}

async function noCtx(browser) {
  const errors = [];
  console.log('\n=== no chat context on the page ===');
  const { context, page, iso } = await openVariant(browser, 'noctx', 'isolated-first', errors);
  const domBefore = await page.evaluate(() => document.getElementById('root').innerHTML.replace(/<button[^>]*ext-ai-chat-card[^>]*>.*?<\/button>/g, ''));
  const b = await cardBtn(page, L[0]);
  await b.click();
  await sleep(900);
  const label = await b.textContent();
  const ev = (await iso('aiChat.debugLog()')).slice(-1)[0];
  const domAfter = await page.evaluate(() => document.getElementById('root').innerHTML.replace(/<button[^>]*ext-ai-chat-card[^>]*>.*?<\/button>/g, ''));
  check('no context → button says "Chat unavailable"', label === 'Chat unavailable', label);
  check('no context → logged result unavailable, reason no-chat-context', ev && ev.result === 'unavailable' && /^no-chat-context/.test(ev.reason), ev);
  check('no context → nothing on the page changed (DOM identical, card not selected)', domBefore === domAfter && !/load-card__selected/.test(domAfter));
  await sleep(3800);
  check('label returns to "AI Chat" afterwards', (await b.textContent()) === 'AI Chat');
  check('no page errors', errors.length === 0, errors);
  await context.close();
}

// EXT-D10.1 — the live failure, reproduced with the FIRST version's three files from git.
async function regressionOld(browser) {
  const errors = [];
  console.log(`\n=== REGRESSION: old code (${OLD_COMMIT}) against the page with a decoy context ===`);
  const srcs = { key: gitShow('content/aiChatKey.js'), bridge: gitShow('content/aiChatBridge.js'),
                 aiChat: gitShow('content/aiChat.js') };
  const { context, page, iso } = await openVariant(browser, 'full', 'isolated-first', errors, srcs);
  const b = await cardBtn(page, L[3]);
  await b.click();
  await sleep(1200);
  const st = await state(page);
  const label = await b.textContent();
  const ev = (await iso('aiChat.debugLog()')).slice(-1)[0];
  const reproduced = label === 'Chat opened' && ev && ev.result === 'opened' && st.panel === false &&
                     st.open === false && st.decoyLoad === '3a4b';
  check('OLD code reproduces the live failure: says "Chat opened" + result opened, but the chat panel ' +
        'is NOT open (it wrote the unconsumed decoy context)', reproduced,
        { label, result: ev && ev.result, source: ev && ev.source, panel: st.panel, realChatOpen: st.open, decoyLoad: st.decoyLoad });
  await context.close();
  return reproduced;
}

async function failSafes(browser) {
  console.log('\n=== EXT-D10.1 fail-safes ===');
  for (const [variant, expectReason, desc] of [
    ['provideronly', 'no-consumed-chat-context', 'only an UNCONSUMED chat context on the page'],
    ['nopanel', 'panel-not-seen', 'state applies but Amazon\'s chat panel never appears'],
  ]) {
    const errors = [];
    const { context, page, iso } = await openVariant(browser, variant, 'isolated-first', errors);
    const b = await cardBtn(page, L[3]);
    await b.click();
    await sleep(1600);
    const st = await state(page);
    const label = await b.textContent();
    const ev = (await iso('aiChat.debugLog()')).slice(-1)[0];
    const expectResult = variant === 'nopanel' ? 'set-not-applied' : 'unavailable';
    check(`${desc} → "Chat unavailable", result ${expectResult}, reason ${expectReason}`,
          label === 'Chat unavailable' && ev && ev.result === expectResult && ev.reason === expectReason,
          ev && { label, result: ev.result, reason: ev.reason, contexts: ev.contexts, verify: ev.verify });
    if (variant === 'provideronly') {
      check('  … and the unconsumed context was NOT written', st.decoyLoad === null, st.decoyLoad);
    }
    check(`  no page errors (${variant})`, errors.length === 0, errors);
    await context.close();
  }
}

// ═══ EXT-D10.2 — the phrase dropdown inside Amazon's chat ═════════════════════════════════════
const rectOf = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
}, sel);
const lastEvent = async (iso, name) => (await iso('aiChat.debugLog()')).filter(e => e.event === name).slice(-1)[0];
const storedPhrases = (page) => page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('shim:sync') || '{}');
  return s.phrasesV1 ? s.phrasesV1.items.map(i => i.text) : null;
});

async function popupPhrases(context) {
  const p = await context.newPage();
  await p.addInitScript({ content: CHROME_SHIM });
  await p.goto(`http://127.0.0.1:${server.address().port}/ext/popup/popup.html`);
  await p.waitForSelector('[data-testid="popup-phrase-text-0"]', { state: 'attached', timeout: 5000 });
  const out = await p.evaluate(() => ({
    texts: [...document.querySelectorAll('[data-testid^="popup-phrase-text-"]')].map(i => i.value),
    note: (document.getElementById('popup-phrases-note') || {}).textContent || ''
  }));
  return { page: p, texts: out.texts, note: out.note };
}

async function phraseSuite(browser) {
  const errors = [];
  console.log('\n=== EXT-D10.2 phrase dropdown inside Amazon\'s chat ===');
  const { context, page, iso } = await openVariant(browser, 'full', 'isolated-first', errors);
  const P = s => '.chat-box-position ' + s;

  // Open the chat with OUR button on the 3rd eligible load (3a4b, card $730.00, record $735.40).
  await (await cardBtn(page, L[3])).click();
  await page.waitForSelector(P('[data-testid="ext-phrases-btn"]'), { timeout: 3000 }).catch(() => null);
  const btnR = await rectOf(page, P('[data-testid="ext-phrases-btn"]'));
  check('opened by our button → "Phrases ▾" appears inside the chat', !!btnR);
  const bookBefore = await page.evaluate(() => ['rlb-book-btn', 'rlb-book-trip-confirm-booking-btn', 'rlb-book-trip-no-btn']
    .map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.left), Math.round(r.top)]; }));

  // Send button: still the row's last child, flush with the row's padding, and not covered.
  const lay = await page.evaluate(() => {
    const row = document.querySelector('.mock-input-row'), send = row.querySelector('.css-1gltk7k'),
          ours = row.querySelector('[data-testid="ext-phrases-btn"]'), ta = document.getElementById('ra-input');
    const rr = row.getBoundingClientRect(), sr = send.getBoundingClientRect(), or = ours.getBoundingClientRect(), tr = ta.getBoundingClientRect();
    return { sendIsLast: row.lastElementChild === send, sendRightGap: Math.round(rr.right - 8 - sr.right),
             overlapSend: !(or.right <= sr.left || or.left >= sr.right), leftOfInput: or.right <= tr.left + 0.5 };
  });
  check('send button not covered or shifted (last in row, flush right), our button sits left of the input',
        lay.sendIsLast && lay.sendRightGap === 0 && !lay.overlapSend && lay.leftOfInput, lay);

  // Open the dropdown: upward, inside the chat box.
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await page.waitForSelector(P('[data-testid="ext-phrases-menu"]'));
  const geo = await page.evaluate(() => {
    const root = document.querySelector('.chat-box-position').getBoundingClientRect();
    const m = document.querySelector('[data-testid="ext-phrases-menu"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="ext-phrases-btn"]').getBoundingClientRect();
    return { inside: m.left >= root.left - 0.5 && m.right <= root.right + 0.5 && m.top >= root.top - 0.5 && m.bottom <= root.bottom + 0.5,
             upward: m.bottom <= b.top + 0.5, rows: document.querySelectorAll('[data-testid^="ext-phrase-row-"]').length,
             note: document.querySelector('[data-testid="ext-phrases-note"]').textContent };
  });
  check('dropdown opens UPWARD and stays inside the chat box; 7 starter phrases listed; payout from this load',
        geo.inside && geo.upward && geo.rows === 7 && /\$735 \(this load\)/.test(geo.note), geo);

  // Insert phrase 1 "I can take it at {payout+150}." → record 735.40 + 150 = $885 (button source).
  await page.click(P('[data-testid="ext-phrase-row-1"] .ext-ph-text'));
  await sleep(700);
  let st = await page.evaluate(() => ({ react: window.__raValue, dom: document.getElementById('ra-input').value,
    focus: document.activeElement && document.activeElement.id, sent: (window.__sent || []).length,
    menu: !!document.querySelector('[data-testid="ext-phrases-menu"]') }));
  let ev = await lastEvent(iso, 'phrase-insert');
  check('phrase inserted: REACT STATE holds "I can take it at $885.", input focused, menu closed, NOTHING SENT',
        st.react === 'I can take it at $885.' && st.dom === st.react && st.focus === 'ra-input' && st.sent === 0 && !st.menu, st);
  check('  logged phrase-insert {index 1, hadVariables, payoutSource button, registered via React props}',
        ev && ev.index === 1 && ev.hadVariables === true && ev.payoutSource === 'button' && ev.registered === true && ev.controlled === true, ev);

  // Keyboard: open, ArrowDown ×3 to row 3, Enter → replaces the text.
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await page.waitForSelector(P('[data-testid="ext-phrase-row-0"]'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await sleep(700);
  st = await page.evaluate(() => ({ react: window.__raValue, sent: (window.__sent || []).length }));
  check('keyboard: ↓↓↓ + Enter inserts row 3 (REPLACES the text), still nothing sent',
        st.react === 'What is the detention policy at these stops?' && st.sent === 0, st);
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await page.waitForSelector(P('[data-testid="ext-phrase-row-0"]'));
  await page.keyboard.press('Escape');
  await sleep(200);
  st = await page.evaluate(() => ({ menu: !!document.querySelector('[data-testid="ext-phrases-menu"]'), react: window.__raValue, open: window.__mockState.setIsChatBoxOpen }));
  check('Esc closes the dropdown, text unchanged, Amazon\'s chat still open', !st.menu && st.react === 'What is the detention policy at these stops?' && st.open === true, st);

  // Edit row 0, add one, delete row 2 — all from the dropdown.
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await page.click(P('[data-testid="ext-phrase-edit-0"]'));
  await page.fill(P('[data-testid="ext-phrase-input-0"]'), 'Edited: best you can do on {payout}?');
  await page.click(P('[data-testid="ext-phrase-save-0"]'));
  await sleep(300);
  await page.click(P('[data-testid="ext-phrase-add"]'));
  await page.fill(P('[data-testid="ext-phrase-input-new"]'), 'Added from the chat');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.click(P('[data-testid="ext-phrase-del-2"]'));
  await page.click(P('[data-testid="ext-phrase-del-yes-2"]'));
  await sleep(300);
  const stored = await storedPhrases(page);
  const menuTexts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="ext-phrase-row-"] .ext-ph-text')].map(e => e.firstChild.textContent));
  check('edit + add + delete persisted to storage (phrasesV1, sync)', stored && stored.length === 7 && stored[0] === 'Edited: best you can do on {payout}?' &&
        stored[6] === 'Added from the chat' && stored.indexOf('My rate for this lane is {payout+10%} — can you meet that?') === -1, stored);
  check('  the dropdown shows the saved list (edit rendered with this load\'s payout)', menuTexts[0] === 'Edited: best you can do on $735?' && menuTexts.length === 7, menuTexts);
  const edits = (await iso('aiChat.debugLog()')).filter(e => e.event === 'phrase-edit').map(e => e.action);
  check('  logged phrase-edit ×3 (edit, add, delete)', edits.join() === 'edit,add,delete', edits);
  await page.keyboard.press('Escape');

  // The popup editor shows the same list.
  let pop = await popupPhrases(context);
  check('the POPUP editor shows exactly what the dropdown saved', JSON.stringify(pop.texts) === JSON.stringify(stored), pop.texts);
  // …and a popup edit reaches the dropdown.
  // The popup is logged out in the test, so its feature blocks are hidden: drive the real handlers
  // with the same events a person's typing produces.
  await pop.page.evaluate(() => {
    const i = document.querySelector('[data-testid="popup-phrase-text-1"]');
    i.value = 'Edited in the popup';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(400);
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await sleep(300);
  const row1 = await page.evaluate(() => document.querySelector('[data-testid="ext-phrase-row-1"] .ext-ph-text').firstChild.textContent);
  check('a popup edit appears in the chat dropdown', row1 === 'Edited in the popup', row1);
  await page.keyboard.press('Escape');
  await pop.page.close();

  // 15-limit: exactly 15 → add disabled; 17 (saved under the old limit) → all kept, add disabled, note says so.
  for (const n of [15, 17]) {
    await page.evaluate(n => {
      const s = JSON.parse(localStorage.getItem('shim:sync') || '{}');
      s.phrasesV1 = { version: 1, updatedAt: Date.now(), items: Array.from({ length: n }, (_, i) => ({ id: 'x' + i, text: 'Phrase ' + (i + 1) })) };
      localStorage.setItem('shim:sync', JSON.stringify(s));
    }, n);
    await page.click(P('[data-testid="ext-phrases-btn"]'));
    await page.waitForSelector(P('[data-testid="ext-phrase-row-0"]'));
    const lim = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-testid^="ext-phrase-row-"]').length,
      addDisabled: document.querySelector('[data-testid="ext-phrase-add"]').disabled,
      note: (document.querySelector('[data-testid="ext-phrases-limit"]') || {}).textContent || '' }));
    check(`limit: ${n} stored → ${n} rows shown (none dropped), "+ Add phrase" disabled, limit note shown`,
          lim.rows === n && lim.addDisabled && (n === 15 ? /maximum of 15/.test(lim.note) : /17 phrases.*limit is now 15.*delete 3/.test(lim.note)), lim);
    await page.keyboard.press('Escape');
  }
  pop = await popupPhrases(context);
  await pop.page.evaluate(() => document.querySelector('[data-testid="popup-phrase-add"]').click());
  const afterAdd = await pop.page.evaluate(() => document.querySelectorAll('[data-testid^="popup-phrase-text-"]').length);
  check('popup with 17: all 17 kept, "Add phrase" refused, note says "All are kept … delete 3"',
        pop.texts.length === 17 && afterAdd === 17 && /All are kept/.test(pop.note) && /delete 3/.test(pop.note), { rows: pop.texts.length, afterAdd, note: pop.note });
  await pop.page.close();

  // Booking controls: untouched throughout.
  const bookAfter = await page.evaluate(() => ['rlb-book-btn', 'rlb-book-trip-confirm-booking-btn', 'rlb-book-trip-no-btn']
    .map(id => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, Math.round(r.left), Math.round(r.top), getComputedStyle(e).display]; }));
  const bookEvents = await page.evaluate(() => window.__bookingEvents || []);
  check('booking buttons: NO event reached them, not moved, not hidden',
        bookEvents.length === 0 && JSON.stringify(bookAfter.map(b => b.slice(0, 3))) === JSON.stringify(bookBefore) && bookAfter.every(b => b[3] !== 'none'),
        { bookEvents, bookAfter });
  await page.screenshot({ path: path.join(OUT, 'shot-chat-phrases.png') });

  // Chat opened by AMAZON'S icon (no binding) → payout parsed from .wo-total_payout ($710.00).
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('shim:sync')); delete s.phrasesV1; localStorage.setItem('shim:sync', JSON.stringify(s)); });
  await page.click('.chat-box-position [aria-label="Close"]');
  await sleep(300);
  await page.click('#mock-amazon-chat-icon');
  await page.waitForSelector(P('[data-testid="ext-phrases-btn"]'), { timeout: 3000 });
  await page.click(P('[data-testid="ext-phrases-btn"]'));
  await page.click(P('[data-testid="ext-phrase-row-1"] .ext-ph-text'));
  await sleep(700);
  st = await page.evaluate(() => ({ react: window.__raValue, sent: (window.__sent || []).length }));
  ev = await lastEvent(iso, 'phrase-insert');
  check('opened by AMAZON\'S icon → payout from the chat\'s .wo-total_payout ($710 + 150 = "$860"), source chat',
        st.react === 'I can take it at $860.' && ev.payoutSource === 'chat' && st.sent === 0, { st, ev });
  check('no page errors (phrases)', errors.length === 0, errors);
  await context.close();

  // No payout anywhere → variable phrases disabled with a reason; a plain phrase still inserts.
  const errs2 = [];
  const np = await openVariant(browser, 'full', 'isolated-first', errs2, { query: '&nopay=1' });
  await np.page.click('#mock-amazon-chat-icon');
  await np.page.waitForSelector(P('[data-testid="ext-phrases-btn"]'), { timeout: 3000 });
  await np.page.click(P('[data-testid="ext-phrases-btn"]'));
  await np.page.waitForSelector(P('[data-testid="ext-phrase-row-6"]'));
  const dis = await np.page.evaluate(() => [...document.querySelectorAll('[data-testid^="ext-phrase-row-"]')].map(r => r.getAttribute('aria-disabled') === 'true'));
  await np.page.click(P('[data-testid="ext-phrase-row-1"] .ext-ph-text'));     // has {payout+150}
  await sleep(500);
  const v1 = await np.page.evaluate(() => window.__raValue);
  const failEv = await lastEvent(np.iso, 'phrase-failed');
  await np.page.click(P('[data-testid="ext-phrase-row-3"] .ext-ph-text'));     // plain
  await sleep(700);
  const v2 = await np.page.evaluate(() => window.__raValue);
  check('no payout → the 4 variable phrases disabled (with reason), plain ones enabled; clicking a disabled one inserts nothing',
        JSON.stringify(dis) === JSON.stringify([true, true, true, false, false, false, true]) && v1 === '' && failEv && failEv.reason === 'no-payout', { dis, v1, failEv });
  check('  a plain phrase still inserts', v2 === 'What is the detention policy at these stops?', v2);
  check('no page errors (no payout)', errs2.length === 0, errs2);
  await np.context.close();
}

// ═══ EXT-D10.2 — visual: card button left of the price, panel button on one line ═════════════
async function visualChecks(browser) {
  const errors = [];
  console.log('\n=== EXT-D10.2 visual measurements ===');
  const { context, page, iso } = await openVariant(browser, 'full', 'isolated-first', errors);
  const card = await page.evaluate(id => {
    const root = document.getElementById(id), b = root.querySelector('[data-testid="ext-ai-chat-card"]'), p = root.querySelector('.wo-total_payout');
    const br = b.getBoundingClientRect(), pr = p.getBoundingClientRect();
    return { gap: +(pr.left - br.right).toFixed(1), leftOfPrice: br.right <= pr.left, sameLine: Math.abs((br.top + br.bottom) / 2 - (pr.top + pr.bottom) / 2) < 6,
             priceStyleUntouched: p.getAttribute('style') === null && p.className === 'wo-total_payout' };
  }, L[3]);
  check('card: AI Chat is LEFT of the price, gap ≈ 20 px, same line, price element untouched',
        card.leftOfPrice && Math.abs(card.gap - 20) <= 1 && card.sameLine && card.priceStyleUntouched, card);

  const pan = await iso(`(function () {
    injectPanelStyle();                                   // the panel's REAL stylesheet
    var out = {};
    [['narrow', 170], ['wide', 600]].forEach(function (w) {
      var host = document.createElement('div'); host.id = 'ext-inline-panel'; host.style.width = w[1] + 'px';
      document.body.appendChild(host);
      var bar = buildActionBar(); host.appendChild(bar);
      var b = aiChat.decoratePanelBar(bar, '${L[4]}');
      var cam = bar.querySelector('[data-testid="ext-action-camera"]');
      var range = document.createRange(); range.selectNodeContents(b);
      out[w[0]] = { lines: range.getClientRects().length, h: b.getBoundingClientRect().height,
                    camH: cam.getBoundingClientRect().height, text: b.textContent,
                    boxW: Math.round(b.getBoundingClientRect().width), textFits: b.scrollWidth <= b.clientWidth };
      host.id = 'ext-inline-panel-done-' + w[0];
    });
    return out;
  })()`);
  check('panel: "AI Chat" on ONE line and the same height as the camera/map/post buttons (170 px and 600 px wide rows)',
        pan.narrow.lines === 1 && pan.wide.lines === 1 && pan.narrow.h === pan.narrow.camH && pan.wide.h === pan.wide.camH &&
        pan.narrow.textFits && pan.wide.textFits && pan.wide.boxW > 40, pan);
  await page.screenshot({ path: path.join(OUT, 'shot-visual.png') });
  check('no page errors (visual)', errors.length === 0, errors);
  await context.close();
}

async function three(browser) {
  const errors = [];
  console.log('\n=== button visibility, 3 loads ===');
  const { context, page } = await openVariant(browser, 'three', 'isolated-first', errors);
  const rows = [];
  for (const [id, flag] of [[L[0], 'true'], [L[1], 'false'], [L[2], '(field absent)']]) {
    rows.push({ load: id.slice(0, 4) + '***', demandSupportEnabled: flag, button: !!(await cardBtn(page, id)) });
  }
  console.table(rows);
  check('button shown ONLY for demandSupportEnabled === true', rows[0].button && !rows[1].button && !rows[2].button, rows);
  await page.screenshot({ path: path.join(OUT, 'shot-three.png') });
  check('no page errors', errors.length === 0, errors);
  await context.close();
  return rows;
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    if (process.env.AICHAT_SKIP_REGRESSION !== '1') await regressionOld(browser);
    await failSafes(browser);
    await visualChecks(browser);
    await phraseSuite(browser);
    await suite(browser, 'isolated-first');
    await suite(browser, 'main-first');
    await noCtx(browser);
    await three(browser);
  } catch (e) {
    check('harness ran to completion', false, e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
