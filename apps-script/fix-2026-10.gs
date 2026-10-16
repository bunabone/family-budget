// תיקון נתונים חד פעמי, אוקטובר 2026 (לפי התשובות של עופר מ-16.10.2026).
// מדביקים בסוף Code.gs בעורך הסקריפט, שומרים, בוחרים בפונקציה fixOct2026 ולוחצים "הפעלה".
// בטוח להריץ שוב: מה שכבר תוקן לא משתנה פעמיים.

var FIX_2026_10 = {
  // תקציב חודשי = ממוצע 12 חודשי החיוב האחרונים (אוקטובר 2025 עד ספטמבר 2026), אחרי הסיווגים שלמטה
  budgets: {
    'סופר ומזון לבית': 3192,
    'דלק': 1023,
    'אוכל בחוץ ובילויים': 1238,
    'קניות: ביגוד, לבית ואונליין': 701,
    'בריאות המשפחה: מכבי, תרופות ושיניים': 718,
    'טיפוח ועיסויים': 64,
    'שונות: לוטו ותיקונים': 182,
    'כביש 6 וחניה': 132,
    'בונה: וטרינר וחריגים': 48
  },
  fixed: [
    { where: { name: 'משכנתא' }, set: { amount: 4674, note: 'צמודה למדד, ספטמבר 2026' } },
    { where: { name: 'מוסך ותחזוקה' }, set: { amount: 515, note: 'ממוצע בפועל 6,178 לשנה, לקופת רכב' } },
    { where: { name: 'אלוהה (עופר)' }, set: { name: '019 (עופר)', amount: 60, note: 'עברנו ל-019' } },
    { where: { name: 'מזון ותרופות' }, set: { note: 'אוכל, תרופה כ-240 לשלושה חודשים ותרופה נוספת' } }
  ],
  pots: [
    { where: { name: 'רכב' }, set: { deposit: 665, note: 'רישוי וטסט 150 + מוסך 515' } }
  ],
  newPots: [
    { name: 'קרן השתלמות', deposit: 3400, target: '', targetDate: '', inFixed: 'לא', note: '1,700 לכל אחד' },
    { name: 'קניית רכב', deposit: 0, target: '', targetDate: '', inFixed: 'לא', note: 'למלא את ההפקדה החודשית' }
  ],
  rules: [
    { priority: 5, merchant: 'זיו רונן', minAmount: 200, maxAmount: 260, category: 'מחוץ לחישוב - כבר בקבועות', note: 'תרופה לבונה, כלולה בקבועות' },
    { priority: 5, merchant: '^מ.א. מגידו', category: 'אוכל בחוץ ובילויים', note: 'הופעות במרכז התרבות' }
  ]
};

function fixOct2026() {
  var F = FIX_2026_10, log = [];

  Object.keys(F.budgets).forEach(function (name) {
    var r = updateRows_('categories', { name: name }, { budget: F.budgets[name] });
    log.push('תקציב ' + name + ': ' + F.budgets[name] + (r.updated ? '' : ' (לא נמצא!)'));
  });

  F.fixed.forEach(function (u) {
    var r = updateRows_('fixed', u.where, u.set);
    if (!r.updated && u.set.name) r = { updated: readSheet_('fixed').filter(function (x) { return String(x.name).trim() === u.set.name; }).length };
    log.push('קבועות ' + u.where.name + (r.updated ? ': עודכן' : ': לא נמצא!'));
  });

  F.pots.forEach(function (u) {
    var r = updateRows_('pots', u.where, u.set);
    log.push('קופה ' + u.where.name + (r.updated ? ': עודכן' : ': לא נמצא!'));
  });
  var potNames = readSheet_('pots').map(function (p) { return String(p.name).trim(); });
  var addPots = F.newPots.filter(function (p) { return potNames.indexOf(p.name) < 0; });
  if (addPots.length) appendRows_('pots', addPots);
  log.push('קופות חדשות: ' + (addPots.map(function (p) { return p.name; }).join(', ') || 'כבר קיימות'));

  var ruleKeys = readSheet_('rules').map(function (r) { return String(r.merchant).trim() + '|' + String(r.category).trim(); });
  var addRules = F.rules.filter(function (r) { return ruleKeys.indexOf(r.merchant + '|' + r.category) < 0; });
  if (addRules.length) appendRows_('rules', addRules);
  log.push('כללים חדשים: ' + addRules.length);

  // סיווג מחדש של עסקאות עבר לפי שני הכללים החדשים
  var sheet = ss_().getSheetByName('transactions');
  var keys = headerMap_(sheet, 'transactions');
  var catCol = keys.indexOf('category') + 1, moved = 0;
  readSheet_('transactions').forEach(function (t) {
    var m = String(t.merchant).trim(), a = Math.abs(Number(t.amount)), cat = null;
    if (m.indexOf('זיו רונן') >= 0 && a >= 200 && a <= 260) cat = 'מחוץ לחישוב - כבר בקבועות';
    else if (m.indexOf('מ.א. מגידו') === 0) cat = 'אוכל בחוץ ובילויים';
    if (cat && String(t.category).trim() !== cat) { sheet.getRange(t._row, catCol).setValue(cat); moved++; }
  });
  log.push('עסקאות שסווגו מחדש: ' + moved);

  // הסיכום מופיע ב"יומן ביצוע" בתחתית העורך
  Logger.log(log.join('\n'));
  return log;
}
