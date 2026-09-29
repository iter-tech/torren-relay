// Headless proof for EXT-D11 — the passive freshness recorder.
//
//   node scripts/freshness-suite/run.cjs
//
// Real files, real world separation:
//   content/networkObserver.js -> the page's MAIN world at document start (addInitScript)
//   utils/constants.js, utils/logger.js, utils/freshnessProbe.js -> an ISOLATED world
//   popup/popup.html + popup.js -> the real popup, same origin, same chrome.storage shim
// The page issues fetch/XHR calls the way Amazon's board does (fetch → resp.json()); the server
// answers with REAL response bodies from samples/ plus one synthetic throttle-looking answer.
// Nothing leaves 127.0.0.1.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE ||
  'C:/Users/Ігор/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core');
const CHROME_SHIM = require('../test-shims/chrome-shim.cjs');

const REPO = path.resolve(__dirname, '..', '..');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const rd = (p) => fs.readFileSync(p, 'utf8');

// ── the sample responses ──────────────────────────────────────────────────────────────────────
const har = JSON.parse(rd(path.join(REPO, 'samples', 'ai-chat-2.har'))).log.entries;
const NORMAL_SEARCH = har[4].response.content.text;   // search, 50 rows / total 160
const NORMAL_RECS   = har[5].response.content.text;   // recommendations, 20 / 20
const P_JSON        = JSON.parse(rd(path.join(REPO, 'samples', 'capture-P.json')));
const botBody = (function () {
  // Synthetic: a real body (capture-P.json) with isBotRequest flipped to true.
  const o = JSON.parse(JSON.stringify(P_JSON.workOpportunities ? P_JSON : P_JSON.response || P_JSON));
  o.isBotRequest = true;
  return JSON.stringify(o);
})();
const NORMAL_HEADERS = {
  'content-type': 'application/json;charset=UTF-8',
  'x-cache': 'Miss from cloudfront',
  'edge-cache-control': 'no-store,no-cache,stale-if-error=0,stale-while-revalidate=0',
  'via': '1.1 abcdef.cloudfront.net (CloudFront)',
  'x-amz-cf-pop': 'TEST1-P1',
  'x-amz-cf-id': 'CFIDSECRETLOOKINGVALUE0123456789',
  'x-amz-rid': 'RIDVALUE0123456789AB',
  // Must never be stored: credential-shaped names.
  'x-amzn-session-token': 'SECRET-TOKEN-VALUE',
  'set-cookie': 'session-id=SECRET-COOKIE; Path=/'
};

function expectFacts(bodyText, atMs) {
  const o = JSON.parse(bodyText);
  const wo = o.workOpportunities || [];
  const newest = Math.max(...wo.map(w => Date.parse(w.createdAtTime)).filter(x => !isNaN(x)));
  return { rows: wo.length, total: o.totalResultsSize, ageMin: (atMs - newest) / 60000 };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>board</title></head><body>
<div id="root">load board</div>
<script>
  // Records the EXISTING 503/ok reporting path, to prove it is unchanged.
  window.__searchResults = [];
  window.addEventListener('message', function (e) {
    if (e.data && e.data.__extRelaySearchResult) window.__searchResults.push({ ok: e.data.ok, status: e.data.status });
  });
  // Amazon's pattern: fetch, then resp.json() on success.
  window.__call = function (url) {
    return fetch(url, { method: 'POST', body: '{"resultSize":50}' })
      .then(function (r) { return r.ok ? r.json() : null; });
  };
  window.__xhr = function (url) {
    return new Promise(function (res) {
      var x = new XMLHttpRequest(); x.open('POST', url); x.responseType = 'json';
      x.onload = function () { res(x.response); }; x.send('{}');
    });
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (status, headers, body) => { res.writeHead(status, headers); res.end(body); };
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    if (u.pathname === '/loadboard/fresh') return send(200, { 'content-type': 'text/html' }, PAGE);
    if (u.pathname === '/api/loadboard/search') {
      const k = u.searchParams.get('k');
      if (k === 'bot') return send(200, Object.assign({}, NORMAL_HEADERS, { 'x-cache': 'Hit from cloudfront', 'age': '37' }), botBody);
      if (k === '503') return send(503, { 'content-type': 'text/plain', 'x-cache': 'Error from cloudfront' }, 'Service Unavailable');
      return send(200, NORMAL_HEADERS, NORMAL_SEARCH);
    }
    if (u.pathname === '/api/loadboard/recommendations/get') return send(200, NORMAL_HEADERS, NORMAL_RECS);
    if (u.pathname.startsWith('/ext/')) {
      const rel = decodeURIComponent(u.pathname.slice(5));
      const abs = path.join(REPO, rel);
      if (!abs.startsWith(REPO) || !fs.existsSync(abs)) return send(404, {}, '');
      const type = /\.html$/.test(rel) ? 'text/html' : /\.css$/.test(rel) ? 'text/css' : 'text/javascript';
      return send(200, { 'content-type': type }, fs.readFileSync(abs));
    }
    if (u.pathname === '/favicon.ico') return send(204, {}, '');
    send(404, {}, '');
  });
});

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', r => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    const page = await context.newPage();
    const errors = [], warnings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      // The browser's own "Failed to load resource: 503" line is the test's deliberate 503, not an error.
      if (m.type() === 'error' && !/status of 503/.test(m.text())) errors.push(m.text());
      if (/FRESHNESS WARNING/.test(m.text())) warnings.push(m.text());
    });
    await page.addInitScript({ content: rd(path.join(REPO, 'content/networkObserver.js')) });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    let iso = null;
    cdp.on('Runtime.executionContextCreated', e => { if (e.context.name === 'tenlane') iso = e.context.id; });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: '0', worldName: 'tenlane' });
    await page.goto(base + '/loadboard/fresh');
    for (let i = 0; i < 50 && !iso; i++) await sleep(20);
    const inIso = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, contextId: iso, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };
    for (const src of [rd(path.join(REPO, 'utils/constants.js')), rd(path.join(REPO, 'utils/logger.js')), CHROME_SHIM,
                       rd(path.join(REPO, 'utils/freshnessProbe.js'))]) {
      await inIso(src + '\n;void 0');
    }

    // ── the sequence: 3 normal searches, 1 recommendations (fetch), 1 recommendations (XHR),
    //    1 synthetic bot/Hit search, 1 HTTP 503 ─────────────────────────────────────────────────
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await page.evaluate(u => window.__call(u), '/api/loadboard/search?k=normal');
    await page.evaluate(u => window.__call(u), '/api/loadboard/recommendations/get');
    await page.evaluate(u => window.__xhr(u), '/api/loadboard/recommendations/get');
    await page.evaluate(u => window.__call(u), '/api/loadboard/search?k=bot');
    await page.evaluate(u => window.__call(u), '/api/loadboard/search?k=503');
    await sleep(600);
    const recs = await inIso(`new Promise(function (r) { freshnessProbe.read(r); })`);

    check('7 responses → 7 records (5 search, 2 recommendations), in order',
          recs.length === 7 && recs.filter(r => r.ep === 'search').length === 5 && recs.filter(r => r.ep === 'recommendations').length === 2,
          recs.map(r => r.ep + ':' + r.st));

    const n = recs[0], es = expectFacts(NORMAL_SEARCH, t0);
    check('normal search (sample ai-chat-2.har #4): status 200, isBotRequest null, metadata keys, rows 50 / total 160, newest-load age correct',
          n.st === 200 && n.bot === null && JSON.stringify(n.mk) === '["reasonList"]' && JSON.stringify(n.mcodes) === '["QUANTITY_LIMITS"]' &&
          n.rows === es.rows && n.total === es.total && Math.abs(n.newestAgeMin - es.ageMin) < 0.5,
          { st: n.st, bot: n.bot, mk: n.mk, mcodes: n.mcodes, rows: n.rows, total: n.total, age: n.newestAgeMin, expectedAge: +es.ageMin.toFixed(1) });
    check('normal search: headers kept (x-cache, edge-cache-control, via, x-amz-cf-pop), ids masked, NO hints',
          n.hdr['x-cache'] === 'Miss from cloudfront' && /no-store/.test(n.hdr['edge-cache-control']) && n.hdr['x-amz-cf-pop'] === 'TEST1-P1' &&
          n.hdr['x-amz-cf-id'] === 'CFID***' && n.hdr['x-amz-rid'] === 'RIDV***' && n.hints.length === 0, n.hdr);
    const all = JSON.stringify(recs);
    check('secrets never stored: no token header, no cookie, no unmasked request id', !/SECRET/.test(all) && !/session-token/.test(all) &&
          !/set-cookie/.test(all) && !/CFIDSECRETLOOKING/.test(all));
    check('refresh rate: requests in the last 1 / 5 min climb with each call (1,2,3 … 7)',
          recs.map(r => r.r1).join() === '1,2,3,4,5,6,7' && recs.every(r => r.r5 === r.r1), recs.map(r => r.r1 + '/' + r.r5));
    const er = expectFacts(NORMAL_RECS, t0);
    check('recommendations via fetch AND via XHR: rows 20 / total 20, metadata null → no keys, age correct',
          [recs[3], recs[4]].every(r => r.rows === 20 && r.total === 20 && Array.isArray(r.mk) && r.mk.length === 0 && Math.abs(r.newestAgeMin - er.ageMin) < 0.5 && r.hints.length === 0),
          [recs[3], recs[4]].map(r => ({ rows: r.rows, total: r.total, mk: r.mk, age: r.newestAgeMin })));

    const b = recs[5];
    check('SYNTHETIC: isBotRequest true + x-cache Hit + age 37 → recorded with 3 hints',
          b.bot === true && b.hdr['x-cache'] === 'Hit from cloudfront' && b.hdr.age === '37' &&
          JSON.stringify(b.hints) === JSON.stringify(['isBotRequest=true', 'x-cache=Hit from cloudfront', 'age=37']), { bot: b.bot, hints: b.hints });
    check('  … and a FRESHNESS WARNING was logged in the debug log for it (and one for the 503\'s "x-cache: Error")',
          warnings.length === 2 && /isBotRequest=true\|x-cache=Hit from cloudfront\|age=37/.test(warnings[0]) && /x-cache=Error from cloudfront/.test(warnings[1]), warnings);

    const e = recs[6];
    check('HTTP 503 → recorded at once (no body), note non-2xx, x-cache Error flagged as a hint',
          e.st === 503 && e.note === 'non-2xx' && e.rows === null && JSON.stringify(e.hints) === '["x-cache=Error from cloudfront"]', e);
    const sr = await page.evaluate(() => window.__searchResults);
    check('EXISTING 503 path unchanged: __extRelaySearchResult still reports every search (4× ok 200, 1× 503)',
          JSON.stringify(sr) === JSON.stringify([{ ok: true, status: 200 }, { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: true, status: 200 }, { ok: false, status: 503 }]), sr);

    // A second identical bot response within 10 minutes: stored, but not warned again.
    await page.evaluate(u => window.__call(u), '/api/loadboard/search?k=bot');
    await sleep(400);
    const recs2 = await inIso(`new Promise(function (r) { freshnessProbe.read(r); })`);
    check('a repeated identical signal is STORED again but not re-warned within 10 min', recs2.length === 8 && warnings.length === 2, { records: recs2.length, warnings: warnings.length });

    // ── the popup ──────────────────────────────────────────────────────────────────────────────
    const pop = await context.newPage();
    await pop.addInitScript({ content: CHROME_SHIM + '\n;window.__copied = null; navigator.clipboard.writeText = function (t) { window.__copied = t; return Promise.resolve(); };' });
    await pop.goto(base + '/ext/popup/popup.html');
    await sleep(800);
    const texts = await pop.evaluate(() => Object.fromEntries(['total', 'bot', 'hints', 'age', 'rate', '503', 'window']
      .map(k => [k, document.getElementById('popup-fresh-' + k).textContent])));
    const ages = recs2.map(r => r.newestAgeMin).filter(x => typeof x === 'number').sort((a, b) => a - b);
    const med = ages.length % 2 ? ages[(ages.length - 1) / 2] : Math.round(((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2) * 10) / 10;
    check('popup block: records 8 (search 6, recommendations 2), isBotRequest-not-null 2, hints 3, 503 = 1',
          texts.total === '8 (search 6, recommendations 2)' && texts.bot === '2' && texts.hints === '3' && texts['503'] === '1', texts);
    check('popup block: newest-load age last / median, requests per minute last / max, first → last',
          texts.age === recs2[7].newestAgeMin + ' min / ' + med + ' min' && texts.rate === '8 / 8' && / → /.test(texts.window), texts);
    await pop.evaluate(() => document.getElementById('popup-fresh-copy').click());
    await sleep(300);
    const copied = await pop.evaluate(() => window.__copied);
    const cj = copied ? JSON.parse(copied) : null;
    check('"Copy raw records" copies all 8 records + the summary as JSON', cj && cj.records.length === 8 && cj.summary.total === 8 && cj.summary.botNonNull === 2);
    await pop.evaluate(() => document.getElementById('popup-fresh-clear').click());
    await sleep(300);
    const afterClear = await pop.evaluate(() => document.getElementById('popup-fresh-total').textContent);
    const stored = await inIso(`new Promise(function (r) { freshnessProbe.read(r); })`);
    check('"Clear" empties the buffer and the block', afterClear.indexOf('0 ') === 0 && stored.length === 0, { afterClear, stored: stored.length });

    // Ring buffer: 520 records → the newest 500 kept.
    await inIso(`(function () { for (var i = 0; i < 520; i++) freshnessProbe.record({ t: 'T' + i, ep: 'search', st: 200, hints: [] }); return true; })()`);
    let ring = [];
    for (let w = 0; w < 100; w++) {        // 520 serialised read-modify-writes: wait for the last one
      await sleep(200);
      ring = await inIso(`new Promise(function (r) { freshnessProbe.read(r); })`);
      if (ring.length && ring[ring.length - 1].t === 'T519') break;
    }
    check('ring buffer keeps the last 500 (T20 … T519)', ring.length === 500 && ring[0].t === 'T20' && ring[499].t === 'T519', { len: ring.length, first: ring[0] && ring[0].t, last: ring[499] && ring[499].t });

    // A forged message from the page cannot store arbitrary fields.
    await page.evaluate(() => window.postMessage({ __extRelayFreshness: true, rec: { ep: 'search', st: 200, evil: 'x'.repeat(5000), hdr: { cookie: 'c', 'x-cache': 'Miss' } } }, '*'));
    await sleep(400);
    const last = (await inIso(`new Promise(function (r) { freshnessProbe.read(r); })`)).slice(-1)[0];
    check('a forged record is reduced to the known fields (no extra keys, no cookie header)', !('evil' in last) && !('cookie' in last.hdr) && last.hdr['x-cache'] === 'Miss', last);

    check('no page errors', errors.length === 0, errors);
  } catch (e) {
    check('harness ran to completion', false, e.stack);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
})();
