// Design token injection — listed FIRST in manifest.json content_scripts so all
// --ext-* custom properties are on :root before any other extension script runs.
// Dark overrides activate when nightMode.js sets html.ext-night on the page.
// Popup page duplicates this token block at the top of popup/popup.css.
(function () {
  if (document.getElementById('ext-design-tokens')) return;
  var style = document.createElement('style');
  style.id = 'ext-design-tokens';
  style.textContent =
    ':root{' +
      /* accent — blue, interactive/system signal */
      '--ext-accent:#1a73e8;' +
      '--ext-accent-hover:#1765d0;' +
      '--ext-accent-bg:#e8f0fe;' +
      '--ext-accent-text:#155ab5;' +
      /* semantic — success / warning / danger kept separate from accent */
      '--ext-success:#157347;' +
      '--ext-success-bg:#e6f4ee;' +
      /* surface & bar */
      '--ext-bar-bg:#ffffff;' +
      '--ext-surface:#ffffff;' +
      /* neutral scale */
      '--ext-n100:#f5f7fa;' +
      '--ext-n200:#e2e6ea;' +
      '--ext-n300:#c8d0d8;' +
      '--ext-n400:#8fa1b2;' +
      '--ext-n500:#607080;' +
      '--ext-n700:#364455;' +
      '--ext-n900:#0e1c2b;' +
      /* shadows */
      '--ext-shadow-1:0 1px 3px rgba(0,0,0,.08);' +
      '--ext-shadow-2:0 2px 8px rgba(0,0,0,.14);' +
      /* motion — JS overrides this on the sidebar container via applyScanSpeed() */
      '--ext-scan-dur:2.8s;' +
      /* radii */
      '--ext-radius-pill:20px;' +
      '--ext-radius-card:8px;' +
      '--ext-radius-sm:4px;' +
    '}' +
    'html.ext-night{' +
      '--ext-accent:#4c8dff;' +
      '--ext-accent-hover:#6ba1ff;' +
      '--ext-accent-bg:#1f3350;' +
      '--ext-accent-text:#7aa9ff;' +
      '--ext-success:#37b06f;' +
      '--ext-success-bg:#0e2a1a;' +
      /* navy-slate elevation ramp — level0 (bar-bg) < level1 (n100) < level2 (surface) */
      '--ext-bar-bg:#223140;' +
      '--ext-surface:#2b3d4f;' +
      '--ext-n100:#223140;' +
      '--ext-n200:#3e5468;' +
      '--ext-n300:#4a6278;' +
      '--ext-n400:#5b7690;' +
      '--ext-n500:#9fb3c8;' +
      '--ext-n700:#c3d2df;' +
      '--ext-n900:#e8eef4;' +
      '--ext-shadow-2:0 2px 8px rgba(0,0,0,.4);' +
    '}';
  document.head.appendChild(style);
}());
