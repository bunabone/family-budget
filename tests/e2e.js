// בדיקת קצה לקצה: האפליקציה בדפדפן מול Code.gs שרץ על גיליון מדומה (במקום Apps Script אמיתי)
const { chromium } = require('playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { loadGas } = require('./gas-mock');
const { makeMax, makeCal } = require('./make-fixtures');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.SHOTS || path.join(require('os').tmpdir(), 'fb-shots');
fs.mkdirSync(OUT, { recursive: true });
const HISTORY = process.env.HISTORY_XLSX;
const API = 'https://script.google.com/macros/s/TEST/exec';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  return new Promise((res) => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(s));
  });
}

function assert(c, msg) { if (!c) throw new Error('נכשל: ' + msg); console.log('✓', msg); }

(async () => {
  const gas = loadGas();
  gas.setup();
  const secret = gas.getSecret_();
  const server = await serve();
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') ? undefined : undefined });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'he-IL', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let calls = 0, sawPreflight = false;
  await page.route(API, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { sawPreflight = true; return route.fulfill({ status: 405 }); }
    calls++;
    const ct = req.headers()['content-type'] || '';
    if (!ct.startsWith('text/plain')) throw new Error('Content-Type לא text/plain: ' + ct);
    const out = gas.doPost({ postData: { contents: req.postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: out.text });
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  await page.goto(base);
  await page.waitForSelector('#setupForm');
  await shot('01-setup');
  await page.fill('input[name=url]', API);
  await page.fill('input[name=secret]', 'wrong');
  await page.click('#setupForm button');
  await page.waitForSelector('.toast.err');
  assert(await page.isVisible('#setupForm'), 'קוד שגוי לא מתחבר');
  await page.fill('input[name=secret]', secret);
  await page.click('#setupForm button');
  await page.waitForSelector('.hero');
  assert((await page.textContent('.hero')).includes('צריך עוד'), 'מסך הבית מציג "צריך עוד"');
  await shot('02-home-empty');

  // ייבוא היסטוריה
  if (HISTORY) {
    await page.click('a[data-view=upload]');
    await page.setInputFiles('#fileInput', HISTORY);
    await page.waitForSelector('[data-act=upload-save]');
    await shot('03-upload-history');
    const txt = await page.textContent('.stats');
    assert(txt.includes('1562'), 'קובץ ההיסטוריה: 1562 עסקאות חדשות');
    await page.click('[data-act=upload-save]');
    await page.waitForSelector('.hero', { timeout: 30000 });
    const n = gas.call({ key: secret, action: 'getAll' }).data.transactions.length;
    assert(n === 1562, 'נשמרו 1562 עסקאות בגיליון');
    await page.click('[data-act=month-now]').catch(() => {});
    await page.click('[data-act=month][data-d="-1"]');
    await page.waitForSelector('.bar-row');
    await shot('04-home-sept');
    // העלאה חוזרת לא משכפלת
    await page.click('a[data-view=upload]');
    await page.setInputFiles('#fileInput', HISTORY);
    await page.waitForSelector('.stats');
    assert((await page.textContent('.stats')).match(/0\s*חדשות/), 'העלאה חוזרת של אותו קובץ: 0 חדשות');
    await page.click('[data-act=upload-reset]');
  }

  // MAX + כאל יחד
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fbe-'));
  const maxF = path.join(tmp, 'max-sept.xlsx'), calF = path.join(tmp, 'cal-sept.xlsx');
  makeMax(maxF); makeCal(calF);
  await page.click('a[data-view=upload]');
  await page.setInputFiles('#fileInput', [maxF, calF]);
  await page.waitForSelector('.review');
  await shot('05-upload-review');
  const disabled = await page.isDisabled('[data-act=upload-save]');
  assert(disabled, 'שמירה חסומה עד שכל העסקאות מסווגות');
  // בוחרים קטגוריה לעסקה שלא זוהתה וזוכרים
  const li = page.locator('.rv.need').first();
  const merchant = (await li.locator('.tx-m').textContent()).trim();
  await li.locator('select').selectOption('קניות: ביגוד, לבית ואונליין');
  const li2 = page.locator('.rv', { hasText: merchant }).first();
  await li2.locator('[data-act=rv-remember]').check();
  await page.waitForSelector('[data-act=rv-kw]');
  while (await page.locator('.rv.need').count()) {
    await page.locator('.rv.need').first().locator('select').selectOption('שונות: לוטו ותיקונים');
  }
  await shot('06-upload-ready');
  assert(await page.isVisible('text=למשוך'), 'מוצעת משיכה מקופת רכב על המוסך');
  await page.click('[data-act=upload-save]');
  await page.waitForSelector('.hero', { timeout: 30000 });
  let d = gas.call({ key: secret, action: 'getAll' }).data;
  assert(d.rules.some((r) => r.priority === 5 && r.category === 'קניות: ביגוד, לבית ואונליין'), 'נוסף כלל "זכור לפעם הבאה"');
  assert(d.potMoves.some((m) => m.pot === 'רכב' && m.kind === 'משיכה' && m.amount === 569.34), 'נרשמה משיכה מקופת רכב');
  assert(d.transactions.some((t) => t.merchant === 'סונול צומת אליקים' && t.familyAmount === 210), 'דלק נשמר עם 70% משפחתי');
  await shot('07-home-after-upload');

  // הזנה מהירה: הכנסה
  await page.click('a[data-view=add]');
  await page.click('.seg label:has(input[value=income])');
  await page.fill('input[name=amount]', '15000');
  await page.fill('input[name=note]', 'לקוח');
  await shot('08-add-income');
  await page.click('#addForm [type=submit]');
  await page.waitForSelector('.hero');
  d = gas.call({ key: secret, action: 'getAll' }).data;
  assert(d.income.some((i) => i.kind === 'בפועל' && i.amount === 15000), 'הכנסה מעבודה נשמרה');
  await shot('09-home-income');

  // הזנה מהירה: הוצאה
  await page.click('a[data-view=add]');
  await page.fill('input[name=amount]', '120');
  await page.selectOption('select[name=category]', 'סופר ומזון לבית');
  await page.click('#addForm [type=submit]');
  await page.waitForSelector('.hero');
  d = gas.call({ key: secret, action: 'getAll' }).data;
  assert(d.transactions.some((t) => t.source === 'manual' && t.amount === 120), 'הוצאה ידנית נשמרה');

  // שינוי קטגוריה לעסקה מהבית
  await page.click('.tx >> nth=0');
  await page.waitForSelector('[data-act=tx-cat]');
  await page.selectOption('[data-act=tx-cat]', 'אוכל בחוץ ובילויים');
  await page.waitForSelector('.toast.ok');

  // קופות
  await page.click('a[data-view=pots]');
  await page.waitForSelector('[data-act=deposit]');
  await page.click('[data-act=deposit]');
  await page.waitForSelector('.done');
  d = gas.call({ key: secret, action: 'getAll' }).data;
  const deposits = d.potMoves.filter((m) => m.kind === 'הפקדה');
  assert(deposits.length === 4, 'הפקדה חודשית לארבע הקופות');
  assert(deposits.find((m) => m.pot === 'בלתי צפוי').amount === 819, 'בלתי צפוי: 3% = 819');
  await page.fill('#withdrawForm input[name=amount]', '1750');
  await page.fill('#withdrawForm input[name=note]', 'הטסט');
  await page.click('#withdrawForm button');
  await page.waitForSelector('text=הטסט');
  await shot('10-pots');

  // חודש חלש
  await page.click('a[data-view=home]');
  await page.click('[data-act=weak]');
  await page.waitForSelector('.btn.warn[data-act=weak]');
  d = gas.call({ key: secret, action: 'getAll' }).data;
  assert(d.settings.find((s) => s.key === 'weak_months').value === require('../core.js').currentMonth(), 'חודש חלש נשמר');

  // הגדרות
  await page.click('a[data-view=settings]');
  await page.waitForSelector('.budget-grid');
  const inp = page.locator('[data-act=cat-set][data-name="דלק"][data-field=budget]');
  await inp.fill('900');
  await inp.dispatchEvent('change');
  await page.waitForSelector('.toast.ok');
  d = gas.call({ key: secret, action: 'getAll' }).data;
  assert(d.categories.find((c) => c.name === 'דלק').budget === 900, 'עריכת תקציב נשמרת בגיליון');
  await shot('11-settings');

  // בלי אינטרנט: service worker מגיש את האפליקציה, הנתונים מהמטמון המקומי
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'he-IL' });
  const p2 = await ctx2.newPage();
  await p2.route(API, async (route) => {
    const out = gas.doPost({ postData: { contents: route.request().postData() } });
    await route.fulfill({ status: 200, contentType: 'application/json', body: out.text });
  });
  await p2.goto(base);
  await p2.evaluate(([u, k]) => localStorage.setItem('fb_cfg', JSON.stringify({ url: u, secret: k, user: 'שגית' })), [API, secret]);
  await p2.reload();
  await p2.waitForSelector('.hero');
  await p2.evaluate(() => navigator.serviceWorker.ready);
  await p2.waitForTimeout(500);
  await p2.reload();
  await p2.waitForSelector('.hero');
  await ctx2.setOffline(true);
  await p2.unroute(API);
  await p2.route(API, (r) => r.abort('internetdisconnected'));
  await p2.reload();
  await p2.waitForSelector('.hero');
  await p2.waitForFunction(() => !document.getElementById('banner').hidden && document.getElementById('banner').textContent.includes('אין חיבור'), null, { timeout: 15000 });
  assert(true, 'בלי חיבור: האפליקציה נפתחת ומציגה את הנתונים האחרונים');
  await p2.screenshot({ path: path.join(OUT, '12-offline.png'), fullPage: false });
  await p2.click('a[data-view=add]');
  await p2.fill('input[name=amount]', '50');
  await p2.selectOption('select[name=category]', 'סופר ומזון לבית');
  await p2.click('#addForm [type=submit]');
  await p2.waitForSelector('.toast.err');
  assert((await p2.textContent('.toast')).includes('חיבור'), 'בלי חיבור: שמירה מסרבת עם הודעה');
  await ctx2.close();

  assert(!sawPreflight, 'אין בקשות preflight');
  const html = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert(!/[—–]/.test(html), 'אין מקף ארוך בטקסט');
  assert(!errors.length, 'אין שגיאות בקונסול' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('קריאות API:', calls, 'צילומים ב-', OUT);
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
