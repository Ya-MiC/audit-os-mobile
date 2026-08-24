(() => {
  demoLedger();
  const ev = runRules(LEDGER).filter(e => e.rule_id === 'R011');
  const seen = {};
  ev.forEach(e => { seen[e.title.split('(')[0]] = (seen[e.title.split('(')[0]]||0)+1; });
  console.log('R011 分组:', JSON.stringify(seen));
  const bal = {};
  for (const v of LEDGER.vouchers) bal[v.vid] = (bal[v.vid]||0) + v.amount;
  console.log('不平凭证:', Object.entries(bal).filter(([,s]) => Math.abs(s)>0.01).map(([k,s])=>k+' Δ'+s.toFixed(0)));
})();
