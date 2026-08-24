/* 晏铭湛箴 Audit OS — 移动端骨架 v0.2
 * 规则引擎与 Ya-MiC/audit-os (Python) 同一套语义: 12条规则 R001~R012。
 * 铁律(总纲§23): AI可推理, 但不能偷改证据 — 原始CSV入库即SHA-256锁定。 */
"use strict";

/* ---------- 标准科目映射 (对齐 mapping.py) ---------- */
const STD = { "1001":"库存现金","1002":"银行存款","1122":"应收账款","1123":"预付账款",
  "1403":"原材料","1405":"库存商品","2202":"应付账款","2203":"预收账款","2211":"应付职工薪酬",
  "2221":"应交税费","2241":"其他应付款","4001":"实收资本","4103":"本年利润",
  "5001":"生产成本","6001":"主营业务收入","6051":"其他业务收入","6401":"主营业务成本",
  "6601":"销售费用","6602":"管理费用","6603":"财务费用" };
const ALIAS = { "现金":"1001","库存现金":"1001","银行存款":"1002","银行":"1002","工行":"1002","基本户":"1002",
  "应收账款":"1122","应收":"1122","客户往来":"1122","预付":"1123","预付账款":"1123",
  "原材料":"1403","材料":"1403","库存商品":"1405","存货":"1405","产成品":"1405",
  "应付账款":"2202","应付":"2202","供应商往来":"2202","预收":"2203","预收账款":"2203",
  "应付职工薪酬":"2211","工资":"2211","薪酬":"2211","应交税费":"2221","税金":"2221","增值税":"2221",
  "其他应付款":"2241","实收资本":"4001","本年利润":"4103","生产成本":"5001",
  "主营业务成本":"6401","销售成本":"6401","成本":"6401",
  "主营业务收入":"6001","营业收入":"6001","销售收入":"6001","收入":"6001","其他业务收入":"6051",
  "管理费用":"6602","办公费":"6602","差旅费":"6602","招待费":"6602",
  "销售费用":"6601","营业费用":"6601","广告费":"6601","运费":"6601",
  "财务费用":"6603","利息":"6603","手续费":"6603" };

function mapAccount(raw) {
  const n = String(raw || "").replace(/\s+/g, "").toLowerCase();
  if (!n) return { code: "", name: "", conf: 0 };
  if (ALIAS[n]) return { code: ALIAS[n], name: STD[ALIAS[n]], conf: 1 };
  for (const [a, c] of Object.entries(ALIAS))
    if (n.startsWith(a) || n.includes(a)) return { code: c, name: STD[c], conf: 0.85 };
  let best = "", score = 0;
  for (const a of Object.keys(ALIAS)) {
    const s = similarity(n, a);
    if (s > score) { score = s; best = ALIAS[a]; }
  }
  return score >= 0.75 ? { code: best, name: STD[best], conf: +score.toFixed(2) }
                       : { code: "", name: raw, conf: 0 };
}
function similarity(a, b) { // Dice 系数(字符二元组)
  if (a === b) return 1;
  const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
  const ga = grams(a), gb = grams(b);
  if (!ga.size || !gb.size) return 0;
  let inter = 0; for (const g of ga) if (gb.has(g)) inter++;
  return 2 * inter / (ga.size + gb.size);
}

/* ---------- 数据模型 ---------- */
let LEDGER = null;   // {vouchers:[], fileName, sha256, period:{lo,hi}}
const CFG = { materialityFloor: 50000, autoPct: 0.005, r001Days: 10, r001Share: 0.30,
  r002Mult: 4.0, r004Ratio: 0.35, r005Band: 8.0, r007Share: 0.45,
  r008Unmatched: 100000, r011N: 3, r012Win: 5 };

/* ---------- CSV 解析 ---------- */
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

function pickCol(header, candidates) {
  const norm = h => h.trim().toLowerCase().replace(/\s+/g, "");
  for (const c of candidates) { const i = header.findIndex(h => norm(h) === norm(c)); if (i >= 0) return i; }
  for (const c of candidates) { const i = header.findIndex(h => norm(h).startsWith(norm(c))); if (i >= 0) return i; }
  return -1;
}
function toNum(s) {
  if (s == null) return NaN;
  const x = parseFloat(String(s).replace(/[,¥￥￥\s]/g, ""));
  return isNaN(x) ? NaN : x;
}
function toDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function ingestCSV(text, fileName, sha) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("文件行数太少(需要表头+数据)");
  const H = rows[0];
  const ci = {
    v: pickCol(H, ["凭证号","凭证编号","voucher"]),
    date: pickCol(H, ["日期","记账日期","凭证日期","date"]),
    acct: pickCol(H, ["科目名称","科目","会计科目"]),
    debit: pickCol(H, ["借方金额","借方","debit"]),
    credit: pickCol(H, ["贷方金额","贷方","credit"]),
    amt: pickCol(H, ["金额","amount"]),
    cp: pickCol(H, ["对方单位","往来单位","对方"]),
    sum: pickCol(H, ["摘要","summary"]),
  };
  if (ci.v < 0 || (ci.acct < 0) || ((ci.debit < 0 || ci.credit < 0) && ci.amt < 0) || ci.date < 0)
    throw new Error("缺少必需列: 凭证号/科目/日期/借贷金额。实际表头: " + H.join(" | "));
  const vouchers = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const debit = ci.debit >= 0 ? (toNum(row[ci.debit]) || 0) : 0;
    const credit = ci.credit >= 0 ? (toNum(row[ci.credit]) || 0) : 0;
    let amt = ci.amt >= 0 ? toNum(row[ci.amt]) : debit - credit;
    if (isNaN(amt)) continue;
    const d = toDate(row[ci.date]);
    if (!d) continue;
    const rawAcct = ci.acct >= 0 ? String(row[ci.acct] || "") : "";
    const m = mapAccount(rawAcct);
    vouchers.push({
      vid: String(row[ci.v] || "").trim(), line: r + 1,
      code: m.code, rawName: rawAcct, date: d, amount: amt,
      cp: ci.cp >= 0 ? String(row[ci.cp] || "").trim() : "",
      summary: ci.sum >= 0 ? String(row[ci.sum] || "").trim() : "",
    });
  }
  if (!vouchers.length) throw new Error("没有解析出有效分录");
  const dates = vouchers.map(v => v.date).sort();
  LEDGER = { vouchers, fileName, sha256: sha,
             period: { lo: dates[0], hi: dates[dates.length - 1] },
             unmapped: [...new Set(vouchers.filter(v => !v.code).map(v => v.rawName))] };
}

/* ---------- 质量检查 DQ-001~005 (对齐 quality.py) ---------- */
function checkQuality(L) {
  const issues = [], vs = L.vouchers, add = (code, sev, msg, samples) =>
    issues.push({ code, sev, msg, samples: [...new Set(samples)].slice(0, 5) });
  const seenKey = new Map();
  for (const v of vs) {
    const k = v.vid + "#" + v.line;
    seenKey.set(k, (seenKey.get(k) || 0) + 1);
  }
  add("DQ-001", "error", `${vs.length} 行已载入`, []);   // 摘要行
  const dup = [...seenKey.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  if (dup.length) add("DQ-002", "error", `${dup.length} 条分录行重复`, dup);
  const miss = vs.filter(v => !v.code).map(v => v.vid);
  if (miss.length) add("DQ-003", "error", `${miss.length} 行科目未映射`, miss);
  const bal = new Map();
  for (const v of vs) bal.set(v.vid, (bal.get(v.vid) || 0) + v.amount);
  const unbal = [...bal.entries()].filter(([, s]) => Math.abs(s) > 0.01);
  if (unbal.length)
    add("DQ-004", "error", `${unbal.length} 张凭证借贷不平`,
        unbal.slice(0, 8).map(([vid, s]) => `${vid}(Δ${s.toFixed(2)})`));
  const out = vs.filter(v => v.date < L.period.lo || v.date > L.period.hi).map(v => v.vid);
  if (out.length) add("DQ-005", "warning", `${out.length} 行在期间 ${L.period.lo}~${L.period.hi} 边界外`, out);
  return issues.filter(i => i.samples.length || i.code === "DQ-001");
}

/* ---------- 规则引擎 R001~R012 (语义对齐 engine.py) ---------- */
function autoMateriality(L) {
  const rev = L.vouchers.filter(v => v.code === "6001" && v.amount < 0)
                        .reduce((s, v) => s - v.amount, 0);
  if (rev <= 0) return CFG.materialityFloor;
  return Math.max(CFG.materialityFloor, Math.round(rev * CFG.autoPct / 1000) * 1000);
}

function runRules(L) {
  const M = autoMateriality(L), ev = [];
  const push = (rule_id, rule_name, severity, title, detail, amount, evidence, procedure) =>
    ev.push({ rule_id, rule_name, severity, title, detail, amount, evidence, procedure });
  const ref = v => ({ src_file: L.fileName, locator: `row=${v.line}`,
                      desc: v.summary || `${v.rawName} ${v.cp || ""}`.trim() });
  const byCode = c => L.vouchers.filter(v => v.code === c);

  /* R001 期末突击收入 */
  {
    const revAll = byCode("6001").filter(v => v.amount < 0);
    const total = revAll.reduce((s, v) => s - v.amount, 0);
    if (total > 0) {
      const hi = new Date(L.period.hi), start = new Date(hi);
      start.setDate(start.getDate() - CFG.r001Days + 1);
      const winISO = start.toISOString().slice(0, 10);
      const win = revAll.filter(v => v.date >= winISO);
      const wsum = win.reduce((s, v) => s - v.amount, 0), share = wsum / total;
      if (share >= CFG.r001Share)
        push("R001", "期末突击收入", share >= 0.5 ? "high" : "medium",
          `期末最后${CFG.r001Days}天确认了全期 ${(share*100).toFixed(0)}% 的收入`,
          `窗口收入 ${fmt(wsum)} / 全期 ${fmt(total)}，超过阈值 ${(CFG.r001Share*100).toFixed(0)}%。`,
          wsum, win.slice(0, 20).map(ref),
          "截止测试：核对窗口内每笔收入的出库单/签收单与发票日期；期后退货检查。");
    }
  }
  /* R002 大额分录 */
  for (const v of L.vouchers) if (Math.abs(v.amount) >= M * CFG.r002Mult)
    push("R002", "异常大额交易", M * 2 <= Math.abs(v.amount) ? "high" : "medium",
      `大额分录 ${v.vid} (${v.rawName})`,
      `单笔 ${fmt(Math.abs(v.amount))} ≥ 阈值 ${fmt(M*CFG.r002Mult)}；摘要「${v.summary}」；对方「${v.cp}」。`,
      Math.abs(v.amount), [ref(v)],
      "追查原始合同、审批记录与资金流向；确认商业实质。");
  /* R003 负数收入/成本 */
  for (const v of L.vouchers) {
    if ((v.code === "6001" || v.code === "6051") && v.amount > 0)
      push("R003", "负数收入/成本", "medium", `收入科目出现借方发生 ${v.vid}`,
        `${v.rawName} 借方 ${fmt(v.amount)}，「${v.summary}」`, v.amount, [ref(v)],
        "区分销售退回/折让与错误冲销；核对退货协议。");
    if ((v.code === "5001" || v.code === "6401") && v.amount < 0)
      push("R003", "负数收入/成本", "medium", `成本科目出现贷方发生 ${v.vid}`,
        `${v.rawName} 贷方 ${fmt(-v.amount)}，「${v.summary}」`, -v.amount, [ref(v)],
        "核实暂估冲回与实际成本差异处理。");
  }
  /* R004 应收异常 */
  {
    const rev = byCode("6001").filter(v => v.amount < 0).reduce((s, v) => s - v.amount, 0);
    const ar = byCode("1122").reduce((s, v) => s + v.amount, 0);
    if (rev > 0 && ar > 0 && ar / rev >= CFG.r004Ratio) {
      const top = byCode("1122").sort((a, b) => b.amount - a.amount).slice(0, 10);
      push("R004", "应收账款异常", ar / rev >= 0.6 ? "high" : "medium",
        `应收余额达期间收入的 ${(ar/rev*100).toFixed(0)}%`,
        `应收 ${fmt(ar)} / 收入 ${fmt(rev)}。`, ar, top.map(ref),
        "函证主要客户；账龄分析；期后回款检查。");
    }
  }
  /* R005 毛利率异常 */
  {
    const revM = {}, costM = {};
    for (const v of L.vouchers) {
      const m = v.date.slice(0, 7);
      if (v.code === "6001" && v.amount < 0) revM[m] = (revM[m] || 0) - v.amount;
      if ((v.code === "5001" || v.code === "6401") && v.amount > 0) costM[m] = (costM[m] || 0) + v.amount;
    }
    const months = Object.keys(revM).filter(m => costM[m] && revM[m] > 0).sort();
    if (months.length >= 3) {
      const gm = months.map(m => ({ m, g: (revM[m]-costM[m])/revM[m]*100 }));
      const avg = gm.reduce((s, x) => s + x.g, 0) / gm.length;
      for (const { m, g } of gm) if (Math.abs(g - avg) >= CFG.r005Band) {
        const hits = L.vouchers.filter(v => v.date.startsWith(m) &&
          ["6001","5001","6401"].includes(v.code));
        push("R005", "毛利率异常", Math.abs(g-avg) < CFG.r005Band*1.8 ? "medium" : "high",
          `${m} 毛利率 ${g.toFixed(1)}% 偏离均值 ${avg.toFixed(1)}%`,
          `偏离 ${g>=avg?"+":""}${(g-avg).toFixed(1)}pp ≥ 带宽 ±${CFG.r005Band}pp。`,
          Math.abs(revM[m]-costM[m]), hits.slice(0,15).map(ref),
          "分析存货计价与结转口径；排查人为调节成本。");
      }
    }
  }
  /* R006 关联方对挂 */
  {
    const ar = {}, ap = {}, arV = {}, apV = {};
    for (const v of L.vouchers) {
      if (v.code === "1122" && v.cp) { ar[v.cp]=(ar[v.cp]||0)+v.amount; arV[v.cp]=v; }
      if (v.code === "2202" && v.cp) { ap[v.cp]=(ap[v.cp]||0)-v.amount; apV[v.cp]=v; }
    }
    for (const c of Object.keys(ar)) if (ap[c] !== undefined &&
        Math.abs(ar[c]) > 1 && Math.abs(ap[c]) > 1) {
      const amt = Math.min(Math.abs(ar[c]), Math.abs(ap[c]));
      if (amt >= M * 0.5)
        push("R006", "关联方异常", sevBy(amt, M), `同一单位 ${c} 同时挂应收与应付`,
          `应收 ${fmt(ar[c])} / 应付 ${fmt(ap[c])}，存在对挂。`, amt,
          [ref(arV[c]), ref(apV[c])],
          "识别关联关系；判断资金闭环与抵销必要性。");
    }
  }
  /* R007 供应商集中 */
  {
    const pur = {}, purV = {};
    for (const v of L.vouchers)
      if ((v.code==="1403"||v.code==="1405") && v.amount>0 && v.cp) {
        pur[v.cp]=(pur[v.cp]||0)+v.amount; (purV[v.cp]=purV[v.cp]||[]).push(v); }
    const total = Object.values(pur).reduce((a,b)=>a+b,0);
    if (total > 0) {
      const sorted = Object.entries(pur).sort((a,b)=>b[1]-a[1]);
      const [sup, amt] = sorted[0];
      if (amt/total >= CFG.r007Share)
        push("R007", "供应商集中异常", amt/total >= CFG.r007Share+0.25 ? "high":"medium",
          `供应商 ${sup} 占采购总额 ${(amt/total*100).toFixed(0)}%`,
          `${fmt(amt)}/${fmt(total)} ≥ ${(CFG.r007Share*100).toFixed(0)}%。`, amt,
          purV[sup].slice(0,10).map(ref),
          "核实供应关系真实性；排查空转贸易/资金通道。");
    }
  }
  /* R010 周末大额 */
  {
    const thr = M * CFG.r002Mult, seen = new Set();
    for (const v of L.vouchers) {
      const d = new Date(v.date + "T12:00:00Z");
      if (isNaN(d)) continue;
      const wd = d.getUTCDay();
      if ((wd === 0 || wd === 6) && Math.abs(v.amount) >= thr && !seen.has(v.vid+v.line)) {
        seen.add(v.vid+v.line);
        push("R010", "凭证日期异常", "low", `周末大额凭证 ${v.vid} (${v.date})`,
          `${["周日","周一","周二","周三","周四","周五","周六"][wd]} 发生 ${fmt(Math.abs(v.amount))}，「${v.summary}」`,
          Math.abs(v.amount), [ref(v)],
          "结合行业惯例判断合理性；关注跨期与倒签。");
      }
    }
  }
  /* R011 重复交易 */
  {
    const groups = {};
    for (const v of L.vouchers) {
      if (!v.amount) continue;
      const k = [v.date, Math.abs(v.amount).toFixed(2), v.cp, v.code].join("|");
      (groups[k] = groups[k] || []).push(v);
    }
    for (const [k, items] of Object.entries(groups))
      if (items.length >= CFG.r011N) {
        const [date, amtS, cp, code] = k.split("|");
        const amt = parseFloat(amtS);
        push("R011", "重复交易", amt >= M ? "medium" : "low",
          `${items.length} 笔完全相同交易 (${items[0].rawName} ${fmt(amt)}×${items.length})`,
          `日期 ${date}，对方「${cp}」，合计 ${fmt(amt*items.length)}。`, amt*items.length,
          items.slice(0,10).map(ref),
          "判断正常批量特征或重复记账/拆分规避审批。");
      }
  }
  /* R012 冲销后回转 */
  {
    const pos = L.vouchers.filter(v => v.amount > 0);
    for (const v of L.vouchers) {
      if (v.amount >= 0) continue;
      if (!(v.summary || "").includes("冲") && !(v.summary || "").includes("红")) continue;
      const target = -round2(v.amount), d0 = new Date(v.date+"T12:00:00Z");
      const hit = pos.find(p => round2(p.amount) === target && p.code === v.code &&
        p.date >= v.date &&
        (new Date(p.date+"T12:00:00Z") - d0) <= CFG.r012Win*86400000);
      if (hit)
        push("R012", "异常冲销", sevBy(Math.abs(v.amount), M),
          `冲销后${CFG.r012Win}天内等额重录 ${v.vid}→${hit.vid}`,
          `${v.rawName} ${fmt(-v.amount)} 于 ${v.date} 冲销、${hit.date} 重录，「${v.summary}」`,
          Math.abs(v.amount), [ref(v), ref(hit)],
          "追查冲销动机：更正错账还是调节利润。");
    }
  }
  const order = { high: 0, medium: 1, low: 2 };
  return ev.sort((a, b) => order[a.severity] - order[b.severity] || b.amount - a.amount);
}
function sevBy(amount, M) { return amount >= 2*M ? "high" : amount >= M ? "medium" : "low"; }
function round2(x) { return Math.round(x*100)/100; }
function fmt(x) { return Number(x).toLocaleString("zh-CN", {maximumFractionDigits: 0}); }

/* ---------- 示例账套 (植入全部规则可命中的异常, 对齐 sample_data.py) ---------- */
function demoLedger() {
  const rng = mulberry32(42);
  const rows = [["凭证号","日期","科目","借方金额","贷方金额","对方单位","摘要"]];
  const cust = ["华洋商贸","恒达电子","蓝天实业","宏图贸易"], sup = ["南方钢材","东方五金"];
  let vno = 0;
  const add = (date, entries, cp="", sum="") => {
    vno++; const id = `记-${String(vno).padStart(4,"0")}`;
    for (const [acct, dr, cr] of entries)
      rows.push([id, date, acct, dr || "", cr || "", cp, sum]);
  };
  for (let m = 1; m <= 12; m++)
    for (let k = 0; k < 4; k++) {
      const day = `2025-${pad(m)}-${pad(5+Math.floor(rng()*20))}`;
      const rev = round2(180000 + rng()*80000);
      const cost = round2(rev*(0.60+rng()*0.08));
      const c = cust[Math.floor(rng()*cust.length)];
      add(day, [["主营业务收入","",rev.toFixed(2)],["应交税费","",""+round2(rev*0.13)],
                ["应收账款",round2(rev*1.13).toFixed(2),""]], c, `${c} 赊销`);
      add(nextDay(day), [["主营业务成本",cost.toFixed(2),""],["库存商品","",cost.toFixed(2)]], "", "结转成本");
      if (m < 12 || k < 3) {
        const pd = nextDay(day, 10+Math.floor(rng()*25));
        if (pd <= "2025-12-28")
          add(pd, [["银行存款",round2(rev*1.13).toFixed(2),""]], c, `收${c}货款`);
      }
      add(`2025-${pad(m)}-10`, [["管理费用","85000.00",""],["银行存款","","85000.00"]], "", "发工资");
    }
  // 异常植入
  for (let i = 0; i < 12; i++)
    add(`2025-12-${pad(24+i%5)}`, [["主营业务收入","",`${round2(450000+i*9000)}.00`],
         ["应收账款",`${round2((450000+i*9000)*1.13)}.00`,""]], `急单客户${String.fromCharCode(65+i%3)}`, "年末集中确认");
  add("2025-12-30", [["其他应收款","1500000.00",""],["银行存款","","1500000.00"]], "股东", "往来款");
  rows.push(["记-9001","2025-11-15","主营业务成本","","120000.00","","成本调整"]);
  add("2025-09-10", [["应收账款","300000.00",""],["主营业务收入","","265486.73"],
      ["应交税费","","34513.27"]], "关联方鑫盛公司", "销售设备");
  add("2025-10-08", [["原材料","280000.00",""],["应付账款","","280000.00"]], "关联方鑫盛公司", "采购材料");
  for (let i = 0; i < 3; i++)
    add(`2025-11-0${i+2}`, [["原材料","800000.00",""],["应付账款","","800000.00"]], "南方钢材", "大宗采购");
  add("2025-08-03", [["银行存款","600000.00",""],["其他应付款","","600000.00"]], "个人王某某", "借款");
  for (let i = 0; i < 3; i++)
    add("2025-07-15", [["管理费用","66000.00",""],["银行存款","","66000.00"]], "某咨询公司", "咨询费");
  add("2025-06-20", [["管理费用","","90000.00"],["银行存款","90000.00",""]], "", "冲销咨询费");
  add("2025-06-23", [["管理费用","90000.00",""],["银行存款","","90000.00"]], "", "重新入账咨询费");
  add("2025-04-28", [["主营业务成本","900000.00",""],["库存商品","","900000.00"]], "", "补结转成本");

  const csv = rows.map(r => r.map(c => /[,"]/.test(c) ? `"${c.replace(/"/g,'""')}"` : c).join(",")).join("\n");
  ingestCSV(csv, "示例账套.csv", "demo-seed-v2");  // 种子账套哈希固定, 报告可复现
}
function pad(n){return String(n).padStart(2,"0");}
function nextDay(iso, add=1){const d=new Date(iso+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+add);return d.toISOString().slice(0,10);}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

/* ---------- UI ---------- */
const $ = sel => document.querySelector(sel);
function setStatus(s) { $("#footStatus").textContent = s; }

async function analyze() {
  if (!LEDGER) return;
  setStatus("分析中…");
  await tick();
  try {
    const quality = checkQuality(LEDGER);
    renderQuality(quality);
    const events = runRules(LEDGER);
    renderRisks(events);
    $("#traceCard").style.display = "";
    $("#traceBody").innerHTML =
      `<div class="dim">证据基准: <b>${LEDGER.fileName}</b><br>` +
      `SHA-256: <span class="hash">${LEDGER.sha256}</span><br>` +
      `审计期间: ${LEDGER.period.lo} ~ ${LEDGER.period.hi} · 分录 ${LEDGER.vouchers.length} 行<br>` +
      `重大性阈值(自动): ${fmt(autoMateriality(LEDGER))} 元 · 引擎: 12条规则本地执行</div>`;
    $("#hashStatus").textContent = "🔒 " + LEDGER.sha256.slice(0, 16) + "…";
    setStatus(events.length ? `完成: ${events.length} 条风险` : "完成: 未命中风险");
  } catch (e) { setStatus("错误: " + e.message); }
}
const tick = () => new Promise(r => setTimeout(r, 30));

function renderQuality(qs) {
  $("#qualityCard").style.display = "";
  $("#qualityList").innerHTML = qs.map(i =>
    `<div class="dq ${i.sev}"><b>${i.code}</b> ${esc(i.msg)}` +
    (i.samples.length ? `<span class="samples">样例: ${i.samples.map(esc).join("、")}</span>` : "") +
    `</div>`).join("");
}
function renderRisks(evs) {
  $("#resultCard").style.display = "";
  $("#riskCount").textContent = evs.length;
  const sevCls = { high: "sev-high", medium: "sev-med", low: "sev-low" };
  $("#riskList").innerHTML = evs.map((e, i) =>
    `<details class="risk"><summary>
       <span class="sev ${sevCls[e.severity]}">${e.severity.toUpperCase()}</span>
       <b>${e.rule_id}</b> ${esc(e.title)}
       <span class="amt">${fmt(e.amount)}</span></summary>
     <p>${esc(e.detail)}</p>
     <p class="proc">建议程序: ${esc(e.procedure)}</p>
     <p class="evd">证据链:<br>${e.evidence.map(x =>
        `└ ${esc(x.src_file)} @ ${x.locator} · ${esc(x.desc)}`).join("<br>")}</p>
   </details>`).join("") || "<p class='dim'>未命中任何风险事件。</p>";
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

$("#btnDemo").addEventListener("click", async () => {
  setStatus("生成示例账套…");
  await tick();
  demoLedger();
  analyze();
});
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  setStatus("读取 " + f.name + "…");
  try {
    const text = await f.text();
    const buf = await f.arrayBuffer();
    const sha = await sha256Hex(buf);
    ingestCSV(text, f.name, sha);
    analyze();
  } catch (err) { setStatus("导入失败: " + err.message); }
});
$("#ver").textContent = "v0.2";
