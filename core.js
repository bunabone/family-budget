/*
 * לוגיקה משותפת: קריאת קובצי אשראי (MAX, כאל, קובץ היסטוריה מסווג),
 * סיווג לפי כללים, וחישובי החודש והקופות.
 * רץ גם בדפדפן (window.Core) וגם ב-Node (לבדיקות).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- עזרים ----------

  function str(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }

  // רווחים אחידים, בלי ירידות שורה, אותיות לטיניות קטנות
  function norm(v) {
    return str(v).replace(/[\s ‎‏]+/g, ' ').trim().toLowerCase();
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function round2(n) { return Math.round(n * 100) / 100; }

  function parseAmount(v) {
    if (typeof v === 'number') return v;
    var s = str(v).replace(/[‎‏\s₪,]/g, '').replace(/ש"ח|ש״ח|NIS|ILS/gi, '');
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
    var n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }

  // מחזיר YYYY-MM-DD או ''
  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) {
      // מעגלים לחצות הקרובה (תאריכים מאקסל לפעמים יוצאים 23:59 של היום הקודם)
      var d = v.getHours() >= 12 ? new Date(v.getTime() + 12 * 3600 * 1000) : v;
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var u = new Date(Math.round((v - 25569) * 86400000));
      return u.getUTCFullYear() + '-' + pad2(u.getUTCMonth() + 1) + '-' + pad2(u.getUTCDate());
    }
    var s = str(v).trim();
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
    m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      var y = +m[3];
      if (y < 100) y += 2000;
      var mo = +m[2], da = +m[1];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return '';
      return y + '-' + pad2(mo) + '-' + pad2(da);
    }
    return '';
  }

  function monthOf(dateStr) { return dateStr ? dateStr.slice(0, 7) : ''; }

  function addMonths(month, n) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }

  function monthDiff(from, to) {
    return (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  }

  function currentMonth(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function today(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  var HEB_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  function monthLabel(month) {
    if (!month) return '';
    return HEB_MONTHS[+month.slice(5, 7) - 1] + ' ' + month.slice(0, 4);
  }

  function fnv1a(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function rowText(row) {
    return (row || []).map(str).join(' ');
  }

  // מוצא שורת כותרות: שורה שיש בה "תאריך עסקה" וגם "בית עסק"
  function findHeaderRow(rows, from) {
    for (var i = from || 0; i < rows.length; i++) {
      var cells = (rows[i] || []).map(norm);
      var hasDate = cells.some(function (c) { return c.indexOf('תאריך עסקה') >= 0; });
      var hasMerchant = cells.some(function (c) { return c.indexOf('בית עסק') >= 0 || c.indexOf('בית העסק') >= 0; });
      if (hasDate && hasMerchant) return i;
    }
    return -1;
  }

  // מיפוי עמודות לפי שם כותרת. names: { key: [אפשרויות...] }
  function mapColumns(headerRow, names) {
    var cells = (headerRow || []).map(norm);
    var map = {};
    Object.keys(names).forEach(function (key) {
      var opts = names[key];
      // קודם התאמה מדויקת, אחר כך "מכיל"
      for (var pass = 0; pass < 2 && map[key] === undefined; pass++) {
        for (var i = 0; i < cells.length; i++) {
          for (var j = 0; j < opts.length; j++) {
            var o = norm(opts[j]);
            if ((pass === 0 && cells[i] === o) || (pass === 1 && cells[i].indexOf(o) >= 0)) {
              if (map[key] === undefined) map[key] = i;
            }
          }
        }
      }
    });
    return map;
  }

  function cell(row, idx) { return idx === undefined ? '' : (row || [])[idx]; }

  function findDigits(text) {
    var m = str(text).match(/(?:^|\D)(\d{4})(?:\D|$)/);
    return m ? m[1] : '';
  }

  function cardLabel(digits, cardsSetting, fallback) {
    // "3498=MAX עופר;8997=MAX שגית;1656=כאל שופרסל"
    var parts = str(cardsSetting).split(/[;\n]/);
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv.length >= 2 && kv[0].trim() === digits) return kv.slice(1).join('=').trim();
    }
    return fallback || (digits ? 'כרטיס ' + digits : 'כרטיס לא מזוהה');
  }

  var ILS_RE = /^(₪|ש"ח|ש״ח|שח|ils|nis|)$/i;

  // ---------- זיהוי פורמט ----------

  // sheets: [{ name, rows: [[...], ...] }]
  function detectFormat(sheets) {
    for (var i = 0; i < sheets.length; i++) {
      var first = (sheets[i].rows[0] || []).map(norm);
      if (first.indexOf('כרטיס') >= 0 && first.indexOf('חודש חיוב') >= 0 && first.indexOf('קטגוריה') >= 0) return 'history';
    }
    for (i = 0; i < sheets.length; i++) {
      var rows = sheets[i].rows;
      var h = findHeaderRow(rows);
      if (h < 0) continue;
      var cells = rows[h].map(norm);
      if (cells.some(function (c) { return c === 'תאריך חיוב'; }) || cells.some(function (c) { return c === 'שם בית העסק'; })) return 'max';
      return 'cal';
    }
    return 'unknown';
  }

  // ---------- MAX ----------

  var MAX_COLS = {
    date: ['תאריך עסקה'],
    merchant: ['שם בית העסק', 'שם בית עסק'],
    branch: ['קטגוריה'],
    last4: ['4 ספרות אחרונות של כרטיס האשראי', '4 ספרות אחרונות'],
    type: ['סוג עסקה'],
    amount: ['סכום חיוב'],
    chargeCur: ['מטבע חיוב'],
    origAmount: ['סכום עסקה מקורי'],
    origCur: ['מטבע עסקה מקורי'],
    chargeDate: ['תאריך חיוב'],
    notes: ['הערות'],
    rate: ['שער המרה']
  };

  function parseMax(sheets, opts) {
    opts = opts || {};
    var out = { format: 'max', txs: [], warnings: [], skippedSheets: [] };
    sheets.forEach(function (sh) {
      var name = str(sh.name);
      if (/טרם נקלטו/.test(name)) { out.skippedSheets.push(name); return; }
      var rows = sh.rows;
      var h = findHeaderRow(rows);
      if (h < 0) return;
      var foreign = /חו"ל|חו״ל|חול|מט"ח|מט״ח/.test(name);
      var headDigits = '', headMonth = '';
      for (var r = 0; r < h; r++) {
        var t = rowText(rows[r]);
        if (!headDigits) headDigits = findDigits(t.replace(/\d{1,2}[\/\-.]\d{4}/g, ''));
        var mm = t.match(/(\d{1,2})[\/\-.](\d{4})/);
        if (mm && !headMonth) headMonth = mm[2] + '-' + pad2(+mm[1]);
      }
      var c = mapColumns(rows[h], MAX_COLS);
      for (r = h + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var firstCell = norm(row[0]);
        if (firstCell.indexOf('סך') === 0) continue;
        var merchant = str(cell(row, c.merchant)).trim();
        var date = parseDate(cell(row, c.date));
        if (!merchant || !date) continue;
        var amount = parseAmount(cell(row, c.amount));
        if (isNaN(amount) || amount === 0) continue;
        var notes = str(cell(row, c.notes)).trim();
        var cur = str(cell(row, c.chargeCur)).trim();
        if (cur && !ILS_RE.test(cur)) {
          var rate = parseAmount(cell(row, c.rate));
          if (rate > 0) {
            amount = round2(amount * rate);
            notes = (notes ? notes + ' | ' : '') + 'הומר מ-' + cur;
          } else {
            out.warnings.push('עסקה במטבע ' + cur + ' בלי שער המרה: ' + merchant);
          }
        }
        var chargeDate = parseDate(cell(row, c.chargeDate));
        var digits = findDigits(cell(row, c.last4)) || headDigits;
        var origCur = str(cell(row, c.origCur)).trim();
        out.txs.push({
          date: date,
          month: monthOf(chargeDate) || headMonth,
          chargeDate: chargeDate,
          cardDigits: digits,
          card: cardLabel(digits, opts.cards, digits ? 'MAX ' + digits : 'MAX'),
          merchant: merchant,
          amount: round2(amount),
          type: str(cell(row, c.type)).trim(),
          branch: str(cell(row, c.branch)).trim(),
          notes: notes,
          foreign: foreign || (!!origCur && !ILS_RE.test(origCur)),
          sheet: name
        });
      }
    });
    return finish(out);
  }

  // ---------- כאל ----------

  var CAL_COLS = {
    date: ['תאריך עסקה', 'תאריך'],
    merchant: ['שם בית עסק', 'שם בית העסק'],
    txAmount: ['סכום עסקה'],
    amount: ['סכום חיוב'],
    type: ['סוג עסקה'],
    branch: ['ענף'],
    notes: ['הערות']
  };

  function parseCal(sheets, opts) {
    opts = opts || {};
    var out = { format: 'cal', txs: [], warnings: [], skippedSheets: [] };
    sheets.forEach(function (sh) {
      var rows = sh.rows;
      if (findHeaderRow(rows) < 0) return;
      var digits = '';
      for (var r0 = 0; r0 < Math.min(rows.length, 5) && !digits; r0++) {
        var t0 = rowText(rows[r0]);
        if (/לחיוב|תאריך/.test(t0)) continue;
        digits = findDigits(t0);
      }
      var label = cardLabel(digits, opts.cards, digits ? 'כאל ' + digits : 'כאל');
      var c = null, month = '', chargeDate = '', immediate = false;
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r] || [];
        var text = rowText(row);
        var ntext = norm(text);
        var mm = text.match(/לחיוב\s*ב[-\s]*(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
        if (mm) {
          var y = +mm[3]; if (y < 100) y += 2000;
          month = y + '-' + pad2(+mm[2]);
          chargeDate = y + '-' + pad2(+mm[2]) + '-' + pad2(+mm[1]);
          immediate = false;
          continue;
        }
        if (findHeaderRow([row]) === 0) { c = mapColumns(row, CAL_COLS); continue; }
        if (ntext.indexOf('בחיוב מיידי') >= 0 && !parseDate(row[c ? c.date : 0])) { immediate = true; continue; }
        if (!c) continue;
        var merchant = str(cell(row, c.merchant)).trim();
        var date = parseDate(cell(row, c.date));
        if (!merchant || !date) continue;
        var amount = parseAmount(cell(row, c.amount));
        if (isNaN(amount)) amount = parseAmount(cell(row, c.txAmount));
        if (isNaN(amount) || amount === 0) continue;
        if (/דמי כרטיס/.test(merchant) && amount === 0) continue;
        out.txs.push({
          date: date,
          month: immediate ? monthOf(date) : month,
          chargeDate: immediate ? date : chargeDate,
          cardDigits: digits,
          card: label,
          merchant: merchant,
          amount: round2(amount),
          type: str(cell(row, c.type)).trim() || (immediate ? 'חיוב מיידי' : ''),
          branch: str(cell(row, c.branch)).trim(),
          notes: str(cell(row, c.notes)).replace(/\s+/g, ' ').trim(),
          foreign: false,
          sheet: str(sh.name)
        });
      }
    });
    if (out.txs.some(function (t) { return !t.month; })) out.warnings.push('לא נמצא חודש חיוב לחלק מהעסקאות');
    return finish(out);
  }

  // ---------- קובץ היסטוריה מסווג (הוצאות_אשראי_מסווג.xlsx) ----------

  // שמות הקטגוריות בקובץ ההיסטוריה ← שמות הקטגוריות באפליקציה
  var HISTORY_CATEGORY_MAP = {
    'בונה - וטרינר וחריגים': 'בונה: וטרינר וחריגים',
    'מחוץ לחישוב - מזומן (דפנה / יורו לחו"ל)': 'מחוץ לחישוב - מזומן',
    'מחוץ לחישוב - חו"ל (עובר לחיסכון שנתי)': 'מחוץ לחישוב - חו"ל',
    'מחוץ לחישוב - חוגים (עכשיו בקבועות)': 'מחוץ לחישוב - חוגים',
    'מחוץ לחישוב - שחייה אלה (בקבועות)': 'מחוץ לחישוב - חוגים',
    'מחוץ לחישוב - מוסך (בקבועות תחת רכב)': 'מחוץ לחישוב - מוסך',
    'מחוץ לחישוב - מים, גז ובריכה (בקבועות)': 'מחוץ לחישוב - כבר בקבועות',
    'מחוץ לחישוב - חשמל שהועבר דרך ניצן מירון': 'מחוץ לחישוב - כבר בקבועות',
    'מחוץ לחישוב - מזון לבונה (בקבועות)': 'מחוץ לחישוב - כבר בקבועות',
    'מחוץ לחישוב - כבר לא רלוונטי': 'מחוץ לחישוב - אחר',
    'מחוץ לחישוב - חד פעמי': 'מחוץ לחישוב - אחר',
    'מחוץ לחישוב - דירה ברמת גן (חד פעמי)': 'מחוץ לחישוב - אחר'
  };

  function parseHistory(sheets, opts) {
    var out = { format: 'history', txs: [], warnings: [], skippedSheets: [] };
    var sh = sheets.filter(function (s) {
      var f = (s.rows[0] || []).map(norm);
      return f.indexOf('כרטיס') >= 0 && f.indexOf('חודש חיוב') >= 0;
    })[0];
    if (!sh) return finish(out);
    var c = mapColumns(sh.rows[0], {
      card: ['כרטיס'], month: ['חודש חיוב'], date: ['תאריך עסקה'], merchant: ['בית עסק'],
      amount: ['סכום חיוב'], type: ['סוג'], category: ['קטגוריה'], notes: ['הערות']
    });
    for (var r = 1; r < sh.rows.length; r++) {
      var row = sh.rows[r] || [];
      var merchant = str(cell(row, c.merchant)).trim();
      var date = parseDate(cell(row, c.date));
      var amount = parseAmount(cell(row, c.amount));
      if (!merchant || !date || isNaN(amount) || amount === 0) continue;
      var cat = str(cell(row, c.category)).trim();
      var m = cell(row, c.month);
      out.txs.push({
        date: date,
        month: m instanceof Date || typeof m === 'number' ? monthOf(parseDate(m)) : str(m).trim().slice(0, 7),
        chargeDate: '',
        cardDigits: '',
        card: str(cell(row, c.card)).trim(),
        merchant: merchant,
        amount: round2(amount),
        type: str(cell(row, c.type)).trim(),
        branch: '',
        notes: str(cell(row, c.notes)).trim(),
        foreign: false,
        presetCategory: HISTORY_CATEGORY_MAP[cat] || cat,
        sheet: sh.name
      });
    }
    return finish(out);
  }

  // מזהה ייחודי: כרטיס + תאריך עסקה + בית עסק + סכום + חודש חיוב.
  // עסקאות זהות לגמרי באותו קובץ מקבלות מספר סידורי כדי שלא ייבלעו.
  function txKey(t) {
    return [norm(t.card), t.date, norm(t.merchant), Number(t.amount).toFixed(2), t.month].join('|');
  }

  function assignIds(txs) {
    var seen = {};
    txs.forEach(function (t) {
      var k = txKey(t);
      seen[k] = (seen[k] || 0) + 1;
      t.id = 'T' + fnv1a(k) + fnv1a(k + '#') + (seen[k] > 1 ? '-' + seen[k] : '');
    });
    return txs;
  }

  function finish(out) {
    assignIds(out.txs);
    var months = {};
    var cards = {};
    out.txs.forEach(function (t) { if (t.month) months[t.month] = 1; cards[t.card] = 1; });
    out.months = Object.keys(months).sort();
    out.cards = Object.keys(cards);
    return out;
  }

  function parseFile(sheets, opts) {
    var f = detectFormat(sheets);
    if (f === 'history') return parseHistory(sheets, opts);
    if (f === 'max') return parseMax(sheets, opts);
    if (f === 'cal') return parseCal(sheets, opts);
    return { format: 'unknown', txs: [], warnings: ['לא זוהה פורמט של MAX או כאל'], months: [], cards: [], skippedSheets: [] };
  }

  // ---------- סיווג ----------

  function isBit(t) {
    var m = str(t.merchant).toUpperCase();
    return /(^|[^A-Z])BIT([^A-Z]|$)/.test(m) || /PAYBOX|פייבוקס|בביט/.test(m);
  }

  // קוד מדינה בן 3 אותיות בסוף שם בית העסק (כמו שמופיע בעסקאות חו"ל)
  var COUNTRY_CODES = ' AFG ALB DZA AND AGO ARG ARM AUS AUT AZE BHS BHR BGD BLR BEL BLZ BEN BTN BOL BIH BWA BRA BRN BGR KHM CMR CAN CPV CHL CHN COL CRI HRV CUB CYP CZE DNK DOM ECU EGY SLV EST ETH FIN FRA GEO DEU GHA GRC GTM HND HKG HUN ISL IND IDN IRL ITA JAM JPN JOR KAZ KEN KOR KWT LVA LBN LTU LUX MAC MDG MYS MDV MLT MUS MEX MDA MCO MNG MNE MAR MOZ NAM NPL NLD NZL NIC NGA MKD NOR OMN PAK PAN PRY PER PHL POL PRT QAT ROU RUS RWA SAU SEN SRB SYC SGP SVK SVN ZAF ESP LKA SWE CHE TWN TZA THA TUN TUR UGA UKR ARE GBR USA URY UZB VNM ZMB ZWE GIB PRI ABW CUW MLI CIV ';
  function isForeign(t) {
    if (t.foreign) return true;
    var m = str(t.merchant).trim().match(/\s([A-Z]{3})$/);
    return !!m && COUNTRY_CODES.indexOf(' ' + m[1] + ' ') >= 0;
  }

  function kwMatch(value, kw) {
    kw = norm(kw);
    if (!kw) return true;
    var v = norm(value);
    if (kw.charAt(0) === '^') return v.indexOf(kw.slice(1)) === 0;
    return v.indexOf(kw) >= 0;
  }

  function isYes(v) { return /^(כן|yes|true|1|v|✓)$/i.test(str(v).trim()); }

  function num(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    return parseAmount(v);
  }

  function ruleHasCondition(r) {
    return !!(str(r.merchant).trim() || str(r.notes).trim() || str(r.txType).trim() || str(r.branch).trim() ||
      str(r.card).trim() || isYes(r.foreign) || !isNaN(num(r.minAmount)) || !isNaN(num(r.maxAmount)));
  }

  function ruleMatches(r, t) {
    if (!ruleHasCondition(r) || !str(r.category).trim()) return false;
    if (!kwMatch(t.merchant, r.merchant)) return false;
    if (!kwMatch(t.notes, r.notes)) return false;
    if (!kwMatch(t.type, r.txType)) return false;
    if (str(r.branch).trim() && !kwMatch(t.branch, r.branch)) return false;
    if (str(r.card).trim() && !kwMatch(str(t.card) + ' ' + str(t.cardDigits), r.card)) return false;
    if (isYes(r.foreign) && !isForeign(t)) return false;
    var a = Math.abs(Number(t.amount));
    var min = num(r.minAmount), max = num(r.maxAmount);
    if (!isNaN(min) && a < min) return false;
    if (!isNaN(max) && a > max) return false;
    return true;
  }

  function sortRules(rules) {
    return rules.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var pa = num(a.r.priority), pb = num(b.r.priority);
      if (isNaN(pa)) pa = 9999;
      if (isNaN(pb)) pb = 9999;
      return pa - pb || a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  function categoryMap(categories) {
    var m = {};
    (categories || []).forEach(function (c) { m[str(c.name).trim()] = c; });
    return m;
  }

  function defaultPct(catName, cats) {
    var c = cats[catName];
    var p = c ? normPct(c.pct) : NaN;
    return isNaN(p) ? 100 : p;
  }

  // מחזיר { category, pct, auto, needsReview, bit, rule }
  function classify(t, sortedRules, cats) {
    var bit = isBit(t);
    if (t.presetCategory) {
      return { category: t.presetCategory, pct: defaultPct(t.presetCategory, cats), auto: true, needsReview: false, bit: bit, rule: null };
    }
    for (var i = 0; i < sortedRules.length; i++) {
      var r = sortedRules[i];
      if (ruleMatches(r, t)) {
        var cat = str(r.category).trim();
        var p = normPct(r.pct);
        return {
          category: cat,
          pct: isNaN(p) ? defaultPct(cat, cats) : p,
          auto: true,
          needsReview: bit || isYes(r.ask),
          bit: bit,
          rule: r
        };
      }
    }
    return { category: '', pct: 100, auto: false, needsReview: true, bit: bit, rule: null };
  }

  // זיכרון מהעבר: לכל שם בית עסק, הקטגוריה הנפוצה ביותר שנבחרה לו (בלי ביט ופייבוקס)
  function learnFromHistory(pastTxs) {
    var counts = {};
    (pastTxs || []).forEach(function (t) {
      var cat = str(t.category).trim();
      if (!cat || isBit(t)) return;
      var k = norm(t.merchant);
      counts[k] = counts[k] || {};
      counts[k][cat] = (counts[k][cat] || 0) + 1;
    });
    var best = {};
    Object.keys(counts).forEach(function (k) {
      var top = null;
      Object.keys(counts[k]).forEach(function (cat) { if (!top || counts[k][cat] > counts[k][top]) top = cat; });
      best[k] = top;
    });
    return best;
  }

  // מה שהכללים לא זיהו מקבל את הקטגוריה שנבחרה בעבר לאותו בית עסק בדיוק
  function classifyAll(txs, rules, categories, pastTxs) {
    var sorted = sortRules(rules || []);
    var cats = categoryMap(categories);
    var memory = learnFromHistory(pastTxs);
    return txs.map(function (t) {
      var c = classify(t, sorted, cats);
      if (!c.category && !c.bit) {
        var prev = memory[norm(t.merchant)];
        if (prev) c = { category: prev, pct: defaultPct(prev, cats), auto: true, needsReview: false, bit: false, rule: null, fromHistory: true };
      }
      return Object.assign({}, t, c);
    });
  }

  // מפרק "למי: X, עבור: Y" מההערות של ביט ופייבוקס
  function bitParts(notes) {
    var s = str(notes);
    var to = s.match(/למי:\s*([^,|]+)/);
    var forWhat = s.match(/עבור:\s*([^|]+)/);
    return { to: to ? to[1].trim() : '', forWhat: forWhat ? forWhat[1].trim() : '' };
  }

  // מילת מפתח מוצעת לכלל חדש מתוך שם בית העסק: בלי מספרים וסניפים
  function suggestKeyword(merchant) {
    var s = str(merchant).replace(/\d{3,}.*$/, '').replace(/\s+/g, ' ').trim();
    var words = s.split(' ');
    if (words.length > 2) s = words.slice(0, 2).join(' ');
    return s;
  }

  // אחוז משפחתי: 70 או 0.7 (תא בפורמט אחוזים בגיליון) הם אותו דבר
  function normPct(v) {
    var p = num(v);
    if (isNaN(p)) return NaN;
    if (p > 0 && p <= 1) p = p * 100;
    return p;
  }

  function familyAmount(amount, pct) {
    var p = normPct(pct);
    if (isNaN(p)) p = 100;
    return round2(Number(amount) * p / 100);
  }

  // ---------- חישובים ----------

  function settingsMap(settings) {
    var m = {};
    (settings || []).forEach(function (s) { m[str(s.key).trim()] = s.value; });
    return m;
  }

  function weakMonths(settings) {
    return str(settingsMap(settings).weak_months).split(/[,\s]+/).filter(Boolean);
  }

  function sum(arr, f) { return arr.reduce(function (a, x) { var v = Number(f(x)); return a + (isNaN(v) ? 0 : v); }, 0); }

  // תמיד מחושב מסכום × אחוז, כדי ששינוי ידני של האחוז בגיליון ייכנס לחישוב
  function txFamily(t) {
    return familyAmount(t.amount, t.pct);
  }

  function isCountedType(type) { return str(type).trim() === 'משתנה'; }

  // הפקדה חודשית של קופה. מספר, "3%" (אחוז מעלות החיים), או ריק בקופת "בלתי צפוי" (לפי ההגדרות)
  function potDeposit(pot, costOfLiving, settings) {
    var s = str(pot.deposit).trim();
    var pctM = s.match(/^([\d.]+)\s*%$/);
    if (pctM) return Math.round(costOfLiving * +pctM[1] / 100);
    var n = num(s);
    if (!isNaN(n)) return n;
    if (/בלתי צפוי/.test(str(pot.name))) {
      var p = num(settingsMap(settings).unexpected_pct);
      if (!isNaN(p)) return Math.round(costOfLiving * p / 100);
    }
    return 0;
  }

  function costBase(data) {
    var fixedTotal = round2(sum(data.fixed || [], function (f) { return f.amount; }));
    var variable = (data.categories || []).filter(function (c) { return isCountedType(c.type); });
    var varBudget = round2(sum(variable, function (c) { return c.budget; }));
    return { fixedTotal: fixedTotal, varBudget: varBudget, costOfLiving: round2(fixedTotal + varBudget), variable: variable };
  }

  function monthSummary(data, month) {
    var base = costBase(data);
    var cats = categoryMap(data.categories);
    var txs = data.transactions || [];
    var weak = weakMonths(data.settings).indexOf(month) >= 0;

    // ממוצע: עד 12 חודשי החיוב שלפני החודש הנבחר שיש בהם נתונים
    var prevMonths = {};
    txs.forEach(function (t) {
      var m = str(t.month);
      if (m && m < month && monthDiff(m, month) <= 12) prevMonths[m] = 1;
    });
    var nPrev = Object.keys(prevMonths).length;

    var byCat = {}, avgCat = {};
    var monthTx = [];
    txs.forEach(function (t) {
      var name = str(t.category).trim();
      var m = str(t.month);
      if (m === month) {
        monthTx.push(t);
        byCat[name] = (byCat[name] || 0) + txFamily(t);
      } else if (prevMonths[m]) {
        avgCat[name] = (avgCat[name] || 0) + txFamily(t);
      }
    });

    var rows = base.variable.map(function (c) {
      var name = str(c.name).trim();
      var actual = round2(byCat[name] || 0);
      var budget = Number(c.budget) || 0;
      return {
        name: name,
        group: c.group,
        budget: budget,
        actual: actual,
        avg: nPrev ? Math.round((avgCat[name] || 0) / nPrev) : null,
        projected: Math.max(actual, budget)
      };
    });

    var otherCounted = 0;
    Object.keys(byCat).forEach(function (name) {
      if (!cats[name] && name) otherCounted += byCat[name]; // קטגוריה שלא קיימת בלשונית: נספרת כדי לא לפספס
    });

    var varActual = round2(sum(rows, function (r) { return r.actual; }) + otherCounted);
    var varProjected = round2(sum(rows, function (r) { return r.projected; }) + otherCounted);
    var avgTotal = nPrev ? Math.round(sum(rows, function (r) { return r.avg; })) : null;

    var fixedIncomeRows = (data.income || []).filter(function (i) { return str(i.kind).trim() === 'קבועה'; });
    var actualIncomeRows = (data.income || []).filter(function (i) { return str(i.kind).trim() !== 'קבועה' && str(i.month) === month; });
    var fixedIncome = round2(sum(fixedIncomeRows, function (i) { return i.amount; }));
    var actualIncome = round2(sum(actualIncomeRows, function (i) { return i.amount; }));
    var incomeTotal = round2(fixedIncome + actualIncome);

    var savingsItems = (data.pots || []).filter(function (p) { return !isYes(p.inFixed); }).map(function (p) {
      return { name: p.name, amount: weak ? 0 : potDeposit(p, base.costOfLiving, data.settings) };
    });
    var extra = num(settingsMap(data.settings).extra_savings);
    if (!isNaN(extra) && extra > 0) savingsItems.push({ name: 'חיסכון נוסף', amount: extra });
    var savings = round2(sum(savingsItems, function (s) { return s.amount; }));

    var expenses = round2(base.fixedTotal + varProjected);
    var needToClose = round2(expenses - incomeTotal);
    var needWithSavings = round2(needToClose + savings);

    return {
      month: month,
      weak: weak,
      fixedTotal: base.fixedTotal,
      varBudget: base.varBudget,
      costOfLiving: base.costOfLiving,
      varActual: varActual,
      varProjected: varProjected,
      avgVariable: avgTotal,
      categories: rows,
      fixedIncome: fixedIncome,
      actualIncome: actualIncome,
      actualIncomeRows: actualIncomeRows,
      incomeTotal: incomeTotal,
      savingsItems: savingsItems,
      savings: savings,
      expenses: expenses,
      needToClose: needToClose,
      needWithSavings: needWithSavings,
      transactions: monthTx
    };
  }

  function potBalances(data) {
    var base = costBase(data);
    return (data.pots || []).map(function (p) {
      var name = str(p.name).trim();
      var moves = (data.potMoves || []).filter(function (m) { return str(m.pot).trim() === name; });
      var balance = round2(sum(moves, function (m) {
        return /משיכה/.test(str(m.kind)) ? -Math.abs(Number(m.amount)) : Math.abs(Number(m.amount));
      }));
      return {
        name: name,
        balance: balance,
        deposit: potDeposit(p, base.costOfLiving, data.settings),
        target: num(p.target),
        targetDate: str(p.targetDate).slice(0, 7),
        inFixed: isYes(p.inFixed),
        note: p.note,
        moves: moves
      };
    });
  }

  function depositedThisMonth(data, month) {
    return (data.potMoves || []).some(function (m) {
      return /הפקדה/.test(str(m.kind)) && str(m.date).slice(0, 7) === month && /הפקדה חודשית/.test(str(m.note));
    });
  }

  // הוצאות גדולות קרובות: קופות עם יעד ותאריך יעד. תאריך שעבר מתגלגל לשנה הבאה (הוצאה שנתית).
  function upcoming(data, month, weakSet) {
    weakSet = weakSet || weakMonths(data.settings);
    var doneThisMonth = depositedThisMonth(data, month);
    return potBalances(data).filter(function (p) { return !isNaN(p.target) && p.target > 0 && /^\d{4}-\d{2}$/.test(p.targetDate); })
      .map(function (p) {
        var due = p.targetDate;
        while (due < month) due = addMonths(due, 12);
        var months = monthDiff(month, due); // כמה הפקדות נשארו עד חודש היעד (לא כולל חודש היעד)
        if (!doneThisMonth) months += 1;
        if (months < 0) months = 0;
        var deposits = 0;
        for (var i = 0; i < months; i++) {
          var mm = addMonths(month, doneThisMonth ? i + 1 : i);
          if (!(weakSet.indexOf(mm) >= 0 && !p.inFixed)) deposits += p.deposit;
        }
        var projected = round2(p.balance + deposits);
        var missing = round2(p.target - projected);
        return {
          name: p.name,
          due: due,
          balance: p.balance,
          target: p.target,
          deposit: p.deposit,
          projected: projected,
          ok: missing <= 0,
          missing: missing > 0 ? missing : 0,
          perMonthNeeded: months > 0 ? Math.ceil(Math.max(0, p.target - p.balance) / months) : Math.max(0, p.target - p.balance)
        };
      }).sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : 0; });
  }

  return {
    norm: norm,
    parseAmount: parseAmount,
    parseDate: parseDate,
    monthOf: monthOf,
    addMonths: addMonths,
    monthDiff: monthDiff,
    currentMonth: currentMonth,
    today: today,
    monthLabel: monthLabel,
    detectFormat: detectFormat,
    parseFile: parseFile,
    parseMax: parseMax,
    parseCal: parseCal,
    parseHistory: parseHistory,
    HISTORY_CATEGORY_MAP: HISTORY_CATEGORY_MAP,
    txKey: txKey,
    assignIds: assignIds,
    isBit: isBit,
    isForeign: isForeign,
    sortRules: sortRules,
    classify: classify,
    classifyAll: classifyAll,
    learnFromHistory: learnFromHistory,
    categoryMap: categoryMap,
    bitParts: bitParts,
    suggestKeyword: suggestKeyword,
    familyAmount: familyAmount,
    normPct: normPct,
    settingsMap: settingsMap,
    weakMonths: weakMonths,
    isYes: isYes,
    potDeposit: potDeposit,
    costBase: costBase,
    monthSummary: monthSummary,
    potBalances: potBalances,
    depositedThisMonth: depositedThisMonth,
    upcoming: upcoming,
    round2: round2,
    fnv1a: fnv1a
  };
});
