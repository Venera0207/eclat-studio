/* =====================================================================
   ÉCLAT STUDIO — СЕРВЕР ЗАПИСИ (Google Apps Script + Google Sheets)
   ---------------------------------------------------------------------
   • хранит записи и блоки в таблице (база данных) с русскими заголовками;
   • серверно проверяет доступность и НЕ ДОВЕРЯЕТ цене из браузера;
   • защита от двойного бронирования: LockService + повторная проверка
     пересечений внутри блокировки;
   • шлёт владельцу письмо о каждой новой записи и журнал отправок;
   • напоминания о записях на завтра (почасовой триггер, по желанию);
   • каталог услуг/мастеров читает из опубликованного site-data.js (кеш 5 мин).
   УСТАНОВКА: см. backend/README.md
   ===================================================================== */

var OWNER_EMAIL = 'venera.web.4@gmail.com';   // куда падают заявки
var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';       // ваш пароль админки (из Заметок)
var SITE_DATA_URL = 'https://venera0207.github.io/eclat-studio/site-data.js';
var SALON_TITLE = 'ÉCLAT STUDIO';

/* ================= СЛУЖЕБНОЕ ================= */

/* База: если проект прикреплён к таблице — пишем в неё;
   иначе создаём свою при первом обращении и запоминаем в свойствах */
function ss() {
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('DB_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ns = SpreadsheetApp.create('ÉCLAT STUDIO — база записей');
  p.setProperty('DB_ID', ns.getId());
  return ns;
}

/* Заголовки листов — только нужные колонки, по-русски */
var B_HEAD = ['Номер', 'Дата', 'Начало', 'Конец', 'Мастер', 'Услуга', 'Имя', 'Телефон', 'Комментарий', 'Статус', 'Цена', 'Скидка %', 'Источник', 'Создана', 'Напомнено'];
var K_HEAD = ['Номер', 'Мастер', 'Дата', 'Начало', 'Конец', 'Причина'];
var L_HEAD = ['Когда', 'Событие', 'Кому', 'Тема', 'Статус', 'Ошибка'];

function sheet(name, header) {
  var sh = ss().getSheetByName(name);
  if (!sh) { sh = ss().insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
function bookingsSheet() { return sheet('Записи', B_HEAD); }
function blocksSheet() { return sheet('Блоки', K_HEAD); }
function logsSheet() { return sheet('Журнал', L_HEAD); }

function rowsToObjects(sh) {
  var v = sh.getDataRange().getValues();
  var head = v[0];
  return v.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  }).filter(function (o) { return o['Номер'] || o['Когда']; });
}

function log(type, to, subject, status, err) {
  try { logsSheet().appendRow([new Date(), type, to || '', subject || '', status || '', err || '']); } catch (e) {}
}

/* ---------- каталог из опубликованного site-data.js (кеш 5 мин) ---------- */
function catalog() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('eclat_catalog');
  if (hit) return JSON.parse(hit);
  var src = UrlFetchApp.fetch(SITE_DATA_URL, { muteHttpExceptions: true }).getContentText('UTF-8');
  var fn = new Function(src + '; return {SITE:SITE, SETTINGS:SETTINGS, DISCOUNT:DISCOUNT, MASTERS:MASTERS, SERVICES:SERVICES};');
  var d = fn();
  cache.put('eclat_catalog', JSON.stringify(d), 300);
  return d;
}
function dropCatalogCache() { CacheService.getScriptCache().remove('eclat_catalog'); }

/* ---------- помощники времени и имён ---------- */
function hm2m(s) { var p = String(s).split(':'); return (+p[0]) * 60 + (+p[1]); }
function m2hm(m) { m = Math.max(0, Math.round(m)); return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
function masterIdByName(name, D) {
  if (!name) return null;
  var found = D.MASTERS.filter(function (m) { return m.name === name || m.id === name; })[0];
  return found ? found.id : String(name);
}
function overlap(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

/* ---------- движок доступности на сервере ---------- */
function masterDay(m, dateS, SITE) {
  if (!m || m.active === false) return null;
  var dow = new Date(dateS + 'T12:00:00').getDay();
  var sch = m.schedule || {};
  if ((sch.days || [0, 1, 2, 3, 4, 5, 6]).indexOf(dow) < 0) return null;
  for (var i = 0; i < (m.vacation || []).length; i++) {
    var v = m.vacation[i];
    if (v === dateS || (v.from && v.to && dateS >= v.from && dateS <= v.to)) return null;
  }
  var open = Math.max(hm2m(SITE.open), hm2m(sch.start || SITE.open));
  var close = Math.min(hm2m(SITE.close), hm2m(sch.end || SITE.close));
  if (close <= open) return null;
  return { open: open, close: close, breaks: (sch.breaks || []).map(function (b) { return { s: hm2m(b.start), e: hm2m(b.end) }; }) };
}
function rangeFree(m, dateS, s, e, bookings, blocks, D) {
  var day = masterDay(m, dateS, D.SITE);
  if (!day || s < day.open || e > day.close) return false;
  var buf = D.SETTINGS.bufferMin || 0;
  var busy = [];
  bookings.forEach(function (b) {
    if (b['Статус'] === 'отменена') return;
    if (masterIdByName(b['Мастер'], D) === m.id && b['Дата'] === dateS) busy.push({ s: hm2m(b['Начало']), e: hm2m(b['Конец']), k: 'b' });
  });
  blocks.forEach(function (b) {
    var bid = b['Мастер'] === 'все' ? 'all' : masterIdByName(b['Мастер'], D);
    if ((bid === m.id || bid === 'all') && b['Дата'] === dateS) busy.push({ s: hm2m(b['Начало']), e: hm2m(b['Конец']), k: 'k' });
  });
  for (var i = 0; i < busy.length; i++) {
    var bs = busy[i].k === 'b' ? busy[i].s - buf : busy[i].s;
    var be = busy[i].k === 'b' ? busy[i].e + buf : busy[i].e;
    if (overlap(s, e, bs, be)) return false;
  }
  for (var j = 0; j < day.breaks.length; j++) if (overlap(s, e, day.breaks[j].s, day.breaks[j].e)) return false;
  return true;
}
function serverPrice(service, pension, DISCOUNT) {
  var base = service.price || 0;
  if (pension && DISCOUNT.enabled && service.pension !== false) {
    return { base: base, percent: DISCOUNT.percent, final: Math.round(base * (100 - DISCOUNT.percent) / 100) };
  }
  return { base: base, percent: 0, final: base };
}

/* ================= HTTP API (JSONP) ================= */

function doGet(e) {
  var p = e.parameter || {};
  var out;
  try {
    out = route(p);
  } catch (err) {
    out = { ok: false, error: String(err) };
    log('ошибка-api', '', p.action || '', 'ошибка', String(err));
  }
  var json = JSON.stringify(out);
  var body = p.cb ? (p.cb + '(' + json + ')') : json;
  /* JSONP из браузера исполняется только с JS-mime */
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function route(p) {
  var action = p.action || 'ping';
  if (action === 'ping') return { ok: true, service: SALON_TITLE, time: new Date().toISOString() };

  if (action === 'busy') {
    var D = catalog();
    var bs = rowsToObjects(bookingsSheet()).filter(function (b) {
      return b['Статус'] !== 'отменена' && b['Дата'] >= (p.from || '0000-00-00') && b['Дата'] <= (p.to || '9999-99-99');
    }).map(function (b) { /* обезличенно: без имён и телефонов клиентов */
      return { id: b['Номер'], masterId: masterIdByName(b['Мастер'], D), date: b['Дата'], startMin: hm2m(b['Начало']), endMin: hm2m(b['Конец']), status: 'confirmed' };
    });
    var ks = rowsToObjects(blocksSheet()).map(function (k) {
      return { id: k['Номер'], masterId: k['Мастер'] === 'все' ? 'all' : masterIdByName(k['Мастер'], D), date: k['Дата'], startMin: hm2m(k['Начало']), endMin: hm2m(k['Конец']), reason: k['Причина'] };
    });
    return { ok: true, bookings: bs, blocks: ks };
  }

  if (action === 'book') return book(JSON.parse(p.data || '{}'));

  /* --- операции с токеном --- */
  if (p.token !== ADMIN_TOKEN) return { ok: false, error: 'forbidden' };
  if (action === 'list') {
    return { ok: true, bookings: rowsToObjects(bookingsSheet()).filter(function (b) {
      return b['Дата'] >= (p.from || '0000-00-00') && b['Дата'] <= (p.to || '9999-99-99');
    }) };
  }
  if (action === 'cancel') return setStatus(p.id, 'отменена');
  if (action === 'confirm') return setStatus(p.id, 'подтверждена');
  if (action === 'block') {
    var D2 = catalog();
    var mname = p.masterId === 'all' ? 'все' : (D2.MASTERS.filter(function (m) { return m.id === p.masterId; })[0] || { name: p.masterId }).name;
    blocksSheet().appendRow([p.id || ('BL-' + new Date().getTime()), mname, p.date, m2hm(+p.startMin), m2hm(+p.endMin), p.reason || '']);
    return { ok: true };
  }
  if (action === 'unblock') {
    var sh = blocksSheet(), v = sh.getDataRange().getValues();
    for (var i = v.length - 1; i > 0; i--) if (v[i][0] === p.id) { sh.deleteRow(i + 1); return { ok: true }; }
    return { ok: false, error: 'not found' };
  }
  if (action === 'reload') { dropCatalogCache(); return { ok: true }; }
  return { ok: false, error: 'unknown action' };
}

/* ---------- создание записи: транзакционно, под блокировкой ---------- */
function book(p) {
  var D = catalog();
  var service = D.SERVICES.filter(function (s) { return s.id === p.serviceId; })[0];
  if (!service || service.active === false) return { ok: false, error: 'service' };
  var master = D.MASTERS.filter(function (m) { return m.id === p.masterId; })[0];
  if (!master) return { ok: false, error: 'master' };
  if ((service.masters || []).length && service.masters.indexOf(master.id) < 0) return { ok: false, error: 'master-service' };
  if (!p.name || !p.phone) return { ok: false, error: 'client' };
  var start = +p.startMin, end = start + service.minutes;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy-server' };
  try {
    var bookings = rowsToObjects(bookingsSheet());
    var blocks = rowsToObjects(blocksSheet());
    /* повторная серверная проверка доступности (защита от двойной записи) */
    if (!rangeFree(master, p.date, start, end, bookings, blocks, D)) return { ok: false, reason: 'conflict' };
    var nowS = new Date();
    var tz = D.SITE.timezone || 'Europe/Moscow';
    var today = Utilities.formatDate(nowS, tz, 'yyyy-MM-dd');
    var nowMin = +Utilities.formatDate(nowS, tz, 'HH') * 60 + +Utilities.formatDate(nowS, tz, 'mm');
    if (p.date < today || (p.date === today && start <= nowMin)) return { ok: false, reason: 'past' };
    /* цена считается ТОЛЬКО на сервере */
    var price = serverPrice(service, !!p.pension, D.DISCOUNT);
    var maxN = 0;
    bookings.forEach(function (b) { var mm = /ECL-(\d+)$/.exec(String(b['Номер'])); if (mm) maxN = Math.max(maxN, +mm[1]); });
    var nn = String(maxN + 1); while (nn.length < 3) nn = '0' + nn;
    var id = 'ECL-' + nn;
    bookingsSheet().appendRow([id, p.date, m2hm(start), m2hm(end), master.name, service.title,
      p.name, p.phone, p.comment || '', 'подтверждена', price.final, price.percent, 'сайт',
      Utilities.formatDate(nowS, tz, 'dd.MM.yyyy HH:mm'), '']);
    notifyOwner(p, master, service, price, id, D);
    return { ok: true, id: id, priceFinal: price.final, percent: price.percent };
  } finally {
    lock.releaseLock();
  }
}

function setStatus(id, status) {
  var sh = bookingsSheet(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === id) { sh.getRange(i + 1, 10).setValue(status); return { ok: true }; }
  }
  return { ok: false, error: 'not found' };
}

/* ---------- уведомления ---------- */
function notifyOwner(p, master, service, price, id, D) {
  var subject = 'Запись ' + id + ' — ' + SALON_TITLE;
  var body = 'Новая запись через сайт\n\n' +
    'Номер: ' + id + '\n' +
    'Клиент: ' + p.name + ', ' + p.phone + '\n' +
    'Услуга: ' + service.title + ' (' + service.minutes + ' мин)\n' +
    'Мастер: ' + master.name + '\n' +
    'Дата и время: ' + p.date + ' ' + m2hm(+p.startMin) + '–' + m2hm(+p.startMin + service.minutes) + '\n' +
    'Стоимость: ' + price.final + ' руб.' + (price.percent ? ' (скидка ' + price.percent + '%)' : '') + '\n' +
    'Комментарий: ' + (p.comment || '—') + '\n\nОплата производится в салоне.';
  try {
    MailApp.sendEmail(OWNER_EMAIL, subject, body);
    log('письмо-заявка', OWNER_EMAIL, subject, 'отправлено', '');
  } catch (e) {
    log('письмо-заявка', OWNER_EMAIL, subject, 'ошибка', String(e)); /* сбой письма не теряет запись */
  }
}

/* ---------- напоминания о записях на завтра (триггер по желанию) ---------- */
function installReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendReminders').timeBased().everyHours(1).create();
  return 'trigger installed';
}
function removeTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); }); }
function sendReminders() {
  var D; try { D = catalog(); } catch (e) { return; }
  var tz = D.SITE.timezone || 'Europe/Moscow';
  var tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), tz, 'yyyy-MM-dd');
  var sh = bookingsSheet(), v = sh.getDataRange().getValues();
  var lines = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i][1] === tomorrow && v[i][9] === 'подтверждена' && !v[i][14]) {
      lines.push('• ' + v[i][2] + '–' + v[i][3] + ' — ' + v[i][6] + ', ' + v[i][7] + ' (' + v[i][5] + ', мастер ' + v[i][4] + ')');
      sh.getRange(i + 1, 15).setValue(1);
    }
  }
  if (!lines.length) return;
  var subject = 'Напоминание: записи на ' + tomorrow + ' (' + lines.length + ')';
  try {
    MailApp.sendEmail(OWNER_EMAIL, subject, 'Завтрашние записи:\n\n' + lines.join('\n') + '\n\nСалон: ' + SALON_TITLE);
    log('напоминание', OWNER_EMAIL, subject, 'отправлено', '');
  } catch (e) { log('напоминание', OWNER_EMAIL, subject, 'ошибка', String(e)); }
}
