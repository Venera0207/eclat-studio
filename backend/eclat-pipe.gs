/* =====================================================================
   ÉCLAT STUDIO — труба ИИ-ассистента салона (Google Apps Script), v2
   ---------------------------------------------------------------------
   Живёт ОТДЕЛЬНО от трубы записи (backend/appsscript.gs) и от других
   проектов Венеры: своя таблица, свой бот, свои листы «Заявки»/«Диалоги».

   ЧТО ПОЧИНЕНО ОТНОСИТЕЛЬНО v1:
     1. v1 падала при сохранении заявки, если скрипт не привязан к таблице:
        getActiveSpreadsheet() у отдельного скрипта = null. Теперь своя
        таблица создаётся сама и запоминается в свойствах (ASSIST_DB_ID).
     2. Заявка больше НЕ теряется: сначала пишем в лист, потом Telegram,
        потом письмо владельцу — каждый шаг в своём try/catch.
        Даже если бот и почта отключены, заявка лежит в таблице.
     3. Телефон клиента в листе пишется ТЕКСТОМ (формат «@») — иначе
        «+7 927…» превращается в #ERROR!, как это было в записях.
     4. Каталог сайта читается БЕЗ new Function/eval (песочница Apps Script
        их не гарантирует) — тем же безопасным парсером, что в трубе записи.
     5. Без ключа Z.ai чат не падает и не показывает клиенту «сервер ответил
        401», а вежливо возвращает запасной ответ (ai:false).
     6. action=test даёт диагностику: какие ключи заданы, читается ли каталог.

   ДЕЙСТВИЯ (JSONP, параметр callback):
     chat   — ответ нейросети (или запасной ответ без ключа)
     lead   — заявка из чата: лист + Telegram + письмо
     log    — журнал диалога (одна строка на разговор, дообновляется по sid)
     alert  — срочное уведомление в Telegram + письмо
     test / ping — диагностика
     setwebhook — повесить Telegram-вебхук на этот скрипт

   УСТАНОВКА: backend/eclat-pipe-README.md и «ПРОЧТИ-МЕНЯ-БОТ.txt»
   ===================================================================== */

/* ============================ НАСТРОЙКИ ============================ */
var ZAI_KEY   = 'ВСТАВЬ_ZAI_KEY';        // ключ Z.ai (GLM); без него бот отвечает из базы сайта
var BOT_TOKEN = 'ВСТАВЬ_BOT_TOKEN';      // ОТДЕЛЬНЫЙ бот салона, созданный у @BotFather
var CHAT_ID   = 'ВСТАВЬ_CHAT_ID';        // твой числовой id (куда слать заявки), например 123456789
var OWNER_EMAIL = 'venera.web.4@gmail.com';
var MODEL     = 'glm-4.5-flash';
var SITE_DATA_URL = 'https://venera0207.github.io/eclat-studio/site-data.js';
var SITE_URL      = 'https://venera0207.github.io/eclat-studio/';
var TZ = 'Europe/Moscow';

var LEAD_SHEET = 'Заявки';
var LOG_SHEET  = 'Диалоги';
var LEAD_HEAD  = ['Дата', 'Имя', 'Контакт', 'Заявка (весь диалог)', 'Источник'];
var LOG_HEAD   = ['Дата', 'SID', 'Страница', 'Контакт', 'Весь диалог', 'Итог'];
var LEAD_TEXT_COLS = [2, 3, 4, 5];   // Имя, Контакт, диалог, источник — только текстом
var LOG_TEXT_COLS  = [2, 3, 4, 5, 6];
var CATALOG_CACHE = 'eclat_assistant_catalog';

/* ============================== HTTP ============================== */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = String(p.action || 'test');
  var cbName = String(p.callback || p.cb || '');
  var out;
  try {
    switch (action) {
      case 'ping': out = { ok: true, time: iso(new Date()), version: 2 }; break;
      case 'test': out = doTest(); break;
      case 'chat': out = doChat(p); break;
      case 'lead': out = doLead(p); break;
      case 'log':  out = doLog(p); break;
      case 'alert':
        notify('🚨 ÉCLAT: ' + (p.text || 'внимание'));
        out = { ok: true };
        break;
      case 'setwebhook':
        out = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN +
          '/setWebhook?url=' + encodeURIComponent(ScriptApp.getService().getUrl())).getContentText());
        break;
      default: out = { ok: false, error: 'Unknown action: ' + action,
                       hint: 'Доступные: ping, test, chat, lead, log, alert, setwebhook' };
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  var json = JSON.stringify(out);
  var body = cbName ? (cbName.replace(/[^A-Za-z0-9_$.]/g, '') + '(' + json + ')') : json;
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* Telegram-вебхук: /start от любого человека */
function doPost(e) {
  var out;
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (data.message && data.message.chat && data.message.chat.id) {
      if ((data.message.text || '') === '/start') sendWelcome(data.message.chat.id);
      out = { ok: true };
    } else if (data.sid && (data.bot !== undefined || data.outcome !== undefined)) {
      out = doLog(data);                       /* журнал диалога по POST/beacon */
    } else {
      out = doLead({ name: data.name || '', contact: data.contact || '', message: data.message || '',
                     source: data.source || 'telegram' });
    }
  } catch (err) { out = { ok: false, error: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out));
}

function doTest() {
  var c = safeCatalog();
  return { ok: true, version: 2.1, pretty: true, time: iso(new Date()),
           zaiKeySet: hasZai(), botTokenSet: hasBot(), chatIdSet: hasChat(),
           catalogOk: !!c.ok, services: c.SERVICES.length, masters: c.MASTERS.length,
           siteDataUrl: SITE_DATA_URL };
}

/* ============================ ЧАТ (GLM) ============================ */
var AI_FALLBACK = 'Нейросеть сейчас недоступна, но я знаю услуги, цены, часы работы и ' +
  'свободные окна салона — спросите про них или нажмите кнопку «Записаться» ниже 🙂';

function doChat(p) {
  var msg = String(p.msg || '').slice(0, 1500);
  if (!msg) return { ok: true, reply: 'Слушаю! Спросите про услуги, цены или свободные окна 🙂', ai: false };
  if (!hasZai()) return { ok: true, reply: AI_FALLBACK, ai: false, reason: 'no key' };
  var reply = askGlm(msg, p.hist || '');
  if (!reply) return { ok: true, reply: AI_FALLBACK, ai: false, reason: 'api error' };
  return { ok: true, reply: reply, ai: true };
}

function askGlm(msg, hist) {
  var messages = [{ role: 'system', content: systemPrompt() }];
  if (hist) {
    try {
      var h = JSON.parse(hist);
      for (var i = 0; i < h.length; i++) {
        messages.push({ role: h[i].role === 'user' ? 'user' : 'assistant', content: String(h[i].text).slice(0, 500) });
      }
    } catch (err) {}
  }
  messages.push({ role: 'user', content: msg });
  try {
    var resp = UrlFetchApp.fetch('https://api.z.ai/api/paas/v4/chat/completions', {
      method: 'post', muteHttpExceptions: true,
      headers: { 'Authorization': 'Bearer ' + ZAI_KEY, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ model: MODEL, messages: messages })
    });
    if (resp.getResponseCode() !== 200) return null;
    var json = JSON.parse(resp.getContentText());
    if (json.choices && json.choices[0] && json.choices[0].message) return json.choices[0].message.content;
    return null;
  } catch (err) { return null; }
}

/* системный промпт из ЖИВЫХ данных сайта: поменяла цену — бот узнает сам */
function systemPrompt() {
  var d = safeCatalog();
  var base = 'Ты — ИИ-ассистент парикмахерского салона ' + ((d.SITE || {}).name || 'ÉCLAT STUDIO') + '. ' +
    'Отвечай по-русски, тепло и кратко (до 80 слов), без канцелярита. ';
  if (!d.ok) return base + 'Данные салона временно недоступны: предложи оставить имя и телефон, администратор перезвонит.';
  var services = d.SERVICES.filter(function (s) { return s.active !== false; }).map(function (s) {
    return s.title + ' (' + (s.cat === 'women' ? 'жен' : s.cat === 'men' ? 'муж' : 'дет') + ') — ' + s.price + ' ₽, ' + s.minutes + ' мин';
  }).join('; ');
  var masters = d.MASTERS.filter(function (m) { return m.active !== false; }).map(function (m) {
    return m.name + ' — ' + m.role;
  }).join('; ');
  return base +
    'Используй ТОЛЬКО эти данные салона: адрес: ' + d.SITE.address + (d.SITE.metro ? ', ' + d.SITE.metro : '') +
    '; телефон: ' + d.SITE.phone + '; почта: ' + d.SITE.email + '; график: ' + d.SITE.hours +
    '; оплата производится в салоне, онлайн-предоплаты нет' +
    '; пенсионная скидка: ' + (d.DISCOUNT.enabled ? d.DISCOUNT.subtitle + ', условия: ' + d.DISCOUNT.terms : 'временно отключена') +
    '; мастера: ' + masters + '; услуги и цены: ' + services + '. ' +
    'Точные свободные окна показывает сайт: если клиент хочет конкретное время, предложи нажать кнопку записи или оставить контакт администратору. ' +
    'Люди пишут с опечатками — понимай смысл и никогда не комментируй опечатки. Не выдумывай услуги, цены и факты сверх данных. ' +
    'Если просят скидку сверх пенсионной — не обещай, предложи оставить контакт: владелица ответит лично. ' +
    'Если вопрос не про салон — мягко верни разговор к стрижкам, окрашиванию и записи. ' +
    'После ответа про цены или запись один раз ненавязчиво добавь: «Могу передать диалог администратору — он уточнит детали». ' +
    'Если клиент оставляет имя и телефон — поблагодари и скажи, что администратор свяжется в рабочее время.';
}

/* ======================= ЗАЯВКИ: НЕ ТЕРЯЕМ НИЧЕГО ======================= */
function doLead(p) {
  var name = String(p.name || '').slice(0, 80);
  var contact = String(p.contact || '').slice(0, 60);
  var message = String(p.message || '').slice(0, 8000);
  var source = String(p.source || 'ассистент');
  var sheet = false, tg = false, mail = false;

  /* 1) таблица — главная копия */
  try {
    var leadSh = sheetNamed(LEAD_SHEET, LEAD_HEAD);
    appendRowText(leadSh, [new Date(), name, contact, message, source], LEAD_TEXT_COLS);
    beautify(leadSh, LEAD_WIDTHS, [4], [1]);
    sheet = true;
  } catch (err) {}

  /* 2) Telegram владелице: суть + хвост диалога для контекста */
  tg = sendTelegram('💇 ÉCLAT, новая заявка!\nИмя: ' + name + '\nКонтакт: ' + contact +
    '\nИсточник: ' + source + '\n\nКонтекст диалога:\n…' + message.slice(-700));

  /* 3) письмо-дублёр, если Telegram молчит */
  try {
    MailApp.sendEmail(OWNER_EMAIL, 'ÉCLAT: заявка из чата — ' + (name || 'без имени'),
      'Имя: ' + name + '\nКонтакт: ' + contact + '\nИсточник: ' + source +
      '\nTelegram-уведомление: ' + (tg ? 'отправлено' : 'НЕ отправлено') +
      '\n\nВесь диалог:\n' + message + '\n\nСайт: ' + SITE_URL + '\n');
    mail = true;
  } catch (err) {}

  if (!sheet && !tg && !mail) {
    return { ok: false, error: 'all channels failed', ru: 'Не удалось сохранить заявку. Позвоните в салон.' };
  }
  return { ok: true, reply: 'Заявка принята! Салон скоро свяжется.', sheet: sheet, telegram: tg, mail: mail };
}

/* журнал: одна строка на разговор, дообновляется по sid */
function doLog(p) {
  var sh = sheetNamed(LOG_SHEET, LOG_HEAD);
  var sid = String(p.sid || '');
  var client = String(p.client || '');
  var dialogue = String(p.bot || '').slice(0, 20000);
  var outcome = String(p.outcome || '');
  if (sid) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][1]) === sid) {
        if (client) sh.getRange(i + 1, 4).setValue(client);
        sh.getRange(i + 1, 5).setValue(dialogue);
        sh.getRange(i + 1, 6).setValue(outcome);
        beautify(sh, LOG_WIDTHS, [5], [1]);
        return { ok: true, updated: sid };
      }
    }
  }
  appendRowText(sh, [new Date(), sid, String(p.page || ''), client, dialogue, outcome], LOG_TEXT_COLS);
  beautify(sh, LOG_WIDTHS, [5], [1]);
  return { ok: true, created: sid };
}

/* дайджест за день (вызывать триггером, если захочется) */
function digestDay() {
  var sh = SpreadsheetApp.getActiveSpreadsheet
    ? ss().getSheetByName(LOG_SHEET) : null;
  if (!sh) { notify('📊 ÉCLAT: журнал диалогов пока пуст.'); return; }
  var v = sh.getDataRange().getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var total = 0, withLead = 0;
  for (var i = 1; i < v.length; i++) {
    var d = v[i][0] instanceof Date ? v[i][0] : new Date(v[i][0]);
    if (d >= today) { total++; if (String(v[i][3]).trim()) withLead++; }   /* контакт — колонка 4 */
  }
  notify('📊 ÉCLAT за день.\nДиалогов ассистента: ' + total + '\nС контактами: ' + withLead);
}

/* ==================== УВЕДОМЛЕНИЯ: TG + ПОЧТА ==================== */
function notify(text) {
  var tg = sendTelegram(text);
  if (!tg) { try { MailApp.sendEmail(OWNER_EMAIL, 'ÉCLAT: уведомление', text); } catch (e) {} }
  return tg;
}
function sendTelegram(text) {
  if (!hasBot() || !hasChat()) return false;
  try {
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'post', muteHttpExceptions: true,
      payload: { chat_id: CHAT_ID, text: text }
    });
    return r.getResponseCode() === 200;
  } catch (e) { return false; }
}
function sendWelcome(chatId) {
  if (!hasBot()) return;
  try {
    UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({
        chat_id: chatId,
        text: '👋 Привет! Я ассистент салона ÉCLAT STUDIO.\n💇 Знаю услуги, цены и свободные окна.\nНажми кнопку — и пообщаемся на сайте!',
        reply_markup: { inline_keyboard: [[{ text: '💇 Открыть салон', url: SITE_URL }]] }
      })
    });
  } catch (e) {}
}

/* ---------- КРАСОТА ТАБЛИЦ: читаемо с первого взгляда ----------
   ширины колонок, перенос текста в длинных колонках, точное время
   «дд.мм.гггг чч:мм:сс», закреплённая шапка, жирные заголовки и
   удаление пустых колонок справа, чтобы таблица была «по размеру». */
function beautify(sh, widths, wrapCols, dateCols) {
  try {
    var i, rows = Math.max(sh.getLastRow() - 1, 1);
    for (i = 0; i < widths.length; i++) sh.setColumnWidth(i + 1, widths[i]);
    if (sh.getMaxColumns() > widths.length) sh.deleteColumns(widths.length + 1, sh.getMaxColumns() - widths.length);
    for (i = 0; i < wrapCols.length; i++) sh.getRange(2, wrapCols[i], rows, 1).setWrap(true).setVerticalAlignment('top');
    for (i = 0; i < dateCols.length; i++) sh.getRange(2, dateCols[i], rows, 1).setNumberFormat('dd.mm.yyyy hh:mm:ss');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, widths.length).setFontWeight('bold');
  } catch (e) {}
}
var LEAD_WIDTHS = [150, 110, 135, 480, 110];
var LOG_WIDTHS  = [150, 150, 110, 120, 560, 90];

/* ================== ТАБЛИЦА, КАТАЛОГ, УТИЛИТЫ ================== */
function ss() {
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ASSIST_DB_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var created = SpreadsheetApp.create('ÉCLAT STUDIO — ассистент: заявки и диалоги');
  props.setProperty('ASSIST_DB_ID', created.getId());
  return created;
}
function sheetNamed(name, head) {
  var s = ss().getSheetByName(name);
  if (!s) { s = ss().insertSheet(name); s.appendRow(head); }
  else if (s.getLastRow() === 0) s.appendRow(head);
  return s;
}
/* текстовые колонки: два прохода, как в трубе записи — иначе «+7…» = #ERROR! */
function appendRowText(s, row, textCols) {
  var r = s.getLastRow() + 1, i, c;
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

/* безопасное чтение site-data.js без eval/new Function */
function safeCatalog() {
  var c = CacheService.getScriptCache();
  var hit = c.get(CATALOG_CACHE);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  var src = '';
  try { src = UrlFetchApp.fetch(SITE_DATA_URL, { muteHttpExceptions: true }).getContentText('UTF-8'); } catch (e) {}
  var d = parseSiteData(src);
  if (d.SERVICES.length) { try { c.put(CATALOG_CACHE, JSON.stringify(d), 300); } catch (e) {} }
  return d;
}
function parseSiteData(src) {
  var empty = { ok: false, SITE: {}, SETTINGS: {}, DISCOUNT: { enabled: false, percent: 0 }, MASTERS: [], SERVICES: [], TEXTS: {} };
  if (!src) return empty;
  var out = { ok: true };
  ['SITE', 'SETTINGS', 'DISCOUNT', 'MASTERS', 'SERVICES', 'TEXTS'].forEach(function (name) {
    out[name] = sliceValue(src, name);
  });
  if (!out.SITE) out.ok = false;
  out.MASTERS = out.MASTERS || []; out.SERVICES = out.SERVICES || [];
  out.DISCOUNT = out.DISCOUNT || { enabled: false, percent: 0 }; out.TEXTS = out.TEXTS || {};
  return out;
}
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

function hasZai()  { return !!ZAI_KEY && ZAI_KEY.indexOf('ВСТАВЬ') < 0; }
function hasBot()  { return !!BOT_TOKEN && BOT_TOKEN.indexOf('ВСТАВЬ') < 0; }
function hasChat() { return !!CHAT_ID && CHAT_ID.indexOf('ВСТАВЬ') < 0; }
function iso(d) { return d.toISOString ? d.toISOString() : String(d); }
