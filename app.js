/* תזרים משפחתי: ממשק האפליקציה */
(function () {
  'use strict';

  var LS_CFG = 'fb_cfg', LS_DATA = 'fb_data', LS_META = 'fb_meta';
  var $app = document.getElementById('app');
  var $nav = document.getElementById('nav');
  var $banner = document.getElementById('banner');
  var $toast = document.getElementById('toast');

  var state = {
    cfg: readLS(LS_CFG),
    data: readLS(LS_DATA),
    meta: readLS(LS_META) || {},
    month: Core.currentMonth(),
    view: 'home',
    upload: null,
    addKind: 'expense',
    loading: false,
    offline: false,
    openTx: null,
    showAllTx: false,
    ruleFilter: ''
  };

  // ---------- עזרים ----------

  function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* מלא או חסום */ } }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
  function money(n, exact) {
    n = Number(n) || 0;
    var s = (exact ? nf2 : nf).format(Math.abs(n));
    // בידוד כיווני, כדי שהמינוס לא יקפוץ לצד השני בטקסט עברי
    return n < 0 ? '\u2066-₪' + s + '\u2069' : '₪' + s;
  }

  function dmy(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }

  function toast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { $toast.className = 'toast'; }, 3200);
  }

  function uid(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function D() { return state.data || { transactions: [], categories: [], fixed: [], income: [], rules: [], pots: [], potMoves: [], settings: [] }; }

  function settings() { return Core.settingsMap(D().settings); }

  function catsOfType(types) {
    return D().categories.filter(function (c) { return types.indexOf(String(c.type).trim()) >= 0; });
  }

  function catByName(name) { return Core.categoryMap(D().categories)[name]; }

  function categoryOptions(selected, kind) {
    var groups = kind === 'income'
      ? [['הכנסות', ['הכנסה']]]
      : [['הוצאות משתנות', ['משתנה']], ['מחוץ לחישוב', ['קבוע', 'מחוץ לחישוב']]];
    var html = '';
    if (!selected) html += '<option value="" selected disabled>בחרו קטגוריה</option>';
    var known = false;
    groups.forEach(function (g) {
      var cs = catsOfType(g[1]);
      if (!cs.length) return;
      html += '<optgroup label="' + esc(g[0]) + '">';
      cs.forEach(function (c) {
        var sel = c.name === selected;
        if (sel) known = true;
        html += '<option value="' + esc(c.name) + '"' + (sel ? ' selected' : '') + '>' + esc(c.name) + '</option>';
      });
      html += '</optgroup>';
    });
    if (selected && !known) html = '<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>' + html;
    return html;
  }

  // ---------- API ----------

  function api(action, payload) {
    if (!state.cfg) return Promise.reject(new Error('לא מחובר'));
    var body = Object.assign({ key: state.cfg.secret, action: action }, payload || {});
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 45000);
    return fetch(state.cfg.url, {
      method: 'POST',
      // text/plain כדי שהדפדפן לא ישלח בקשת preflight (Apps Script לא עונה עליה)
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('שגיאת שרת ' + r.status);
      return r.json();
    }, function (e) {
      clearTimeout(timer);
      var err = new Error('אין חיבור לשרת');
      err.network = true;
      throw err;
    }).then(function (j) {
      if (!j.ok) { var e = new Error(j.error || 'שגיאה'); e.code = j.code; throw e; }
      return j;
    });
  }

  function refresh(silent) {
    state.loading = true;
    renderBanner();
    return api('getAll').then(function (j) {
      state.data = j.data;
      state.meta = { syncedAt: new Date().toISOString(), spreadsheetUrl: j.spreadsheetUrl };
      state.offline = false;
      writeLS(LS_DATA, state.data);
      writeLS(LS_META, state.meta);
    }).catch(function (e) {
      if (e.network) state.offline = true;
      else if (!silent) toast(e.message, 'err');
      if (e.code === 'auth') toast('הקוד הסודי לא נכון. אפשר לעדכן בהגדרות.', 'err');
    }).then(function () {
      state.loading = false;
      render();
    });
  }

  function save(ops, okMsg) {
    if (!navigator.onLine) { toast('צריך חיבור לאינטרנט כדי לשמור', 'err'); return Promise.reject(new Error('offline')); }
    return api('batch', { ops: ops }).then(function (j) {
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(j) : okMsg, 'ok');
      return refresh(true).then(function () { return j; });
    }).catch(function (e) {
      toast(e.network ? 'השמירה נכשלה: אין חיבור' : 'השמירה נכשלה: ' + e.message, 'err');
      throw e;
    });
  }

  // ---------- ניווט ----------

  function route() {
    var h = location.hash.replace('#', '');
    if (h.indexOf('setup=') === 0) { handleSetupLink(h.slice(6)); return; }
    state.view = ['home', 'upload', 'add', 'pots', 'settings'].indexOf(h) >= 0 ? h : 'home';
    render();
    window.scrollTo(0, 0);
  }

  function handleSetupLink(encoded) {
    try {
      var o = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(encoded)))));
      state.prefill = { url: o.u, secret: o.k };
    } catch (e) { toast('קישור ההתקנה לא תקין', 'err'); }
    history.replaceState(null, '', location.pathname);
    if (state.cfg && state.prefill) {
      state.cfg = null;
    }
    render();
  }

  // ---------- רינדור ----------

  function render() {
    renderBanner();
    if (!state.cfg) { $nav.hidden = true; $app.innerHTML = viewSetup(); return; }
    $nav.hidden = false;
    Array.prototype.forEach.call($nav.querySelectorAll('a'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-view') === state.view);
    });
    if (!state.data) {
      $app.innerHTML = '<div class="empty"><div class="spinner"></div><p>טוען נתונים מהגיליון...</p></div>';
      return;
    }
    var v = { home: viewHome, upload: viewUpload, add: viewAdd, pots: viewPots, settings: viewSettings }[state.view];
    $app.innerHTML = v();
  }

  function renderBanner() {
    var msg = '';
    if (state.cfg && state.offline) {
      msg = 'אין חיבור. מוצגים הנתונים האחרונים' + (state.meta.syncedAt ? ' מ-' + new Date(state.meta.syncedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '') + '. שמירה דורשת חיבור.';
    } else if (state.cfg && state.loading && state.data) {
      msg = 'מתעדכן...';
    }
    $banner.hidden = !msg;
    $banner.textContent = msg;
    $banner.className = 'banner' + (state.offline ? ' warn' : '');
  }

  // ---------- התחברות ----------

  function viewSetup() {
    var p = state.prefill || {};
    var users = ['עופר', 'שגית'];
    return '<section class="setup">' +
      '<div class="brand"><img src="icons/icon.svg" alt="" width="64" height="64"><h1>תזרים משפחתי</h1></div>' +
      '<p class="muted">חיבור חד פעמי לגיליון. את הכתובת והקוד מקבלים בסוף ההתקנה של הסקריפט (או בקישור מהטלפון השני).</p>' +
      '<form id="setupForm" class="card form">' +
      '<label>כתובת ה-API<input name="url" type="url" required placeholder="https://script.google.com/macros/s/.../exec" value="' + esc(p.url || '') + '" dir="ltr"></label>' +
      '<label>קוד סודי<input name="secret" required autocomplete="off" value="' + esc(p.secret || '') + '" dir="ltr"></label>' +
      '<fieldset class="seg"><legend>מי משתמש בטלפון הזה?</legend>' +
      users.map(function (u, i) {
        return '<label><input type="radio" name="user" value="' + u + '"' + (i === 0 ? ' checked' : '') + '><span>' + u + '</span></label>';
      }).join('') +
      '</fieldset>' +
      '<button class="btn primary" type="submit">התחברות</button>' +
      '</form></section>';
  }

  function submitSetup(form) {
    var url = form.url.value.trim(), secret = form.secret.value.trim(), user = form.user.value;
    var btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'מתחבר...';
    state.cfg = { url: url, secret: secret, user: user };
    api('ping').then(function () {
      writeLS(LS_CFG, state.cfg);
      state.prefill = null;
      toast('מחובר. טוען נתונים...', 'ok');
      location.hash = '#home';
      return refresh();
    }).catch(function (e) {
      state.cfg = null;
      btn.disabled = false; btn.textContent = 'התחברות';
      toast(e.code === 'auth' ? 'הקוד הסודי לא נכון' : 'לא הצלחתי להתחבר: ' + e.message, 'err');
    });
  }

  // ---------- מסך הבית ----------

  function viewHome() {
    var s = Core.monthSummary(D(), state.month);
    var isCurrent = state.month === Core.currentMonth();
    var h = '';
    h += '<header class="month-nav">' +
      '<button class="icon-btn" data-act="month" data-d="-1" aria-label="החודש הקודם">›</button>' +
      '<div><h1>' + esc(Core.monthLabel(state.month)) + '</h1>' + (isCurrent ? '<span class="pill">החודש</span>' : '<button class="link" data-act="month-now">חזרה לחודש הנוכחי</button>') + '</div>' +
      '<button class="icon-btn" data-act="month" data-d="1" aria-label="החודש הבא">‹</button>' +
      '</header>';

    // כמה צריך להביא
    var need = s.needToClose, needAll = s.needWithSavings;
    h += '<section class="hero ' + (need > 0 ? 'need' : 'ok') + '">';
    if (need > 0) {
      h += '<div class="hero-label">צריך עוד</div><div class="hero-num">' + money(need) + '</div>' +
        '<div class="hero-sub">כדי לסגור את החודש</div>' +
        (s.savings > 0 ? '<div class="hero-extra">כולל הפקדות לחיסכון: <b>' + money(needAll) + '</b></div>' : '');
    } else {
      h += '<div class="hero-label">החודש סגור</div><div class="hero-num">' + money(-need) + '</div>' +
        '<div class="hero-sub">נשארו מעבר להוצאות</div>' +
        (needAll > 0 ? '<div class="hero-extra">לחיסכון המלא חסרים עוד <b>' + money(needAll) + '</b></div>' : (s.savings > 0 ? '<div class="hero-extra">גם החיסכון מכוסה</div>' : ''));
    }
    h += '<div class="hero-split"><span>הכנסות ' + money(s.incomeTotal) + '</span><span>הוצאות צפויות ' + money(s.expenses) + '</span></div>';
    h += '</section>';

    // הכנסות
    h += '<section class="card"><div class="card-head"><h2>הכנסות</h2><a class="btn small" href="#add" data-act="add-income">+ הכנסה</a></div>' +
      row('הכנסות קבועות (שכירות, קצבה)', money(s.fixedIncome)) +
      s.actualIncomeRows.map(function (i) { return row(esc(i.name) + (i.note ? ' <span class="muted">' + esc(i.note) + '</span>' : ''), money(i.amount)); }).join('') +
      (s.actualIncomeRows.length ? '' : '<p class="muted small">עוד לא הוזנה הכנסה מעבודה החודש.</p>') +
      '</section>';

    // הוצאות משתנות
    h += '<section class="card"><div class="card-head"><h2>הוצאות משתנות</h2><span class="muted">' + money(s.varActual) + ' מתוך ' + money(s.varBudget) + '</span></div>';
    if (s.avgVariable !== null) h += '<p class="muted small">ממוצע חודשי בשנה האחרונה: ' + money(s.avgVariable) + '</p>';
    s.categories.forEach(function (c) {
      var pct = c.budget > 0 ? c.actual / c.budget : (c.actual > 0 ? 1.5 : 0);
      var cls = pct > 1 ? 'over' : pct > 0.85 ? 'warn' : '';
      var avgPos = c.avg && c.budget > 0 ? Math.min(c.avg / c.budget, 1.5) / 1.5 * 100 : null;
      h += '<div class="bar-row ' + cls + '">' +
        '<div class="bar-top"><span>' + esc(c.name) + '</span><span><b>' + money(c.actual) + '</b> / ' + money(c.budget) + '</span></div>' +
        '<div class="bar"><div class="bar-fill" style="width:' + (Math.min(pct, 1.5) / 1.5 * 100).toFixed(1) + '%"></div>' +
        '<div class="bar-budget" style="right:' + (100 / 1.5).toFixed(1) + '%"></div>' +
        (avgPos !== null ? '<div class="bar-avg" style="right:' + avgPos.toFixed(1) + '%" title="ממוצע"></div>' : '') + '</div>' +
        (c.avg !== null ? '<div class="bar-sub">ממוצע ' + money(c.avg) + (pct > 1 ? ' · חריגה של ' + money(c.actual - c.budget) : '') + '</div>' : '') +
        '</div>';
    });
    h += '<p class="legend small muted"><i class="lg-budget"></i>תקציב <i class="lg-avg"></i>ממוצע</p>';
    h += '</section>';

    // קבועות וחיסכון
    h += '<section class="card"><div class="card-head"><h2>קבועות וחיסכון</h2></div>' +
      row('הוצאות קבועות', money(s.fixedTotal)) +
      s.savingsItems.map(function (i) { return row('הפקדה לקופת ' + esc(i.name), s.weak && i.amount === 0 ? '<span class="muted">מושהה</span>' : money(i.amount)); }).join('') +
      '<button class="btn ' + (s.weak ? 'warn' : 'ghost') + ' block" data-act="weak" data-month="' + state.month + '">' +
      (s.weak ? 'חודש חלש: ההפקדות לחופשה ולבלתי צפוי מושהות. ביטול' : 'חודש חלש? השהיית ההפקדות לחופשה ולבלתי צפוי') + '</button>' +
      '<details class="fixed-list"><summary>פירוט הקבועות</summary>' + fixedList() + '</details>' +
      '</section>';

    // עסקאות החודש
    var txs = s.transactions.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    h += '<section class="card"><div class="card-head"><h2>עסקאות החודש</h2><span class="muted">' + txs.length + '</span></div>';
    if (!txs.length) h += '<p class="muted small">אין עסקאות לחודש הזה. מעלים פירוט אשראי במסך "פירוט אשראי".</p>';
    var shown = state.showAllTx ? txs : txs.slice(0, 25);
    h += '<ul class="tx-list">' + shown.map(txItem).join('') + '</ul>';
    if (txs.length > shown.length) h += '<button class="btn ghost block" data-act="all-tx">הצג את כל ' + txs.length + ' העסקאות</button>';
    h += '</section>';
    return h;
  }

  function row(label, value) { return '<div class="row"><span>' + label + '</span><span>' + value + '</span></div>'; }

  function fixedList() {
    var groups = {};
    D().fixed.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    return Object.keys(groups).map(function (g) {
      var tot = groups[g].reduce(function (a, f) { return a + (Number(f.amount) || 0); }, 0);
      return '<div class="fx-group"><div class="row strong"><span>' + esc(g) + '</span><span>' + money(tot) + '</span></div>' +
        groups[g].map(function (f) { return row(esc(f.name) + (f.note ? ' <span class="muted small">' + esc(f.note) + '</span>' : ''), money(f.amount, true)); }).join('') + '</div>';
    }).join('') + '<p class="muted small">עריכה בלשונית fixed בגיליון.</p>';
  }

  function txItem(t) {
    var cat = catByName(t.category);
    var counted = cat && String(cat.type).trim() === 'משתנה';
    var fam = Core.familyAmount(t.amount, t.pct);
    var open = state.openTx === t.id;
    var h = '<li class="tx' + (counted ? '' : ' dim') + '" data-act="tx" data-id="' + esc(t.id) + '">' +
      '<div class="tx-main"><span class="tx-m">' + esc(t.merchant) + '</span><span class="tx-a">' + money(t.amount, true) + '</span></div>' +
      '<div class="tx-meta"><span>' + dmy(t.date) + ' · ' + esc(t.card) + '</span><span class="chip">' + esc(t.category || 'לא מסווג') +
      (Number(t.pct) && Number(t.pct) !== 100 && fam !== Number(t.amount) ? ' · ' + money(fam) : '') + '</span></div>';
    if (open) {
      h += '<div class="tx-edit" data-stop="1">' +
        (t.notes ? '<p class="small muted">' + esc(t.notes) + '</p>' : '') +
        '<select data-act="tx-cat" data-id="' + esc(t.id) + '">' + categoryOptions(t.category) + '</select>' +
        '<label class="inline small">אחוז משפחתי <input type="number" min="0" max="100" inputmode="numeric" value="' + esc(t.pct === '' ? 100 : Core.normPct(t.pct)) + '" data-act="tx-pct" data-id="' + esc(t.id) + '"></label>' +
        '</div>';
    }
    return h + '</li>';
  }

  // ---------- העלאת פירוט אשראי ----------

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.onload = function () { res(window.XLSX); };
      s.onerror = function () { rej(new Error('לא הצלחתי לטעון את קורא האקסל')); };
      document.head.appendChild(s);
    });
  }

  function readFiles(files) {
    state.upload = { reading: true, files: [] };
    render();
    loadXlsx().then(function (XLSX) {
      return Promise.all(Array.prototype.map.call(files, function (f) {
        return f.arrayBuffer().then(function (buf) {
          var wb = XLSX.read(buf, { type: 'array' });
          var sheets = wb.SheetNames.map(function (n) {
            return { name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) };
          });
          var p = Core.parseFile(sheets, { cards: settings().cards });
          p.fileName = f.name;
          p.txs.forEach(function (t) { t.noMonth = !t.month; });
          return p;
        }).catch(function (e) {
          return { fileName: f.name, format: 'error', txs: [], warnings: ['לא הצלחתי לקרוא את הקובץ: ' + e.message], months: [], cards: [] };
        });
      }));
    }).then(function (parsed) {
      state.upload = { files: parsed };
      prepareUpload();
      render();
    }).catch(function (e) {
      state.upload = null;
      toast(e.message, 'err');
      render();
    });
  }

  // מאחד את כל הקבצים, מסנן מה שכבר בגיליון ומסווג
  function prepareUpload() {
    var u = state.upload;
    var existing = {};
    D().transactions.forEach(function (t) { existing[t.id] = 1; });
    var all = [], seen = {}, dup = 0;
    u.files.forEach(function (f, fi) {
      f.txs.forEach(function (t) {
        t.fileIndex = fi;
        if (existing[t.id] || seen[t.id]) { dup++; return; }
        seen[t.id] = 1;
        all.push(t);
      });
    });
    var classified = Core.classifyAll(all, D().rules, D().categories, D().transactions);
    classified.forEach(function (t) {
      t.remember = false;
      t.keyword = t.bit ? (Core.bitParts(t.notes).to || '') : Core.suggestKeyword(t.merchant);
      t.withdraw = true;
    });
    u.txs = classified;
    u.dup = dup;
    u.history = u.files.some(function (f) { return f.format === 'history'; });
  }

  function viewUpload() {
    var u = state.upload;
    var h = '<header class="page-head"><h1>פירוט אשראי</h1></header>';
    if (!u) {
      h += '<label class="drop">' +
        '<input type="file" id="fileInput" accept=".xlsx,.xls,.csv" multiple hidden>' +
        '<span class="drop-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 16V4m0 0l-5 5m5-5l5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/></svg></span>' +
        '<b>בחירת קבצים</b><span class="muted">אפשר כמה בבת אחת: MAX, כאל, או קובץ ההיסטוריה המסווג</span></label>' +
        '<p class="muted small center">הקבצים נקראים בטלפון בלבד. לגיליון נשלחות רק העסקאות המסווגות.</p>';
      return h;
    }
    if (u.reading) return h + '<div class="empty"><div class="spinner"></div><p>קורא את הקבצים...</p></div>';

    // סיכום קבצים
    h += '<section class="card">';
    u.files.forEach(function (f, fi) {
      var fmt = { max: 'MAX', cal: 'כאל', history: 'היסטוריה מסווגת', unknown: 'לא מזוהה', error: 'שגיאה' }[f.format] || f.format;
      h += '<div class="file-row"><div><b>' + esc(f.fileName) + '</b><div class="small muted">' + esc(fmt) +
        (f.cards.length ? ' · ' + esc(f.cards.join(', ')) : '') +
        (f.months.length ? ' · ' + esc(f.months.length > 2 ? Core.monthLabel(f.months[0]) + ' עד ' + Core.monthLabel(f.months[f.months.length - 1]) : f.months.map(Core.monthLabel).join(', ')) : '') +
        ' · ' + f.txs.length + ' עסקאות</div>' +
        (f.warnings || []).map(function (w) { return '<div class="small warn-text">' + esc(w) + '</div>'; }).join('');
      if (f.txs.some(function (t) { return t.noMonth; })) {
        h += '<label class="inline small">חודש חיוב: <input type="month" data-act="file-month" data-fi="' + fi + '" value="' + esc(f.manualMonth || '') + '"></label>';
      }
      h += '</div></div>';
    });
    h += '</section>';

    var txs = u.txs;
    var review = txs.filter(function (t) { return t.needsReview; });
    var auto = txs.filter(function (t) { return !t.needsReview; });
    var missing = txs.filter(function (t) { return !t.category || !t.month; }).length;

    h += '<section class="stats">' +
      stat(txs.length, 'חדשות') + stat(u.dup, 'כבר בגיליון') + stat(auto.length, 'זוהו') + stat(review.length, 'לאישור') +
      '</section>';

    if (!txs.length) {
      h += '<p class="center muted">אין עסקאות חדשות לשמור.</p><button class="btn block" data-act="upload-reset">העלאה של קבצים אחרים</button>';
      return h;
    }

    if (review.length) {
      h += '<section class="card"><div class="card-head"><h2>לאישור</h2><span class="muted small">עסקאות שלא זוהו, וכל העברות הביט והפייבוקס</span></div><ul class="review">';
      review.forEach(function (t) { h += reviewItem(t); });
      h += '</ul></section>';
    }

    if (auto.length) {
      h += '<details class="card"><summary><b>זוהו אוטומטית (' + auto.length + ')</b> <span class="muted small">לחיצה לבדיקה ושינוי</span></summary><ul class="review compact">';
      auto.forEach(function (t) { h += reviewItem(t, true); });
      h += '</ul></details>';
    }

    // משיכות מוצעות מקופות
    if (!u.history) {
      var w = txs.filter(function (t) { var c = catByName(t.category); return c && c.pot && Number(t.amount) > 0; });
      if (w.length) {
        h += '<section class="card"><div class="card-head"><h2>משיכה מקופות</h2></div><p class="small muted">ההוצאות האלה משולמות מכסף שנחסך בקופה.</p>';
        w.forEach(function (t) {
          var c = catByName(t.category);
          h += '<label class="check"><input type="checkbox" data-act="withdraw" data-id="' + esc(t.id) + '"' + (t.withdraw ? ' checked' : '') + '>' +
            '<span>למשוך ' + money(t.amount, true) + ' מקופת ' + esc(c.pot) + ' <span class="muted small">' + esc(t.merchant) + '</span></span></label>';
        });
        h += '</section>';
      }
    }

    h += '<div class="sticky-actions">' +
      '<button class="btn ghost" data-act="upload-reset">ביטול</button>' +
      '<button class="btn primary" data-act="upload-save"' + (missing ? ' disabled' : '') + '>' +
      (missing ? (missing === 1 ? 'חסרה בחירה אחת' : 'חסרות ' + missing + ' בחירות') : 'שמירת ' + txs.length + ' עסקאות') + '</button></div>';
    return h;
  }

  function stat(n, label) { return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>'; }

  function reviewItem(t, compact) {
    var bp = t.bit ? Core.bitParts(t.notes) : null;
    var h = '<li class="rv' + (t.category ? '' : ' need') + '" data-id="' + esc(t.id) + '">' +
      '<div class="tx-main"><span class="tx-m">' + esc(t.merchant) + '</span><span class="tx-a">' + money(t.amount, true) + '</span></div>' +
      '<div class="tx-meta"><span>' + dmy(t.date) + ' · ' + esc(t.card) + (t.type && !/רגילה/.test(t.type) ? ' · ' + esc(t.type) : '') + '</span></div>';
    if (bp && (bp.to || bp.forWhat)) {
      h += '<div class="bit">' + (bp.to ? 'למי: <b>' + esc(bp.to) + '</b>' : '') + (bp.forWhat ? ' · עבור: <b>' + esc(bp.forWhat) + '</b>' : '') + '</div>';
    } else if (t.notes && !compact) {
      h += '<div class="small muted">' + esc(t.notes) + '</div>';
    }
    h += '<select data-act="rv-cat" data-id="' + esc(t.id) + '">' + categoryOptions(t.category) + '</select>';
    if (!compact || t.remember) {
      h += '<label class="check small"><input type="checkbox" data-act="rv-remember" data-id="' + esc(t.id) + '"' + (t.remember ? ' checked' : '') + '><span>זכור לפעם הבאה</span></label>';
      if (t.remember) {
        h += '<label class="inline small">' + (t.bit ? 'כשבהערות מופיע' : 'כששם בית העסק מכיל') +
          ' <input data-act="rv-kw" data-id="' + esc(t.id) + '" value="' + esc(t.keyword) + '"></label>';
      }
    }
    return h + '</li>';
  }

  function findUploadTx(id) {
    return state.upload && state.upload.txs.filter(function (t) { return t.id === id; })[0];
  }

  function saveUpload() {
    var u = state.upload;
    var now = Core.today();
    var cats = Core.categoryMap(D().categories);
    var rows = u.txs.map(function (t) {
      return {
        id: t.id, date: t.date, month: t.month, card: t.card, merchant: t.merchant, amount: t.amount,
        type: t.type, notes: t.notes, category: t.category, pct: t.pct,
        source: u.history ? 'history' : 'upload', addedBy: state.cfg.user
      };
    });
    var ops = [{ op: 'append', sheet: 'transactions', rows: rows }];
    var rules = [], seenRule = {};
    u.txs.forEach(function (t) {
      if (!t.remember || !String(t.keyword).trim()) return;
      var k = (t.bit ? 'n:' : 'm:') + t.keyword.trim() + '|' + t.category;
      if (seenRule[k]) return;
      seenRule[k] = 1;
      rules.push({
        priority: 5,
        merchant: t.bit ? '' : t.keyword.trim(),
        notes: t.bit ? t.keyword.trim() : '',
        category: t.category,
        note: 'נוסף מהאפליקציה ע"י ' + state.cfg.user + ' ' + now
      });
    });
    if (rules.length) ops.push({ op: 'append', sheet: 'rules', rows: rules });
    if (!u.history) {
      var moves = u.txs.filter(function (t) { var c = cats[t.category]; return c && c.pot && t.withdraw && Number(t.amount) > 0; }).map(function (t) {
        return { id: 'W' + t.id, date: t.date, pot: cats[t.category].pot, kind: 'משיכה', amount: t.amount, note: t.merchant, addedBy: state.cfg.user };
      });
      if (moves.length) ops.push({ op: 'append', sheet: 'pot_moves', rows: moves });
    }
    var btn = document.querySelector('[data-act="upload-save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'שומר...'; }
    save(ops, function (j) {
      var r = j.results[0];
      return 'נשמרו ' + r.added + ' עסקאות' + (r.skipped ? ' (' + r.skipped + ' כבר היו)' : '') + (rules.length ? ', ' + rules.length + ' כללים חדשים' : '');
    }).then(function () {
      var months = u.txs.map(function (t) { return t.month; }).sort();
      state.upload = null;
      if (months.length && !u.history) state.month = months[months.length - 1];
      location.hash = '#home';
      render();
    }).catch(function () { render(); });
  }

  // ---------- הזנה מהירה ----------

  function viewAdd() {
    var income = state.addKind === 'income';
    var h = '<header class="page-head"><h1>הזנה מהירה</h1></header>' +
      '<form id="addForm" class="card form">' +
      '<div class="seg two"><label><input type="radio" name="kind" value="expense"' + (income ? '' : ' checked') + ' data-act="add-kind"><span>הוצאה</span></label>' +
      '<label><input type="radio" name="kind" value="income"' + (income ? ' checked' : '') + ' data-act="add-kind"><span>הכנסה</span></label></div>' +
      '<label>סכום<input name="amount" type="number" step="0.01" min="0" inputmode="decimal" required placeholder="0" class="big-input"></label>' +
      '<label>קטגוריה<select name="category" required data-act="add-cat">' + categoryOptions(income ? 'הכנסה מעבודה' : '', income ? 'income' : 'expense') + '</select></label>' +
      '<label>הערה<input name="note" placeholder="' + (income ? 'למשל: פרויקט לקוח' : 'למשל: מזומן בשוק') + '"></label>' +
      '<div id="addPot"></div>' +
      '<p class="small muted">נרשם לחודש ' + esc(Core.monthLabel(Core.currentMonth())) + ', ע"י ' + esc(state.cfg.user) + '.</p>' +
      '<button class="btn primary block" type="submit">שמירה</button>' +
      '</form>';
    return h;
  }

  function updateAddPot(form) {
    var box = document.getElementById('addPot');
    if (!box) return;
    var c = catByName(form.category.value);
    box.innerHTML = c && c.pot && form.kind.value === 'expense'
      ? '<label class="check"><input type="checkbox" name="withdraw" checked><span>למשוך את הסכום מקופת ' + esc(c.pot) + '</span></label>'
      : '';
  }

  function submitAdd(form) {
    var amount = Core.parseAmount(form.amount.value);
    if (!(amount > 0)) { toast('צריך סכום', 'err'); return; }
    var cat = form.category.value;
    if (!cat) { toast('צריך לבחור קטגוריה', 'err'); return; }
    var note = form.note.value.trim();
    var month = Core.currentMonth(), date = Core.today();
    var ops;
    if (form.kind.value === 'income') {
      ops = [{ op: 'append', sheet: 'income', rows: [{ id: uid('I'), kind: 'בפועל', month: month, name: cat, amount: amount, note: note, addedBy: state.cfg.user }] }];
    } else {
      var c = catByName(cat);
      var id = uid('M');
      ops = [{ op: 'append', sheet: 'transactions', rows: [{
        id: id, date: date, month: month, card: 'ידני', merchant: note || cat, amount: amount, type: 'ידני', notes: note,
        category: cat, pct: c && c.pct !== '' ? c.pct : 100, source: 'manual', addedBy: state.cfg.user
      }] }];
      if (form.withdraw && form.withdraw.checked && c && c.pot) {
        ops.push({ op: 'append', sheet: 'pot_moves', rows: [{ id: 'W' + id, date: date, pot: c.pot, kind: 'משיכה', amount: amount, note: note || cat, addedBy: state.cfg.user }] });
      }
    }
    var btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    save(ops, 'נשמר').then(function () {
      state.month = month;
      state.addKind = 'expense';
      location.hash = '#home';
    }).catch(function () { btn.disabled = false; });
  }

  // ---------- קופות ----------

  function viewPots() {
    var data = D();
    var month = Core.currentMonth();
    var pots = Core.potBalances(data);
    var weak = Core.weakMonths(data.settings).indexOf(month) >= 0;
    var done = Core.depositedThisMonth(data, month);
    var total = pots.reduce(function (a, p) { return a + p.balance; }, 0);
    var h = '<header class="page-head"><h1>קופות</h1><span class="muted">בקרן הכספית: <b>' + money(total) + '</b></span></header>';

    // הפקדה חודשית
    var depositTotal = 0;
    var lines = pots.map(function (p) {
      var paused = weak && !p.inFixed;
      if (!paused) depositTotal += p.deposit;
      return row(esc(p.name), paused ? '<span class="muted">מושהה (חודש חלש)</span>' : money(p.deposit));
    }).join('');
    h += '<section class="card"><div class="card-head"><h2>הפקדה חודשית</h2><span class="muted">' + esc(Core.monthLabel(month)) + '</span></div>' + lines +
      (done ? '<div class="done">✓ ההפקדה של החודש נרשמה</div>'
        : '<button class="btn primary block" data-act="deposit">הפקדתי החודש (' + money(depositTotal) + ')</button>') +
      '</section>';

    // יתרות
    h += '<section class="pots">';
    pots.forEach(function (p) {
      var prog = !isNaN(p.target) && p.target > 0 ? Math.max(0, Math.min(1, p.balance / p.target)) : null;
      h += '<div class="pot"><div class="pot-name">' + esc(p.name) + '</div><div class="pot-bal">' + money(p.balance) + '</div>' +
        (prog !== null ? '<div class="bar thin"><div class="bar-fill" style="width:' + (prog * 100).toFixed(0) + '%"></div></div><div class="small muted">יעד ' + money(p.target) + '</div>' : '<div class="small muted">' + money(p.deposit) + ' בחודש</div>') +
        '</div>';
    });
    h += '</section>';

    // הוצאות גדולות קרובות
    var up = Core.upcoming(data, month);
    h += '<section class="card"><div class="card-head"><h2>הוצאות גדולות קרובות</h2></div>';
    if (!up.length) h += '<p class="muted small">אין עדיין יעדים. ממלאים "יעד" ו"תאריך יעד" (YYYY-MM) בלשונית pots בגיליון.</p>';
    up.forEach(function (x) {
      h += '<div class="upcoming ' + (x.ok ? 'ok' : 'bad') + '">' +
        '<div class="row"><b>' + esc(x.name) + ', ' + esc(Core.monthLabel(x.due)) + '</b><span>' + money(x.balance) + ' מתוך ' + money(x.target) + '</span></div>' +
        '<div class="small">' + (x.ok ? 'בקצב הנוכחי יהיו בקופה ' + money(x.projected) + '. מספיק.'
          : 'לא יספיק בזמן: יחסרו ' + money(x.missing) + '. כדי להגיע צריך ' + money(x.perMonthNeeded) + ' בחודש.') + '</div></div>';
    });
    h += '</section>';

    // משיכה או הפקדה ידנית (גם ליתרת פתיחה)
    h += '<form id="withdrawForm" class="card form"><div class="card-head"><h2>משיכה או הפקדה</h2></div>' +
      '<div class="seg two"><label><input type="radio" name="kind" value="משיכה" checked><span>משיכה</span></label>' +
      '<label><input type="radio" name="kind" value="הפקדה"><span>הפקדה</span></label></div>' +
      '<label>קופה<select name="pot">' + pots.map(function (p) { return '<option>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>סכום<input name="amount" type="number" step="0.01" min="0" inputmode="decimal" required></label>' +
      '<label>על מה<input name="note" placeholder="למשל: הטסט, או יתרת פתיחה"></label>' +
      '<button class="btn block" type="submit">רישום</button>' +
      (total === 0 ? '<p class="small muted">יש כבר כסף בקרן? רושמים לכל קופה הפקדה עם ההערה "יתרת פתיחה".</p>' : '') +
      '</form>';

    // תנועות אחרונות
    var moves = (data.potMoves || []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 15);
    if (moves.length) {
      h += '<section class="card"><div class="card-head"><h2>תנועות אחרונות</h2></div>' + moves.map(function (m) {
        var out = /משיכה/.test(m.kind);
        return row(dmy(m.date) + ' · ' + esc(m.pot) + ' <span class="muted small">' + esc(m.note || '') + '</span>', '<span class="' + (out ? 'neg' : 'pos') + '">' + (out ? '-' : '+') + money(m.amount) + '</span>');
      }).join('') + '</section>';
    }
    return h;
  }

  function deposit() {
    var data = D(), month = Core.currentMonth();
    if (Core.depositedThisMonth(data, month)) return;
    var weak = Core.weakMonths(data.settings).indexOf(month) >= 0;
    var rows = Core.potBalances(data).filter(function (p) { return p.deposit > 0 && !(weak && !p.inFixed); }).map(function (p) {
      return { id: 'D' + month + '-' + Core.fnv1a(p.name), date: Core.today(), pot: p.name, kind: 'הפקדה', amount: p.deposit, note: 'הפקדה חודשית ' + month, addedBy: state.cfg.user };
    });
    save([{ op: 'append', sheet: 'pot_moves', rows: rows }], 'ההפקדה נרשמה');
  }

  function submitWithdraw(form) {
    var amount = Core.parseAmount(form.amount.value);
    if (!(amount > 0)) { toast('צריך סכום', 'err'); return; }
    var kind = form.kind.value;
    save([{ op: 'append', sheet: 'pot_moves', rows: [{ id: uid(kind === 'הפקדה' ? 'P' : 'W'), date: Core.today(), pot: form.pot.value, kind: kind, amount: amount, note: form.note.value.trim(), addedBy: state.cfg.user }] }],
      (kind === 'הפקדה' ? 'נרשמה הפקדה של ' : 'נרשמה משיכה של ') + money(amount) + (kind === 'הפקדה' ? ' לקופת ' : ' מקופת ') + form.pot.value);
  }

  // ---------- הגדרות ----------

  function viewSettings() {
    var s = settings();
    var month = Core.currentMonth();
    var weak = Core.weakMonths(D().settings).indexOf(month) >= 0;
    var h = '<header class="page-head"><h1>הגדרות</h1></header>';

    h += '<section class="card"><div class="card-head"><h2>חיבור</h2></div>' +
      row('משתמש', esc(state.cfg.user)) +
      row('עדכון אחרון', state.meta.syncedAt ? new Date(state.meta.syncedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : 'לא ידוע') +
      '<div class="btn-row">' +
      (state.meta.spreadsheetUrl ? '<a class="btn" href="' + esc(state.meta.spreadsheetUrl) + '" target="_blank" rel="noopener">פתיחת הגיליון</a>' : '') +
      '<button class="btn" data-act="refresh">רענון</button>' +
      '<button class="btn" data-act="share-link">קישור התקנה לטלפון השני</button></div>' +
      '</section>';

    h += '<section class="card"><div class="card-head"><h2>חיסכון</h2></div>' +
      '<label class="inline">אחוז לקופת בלתי צפוי <input type="number" step="0.5" min="0" max="50" inputmode="decimal" value="' + esc(s.unexpected_pct) + '" data-act="set" data-key="unexpected_pct"> %</label>' +
      '<p class="small muted">' + money(Core.potDeposit({ name: 'בלתי צפוי', deposit: '' }, Core.costBase(D()).costOfLiving, D().settings)) + ' בחודש לפי עלות חיים של ' + money(Core.costBase(D()).costOfLiving) + '</p>' +
      '<button class="btn ' + (weak ? 'warn' : 'ghost') + ' block" data-act="weak" data-month="' + month + '">' + (weak ? 'החודש מסומן כחודש חלש. ביטול' : 'סימון החודש כחודש חלש') + '</button>' +
      '</section>';

    h += '<section class="card"><div class="card-head"><h2>תקציב חודשי</h2><span class="muted small">נשמר מיד</span></div>' +
      '<div class="budget-grid"><span class="small muted">קטגוריה</span><span class="small muted">תקציב</span><span class="small muted">% משפחתי</span>';
    catsOfType(['משתנה']).forEach(function (c) {
      h += '<span>' + esc(c.name) + '</span>' +
        '<input type="number" inputmode="numeric" min="0" value="' + esc(c.budget) + '" data-act="cat-set" data-name="' + esc(c.name) + '" data-field="budget">' +
        '<input type="number" inputmode="numeric" min="0" max="100" value="' + esc(c.pct === '' ? 100 : Core.normPct(c.pct)) + '" data-act="cat-set" data-name="' + esc(c.name) + '" data-field="pct">';
    });
    h += '</div><p class="small muted">קטגוריות חדשות מוסיפים בלשונית categories בגיליון.</p></section>';

    // כללים
    var rules = Core.sortRules(D().rules);
    var f = state.ruleFilter.trim();
    var shown = rules.filter(function (r) {
      return !f || [r.merchant, r.notes, r.category, r.txType, r.branch].join(' ').indexOf(f) >= 0;
    });
    h += '<section class="card"><div class="card-head"><h2>כללי סיווג</h2><span class="muted small">' + rules.length + '</span></div>' +
      '<p class="small muted">הכלל הראשון שמתאים קובע (מספר עדיפות קטן קודם). ^ בתחילת מילה = "מתחיל ב".</p>' +
      '<form id="ruleForm" class="rule-add"><input name="kw" placeholder="מילה בשם בית העסק" required>' +
      '<select name="field"><option value="merchant">בשם בית העסק</option><option value="notes">בהערות (ביט)</option></select>' +
      '<select name="category" required>' + categoryOptions('') + '</select>' +
      '<button class="btn small primary" type="submit">הוספה</button></form>' +
      '<input class="search" type="search" placeholder="חיפוש בכללים" value="' + esc(state.ruleFilter) + '" data-act="rule-filter">' +
      '<ul class="rules">' + shown.slice(0, 80).map(function (r) {
        var cond = [];
        if (r.merchant) cond.push('בית עסק: <b>' + esc(r.merchant) + '</b>');
        if (r.notes) cond.push('הערות: <b>' + esc(r.notes) + '</b>');
        if (r.txType) cond.push('סוג: ' + esc(r.txType));
        if (r.branch) cond.push('ענף: ' + esc(r.branch));
        if (r.card) cond.push('כרטיס: ' + esc(r.card));
        if (Core.isYes(r.foreign)) cond.push('חו"ל');
        if (r.minAmount !== '' || r.maxAmount !== '') cond.push('סכום ' + esc(r.minAmount) + '-' + esc(r.maxAmount));
        return '<li><div><span class="small muted">' + esc(r.priority) + '</span> ' + cond.join(' · ') + '<div class="small">← ' + esc(r.category) +
          (r.pct !== '' && r.pct !== undefined ? ' (' + esc(Core.normPct(r.pct)) + '%)' : '') + '</div></div>' +
          '<button class="icon-btn small" data-act="rule-del" data-p="' + esc(r.priority) + '" data-m="' + esc(r.merchant) + '" data-n="' + esc(r.notes) + '" data-c="' + esc(r.category) + '" aria-label="מחיקת כלל">×</button></li>';
      }).join('') + '</ul>' +
      (shown.length > 80 ? '<p class="small muted">מוצגים 80 מתוך ' + shown.length + '. אפשר לחפש.</p>' : '') +
      '</section>';

    h += '<section class="card"><div class="card-head"><h2>כרטיסים</h2></div><p class="small">' + esc(s.cards || '') + '</p><p class="small muted">עריכה בלשונית settings בגיליון (cards).</p></section>';

    h += '<section class="card"><div class="card-head"><h2>התקנה למסך הבית</h2></div>' +
      '<p class="small"><b>אנדרואיד (Chrome):</b> תפריט ⋮ ← "הוספה למסך הבית" / "התקנת אפליקציה".</p>' +
      '<p class="small"><b>iPhone (Safari):</b> כפתור השיתוף ← "הוספה למסך הבית".</p></section>';

    h += '<button class="btn ghost block danger-text" data-act="logout">התנתקות מהטלפון הזה</button>';
    return h;
  }

  // ---------- אירועים ----------

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    if (e.target.closest('[data-stop]') && el.getAttribute('data-act') === 'tx') return;
    var act = el.getAttribute('data-act');
    switch (act) {
      case 'month':
        state.month = Core.addMonths(state.month, +el.getAttribute('data-d'));
        state.openTx = null; state.showAllTx = false;
        render();
        break;
      case 'month-now':
        state.month = Core.currentMonth(); render(); break;
      case 'add-income':
        state.addKind = 'income'; break;
      case 'weak': toggleWeak(el.getAttribute('data-month')); break;
      case 'tx':
        state.openTx = state.openTx === el.getAttribute('data-id') ? null : el.getAttribute('data-id');
        render(); break;
      case 'all-tx': state.showAllTx = true; render(); break;
      case 'upload-reset': state.upload = null; render(); break;
      case 'upload-save': saveUpload(); break;
      case 'deposit': el.disabled = true; deposit(); break;
      case 'refresh': refresh(); break;
      case 'share-link': shareLink(); break;
      case 'rule-del': deleteRule(el); break;
      case 'logout':
        if (confirm('להתנתק? הנתונים נשארים בגיליון.')) {
          localStorage.removeItem(LS_CFG); localStorage.removeItem(LS_DATA); localStorage.removeItem(LS_META);
          state.cfg = null; state.data = null; render();
        }
        break;
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.id === 'fileInput' && el.files.length) { readFiles(el.files); return; }
    var act = el.getAttribute('data-act');
    var t;
    switch (act) {
      case 'rv-cat':
        t = findUploadTx(el.getAttribute('data-id'));
        if (t) {
          t.category = el.value;
          var c = catByName(el.value);
          t.pct = c && c.pct !== '' ? Core.normPct(c.pct) : 100;
          render();
        }
        break;
      case 'rv-remember':
        t = findUploadTx(el.getAttribute('data-id'));
        if (t) { t.remember = el.checked; render(); }
        break;
      case 'rv-kw':
        t = findUploadTx(el.getAttribute('data-id'));
        if (t) t.keyword = el.value;
        break;
      case 'withdraw':
        t = findUploadTx(el.getAttribute('data-id'));
        if (t) t.withdraw = el.checked;
        break;
      case 'file-month':
        (function (f) {
          f.manualMonth = el.value;
          f.txs.forEach(function (x) { if (x.noMonth) x.month = el.value; });
          Core.assignIds(f.txs); // חודש החיוב הוא חלק מהמזהה
        })(state.upload.files[+el.getAttribute('data-fi')]);
        prepareUpload();
        render();
        break;
      case 'add-kind':
        state.addKind = el.value; render(); break;
      case 'add-cat':
        updateAddPot(el.form); break;
      case 'tx-cat': updateTx(el.getAttribute('data-id'), { category: el.value, pct: (function () { var c = catByName(el.value); return c && c.pct !== '' ? Core.normPct(c.pct) : 100; })() }); break;
      case 'tx-pct': updateTx(el.getAttribute('data-id'), { pct: Number(el.value) }); break;
      case 'set': saveSetting(el.getAttribute('data-key'), el.value); break;
      case 'cat-set': saveCat(el.getAttribute('data-name'), el.getAttribute('data-field'), Number(el.value)); break;
    }
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.getAttribute('data-act') === 'rule-filter') {
      state.ruleFilter = el.value;
      clearTimeout(this._rf);
      this._rf = setTimeout(function () {
        render();
        var s = document.querySelector('.search');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 250);
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    e.preventDefault();
    if (f.id === 'setupForm') submitSetup(f);
    else if (f.id === 'addForm') submitAdd(f);
    else if (f.id === 'withdrawForm') submitWithdraw(f);
    else if (f.id === 'ruleForm') addRule(f);
  });

  function updateTx(id, set) {
    save([{ op: 'update', sheet: 'transactions', where: { id: id }, set: set }], 'עודכן');
  }

  function saveSetting(key, value) {
    save([{ op: 'update', sheet: 'settings', where: { key: key }, set: { value: value }, upsert: true }], 'נשמר');
  }

  function saveCat(name, field, value) {
    var set = {}; set[field] = value;
    save([{ op: 'update', sheet: 'categories', where: { name: name }, set: set }], 'נשמר');
  }

  function toggleWeak(month) {
    var list = Core.weakMonths(D().settings);
    var i = list.indexOf(month);
    if (i >= 0) list.splice(i, 1); else list.push(month);
    save([{ op: 'update', sheet: 'settings', where: { key: 'weak_months' }, set: { value: list.sort().join(',') }, upsert: true }],
      i >= 0 ? 'ההפקדות חזרו לחודש הזה' : 'ההפקדות לחופשה ולבלתי צפוי הושהו לחודש הזה');
  }

  function addRule(f) {
    var kw = f.kw.value.trim();
    if (!kw || !f.category.value) return;
    var r = { priority: 5, merchant: f.field.value === 'merchant' ? kw : '', notes: f.field.value === 'notes' ? kw : '', category: f.category.value, note: 'נוסף מהאפליקציה ע"י ' + state.cfg.user };
    save([{ op: 'append', sheet: 'rules', rows: [r] }], 'הכלל נוסף');
  }

  function deleteRule(el) {
    if (!confirm('למחוק את הכלל?')) return;
    var where = { priority: el.getAttribute('data-p'), merchant: el.getAttribute('data-m'), notes: el.getAttribute('data-n'), category: el.getAttribute('data-c') };
    save([{ op: 'delete', sheet: 'rules', where: where }], 'הכלל נמחק');
  }

  function shareLink() {
    var enc = encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify({ u: state.cfg.url, k: state.cfg.secret })))));
    var link = location.origin + location.pathname + '#setup=' + enc;
    var done = function () { toast('הקישור הועתק. לשלוח אותו לטלפון השני ולפתוח בדפדפן.', 'ok'); };
    if (navigator.share) {
      navigator.share({ title: 'תזרים משפחתי', text: 'קישור התחברות לאפליקציית התזרים', url: link }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(done, function () { prompt('להעתיק את הקישור:', link); });
    } else {
      prompt('להעתיק את הקישור:', link);
    }
  }

  // ---------- הפעלה ----------

  window.addEventListener('hashchange', route);
  window.addEventListener('online', function () { if (state.cfg) refresh(true); });
  window.addEventListener('offline', function () { state.offline = true; renderBanner(); });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  route();
  if (state.cfg) refresh(true);

  // לבדיקות
  window.__app = { state: state, render: render, refresh: refresh };
})();
