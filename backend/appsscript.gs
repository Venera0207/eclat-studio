/* =====================================================================
   ÉCLAT STUDIO — СЕРВЕР ЗАПИСИ (Google Apps Script + Google Sheets)
   ---------------------------------------------------------------------
   Что делает:
   • хранит записи и блоки в таблице (база данных);
   • серверно проверяет доступность интервала и НЕ ДОВЕРЯЕТ цене из браузера;
   • защищает от двойного бронирования: LockService + повторная проверка
     пересечений внутри блокировки (одновременные запросы не создадут конфликт);
   • шлёт владельцу письмо о каждой новой записи и журнал отправок;
   • напоминания о записях на завтра (почасовой триггер).
   КАТАЛОГ услуг/мастеров/скидок сервер читает из опубликованного файла
   site-data.js вашего сайта (кеш 5 минут) — источник данных один.
   ---------------------------------------------------------------------
   УСТАНОВКА: см. backend/README.md
   ===================================================================== */

var OWNER_EMAIL = 'venera.web.4@gmail.com';   // куда падают заявки
var ADMIN_TOKEN = 'СЮДА_СЛУЧАЙНУЮ_СТРОКУ_32_ЗНАКА'; // секрет для админ-операций (отмена, блоки, список)
var SITE_DATA_URL = 'https://venera0207.github.io/<ПАПКA_САЙТА>/site-data.js'; // адрес опубликованного site-data.js
var SALON_TITLE = 'ÉCLAT STUDIO';

/* ================= СЛУЖЕБНОЕ ================= */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name, header) {
  var sh = ss().getSheetByName(name);
  if (!sh) { sh = ss().insertSheet(name); sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}
var B_HEAD = ['id', 'masterId', 'date', 'startMin', 'endMin', 'name', 'phone', 'comment', 'status', 'priceBase', 'priceFinal', 'discountPercent', 'source', 'created', 'updated', 'reminded'];
var K_HEAD = ['id', 'masterId', 'date', 'startMin', 'endMin', 'reason'];
var L_HEAD = ['ts', 'type', 'to', 'subject', 'status', 'error'];

function bookingsSheet() { return sheet('bookings', B_HEAD); }
function blocksSheet() { return sheet('blocks', K_HEAD); }
function logsSheet() { return sheet('logs', L_HEAD); }

function rowsToObjects(sh) {
  var v = sh.getDataRange().getValues();
  var head = v[0];
  return v.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  }).filter(function (o) { return o.id; });
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

/* ---------- движок доступности на сервере (тот же, что в js/engine.js) ---------- */
function hm2m(s) { var p = String(s).split(':'); return (+p[0]) * 60 + (+p[1]); }
function overlap(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
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
  bookings.forEach(function (b) { if (b.masterId === m.id && b.date === dateS && b.status !== 'cancelled') busy.push({ s: +b.startMin, e: +b.endMin, k: 'b' }); });
  blocks.forEach(function (b) { if ((b.masterId === m.id || b.masterId === 'all') && b.date === dateS) busy.push({ s: +b.startMin, e: +b.endMin, k: 'k' }); });
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
    log('api-error', '', p.action || '', 'error', String(err));
  }
  var json = JSON.stringify(out);
  var body = p.cb ? (p.cb + '(' + json + ')') : json;
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.TEXT);
}

function route(p) {
  var action = p.action || 'ping';
  if (action === 'ping') return { ok: true, service: SALON_TITLE, time: new Date().toISOString() };

  if (action === 'busy') {
    var bs = rowsToObjects(bookingsSheet()).filter(function (b) {
      return b.status !== 'cancelled' && b.date >= (p.from || '0000-00-00') && b.date <= (p.to || '9999-99-99');
    }).map(function (b) { // обезличенно: без имён и телефонов клиентов
      return { id: b.id, masterId: b.masterId, date: b.date, startMin: +b.startMin, endMin: +b.endMin, status: b.status };
    });
    var ks = rowsToObjects(blocksSheet()).map(function (k) {
      return { id: k.id, masterId: k.masterId, date: k.date, startMin: +k.startMin, endMin: +k.endMin, reason: k.reason };
    });
    return { ok: true, bookings: bs, blocks: ks };
  }

  if (action === 'book') return book(JSON.parse(p.data || '{}'));

  /* --- операции с токеном --- */
  if (p.token !== ADMIN_TOKEN) return { ok: false, error: 'forbidden' };
  if (action === 'list') {
    return { ok: true, bookings: rowsToObjects(bookingsSheet()).filter(function (b) {
      return b.date >= (p.from || '0000-00-00') && b.date <= (p.to || '9999-99-99');
    }) };
  }
  if (action === 'cancel') return setStatus(p.id, 'cancelled');
  if (action === 'confirm') return setStatus(p.id, 'confirmed');
  if (action === 'block') {
    blocksSheet().appendRow([p.id || ('BL-' + new Date().getTime()), p.masterId, p.date, +p.startMin, +p.endMin, p.reason || '']);
    return { ok: true };
  }
  if (action === 'unblock') {
    var sh = blocksSheet(), v = sh.getDataRange().getValues();
    for (var i = v.length - 1; i > 0; i--) if (v[i][0] === p.id) { sh.deleteRow(i + 1); return { ok: true }; }
    return { ok: false, error: 'not found' };
  }
  if (action === 'reload') { dropCatalogCache(); return { ok: true };
  }
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
    var today = Utilities.formatDate(nowS, D.SITE.timezone || 'Europe/Moscow', 'yyyy-MM-dd');
    var nowMin = +Utilities.formatDate(nowS, D.SITE.timezone || 'Europe/Moscow', 'HH') * 60 +
                 +Utilities.formatDate(nowS, D.SITE.timezone || 'Europe/Moscow', 'mm');
    if (p.date < today || (p.date === today && start <= nowMin)) return { ok: false, reason: 'past' };
    /* цена считается ТОЛЬКО на сервере */
    var price = serverPrice(service, !!p.pension, D.DISCOUNT);
    var maxN = 0;
    bookings.forEach(function (b) { var mm = /ECL-(\d+)$/.exec(String(b.id)); if (mm) maxN = Math.max(maxN, +mm[1]); });
    var nn = String(maxN + 1); while (nn.length < 3) nn = '0' + nn;
    var id = 'ECL-' + nn;
    bookingsSheet().appendRow([id, master.id, p.date, start, end, p.name, p.phone, p.comment || '', 'confirmed',
      price.base, price.final, price.percent, 'site', nowS.toISOString(), nowS.toISOString(), '']);
    notifyOwner(p, master, service, price, id, D);
    return { ok: true, id: id, priceFinal: price.final, percent: price.percent };
  } finally {
    lock.releaseLock();
  }
}

function setStatus(id, status) {
  var sh = bookingsSheet(), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === id) {
      sh.getRange(i + 1, 9).setValue(status);
      sh.getRange(i + 1, 15).setValue(new Date().toISOString());
      return { ok: true };
    }
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
    'Дата и время: ' + p.date + ' ' + hm(start) + '–' + hm(end()) + '\n' +
    'Стоимость: ' + price.final + ' руб.' + (price.percent ? ' (скидка ' + price.percent + '%)' : '') + '\n' +
    'Комментарий: ' + (p.comment || '—') + '\n\nОплата производится в салоне.';
  function hm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
  function end() { return +p.startMin + service.minutes; }
  try {
    MailApp.sendEmail(OWNER_EMAIL, subject, body);
    log('booking-mail', OWNER_EMAIL, subject, 'sent', '');
  } catch (e) {
    log('booking-mail', OWNER_EMAIL, subject, 'error', String(e)); // сбой письма не теряет запись: строка уже в таблице
  }
}

/* ---------- напоминания о записях на завтра (вызвать installReminderTrigger один раз) ---------- */
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
    if (v[i][2] === tomorrow && v[i][8] === 'confirmed' && !v[i][15]) {
      lines.push('• ' + hmOf(v[i][3]) + '–' + hmOf(v[i][4]) + ' — ' + v[i][5] + ', ' + v[i][6] + ' (мастер ' + v[i][1] + ')');
      sh.getRange(i + 1, 16).setValue(1);
      }
  }
  if (!lines.length) return;
  var subject = 'Напоминание: записи на ' + tomorrow + ' (' + lines.length + ')';
  try {
    MailApp.sendEmail(OWNER_EMAIL, subject, 'Завтрашние записи:\n\n' + lines.join('\n') + '\n\nСалон: ' + SALON_TITLE);
    log('reminder', OWNER_EMAIL, subject, 'sent', '');
  } catch (e) { log('reminder', OWNER_EMAIL, subject, 'error', String(e)); }
}
function hmOf(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); }
