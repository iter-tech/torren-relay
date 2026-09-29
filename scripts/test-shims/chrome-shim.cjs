// A chrome.* stand-in for the headless suites (scripts/aichat-suite, scripts/freshness-suite).
// storage.sync / storage.local live on localStorage, so pages of the same origin — the board page's
// isolated world and the real popup — share one store, as in the extension. onChanged fires within
// a page and, via the 'storage' event, across pages. Everything else is a harmless no-op.
// Injected as source text (addInitScript / CDP), never required by extension code.
module.exports = `
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
