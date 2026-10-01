// סביבת Apps Script מדומה לבדיקות ב-Node: גיליון בזיכרון + ContentService/LockService/Utilities
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  let data = []; // מערך שורות, כל שורה מערך תאים
  let maxRows = 1000;
  const sheet = {
    name,
    rtl: false,
    getName: () => name,
    getLastRow: () => {
      for (let i = data.length - 1; i >= 0; i--) if ((data[i] || []).some((v) => v !== '' && v !== undefined)) return i + 1;
      return 0;
    },
    getLastColumn: () => data.reduce((m, r) => Math.max(m, (r || []).reduce((mm, v, i) => (v !== '' && v !== undefined ? i + 1 : mm), 0)), 0),
    getMaxRows: () => maxRows,
    insertRowsAfter: (after, n) => { maxRows += n; },
    setFrozenRows: () => {},
    setRightToLeft: (v) => { sheet.rtl = v; },
    deleteRow: (r) => { data.splice(r - 1, 1); },
    getRange: (r, c, nr = 1, nc = 1) => {
      if (r + nr - 1 > maxRows) throw new Error('Range out of bounds');
      const range = {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              let v = ((data[r - 1 + i] || [])[c - 1 + j]);
              if (v === undefined) v = '';
              if (typeof v === 'object' && v && v.formula) v = v.value(r - 1 + i);
              row.push(v);
            }
            out.push(row);
          }
          return out;
        },
        setValues: (vals) => {
          for (let i = 0; i < nr; i++) {
            data[r - 1 + i] = data[r - 1 + i] || [];
            for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = coerce(vals[i][j]);
          }
          return range;
        },
        setValue: (v) => { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = coerce(v); return range; },
        setFormulasR1C1: (fs2) => {
          for (let i = 0; i < nr; i++) {
            data[r - 1 + i] = data[r - 1 + i] || [];
            const f = fs2[i][0];
            const refs = [...f.matchAll(/R\[0\]C\[(-?\d+)\]/g)].map((m) => +m[1]);
            const col = c - 1;
            data[r - 1 + i][col] = {
              formula: f,
              value: (ri) => {
                const am = data[ri][col + refs[1]];
                const pc = data[ri][col + refs[0]];
                if (pc === '' || pc === undefined) return am;
                return (am * (pc <= 1 ? pc * 100 : pc)) / 100;
              }
            };
          }
          return range;
        },
        setFontWeight: () => range,
        setBackground: () => range
      };
      return range;
    },
    _data: () => data
  };
  return sheet;
}

// כמו Google: טקסט עם גרש בהתחלה נשמר כטקסט; "2026-10" בלי גרש היה הופך לתאריך
function coerce(v) {
  if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);
  if (typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?$/.test(v)) return new Date(v.length === 7 ? v + '-01T00:00:00' : v + 'T00:00:00');
  return v;
}

function loadGas() {
  const sheets = {};
  const order = [];
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet(n); order.push(n); return sheets[n]; },
    getSheets: () => order.map((n) => sheets[n]),
    deleteSheet: (s) => { delete sheets[s.getName()]; order.splice(order.indexOf(s.getName()), 1); },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
    setSpreadsheetTimeZone: () => {},
    getSpreadsheetTimeZone: () => 'Asia/Jerusalem'
  };
  ss.insertSheet('גיליון1');
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getActive: () => ss, getUi: () => { throw new Error('no ui'); } },
    ContentService: {
      createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }),
      MimeType: { JSON: 'json' }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, fmt) => {
        const p = (n) => String(n).padStart(2, '0');
        const s = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        if (fmt === 'yyyy-MM') return s.slice(0, 7);
        if (fmt.includes('HH')) return `${s}T${p(d.getHours())}:${p(d.getMinutes())}`;
        return s;
      }
    },
    Logger: { log: () => {} },
    console
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  ctx._ss = ss;
  ctx.call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  return ctx;
}

module.exports = { loadGas };
