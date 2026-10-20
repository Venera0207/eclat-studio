/* =====================================================================
   ÉCLAT STUDIO — труба ИИ-ассистента салона (Google Apps Script)
   ---------------------------------------------------------------------
   Точная копия архитектуры трубы ассистента Венеры (портфолио), но для
   парикмахерской: GLM через Z.ai с историей диалога, листы «Заявки» и
   «Диалоги», уведомления в Telegram, дайджест за день.
   Отличие-гордость: системный промпт собирается НЕ вручную, а из
   опубликованного site-data.js сайта (цены, услуги, часы, скидка) —
   поменяла цену в редакторе, ассистент узнаёт её сам через 5 минут.
   УСТАНОВКА: backend/eclat-pipe-README.md
   ===================================================================== */

/* ===== НАСТРОЙКИ (вставь свои ключи; те же три ключика, что у портфолио) ===== */
var ZAI_KEY   = 'ВСТАВЬ_ZAI_KEY';
var BOT_TOKEN = 'ВСТАВЬ_BOT_TOKEN';   // можно тот же бот, что у портфолио: заявки придут с пометкой ÉCLAT
var CHAT_ID   = 'ВСТАВЬ_CHAT_ID';
var MODEL     = 'glm-4.5-flash';
var SITE_DATA_URL = 'https://venera0207.github.io/eclat-studio/site-data.js'; // после публикации поправь
var SITE_URL      = 'https://venera0207.github.io/eclat-studio/';

var LEAD_SHEET = 'Заявки';
var LOG_SHEET  = 'Диалоги';

/* ===== системный промпт из живых данных сайта ===== */
function catalog() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('eclat_catalog');
  if (hit) return JSON.parse(hit);
  var src = UrlFetchApp.fetch(SITE_DATA_URL, { muteHttpExceptions: true }).getContentText('UTF-8');
  var fn = new Function(src + '; return {SITE:SITE, DISCOUNT:DISCOUNT, MASTERS:MASTERS, SERVICES:SERVICES, TEXTS:TEXTS};');
  var d = fn();
  cache.put('eclat_catalog', JSON.stringify(d), 300);
  return d;
}
function systemPrompt() {
  var d;
  try { d = catalog(); } catch (e) { d = null; }
  var base = 'Ты — ИИ-ассистент парикмахерского салона ' + (d ? d.SITE.name : 'ÉCLAT STUDIO') + '. ' +
    'Отвечай по-русски, тепло и кратко (до 80 слов), без канцелярита. ';
  if (!d) return base + 'Данные салона временно недоступны: предложи оставить имя и телефон, администратор перезвонит.';
  var services = d.SERVICES.filter(function (s) { return s.active !== false; }).map(function (s) {
    return s.title + ' (' + (s.cat === 'women' ? 'жен' : s.cat === 'men' ? 'муж' : 'дет') + ') — ' + s.price + ' ₽, ' + s.minutes + ' мин';
  }).join('; ');
  var masters = d.MASTERS.filter(function (m) { return m.active !== false; }).map(function (m) { return m.name + ' — ' + m.role; }).join('; ');
  return base +
    'Используй ТОЛЬКО эти данные салона: адрес: ' + d.SITE.address + (d.SITE.metro ? ', ' + d.SITE.metro : '') +
    '; телефон: ' + d.SITE.phone + '; почта: ' + d.SITE.email + '; график: ' + d.SITE.hours +
    '; оплата производится в салоне, онлайн-предоплаты нет' +
    '; пенсионная скидка: ' + (d.DISCOUNT.enabled ? d.DISCOUNT.subtitle + ', условия: ' + d.DISCOUNT.terms : 'временно отключена') +
    '; мастера: ' + masters + '; услуги и цены: ' + services + '. ' +
    'Точные свободные окна показывает сайт: если клиент хочет конкретное время, предложи нажать кнопку записи или оставь контакт администратору. ' +
    'Люди пишут с опечатками — понимай смысл и никогда не комментируй опечатки. Не выдумывай услуги, цены и факты сверх данных. ' +
    'Если просишь скидку сверх пенсионной — не обещай, предложи оставить контакт: владелица ответит лично. ' +
    'Если вопрос не про салон (посторонние темы) — мягко верни разговор к стрижкам, окрашиванию и записи. ' +
    'После ответа про цены или запись один раз ненавязчиво добавь: «Могу передать диалог администратору — он уточнит детали». ' +
    'Если клиент оставляет имя и телефон — поблагодари и скажи, что администратор свяжется в рабочее время.';
}

/* ===== HTTP: чат, заявки, журнал ===== */
function doGet(e) {
  var action = e.parameter.action || 'test';
  var callback = e.parameter.callback || '';
  var result;
  try {
    if (action === 'chat') {
      result = { ok: true, reply: askGlm(e.parameter.msg || '', e.parameter.hist || '') };
    } else if (action === 'lead') {
      saveLead(e.parameter.name || '', e.parameter.contact || '', e.parameter.message || '', e.parameter.source || 'ассистент');
      result = { ok: true, reply: 'Заявка принята! Салон скоро свяжется.' };
    } else if (action === 'log') {
      saveLog(e.parameter.page || '', e.parameter.client || '', e.parameter.bot || '', e.parameter.outcome || '', e.parameter.sid || '');
      result = { ok: true };
    } else if (action === 'alert') {
      sendTelegram('🚨 ÉCLAT: ' + (e.parameter.text || 'внимание'));
      result = { ok: true };
    } else if (action === 'setwebhook') {
      var url = ScriptApp.getService().getUrl();
      result = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(url)).getContentText());
    } else {
      result = { ok: true, reply: 'test ok' };
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  var json = JSON.stringify(result);
  return ContentService.createTextOutput(callback ? callback + '(' + json + ')' : json)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  var result;
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.message && data.message.chat && data.message.chat.id) {
      if ((data.message.text || '') === '/start') sendWelcome(data.message.chat.id);
      result = { ok: true };
    } else {
      saveLead(data.name || '', data.contact || '', data.message || '', 'telegram');
      result = { ok: true };
    }
  } catch (err) { result = { ok: false, error: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(result));
}

function sendWelcome(chatId) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: '👋 Привет! Я ассистент салона ÉCLAT STUDIO.\n💇 Знаю услуги, цены и свободные окна.\nНажми кнопку — и пообщаемся на сайте!',
      reply_markup: { inline_keyboard: [[{ text: '💇 Открыть салон', url: SITE_URL }]] }
    })
  });
}

/* ===== GLM с историей диалога ===== */
function askGlm(msg, hist) {
  var messages = [{ role: 'system', content: systemPrompt() }];
  if (hist) {
    try {
      var h = JSON.parse(hist);
      for (var i = 0; i < h.length; i++) messages.push({ role: h[i].role === 'user' ? 'user' : 'assistant', content: String(h[i].text).slice(0, 500) });
    } catch (err) {}
  }
  messages.push({ role: 'user', content: msg });
  var resp = UrlFetchApp.fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'post', muteHttpExceptions: true,
    headers: { 'Authorization': 'Bearer ' + ZAI_KEY, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ model: MODEL, messages: messages })
  });
  var json = JSON.parse(resp.getContentText());
  if (json.choices && json.choices[0]) return json.choices[0].message.content;
  return 'Ассистент салона на секундочку задумался: сервер ответил ' + resp.getContentText().slice(0, 120);
}

/* ===== листы, заявки, журнал, дайджест ===== */
function sheet_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (head) sh.appendRow(head); }
  return sh;
}
function saveLead(name, contact, message, source) {
  sheet_(LEAD_SHEET, ['Дата', 'Имя', 'Контакт', 'Заявка (весь диалог)', 'Источник'])
    .appendRow([new Date(), name, contact, message, source || 'ассистент']);
  /* в Telegram — суть и хвост диалога, чтобы видеть контекст заявки */
  sendTelegram('💇 ÉCLAT, новая заявка!\nИмя: ' + name + '\nКонтакт: ' + contact +
    '\nИсточник: ' + (source || 'ассистент') + '\n\nКонтекст диалога:\n…' + String(message).slice(-700));
}
/* ВЕСЬ диалог в одной строке: если sid уже есть — дообновляем строку, не плодим дубли */
function saveLog(page, client, dialogue, outcome, sid) {
  var sh = sheet_(LOG_SHEET, ['Дата', 'SID', 'Страница', 'Контакт', 'Весь диалог', 'Итог']);
  if (sid) {
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) {
      if (String(v[i][1]) === sid) {
        sh.getRange(i + 1, 4).setValue(client || v[i][3]);
        sh.getRange(i + 1, 5).setValue(dialogue);
        sh.getRange(i + 1, 6).setValue(outcome);
        return;
      }
    }
  }
  sh.appendRow([new Date(), sid || '', page, client || '', dialogue, outcome]);
}
function digestDay() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET);
  if (!sh) { sendTelegram('📊 ÉCLAT: журнал диалогов пока пуст.'); return; }
  var v = sh.getDataRange().getValues();
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var total = 0, withLead = 0;
  for (var i = 1; i < v.length; i++) {
    if (new Date(v[i][0]) >= today) { total++; if (String(v[i][2])) withLead++; }
  }
  sendTelegram('📊 ÉCLAT за день.\nДиалогов ассистента: ' + total + '\nС контактами: ' + withLead);
}
function sendTelegram(text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'post', payload: { chat_id: CHAT_ID, text: text }
  });
}
