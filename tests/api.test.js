const test = require('node:test');
const assert = require('node:assert');
const { loadGas } = require('./gas-mock');

test('setup יוצר לשוניות, נתוני פתיחה וקוד סודי', () => {
  const g = loadGas();
  g.setup();
  const names = g._ss.getSheets().map((s) => s.getName());
  assert.deepStrictEqual(names.sort(), ['categories', 'fixed', 'income', 'pot_moves', 'pots', 'rules', 'settings', 'transactions'].sort());
  const key = g.getSecret_();
  assert.ok(key.length >= 8);
  const all = g.call({ key, action: 'getAll' });
  assert.ok(all.ok);
  const fixed = all.data.fixed.reduce((a, f) => a + f.amount, 0);
  assert.strictEqual(Math.round(fixed * 100) / 100, 20765.91);
  const varBudget = all.data.categories.filter((c) => c.type === 'משתנה').reduce((a, c) => a + c.budget, 0);
  assert.strictEqual(varBudget, 6531);
  assert.strictEqual(all.data.income.reduce((a, i) => a + i.amount, 0), 9376);
  assert.ok(!all.data.settings.some((s) => s.key === 'secret'), 'הקוד הסודי לא נשלח לאפליקציה');
  // הרצה שנייה לא משכפלת
  g.setup();
  assert.strictEqual(g.call({ key, action: 'getAll' }).data.fixed.length, all.data.fixed.length);
});

test('קוד שגוי נדחה', () => {
  const g = loadGas();
  g.setup();
  const r = g.call({ key: 'wrong', action: 'getAll' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'auth');
});

test('הוספת עסקאות: כפילויות לפי id, חודש נשמר כטקסט, סכום משפחתי כנוסחה', () => {
  const g = loadGas();
  g.setup();
  const key = g.getSecret_();
  const tx = { id: 'Tabc', date: '2026-09-03', month: '2026-09', card: 'MAX עופר', merchant: 'סונול', amount: 200, category: 'דלק', pct: 70 };
  let r = g.call({ key, action: 'batch', ops: [{ op: 'append', sheet: 'transactions', rows: [tx, tx] }] });
  assert.deepStrictEqual(r.results[0], { added: 1, skipped: 1 });
  r = g.call({ key, action: 'append', sheet: 'transactions', rows: [tx] });
  assert.deepStrictEqual(r.results[0], { added: 0, skipped: 1 });
  const t = g.call({ key, action: 'getAll' }).data.transactions[0];
  assert.strictEqual(t.month, '2026-09');
  assert.strictEqual(t.date, '2026-09-03');
  assert.strictEqual(t.familyAmount, 140);
  assert.ok(t.addedAt);
});

test('עדכון, upsert ומחיקה; הקוד הסודי מוגן', () => {
  const g = loadGas();
  g.setup();
  const key = g.getSecret_();
  g.call({ key, action: 'update', sheet: 'categories', where: { name: 'דלק' }, set: { budget: 900 } });
  g.call({ key, action: 'update', sheet: 'settings', where: { key: 'weak_months' }, set: { value: '2026-10' }, upsert: true });
  const d = g.call({ key, action: 'getAll' }).data;
  assert.strictEqual(d.categories.find((c) => c.name === 'דלק').budget, 900);
  assert.strictEqual(d.settings.find((s) => s.key === 'weak_months').value, '2026-10');
  const bad = g.call({ key, action: 'update', sheet: 'settings', where: { key: 'secret' }, set: { value: 'x' } });
  assert.strictEqual(bad.ok, false);
  const before = d.rules.length;
  g.call({ key, action: 'delete', sheet: 'rules', where: { priority: 10 } });
  assert.strictEqual(g.call({ key, action: 'getAll' }).data.rules.length, before - 1);
  assert.strictEqual(g.call({ key, action: 'append', sheet: 'nope', rows: [] }).ok, false);
});
