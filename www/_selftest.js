(async () => {
  demoLedger();
  const L = LEDGER;
  const quality = checkQuality(L);
  const events = runRules(L);
  const hit = {};
  events.forEach(e => { (hit[e.rule_id] = hit[e.rule_id] || []).push(e.severity); });
  const expect = ['R001','R002','R003','R004','R005','R006','R007','R010','R011','R012'];
  const missing = expect.filter(r => !hit[r]);
  console.log(JSON.stringify({
    vouchers: L.vouchers.length,
    period: L.period,
    unmapped: L.unmapped.length,
    quality_codes: quality.map(q => q.code + ':' + q.sev),
    rules_hit: hit,
    missing_rules: missing,
    total_events: events.length,
    top5: events.slice(0,5).map(e => `${e.rule_id}/${e.severity} ${e.title} (${fmt(e.amount)})`),
  }, null, 1));
})();
