/* =====================================================================
   ÉCLAT STUDIO — сервер записи (Google Apps Script + Google Sheets)
   ---------------------------------------------------------------------
   Версия 2.0 — переписана под РЕАЛЬНЫЙ контракт сайта.

   ЧТО БЫЛО СЛОМАНО (версия 1.0):
     1. Сайт шлёт  ?action=book&data={JSON}  — сервер читал p.date, p.start,
        p.master… то есть ОТДЕЛЬНЫЕ параметры, которых в запросе нет.
        Отсюда «undefined» во всех полях письма.
     2. Сайт шлёт  ?action=busy&from&to — сервер такого действия не знал
        и отвечал {"ok":false,"error":"Unknown action"}. Сайт молча падал
        в демо-режим (localStorage), поэтому реальные записи не видел
        и мог записать двух людей на одно время.
     3. Сервер не знал ни услуг, ни мастеров (w1/m1), ни пенсионной скидки,
        ни буфера между записями, ни графика мастеров.

   ЧТО УМЕЕТ ТЕПЕРЬ:
     Публичные (сайт):  ping · test · busy · book
     Админ (нужен token): getStats · getDay · list · cancel · addBlock ·
                          unblock · manualBook · reload
     • книга услуг/мастеров/скидка/буфер берутся из ЖИВОГО site-data.js
       (кеш 5 минут) — поменяли цену в редакторе, сервер узнает сам;
     • цена и скидка считаются НА СЕРВЕРЕ, браузеру не верим;
     • LockService + повторная проверка пересечений: два одновременных
       запроса на одно время не создадут две записи;
     • блокировки мастеров, перерывы, отпуска, «нельзя в прошлое»;
     • письмо владельцу; сбой письма НЕ теряет запись (пишем в «Журнал»);
     • короткий номер записи ECL-0001 — его легко продиктовать в салоне;
     • ответ book/busy содержит и «машинные» поля (startMin, masterId),
       и «человеческие» (start, master) — сайт и админка читают одно и то же.

   УСТАНОВКА: backend/README.md
   ===================================================================== */

/* ============================ НАСТРОЙКИ ============================ */
var OWNER_EMAIL = 'venera.web.4@gmail.com';
var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';   // придумайте случайную строку; её же вы вводите в админке
var SITE_DATA_URL = 'https://venera0207.github.io/eclat-studio/site-data.js';
var TZ = 'Europe/Moscow';                  // часовой пояс салона (важно для «сегодня» и «время уже прошло»)
var SITE_URL_HINT = 'https://venera0207.github.io/eclat-studio/';

var BOOK_SHEET = 'Записи';
var BLOCK_SHEET = 'Блоки';
var LOG_SHEET = 'Журнал';
var CATALOG_CACHE = 'eclat_catalog_v2';
var CATALOG_TTL = 300;                     // секунд

/* Заголовки листов. Порядок НЕ менять: на него завязаны индексы колонок. */
var CHATLEAD_SHEET = 'Заявки из чата';
var CHATLEAD_HEAD = ['Дата', 'Имя', 'Контакт', 'Диалог', 'Источник'];
var CHATLEAD_TEXT_COLS = [2, 3, 4, 5];

var BOOK_HEAD = ['Номер', 'Дата', 'Начало', 'Конец', 'Мастер', 'Услуга', 'Имя', 'Телефон',
                 'Комментарий', 'Статус', 'Цена', 'Скидка', 'Источник', 'Создана',
                 'МастерID', 'УслугаID', 'НачалоМин', 'КонецМин', 'ЦенаБаза', 'Пенсионер'];
var BLOCK_HEAD = ['ID', 'Дата', 'Начало', 'Конец', 'МастерID', 'Мастер', 'НачалоМин', 'КонецМин', 'Причина', 'Создан'];
var LOG_HEAD = ['Время', 'Событие', 'ID записи', 'Подробности'];

/* Колонки, которые ОБЯЗАНЫ оставаться текстом (номера колонок с 1).
   Без этого Google Sheets сам «догадывается» о типе и портит данные:
     «+7 931 357-96-00»  → формула → #ERROR!   (плюс в начале = знак формулы)
     «17:00»             → значение времени → при чтении возвращается Date с 1899 годом
     «2026-10-22 11:15»  → дата/время → в ответе «Thu Oct 22 2026 …»
   Поэтому перед записью помечаем эти ячейки форматом «@» (текст).          */
var BOOK_TEXT_COLS  = [2, 3, 4, 5, 6, 7, 8, 9, 14];
var BLOCK_TEXT_COLS = [2, 3, 4, 5, 6, 9, 10];
var LOG_TEXT_COLS   = [1, 2, 3, 4];

/* ============================== HTTP ============================== */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || 'ping');
  var out;
  try {
    switch (action) {
      /* --- публичные: сайт --- */
      case 'ping':       out = { ok: true, time: iso(new Date()), version: 2.2, tz: TZ }; break;
      case 'test':       out = doTest(); break;
      case 'busy':       out = doBusy(p); break;
      case 'book':       out = doBook(p, false); break;
      case 'lead':       out = doChatLead(p); break;   /* заявки из чата-ассистента, публично */

      /* --- админ: нужен токен --- */
      case 'getStats':   out = guard(p, function () { return doStats(); }); break;
      case 'getDay':     out = guard(p, function () { return doGetDay(p); }); break;
      case 'list':       out = guard(p, function () { return doList(p); }); break;
      case 'cancel':     out = guard(p, function () { return doCancel(p); }); break;
      case 'addBlock':   out = guard(p, function () { return doAddBlock(p); }); break;
      case 'unblock':    out = guard(p, function () { return doUnblock(p); }); break;
      case 'manualBook': out = guard(p, function () { return doBook(p, true); }); break;
      case 'reload':     out = guard(p, function () { cache().remove(CATALOG_CACHE); return { ok: true, message: 'Кеш каталога сброшен' }; }); break;

      default: out = { ok: false, error: 'Unknown action: ' + action,
                       hint: 'Доступные: ping, test, busy, book, getStats, getDay, list, cancel, addBlock, unblock, manualBook, reload' };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return jsonpOut(out, p.cb);
}

/* POST — на случай, если сайт/админка перейдёт на fetch вместо JSONP */
function doPost(e) {
  var p = {};
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { p = {}; }
  var q = (e && e.parameter) || {};
  for (var k in q) if (q.hasOwnProperty(k) && p[k] === undefined) p[k] = q[k];
  return doGet({ parameter: p });
}

function jsonpOut(out, cbName) {
  var json = JSON.stringify(out);
  var body = cbName ? (String(cbName).replace(/[^A-Za-z0-9_$.]/g, '') + '(' + json + ')') : json;
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function guard(p, fn) {
  if (!checkToken(p.token)) return { ok: false, error: 'bad token', ru: 'Неверный токен администратора.' };
  return fn();
}
function checkToken(token) {
  return !!token && !!ADMIN_TOKEN && ADMIN_TOKEN !== 'ВСТАВЬТЕ_СВОЙ_ТОКЕН' && String(token) === String(ADMIN_TOKEN);
}

/* ========================= ЖИВОЙ КАТАЛОГ =========================
   Читаем site-data.js как ТЕКСТ и вырезаем JSON-значения переменных.
   Никакого eval/Function — в Apps Script песочнице они ненадёжны.      */
function catalog() {
  var c = cache();
  var hit = c.get(CATALOG_CACHE);
  if (hit) { try { return JSON.parse(hit); } catch (x) {} }
  var src = '';
  try {
    src = UrlFetchApp.fetch(SITE_DATA_URL, { muteHttpExceptions: true }).getContentText('UTF-8');
  } catch (err) { src = ''; }
  var d = parseSiteData(src);
  if (d.SERVICES.length) { try { c.put(CATALOG_CACHE, JSON.stringify(d), CATALOG_TTL); } catch (x2) {} }
  return d;
}

function parseSiteData(src) {
  var empty = { SITE: {}, SETTINGS: {}, DISCOUNT: { enabled: false, percent: 0 },
                MASTERS: [], SERVICES: [], ok: false };
  if (!src) return empty;
  var out = { ok: true };
  ['SITE', 'SETTINGS', 'DISCOUNT', 'MASTERS', 'SERVICES'].forEach(function (name) {
    out[name] = sliceValue(src, name);
  });
  if (!out.SITE || !out.SETTINGS) out.ok = false;
  out.MASTERS = out.MASTERS || [];
  out.SERVICES = out.SERVICES || [];
  out.DISCOUNT = out.DISCOUNT || { enabled: false, percent: 0 };
  return out;
}

/* находит «var NAME =» и возвращает значение, аккуратно считая скобки
   (строки и экранированные кавычки внутри значений учитываются) */
function sliceValue(src, name) {
  var re = new RegExp('(?:^|[^A-Za-z0-9_$])var\\s+' + name + '\\s*=\\s*', 'm');
  var m = re.exec(src);
  if (!m) return null;
  var i = m.index + m[0].length, start = i, depth = 0, inStr = false, q = '', esc = false;
  for (; i < src.length; i++) {
    var ch = src.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === q) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; q = ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) { i++; break; } }
    else if (depth === 0 && (ch === ';' || ch === '\n')) break;
  }
  var text = src.substring(start, i).replace(/[\s;]+$/, '');
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {
    try { return JSON.parse(text.replace(/,\s*([}\]])/g, '$1')); } catch (e2) { return null; }
  }
}

/* =========================== ТАБЛИЦЫ =========================== */
function ss() {
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DB_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var created = SpreadsheetApp.create('ÉCLAT STUDIO — база записей');
  props.setProperty('DB_ID', created.getId());
  return created;
}
function cache() { return CacheService.getScriptCache(); }

function sheetNamed(name, head) {
  var s = ss().getSheetByName(name);
  if (!s) { s = ss().insertSheet(name); s.appendRow(head); }
  else if (s.getLastRow() === 0) s.appendRow(head);
  return s;
}
function bookSheet() { return sheetNamed(BOOK_SHEET, BOOK_HEAD); }

/* Безопасная запись строки.
   Проверено на бою: просто пометить колонки текстом ДО appendRow НЕДОСТАТОЧНО —
   appendRow всё равно отдаёт строку парсеру Sheets, и «+7 931…» становится
   формулой → #ERROR!. Поэтому: (1) помечаем формат, (2) пишем строку,
   (3) ПЕРЕЗАПИСЫВАЕМ текстовые ячейки через setNumberFormat('@').setValue() —
   вот этот второй проход и гарантирует, что в ячейке лежит дословный текст.   */
function appendRowText(s, row, textCols) {
  var r = s.getLastRow() + 1;
  var i, c;
  for (i = 0; i < textCols.length; i++) {
    try { s.getRange(r, textCols[i]).setNumberFormat('@'); } catch (e) {}
  }
  s.appendRow(row);
  for (i = 0; i < textCols.length; i++) {
    c = textCols[i];
    try { s.getRange(r, c).setNumberFormat('@').setValue(row[c - 1]); } catch (e) {}
  }
  return r;
}
function blockSheet() { return sheetNamed(BLOCK_SHEET, BLOCK_HEAD); }

function rows(s) {
  if (s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, BOOK_HEAD.length > s.getLastColumn() ? s.getLastColumn() : BOOK_HEAD.length).getValues();
}

function logIt(event, id, extra) {
  try {
    var s = sheetNamed(LOG_SHEET, LOG_HEAD);
    appendRowText(s, [stamp(new Date()), event, id || '', extra || ''], LOG_TEXT_COLS);
  } catch (e) {}
}

/* ======================= ФОРМАТЫ ДАННЫХ ======================= */
/* Одна запись в двух «языках»: машинном (для движка сайта) и человеческом (для админки/письма). */
function bookingDto(r) {
  var startMin = minutesOf(r[16], r[2]), endMin = minutesOf(r[17], r[3]);
  var price = num(r[10]), base = num(r[18]) || price;
  return {
    id: str(r[0]), date: ds(r[1]),
    start: hm(startMin), end: hm(endMin), startMin: startMin, endMin: endMin,
    masterId: str(r[14]), master: str(r[4]),
    serviceId: str(r[15]), service: str(r[5]),
    name: str(r[6]), phone: cleanPhone(str(r[7])), comment: str(r[8]),
    status: normStatus(str(r[9])), statusRu: ruStatus(str(r[9])),
    price: price, priceBase: base, discountPercent: num(r[11]),
    pension: /^(да|true|1)$/i.test(str(r[19])),
    source: str(r[12]) || 'сайт', created: str(r[13])
  };
}
function blockDto(r) {
  var startMin = minutesOf(r[6], r[2]), endMin = minutesOf(r[7], r[3]);
  return { id: str(r[0]), date: ds(r[1]), start: hm(startMin), end: hm(endMin),
           startMin: startMin, endMin: endMin, masterId: str(r[4]) || 'all',
           master: str(r[5]) || 'Все мастера', reason: str(r[8]) };
}

/* статус: движок сайта понимает только 'cancelled', админка/письмо — «отменена» */
function normStatus(s) { return /^отмен/i.test(str(s)) ? 'cancelled' : 'confirmed'; }
function ruStatus(s) { return /^отмен/i.test(str(s)) ? 'отменена' : 'подтверждена'; }

/* ============================ ДЕЙСТВИЯ ============================ */
function doTest() {
  var st = doStats();
  var c = catalog();
  /* строки, испорченные старой версией: телефон #ERROR!, пустое время и т.п. */
  var broken = [];
  rows(bookSheet()).forEach(function (r) {
    var why = [];
    if (/#(ERROR|REF|VALUE|NAME|N\/A)/.test(str(r[7]))) why.push('телефон');
    if (!str(r[6])) why.push('имя');
    if (!minutesOf(r[16], r[2]) && !minutesOf(r[17], r[3])) why.push('время');
    if (!ds(r[1])) why.push('дата');
    if (why.length) broken.push(str(r[0]) + ' (' + why.join(', ') + ')');
  });
  return { ok: true, total: st.total, today: st.today, canceled: st.canceled,
           services: c.SERVICES.length, masters: c.MASTERS.length,
           catalogOk: !!c.ok, pipeUrlOk: true,
           adminTokenSet: ADMIN_TOKEN !== 'ВСТАВЬТЕ_СВОЙ_ТОКЕН',
           brokenRows: broken.length, brokenIds: broken.slice(0, 10),
           time: iso(new Date()), version: 2.2 };
}

/* занятые окна за период — то, что сайт просит перед открытием мастера записи */
function doBusy(p) {
  var from = ds(p.from), to = ds(p.to);
  if (!from) from = todayStr();
  if (!to) to = shiftDate(from, 60);
  var bookings = [], blocks = [];
  rows(bookSheet()).forEach(function (r) {
    var d = ds(r[1]);
    if (d >= from && d <= to && normStatus(str(r[9])) !== 'cancelled') bookings.push(bookingDto(r));
  });
  rows(blockSheet()).forEach(function (r) {
    var d = ds(r[1]);
    if (d >= from && d <= to) blocks.push(blockDto(r));
  });
  return { ok: true, from: from, to: to, bookings: bookings, blocks: blocks,
           count: bookings.length, blocksCount: blocks.length };
}

function doStats() {
  var data = rows(bookSheet()), today = todayStr();
  var total = 0, todayCount = 0, canceled = 0, sum = 0;
  data.forEach(function (r) {
    total++;
    if (ds(r[1]) === today) todayCount++;
    if (normStatus(str(r[9])) === 'cancelled') canceled++; else sum += num(r[10]);
  });
  return { ok: true, total: total, today: todayCount, canceled: canceled, revenue: sum };
}

function doGetDay(p) {
  var date = ds(p.date) || todayStr();
  return { ok: true, date: date, bookings: dayBookings(date), blocks: dayBlocks(date) };
}

function doList(p) {
  var from = ds(p.from) || shiftDate(todayStr(), -30), to = ds(p.to) || shiftDate(todayStr(), 60);
  var out = [];
  rows(bookSheet()).forEach(function (r) {
    var d = ds(r[1]);
    if (d >= from && d <= to) out.push(bookingDto(r));
  });
  return { ok: true, from: from, to: to, bookings: out, count: out.length };
}

function doCancel(p) {
  var id = str(p.id);
  if (!id) return { ok: false, error: 'no id', ru: 'Не передан номер записи.' };
  var s = bookSheet(), data = s.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (str(data[i][0]) === id) {
      if (normStatus(str(data[i][9])) === 'cancelled') return { ok: false, error: 'already cancelled', ru: 'Запись уже отменена.' };
      s.getRange(i + 1, 10).setValue('отменена');
      logIt('запись отменена', id);
      return { ok: true, id: id, message: 'Запись отменена' };
    }
  }
  return { ok: false, error: 'not found', ru: 'Запись ' + id + ' не найдена.' };
}

function doAddBlock(p) {
  var date = ds(p.date);
  var startMin = p.startMin != null && p.startMin !== '' ? num(p.startMin) : hm2m(ds(p.start));
  var endMin = p.endMin != null && p.endMin !== '' ? num(p.endMin) : hm2m(ds(p.end));
  if (!date || !startMin || !endMin) return { ok: false, error: 'need date/start/end', ru: 'Нужны дата, начало и конец блока.' };
  if (endMin <= startMin) return { ok: false, error: 'end before start', ru: 'Конец блока раньше начала.' };
  var masterRaw = str(p.master || p.masterId || 'all');
  var c = catalog();
  var masterId = masterRaw, masterName = 'Все мастера';
  if (!masterRaw || masterRaw === 'all' || masterRaw === 'Все' || masterRaw === 'Все мастера') { masterId = 'all'; }
  else {
    var byId = findMaster(c, masterRaw), byName = masterByName(c, masterRaw);
    var m = byId || byName;
    if (m) { masterId = m.id; masterName = m.name; } else masterName = masterRaw;
  }
  var s = blockSheet();
  var id = 'BLK-' + fmt(new Date(), 'MMdd-HHmmss');
  appendRowText(s, [id, date, hm(startMin), hm(endMin), masterId, masterName, startMin, endMin, str(p.reason || 'Блок'), stamp(new Date())], BLOCK_TEXT_COLS);
  logIt('добавлен блок', id, date + ' ' + hm(startMin) + '–' + hm(endMin) + ' ' + masterName);
  return { ok: true, id: id, date: date, startMin: startMin, endMin: endMin, masterId: masterId, master: masterName };
}

function doUnblock(p) {
  var id = str(p.id), s = blockSheet(), data = s.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (str(data[i][0]) === id) { s.deleteRow(i + 1); logIt('блок удалён', id); return { ok: true, id: id }; }
  }
  return { ok: false, error: 'not found', ru: 'Блок не найден.' };
}

/* ============ ЗАЯВКИ ИЗ ЧАТА: второй, стабильный канал ============
   Окошко ассистента шлёт заявку сюда ПАРАЛЛЕЛЬНО с трубой ассистента:
   даже если та мигнёт, заявка ляжет здесь, придёт письмом и не потеряется. */
function doChatLead(p) {
  var name = String(p.name || '').slice(0, 80);
  var contact = String(p.contact || '').slice(0, 60);
  var message = String(p.message || '').slice(0, 8000);
  var source = String(p.source || 'чат');
  var sheet = false, mail = false;
  try {
    appendRowText(sheetNamed(CHATLEAD_SHEET, CHATLEAD_HEAD),
      [stamp(new Date()), name, contact, message, source], CHATLEAD_TEXT_COLS);
    sheet = true;
  } catch (e) {}
  try {
    MailApp.sendEmail(OWNER_EMAIL, 'ÉCLAT: заявка из чата — ' + (name || 'без имени'),
      'Имя: ' + name + '\nКонтакт: ' + contact + '\nИсточник: ' + source +
      '\n\nДиалог:\n…' + message.slice(-1500) + '\n\nСайт: ' + SITE_URL_HINT + '\n');
    mail = true;
  } catch (e) {}
  if (!sheet && !mail) return { ok: false, error: 'lead not saved', ru: 'Не удалось сохранить заявку из чата.' };
  return { ok: true, sheet: sheet, mail: mail, channel: 'bookings-pipe' };
}

/* ======================= ГЛАВНОЕ: ЗАПИСЬ ======================= */
function doBook(p, isManual) {
  /* Сайт присылает ОДИН параметр data=JSON. Админка может слать плоские поля. */
  var raw = p.data || p.payload;
  var b = {};
  if (raw) {
    if (typeof raw === 'string') {
      try { b = JSON.parse(raw); } catch (e) { return { ok: false, error: 'bad data json', ru: 'Не удалось разобрать данные заявки.' }; }
    } else b = raw;
  }
  for (var k in p) if (p.hasOwnProperty(k) && b[k] === undefined && k !== 'data' && k !== 'cb' && k !== 'token' && k !== 'action') b[k] = p[k];

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy', ru: 'Сервер занят, попробуйте ещё раз через пару секунд.' }; }
  try {
    var res = buildBooking(b, isManual);
    if (!res.ok) return res;
    var rec = res.rec;

    /* повторная проверка пересечений уже под блокировкой — защита от двойного бронирования */
    var clash = findClash(rec, isManual ? null : str(b.ignoreId));
    if (clash) return { ok: false, error: 'conflict', reason: 'conflict',
                        ru: 'Это время уже занято (' + clash.who + '). Выберите другой интервал.' };

    var s = bookSheet();
    appendRowText(s, [rec.id, rec.date, rec.start, rec.end, rec.master, rec.service, rec.name, rec.phone,
                 rec.comment, rec.statusRu, rec.price, rec.discountPercent, rec.source, rec.created,
                 rec.masterId, rec.serviceId, rec.startMin, rec.endMin, rec.priceBase, rec.pension ? 'да' : 'нет'], BOOK_TEXT_COLS);

    /* письмо — после сохранения: сбой почты не должен терять запись */
    var mailOk = true, mailErr = '';
    if (!isManual) {
      try { sendOwnerEmail(rec); } catch (err) { mailOk = false; mailErr = String(err); }
    }
    logIt(isManual ? 'запись создана админом' : 'новая запись с сайта', rec.id,
          rec.date + ' ' + rec.start + ' ' + rec.master + ' / ' + rec.service + (mailOk ? '' : ' | письмо не ушло: ' + mailErr));

    return { ok: true, id: rec.id, message: 'Запись сохранена', mailSent: mailOk,
             booking: { id: rec.id, masterId: rec.masterId, serviceId: rec.serviceId, date: rec.date,
                        startMin: rec.startMin, endMin: rec.endMin, status: rec.status,
                        name: rec.name, phone: rec.phone, comment: rec.comment,
                        price: rec.price, priceBase: rec.priceBase, discountPercent: rec.discountPercent,
                        master: rec.master, service: rec.service, start: rec.start, end: rec.end,
                        source: rec.source, created: rec.created } };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* собирает запись из «машинных» полей сайта, считая цену и проверяя всё на сервере */
function buildBooking(b, isManual) {
  var c = catalog();
  if (!c.SERVICES.length || !c.MASTERS.length) {
    /* каталог недоступен: записывать нельзя — иначе цена и проверка окон будут выдуманы */
    return { ok: false, error: 'catalog unavailable',
             ru: 'Сервер временно не видит каталог сайта. Попробуйте через минуту или позвоните в салон.' };
  }
  var SITE = c.SITE || {}, SETTINGS = c.SETTINGS || {}, DISCOUNT = c.DISCOUNT || {};

  var service = findService(c, b.serviceId) || serviceByTitle(c, b.service);
  if (!service) return { ok: false, error: 'service not found', ru: 'Услуга не найдена. Обновите страницу и попробуйте ещё раз.' };
  if (service.active === false) return { ok: false, error: 'service inactive', ru: 'Услуга временно недоступна.' };

  var master = findMaster(c, b.masterId) || masterByName(c, b.master);
  if (!master) return { ok: false, error: 'master not found', ru: 'Мастер не найден. Обновите страницу и попробуйте ещё раз.' };

  var date = ds(b.date);
  if (!date) return { ok: false, error: 'no date', ru: 'Не выбрана дата.' };
  var startMin = b.startMin != null && b.startMin !== '' ? num(b.startMin) : hm2m(ds(b.start));
  if (!startMin) return { ok: false, error: 'no start', ru: 'Не выбрано время.' };
  var minutes = num(service.minutes) || 60;
  var endMin = b.endMin != null && b.endMin !== '' ? num(b.endMin) : startMin + minutes;
  if (endMin <= startMin) endMin = startMin + minutes;

  var name = str(b.name).replace(/\s+/g, ' ').substring(0, 80);
  var phone = str(b.phone).replace(/\s+/g, ' ').substring(0, 30);
  var comment = str(b.comment).substring(0, 500);

  if (!isManual) {
    if (name.length < 2) return { ok: false, error: 'bad name', ru: 'Укажите имя.' };
    if (digits(phone).length < 10) return { ok: false, error: 'bad phone', ru: 'Введите телефон полностью.' };
    if (b.consent === false) return { ok: false, error: 'no consent', ru: 'Нужно согласие на обработку персональных данных.' };
    if (service.masters && service.masters.length && service.masters.indexOf(master.id) < 0)
      return { ok: false, error: 'master mismatch', ru: 'Этот мастер не выполняет выбранную услугу.' };
  }

  /* дата/время: нельзя в прошлое и на уже прошедшее время сегодня */
  var now = new Date(), nowDate = todayStr();
  if (date < nowDate) return { ok: false, error: 'past date', reason: 'conflict', ru: 'Нельзя записаться на прошедшую дату.' };
  if (date === nowDate) {
    var nowMin = now.getHours() * 60 + now.getMinutes();
    if (startMin <= nowMin) return { ok: false, error: 'past time', reason: 'conflict', ru: 'Это время уже прошло — выберите другое.' };
  }

  /* график мастера: рабочие дни, отпуск, часы, перерывы */
  var day = masterDay(master, date, SITE);
  if (!day) return { ok: false, error: 'master off', reason: 'conflict', ru: 'Мастер в этот день не работает. Выберите другую дату.' };
  if (startMin < day.open || endMin > day.close)
    return { ok: false, error: 'out of hours', reason: 'conflict', ru: 'Время вне графика мастера (' + hm(day.open) + '–' + hm(day.close) + ').' };
  for (var i = 0; i < day.breaks.length; i++) {
    if (overlap(startMin, endMin, day.breaks[i].s, day.breaks[i].e))
      return { ok: false, error: 'break', reason: 'conflict', ru: 'Это время пересекается с перерывом мастера.' };
  }

  /* цена и скидка — только на сервере */
  var wantPension = b.pension === true || b.pension === 'true' || b.pension === 'да' || b.pension === 1;
  var applies = wantPension && DISCOUNT.enabled !== false && service.pension !== false;
  var percent = applies ? num(DISCOUNT.percent) : 0;
  var base = num(service.price);
  var price = applies ? Math.round(base * (100 - percent) / 100) : base;

  var rec = {
    id: nextId(), date: date, startMin: startMin, endMin: endMin,
    start: hm(startMin), end: hm(endMin),
    masterId: master.id, master: master.name,
    serviceId: service.id, service: service.title,
    name: name || (isManual ? 'без имени' : ''), phone: phone, comment: comment,
    price: price, priceBase: base, discountPercent: percent, pension: applies,
    status: 'confirmed', statusRu: 'подтверждена',
    source: isManual ? 'админ' : str(b.source || 'сайт'),
    created: stamp(now)
  };
  return { ok: true, rec: rec };
}

/* пересечения с записями (с буфером) и блоками того же мастера */
function findClash(rec, ignoreId) {
  var buf = num((catalog().SETTINGS || {}).bufferMin);
  var mine = [];
  rows(bookSheet()).forEach(function (r) {
    if (normStatus(str(r[9])) === 'cancelled') return;
    if (ignoreId && str(r[0]) === ignoreId) return;
    if (ds(r[1]) !== rec.date) return;
    if (str(r[14]) && str(r[14]) !== rec.masterId) return;
    mine.push({ s: minutesOf(r[16], r[2]), e: minutesOf(r[17], r[3]), who: 'запись ' + str(r[0]) });
  });
  for (var i = 0; i < mine.length; i++) {
    if (overlap(rec.startMin, rec.endMin, mine[i].s - buf, mine[i].e + buf)) return mine[i];
  }
  var blocks = [];
  rows(blockSheet()).forEach(function (r) {
    if (ds(r[1]) !== rec.date) return;
    var mid = str(r[4]) || 'all';
    if (mid !== 'all' && mid !== rec.masterId) return;
    blocks.push({ s: minutesOf(r[6], r[2]), e: minutesOf(r[7], r[3]), who: 'блок: ' + (str(r[8]) || str(r[5])) });
  });
  for (var j = 0; j < blocks.length; j++) {
    if (overlap(rec.startMin, rec.endMin, blocks[j].s, blocks[j].e)) return blocks[j];
  }
  return null;
}

function dayBookings(date) {
  var out = [];
  rows(bookSheet()).forEach(function (r) { if (ds(r[1]) === date) out.push(bookingDto(r)); });
  out.sort(function (a, b) { return a.startMin - b.startMin; });
  return out;
}
function dayBlocks(date) {
  var out = [];
  rows(blockSheet()).forEach(function (r) { if (ds(r[1]) === date) out.push(blockDto(r)); });
  out.sort(function (a, b) { return a.startMin - b.startMin; });
  return out;
}

/* ========================= ПИСЬМО ВЛАДЕЛЬЦУ ========================= */
function sendOwnerEmail(rec) {
  var subject = 'Запись ' + rec.id + ' — ÉCLAT STUDIO';
  var body =
    'Новая запись!\n\n' +
    'Номер:    ' + rec.id + '\n' +
    'Дата:     ' + rec.date + ' (' + weekdayRu(rec.date) + ')\n' +
    'Время:    ' + rec.start + ' – ' + rec.end + '\n' +
    'Мастер:   ' + rec.master + '\n' +
    'Услуга:   ' + rec.service + '\n' +
    'Клиент:   ' + rec.name + '\n' +
    'Телефон:  ' + rec.phone + '\n' +
    'Цена:     ' + rec.price + ' руб.' +
      (rec.discountPercent ? ' (скидка ' + rec.discountPercent + '%, без скидки ' + rec.priceBase + ' руб.)' : '') + '\n' +
    (rec.comment ? 'Комментарий: ' + rec.comment + '\n' : '') +
    'Источник: ' + rec.source + '\n\n' +
    'Оплата производится в салоне.\n' +
    'Админка: https://venera0207.github.io/eclat-studio/admin.html\n';
  MailApp.sendEmail(OWNER_EMAIL, subject, body);
}

/* ====================== НАПОМИНАНИЯ (по желанию) ====================== */
function installReminderTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('digestTomorrow').timeBased().everyHours(1).create();
  return 'Триггер установлен: дайджест уходит в 19:00 по ' + TZ + '.';
}
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'digestTomorrow') ScriptApp.deleteTrigger(t);
  });
  return 'Триггеры напоминаний удалены.';
}
function digestTomorrow() {
  var h = new Date().getHours();
  if (h !== 19) return;                       // один раз в сутки, в 19:00
  var date = shiftDate(todayStr(), 1);
  var list = dayBookings(date).filter(function (b) { return b.status !== 'cancelled'; });
  if (!list.length) return;
  var text = 'Записи на завтра (' + date + ') — ' + list.length + ':\n' +
    list.map(function (b) { return b.start + ' ' + b.master + ' — ' + b.service + ' (' + b.name + ', ' + b.phone + ')'; }).join('\n');
  try { MailApp.sendEmail(OWNER_EMAIL, 'ÉCLAT: записи на ' + date, text); } catch (e) {}
}

/* ============================ УТИЛИТЫ ============================ */
function findService(c, id) {
  if (!id) return null;
  for (var i = 0; i < c.SERVICES.length; i++) if (str(c.SERVICES[i].id) === str(id)) return c.SERVICES[i];
  return null;
}
function serviceByTitle(c, title) {
  if (!title) return null;
  var t = String(title).toLowerCase().replace(/ё/g, 'е');
  for (var i = 0; i < c.SERVICES.length; i++) if (str(c.SERVICES[i].title).toLowerCase().replace(/ё/g, 'е') === t) return c.SERVICES[i];
  return null;
}
function findMaster(c, id) {
  if (!id) return null;
  for (var i = 0; i < c.MASTERS.length; i++) if (str(c.MASTERS[i].id) === str(id)) return c.MASTERS[i];
  return null;
}
function masterByName(c, name) {
  if (!name) return null;
  var t = String(name).toLowerCase().replace(/ё/g, 'е').trim();
  for (var i = 0; i < c.MASTERS.length; i++) if (str(c.MASTERS[i].name).toLowerCase().replace(/ё/g, 'е').trim() === t) return c.MASTERS[i];
  return null;
}

/* график мастера в конкретный день (та же логика, что в js/engine.js) */
function masterDay(master, dateS, SITE) {
  if (!master || master.active === false) return null;
  var d = parseDate(dateS);
  var sch = master.schedule || {};
  var days = sch.days || [0, 1, 2, 3, 4, 5, 6];
  if (days.indexOf(d.getDay()) < 0) return null;
  var vac = master.vacation || [];
  for (var i = 0; i < vac.length; i++) {
    var v = vac[i];
    if (v === dateS || (v && v.from && v.to && dateS >= v.from && dateS <= v.to)) return null;
  }
  var open = Math.max(hm2m(SITE.open || '08:00'), hm2m(sch.start || SITE.open || '08:00'));
  var close = Math.min(hm2m(SITE.close || '22:00'), hm2m(sch.end || SITE.close || '22:00'));
  if (close <= open) return null;
  var breaks = (sch.breaks || []).map(function (b) { return { s: hm2m(b.start), e: hm2m(b.end) }; });
  return { open: open, close: close, breaks: breaks };
}

function nextId() {
  var max = 0;
  try {
    var s = bookSheet();
    if (s.getLastRow() >= 2) {
      var col = s.getRange(2, 1, s.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < col.length; i++) {
        /* только «чистые» номера ECL-0001; старые ECL-1022-082712 игнорируем */
        var m = /^ECL-(\d{1,6})$/.exec(str(col[i][0]));
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
    }
  } catch (e) {}
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return 'ECL-' + n;
}

/* минуты из ячейки: сначала «машинная» колонка, потом человекочитаемая.
   Умеет и строку «17:00», и Date-ячейку (так Google хранит время в старых строках). */
function minutesOf(minCell, timeCell) {
  if (minCell !== '' && minCell != null && isFinite(parseFloat(minCell))) return num(minCell);
  return cellMinutes(timeCell);
}
function cellMinutes(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return hm2m(fmt(v, 'HH:mm'));
  return hm2m(String(v));
}

function overlap(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }
function hm2m(s) { var p = String(s == null ? '' : s).split(':'); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
function hm(m) {
  m = Math.max(0, Math.round(num(m)));
  var h = Math.floor(m / 60), mm = m % 60;
  return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
}
function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
function str(v) {
  if (v == null) return '';
  if (v instanceof Date) return stamp(v);   /* иначе получим «Thu Oct 22 2026 …» */
  return String(v).trim();
}
function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function cleanPhone(v) {
  var d = digits(v);
  if (d.length === 11 && (d.charAt(0) === '7' || d.charAt(0) === '8'))
    return '+7 ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9, 11);
  return str(v);
}

/* дата из ячейки: Date, «2026-10-22», «22.10.2026» → всегда «YYYY-MM-DD» */
function ds(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    /* ячейка «17:00» в старых строках возвращается датой 1899 года — это НЕ дата */
    if (v.getFullYear() < 1950) return '';
    return fmt(v, 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + pad2(m[2]) + '-' + pad2(m[3]);
  m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(s);
  if (m) return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
  return s.substring(0, 10);
}
function pad2(x) { x = String(x); return x.length < 2 ? '0' + x : x; }
function parseDate(s) { var p = ds(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function todayStr() { return fmt(new Date(), 'yyyy-MM-dd'); }
function shiftDate(dateS, days) {
  var d = parseDate(dateS); d.setDate(d.getDate() + days); return fmt(d, 'yyyy-MM-dd');
}
function fmt(d, pattern) { return Utilities.formatDate(d, TZ, pattern); }
function stamp(d) { return fmt(d, 'yyyy-MM-dd HH:mm:ss'); }
function iso(d) { return d.toISOString ? d.toISOString() : fmt(d, "yyyy-MM-dd'T'HH:mm:ss'Z'"); }
function weekdayRu(dateS) {
  var names = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  return names[parseDate(dateS).getDay()];
}
