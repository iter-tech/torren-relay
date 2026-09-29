// Headless proof for EXT-D12 (rate guard) and EXT-D13 (top bar redesign).
//
//   node scripts/bar-suite/run.cjs
//
// THREE PAGES, ONE ORIGIN, the extension's real files:
//   bg     — background.js + utils/constants.js + utils/rateGuard.js, as the service worker would run
//            them (RATE_GUARD_FORCE_BG, a test-only switch, makes rateGuard take its background
//            part in a page). Its clock is FAKE and driven by this script, so minutes of traffic
//            replay in seconds.
//   tab A, tab B — two "Relay tabs": the real sidebar.js (the bar), originCities.js (the city row),
//            rateGuard.js (content part), storage.js, tabState.js. They reach the background through
//            a BroadcastChannel stand-in for chrome.runtime.sendMessage, and chrome.storage is the
//            shared localStorage shim, so the background's broadcast reaches both tabs exactly as
//            chrome.storage.onChanged would.
// The census events the tabs forward are the ones content/networkObserver.js posts
// (`__extRelayCensus`), injected directly. Nothing leaves 127.0.0.1.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE ||
  'C:/Users/Ігор/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');
const CHROME_SHIM = require('../test-shims/chrome-shim.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = path.join(REPO, 'docs', 'bar-screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8');

// ── the message bus (chrome.runtime stand-in) ───────────────────────────────────────────────
const BUS_TAB = `
  (function () {
    var ch = new BroadcastChannel('tenlane-rt'), pend = {}, n = 0;
    var TAB = Number(new URLSearchParams(location.search).get('tab') || 1);
    ch.onmessage = function (e) { var d = e.data; if (d.kind === 'res' && pend[d.id]) { pend[d.id](d.res); delete pend[d.id]; } };
    chrome.runtime.sendMessage = function (msg, cb) {
      var id = TAB + ':' + (++n);
      return new Promise(function (r) { pend[id] = function (res) { if (cb) cb(res); r(res); }; ch.postMessage({ kind: 'req', id: id, msg: msg, tab: TAB }); });
    };
  })();`;
const BUS_BG = `
  (function () {
    var ch = new BroadcastChannel('tenlane-rt'), L = [];
    chrome.runtime.onMessage = { addListener: function (f) { L.push(f); }, removeListener: function () {} };
    chrome.tabs.onRemoved = { addListener: function () {} };
    ch.onmessage = function (e) {
      var d = e.data; if (d.kind !== 'req') return;
      var done = false, send = function (res) { if (done) return; done = true; ch.postMessage({ kind: 'res', id: d.id, res: res }); };
      var async = false;
      L.forEach(function (f) { if (f(d.msg, { tab: { id: d.tab } }, send) === true) async = true; });
      if (!async) setTimeout(function () { send(undefined); }, 0);
    };
  })();`;

function tabHtml(base, tab) {
  const s = (f) => `<script src="${base}/${f}"></script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Relay (fixture) tab ${tab}</title>
<style>body{margin:0;font-family:Arial;background:#f3f4f6} .amz-nav{height:52px;background:#232f3e;color:#fff;display:flex;align-items:center;padding:0 16px;font-weight:700}
.amz-filters{display:flex;gap:8px;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd} .amz-filters span{border:1px solid #bbb;border-radius:4px;padding:4px 8px;font-size:12px}
.load-list{padding:16px}.card{background:#fff;border:1px solid #ddd;border-radius:6px;height:60px;margin-bottom:8px}</style></head><body>
<div class="amz-nav">Amazon Relay — Load Board (test fixture)</div>
<div class="amz-filters"><span>Origin city: CHICAGO, IL</span><span>Equipment</span><span>Sort</span><span>Refresh</span></div>
<div class="load-list"><div class="card"></div><div class="card"></div><div class="card"></div></div>
${s('utils/designTokens.js')}${s('utils/constants.js')}${s('utils/logger.js')}
<script>${CHROME_SHIM}${BUS_TAB}</script>
${s('utils/storage.js')}${s('utils/tabState.js')}${s('utils/rateGuard.js')}${s('content/originCities.js')}${s('content/sidebar.js')}
<script>
  window.__heap = 0.2;
  function getHeapUsageRatio() { return { usedBytes: 1, limitBytes: 1, ratio: window.__heap }; }
  function recheckAuthGate() { return Promise.resolve({ active: true }); }
  readActiveOriginCities = function () { return ['CHICAGO, IL']; };
  buildSidebar();
  buildOriginCitiesPanel();
</script></body></html>`;
}
function bgHtml(base) {
  const s = (f) => `<script src="${base}/${f}"></script>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>bg</title></head><body>
<script>
  var RATE_GUARD_FORCE_BG = true;                         // test-only: take the background part
  var __fakeNow = Date.parse('2026-09-29T05:00:00Z');
  Date.now = function () { return __fakeNow; };
  function importScripts() {}                              // the files are loaded just below
</script>
<script>${CHROME_SHIM}${BUS_BG}</script>
${s('utils/constants.js')}${s('utils/rateGuard.js')}${s('background.js')}
</body></html>`;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
  const off = u.searchParams.get('off') === '1';
  const base = off ? '/ext-off' : '/ext';
  if (u.pathname === '/bar/tab') return send('text/html', tabHtml(base, u.searchParams.get('tab') || '1'));
  if (u.pathname === '/bar/bg') return send('text/html', bgHtml(base));
  const m = u.pathname.match(/^\/(ext|ext-off)\/(.+)$/);
  if (m) {
    const rel = decodeURIComponent(m[2]);
    const abs = path.join(REPO, rel);
    if (!abs.startsWith(REPO) || !fs.existsSync(abs)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(abs);
    // Flag-off build: the ONE flag flipped, nothing else.
    if (m[1] === 'ext-off' && rel === 'utils/constants.js') {
      body = Buffer.from(String(body).replace('const RATE_GUARD_ENABLED = true;', 'const RATE_GUARD_ENABLED = false;'));
    }
    const type = /\.html$/.test(rel) ? 'text/html' : /\.css$/.test(rel) ? 'text/css' : /\.svg$/.test(rel) ? 'image/svg+xml' : 'text/javascript';
    return send(type, body);
  }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(404); res.end();
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openSet(browser, base, off) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 320 } });
  await context.route('**/*', r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
  const logs = { bg: [], A: [], B: [] }, errors = [];
  const bg = await context.newPage();
  bg.on('console', m => logs.bg.push(m.text()));
  bg.on('pageerror', e => errors.push('bg: ' + e.message));
  await bg.goto(`${base}/bar/bg${off ? '?off=1' : ''}`);
  const tabs = {};
  for (const t of ['A', 'B']) {
    const p = await context.newPage();
    await p.setViewportSize({ width: 1920, height: 320 });
    p.on('console', m => logs[t].push(m.text()));
    p.on('pageerror', e => errors.push(t + ': ' + e.message));
    await p.goto(`${base}/bar/tab?tab=${t === 'A' ? 1 : 2}${off ? '&off=1' : ''}`);
    await p.waitForSelector('[data-testid="ext-sidebar"]');
    tabs[t] = p;
  }
  return { context, bg, tabs, logs, errors };
}

// Combined traffic: `perMin` requests per minute for `secs` fake seconds, alternating tabs A/B.
async function drive(set, perMin, secs, st) {
  let acc = 0, flip = false;
  for (let s = 0; s < secs; s++) {
    await set.bg.evaluate(() => { __fakeNow += 1000; });
    acc += perMin / 60;
    while (acc >= 1) {
      acc -= 1; flip = !flip;
      await set.tabs[flip ? 'A' : 'B'].evaluate(st => window.postMessage({ __extRelayCensus: true, ev: { ek: 'search:main', st: st, t: 0, pg: 'x' } }, '*'), st || 200);
    }
    await sleep(8);
  }
  await sleep(150);
}
const bgState = (set) => set.bg.evaluate(() => rateGuard._bg());
const barState = (p) => p.evaluate(() => {
  const w = document.querySelector('[data-testid="ext-rate-guard"]');
  return w ? { state: w.getAttribute('data-state'), label: w.querySelector('.ext-bar-rate__label').textContent,
               msg: w.querySelector('.ext-bar-rate__msg').textContent } : null;
});
const permit = (p) => p.evaluate(() => chrome.runtime.sendMessage({ type: 'REQUEST_PERMIT', sharedLimitEnabled: false }));
const geometry = (p) => p.evaluate(() => {
  const bar = document.getElementById('ext-sidebar'), row = bar.querySelector('.ext-sidebar-row1');
  const r = bar.getBoundingClientRect();
  return { rowH: row.getBoundingClientRect().height, barH: Math.round(r.height), barW: Math.round(r.width),
           left: Math.round(r.left), right: Math.round(r.right), vw: window.innerWidth,
           pad: document.body.style.getPropertyValue('padding-top') };
});

async function shot(p, name, width) {
  await p.setViewportSize({ width, height: 320 });
  await sleep(150);
  const file = path.join(SHOTS, `${name}-${width}.png`);
  await p.screenshot({ path: file, clip: { x: 0, y: 0, width, height: 150 } });
  return path.relative(REPO, file).replace(/\\/g, '/');
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const shots = [];
  try {
    // ════ PART A — flag ON, two tabs, one background ════
    console.log('=== EXT-D12 rate guard — 2 tabs, combined rate ===');
    const S = await openSet(browser, base, false);
    const A = S.tabs.A, B = S.tabs.B;
    check('rate block present in both tabs, green before any traffic',
          (await barState(A)) && (await barState(B)) && (await barState(A)).state === 'green');

    await drive(S, 60, 60);
    let g = await bgState(S), a = await barState(A), b = await barState(B);
    check('combined 60/min (30 from each tab) → green in both tabs, permit granted',
          g.state === 'green' && g.r1 === 60 && a.state === 'green' && b.state === 'green' && (await permit(A)).granted === true,
          { bg: g.r1, A: a, B: b });
    geoGreen = await geometry(A);

    // Part B screenshots in the normal state (+ health yellow / red, + every tooltip).
    for (const w of [1920, 1280]) {
      await A.evaluate(() => { window.__heap = 0.2; document.getElementById('ext-sidebar')._updateHealth(); });
      shots.push(await shot(A, 'bar-normal', w));
      await A.evaluate(() => { window.__heap = 0.55; document.getElementById('ext-sidebar')._updateHealth(); });
      shots.push(await shot(A, 'bar-health-yellow', w));
      await A.evaluate(() => { window.__heap = 0.8; document.getElementById('ext-sidebar')._updateHealth(); });
      shots.push(await shot(A, 'bar-health-red', w));
      await A.evaluate(() => { window.__heap = 0.2; document.getElementById('ext-sidebar')._updateHealth(); });
      for (const k of ['logo', 'refresh', 'memory', 'rate']) {
        const sel = k === 'memory' ? '[data-testid="ext-memory-info"]' : `[data-testid="ext-info-${k}"]`;
        await A.setViewportSize({ width: w, height: 320 });
        await A.hover(sel);
        await sleep(100);
        const file = path.join(SHOTS, `bar-tooltip-${k}-${w}.png`);
        await A.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: 200 } });
        shots.push(path.relative(REPO, file).replace(/\\/g, '/'));
        await A.mouse.move(5, 300);
      }
    }
    const levels = await A.evaluate(() => {
      const d = document.querySelector('[data-testid="ext-memory-indicator"]'), out = [];
      for (const r of [0.2, 0.39, 0.4, 0.74, 0.75, 0.9]) { window.__heap = r; document.getElementById('ext-sidebar')._updateHealth(); out.push(r + ':' + d.getAttribute('data-level')); }
      window.__heap = 0.2; document.getElementById('ext-sidebar')._updateHealth();
      return out;
    });
    check('page health: green < 40 %, yellow 40–75 %, red ≥ 75 % (same measure as before: heap used / limit)',
          levels.join() === '0.2:green,0.39:green,0.4:yellow,0.74:yellow,0.75:red,0.9:red', levels);

    await drive(S, 85, 60);
    g = await bgState(S); a = await barState(A); b = await barState(B);
    check('combined 85/min → YELLOW in both tabs with the friendly message; still granted',
          g.state === 'yellow' && a.state === 'yellow' && b.state === 'yellow' &&
          a.msg === 'Refreshing a bit fast — ease off to keep loads coming.' && b.msg === a.msg && (await permit(B)).granted === true,
          { r1: g.r1, A: a, B: b });
    for (const w of [1920, 1280]) shots.push(await shot(A, 'bar-rate-yellow', w));

    await drive(S, 100, 60);
    g = await bgState(S); a = await barState(A); b = await barState(B);
    const pA = await permit(A), pB = await permit(B);
    check('combined 100/min → RED in both tabs + auto-pause: the permit is refused in BOTH tabs',
          g.state === 'red' && g.paused === true && a.state === 'red' && b.state === 'red' &&
          a.msg === 'Short pause to keep your board available. Resuming automatically.' &&
          pA.granted === false && pA.rateGuardPaused === true && pB.granted === false && pB.rateGuardPaused === true,
          { r1: g.r1, A: a, pA, pB });
    for (const w of [1920, 1280]) shots.push(await shot(A, 'bar-rate-red', w));

    await drive(S, 60, 30);
    g = await bgState(S);
    check('still red while the combined rate is between 70 and 95 (hysteresis)', g.state === 'red' && (await permit(A)).granted === false, { r1: g.r1 });
    await drive(S, 60, 40);
    g = await bgState(S); a = await barState(A); b = await barState(B);
    check('back to 60/min → GREEN in both tabs + auto-RESUME: permits granted again',
          g.state === 'green' && g.paused === false && a.state === 'green' && b.state === 'green' &&
          (await permit(A)).granted === true && (await permit(B)).granted === true, { r1: g.r1, A: a });

    const geoAll = await geometry(A);
    check('no layout shift: bar and body padding identical in green and after red (row 40 px, padding unchanged)',
          geoAll.rowH === 40 && geoGreen.rowH === 40 && geoAll.pad === geoGreen.pad && geoAll.barH === geoGreen.barH, { geoGreen, geoAll });

    // 503 streak of 3 minutes → a block.
    await drive(S, 60, 180, 503);
    await drive(S, 60, 1, 200);
    g = await bgState(S);
    check('a 3-minute 503 streak → block recorded: start, end, 3.0 min, r1/r5 at start',
          g.lastBlock && g.lastBlock.durationMin >= 2.9 && g.lastBlock.durationMin <= 3.1 && typeof g.lastBlock.r1AtStart === 'number' &&
          typeof g.lastBlock.r5AtStart === 'number' && g.lastBlock.responses503 >= 170, g.lastBlock);

    const allLogs = S.logs.A.join('\n');
    check('events logged in the tab debug log: state change, auto-pause, auto-resume, block start, block end',
          /rate-guard state green → yellow/.test(allLogs) && /yellow → red/.test(allLogs) && /auto-pause/.test(allLogs) &&
          /auto-resume/.test(allLogs) && /block start/.test(allLogs) && /block end/.test(allLogs));
    check('…and in the background log', /\[rateGuard\] auto-pause/.test(S.logs.bg.join('\n')) && /\[rateGuard\] block-end/.test(S.logs.bg.join('\n')));

    // Popup: "last block".
    const pop = await S.context.newPage();
    await pop.addInitScript({ content: CHROME_SHIM });
    await pop.goto(`${base}/ext/popup/popup.html`);
    await sleep(700);
    const lb = await pop.evaluate(() => { const e = document.querySelector('[data-testid="popup-rate-lastblock"]'); return e ? e.textContent : null; });
    check('popup Freshness block: "rate guard · last block 3 min …"', lb && /^3 min · r1 \d+ at start/.test(lb), lb);
    await pop.close();

    // Narrow widths: the bar never runs off the screen.
    const narrow = [];
    for (const w of [1280, 1024, 900]) { await A.setViewportSize({ width: w, height: 320 }); await sleep(100); narrow.push(await geometry(A)); }
    check('narrow widths (1280 / 1024 / 900): the bar stays inside the viewport, one 40 px row',
          narrow.every(n => n.left >= 0 && n.right <= n.vw && n.rowH === 40), narrow.map(n => ({ vw: n.vw, w: n.barW, rowH: n.rowH })));
    check('no page errors (flag on)', S.errors.length === 0, S.errors);
    await S.context.close();

    // ════ PART A — flag OFF: no trace ════
    console.log('\n=== EXT-D12 flag OFF ===');
    const O = await openSet(browser, base, true);
    await drive(O, 100, 60);
    const offDom = await O.tabs.A.evaluate(() => ({
      guard: !!document.querySelector('[data-testid^="ext-rate-guard"]'), block: !!document.querySelector('[data-testid="ext-bar-block-rate"]'),
      info: !!document.querySelector('[data-testid="ext-info-rate"]')
    }));
    const offPermit = await permit(O.tabs.A);
    check('flag false → no rate block, no "i", no element of the guard in the DOM', !offDom.guard && !offDom.block && !offDom.info, offDom);
    check('flag false → 100/min does NOT pause: permit granted', offPermit.granted === true, offPermit);
    const offLogs = [].concat(O.logs.A, O.logs.B, O.logs.bg).join('\n');
    check('flag false → no rate-guard line in any log (tabs or background)', !/rateGuard|rate-guard/.test(offLogs));
    const pop2 = await O.context.newPage();
    await pop2.addInitScript({ content: CHROME_SHIM });
    await pop2.goto(`${base}/ext-off/popup/popup.html`);
    await sleep(600);
    check('flag false → no "last block" line in the popup', !(await pop2.evaluate(() => !!document.querySelector('[data-testid="popup-rate-guard-line"]'))));
    // The rest of the bar is intact without it.
    const offBar = await O.tabs.A.evaluate(() => ['ext-bar-block-logo', 'ext-bar-block-refresh', 'ext-bar-block-health']
      .map(t => !!document.querySelector(`[data-testid="${t}"]`)).concat(!!document.querySelector('#ext-origin-cities')));
    check('flag false → the bar still has logo, auto-refresh, health blocks and the city row', offBar.every(Boolean), offBar);
    check('no page errors (flag off)', O.errors.length === 0, O.errors);
    await O.context.close();

    // ════ PART B — every function of the bar still works ════
    console.log('\n=== EXT-D13 bar functions ===');
    const F = await openSet(browser, base, false);
    const T = F.tabs.A;
    const fn = await T.evaluate(async () => {
      const out = {};
      const pp = document.querySelector('[data-testid="ext-playpause"]');
      out.before = tabState.get('running');
      pp.click(); await new Promise(r => setTimeout(r, 50));
      out.afterClick = tabState.get('running');
      const sl = document.querySelector('[data-testid="ext-slider-speed"]');
      sl.value = '3.5'; sl.dispatchEvent(new Event('input', { bubbles: true }));
      out.label = document.querySelector('[data-testid="ext-slider-value"]').textContent;
      out.stored = await new Promise(r => chrome.storage.local.get(STORAGE_KEYS.REFRESH_INTERVAL_MS, d => r(d[STORAGE_KEYS.REFRESH_INTERVAL_MS])));
      out.title = document.querySelector('[data-testid="ext-sidebar-title"]').getAttribute('aria-label');
      out.logo = !!document.querySelector('[data-testid="ext-sidebar-title"] svg') &&
                 document.querySelector('.ext-bar-wordmark').textContent;
      out.cities = [...document.querySelectorAll('#ext-origin-cities [data-testid="ext-origin-cities-all"], #ext-origin-cities [data-testid="ext-origin-city-label"]')].map(e => e.textContent);
      out.infos = [...document.querySelectorAll('#ext-sidebar .ext-bar-info')].map(e => e.getAttribute('data-testid'));
      out.reload = !!document.querySelector('[data-testid="ext-page-reload"]');
      return out;
    });
    check('play/pause toggles running', fn.before === false && fn.afterClick === true, fn);
    check('slider sets the global interval (3.5 s stored) and the label is schematic "⟳ 3.5s"', fn.label === '⟳ 3.5s' && fn.stored === 3500, fn);
    check('logo block: SVG mark + "Tenlane" wordmark, aria-label keeps the product name', fn.logo === 'Tenlane' && fn.title === 'Tenlane Relay', fn);
    check('city row still renders (All, CHICAGO, IL)', JSON.stringify(fn.cities) === '["All","CHICAGO, IL"]', fn.cities);
    check('every block has its "i" (logo, refresh, health, rate) and the health block a reload button',
          ['ext-info-logo', 'ext-info-refresh', 'ext-memory-info', 'ext-info-rate'].every(k => fn.infos.includes(k)) && fn.reload, fn.infos);
    // Reload: our own button calls location.reload — observed via the navigation it triggers.
    const nav = T.waitForNavigation({ timeout: 3000 }).then(() => true).catch(() => false);
    await T.click('[data-testid="ext-page-reload"]');
    check('reload button reloads the page', await nav);
    check('no page errors (functions)', F.errors.length === 0, F.errors);
    await F.context.close();
  } catch (e) {
    check('harness ran to completion', false, e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\nSCREENSHOTS:\n  ' + shots.join('\n  '));
  const failed = results.filter(r => !r.pass);
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
var geoGreen = null;
