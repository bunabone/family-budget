// התיקון החד פעמי של אוקטובר 2026, מול גיליון מדומה במצב שבו היה ב-16.10.2026
const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./gas-mock');
const Core = require('../core.js');

function sheetAsOf20261016() {
  const g = loadGas(['fix-2026-10.gs']);
  g.setup();
  // הנתונים כפי שהיו בגיליון של עופר לפני התיקון (נתוני הפתיחה של 1.10 ועריכות ידניות)
  const oldBudgets = { 'סופר ומזון לבית': 2748, 'דלק': 944, 'אוכל בחוץ ובילויים': 825, 'קניות: ביגוד, לבית ואונליין': 715,
    'בריאות המשפחה: מכבי, תרופות ושיניים': 641, 'טיפוח ועיסויים': 259, 'שונות: לוטו ותיקונים': 190, 'כביש 6 וחניה': 142, 'בונה: וטרינר וחריגים': 67 };
  Object.keys(oldBudgets).forEach((n) => g.updateRows_('categories', { name: n }, { budget: oldBudgets[n] }));
  g.updateRows_('fixed', { name: 'משכנתא' }, { amount: 4650 });
  g.updateRows_('fixed', { name: 'מוסך ותחזוקה' }, { amount: 377 });
  g.updateRows_('fixed', { name: '019 (עופר)' }, { name: 'אלוהה (עופר)', amount: 50 });
  g.updateRows_('pots', { name: 'רכב' }, { deposit: 527 });
  g.deleteRows_('pots', { name: 'קרן השתלמות' });
  g.deleteRows_('pots', { name: 'קניית רכב' });
  g.deleteRows_('rules', { merchant: 'זיו רונן' });
  g.deleteRows_('rules', { merchant: '^מ.א. מגידו' });
  assert.strictEqual(Core.costBase(g.getAll_()).fixedTotal, 20165.91);
  g.appendRows_('transactions', [
    { id: 'T1', date: '2026-04-02', month: '2026-04', card: 'MAX עופר', merchant: 'זיו רונן מרכז וטרינרי בע"', amount: 235, category: 'בונה: וטרינר וחריגים', pct: 100 },
    { id: 'T2', date: '2026-07-02', month: '2026-07', card: 'MAX עופר', merchant: 'זיו רונן מרכז וטרינרי בע"', amount: 405, category: 'בונה: וטרינר וחריגים', pct: 100 },
    { id: 'T3', date: '2026-05-02', month: '2026-05', card: 'MAX שגית', merchant: 'מ.א. מגידו', amount: 870, category: 'מחוץ לחישוב - חוגים', pct: 100 },
    { id: 'T4', date: '2026-05-03', month: '2026-05', card: 'MAX שגית', merchant: 'מועצה אזורית מגידו', amount: 198, category: 'מחוץ לחישוב - חוגים', pct: 100 }
  ]);
  return g;
}

test('fixOct2026 מעדכן תקציבים, קבועות, קופות, כללים ועסקאות', () => {
  const g = sheetAsOf20261016();
  const log = g.fixOct2026();
  assert.ok(!log.some((l) => l.includes('לא נמצא')), log.join('\n'));
  const d = g.getAll_();
  const cat = (n) => d.categories.find((c) => c.name === n);
  assert.strictEqual(cat('סופר ומזון לבית').budget, 3192);
  assert.strictEqual(Core.costBase(d).varBudget, 7298);
  const fx = (n) => d.fixed.find((f) => f.name === n);
  assert.strictEqual(fx('משכנתא').amount, 4674);
  assert.strictEqual(fx('מוסך ותחזוקה').amount, 515);
  assert.strictEqual(fx('019 (עופר)').amount, 60);
  assert.ok(!fx('אלוהה (עופר)'));
  assert.strictEqual(Core.costBase(d).fixedTotal, 20337.91);
  assert.strictEqual(d.pots.find((p) => p.name === 'רכב').deposit, 665);
  assert.strictEqual(d.pots.find((p) => p.name === 'קרן השתלמות').deposit, 3400);
  const tx = (id) => d.transactions.find((t) => t.id === id).category;
  assert.strictEqual(tx('T1'), 'מחוץ לחישוב - כבר בקבועות');
  assert.strictEqual(tx('T2'), 'בונה: וטרינר וחריגים');
  assert.strictEqual(tx('T3'), 'אוכל בחוץ ובילויים');
  assert.strictEqual(tx('T4'), 'מחוץ לחישוב - חוגים');
  const s = Core.monthSummary(d, '2026-10');
  assert.strictEqual(s.needToClose, Core.round2(20337.91 + 7298 - 9376));
  assert.strictEqual(s.savings, 829 + 1250 + 3400);
  // כללים חדשים מסווגים עסקאות עתידיות
  const c = Core.classifyAll([{ merchant: 'מ.א. מגידו', amount: 290, notes: '', type: '' }, { merchant: 'זיו רונן מרכז וטרינרי', amount: 240, notes: '', type: '' }], d.rules, d.categories, []);
  assert.deepStrictEqual(c.map((t) => t.category), ['אוכל בחוץ ובילויים', 'מחוץ לחישוב - כבר בקבועות']);
});

test('fixOct2026 בטוח להרצה שנייה', () => {
  const g = sheetAsOf20261016();
  g.fixOct2026();
  const before = JSON.stringify(g.getAll_());
  const log = g.fixOct2026();
  assert.ok(!log.some((l) => l.includes('לא נמצא')), log.join('\n'));
  const after = g.getAll_();
  assert.strictEqual(after.pots.length, 6);
  assert.strictEqual(JSON.stringify(after), before);
});
