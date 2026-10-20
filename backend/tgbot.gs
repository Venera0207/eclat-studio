/* =====================================================================
   ÉCLAT STUDIO — Telegram-бот с кнопкой мини-приложения (Google Apps Script)
   ---------------------------------------------------------------------
   Что умеет: /start и обычные вопросы (часы, адрес, цены, телефон) +
   кнопка «💇 Записаться онлайн», открывающую сайт как мини-приложение
   прямо внутри Telegram (имя клиента подставится из его профиля).
   УСТАНОВКА: см. backend/tgbot-README.md (10 минут, без серверов).
   ===================================================================== */

var TOKEN = 'ВСТАВЬТЕ_ТОКЕН_ОТ_BOTFATHER';
var MINIAPP_URL = 'https://venera0207.github.io/eclat-studio/index.html'; // адрес опубликованного сайта
var SALON = 'ÉCLAT STUDIO';

function doGet(e) {
  if (e && e.parameter && e.parameter.setwebhook === '1') {
    var url = ScriptApp.getService().getUrl();
    var r = UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/setWebhook?url=' + encodeURIComponent(url));
    return ContentService.createTextOutput(r.getContentText());
  }
  return ContentService.createTextOutput(SALON + ' bot alive');
}

function doPost(e) {
  try {
    var up = JSON.parse(e.postData.contents);
    var msg = up.message || up.edited_message;
    if (msg && msg.chat && msg.chat.id) {
      var text = String(msg.text || '').toLowerCase();
      if (text.indexOf('/start') === 0) menu(msg.chat.id, true);
      else if (/час|график|работ|открыт/.test(text)) plain(msg.chat.id, 'Работаем ежедневно с 08:00 до 22:00, без выходных.');
      else if (/адрес|где вы|карта|как добраться/.test(text)) plain(msg.chat.id, 'Адрес: Шлиссельбургский пр., 24, к1. 8 минут пешком от м. «Рыбацкое».');
      else if (/цен|стои|сколько|прайс/.test(text)) menu(msg.chat.id, false, 'Цены и свободные окна — в мини-приложении: выбор услуги и времени занимает минуту.');
      else if (/телефон|позвон|связаться/.test(text)) plain(msg.chat.id, 'Телефон: +7 931 357-96-00, WhatsApp по тому же номеру. Почта: venera.web.4@gmail.com');
      else if (/скидк|пенсион/.test(text)) plain(msg.chat.id, 'Пенсионерам — скидка 50%. Подробности и запись — в мини-приложении.');
      else menu(msg.chat.id, false);
    }
  } catch (err) {}
  return ContentService.createTextOutput('ok');
}

function menu(chat, hello, lead) {
  send(chat,
    (hello ? 'Здравствуйте! Я ассистент салона ' + SALON + '.\n' : '') +
    (lead || 'Подскажу часы, адрес и цены, а запишу вас — через мини-приложение: выбор услуги, мастера и свободного времени занимает минуту.'),
    true);
}
function plain(chat, text) { send(chat, text, false); }

function send(chat, text, withBtn) {
  var payload = {
    chat_id: chat,
    text: text,
    disable_web_page_preview: true
  };
  if (withBtn) {
    payload.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: '💇 Записаться онлайн', web_app: { url: MINIAPP_URL } }]]
    });
  }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  });
}
