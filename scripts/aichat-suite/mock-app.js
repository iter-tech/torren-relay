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
    // Amazon's class names, as styled by the competitor's dark-mode CSS.
    return h('div', { id: 'mock-chat', 'data-open': String(open),
                      'data-load': open ? st.workOpportunityForDemandSupport.id : '' },
      open ? h('div', { className: 'chat-box-position' },
               h('div', { className: 'bot-header' }, 'Relay Assistant — ' + st.workOpportunityForDemandSupport.id.slice(0, 4)),
               h('div', { className: 'chatbot-body' }, 'chat body'))
           : 'chat closed');
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
