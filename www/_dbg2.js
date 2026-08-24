(() => {
  demoLedger();
  const ev = runRules(LEDGER).filter(e => e.rule_id === 'R011');
  ev.slice(0,6).forEach(e => {
    console.log('◆', e.title, '| detail:', e.detail);
    e.evidence.slice(0,4).forEach(x => console.log('   ', x.locator, x.desc));
  });
})();
