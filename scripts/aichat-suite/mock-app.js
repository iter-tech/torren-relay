// Mock of Amazon's board + Relay Assistant state, shaped as documented in
// docs/AI_CHAT_CAPTURE.md §10.4: a React context value carrying chatBotState / setChatBotState,
// chatBotCandidateList and workOpportunityList. Page (MAIN) world, plain React 18, no JSX.
(function () {
  var h = React.createElement;
  var params = new URLSearchParams(location.search);
  var variant = params.get('variant') || 'full';
  var LOADS = window.__MOCK_LOADS;
  var Ctx = React.createContext(null);

  window.__mockChatLog = [];
  window.__mockRenders = 0;

  function wo(l) {
    return { id: l.id, version: 7, majorVersion: 2, workOpportunityOptionId: '1',
             demandSupportEnabled: l.dse, payout: { value: l.pay, unit: 'USD' },
             loads: [{ stops: [] }] };
  }
  var WOS = LOADS.map(wo);
  var byId = {}; WOS.forEach(function (w) { byId[w.id] = w; });

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

  function Chat() {
    var ctx = React.useContext(Ctx);
    var st = ctx.chatBotState;
    window.__mockState = st;
    window.__mockRenders++;
    React.useEffect(function () {
      // Stands in for Amazon's chunk-446 effect (getSessionHistory → sendMessage auto_start).
      if (st.setIsChatBoxOpen && st.workOpportunityForDemandSupport) {
        window.__mockChatLog.push({ event: 'getSessionHistory', id: st.workOpportunityForDemandSupport.id });
      }
    }, [st.workOpportunityForDemandSupport, st.setIsChatBoxOpen]);
    return h('div', { id: 'mock-chat', 'data-open': String(!!st.setIsChatBoxOpen),
                      'data-load': st.workOpportunityForDemandSupport ? st.workOpportunityForDemandSupport.id : '' },
      st.setIsChatBoxOpen ? 'Relay Assistant — ' + st.workOpportunityForDemandSupport.id.slice(0, 4) : 'chat closed');
  }

  function Board() {
    return h('div', { className: 'load-list', id: 'mock-main-list' },
      WOS.map(function (w) { return h(Card, { key: w.id, wo: w }); }));
  }

  function App() {
    var s = React.useState({ workOpportunityForDemandSupport: null, setIsChatBoxOpen: false,
                             setShowBadgeOnIcon: true, untouchedField: 'kept' });
    var cand = (window.__MOCK_CANDIDATES || []).map(function (id) { return byId[id]; });
    var wol  = (window.__MOCK_WOLIST || []).map(function (id) { return byId[id]; });
    var value = { chatBotState: s[0], setChatBotState: s[1],
                  chatBotCandidateList: cand, workOpportunityList: wol };
    return h(Ctx.Provider, { value: value }, h(Board), h(Chat));
  }

  var root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(variant === 'noctx' ? h(Board) : h(App));
})();
