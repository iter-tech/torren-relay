// content/filterTags.js
// Hides individual tag badge elements for Promoted / Starting soon / Trailer ready / Booked before.
// The load CARD stays fully visible and clickable; only the tag label element is hidden.
// Tag ids are DUPLICATED across cards (invalid HTML but real) — always use
// querySelectorAll('[id="..."]'), never getElementById.
// Uses display:none (not visibility:hidden) so the hidden tag collapses its space.
// After hiding individual tags, each .wo-tag wrapper is also collapsed if ALL its
// known tag children are hidden, to remove the reserved gap entirely.
// NO clicks, NO booking, NO Layout B.

var tagState = {
  promoted:     false,
  startingSoon: false,
  trailerReady: false,
  pastBook:     false
};
var tagObserver = null;

// After individual tags are set, collapse .wo-tag wrappers whose known children are all hidden.
// A wrapper is left visible if at least one known tag child is visible (display !== 'none').
// Wrappers with no known tag children are never touched.
function recomputeWrappers() {
  var wrappers = document.querySelectorAll('.wo-tag');
  for (var i = 0; i < wrappers.length; i++) {
    var wrapper = wrappers[i];
    var tagEls  = wrapper.querySelectorAll(
      '[id="PROMOTED"],[id="STARTING_SOON"],[id="TRAILER_READY"],[id="PAST_BOOK"]'
    );
    if (tagEls.length === 0) continue;
    var allHidden = true;
    for (var j = 0; j < tagEls.length; j++) {
      if (tagEls[j].style.display !== 'none') {
        allHidden = false;
        break;
      }
    }
    wrapper.style.display = allHidden ? 'none' : '';
  }
}

// Set display on every matching tag element, then recompute wrappers.
function recomputeTagHiding() {
  logger.log('filterTags', 'recomputeTagHiding', {
    promoted:     tagState.promoted,
    startingSoon: tagState.startingSoon,
    trailerReady: tagState.trailerReady,
    pastBook:     tagState.pastBook
  });
  try {
    var tags, i;

    tags = document.querySelectorAll('[id="PROMOTED"]');
    for (i = 0; i < tags.length; i++) {
      tags[i].style.display = tagState.promoted ? 'none' : '';
    }

    tags = document.querySelectorAll('[id="STARTING_SOON"]');
    for (i = 0; i < tags.length; i++) {
      tags[i].style.display = tagState.startingSoon ? 'none' : '';
    }

    tags = document.querySelectorAll('[id="TRAILER_READY"]');
    for (i = 0; i < tags.length; i++) {
      tags[i].style.display = tagState.trailerReady ? 'none' : '';
    }

    tags = document.querySelectorAll('[id="PAST_BOOK"]');
    for (i = 0; i < tags.length; i++) {
      tags[i].style.display = tagState.pastBook ? 'none' : '';
    }

    recomputeWrappers();
  } catch (e) {
    logger.error('filterTags', 'recomputeTagHiding failed', { error: e });
  }
}

function enableTagObserver() {
  if (tagObserver) return;
  tagObserver = new MutationObserver(function () {
    recomputeTagHiding();
  });
  tagObserver.observe(document.body, { childList: true, subtree: true });
  logger.log('filterTags', 'observer connected');
}

function disableTagObserver() {
  if (!tagObserver) return;
  tagObserver.disconnect();
  tagObserver = null;
  logger.log('filterTags', 'observer disconnected');
}

// Full recompute + observer lifecycle. Call after any state change.
function applyTagHiding() {
  logger.log('filterTags', 'applyTagHiding', {
    promoted:     tagState.promoted,
    startingSoon: tagState.startingSoon,
    trailerReady: tagState.trailerReady,
    pastBook:     tagState.pastBook
  });
  recomputeTagHiding();
  var anyOn = tagState.promoted || tagState.startingSoon || tagState.trailerReady || tagState.pastBook;
  if (anyOn) {
    enableTagObserver();
  } else {
    disableTagObserver();
  }
}

// See utils/authGate.js — features require an active session. Guards the live
// onChanged listener below too, not just the startup apply. Set by
// activate/deactivateFilterTags (idempotent), called both at startup and on live
// login/logout (onAuthGateChange, TASK 1 2026-07-20).
var _filterTagsAuthed = false;

function activateFilterTags() {
  if (_filterTagsAuthed) return;
  _filterTagsAuthed = true;
  Promise.all([
    storage.get(STORAGE_KEYS.HIDE_PROMOTED,      false),
    storage.get(STORAGE_KEYS.HIDE_STARTING_SOON, false),
    storage.get(STORAGE_KEYS.HIDE_TRAILER_READY, false),
    storage.get(STORAGE_KEYS.HIDE_PAST_BOOK,     false),
  ]).then(function (vals) {
    tagState.promoted     = vals[0] === true;
    tagState.startingSoon = vals[1] === true;
    tagState.trailerReady = vals[2] === true;
    tagState.pastBook     = vals[3] === true;
    applyTagHiding();
    logger.log('filterTags', 'activated', tagState);
  }).catch(function (e) {
    logger.error('filterTags', 'activateFilterTags failed', { error: e });
  });
}

// Reverts to fully untouched — un-hides every tag/wrapper (all tagState flags false, same
// codepath a dispatcher toggling all four filters off would hit) and disconnects the
// MutationObserver.
function deactivateFilterTags() {
  if (!_filterTagsAuthed) return;
  _filterTagsAuthed = false;
  tagState.promoted = tagState.startingSoon = tagState.trailerReady = tagState.pastBook = false;
  recomputeTagHiding();
  disableTagObserver();
  logger.log('filterTags', 'deactivated — session ended, reverted to untouched page');
}

(async function initFilterTags() {
  try {
    var gate = await getAuthGate();
    if (gate.active) activateFilterTags();
  } catch (e) {
    logger.error('filterTags', 'initFilterTags failed', { error: e });
  }
})();

if (typeof onAuthGateChange === 'function') {
  onAuthGateChange(function (gate) {
    if (gate.active) activateFilterTags(); else deactivateFilterTags();
  });
}

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (!_filterTagsAuthed) return;
  var changed = false;
  if (changes[STORAGE_KEYS.HIDE_PROMOTED] !== undefined) {
    tagState.promoted     = changes[STORAGE_KEYS.HIDE_PROMOTED].newValue === true;
    changed = true;
  }
  if (changes[STORAGE_KEYS.HIDE_STARTING_SOON] !== undefined) {
    tagState.startingSoon = changes[STORAGE_KEYS.HIDE_STARTING_SOON].newValue === true;
    changed = true;
  }
  if (changes[STORAGE_KEYS.HIDE_TRAILER_READY] !== undefined) {
    tagState.trailerReady = changes[STORAGE_KEYS.HIDE_TRAILER_READY].newValue === true;
    changed = true;
  }
  if (changes[STORAGE_KEYS.HIDE_PAST_BOOK] !== undefined) {
    tagState.pastBook     = changes[STORAGE_KEYS.HIDE_PAST_BOOK].newValue === true;
    changed = true;
  }
  if (changed) applyTagHiding();
});

window.__EXT_DEBUG = window.__EXT_DEBUG || {};
window.__EXT_DEBUG.recomputeTagHiding = recomputeTagHiding;
