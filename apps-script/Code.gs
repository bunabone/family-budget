/**
 * תזרים משפחתי: הגיליון + API לאפליקציה.
 *
 * התקנה (פעם אחת):
 * 1. גיליון Google חדש ← תוספים ← Apps Script ← להדביק את כל הקובץ הזה ← שמירה.
 * 2. לבחור בפונקציה setup ולהריץ (לאשר הרשאות). נוצרות כל הלשוניות עם נתוני הפתיחה,
 *    וקוד סודי נכתב בלשונית settings.
 * 3. פריסה ← פריסה חדשה ← סוג: אפליקציית אינטרנט ← הפעלה בתור: אני ← גישה: כל אחד.
 *    את הכתובת שמתקבלת (מסתיימת ב-/exec) מזינים באפליקציה יחד עם הקוד הסודי.
 *
 * הקריאות מהאפליקציה הן POST עם Content-Type: text/plain (כך אין בקשת preflight של CORS).
 * גוף הבקשה: JSON עם key (הקוד הסודי) ו-action.
 */

// ---------- מבנה הלשוניות ----------

var SHEETS = {
  transactions: [
    ['id', 'id'], ['date', 'תאריך עסקה'], ['month', 'חודש חיוב'], ['card', 'כרטיס'], ['merchant', 'בית עסק'],
    ['amount', 'סכום חיוב'], ['type', 'סוג עסקה'], ['notes', 'הערות מקור'], ['category', 'קטגוריה'],
    ['pct', 'אחוז משפחתי'], ['familyAmount', 'סכום משפחתי'], ['source', 'מקור'], ['addedBy', 'נוסף ע"י'],
    ['addedAt', 'תאריך הוספה']
  ],
  categories: [
    ['name', 'שם'], ['type', 'סוג'], ['group', 'קבוצה'], ['budget', 'תקציב חודשי'],
    ['pct', 'אחוז משפחתי ברירת מחדל'], ['pot', 'קופה']
  ],
  fixed: [['group', 'קבוצה'], ['name', 'שם'], ['amount', 'סכום חודשי'], ['note', 'הערה']],
  income: [
    ['id', 'id'], ['kind', 'סוג'], ['month', 'חודש'], ['name', 'מקור'], ['amount', 'סכום'], ['note', 'הערה'],
    ['addedBy', 'נוסף ע"י'], ['addedAt', 'תאריך הוספה']
  ],
  rules: [
    ['priority', 'עדיפות'], ['merchant', 'בית עסק מכיל'], ['notes', 'הערות מכיל'], ['txType', 'סוג עסקה מכיל'],
    ['branch', 'ענף מכיל'], ['card', 'כרטיס'], ['foreign', 'חו"ל'], ['minAmount', 'סכום מ'], ['maxAmount', 'סכום עד'],
    ['category', 'קטגוריה'], ['pct', 'אחוז משפחתי'], ['ask', 'לשאול'], ['note', 'הערה']
  ],
  pots: [
    ['name', 'שם קופה'], ['deposit', 'הפקדה חודשית'], ['target', 'יעד'], ['targetDate', 'תאריך יעד'],
    ['inFixed', 'כלול בקבועות'], ['note', 'הערה']
  ],
  pot_moves: [
    ['id', 'id'], ['date', 'תאריך'], ['pot', 'קופה'], ['kind', 'סוג'], ['amount', 'סכום'], ['note', 'הערה'],
    ['addedBy', 'נוסף ע"י']
  ],
  settings: [['key', 'מפתח'], ['value', 'ערך'], ['note', 'הערה']]
};

// עמודות שנשמרות כטקסט (אחרת Google ממיר "2026-10" לתאריך)
var TEXT_KEYS = { id: 1, date: 1, month: 1, targetDate: 1, card: 1, value: 1, merchant: 1, notes: 1, name: 1, note: 1 };
var DATE_KEYS = { date: 1, addedAt: 1 };
var MONTH_KEYS = { month: 1, targetDate: 1 };
var WRITABLE = ['transactions', 'income', 'pot_moves', 'rules', 'categories', 'settings', 'pots', 'fixed'];

// ---------- נתוני פתיחה (מהאפיון) ----------

var V = 'משתנה', K = 'קבוע', OUT = 'מחוץ לחישוב', INC = 'הכנסה';
var SEED_CATEGORIES = [
  // שם, סוג, קבוצה, תקציב חודשי, אחוז משפחתי, קופה
  ['סופר ומזון לבית', V, 'בית', 2748, 100, ''],
  ['דלק', V, 'רכב', 944, 70, ''],
  ['אוכל בחוץ ובילויים', V, 'פנאי', 825, 100, ''],
  ['קניות: ביגוד, לבית ואונליין', V, 'בית', 715, 100, ''],
  ['בריאות המשפחה: מכבי, תרופות ושיניים', V, 'בריאות', 641, 100, ''],
  ['טיפוח ועיסויים', V, 'פנאי', 259, 100, ''],
  ['שונות: לוטו ותיקונים', V, 'שונות', 190, 100, ''],
  ['כביש 6 וחניה', V, 'רכב', 142, 70, ''],
  ['בונה: וטרינר וחריגים', V, 'בונה', 67, 100, ''],
  ['מחוץ לחישוב - כבר בקבועות', K, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - חוגים', K, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - מוסך', K, 'רכב', 0, 100, 'רכב'],
  ['מחוץ לחישוב - רישוי וטסט', K, 'רכב', 0, 100, 'רכב'],
  ['מחוץ לחישוב - בריכה', K, 'מחוץ לחישוב', 0, 100, 'בריכה'],
  ['מחוץ לחישוב - חו"ל', OUT, 'מחוץ לחישוב', 0, 100, 'חופשה'],
  ['מחוץ לחישוב - מזומן', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - בניית הבית בדפנה', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - עסקי', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - ביטוחים ישנים', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - תרומות', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['מחוץ לחישוב - אחר', OUT, 'מחוץ לחישוב', 0, 100, ''],
  ['הכנסה מעבודה', INC, 'הכנסות', 0, 100, ''],
  ['הכנסה אחרת', INC, 'הכנסות', 0, 100, '']
];

var SEED_FIXED = [
  ['דיור ברמות מנשה', 'שכר דירה', 3750, ''],
  ['דיור ברמות מנשה', 'מיסי קיבוץ', 367, ''],
  ['דיור ברמות מנשה', 'ועד', 71, ''],
  ['דיור ברמות מנשה', 'חשמל', 505, ''],
  ['דיור ברמות מנשה', 'מים וגז', 140.36, 'תשתיות רמות מנשה, משתנה לפי צריכה'],
  ['דיור ברמות מנשה', 'ארנונה', 302.5, 'מועצה אזורית מגידו, 600 לחודשיים'],
  ['הבית בקיבוץ דפנה', 'משכנתא', 4550, ''],
  ['הבית בקיבוץ דפנה', 'AIG ביטוח חיים למשכנתא', 71, ''],
  ['הבית בקיבוץ דפנה', 'ביטוח מבנה', 118, ''],
  ['הבית בקיבוץ דפנה', 'מיסי קיבוץ דפנה כולל ביטוח בריאות', 675, ''],
  ['הבית בקיבוץ דפנה', 'מס על השכירות', 700, '10% על 7,000. אם גם רמת גן חייבת: כ-910'],
  ['ילדים', 'חינוך בלתי פורמלי (גן גוני + תלתון אלה)', 4415, ''],
  ['ילדים', 'אנגלית גוני', 400, ''],
  ['ילדים', 'תוכנית מצטיינים אלה', 133.33, '1,600 לשנה, 10 תשלומים'],
  ['ילדים', 'הסעות למצטיינים', 60, 'הערכה, לעדכן'],
  ['ילדים', 'מחול אלה', 166.67, '2,000 לשנה, 10 תשלומים'],
  ['ילדים', 'תשלומי הורים בית ספר', 103.17, '1,238 לשנה'],
  ['ילדים', 'חיסכון לבנות', 200, ''],
  ['פנסיה', 'פנסיות עופר ושגית', 2200, 'חובה כחברי קיבוץ'],
  ['ביטוחים', 'AIG מחלות קשות', 211, ''],
  ['ביטוחים', 'מנורה ביטוח חיים עופר ושגית', 139, ''],
  ['ביטוחים', 'הראל סיעודי עופר', 49, ''],
  ['רכב', 'ביטוח חובה', 102.58, '1,231 לשנה, 8-10 תשלומים'],
  ['רכב', 'ביטוח מקיף', 204.83, '2,458 לשנה, עד 4 תשלומים'],
  ['רכב', 'רישוי וטסט', 150, '1,800 לשנה, לקופת רכב'],
  ['רכב', 'מוסך ותחזוקה', 377, 'ממוצע 4,500 לשנה, לקופת רכב'],
  ['בריכה בקיץ', 'מנוי בריכה', 166.67, '2,000 לשנה, לקופת בריכה'],
  ['תקשורת ומנויים', 'אלוהה (עופר)', 50, ''],
  ['תקשורת ומנויים', '019 (שגית)', 25.9, ''],
  ['תקשורת ומנויים', 'Adobe', 88, ''],
  ['תקשורת ומנויים', 'iCloud', 3.9, ''],
  ['תקשורת ומנויים', 'מנוי פיס', 60, ''],
  ['בונה', 'מזון ותרופות', 210, '630 לשלושה חודשים']
];

var SEED_INCOME = [
  ['I-dafna', 'קבועה', '', 'שכירות הבית בדפנה', 7000, ''],
  ['I-ramatgan', 'קבועה', '', 'שכירות רמת גן', 2100, ''],
  ['I-kids', 'קבועה', '', 'קצבת ילדים', 276, '']
];

var SEED_POTS = [
  ['רכב', 527, 1800, '', 'כן', 'רישוי, טסט ומוסך. למלא בתאריך יעד את חודש הטסט'],
  ['בריכה', 166.67, 2000, '2027-06', 'כן', 'מנוי בריכה לקיץ'],
  ['בלתי צפוי', '', '', '', 'לא', 'ריק = לפי unexpected_pct בהגדרות. אפשר גם מספר או למשל 3%'],
  ['חופשה', 1250, 15000, '', 'לא', '15,000 לשנה. למלא תאריך יעד']
];

var SEED_SETTINGS = [
  ['unexpected_pct', 3, 'אחוז מעלות החיים שמופרש לקופת בלתי צפוי'],
  ['weak_months', '', 'חודשים חלשים (מופרדים בפסיק), בהם לא מפקידים לחופשה ולבלתי צפוי'],
  ['cards', '3498=MAX עופר;8997=MAX שגית;1656=כאל שופרסל', '4 ספרות = שם הכרטיס'],
  ['users', 'עופר,שגית', ''],
  ['extra_savings', 0, 'חיסכון חודשי נוסף שנכלל ב"כולל חיסכון" (למשל קרן השתלמות, יעד 3,400)']
];

// כללי סיווג. הסדר קובע: הכלל הראשון שמתאים מנצח (לפי עדיפות, מספר קטן קודם).
// ^ בתחילת מילה = "מתחיל ב". עמודות: בית עסק, הערות, סוג עסקה, ענף, כרטיס, חו"ל, סכום מ, סכום עד, קטגוריה, אחוז, לשאול, הערה
var C_SUPER = 'סופר ומזון לבית', C_FUEL = 'דלק', C_FOOD = 'אוכל בחוץ ובילויים', C_SHOP = 'קניות: ביגוד, לבית ואונליין',
  C_HEALTH = 'בריאות המשפחה: מכבי, תרופות ושיניים', C_CARE = 'טיפוח ועיסויים', C_MISC = 'שונות: לוטו ותיקונים',
  C_ROAD = 'כביש 6 וחניה', C_VET = 'בונה: וטרינר וחריגים', C_FIXED = 'מחוץ לחישוב - כבר בקבועות',
  C_CLASSES = 'מחוץ לחישוב - חוגים', C_GARAGE = 'מחוץ לחישוב - מוסך', C_LICENSE = 'מחוץ לחישוב - רישוי וטסט',
  C_ABROAD = 'מחוץ לחישוב - חו"ל', C_CASH = 'מחוץ לחישוב - מזומן', C_DAFNA = 'מחוץ לחישוב - בניית הבית בדפנה',
  C_BIZ = 'מחוץ לחישוב - עסקי', C_OLDINS = 'מחוץ לחישוב - ביטוחים ישנים', C_DONATE = 'מחוץ לחישוב - תרומות',
  C_OTHER = 'מחוץ לחישוב - אחר';

function m_(kw, cat, extra) {
  extra = extra || {};
  return [kw, extra.notes || '', extra.txType || '', extra.branch || '', extra.card || '', extra.foreign || '',
    extra.min === undefined ? '' : extra.min, extra.max === undefined ? '' : extra.max, cat,
    extra.pct === undefined ? '' : extra.pct, extra.ask || '', extra.note || ''];
}
function many_(kws, cat, extra) { return kws.map(function (k) { return m_(k, cat, extra); }); }

function seedRules_() {
  var r = [];
  function add(rows) { r = r.concat(rows); }
  // מזומן
  add([m_('', C_CASH, { txType: 'משיכת מזומן', note: 'בעתיד: לשאול לאן הלך המזומן' })]);
  add(many_(['כספומט', 'ATM'], C_CASH));
  add([m_('הכל לים', C_DAFNA, { note: 'היסטורי' })]);
  // ביט ופייבוקס: לפי ההערות. תמיד מוצגות לאישור.
  add([m_('', C_CLASSES, { notes: 'שחייה' })]);
  add([m_('', C_CARE, { notes: 'עבור: לק' }), m_('', C_CARE, { notes: 'עבור: חק' })]);
  add([m_('', C_CARE, { notes: 'קורנבלום', min: 300, max: 400 })]);
  add(['מזל טוב', 'מתנה', 'יומולדת', 'יום הולדת'].map(function (k) { return m_('', C_MISC, { notes: k }); }));
  add([m_('', C_FIXED, { notes: 'ניצן מירון', note: 'חשמל שמועבר דרך ניצן מירון' })]);
  add([m_('BIT', C_FOOD, { ask: 'כן', note: 'ברירת מחדל לביט' }), m_('PAYBOX', C_FOOD, { ask: 'כן', note: 'ברירת מחדל לפייבוקס' })]);
  // מזון לבונה (כבר בקבועות). לפני "הראל".
  add(many_(['הכל לכלב', 'ALL4SHOP'], C_FIXED, { note: 'מזון בונה, קבוע' }));
  // חו"ל לפני כללי הביטוח
  add(many_(['נסיעות לחו', 'נסיעות חו', 'איסתא', 'TRANSAVIA', 'שובר באתר המועדון', 'ארקיע', 'נתב"ג', 'נתבג', 'טרמינל',
    'רשות האוכלוסין'], C_ABROAD));
  // ביטוח ישן בכרטיס של שגית
  add([m_('מגדל חיים', C_OLDINS, { card: 'שגית', note: 'ראו נקודות פתוחות באפיון' })]);
  // כבר בקבועות
  add(many_(['מנורה', 'AIG ביטוח', 'מגדל רכב חובה', 'מגדל ר. חובה', 'מגדל בטוח כללי', 'מגדל חיים', 'אלוהה', 'טלזר 019',
    'APPLE.COM', 'ADOBE', 'פיס מנויים', 'הראל', 'ביס עומרים', 'חברת החשמל', 'תושבי רמות מנשה', 'תשתיות רמות מנשה',
    'מועצה אזורית מגידו', 'מ.א. מגידו', 'התעמלות'], C_FIXED));
  add(many_(['משרד התחבורה', 'מכון רישוי'], C_LICENSE));
  // עסקי
  add(many_(['GOOGLE', 'B&H', 'KLING', 'PERPLEXITY', 'MIDJOURNEY'], C_BIZ, { note: 'הוצאה עסקית של עופר' }));
  // תרומות
  add(many_(['עיגול', 'הקרן לעזרה הדדית'], C_DONATE));
  // כבר לא רלוונטי
  add(many_(['מועצה אזורית הגליל העליון', 'רמי לוי שיווק השקמה'], C_OTHER, { note: 'כבר לא רלוונטי' }));
  // קניות אונליין מחו"ל (לפני כלל חו"ל הכללי)
  add(many_(['ALIEXPRESS', 'ALIPAY', 'NEXT'], C_SHOP));
  add([m_('', C_ABROAD, { foreign: 'כן', note: 'עסקאות בחו"ל שלא זוהו אחרת' })]);
  // סופר (לפני דלק בגלל "סופר אלונית")
  add(many_(['שופרסל', 'ויקטורי', 'מרכול', 'אלמשהדאוי', 'קניונית', 'סטופמרקט', 'CARREFOUR', 'אושר עד', 'בית טבע', 'קואופ',
    'מינימרקט', 'אלונית', 'מאפיות', 'מאפיית', 'כל בו', 'מכולת', 'רמי לוי', 'יוחננוף', 'טיב טעם', 'חצי חינם', 'פיצוציית',
    'קיוסק', '^גולדה', 'בייקרי', 'קינוחים', 'גלידה', 'ממתקי', 'מאכלים'], C_SUPER));
  // דלק, 70% משפחתי
  add(many_(['^פז', 'סונול', 'דלק מנטה', 'תחנת דלק', 'תחנות דלק', '^אלון', 'מחלף החורשים'], C_FUEL));
  // כביש 6 וחניה, 70% משפחתי
  add(many_(['כביש 6', 'פנגו', 'חניון', 'אחוזת החוף', 'אחוזות החוף', 'מנהרות הכרמל', 'קנסות חנייה', 'חניה', 'חנייה',
    'רכבת ישראל'], C_ROAD));
  // מוסך: נמשך מקופת רכב
  add(many_(['מוסך', 'אוטו רם', 'שטיפת', 'ספרינט'], C_GARAGE));
  // אוכל בחוץ ובילויים
  add([m_('', C_FOOD, { branch: 'מסעדות' })]);
  add(many_(['גקו קיר', 'TICKETS', 'עידן 2000', 'איוונטים', 'קסטיליה', 'סינמה', 'מסעדה', 'שווארמה', 'ארומה', 'מקדונלד',
    'מקדונלס', 'פיצה', 'חומוס', 'פלאפל', 'בורגר', 'סושי', 'לנדוור', 'רולדין', 'קפה', 'פאב', 'גונס', 'ג\'אפן', 'JAPANIKA',
    'דומינוס', 'אאוט בק', 'פלפלת', 'יאנק', '^גרג', 'פיתה', 'מסעדות', 'קייטרינג', 'פונדק'], C_FOOD));
  // בריאות
  add(many_(['קרן מכבי', 'מכבי פארם', 'מכבידנט', 'סופר פארם', 'דראגסטורס', 'EFIL', 'PHARM'], C_HEALTH));
  add([m_('', C_HEALTH, { branch: 'רפואה' })]);
  // קניות
  add(many_(['מקס סטוק', 'איקאה', 'אייס', 'זול סטוק', 'ימיניס', 'הכל לבניין', 'סטוק', 'קסטרו', 'אליטל', 'דקאתלון', 'המכס',
    'סטימצקי', 'טופ טן', 'ביגוד', 'קרביץ', 'פאשן', 'חומרי בניין', 'דוקטור דיו'], C_SHOP));
  add([m_('', C_SHOP, { branch: 'אופנה' })]);
  // בונה
  add([m_('וטרינר', C_VET)]);
  // שונות
  add(many_(['פיס'], C_MISC, { note: 'הטבות פיס, מפעל הפיס, פיס פלוס' }));
  // סופר לפי ענף (כאל: "מזון וצריכה"), ומילים כלליות בסוף (אחרי "סופר פארם")
  add([m_('', C_SUPER, { branch: 'מזון וצריכה' })]);
  add(many_(['סופר', 'מרקט'], C_SUPER));
  return r.map(function (row, i) { return [(i + 1) * 10].concat(row); });
}

// ---------- עזרים לגיליון ----------

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tz_() {
  try { return ss_().getSpreadsheetTimeZone() || 'Asia/Jerusalem'; } catch (e) { return 'Asia/Jerusalem'; }
}

function keysFor_(name) { return SHEETS[name].map(function (c) { return c[0]; }); }

// מיפוי כותרת ← מפתח, לפי הכותרות שבגיליון בפועל (אפשר להזיז עמודות)
function headerMap_(sheet, name) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var byHeader = {};
  SHEETS[name].forEach(function (c) { byHeader[c[1]] = c[0]; byHeader[c[0]] = c[0]; });
  return headers.map(function (h) { h = String(h).trim(); return byHeader[h] || h; });
}

function toOut_(key, v) {
  if (v instanceof Date) {
    if (MONTH_KEYS[key]) return Utilities.formatDate(v, tz_(), 'yyyy-MM');
    if (DATE_KEYS[key]) return Utilities.formatDate(v, tz_(), key === 'addedAt' ? "yyyy-MM-dd'T'HH:mm" : 'yyyy-MM-dd');
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  }
  return v;
}

function toCell_(key, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' && TEXT_KEYS[key] && v !== '' && !/^[=+]/.test(v)) return "'" + v;
  if (typeof v === 'string' && /^[=+]/.test(v)) return "'" + v; // לא לתת לטקסט להפוך לנוסחה
  return v;
}

function readSheet_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var keys = headerMap_(sheet, name);
  var values = sheet.getRange(2, 1, lastRow - 1, keys.length).getValues();
  var out = [];
  values.forEach(function (row, i) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    var o = { _row: i + 2 };
    keys.forEach(function (k, j) { if (k) o[k] = toOut_(k, row[j]); });
    out.push(o);
  });
  return out;
}

function ensureRows_(sheet, needed) {
  var max = sheet.getMaxRows();
  if (needed > max) sheet.insertRowsAfter(max, needed - max + 50);
}

function appendRows_(name, rows) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('חסרה לשונית ' + name + '. להריץ setup.');
  var keys = headerMap_(sheet, name);
  var hasId = keys.indexOf('id') >= 0;
  var existing = {};
  if (hasId) readSheet_(name).forEach(function (r) { existing[String(r.id)] = 1; });
  var now = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm");
  var toWrite = [], skipped = 0;
  rows.forEach(function (r) {
    r = Object.assign({}, r);
    if (hasId) {
      if (!r.id) r.id = name.charAt(0).toUpperCase() + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      if (existing[String(r.id)]) { skipped++; return; }
      existing[String(r.id)] = 1;
    }
    if (keys.indexOf('addedAt') >= 0 && !r.addedAt) r.addedAt = now;
    toWrite.push(r);
  });
  if (toWrite.length) {
    var start = sheet.getLastRow() + 1;
    ensureRows_(sheet, start + toWrite.length - 1);
    var values = toWrite.map(function (r) { return keys.map(function (k) { return toCell_(k, r[k]); }); });
    sheet.getRange(start, 1, values.length, keys.length).setValues(values);
    var fa = keys.indexOf('familyAmount'), am = keys.indexOf('amount'), pc = keys.indexOf('pct');
    if (name === 'transactions' && fa >= 0 && am >= 0 && pc >= 0) {
      // סכום משפחתי כנוסחה, כדי ששינוי ידני של האחוז בגיליון יתעדכן
      var f = '=IF(R[0]C[' + (pc - fa) + ']="",R[0]C[' + (am - fa) + '],R[0]C[' + (am - fa) + ']*IF(R[0]C[' + (pc - fa) + ']<=1,R[0]C[' + (pc - fa) + ']*100,R[0]C[' + (pc - fa) + '])/100)';
      var formulas = toWrite.map(function () { return [f]; });
      sheet.getRange(start, fa + 1, formulas.length, 1).setFormulasR1C1(formulas);
    }
  }
  return { added: toWrite.length, skipped: skipped };
}

function matches_(row, where) {
  return Object.keys(where).every(function (k) { return String(row[k]).trim() === String(where[k]).trim(); });
}

function updateRows_(name, where, set, upsert) {
  if (name === 'settings' && (where.key === 'secret' || set.key === 'secret')) throw new Error('אי אפשר לשנות את הקוד הסודי מהאפליקציה');
  var sheet = ss_().getSheetByName(name);
  var keys = headerMap_(sheet, name);
  var rows = readSheet_(name).filter(function (r) { return matches_(r, where); });
  if (!rows.length) {
    if (upsert) return appendRows_(name, [Object.assign({}, where, set)]);
    return { updated: 0 };
  }
  rows.forEach(function (r) {
    Object.keys(set).forEach(function (k) {
      var c = keys.indexOf(k);
      if (c >= 0 && k !== 'familyAmount') sheet.getRange(r._row, c + 1).setValue(toCell_(k, set[k]));
    });
  });
  return { updated: rows.length };
}

function deleteRows_(name, where) {
  if (name === 'settings' && where.key === 'secret') throw new Error('אי אפשר למחוק את הקוד הסודי');
  if (!Object.keys(where).length) throw new Error('חסר תנאי מחיקה');
  var sheet = ss_().getSheetByName(name);
  var rows = readSheet_(name).filter(function (r) { return matches_(r, where); });
  rows.sort(function (a, b) { return b._row - a._row; }).forEach(function (r) { sheet.deleteRow(r._row); });
  return { deleted: rows.length };
}

function getSecret_() {
  var s = readSheet_('settings').filter(function (r) { return String(r.key).trim() === 'secret'; })[0];
  return s ? String(s.value).trim() : '';
}

function stripRow_(rows) { return rows.map(function (r) { delete r._row; return r; }); }

function getAll_() {
  return {
    transactions: stripRow_(readSheet_('transactions')),
    categories: stripRow_(readSheet_('categories')),
    fixed: stripRow_(readSheet_('fixed')),
    income: stripRow_(readSheet_('income')),
    rules: stripRow_(readSheet_('rules')),
    pots: stripRow_(readSheet_('pots')),
    potMoves: stripRow_(readSheet_('pot_moves')),
    settings: stripRow_(readSheet_('settings')).filter(function (r) { return String(r.key).trim() !== 'secret'; })
  };
}

function checkSheet_(name) {
  if (WRITABLE.indexOf(name) < 0) throw new Error('לשונית לא מוכרת: ' + name);
}

function runOp_(op) {
  checkSheet_(op.sheet);
  if (op.op === 'append') return appendRows_(op.sheet, op.rows || []);
  if (op.op === 'update') return updateRows_(op.sheet, op.where || {}, op.set || {}, !!op.upsert);
  if (op.op === 'delete') return deleteRows_(op.sheet, op.where || {});
  throw new Error('פעולה לא מוכרת: ' + op.op);
}

// ---------- Web App ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, message: 'תזרים משפחתי: ה-API פעיל. האפליקציה שולחת בקשות POST.' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var secret = getSecret_();
    if (!secret || String(body.key || '').trim() !== secret) return json_({ ok: false, error: 'קוד סודי שגוי', code: 'auth' });
    var action = body.action;
    if (action === 'ping') return json_({ ok: true });
    if (action === 'getAll') return json_({ ok: true, data: getAll_(), spreadsheetUrl: ss_().getUrl(), serverTime: new Date().toISOString() });
    var ops;
    if (action === 'batch') ops = body.ops || [];
    else if (action === 'append' || action === 'update' || action === 'delete') ops = [Object.assign({ op: action }, body)];
    else return json_({ ok: false, error: 'פעולה לא מוכרת' });
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var results = ops.map(runOp_);
      return json_({ ok: true, results: results });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------- התקנה ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('תזרים').addItem('הגדרה ראשונית / השלמת לשוניות', 'setup').addItem('הצג קוד סודי', 'showSecret').addToUi();
}

function rowsFromArrays_(name, arrays) {
  var keys = keysFor_(name);
  return arrays.map(function (a) { var o = {}; keys.forEach(function (k, i) { if (i < a.length) o[k] = a[i]; }); return o; });
}

function setup() {
  var ss = ss_();
  try { ss.setSpreadsheetTimeZone('Asia/Jerusalem'); } catch (e) { /* לא קריטי */ }
  var seeds = {
    categories: SEED_CATEGORIES,
    fixed: SEED_FIXED,
    income: SEED_INCOME,
    rules: seedRules_(),
    pots: SEED_POTS,
    settings: SEED_SETTINGS
  };
  var created = [];
  Object.keys(SHEETS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) { sheet = ss.insertSheet(name); created.push(name); }
    if (sheet.getLastRow() === 0) {
      var headers = SHEETS[name].map(function (c) { return c[1]; });
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8f0fe');
      sheet.setFrozenRows(1);
      try { sheet.setRightToLeft(true); } catch (e) { /* לא קריטי */ }
      if (seeds[name]) appendRows_(name, rowsFromArrays_(name, seeds[name]));
    }
  });
  if (!getSecret_()) {
    var secret = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    appendRows_('settings', [{ key: 'secret', value: secret, note: 'קוד סודי לאפליקציה. מזינים פעם אחת בכל טלפון' }]);
  }
  // מחיקת הלשונית הריקה שנוצרת עם גיליון חדש
  ss.getSheets().forEach(function (s) {
    if (!SHEETS[s.getName()] && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  Logger.log('נוצרו: ' + created.join(', ') + '. קוד סודי: ' + getSecret_());
  showSecret();
}

function showSecret() {
  var msg = 'הקוד הסודי לאפליקציה: ' + getSecret_() + '\n\nהשלב הבא: פריסה ← פריסה חדשה ← אפליקציית אינטרנט ← גישה: כל אחד.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}
