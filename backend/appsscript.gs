var OWNER_EMAIL = 'venera.web.4@gmail.com';
var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';
var SITE_DATA_URL = 'https://venera0207.github.io/eclat-studio/site-data.js';

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

function doGet(e) {
  var p = e.parameter || {};
  var action = p.action || 'ping';
  var out = { ok: false, error: 'Unknown action' };

  try {
    if (action === 'ping') {
      out = { ok: true, time: new Date().toISOString() };
    } 
    else if (action === 'book') {
      out = handleBooking(p);
    } 
    else if (action === 'getDay') {
      out = checkToken(p.token) ? getDaySchedule(p.date) : { ok: false, error: 'Bad token' };
    } 
    else if (action === 'getStats') {
      out = checkToken(p.token) ? getStats() : { ok: false, error: 'Bad token' };
    } 
    else if (action === 'cancel') {
      out = checkToken(p.token) ? cancelBooking(p.id) : { ok: false, error: 'Bad token' };
    } 
    else if (action === 'addBlock') {
      out = checkToken(p.token) ? addBlock(p) : { ok: false, error: 'Bad token' };
    } 
    else if (action === 'manualBook') {
      out = checkToken(p.token) ? handleBooking(p, true) : { ok: false, error: 'Bad token' };
    }
  } catch (err) {
    out = { ok: false, error: err.toString() };
  }

  var json = JSON.stringify(out);
  var body = p.cb ? (p.cb + '(' + json + ')') : json;
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function checkToken(token) {
  return token === ADMIN_TOKEN;
}

function handleBooking(p, isManual) {
  var sheet = ss().getSheetByName('Записи');
  if (!sheet) {
    sheet = ss().insertSheet('Записи');
    sheet.appendRow(['Номер', 'Дата', 'Начало', 'Конец', 'Мастер', 'Услуга', 'Имя', 'Телефон', 'Комментарий', 'Статус', 'Цена', 'Скидка', 'Источник', 'Создана']);
  }

  var id = p.id || 'ECL-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMdd-HHmmss');
  var status = p.status || 'подтверждена';
  var source = isManual ? 'админ' : (p.source || 'сайт');
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  sheet.appendRow([id, p.date, p.start, p.end, p.master, p.service, p.name, "'" + p.phone, p.comment || '', status, p.price, p.discount || 0, source, now]);

  if (!isManual && status === 'подтверждена') {
    sendEmail(id, p);
    var logSheet = ss().getSheetByName('Журнал');
    if (!logSheet) { logSheet = ss().insertSheet('Журнал'); logSheet.appendRow(['Время', 'Событие', 'ID записи']); }
    logSheet.appendRow([now, 'письмо-заявка отправлено', id]);
  }

  return { ok: true, id: id, message: 'Запись сохранена' };
}

function sendEmail(id, p) {
  var subject = 'Запись ' + id + ' — ÉCLAT STUDIO';
  var body = 'Новая запись!\n\n' +
             'Номер: ' + id + '\n' +
             'Дата: ' + p.date + '\n' +
             'Время: ' + p.start + ' – ' + p.end + '\n' +
             'Мастер: ' + p.master + '\n' +
             'Услуга: ' + p.service + '\n' +
             'Клиент: ' + p.name + '\n' +
             'Телефон: ' + p.phone + '\n' +
             'Цена: ' + p.price + ' руб.\n\n' +
             'Оплата производится в салоне.';
  MailApp.sendEmail(OWNER_EMAIL, subject, body);
}

function getDaySchedule(date) {
  var sheet = ss().getSheetByName('Записи');
  if (!sheet) return { ok: true, bookings: [], blocks: [] };
  var data = sheet.getDataRange().getValues();
  var bookings = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == date && data[i][9] !== 'отменена') {
      bookings.push({ id: data[i][0], start: data[i][2], end: data[i][3], master: data[i][4], service: data[i][5], name: data[i][6], phone: data[i][7], status: data[i][9] });
    }
  }
  var blockSheet = ss().getSheetByName('Блоки');
  var blocks = [];
  if (blockSheet) {
    var bData = blockSheet.getDataRange().getValues();
    for (var j = 1; j < bData.length; j++) {
      if (bData[j][1] == date) {
        blocks.push({ id: bData[j][0], start: bData[j][2], end: bData[j][3], master: bData[j][4], reason: bData[j][5] });
      }
    }
  }
  return { ok: true, bookings: bookings, blocks: blocks };
}

function getStats() {
  var sheet = ss().getSheetByName('Записи');
  if (!sheet) return { ok: true, total: 0, today: 0, canceled: 0 };
  var data = sheet.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var total = 0, todayCount = 0, canceled = 0;
  for (var i = 1; i < data.length; i++) {
    total++;
    if (data[i][1] == today) todayCount++;
    if (data[i][9] === 'отменена') canceled++;
  }
  return { ok: true, total: total, today: todayCount, canceled: canceled };
}

function cancelBooking(id) {
  var sheet = ss().getSheetByName('Записи');
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 10).setValue('отменена');
      return { ok: true, message: 'Запись отменена' };
    }
  }
  return { ok: false, error: 'Запись не найдена' };
}

function addBlock(p) {
  var sheet = ss().getSheetByName('Блоки');
  if (!sheet) {
    sheet = ss().insertSheet('Блоки');
    sheet.appendRow(['ID', 'Дата', 'Начало', 'Конец', 'Мастер', 'Причина']);
  }
  var id = 'BLK-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMdd-HHmmss');
  sheet.appendRow([id, p.date, p.start, p.end, p.master || 'Все', p.reason || 'Блок']);
  return { ok: true, id: id };
}
