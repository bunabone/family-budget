// משווה את הסיווג האוטומטי (כללי הפתיחה) לסיווג הידני בקובץ הוצאות_אשראי_מסווג.xlsx
const XLSX = require('../vendor/xlsx.full.min.js');
const Core = require('../core.js');
const { loadGas } = require('./gas-mock');
const file = process.argv[2];
const gas = loadGas();
gas.setup();
const key = gas.getSecret_();
const data = gas.call({ key, action: 'getAll' }).data;
const wb = XLSX.read(require('fs').readFileSync(file), { type: 'buffer' });
const sheets = wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
const parsed = Core.parseFile(sheets, {});
console.log('format', parsed.format, 'txs', parsed.txs.length, 'months', parsed.months.length);
const txs = parsed.txs.map((t) => { const c = Object.assign({}, t); delete c.presetCategory; c.expected = t.presetCategory; return c; });
const res = Core.classifyAll(txs, data.rules, data.categories);
const cats = Core.categoryMap(data.categories);
const counted = (n) => cats[n] && cats[n].type === 'משתנה';
let ok = 0, unknown = 0, wrong = [], bit = 0, okCoarse = 0;
for (const t of res) {
  if (t.bit) { bit++; continue; }
  if (!t.category) { unknown++; continue; }
  if (t.category === t.expected) ok++;
  else wrong.push(t);
  const ce = counted(t.expected) ? t.expected : 'OUT', cg = counted(t.category) ? t.category : 'OUT';
  if (ce === cg) okCoarse++;
}
const nonBit = res.length - bit;
console.log(`לא ביט: ${nonBit}. זהה מדויק: ${ok} (${(ok / nonBit * 100).toFixed(1)}%). לא זוהו: ${unknown}. שונים: ${wrong.length}. ביט/פייבוקס (תמיד לאישור): ${bit}`);
const recog = nonBit - unknown;
console.log(`מתוך שזוהו (${recog}): נכון ברמת "נספר בתקציב/איזו קטגוריה": ${okCoarse} (${(okCoarse / recog * 100).toFixed(1)}%)`);
const agg = {};
for (const t of wrong) { const k = `${t.expected} ← ${t.category} | ${t.merchant}`; agg[k] = (agg[k] || 0) + 1; }
console.log('\nשונים:'); Object.entries(agg).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v, k));
const un = {};
for (const t of res) if (!t.bit && !t.category) { const k = `${t.expected} | ${t.merchant}`; un[k] = (un[k] || 0) + 1; }
console.log('\nלא זוהו:'); Object.entries(un).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(v, k));
const bitOk = res.filter((t) => t.bit && t.category === t.expected).length;
console.log(`\nביט: ברירת המחדל המוצעת נכונה ב-${bitOk} מתוך ${bit}`);

// סימולציה: כל חודש מסווג עם הכללים + הזיכרון מהחודשים הקודמים
let simUnknown = 0, simWrong = 0, simTotal = 0;
const byMonth = {};
txs.forEach((t) => (byMonth[t.month] = byMonth[t.month] || []).push(t));
const past = [];
Object.keys(byMonth).sort().forEach((m) => {
  const r = Core.classifyAll(byMonth[m], data.rules, data.categories, past);
  r.forEach((t) => {
    if (t.bit) return;
    simTotal++;
    if (!t.category) simUnknown++;
    else if ((counted(t.category) ? t.category : 'OUT') !== (counted(t.expected) ? t.expected : 'OUT')) simWrong++;
  });
  byMonth[m].forEach((t) => past.push(Object.assign({}, t, { category: t.expected })));
});
const last6 = Object.keys(byMonth).sort().slice(-6);
console.log(`\nעם זיכרון מהחודשים הקודמים: לא זוהו ${simUnknown} מתוך ${simTotal}, שגויים ${simWrong}`);
let u6 = 0, n6 = 0;
{ const p = txs.filter((t) => t.month < last6[0]).map((t) => Object.assign({}, t, { category: t.expected }));
  const r = Core.classifyAll(txs.filter((t) => last6.includes(t.month)), data.rules, data.categories, p);
  r.forEach((t) => { if (!t.bit) { n6++; if (!t.category) u6++; } }); }
console.log(`בששת החודשים האחרונים (${last6[0]} עד ${last6[5]}): לא זוהו ${u6} מתוך ${n6} (${(u6 / n6 * 100).toFixed(1)}%)`);
