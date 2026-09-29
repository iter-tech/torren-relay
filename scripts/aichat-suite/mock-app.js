// Mock of Amazon's board + Relay Assistant state, shaped as documented in
// docs/AI_CHAT_CAPTURE.md §10.4: a React context value carrying chatBotState / setChatBotState,
// chatBotCandidateList and workOpportunityList. Page (MAIN) world, plain React 18, no JSX.
//
// EXT-D10.1 — REPRODUCES THE LIVE FAILURE. Besides the context the chat panel really reads, the page
// has a SECOND chat-shaped Provider that no component consumes (the "decoy", outermost, non-empty
// candidate list). Writing to it changes a state nobody renders: the first bridge picked it, re-read
// it, and reported "opened" while the panel stayed shut — exactly what Ihor saw live.
//
// Amazon's real setter: a plain useState setter would ignore the same object passed back, yet the
// working path (mutate in place + same object) opens the chat live. So the mock's setter re-renders
// on any call, by committing a shallow copy.
//
// Variants: full (decoy + real), noctx (no chat context at all), provideronly (decoy only),
// nopanel (real context consumed, but no chat panel is ever rendered).
(function () {
  var h = React.createElement;
  var params = new URLSearchParams(location.search);
  var variant = params.get('variant') || 'full';
  var LOADS = window.__MOCK_LOADS;
  var ChatCtx  = React.createContext(null);
  var DecoyCtx = React.createContext(null);

  window.__mockChatLog = [];
  window.__mockRenders = 0;

  function wo(l) {
    return { id: l.id, version: 7, majorVersion: 2, workOpportunityOptionId: '1',
             demandSupportEnabled: l.dse, payout: { value: l.pay, unit: 'USD' },
             loads: [{ stops: [] }] };
  }
  var WOS = LOADS.map(wo);
  var byId = {}; WOS.forEach(function (w) { byId[w.id] = w; });

  function initialState() {
    return { workOpportunityForDemandSupport: null, setIsChatBoxOpen: false,
             setShowBadgeOnIcon: true, untouchedField: 'kept' };
  }

  function Card(props) {
    var w = props.wo;
    var sel = React.useState(false);
    return h('div', { className: sel[0] ? 'load-card load-card__selected' : 'load-card',
                      'data-mock-selected': String(sel[0]),
                      onClick: function () { sel[1](true); } },
      h('div', { id: w.id },
        h('span', { className: 'mock-route' }, w.id.slice(0, 4)),
        h('span', { className: 'wo-total_payout' }, '$' + w.payout.value.toFixed(2))));
  }

  function Chat(props) {
    var ctx = React.useContext(ChatCtx);
    var st = ctx.chatBotState;
    window.__mockState = st;
    window.__mockRenders++;
    var open = !!(st.setIsChatBoxOpen && st.workOpportunityForDemandSupport);
    React.useEffect(function () {
      // Stands in for Amazon's chunk-446 effect (getSessionHistory → sendMessage auto_start).
      if (open) window.__mockChatLog.push({ event: 'getSessionHistory', id: st.workOpportunityForDemandSupport.id });
    }, [st.workOpportunityForDemandSupport, st.setIsChatBoxOpen]);
    if (props.noPanel) return h('div', { id: 'mock-chat-nopanel' }, 'panel never renders');
    return h('div', { id: 'mock-chat', 'data-open': String(open),
                      'data-load': open ? st.workOpportunityForDemandSupport.id : '' },
      h('button', { id: 'mock-amazon-chat-icon', type: 'button', onClick: function () {
        // Amazon's OWN chat icon: opens the chat on a load without any of our code involved.
        ctx.setChatBotState(Object.assign({}, st, { workOpportunityForDemandSupport: WOS[1], setIsChatBoxOpen: true }));
      } }, 'Amazon chat icon'),
      open ? h(ChatBox, { key: st.workOpportunityForDemandSupport.id, wo: st.workOpportunityForDemandSupport,
                          onClose: function () { ctx.setChatBotState(Object.assign({}, st, { setIsChatBoxOpen: false })); } })
           : 'chat closed');
  }

  // EXT-D10.2: Amazon's open Relay Assistant, built from the DOM facts Ihor captured live:
  // .chat-box-position › .message-header (title + minimize/close) · the load with .wo-total_payout
  // and the three booking buttons · textarea#ra-input (React-CONTROLLED) in a container, and the send
  // <button type=button data-mdn-interactive class=css-1gltk7k> right after that container.
  function ChatBox(props) {
    var t = React.useState('');
    var text = t[0];
    window.__raValue = text;
    var noPay = params.get('nopay') === '1';
    var bookRefs = [React.useRef(null), React.useRef(null), React.useRef(null)];
    React.useEffect(function () {
      // Booking controls: record EVERY event that reaches them. The suite asserts this stays empty.
      window.__bookingEvents = window.__bookingEvents || [];
      var types = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'focus', 'focusin',
                   'keydown', 'keyup', 'input', 'change'];
      bookRefs.forEach(function (r) {
        types.forEach(function (ty) {
          r.current.addEventListener(ty, function (e) { window.__bookingEvents.push(r.current.id + ':' + e.type); }, true);
        });
      });
    }, []);
    var w = props.wo;
    return h('div', { className: 'chat-box-position', style: {
        position: 'fixed', right: '16px', bottom: '16px', width: '380px', height: '520px',
        display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #aab7b8', fontFamily: 'Arial' } },
      h('div', { className: 'css-hdr1 message-header bot-header', style: { display: 'flex', padding: '8px', borderBottom: '1px solid #ddd' } },
        h('span', { style: { flex: 1 } }, 'Relay Assistant'),
        h('button', { type: 'button', 'aria-label': 'Minimize' }, '–'),
        h('button', { type: 'button', 'aria-label': 'Close', onClick: props.onClose }, '×')),
      h('div', { className: 'chatbot-body', style: { flex: '1 1 auto', overflow: 'auto', padding: '8px' } },
        h('div', { className: 'mock-load' },
          'Load ' + w.id.slice(0, 4) + ' ',
          noPay ? null : h('span', { className: 'wo-total_payout' }, '$' + w.payout.value.toFixed(2))),
        h('div', { className: 'mock-book-row', style: { marginTop: '8px' } },
          h('button', { id: 'rlb-book-btn', type: 'button', ref: bookRefs[0] }, 'Book'),
          h('button', { id: 'rlb-book-trip-confirm-booking-btn', type: 'button', ref: bookRefs[1] }, 'Confirm booking'),
          h('button', { id: 'rlb-book-trip-no-btn', type: 'button', ref: bookRefs[2] }, 'No'))),
      h('div', { className: 'mock-input-row', style: { display: 'flex', alignItems: 'center', padding: '8px', borderTop: '1px solid #ddd' } },
        h('div', { className: 'css-inputwrap', style: { flex: '1 1 auto', minWidth: 0 } },
          h('textarea', { id: 'ra-input', placeholder: 'Type your message here', className: 'css-5ivjoy',
                          'data-mdn-interactive': '', rows: 1, value: text, style: { width: '100%', boxSizing: 'border-box' },
                          onChange: function (e) { t[1](e.target.value); } })),
        h('button', { type: 'button', 'data-mdn-interactive': '', className: 'css-1gltk7k', style: { marginLeft: '8px' },
                      onClick: function () { (window.__sent = window.__sent || []).push(text); t[1](''); } }, 'Send')));
  }

  function Board() {
    return h('div', { className: 'load-list', id: 'mock-main-list' },
      WOS.map(function (w) { return h(Card, { key: w.id, wo: w }); }));
  }

  // The context the visible chat really reads.
  function RealChatProvider(props) {
    var s = React.useState(initialState);
    var setChatBotState = React.useCallback(function (next) { s[1](Object.assign({}, next)); }, []);
    var cand = (window.__MOCK_CANDIDATES || []).map(function (id) { return byId[id]; });
    var wol  = (window.__MOCK_WOLIST || []).map(function (id) { return byId[id]; });
    var value = { chatBotState: s[0], setChatBotState: setChatBotState,
                  chatBotCandidateList: cand, workOpportunityList: wol };
    return h(ChatCtx.Provider, { value: value }, props.children);
  }

  // A chat-shaped Provider nobody consumes. Plain useState, all eligible loads as candidates.
  function DecoyProvider(props) {
    var s = React.useState(initialState);
    window.__mockDecoyState = s[0];
    var value = { chatBotState: s[0], setChatBotState: s[1],
                  chatBotCandidateList: WOS.filter(function (w) { return w.demandSupportEnabled; }),
                  workOpportunityList: WOS };
    return h(DecoyCtx.Provider, { value: value }, props.children);
  }

  var tree;
  if (variant === 'noctx') tree = h(Board);
  else if (variant === 'provideronly') tree = h(DecoyProvider, null, h(Board));
  else if (variant === 'nopanel') tree = h(RealChatProvider, null, h(Board), h(Chat, { noPanel: true }));
  else tree = h(DecoyProvider, null, h(RealChatProvider, null, h(Board), h(Chat)));

  ReactDOM.createRoot(document.getElementById('root')).render(tree);
})();
