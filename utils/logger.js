// Console logger with real level gating (2026-07-30).
//
// Verbosity is controlled by DEBUG_LEVEL in utils/constants.js — see that file for the
// scale and for the "raise this while developing" note. Every method below consults it.
// Previously only debug() did, which made the knob almost meaningless: there are ~180
// logger.log calls against 5 logger.debug, so lowering DEBUG_LEVEL silenced about 3% of
// the output and the console stayed fully verbose regardless of the setting.
//
// Method → minimum DEBUG_LEVEL required to emit. Ordered by how much a reader needs it:
// an error is worth showing even at the quietest non-silent setting; a debug line is the
// first thing to drop.
const LOG_LEVEL_REQUIRED = {
  error: 1,
  warn:  2,
  log:   3,
  debug: 4
};

// Used only if utils/constants.js somehow did not load before this file (it is listed
// first in manifest.json's content_scripts and in popup.html, so this should be
// unreachable). Deliberately 1, not 0: a broken load order must still surface errors.
// The typeof guard also matters for behaviour preservation — reading an undeclared
// DEBUG_LEVEL directly would throw a ReferenceError, turning every log call in the
// codebase into a crash rather than a no-op.
const LOG_LEVEL_FALLBACK = 1;

const logger = {
  _ts() {
    return new Date().toISOString().slice(11, 23);
  },

  _level() {
    return (typeof DEBUG_LEVEL === 'number') ? DEBUG_LEVEL : LOG_LEVEL_FALLBACK;
  },

  // True when `method` is permitted at the current level.
  _enabled(method) {
    return this._level() >= LOG_LEVEL_REQUIRED[method];
  },

  log(module, msg, data) {
    if (!this._enabled('log')) return;
    const line = `[EXT][${this._ts()}][${module}] ${msg}`;
    data !== undefined ? console.log(line, data) : console.log(line);
  },

  warn(module, msg, data) {
    if (!this._enabled('warn')) return;
    const line = `[EXT][${this._ts()}][${module}] ${msg}`;
    data !== undefined ? console.warn(line, data) : console.warn(line);
  },

  error(module, msg, error) {
    if (!this._enabled('error')) return;
    const line = `[EXT][${this._ts()}][${module}] ${msg}`;
    error !== undefined ? console.error(line, error) : console.error(line);
  },

  debug(module, msg, data) {
    if (!this._enabled('debug')) return;
    const line = `[EXT][${this._ts()}][${module}] ${msg}`;
    data !== undefined ? console.debug(line, data) : console.debug(line);
  }
};
