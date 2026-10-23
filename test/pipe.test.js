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
  constructor(name) { this.name = name; this.v = []; this.fmt = {}; this.widths = {}; this.maxCols = 26; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  deleteColumns(start, n) { this.maxCols = Math.min(this.maxCols, start - 1); return this; }
  getMaxColumns() { return this.maxCols; }
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
      setWrap: () => range,
      setVerticalAlignment: () => range,
      setFontWeight: () => range,
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
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
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
global.ScriptApp = { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ everyHours: () => ({ create: () => {} }) }) }) };
global.UrlFetchApp = {
  fetch: (url) => {
    if (/site-data\.js/.test(url)) {
      return { getContentText: () => fs.readFileSync(path.join(__dirname, '..', 'site-data.js'), 'utf8') };
    }
    return { getContentText: () => '' };
  }
};
global.Utilities = {
  formatDate: (d, tz, pattern) => {
    const p = n => String(n).padStart(2, '0');
    return pattern
      .replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
  }
};
global.Session = { getScriptTimeZone: () => 'Etc/GMT' };
global.ContentService = {
  MimeType: { JAVASCRIPT: 'javascript' },
  createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t, text: t }) })
};

/* ---------------- загружаем сам сервер ---------------- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'backend', 'appsscript.gs'), 'utf8');
/* в репозитории токен — плейсхолдер; для теста подставляем свой, не трогая файл */
const TOKEN = 'ECLAT-TEST-TOKEN';
(0, eval)(SRC.replace("var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';", 'var ADMIN_TOKEN = ' + JSON.stringify(TOKEN) + ';'));

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

/* ---------- 9. журнал ---------- */
t('журнал пишет события', () => {
  const s = DB.getSheetByName('Журнал');
  assert.ok(s && s.getLastRow() > 2, 'журнал пуст');
});

console.log('\n=== ' + pass + ' пройдено, ' + fail + ' провалено ===');
console.log('Писем отправлено: ' + SENT_MAIL.length + ', записей в базе: ' + DB.getSheetByName('Записи').getLastRow() + '\n');
process.exit(fail ? 1 : 0);
