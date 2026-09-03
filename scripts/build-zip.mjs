#!/usr/bin/env node
// build-zip.mjs — produce the Chrome Web Store submission archive.
//
//   node scripts/build-zip.mjs
//
// 🔑 THE FILE LIST IS DERIVED, NEVER HAND-MAINTAINED. It is read out of manifest.json and out of
// every HTML page the manifest points at. A hand-kept list is exactly what let
// utils/supabaseConfig.js and icons/ go missing twice in this project — the manifest named them,
// nobody noticed they were absent, and the failure only shows up as a broken extension.
//
// The script refuses to produce an archive unless every path the manifest references exists BOTH
// on disk and inside the finished zip. It verifies the archive by reading it back, independently
// of the tool that wrote it.
//
// No dependencies: Node built-ins plus the .NET zip writer already on the machine.

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST  = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');

let failures = [];
const fail = (msg) => { failures.push(msg); console.log('  FAIL  ' + msg); };
const ok   = (msg) => console.log('  ok    ' + msg);
const head = (msg) => console.log('\n' + msg);

// ── directories and names that must NEVER reach the archive ────────────────────────────────
// Kept as an assertion, not as the mechanism: because only referenced files are copied, a stray
// folder cannot leak in by construction. This catches the case where that changes.
const FORBIDDEN_DIRS = [
  'samples', 'docs', 'dist', 'scripts', 'node_modules', '.git', '.github',
  'temporary design files',
  'тимчасові файли', // Cyrillic name, matched literally — this file is UTF-8
];
const forbiddenEntry = (rel) => {
  const first = rel.split('/')[0];
  if (FORBIDDEN_DIRS.includes(first)) return 'inside ' + first + '/';
  if (/-suite\.mjs$/.test(rel)) return 'a test suite';
  if (rel === '.gitignore') return '.gitignore';
  if (/^[^/]+\.md$/i.test(rel)) return 'a root-level .md';
  return null;
};

// ═══════════════════════════════════════════ 1. derive the file set ═══════════════════════
head('1. Deriving the file set from manifest.json');

const manifestPath = path.join(ROOT, 'manifest.json');
if (!fs.existsSync(manifestPath)) { console.error('FATAL: manifest.json not found'); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// rel path -> why it is in the archive (for the report)
const need = new Map();
const add = (rel, why) => {
  if (!rel) return;
  const clean = String(rel).replace(/^\.\//, '').replace(/\\/g, '/');
  if (!need.has(clean)) need.set(clean, why);
};

add('manifest.json', 'the manifest itself');
for (const cs of manifest.content_scripts || []) {
  (cs.js  || []).forEach(f => add(f, 'content_scripts.js'));
  (cs.css || []).forEach(f => add(f, 'content_scripts.css'));
}
if (manifest.background && manifest.background.service_worker) {
  add(manifest.background.service_worker, 'background.service_worker');
}
if (manifest.action && manifest.action.default_popup) {
  add(manifest.action.default_popup, 'action.default_popup');
}
for (const [size, p] of Object.entries(manifest.icons || {})) add(p, 'icons.' + size);
for (const [size, p] of Object.entries((manifest.action || {}).default_icon || {})) {
  add(p, 'action.default_icon.' + size);
}
for (const war of manifest.web_accessible_resources || []) {
  (war.resources || []).forEach(f => add(f, 'web_accessible_resources'));
}
ok('manifest references ' + need.size + ' path(s)');

// ── follow every HTML page: it pulls in scripts and styles the manifest never names ────────
// popup.html is the case that matters — popup.js, popup.css and utils/supabaseConfig.js are
// reachable ONLY through it, and supabaseConfig.js is the file whose absence breaks login.
head('2. Following HTML pages for their own references');
for (const rel of [...need.keys()]) {
  if (!/\.html$/i.test(rel)) continue;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;
  const html = fs.readFileSync(abs, 'utf8');
  const dir  = path.posix.dirname(rel);
  let found = 0;
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/gi)) {
    const ref = m[1];
    if (/^(https?:|data:|mailto:|#)/i.test(ref)) continue;   // external/inline — not packaged
    const resolved = path.posix.normalize(path.posix.join(dir, ref));
    add(resolved, 'referenced by ' + rel);
    found++;
  }
  ok(rel + ' -> ' + found + ' local reference(s)');
}
ok('total files to package: ' + need.size);

// ═══════════════════════════════════════════ 3. exist on disk? ════════════════════════════
head('3. Every referenced path must exist ON DISK');
for (const [rel, why] of need) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail('MISSING ON DISK: ' + rel + '   (' + why + ')');
}
if (!failures.length) ok('all ' + need.size + ' referenced files exist');

// ═══════════════════════════════════════════ 4. stage ═════════════════════════════════════
head('4. Staging');
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
if (!failures.length) {
  for (const rel of need.keys()) {
    const dest = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  ok('copied ' + need.size + ' file(s) into dist/stage');
}

// ═══════════════════════════════════════════ 5. required + forbidden ══════════════════════
head('5. Required files present, forbidden files absent');
const REQUIRED = [
  'manifest.json', 'background.js',
  'icons/icon16.png', 'icons/icon32.png', 'icons/icon48.png', 'icons/icon128.png',
  'utils/supabaseConfig.js', 'popup/popup.html', 'vendor/html2canvas.min.js',
];
for (const r of REQUIRED) {
  if (fs.existsSync(path.join(STAGE, r))) ok('required: ' + r);
  else fail('REQUIRED FILE MISSING FROM ARCHIVE: ' + r);
}
for (const rel of need.keys()) {
  const why = forbiddenEntry(rel);
  if (why) fail('EXCLUDED FILE LEAKED IN: ' + rel + '   (' + why + ')');
}
if (!failures.length) ok('no excluded path present');

// ═══════════════════════════════════════════ 6. write the zip ═════════════════════════════
head('6. Writing the archive');
const version = manifest.version;
const zipPath = path.join(DIST, 'torren-relay-' + version + '.zip');
if (failures.length) {
  console.log('\nREFUSING TO BUILD — ' + failures.length + ' failure(s) above.');
  process.exit(1);
}
fs.rmSync(zipPath, { force: true });

// ⚠ WRITTEN BY HAND, AND THAT IS DELIBERATE.
//
// The first version shelled out to .NET's [ZipFile]::CreateFromDirectory. On Windows PowerShell
// 5.1 / .NET Framework that writes entry names with BACKSLASHES — "utils\\constants.js" — and
// Chrome cannot read such an archive. The read-back check in step 7 caught it, which is precisely
// why that check reads the finished file instead of trusting the writer.
//
// PowerShell's Compress-Archive has the same class of defect on some builds. So the archive is
// written here with zlib and no external tool: entry names are joined with "/" by construction,
// the output is identical on any platform, and there is no .NET version to be surprised by.
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
// One fixed timestamp for every entry, so the same inputs always produce the same bytes.
const DOS_TIME = 0x6000;              // 12:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 2;   // 2026-09-02

function writeZip(destFile, stageDir, relNames) {
  const locals = [], central = [];
  let offset = 0;
  for (const rel of relNames) {
    const nameBuf = Buffer.from(rel, 'utf8');          // already forward-slashed
    const raw     = fs.readFileSync(path.join(stageDir, rel));
    const comp    = zlib.deflateRawSync(raw, { level: 9 });
    const crc     = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // flag bit 11: names are UTF-8
    lh.writeUInt16LE(8, 8);             // deflate
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);            // version made by
    cd.writeUInt16LE(20, 6);            // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_TIME, 12);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);            // extra
    cd.writeUInt16LE(0, 32);            // comment
    cd.writeUInt16LE(0, 34);            // disk
    cd.writeUInt16LE(0, 36);            // internal attrs
    cd.writeUInt32LE(0, 38);            // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdBuf   = Buffer.concat(central);
  const eocd    = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relNames.length, 8);
  eocd.writeUInt16LE(relNames.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeFileSync(destFile, Buffer.concat([...locals, cdBuf, eocd]));
}

writeZip(zipPath, STAGE, [...need.keys()]);
ok('wrote ' + path.relative(ROOT, zipPath) + ' (zlib, forward slashes by construction)');

// ═══════════════════════════════════════════ 7. verify the ARCHIVE ════════════════════════
// Read the zip back with our own central-directory parser — independent of the writer, so a
// writer bug cannot vouch for itself.
head('7. Verifying the finished archive by reading it back');
function zipEntries(file) {
  const b = fs.readFileSync(file);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('no End Of Central Directory record — not a zip');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory header');
    const nameLen  = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commLen  = b.readUInt16LE(off + 32);
    const size     = b.readUInt32LE(off + 24);
    out.push({ name: b.slice(off + 46, off + 46 + nameLen).toString('utf8'), size });
    off += 46 + nameLen + extraLen + commLen;
  }
  return out;
}
const entries = zipEntries(zipPath).filter(e => !e.name.endsWith('/'));
const names = entries.map(e => e.name);

if (names.includes('manifest.json')) ok('** manifest.json is at the ARCHIVE ROOT — no wrapper folder **');
else fail('manifest.json is NOT at the archive root — the Web Store will reject this');

if (!names.some(n => n.includes('\\'))) ok('entry names use forward slashes');
else fail('archive contains backslash separators — Chrome cannot read it');

for (const [rel, why] of need) {
  if (names.includes(rel)) continue;
  fail('MANIFEST-REFERENCED FILE MISSING FROM THE ZIP: ' + rel + '   (' + why + ')');
}
if (!failures.length) ok('all ' + need.size + ' referenced files are inside the archive');

for (const n of names) {
  const why = forbiddenEntry(n);
  if (why) fail('EXCLUDED FILE IS INSIDE THE ZIP: ' + n + '   (' + why + ')');
}

// ═══════════════════════════════════════════ 8. report ════════════════════════════════════
head('8. Archive contents');
const zipSize = fs.statSync(zipPath).size;
names.sort().forEach(n => {
  const e = entries.find(x => x.name === n);
  console.log('  ' + String(Math.ceil(e.size / 1024)).padStart(5) + ' KB  ' + n);
});
console.log('\n  files: ' + names.length +
            '   archive: ' + (zipSize / 1024).toFixed(1) + ' KB' +
            '   uncompressed: ' + (entries.reduce((a, e) => a + e.size, 0) / 1024).toFixed(1) + ' KB');

head(failures.length ? 'RESULT: ' + failures.length + ' FAILURE(S)' : 'RESULT: all assertions passed');
if (failures.length) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('  ' + path.relative(ROOT, zipPath) + ' is ready to upload.');
