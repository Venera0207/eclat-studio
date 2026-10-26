/* Локальный тест-стенд: эмулирует Google Apps Script и гоняет backend/appsscript.gs
   Запуск: node test/pipe.test.js                                              */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------------- эмуляция таблиц ---------------- */
/* Google Sheets отдаёт значение парсеру: строка, начинающаяся с «+», «=», «@»,
   трактуется как ФОРМУЛА и превращается в #ERROR!. appendRow этому подвержен
   ДАЖЕ если колонку заранее пометили текстом (проверено на бою).
   А вот setValue в ячейку с форматом «@» пишет дословно — этим и лечим.      */
function sheetsParse(v) {
  if (typeof v === 'string' && /^[+=@]/.test(v)) return '#ERROR!';
  return v;
}
class Sheet {
  constructor(name) { this.name = name; this.v = []; this.fmt = {}; this.widths = {}; this.maxCols = 26;
                      this.maxRows = 1000; this.style = {}; this.resized = null; this.rowH = {}; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  deleteColumns(start, n) { this.maxCols = Math.min(this.maxCols, start - 1); return this; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  deleteRows(start, n) { this.maxRows = Math.max(1, start - 1); this.v = this.v.slice(0, start - 1); return this; }
  setRowHeight(r, h) { this.rowH[r] = h; return this; }
  autoResizeRows(start, n) { this.resized = [start, n]; return this; }
  setName(n) { this.name = n; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getName() { return this.name; }
  getLastRow() { return this.v.length; }
  getLastColumn() { return this.v.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.v.push(row.map(sheetsParse)); return this; }
  deleteRow(i) { this.v.splice(i - 1, 1); }
  getDataRange() { const s = this; return { getValues: () => s.v.map(r => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const s = this;
    nr = nr || 1; nc = nc || 1;
    const range = {
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = s.v[r - 1 + i] || [];
          const line = [];
          for (let j = 0; j < nc; j++) line.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
          out.push(line);
        }
        return out;
      },
      getValue: () => { const row = s.v[r - 1] || []; return row[c - 1] !== undefined ? row[c - 1] : ''; },
      setValue: (val) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          const row = s.v[r - 1 + i]; if (!row) continue;
          const key = (r + i) + ':' + (c + j);
          row[c - 1 + j] = (s.fmt[key] === '@') ? val : sheetsParse(val);
        }
        return range;
      },
      // как в настоящих Apps Script: возвращает сам Range, чтобы можно было писать цепочкой
      setNumberFormat: (f) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt[(r + i) + ':' + (c + j)] = f;
        return range;
      },
      setWrap: (on) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':wrap'] = on !== false; return range; },
      setVerticalAlignment: (a) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':valign'] = a; return range; },
      setHorizontalAlignment: () => range,
      setFontWeight: (w) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bold'] = w; return range; },
      setFontColor: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':color'] = col; return range; },
      setBackground: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bg'] = col; return range; },
      setValues: (rows2d) => {
        for (let i = 0; i < nr; i++) { const row = s.v[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = rows2d[i][j]; }
        return range;
      }
    };
    return range;
  }
}
class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; }
  getSheetByName(n) { return this.sheets.filter(s => s.name === n)[0] || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(x => x !== sh); return this; }
  getId() { return 'FAKE_' + this.name; }
}

/* ---------------- эмуляция сервисов Apps Script ---------------- */
const DB = new Spreadsheet('ÉCLAT STUDIO — база записей');
const SENT_MAIL = [];
const CACHE = {};
const PROPS = {};
const LOGS = [];

global.SpreadsheetApp = {
  getActiveSpreadsheet: () => null,
  openById: () => DB,
  create: () => DB
};
global.CacheService = {
  getScriptCache: () => ({
    get: k => (CACHE[k] !== undefined ? CACHE[k] : null),
    put: (k, v) => { CACHE[k] = String(v); },
    remove: k => { delete CACHE[k]; }
  })
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => PROPS[k], setProperty: (k, v) => { PROPS[k] = v; } }) };
global.LockService = { getScriptLock: () => ({ waitLock: () => true, releaseLock: () => true }) };
global.MailApp = { sendEmail: (to, subj, body) => SENT_MAIL.push({ to, subj, body }) };
global.ScriptApp = {
  getProjectTriggers: () => [], deleteTrigger: () => {},
  newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }),
  getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' })
};
global.Logger = { log: (t) => LOGS.push(String(t)) };

/* --- эмуляция Telegram Bot API: запоминаем все обращения к боту --- */
const TG_CALLS = [];
const AI_CALLS = [];
const AI_ANSWER = 'ИИ отвечает: сайт для салона — от 30 000 ₽, оплата 50/50.';
let TG_UPDATES = [];                                     /* что бот «видит» в getUpdates */
let TG_ME = { ok: true, result: { username: 'venera_leads_test_bot', first_name: 'Тест' } };
function tgResp(obj) { return { getResponseCode: () => 200, getContentText: () => JSON.stringify(obj) }; }
global.UrlFetchApp = {
  fetch: (url, opts) => {
    opts = opts || {};
    if (/site-data\.js/.test(url)) {
      return { getContentText: () => fs.readFileSync(path.join(__dirname, '..', 'site-data.js'), 'utf8'),
               getResponseCode: () => 200 };
    }
    if (/api\.z\.ai/.test(url)) {
      let payload = {};
      try { payload = JSON.parse(opts.payload || '{}'); } catch (e) {}
      const auth = (opts.headers || {})['Authorization'] || '';
      AI_CALLS.push({ auth, payload });
      if (/GOODKEY/.test(auth)) {
        return tgResp({ choices: [{ message: { content: '**ИИ отвечает:** сайт для салона — от 30 000 ₽, оплата 50/50.' } }] });
      }
      return { getResponseCode: () => 401, getContentText: () => '{"error":"invalid key"}' };
    }
    const tg = /api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url);
    if (tg) {
      const method = tg[2];
      let payload = {};
      try { payload = JSON.parse(opts.payload || '{}'); } catch (e) {}
      TG_CALLS.push({ method, payload, token: tg[1] });
      if (method === 'getMe') return tgResp(TG_ME);
      if (method === 'getUpdates') return tgResp({ ok: true, result: TG_UPDATES });
      if (method === 'sendMessage') {
        return tgResp(payload.chat_id ? { ok: true, result: { message_id: TG_CALLS.length } }
                                      : { ok: false, description: 'Bad Request: chat_id is empty' });
      }
      return tgResp({ ok: true, result: true });
    }
    return { getContentText: () => '', getResponseCode: () => 200 };
  }
};
global.Utilities = {
  getUuid: () => 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  formatDate: (d, tz, pattern) => {
    const p = n => String(n).padStart(2, '0');
    return pattern
      .replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
  }
};
global.Session = { getScriptTimeZone: () => 'Etc/GMT' };
global.ContentService = {
  MimeType: { JAVASCRIPT: 'javascript', JSON: 'JSON' },
  createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t, text: t }) })
};

/* ---------------- загружаем сам сервер ---------------- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'backend', 'appsscript.gs'), 'utf8');
/* в репозитории токен — плейсхолдер; для теста подставляем свой, не трогая файл */
const TOKEN = 'ECLAT-TEST-TOKEN';
const LEAD_TOKEN = '123456:TEST-LEAD-BOT';
const AI_KEY = 'GOODKEY-ZAI-TEST';
(0, eval)(SRC
  .replace("var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';", 'var ADMIN_TOKEN = ' + JSON.stringify(TOKEN) + ';')
  .replace("var LEAD_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_БОТА_ЗАЯВОК';", 'var LEAD_BOT_TOKEN = ' + JSON.stringify(LEAD_TOKEN) + ';')
  .replace(/var ZAI_KEY\s*=\s*'ВСТАВЬТЕ_КЛЮЧ_ZAI';/, 'var ZAI_KEY = ' + JSON.stringify(AI_KEY) + ';'));

if (global.hasAi() !== true) {
  console.error('Тест не смог подменить ZAI_KEY — проверьте строку объявления в appsscript.gs');
  process.exit(1);
}

if (global.ADMIN_TOKEN === 'ВСТАВЬТЕ_СВОЙ_ТОКЕН') {
  console.error('Тест не смог подменить ADMIN_TOKEN — проверьте строку объявления в appsscript.gs');
  process.exit(1);
}

/* ---------------- хелперы ---------------- */
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const call = (params) => JSON.parse(global.doGet({ parameter: params }).getContent());
const future = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* свободное окно мастера на дату: учитывает график, перерывы и уже занятые слоты */
function freeSlot(masterId, date, minutes) {
  const c = global.catalog();
  const m = c.MASTERS.filter(x => x.id === masterId)[0];
  const day = global.masterDay(m, date, c.SITE);
  if (!day) return null;
  const busy = [];
  call({ action: 'busy', from: date, to: date }).bookings.forEach(b => { if (b.masterId === masterId) busy.push([b.startMin, b.endMin]); });
  call({ action: 'busy', from: date, to: date }).blocks.forEach(b => { if (b.masterId === masterId || b.masterId === 'all') busy.push([b.startMin, b.endMin]); });
  const buf = c.SETTINGS.bufferMin || 0;
  for (let t = day.open; t + minutes <= day.close; t += c.SETTINGS.slotStep || 15) {
    const s = t, e = t + minutes;
    const hitBreak = day.breaks.some(b => global.overlap(s, e, b.s, b.e));
    const hitBusy = busy.some(b => global.overlap(s, e, b[0] - buf, b[1] + buf));
    if (!hitBreak && !hitBusy) return s;
  }
  return null;
}

/* завтра, суббота/любой день — берём день, когда работает m1 (Алиса) */
function workdayFor(masterId) {
  const cat = global.catalog();
  const m = cat.MASTERS.filter(x => x.id === masterId)[0];
  const days = (m.schedule && m.schedule.days) || [0, 1, 2, 3, 4, 5, 6];
  for (let i = 2; i < 40; i++) {
    const d = future(i);
    if (days.indexOf(new Date(d + 'T12:00:00').getDay()) >= 0) {
      const vac = m.vacation || [];
      const blocked = vac.some(v => v === d || (v.from && v.to && d >= v.from && d <= v.to));
      if (!blocked) return d;
    }
  }
  return future(3);
}

console.log('\n=== ÉCLAT pipe: тесты сервера записи ===\n');

/* ---------- 0. диагностика ---------- */
t('ping отвечает ok', () => assert.strictEqual(call({ action: 'ping' }).ok, true));
t('неизвестное действие возвращает понятную ошибку и список доступных', () => {
  const r = call({ action: 'ololo' });
  assert.strictEqual(r.ok, false); assert.ok(/busy/.test(r.hint));
});
t('test показывает состояние трубы и каталога', () => {
  const r = call({ action: 'test' });
  assert.strictEqual(r.ok, true);
  assert.ok(r.services > 10, 'услуги прочитаны из site-data.js: ' + r.services);
  assert.strictEqual(r.masters, 4);
  assert.strictEqual(r.catalogOk, true);
});
t('JSONP-обёртка работает (cb=имя)', () => {
  const raw = global.doGet({ parameter: { action: 'ping', cb: 'eclat_cb_x1' } }).getContent();
  assert.ok(/^eclat_cb_x1\(\{/.test(raw), raw.slice(0, 40));
});

/* ---------- 1. каталог ---------- */
t('site-data.js разобран без eval: цена и длительность на месте', () => {
  const c = global.catalog();
  const w1 = c.SERVICES.filter(s => s.id === 'w1')[0];
  assert.strictEqual(w1.title, 'Женская стрижка');
  assert.strictEqual(w1.price, 2700); assert.strictEqual(w1.minutes, 60);
  assert.deepStrictEqual(w1.masters, ['m1', 'm4']);
  assert.strictEqual(c.DISCOUNT.percent, 50);
  assert.strictEqual(c.SETTINGS.bufferMin, 10);
});

/* ---------- 2. ГЛАВНЫЙ БАГ: book c data=JSON ---------- */
const D = workdayFor('m1');
const S1 = freeSlot('m1', D, 60);
let id1;
t('book принимает data=JSON и возвращает живой номер ECL-0001', () => {
  assert.ok(S1 != null, 'не нашлось свободного окна для теста');
  const payload = { serviceId: 'w1', masterId: 'm1', date: D, startMin: S1, name: 'Анна Тестова',
    phone: '+7 931 000-11-22', comment: 'тест трубы', pension: false, consent: true, minutes: 60 };
  const r = call({ action: 'book', data: JSON.stringify(payload) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.id, 'ECL-0001');
  assert.strictEqual(r.booking.service, 'Женская стрижка');
  assert.strictEqual(r.booking.master, 'Алиса');
  assert.strictEqual(r.booking.startMin, S1); assert.strictEqual(r.booking.endMin, S1 + 60);
  assert.ok(/^\d\d:\d\d$/.test(r.booking.start), 'время человекочитаемое: ' + r.booking.start);
  id1 = r.id;
});
t('письмо владельцу содержит ВСЕ поля (больше никаких undefined)', () => {
  assert.strictEqual(SENT_MAIL.length, 1);
  const b = SENT_MAIL[0].body;
  assert.ok(!/undefined/.test(b), 'в письме есть undefined:\n' + b);
  const hm = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  ['ECL-0001', D, hm(S1) + ' – ' + hm(S1+60), 'Алиса', 'Женская стрижка', 'Анна Тестова', '+7 931 000-11-22', '2700 руб.'].forEach(x =>
    assert.ok(b.indexOf(x) >= 0, 'нет «' + x + '» в письме'));
});
t('строка в таблице: человекочитаемые и машинные поля совпали', () => {
  const s = DB.getSheetByName('Записи');
  const r = s.v[1];
  assert.strictEqual(r[0], 'ECL-0001'); assert.strictEqual(r[1], D);
  assert.strictEqual(r[4], 'Алиса'); assert.strictEqual(r[5], 'Женская стрижка');
  assert.strictEqual(r[14], 'm1'); assert.strictEqual(r[15], 'w1');
  assert.strictEqual(r[16], S1); assert.strictEqual(r[17], S1 + 60);
});

/* ---------- 3. busy: сайт видит занятые окна ---------- */
t('busy отдаёт записи в формате движка сайта (masterId/startMin/status)', () => {
  const r = call({ action: 'busy', from: D, to: future(30) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.bookings.length, 1);
  const b = r.bookings[0];
  assert.strictEqual(b.masterId, 'm1'); assert.strictEqual(b.startMin, S1); assert.strictEqual(b.endMin, S1 + 60);
  assert.strictEqual(b.status, 'confirmed'); assert.strictEqual(b.date, D);
  assert.ok(Array.isArray(r.blocks));
});

/* ---------- 4. защита от двойного бронирования ---------- */
t('то же время тому же мастеру — отказ conflict', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: S1, name: 'Вторая Анна', phone: '+79310001122', consent: true }) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'conflict');
});
t('пересечение с учётом буфера 10 минут — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: S1 + 55, name: 'Буфер Тест', phone: '+79310001122', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('другой мастер в то же время — можно (запись ECL-0002)', () => {
  const c = global.catalog();
  const m4day = workdayFor('m4');
  const svc = c.SERVICES.filter(s => (s.masters || []).indexOf('m4') >= 0)[0];
  const slot = freeSlot('m4', m4day, svc.minutes);
  assert.ok(slot != null, 'нет окна у m4');
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: svc.id, masterId: 'm4', date: m4day, startMin: slot, name: 'Диана Клиент', phone: '+79310001133', consent: true }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.id, 'ECL-0002');
});

/* ---------- 5. пенсионная скидка считается на сервере ---------- */
t('pension:true → скидка 50% (2700 → 1350), браузер не переспрашиваем', () => {
  const slot = freeSlot('m1', D, 60);
  assert.ok(slot != null, 'нет окна для пенсионного теста');
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: slot, name: 'Пенсионерка', phone: '+79310001144', pension: true, consent: true }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.booking.price, 1350); assert.strictEqual(r.booking.priceBase, 2700);
  assert.strictEqual(r.booking.discountPercent, 50);
  assert.ok(/скидка 50%/.test(SENT_MAIL[SENT_MAIL.length - 1].body));
});
t('подделанная цена клиента игнорируется', () => {
  const slot = freeSlot('m1', D, 60);
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: slot, name: 'Хитрый Клиент', phone: '+79310001155', price: 1, consent: true }) });
  assert.strictEqual(r.ok, true); assert.strictEqual(r.booking.price, 2700);
});

/* ---------- 6. валидация ---------- */
t('короткое имя — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: 960, name: 'А', phone: '+79310001155', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('неполный телефон — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: 960, name: 'Оля', phone: '123', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('нет согласия — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: 960, name: 'Оля', phone: '+79310001155', consent: false }) });
  assert.strictEqual(r.ok, false);
});
t('прошедшая дата — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: '2020-01-05', startMin: 600, name: 'Оля', phone: '+79310001155', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('время вне графика салона (03:00) — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: 180, name: 'Оля', phone: '+79310001155', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('мастер не выполняет услугу (w1 у m2) — отказ', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm2', date: D, startMin: 600, name: 'Оля', phone: '+79310001155', consent: true }) });
  assert.strictEqual(r.ok, false);
});
t('мусор в data — понятная ошибка, не падение', () => {
  const r = call({ action: 'book', data: '{не json' });
  assert.strictEqual(r.ok, false); assert.ok(/разобрать/.test(r.ru));
});

/* ---------- 7. блоки ---------- */
t('addBlock закрывает интервал для сайта (busy возвращает блок с masterId)', () => {
  const r = call({ action: 'addBlock', date: D, start: '14:00', end: '15:00', master: 'm1', reason: 'обед', token: TOKEN });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.masterId, 'm1');
  const b = call({ action: 'busy', from: D, to: D });
  assert.strictEqual(b.blocks.length, 1);
  assert.strictEqual(b.blocks[0].startMin, 840); assert.strictEqual(b.blocks[0].masterId, 'm1');
});
t('запись внутрь блока — отказ conflict', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: 850, name: 'Оля', phone: '+79310001155', consent: true }) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'conflict');
});
t('addBlock по ИМЕНИ мастера (「Алиса」) тоже понимает', () => {
  const r = call({ action: 'addBlock', date: future(20), start: '12:00', end: '13:00', master: 'Алиса', reason: 'съёмка', token: TOKEN });
  assert.strictEqual(r.masterId, 'm1');
});
t('unblock убирает блок', () => {
  const bid = call({ action: 'addBlock', date: future(21), start: '12:00', end: '13:00', master: 'all', reason: 'ремонт', token: TOKEN }).id;
  assert.strictEqual(call({ action: 'unblock', id: bid, token: TOKEN }).ok, true);
});

/* ---------- 8. админка ---------- */
t('getStats без токена — отказ (bad token)', () => {
  const r = call({ action: 'getStats' });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.error, 'bad token');
});
t('getStats с токеном — счётчики', () => {
  const r = call({ action: 'getStats', token: TOKEN });
  assert.strictEqual(r.ok, true); assert.ok(r.total >= 3, 'total=' + r.total);
});
t('getDay отдаёт записи и блоки дня, отсортированные', () => {
  const r = call({ action: 'getDay', date: D, token: TOKEN });
  assert.strictEqual(r.ok, true); assert.ok(r.bookings.length >= 2);
  assert.ok(r.bookings[0].startMin <= r.bookings[1].startMin);
  assert.ok(r.bookings[0].phone.indexOf('+7 ') === 0, 'телефон человекочитаемый: ' + r.bookings[0].phone);
});
t('cancel помечает запись отменённой, busy её больше не отдаёт', () => {
  assert.strictEqual(call({ action: 'cancel', id: id1, token: TOKEN }).ok, true);
  const b = call({ action: 'busy', from: D, to: D });
  assert.ok(!b.bookings.some(x => x.id === id1));
  const st = call({ action: 'getStats', token: TOKEN });
  assert.ok(st.canceled >= 1);
});
t('после отмены время освободилось — можно записать снова', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: D, startMin: S1, name: 'Новая Анна', phone: '+79310001166', consent: true }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});
t('повторная отмена той же записи — вежливый отказ', () => {
  assert.strictEqual(call({ action: 'cancel', id: id1, token: TOKEN }).ok, false);
});
t('manualBook от админа пишет источник «админ» и не шлёт письмо', () => {
  const before = SENT_MAIL.length;
  const slot = freeSlot('m1', D, 60);
  const r = call({ action: 'manualBook', token: TOKEN, serviceId: 'w1', masterId: 'm1', date: D, startMin: slot, name: 'Клиент по звонку', phone: '+79310001177' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(SENT_MAIL.length, before);
  assert.strictEqual(r.booking.source, 'админ');
});
t('list за период', () => {
  const r = call({ action: 'list', from: D, to: future(40), token: TOKEN });
  assert.strictEqual(r.ok, true); assert.ok(r.count >= 3);
});
t('reload сбрасывает кеш каталога', () => {
  assert.strictEqual(call({ action: 'reload', token: TOKEN }).ok, true);
});

/* ---------- 8b. как данные хранятся в таблице (проверено на живых #ERROR!) ---------- */
t('телефон и время пишутся в ТЕКСТОВЫЕ колонки (формат «@») — плюсы больше не ломаются', () => {
  const s = DB.getSheetByName('Записи');
  [2, 3, 4, 7, 8, 9, 14].forEach(col =>
    assert.strictEqual(s.fmt['2:' + col], '@', 'колонка ' + col + ' не помечена текстом'));
});
t('телефон в таблице лежит дословно, со знаком +', () => {
  const s = DB.getSheetByName('Записи');
  const row = s.v.filter(r => String(r[0]) === 'ECL-0001')[0];
  assert.ok(row, 'нет строки ECL-0001');
  assert.strictEqual(row[7], '+7 931 000-11-22');
});
t('старые строки, где Google хранит время как Date (1899 год), читаются правильно', () => {
  const s = DB.getSheetByName('Записи');
  const legacy = new Array(20).fill('');
  legacy[0] = 'ECL-LEGACY';
  legacy[1] = new Date(2027, 0, 15);            // дата как Date-ячейка
  legacy[2] = new Date(1899, 11, 30, 17, 0);    // «17:00» — так Sheets хранит время
  legacy[3] = new Date(1899, 11, 30, 18, 30);
  legacy[4] = 'Диана'; legacy[5] = 'Стрижка и укладка';
  legacy[6] = 'Старая Запись'; legacy[7] = '+7 931 000-99-88';
  legacy[9] = 'подтверждена'; legacy[10] = 3200;
  legacy[14] = 'm4'; legacy[15] = 'w2';
  s.v.push(legacy);
  const b = call({ action: 'busy', from: '2027-01-15', to: '2027-01-15' });
  const rec = b.bookings.filter(x => x.id === 'ECL-LEGACY')[0];
  assert.ok(rec, 'старая запись не вернулась');
  assert.strictEqual(rec.date, '2027-01-15', 'дата: ' + rec.date);
  assert.strictEqual(rec.start, '17:00', 'начало: ' + rec.start);
  assert.strictEqual(rec.end, '18:30', 'конец: ' + rec.end);
  assert.strictEqual(rec.startMin, 1020); assert.strictEqual(rec.endMin, 1110);
  assert.ok(!/1899/.test(JSON.stringify(rec)), 'в ответе остался 1899 год: ' + JSON.stringify(rec));
});
t('старая запись занимает время: новая на тот же интервал не пройдёт', () => {
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w2', masterId: 'm4', date: '2027-01-15', startMin: 1020, name: 'Конфликт Со Старой', phone: '+79310001188', consent: true }) });
  assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'conflict');
});
t('test находит строки, испорченные старой версией (#ERROR! в телефоне)', () => {
  const s = DB.getSheetByName('Записи');
  const bad = new Array(20).fill('');
  bad[0] = 'ECL-BROKEN'; bad[1] = future(9); bad[2] = '12:00'; bad[3] = '13:00';
  bad[6] = 'Венера'; bad[7] = '#ERROR!'; bad[9] = 'подтверждена';
  bad[14] = 'm4'; bad[15] = 'w2'; bad[16] = 720; bad[17] = 780;
  s.v.push(bad);
  const r = call({ action: 'test' });
  assert.ok(r.brokenRows >= 1, 'битые строки не найдены');
  assert.ok(r.brokenIds.some(x => /ECL-BROKEN/.test(x) && /телефон/.test(x)), JSON.stringify(r.brokenIds));
});
t('нумерация не наследует старый формат ECL-1022-082712', () => {
  const s = DB.getSheetByName('Записи');
  const old = new Array(20).fill('');
  old[0] = 'ECL-9999-123456'; old[1] = future(10); old[9] = 'подтверждена';
  s.v.push(old);
  const id = global.nextId();
  assert.ok(/^ECL-\d{4,6}$/.test(id), 'странный номер: ' + id);
  assert.ok(id.indexOf('ECL-10000') !== 0, 'номер унаследован от старого формата: ' + id);
});

t('эмулятор честно повторяет Sheets: «+7…» через обычный appendRow = #ERROR!', () => {
  const s = DB.getSheetByName('Журнал');
  const before = s.v.length;
  s.appendRow(['x', '+7 900 000-00-00', '', '']);
  assert.strictEqual(s.v[before][1], '#ERROR!', 'эмулятор перестал моделировать баг Sheets');
});
t('РЕГРЕССИЯ v2.2: телефон новой записи лежит текстом, а не #ERROR! (баг с прода)', () => {
  const slot = freeSlot('m2', workdayFor('m2'), 60);
  const r = call({ action: 'book', data: JSON.stringify({ serviceId: 'w1', masterId: 'm1', date: workdayFor('m1'), startMin: freeSlot('m1', workdayFor('m1'), 60), name: 'Проверка Телефона', phone: '+7 927 850-44-16', consent: true }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const row = DB.getSheetByName('Записи').v.filter(x => String(x[0]) === r.id)[0];
  assert.ok(row, 'строка не найдена');
  assert.strictEqual(row[7], '+7 927 850-44-16', 'телефон в таблице: ' + row[7]);
  assert.ok(!/#ERROR/.test(row.join('|')), 'в строке остался #ERROR!');
});

/* ---------- 8c. заявки из чата в СТАБИЛЬНОЙ трубе записей ---------- */
t('lead: заявка из чата ложится в лист «Заявки из чата», телефон текстом', () => {
  const before = SENT_MAIL.length;
  const r = call({ action: 'lead', name: 'Анна', contact: '+7 927 850-44-16', message: 'диалог из чата', source: 'eclat-assistant' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sheet, true); assert.strictEqual(r.mail, true);
  const sh = DB.getSheetByName('Заявки из чата');
  assert.ok(sh, 'лист «Заявки из чата» не создан');
  const row = sh.v[1];
  assert.strictEqual(row[1], 'Анна');
  assert.strictEqual(row[2], '+7 927 850-44-16', 'контакт: ' + row[2]);
  assert.strictEqual(SENT_MAIL.length, before + 1, 'письмо не ушло');
});
t('lead публичный (без токена) — окошко сайта не хранит токен', () => {
  const r = call({ action: 'lead', name: 'Без Токена', contact: '79001112233', message: 'x', source: 'чат' });
  assert.strictEqual(r.ok, true);
});

/* ---------- 8d. приборка таблиц (пустые столбцы и обрезанный текст) ---------- */
t('tidyAll: чужая шапка журнала «Когда/Кому» ремонтируется на правильную', () => {
  const j = DB.getSheetByName('Журнал');
  j.v[0] = ['Когда', 'Событие', 'Кому', 'Тема', 'Статус', 'Ошибка'];
  global.tidyAll();
  assert.deepStrictEqual(j.v[0].slice(0, 4), ['Время', 'Событие', 'ID записи', 'Подробности']);
  assert.strictEqual(j.maxCols, 4, 'пустые колонки журнала не удалены: ' + j.maxCols);
});
t('tidyAll: лист «Записи» по размеру, шапка закреплена, услуга широкая', () => {
  const b = DB.getSheetByName('Записи');
  global.tidyAll();
  assert.strictEqual(b.maxCols, 20, 'колонок: ' + b.maxCols);
  assert.strictEqual(b.frozen, 1, 'шапка не закреплена');
  assert.strictEqual(b.widths[6], 160, 'ширина услуги: ' + b.widths[6]);
  assert.strictEqual(b.widths[8], 140, 'ширина телефона: ' + b.widths[8]);
});

t('leadusl: заявка с лендинга услуги падает в отдельную таблицу и шлёт письмо', () => {
  const before = SENT_MAIL.length;
  const r = call({ action: 'leadusl', salon: 'Локон', name: 'Мария', contact: '+7 900 123-45-67', want: 'Всё вместе', comment: 'город СПб, 4 мастера' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sheet, true); assert.strictEqual(r.mail, true);
  const sh = DB.getSheetByName('Лиды услуги');
  assert.ok(sh, 'таблица лидов не создана');
  const row = sh.v[1];
  assert.strictEqual(row[1], 'Локон');
  assert.strictEqual(row[3], '+7 900 123-45-67');
  assert.strictEqual(row[4], 'Всё вместе');
  assert.strictEqual(SENT_MAIL.length, before + 1);
});
t('leadusl не мешает записям салона: лист «Записи» не тронут', () => {
  const b = DB.getSheetByName('Записи');
  const n = b.v.length;
  call({ action: 'leadusl', salon: 'X', name: 'Y', contact: '70000000000', want: 'Сайт-витрина', comment: '' });
  assert.strictEqual(DB.getSheetByName('Записи').v.length, n);
});

/* ---------- 9. бот заявок: Telegram + мини-апп ---------- */
const tgPost = (tgParam, update) =>
  JSON.parse(global.doPost({ parameter: { tg: tgParam }, postData: { contents: JSON.stringify(update) } }).getContent());
const tgSent = () => TG_CALLS.filter(c => c.method === 'sendMessage');
const secret = () => global.PropertiesService.getScriptProperties().getProperty('LEAD_TG_SECRET');

t('ping честен про бота заявок: версия 2.4, бот, chat_id и «голова» ИИ на месте', () => {
  const r = call({ action: 'ping' });
  assert.strictEqual(r.version, 2.4);
  assert.strictEqual(r.ai, true, 'ключ Z.ai не подхватился');
  assert.strictEqual(r.leadBot, true, 'бот не подключён');
  assert.strictEqual(r.leadUsl, true);
});

t('setupLeadBot: сам находит chat_id, ставит мини-апп кнопку, команды и вебхук', () => {
  TG_CALLS.length = 0;
  TG_UPDATES = [{ update_id: 1, message: { message_id: 1, from: { id: 777001 },
    chat: { id: 777001, type: 'private', first_name: 'Венера' }, text: 'привет' } }];
  const r = global.setupLeadBot();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.chatId, '777001');
  const methods = TG_CALLS.map(c => c.method);
  ['getMe', 'getUpdates', 'setChatMenuButton', 'setMyCommands', 'setDescription', 'setWebhook', 'sendMessage']
    .forEach(m => assert.ok(methods.indexOf(m) >= 0, 'не вызван ' + m + '; было: ' + methods.join(',')));
  const mb = TG_CALLS.filter(c => c.method === 'setChatMenuButton')[0];
  assert.strictEqual(mb.payload.menu_button.type, 'web_app', 'кнопка-меню не мини-апп');
  assert.ok(/uslugi\/$/.test(mb.payload.menu_button.web_app.url), 'мини-апп ведёт не на лендинг: ' + mb.payload.menu_button.web_app.url);
  const wh = TG_CALLS.filter(c => c.method === 'setWebhook')[0];
  assert.ok(/[?&]tg=[a-z0-9]{16,}$/.test(wh.payload.url), 'вебхук без секрета: ' + wh.payload.url);
  assert.ok(TG_CALLS.every(c => c.token === LEAD_TOKEN), 'бот заявок дёргается чужим токеном');
  assert.ok(secret(), 'секрет вебхука не сохранён');
});

t('leadusl: заявка приходит в Telegram владельцу бота', () => {
  TG_CALLS.length = 0;
  const r = call({ action: 'leadusl', salon: 'Бархат', name: 'Ольга', contact: '+7 917 000-00-00',
                   want: 'Бот', comment: 'Казань, 3 мастера', src: 'telegram-miniapp' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.tg, true, 'телеграм не отправлен: ' + JSON.stringify(r));
  assert.strictEqual(r.src, 'мини-апп Telegram');
  assert.strictEqual(tgSent().length, 1);
  assert.strictEqual(String(tgSent()[0].payload.chat_id), '777001');
  const txt = tgSent()[0].payload.text;
  ['Бархат', 'Ольга', '+7 917 000-00-00', 'Бот', 'мини-апп Telegram'].forEach(x =>
    assert.ok(txt.indexOf(x) >= 0, 'в сообщении нет «' + x + '»: ' + txt));
});

t('leadusl: «Источник» попадает в таблицу и в письмо', () => {
  const sh = DB.getSheetByName('Лиды услуги');
  assert.strictEqual(sh.v[0].length, 8, 'шапка: ' + sh.v[0].join('|'));
  assert.strictEqual(sh.v[0][7], 'Источник');
  const row = sh.v[sh.v.length - 1];
  assert.strictEqual(row[7], 'мини-апп Telegram');
  assert.ok(/мини-апп Telegram/.test(SENT_MAIL[SENT_MAIL.length - 1].body), 'в письме нет источника');
});

t('старая таблица лидов на 7 колонок сама доучивается до 8', () => {
  const sh = DB.getSheetByName('Лиды услуги');
  sh.v[0] = ['Дата', 'Салон', 'Контактное лицо', 'Контакт', 'Что интересует', 'Комментарий', 'Статус'];
  call({ action: 'leadusl', salon: 'Ремонт шапки', name: 'А', contact: '70000000001', want: 'Сайт', comment: '' });
  assert.strictEqual(sh.v[0].length, 8, 'шапка не починена: ' + sh.v[0].join('|'));
  assert.strictEqual(sh.v[0][7], 'Источник');
});

t('без токена бота заявка всё равно сохраняется (таблица + письмо)', () => {
  const saved = global.LEAD_BOT_TOKEN;
  global.LEAD_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_БОТА_ЗАЯВОК';
  TG_CALLS.length = 0;
  const mails = SENT_MAIL.length;
  const r = call({ action: 'leadusl', salon: 'БезБота', name: 'Н', contact: '70000000002', want: 'Сайт', comment: '' });
  global.LEAD_BOT_TOKEN = saved;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.tg, false, 'телеграм «отправился» без токена');
  assert.strictEqual(tgSent().length, 0);
  assert.strictEqual(SENT_MAIL.length, mails + 1, 'письмо не ушло');
});

t('бот отвечает на /start кнопкой мини-аппа', () => {
  TG_CALLS.length = 0;
  const r = tgPost(secret(), { update_id: 9, message: { message_id: 9, from: { id: 555 },
    chat: { id: 555, type: 'private' }, text: '/start' } });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(tgSent().length, 1);
  assert.strictEqual(tgSent()[0].payload.chat_id, 555);
  const kb = tgSent()[0].payload.reply_markup.inline_keyboard[0][0];
  assert.ok(kb.web_app && /uslugi\/$/.test(kb.web_app.url), 'в /start нет кнопки мини-аппа');
});

t('/price отвечает ценами «от 30 000 ₽»', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 11, message: { chat: { id: 555 }, text: '/price' } });
  assert.strictEqual(tgSent().length, 1);
  const txt = tgSent()[0].payload.text;
  assert.ok((txt.match(/30 000 ₽/g) || []).length >= 3, 'цены не все: ' + txt);
  assert.ok(/50\/50/.test(txt), 'нет условия оплаты');
});

t('живой текст: человек получает ответ, владелица — уведомление со ссылкой «ответить»', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 12, message: { from: { id: 888, username: 'salon_kzn' },
    chat: { id: 888, type: 'private' }, text: 'Здравствуйте, хочу сайт для салона, Казань' } });
  assert.strictEqual(tgSent().length, 2, 'должно быть два сообщения: ' + JSON.stringify(tgSent().map(x => x.payload.chat_id)));
  assert.strictEqual(tgSent()[0].payload.chat_id, 888);
  assert.ok(tgSent()[0].payload.reply_markup.inline_keyboard[0][0].web_app, 'в ответе нет кнопки мини-аппа');
  assert.strictEqual(String(tgSent()[1].payload.chat_id), '777001', 'владелице не пришло уведомление');
  const note = tgSent()[1].payload.text;
  assert.ok(/salon_kzn/.test(note), 'в уведомлении нет ника: ' + note);
  assert.ok(/t\.me\/salon_kzn/.test(note), 'нет ссылки «ответить»: ' + note);
  assert.ok(/Казань/.test(note), 'текст клиента потерялся');
});

t('просто «привет» — приветствие без лишнего уведомления владелице', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 14, message: { from: { id: 999 }, chat: { id: 999, type: 'private' }, text: 'привет' } });
  assert.strictEqual(tgSent().length, 1, 'сообщений: ' + tgSent().length);
  assert.strictEqual(tgSent()[0].payload.chat_id, 999);
});

t('/site даёт кнопку мини-аппа и ничего лишнего', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 15, message: { chat: { id: 999 }, text: '/site' } });
  assert.strictEqual(tgSent().length, 1);
  assert.ok(/uslugi\/$/.test(tgSent()[0].payload.reply_markup.inline_keyboard[0][0].web_app.url));
});

t('чужой запрос на вебхук (неверный секрет) бота не дёргает', () => {
  TG_CALLS.length = 0;
  const r = tgPost('неверный-секрет', { update_id: 13, message: { chat: { id: 1 }, text: '/start' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(tgSent().length, 0);
});

t('doPost с обычными данными сайта работает как раньше', () => {
  const r = JSON.parse(global.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'ping' }) } }).getContent());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.version, 2.4);
});

/* ---------- 9b. «ГОЛОВА» ИИ бота заявок (ключ Z.ai) ---------- */
t('test честно показывает, что ключ Z.ai вставлен', () => {
  const r = call({ action: 'test' });
  assert.strictEqual(r.aiKeySet, true);
  assert.ok(/glm/.test(r.aiModel), 'модель: ' + r.aiModel);
});

t('живой вопрос: отвечает НЕЙРОСЕТЬ, а не заготовка', () => {
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 20, message: { from: { id: 888, username: 'salon_kzn' },
    chat: { id: 888, type: 'private' }, text: 'Сколько стоит сайт для салона в Казани?' } });
  assert.strictEqual(AI_CALLS.length, 1, 'нейросеть не вызвана');
  assert.ok(/Bearer GOODKEY/.test(AI_CALLS[0].auth), 'ключ не передан: ' + AI_CALLS[0].auth);
  assert.strictEqual(AI_CALLS[0].payload.model, 'glm-4.5-flash');
  const toUser = tgSent().filter(c => c.payload.chat_id === 888);
  assert.strictEqual(toUser.length, 1);
  assert.ok(/30 000 ₽/.test(toUser[0].payload.text), 'ответ не от ИИ: ' + toUser[0].payload.text);
  assert.ok(!/\*\*/.test(toUser[0].payload.text), 'в ответе остался markdown: ' + toUser[0].payload.text);
  assert.ok(toUser[0].payload.text.length <= 4096, 'сообщение длиннее лимита Telegram');
  assert.ok(toUser[0].payload.reply_markup.inline_keyboard[0][0].web_app, 'в ответе ИИ пропала кнопка мини-аппа');
});

t('системный промпт ИИ: только честные факты (цены, 50/50, демо, контакты)', () => {
  const sys = AI_CALLS[0].payload.messages[0];
  assert.strictEqual(sys.role, 'system');
  ['от 30 000 ₽', '50/50', '+7 927 850-44-16', 'venera.web.4@gmail.com', 'ДЕМО', 'не выдумывай'].forEach(x =>
    assert.ok(sys.content.indexOf(x) >= 0, 'в промпте нет «' + x + '»'));
  assert.ok(sys.content.indexOf('шаблон') < 0 || /Не говори|не называй|слово «шаблон»/i.test(sys.content),
    'слово «шаблон» разрешено ИИ');
});

t('бот помнит диалог: во второй вопрос уходит история', () => {
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 21, message: { from: { id: 888 }, chat: { id: 888, type: 'private' }, text: 'А сколько по времени делать?' } });
  const m = AI_CALLS[0].payload.messages;
  assert.ok(m.length >= 4, 'история не передана: ' + m.length + ' сообщ.');
  assert.strictEqual(m[0].role, 'system', 'первым должно идти «что бот знает о деле»');
  assert.strictEqual(m[1].role, 'user', 'вторым должно идти воспоминание о прошлой реплике');
  assert.ok(/сайт для салона/i.test(m[1].content), 'прошлая реплика потерялась: ' + m[1].content);
  assert.ok(m.some(x => x.role === 'assistant' && /30 000 ₽/.test(x.content)), 'прошлый ОТВЕТ бота не запомнен');
  assert.strictEqual(m[m.length - 1].content, 'А сколько по времени делать?');
  assert.ok(m.length <= 12, 'память разрастается без предела: ' + m.length);
});

t('человек оставил телефон — он сразу ложится в таблицу лидов', () => {
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  const sh = DB.getSheetByName('Лиды услуги');
  const before = sh.v.length;
  tgPost(secret(), { update_id: 22, message: { from: { id: 4242, first_name: 'Ирина', last_name: 'П.' },
    chat: { id: 4242, type: 'private' }, text: 'Хочу сайт, мой телефон 8 (917) 222-33-44' } });
  assert.strictEqual(sh.v.length, before + 1, 'строка лида не добавилась');
  const row = sh.v[sh.v.length - 1];
  assert.strictEqual(row[3], '+7 917 222-33-44', 'контакт: ' + row[3]);
  assert.strictEqual(row[7], 'чат с ботом', 'источник: ' + row[7]);
  assert.ok(/Хочу сайт/.test(row[5]), 'текст клиента не сохранён: ' + row[5]);
  const owner = tgSent().filter(c => String(c.payload.chat_id) === '777001');
  assert.strictEqual(owner.length, 1, 'владелице пришло ' + owner.length + ' сообщений');
  assert.ok(/ТЕПЛЫЙ ЛИД/.test(owner[0].payload.text), owner[0].payload.text);
  assert.ok(/Ирина/.test(owner[0].payload.text), 'в уведомлении нет имени');
});

t('«12 мастеров, салон с 2010 года» телефоном НЕ считается (ложных лидов нет)', () => {
  TG_CALLS.length = 0;
  const sh = DB.getSheetByName('Лиды услуги');
  const before = sh.v.length;
  tgPost(secret(), { update_id: 25, message: { from: { id: 3131 }, chat: { id: 3131, type: 'private' },
    text: 'У нас 12 мастеров, салон работает с 2010 года, бюджет примерно 300000' } });
  assert.strictEqual(sh.v.length, before, 'в таблицу лёг ложный лид: ' + sh.v.slice(-1)[0]);
  const owner = tgSent().filter(c => String(c.payload.chat_id) === '777001');
  assert.strictEqual(owner.length, 1);
  assert.ok(!/ТЕПЛЫЙ ЛИД/.test(owner[0].payload.text), owner[0].payload.text);
});

t('телефон в любом написании узнаётся: 89172223344, +7 917 222 33 44, (917)222-33-44', () => {
  ['мой номер 89172223344', 'пишите на +7 917 222 33 44', 'тел (917)222-33-44'].forEach(txt => {
    const sh = DB.getSheetByName('Лиды услуги');
    const before = sh.v.length;
    tgPost(secret(), { update_id: 26, message: { from: { id: 5150 }, chat: { id: 5150, type: 'private' }, text: txt } });
    assert.strictEqual(sh.v.length, before + 1, 'не распознан телефон в «' + txt + '»');
    assert.strictEqual(sh.v.slice(-1)[0][3], '+7 917 222-33-44', txt + ' → ' + sh.v.slice(-1)[0][3]);
  });
});

t('без ключа Z.ai бот не молчит: вежливая запасная фраза + уведомление владелице', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'ВСТАВЬТЕ_КЛЮЧ_ZAI';
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 23, message: { from: { id: 555 }, chat: { id: 555, type: 'private' }, text: 'здравствуйте, расскажите про бота' } });
  global.ZAI_KEY = saved;
  assert.strictEqual(AI_CALLS.length, 0, 'без ключа полезли в нейросеть');
  const toUser = tgSent().filter(c => c.payload.chat_id === 555);
  assert.strictEqual(toUser.length, 1);
  assert.ok(/Венер|ответит лично/i.test(toUser[0].payload.text), toUser[0].payload.text);
  assert.ok(!/401|invalid key|ошибка/i.test(toUser[0].payload.text), 'клиенту показали техническую ошибку');
  assert.strictEqual(tgSent().filter(c => String(c.payload.chat_id) === '777001').length, 1, 'владелица не узнала о сообщении');
});

t('если Z.ai ответил ошибкой — клиент получает запасную фразу, а не тишину', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'BADKEY-401';
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 24, message: { from: { id: 666 }, chat: { id: 666, type: 'private' }, text: 'а что входит в сайт?' } });
  global.ZAI_KEY = saved;
  const toUser = tgSent().filter(c => c.payload.chat_id === 666);
  assert.strictEqual(toUser.length, 1);
  assert.ok(/BADKEY|401/.test(toUser[0].payload.text) === false, toUser[0].payload.text);
  assert.ok(toUser[0].payload.text.length > 40, 'ответ слишком короткий: ' + toUser[0].payload.text);
});

t('testAiHead: проверка «головы» из редактора пишет в журнал и в Telegram', () => {
  TG_CALLS.length = 0;
  const r = global.testAiHead();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(/30 000/.test(r.answer), r.answer);
  assert.ok(tgSent().some(c => /ПРОВЕРКА|Проверка/.test(c.payload.text)), 'нет сообщения о проверке');
});

t('aiTest по ссылке из админки требует токен и возвращает ответ ИИ', () => {
  assert.strictEqual(call({ action: 'aiTest' }).ok, false, 'aiTest работает без токена!');
  const r = call({ action: 'aiTest', token: TOKEN });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.ai, true);
  assert.ok(/30 000/.test(r.answer), r.answer);
});

/* ---------- 9c. КРАСИВАЯ ТАБЛИЦА: без пустых колонок, по-русски, текст целиком ---------- */
t('таблица лидов: ровно 8 колонок, пустых справа нет', () => {
  const sh = DB.getSheetByName('Лиды услуги');
  global.tidyAll();
  assert.strictEqual(sh.maxCols, 8, 'колонок: ' + sh.maxCols);
  assert.strictEqual(sh.v[0].length, 8);
});

t('заголовки — по-русски, и все на месте', () => {
  const head = DB.getSheetByName('Лиды услуги').v[0];
  assert.deepStrictEqual(head, ['Дата', 'Салон', 'Контактное лицо', 'Контакт', 'Что интересует', 'Комментарий', 'Статус', 'Источник']);
  head.forEach(h => assert.ok(h && /[а-яА-Я]/.test(h), 'заголовок не по-русски: ' + h));
});

t('шапка оформлена: фирменный фон, белый жирный текст, закреплена', () => {
  const sh = DB.getSheetByName('Лиды услуги');
  assert.strictEqual(sh.style['1:1:bg'], '#4C2E9E', 'фон шапки: ' + sh.style['1:1:bg']);
  assert.strictEqual(sh.style['1:1:color'], '#FFFFFF');
  assert.strictEqual(sh.style['1:8:bold'], 'bold');
  assert.strictEqual(sh.frozen, 1, 'шапка не закреплена');
});

t('длинный текст — с переносом и в широкой колонке, ничего не обрезано', () => {
  const sh = DB.getSheetByName('Лиды услуги');
  const n = sh.v.length;
  assert.ok(sh.widths[6] >= 520, 'колонка «Комментарий» узкая: ' + sh.widths[6]);
  for (let r = 2; r <= n; r++) assert.strictEqual(sh.style[r + ':6:wrap'], true, 'в строке ' + r + ' нет переноса текста');
  assert.deepStrictEqual(sh.resized, [2, n - 1], 'высота строк не подобрана по содержимому');
  assert.strictEqual(sh.style['2:1:valign'], 'top', 'текст не прижат к верху');
});

t('диалог на 25 000 знаков сохраняется ЦЕЛИКОМ (лимит Google — 50 000)', () => {
  const long = Array.from({ length: 500 }, (_, i) => 'Клиент: строка диалога номер ' + (i + 1) + ' — вопрос про сайт и цены.').join('\n');
  assert.ok(long.length > 25000, 'тестовый текст короткий: ' + long.length);
  const r = call({ action: 'leadusl', salon: 'Длинный Диалог', name: 'Т', contact: '70000000008', want: 'Сайт', comment: long });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const row = DB.getSheetByName('Лиды услуги').v.slice(-1)[0];
  assert.strictEqual(row[5].length, long.length, 'сохранено ' + row[5].length + ' из ' + long.length);
  assert.strictEqual(row[5], long, 'текст диалога искажён');
});

t('заявка из чата салона: лист «Заявки из чата» тоже по размеру и с переносом', () => {
  call({ action: 'lead', name: 'Клиент Салона', contact: '+7 900 000-00-00', message: 'длинный диалог\n'.repeat(200), source: 'eclat-assistant' });
  const sh = DB.getSheetByName('Заявки из чата');
  global.tidyAll();
  assert.strictEqual(sh.maxCols, 5, 'колонок: ' + sh.maxCols);
  assert.strictEqual(sh.widths[4], 620, 'ширина диалога: ' + sh.widths[4]);
  assert.strictEqual(sh.style['1:4:bg'], '#4C2E9E', 'шапка не оформлена');
  assert.strictEqual(sh.frozen, 1);
});

t('новая таблица создаётся без пустой вкладки «Sheet1»', () => {
  const fresh = new Spreadsheet('свежая');
  const s1 = new Sheet('Sheet1');
  fresh.sheets.push(s1);
  const savedCreate = global.SpreadsheetApp.create, savedOpen = global.SpreadsheetApp.openById, savedId = PROPS['USL_DB_ID'];
  global.SpreadsheetApp.create = () => fresh;
  global.SpreadsheetApp.openById = () => fresh;
  PROPS['USL_DB_ID'] = 'FRESH_ID';
  const r = call({ action: 'leadusl', salon: 'Свежая Таблица', name: 'Т', contact: '70000000009', want: 'Сайт', comment: 'первая заявка' });
  global.SpreadsheetApp.create = savedCreate; global.SpreadsheetApp.openById = savedOpen;
  if (savedId === undefined) delete PROPS['USL_DB_ID']; else PROPS['USL_DB_ID'] = savedId;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(fresh.getSheets().length, 1, 'вкладок: ' + fresh.getSheets().map(x => x.name).join(','));
  assert.strictEqual(fresh.getSheets()[0].name, 'Лиды услуги');
  assert.deepStrictEqual(fresh.getSheets()[0].v[0], ['Дата', 'Салон', 'Контактное лицо', 'Контакт', 'Что интересует', 'Комментарий', 'Статус', 'Источник']);
  assert.strictEqual(fresh.getSheets()[0].maxCols, 8, 'пустые колонки остались: ' + fresh.getSheets()[0].maxCols);
});

t('tidyAll убирает пустую вкладку «Sheet1» из рабочей таблицы', () => {
  const junk = new Sheet('Sheet1');
  DB.sheets.push(junk);
  global.tidyAll();
  assert.strictEqual(DB.getSheetByName('Sheet1'), null, 'пустая вкладка не удалена');
  assert.ok(DB.getSheetByName('Записи'), 'рабочие листы задеты');
});

/* ---------- 10. журнал ---------- */
t('журнал пишет события', () => {
  const s = DB.getSheetByName('Журнал');
  assert.ok(s && s.getLastRow() > 2, 'журнал пуст');
});

console.log('\n=== ' + pass + ' пройдено, ' + fail + ' провалено ===');
console.log('Писем отправлено: ' + SENT_MAIL.length + ', записей в базе: ' + DB.getSheetByName('Записи').getLastRow() + '\n');
process.exit(fail ? 1 : 0);
