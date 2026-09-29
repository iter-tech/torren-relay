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

const STUBS = (records) => `
  var __REC = ${JSON.stringify(records)};
  function getLoadRecord(id) { return Object.prototype.hasOwnProperty.call(__REC, id) ? __REC[id] : null; }
  function isAuthGateActiveSync() { return true; }
  function readMainCardElements() {
    var out = []; document.querySelectorAll('div.load-card').forEach(function (el) {
      var idEl = el.firstElementChild; if (idEl && idEl.id) out.push({ id: idEl.id, el: el }); });
    return out;
  }
  var chrome = { storage: { local: { get: function (k, cb) { cb && cb({}); } }, onChanged: { addListener: function () {}, removeListener: function () {} } } };
`;

async function openVariant(browser, variant, order, errors) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(variant + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(variant + ' console: ' + m.text()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  let isoCtx = null;
  cdp.on('Runtime.executionContextCreated', e => { if (e.context.name === 'tenlane') isoCtx = e.context.id; });
  const addIso = () => cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: rd(REPO + '/content/aiChatKey.js'), worldName: 'tenlane' });
  const addMain = () => page.addInitScript({ content: rd(REPO + '/content/aiChatBridge.js') });
  if (order === 'isolated-first') { await addIso(); await addMain(); } else { await addMain(); await addIso(); }

  await page.goto(`http://127.0.0.1:${server.address().port}/loadboard/?variant=${variant}`);
  await page.waitForSelector('div.load-card');
  for (let i = 0; i < 50 && !isoCtx; i++) await sleep(20);
  const iso = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: isoCtx, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('isolated eval: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const records = {};
  SETS[variant].loads.forEach(l => { records[l.id] = l.dse === undefined ? { id: l.id } : { id: l.id, demandSupportEnabled: l.dse }; });
  // Isolated-world idle scripts, in manifest order, with the few cross-file globals stubbed.
  for (const src of [rd(REPO + '/utils/designTokens.js'), rd(REPO + '/utils/constants.js'), rd(REPO + '/utils/logger.js'),
                     STUBS(records), rd(REPO + '/content/aiChat.js'), rd(REPO + '/content/inlinePanel.js')]) {
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
    check(`[${order}] click ${nth} eligible (${id.slice(0, 4)}) → chat state holds that load, open`,
          st.load === id && st.open === true && st.badge === false && st.kept === 'kept', { load: st.load && st.load.slice(0, 4), open: st.open, kept: st.kept });
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
