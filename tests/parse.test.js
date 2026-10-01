const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const Core = require('../core.js');
const { loadGas } = require('./gas-mock');
const { makeMax, makeCal } = require('./make-fixtures');

const CARDS = '3498=MAX עופר;8997=MAX שגית;1656=כאל שופרסל';
// קורא כמו האפליקציה: XLSX.read מ-ArrayBuffer, sheet_to_json עם header:1
function readLikeApp(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  return wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
}
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fb-'));
const g = loadGas(); g.setup();
const data = g.call({ key: g.getSecret_(), action: 'getAll' }).data;

test('MAX: זיהוי, כרטיס, חודש חיוב, דילוג על ממתינות, סיכומים ואפסים', () => {
  const f = path.join(tmp, 'max.xlsx'); makeMax(f);
  const p = Core.parseFile(readLikeApp(f), { cards: CARDS });
  assert.strictEqual(p.format, 'max');
  assert.deepStrictEqual(p.cards, ['MAX עופר']);
  assert.deepStrictEqual(p.skippedSheets, ['עסקאות שאושרו וטרם נקלטו']);
  assert.strictEqual(p.txs.length, 12);
  assert.ok(!p.txs.some((t) => t.merchant === 'שופרסל דיל יוקנעם'), 'ממתינה לא נקלטה');
  assert.ok(!p.txs.some((t) => t.merchant === 'דמי כרטיס'));
  const garage = p.txs.find((t) => t.merchant.startsWith('אוטו רם'));
  assert.strictEqual(garage.amount, 569.34);
  assert.strictEqual(garage.month, '2026-09');
  const cash = p.txs.find((t) => t.merchant.startsWith('כספומט'));
  assert.strictEqual(cash.month, '2026-08');
  const bits = p.txs.filter((t) => t.merchant === 'העברה בBIT' && t.amount === 80);
  assert.strictEqual(bits.length, 2);
  assert.notStrictEqual(bits[0].id, bits[1].id, 'שתי העברות זהות לא נבלעות');
  assert.ok(p.txs.find((t) => t.merchant.startsWith('HOTEL')).foreign);
});

test('MAX: סיווג', () => {
  const f = path.join(tmp, 'max.xlsx'); makeMax(f);
  const p = Core.parseFile(readLikeApp(f), { cards: CARDS });
  const c = Object.fromEntries(Core.classifyAll(p.txs, data.rules, data.categories).map((t) => [t.merchant + t.amount, t]));
  assert.strictEqual(c['מרכול רמות מנשה152.4'].category, 'סופר ומזון לבית');
  assert.strictEqual(c['סונול צומת אליקים300'].category, 'דלק');
  assert.strictEqual(c['סונול צומת אליקים300'].pct, 70);
  assert.strictEqual(c['העברה בBIT300'].category, 'טיפוח ועיסויים');
  assert.ok(c['העברה בBIT300'].needsReview, 'ביט תמיד לאישור');
  assert.strictEqual(c['העברה בBIT80'].category, 'אוכל בחוץ ובילויים');
  assert.strictEqual(c['מסעדה חדשה בעמק210'].category, 'אוכל בחוץ ובילויים', 'לפי ענף');
  assert.strictEqual(c['חנות לא מוכרת99.9'].category, '');
  assert.strictEqual(c['ALIEXPRESS LONDON GBR45.2'].category, 'קניות: ביגוד, לבית ואונליין');
  assert.strictEqual(c['HOTEL ZAGREB HRV820'].category, 'מחוץ לחישוב - חו"ל');
  assert.strictEqual(c['GOOGLE ONE MOUNTAIN VIEW USA74.9'].category, 'מחוץ לחישוב - עסקי');
  assert.strictEqual(c['כספומט לאומי יוקנעם1000'].category, 'מחוץ לחישוב - מזומן');
  assert.strictEqual(c['אוטו רם מוסך רמות מנשה569.34'].category, 'מחוץ לחישוב - מוסך');
});

test('כאל: חודש חיוב מהכותרת, חיוב מיידי, סכומים עם ₪ ופסיקים, זיכוי', () => {
  const f = path.join(tmp, 'cal.xlsx'); makeCal(f);
  const p = Core.parseFile(readLikeApp(f), { cards: CARDS });
  assert.strictEqual(p.format, 'cal');
  assert.deepStrictEqual(p.cards, ['כאל שופרסל']);
  assert.strictEqual(p.txs.length, 6);
  const ikea = p.txs.find((t) => t.merchant.startsWith('איקאה'));
  assert.strictEqual(ikea.amount, 400);
  assert.strictEqual(ikea.month, '2026-09');
  assert.strictEqual(p.txs.find((t) => t.amount === -32.9).type, 'זיכוי');
  const cash = p.txs.find((t) => t.merchant === 'הפועלים');
  assert.strictEqual(cash.month, '2026-08');
  const c = Core.classifyAll(p.txs, data.rules, data.categories);
  assert.strictEqual(c.find((t) => t.merchant === 'הפועלים').category, 'מחוץ לחישוב - מזומן');
  assert.strictEqual(c.find((t) => t.merchant === 'מכולת הכפר').category, 'סופר ומזון לבית');
  assert.strictEqual(c.find((t) => t.merchant.startsWith('כביש 6')).pct, 70);
});

test('אותה עסקה בשני ייצואים מקבלת אותו id', () => {
  const f = path.join(tmp, 'cal.xlsx'); makeCal(f);
  const a = Core.parseFile(readLikeApp(f), { cards: CARDS }).txs.map((t) => t.id);
  const b = Core.parseFile(readLikeApp(f), { cards: CARDS }).txs.map((t) => t.id);
  assert.deepStrictEqual(a, b);
});

test('תאריכים וסכומים', () => {
  assert.strictEqual(Core.parseDate('03-08-2026'), '2026-08-03');
  assert.strictEqual(Core.parseDate('04/08/26'), '2026-08-04');
  assert.strictEqual(Core.parseDate(46237), '2026-08-03');
  assert.strictEqual(Core.parseDate(new Date(2026, 7, 2, 23, 59, 30)), '2026-08-03');
  assert.strictEqual(Core.parseAmount('₪ 1,200.00'), 1200);
  assert.strictEqual(Core.parseAmount('32.90-'), -32.9);
});

test('זיכרון מהעבר: בית עסק שסווג פעם מקבל את אותה קטגוריה', () => {
  const t = [{ merchant: 'חנות לא מוכרת', amount: 50, card: 'x', date: '2026-08-01', month: '2026-09' }];
  const past = [{ merchant: 'חנות לא מוכרת', category: 'קניות: ביגוד, לבית ואונליין' }];
  const r = Core.classifyAll(t, data.rules, data.categories, past)[0];
  assert.strictEqual(r.category, 'קניות: ביגוד, לבית ואונליין');
  assert.ok(r.fromHistory);
});

test('חישוב החודש: צריך עוד, חודש חלש, קופות ויעדים', () => {
  const d = JSON.parse(JSON.stringify(data));
  d.transactions = [
    { month: '2026-10', category: 'דלק', amount: 1000, pct: 70 },
    { month: '2026-10', category: 'סופר ומזון לבית', amount: 3000, pct: 100 },
    { month: '2026-10', category: 'מחוץ לחישוב - מזומן', amount: 5000, pct: 100 },
    { month: '2026-09', category: 'סופר ומזון לבית', amount: 2000, pct: 100 }
  ];
  d.income.push({ kind: 'בפועל', month: '2026-10', name: 'הכנסה מעבודה', amount: 10000 });
  const s = Core.monthSummary(d, '2026-10');
  assert.strictEqual(s.fixedTotal, 20765.91);
  assert.strictEqual(s.costOfLiving, 27296.91);
  assert.strictEqual(s.varActual, 3700);
  // תקציב משתנות 6531, סופר בפועל 3000 במקום 2748 => תחזית 6783
  assert.strictEqual(s.varProjected, 6783);
  assert.strictEqual(s.incomeTotal, 19376);
  assert.strictEqual(s.needToClose, Core.round2(20765.91 + 6783 - 19376));
  assert.strictEqual(s.savings, 819 + 1250);
  assert.strictEqual(s.categories.find((c) => c.name === 'סופר ומזון לבית').avg, 2000);
  d.settings.find((x) => x.key === 'weak_months').value = '2026-10';
  assert.strictEqual(Core.monthSummary(d, '2026-10').savings, 0);
  d.potMoves = [{ date: '2026-09-01', pot: 'בריכה', kind: 'הפקדה', amount: 1170, note: '' }];
  const up = Core.upcoming(d, '2026-10');
  const pool = up.find((u) => u.name === 'בריכה');
  assert.strictEqual(pool.balance, 1170);
  assert.strictEqual(pool.due, '2027-06');
  assert.ok(pool.ok);
});

test('בלי חודש פתיחה ריק: ממוצעי ההיסטוריה דומים לאפיון', () => {
  const file = process.env.HISTORY_XLSX;
  if (!file || !fs.existsSync(file)) return;
  const p = Core.parseFile(readLikeApp(file), {});
  const d = JSON.parse(JSON.stringify(data));
  d.transactions = Core.classifyAll(p.txs, d.rules, d.categories);
  const s = Core.monthSummary(d, '2026-10');
  const sup = s.categories.find((c) => c.name === 'סופר ומזון לבית');
  console.log('ממוצעים ב-12 החודשים האחרונים:', s.categories.map((c) => `${c.name}: ${c.avg}`).join(' | '));
  assert.ok(sup.avg > 2000 && sup.avg < 4000);
});
