/* =====================================================================
   ÉCLAT STUDIO — ИИ-ассистент салона (окошко на сайте)
   ---------------------------------------------------------------------
   Архитектура — как у ассистентов Венеры (портфолио, «Атланта»):
   • мгновенные ответы из локальной базы (услуги, цены, часы, скидка);
   • ЖИВОЙ КАЛЕНДАРЬ: свободные окна считаются движком записи из реальных
     данных (графики мастеров, занятые окна, перерывы, отпуска);
   • сложные вопросы — нейросети через трубу Google Apps Script (JSONP),
     если в site-data.js задан SETTINGS.assistantUrl;
   • заявки (имя+телефон) уходят в трубу: лист «Заявки» + уведомление
     в Telegram владелице; журнал диалогов — лист «Диалоги».
   Посетителю Telegram НЕ нужен: всё живёт на сайте.
   ===================================================================== */
(function () {
  'use strict';
  var E = window.ECLAT;
  var PIPE = (window.SETTINGS && SETTINGS.assistantUrl) ? SETTINGS.assistantUrl : '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; };
  var hist = [], outcome = 'kb', msgCount = 0, leadTaken = false;
  var SID = 'ea-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  function transcript() {
    return hist.map(function (h) { return (h.role === 'user' ? 'Клиент: ' : 'Ассистент: ') + h.text; }).join('\n');
  }

  /* ---------- разметка и стили ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#ea-fab{position:fixed;right:22px;bottom:22px;z-index:75;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;' +
    'background:linear-gradient(135deg,var(--violet,#7C3AED),var(--magenta,#FF2EC4));box-shadow:0 10px 34px rgba(124,58,237,.45);' +
    'color:#fff;font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .2s}' +
    '#ea-fab:hover{transform:scale(1.07)}' +
    '#ea-panel{position:fixed;right:22px;bottom:92px;z-index:76;width:min(400px,calc(100vw - 24px));height:min(620px,calc(100vh - 120px));' +
    'display:none;flex-direction:column;background:#101018;border:1px solid #26263A;border-radius:22px;overflow:hidden;' +
    'box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 50px rgba(124,58,237,.14)}' +
    '#ea-panel.on{display:flex}' +
    '#ea-head{padding:14px 18px;background:linear-gradient(92deg,rgba(124,58,237,.9),rgba(255,46,196,.85));color:#fff}' +
    '#ea-head b{font-family:var(--font-h,inherit);font-size:16px;display:block}' +
    '#ea-head span{font-size:12.5px;opacity:.85}' +
    '#ea-msgs{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:10px}' +
    '.ea-m{max-width:86%;padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap}' +
    '.ea-m.bot{align-self:flex-start;background:#1B1B28;border:1px solid #26263A;color:#EDEBF4;border-bottom-left-radius:6px}' +
    '.ea-m.user{align-self:flex-end;background:linear-gradient(135deg,#7C3AED,#FF2EC4);color:#fff;border-bottom-right-radius:6px}' +
    '.ea-m .lnk{color:#8BE9FD;cursor:pointer;text-decoration:underline}' +
    '#ea-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px}' +
    '#ea-chips button{border:1px solid #34344C;background:#161622;color:#C9C6DA;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit}' +
    '#ea-chips button:hover{border-color:#FF2EC4;color:#fff}' +
    '#ea-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #26263A}' +
    '#ea-in input{flex:1;background:#0C0C14;border:1.5px solid #26263A;border-radius:12px;color:#EDEBF4;padding:11px 14px;font-size:15px;font-family:inherit}' +
    '#ea-in input:focus{outline:none;border-color:#7C3AED}' +
    '#ea-in button{border:0;border-radius:12px;background:linear-gradient(135deg,#7C3AED,#FF2EC4);color:#fff;width:46px;cursor:pointer;font-size:18px}' +
    '.ea-typing{display:inline-flex;gap:4px}.ea-typing i{width:6px;height:6px;border-radius:50%;background:#8BE9FD;animation:eab 1s infinite}' +
    '.ea-typing i:nth-child(2){animation-delay:.15s}.ea-typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes eab{50%{transform:translateY(-4px);opacity:.5}}' +
    '@media(max-width:520px){#ea-panel{right:0;bottom:0;width:100vw;height:100vh;border-radius:0}#ea-fab{right:14px;bottom:14px}}';
  document.head.appendChild(st);

  var fab = document.createElement('button');
  fab.id = 'ea-fab'; fab.setAttribute('aria-label', 'Чат с ассистентом салона'); fab.textContent = '💬';
  var panel = document.createElement('div');
  panel.id = 'ea-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ассистент салона');
  panel.innerHTML =
    '<div id="ea-head"><b>Ассистент ÉCLAT STUDIO</b><span>отвечаю мгновенно · знаю свободные окна · запишу за минуту</span></div>' +
    '<div id="ea-msgs"></div><div id="ea-chips"></div>' +
    '<div id="ea-in"><input id="ea-text" placeholder="Напишите вопрос…" maxlength="400"><button id="ea-send" aria-label="Отправить">➤</button></div>';
  document.body.appendChild(fab); document.body.appendChild(panel);

  var msgs = panel.querySelector('#ea-msgs'), chips = panel.querySelector('#ea-chips'), inp = panel.querySelector('#ea-text');
  function addMsg(role, html) {
    var d = document.createElement('div');
    d.className = 'ea-m ' + role; d.innerHTML = html;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function typing(on) {
    var t = msgs.querySelector('.ea-typing-wrap');
    if (on) { if (!t) { t = document.createElement('div'); t.className = 'ea-m bot ea-typing-wrap'; t.innerHTML = '<span class="ea-typing"><i></i><i></i><i></i></span>'; msgs.appendChild(t); msgs.scrollTop = msgs.scrollHeight; } }
    else if (t) t.remove();
  }
  function setChips(list) {
    chips.innerHTML = '';
    list.forEach(function (c) {
      var b = document.createElement('button'); b.textContent = c;
      b.addEventListener('click', function () { send(c); });
      chips.appendChild(b);
    });
  }

  /* ---------- живой календарь ---------- */
  function bookings() { return window.ECLAT_BOOKINGS ? window.ECLAT_BOOKINGS() : []; }
  function blocks() { return window.ECLAT_BLOCKS ? window.ECLAT_BLOCKS() : []; }
  function dateFromText(q) {
    var now = new Date();
    if (/сегодн/.test(q)) return E.dstr(now);
    if (/послезавтра/.test(q)) return E.dstr(E.addDays(now, 2));
    if (/завтра/.test(q)) return E.dstr(E.addDays(now, 1));
    var dow = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'].findIndex(function (d) { return q.indexOf(d) >= 0; });
    if (dow >= 0) { for (var i = 1; i <= 7; i++) { var d = E.addDays(now, i); if (d.getDay() === dow) return E.dstr(d); } }
    var m = q.match(/(\d{1,2})[.\/](\d{1,2})/);
    if (m) { var dd = new Date(now.getFullYear(), +m[2] - 1, +m[1]); if (dd >= now) return E.dstr(dd); }
    return null;
  }
  function guessService(q) {
    var best = null, bestScore = 0;
    SERVICES.forEach(function (s) {
      var words = s.title.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter(function (w) { return w.length > 4; });
      words.forEach(function (w) {
        var stem = w.slice(0, Math.max(5, w.length - 2));
        if (q.indexOf(stem) >= 0 && stem.length > bestScore) { best = s; bestScore = stem.length; }
      });
    });
    if (!best) {
      if (/мелир/.test(q)) best = SERVICES.filter(function (s) { return s.id === 'w7'; })[0];
      if (/балая|shatush|шатуш/.test(q)) best = SERVICES.filter(function (s) { return s.id === 'w8'; })[0];
      if (/фейд|fade/.test(q)) best = SERVICES.filter(function (s) { return s.id === 'h3'; })[0];
      if (/бород/.test(q)) best = SERVICES.filter(function (s) { return s.id === 'h5'; })[0];
      if (/пенс/.test(q)) best = SERVICES.filter(function (s) { return s.id === 'w1'; })[0];
    }
    return best;
  }
  function slotsReply(q) {
    var ds = dateFromText(q);
    if (!ds) return null;
    var svc = guessService(q);
    var minutes = svc ? svc.minutes : 60;
    var masters = svc ? E.eligibleMasters(svc, MASTERS, ds, SITE) : MASTERS.filter(function (m) { return m.active !== false; });
    var now = new Date();
    var nowMin = ds === E.dstr(now) ? now.getHours() * 60 + now.getMinutes() : null;
    var slots = E.freeSlots(masters, ds, minutes, bookings(), blocks(), SITE, SETTINGS, nowMin).slice(0, 5);
    if (!slots.length) {
      return 'На ' + humanDate(ds) + ' свободных окон нет' + (svc ? ' на «' + svc.title + '»' : '') + '. Могу посмотреть другой день — назовите дату 🙂';
    }
    var html = 'Свободные окна на ' + humanDate(ds) + (svc ? ' («' + esc(svc.title) + '», ' + svc.minutes + ' мин)' : ' (час на процедуру)') + ':\n';
    slots.forEach(function (s) { html += '<span class="lnk" data-eabook="' + (svc ? svc.id : '') + '|' + ds + '|' + s.start + '">🕐 ' + s.startHM + '</span>   '; });
    html += '\nНажмите на время — открою запись с готовой датой.';
    return html;
  }
  function humanDate(ds) { var d = E.pdate(ds); return d.getDate() + ' ' + ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'][d.getMonth()]; }

  /* ---------- локальная база знаний ---------- */
  function priceList(cat) {
    return SERVICES.filter(function (s) { return s.cat === cat && s.active !== false; })
      .map(function (s) { return '• ' + s.title + ' — ' + money(s.price) + ', ' + s.minutes + ' мин'; }).join('\n');
  }
  function localReply(q) {
    q = q.toLowerCase();
    if (/час|график|работ|открыт|закрыв/.test(q)) { outcome = 'kb'; return 'Работаем ' + SITE.hours.toLowerCase() + ', без выходных. Записаться можно онлайн в любое время 🙂'; }
    if (/адрес|где вы|карта|как добраться|метро/.test(q)) { outcome = 'kb'; return 'Адрес: ' + SITE.address + (SITE.metro ? ' (' + SITE.metro + ')' : '') + '. Кнопка «Построить маршрут» — в разделе «Контакты» внизу сайта.'; }
    if (/телефон|позвон|связаться|ватсап|whatsapp/.test(q)) { outcome = 'kb'; return 'Телефон: ' + SITE.phone + ' (WhatsApp по тому же номеру). Почта: ' + SITE.email + '.'; }
    if (/пенс|скидк/.test(q)) { outcome = 'kb'; return DISCOUNT.subtitle + '. ' + DISCOUNT.terms; }
    if (/оплат|предоплат|карт/.test(q)) { outcome = 'kb'; return 'Оплата производится в салоне после услуги. Онлайн-предоплаты нет.'; }
    if (/женск|цен.*жен|прайс.*жен/.test(q)) { outcome = 'kb'; return 'Женские услуги:\n' + priceList('women'); }
    if (/мужск|барбер|мужск.*цен/.test(q)) { outcome = 'kb'; return 'Мужские услуги:\n' + priceList('men'); }
    if (/детск|ребён|ребен/.test(q)) { outcome = 'kb'; return 'Детские услуги:\n' + priceList('kids') + '\nМалышей стрижём в кресле-самолётике, первая стрижка — с дипломом смельчака ✨'; }
    var svc = guessService(q);
    if (svc && /цен|стои|сколько/.test(q)) { outcome = 'kb'; return '«' + svc.title + '» — ' + money(svc.price) + ', длительность ' + svc.minutes + ' мин.' + (DISCOUNT.enabled && svc.pension !== false ? ' Пенсионерам — ' + DISCOUNT.percent + '%.' : ''); }
    if (/мастер|кто стриж|команд/.test(q)) { outcome = 'kb'; return 'Команда: ' + MASTERS.filter(function (m) { return m.active !== false; }).map(function (m) { return m.name + ' (' + m.role.toLowerCase() + ')'; }).join(', ') + '. В записи можно выбрать «любой свободный мастер» — система сама найдёт окно.'; }
    if (/свободн|окн|когда можно|запис.*на|есть место/.test(q)) {
      var r = slotsReply(q);
      if (r) { outcome = 'slots'; return r; }
    }
    if (/запис|записаться|бронь/.test(q)) { outcome = 'kb'; return 'Запись занимает минуту: направление → услуга → мастер → дата → время. Открываю форму…'; }
    return null;
  }

  /* ---------- труба (нейросеть и заявки) ---------- */
  function jsonp(url, params, cb, fail) {
    var cbName = 'ea_cb_' + Math.random().toString(36).slice(2);
    var sc = document.createElement('script'), done = false;
    var timer = setTimeout(function () { cleanup(); fail && fail(); }, 25000);
    function cleanup() { clearTimeout(timer); delete window[cbName]; if (sc.parentNode) sc.parentNode.removeChild(sc); }
    window[cbName] = function (d) { if (done) return; done = true; cleanup(); cb(d); };
    params.callback = cbName;
    sc.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    sc.onerror = function () { if (done) return; done = true; cleanup(); fail && fail(); };
    document.head.appendChild(sc);
  }
  function aiReply(text, cb) {
    if (!PIPE) { cb(null); return; }
    jsonp(PIPE, { action: 'chat', msg: text, hist: JSON.stringify(hist.slice(-6)) },
      function (d) { cb(d && d.ok ? d.reply : null); }, function () { cb(null); });
  }
  function sendLead(name, contact) {
    var full = 'Клиент оставил контакт в чате.\nИмя: ' + name + '\nКонтакт: ' + contact + '\n\nВесь диалог:\n' + transcript();
    if (!PIPE) { addMsg('bot', 'Спасибо! Заявку записала локально — салон свяжется с вами. (Труба ассистента не подключена, поэтому без Telegram-уведомления.)'); return; }
    jsonp(PIPE, { action: 'lead', name: name, contact: contact, message: full, source: 'eclat-assistant', sid: SID },
      function () { addMsg('bot', 'Заявка принята! Салон скоро свяжется с вами 💜'); },
      function () { addMsg('bot', 'Не удалось отправить заявку онлайн. Позвоните нам: ' + SITE.phone + ' — мы обязательно поможем.'); });
  }
  /* весь диалог — в лист «Диалоги»: одна строка на разговор, дообновляется по ходу */
  function logDialog(outcomeNow) {
    if (!PIPE || msgCount < 2) return;
    jsonp(PIPE, { action: 'log', page: 'eclat-assistant', client: leadTaken ? 'lead' : '', bot: transcript(), outcome: outcomeNow, sid: SID }, function () {}, function () {});
  }

  /* ---------- диалог ---------- */
  function send(text) {
    text = (text || '').trim();
    if (!text) return;
    inp.value = '';
    addMsg('user', esc(text));
    hist.push({ role: 'user', text: text });
    msgCount++;
    var local = localReply(text);
    if (/запис|записаться|бронь/.test(text.toLowerCase()) && !/свободн|окн|когда/.test(text.toLowerCase())) {
      window.ECLAT_LOADREMOTE(function () { window.ECLAT_OPENWIZ({ anyMaster: true }); });
      if (local) { addMsg('bot', local); hist.push({ role: 'assistant', text: local.replace(/<[^>]+>/g, '') }); }
      setChips(['Цены женских услуг', 'Свободные окна завтра', 'Часы работы']);
      return;
    }
    if (local) {
      addMsg('bot', local);
      hist.push({ role: 'assistant', text: local.replace(/<[^>]+>/g, '') });
      setChips(['Записаться', 'Цены мужских услуг', 'Пенсионерам', 'Адрес и маршрут']);
      return;
    }
    var phone = text.match(/(\+?\d[\d\s()-]{9,})/);
    if (phone || /перезвон|человек|менеджер|администратор|личн/.test(text.toLowerCase())) {
      leadTaken = true;
      addMsg('bot', 'Передам вас салону! Оставьте, пожалуйста, имя и телефон — администратор свяжется в рабочее время.\nПример: «Анна, +7 931 000-00-00»');
      hist.push({ role: 'assistant', text: 'Оставьте имя и телефон — администратор свяжется.' });
      outcome = 'lead';
      return;
    }
    if (leadTaken && /,|телефон|\+7|8 \d/.test(text)) {
      var parts = text.split(/[,;]+/);
      sendLead(parts[0].trim(), (text.match(/(\+?\d[\d\s()-]{9,})/) || [parts[1] || ''])[0]);
      logDialog('lead');
      return;
    }
    typing(true);
    aiReply(text, function (reply) {
      typing(false);
      if (reply) { outcome = 'ai'; addMsg('bot', esc(reply)); hist.push({ role: 'assistant', text: reply }); }
      else {
        outcome = 'kb';
        addMsg('bot', PIPE
          ? 'Нейросеть сейчас не отвечает — но я знаю цены, часы и свободные окна. Спросите про них или нажмите кнопку ниже 🙂'
          : 'Я помогаю с ценами, часами, адресом и свободными окнами — спросите про них или нажмите кнопку ниже 🙂');
      }
      setChips(['Записаться', 'Свободные окна завтра', 'Цены женских услуг', 'Человека, пожалуйста']);
    });
  }

  /* ---------- события ---------- */
  fab.addEventListener('click', function () {
    var on = panel.classList.toggle('on');
    fab.textContent = on ? '✕' : '💬';
    if (on && !msgs.children.length) {
      addMsg('bot', 'Здравствуйте! Я ассистент ÉCLAT STUDIO 💜\nЗнаю услуги и цены, подскажу свободные окна и запишу за минуту. С чего начнём?');
      setChips(['Записаться', 'Свободные окна завтра', 'Цены женских услуг', 'Часы и адрес']);
      inp.focus();
    }
  });
  panel.querySelector('#ea-send').addEventListener('click', function () { send(inp.value); });
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(inp.value); });
  msgs.addEventListener('click', function (e) {
    var b = e.target.closest('[data-eabook]');
    if (!b) return;
    var p = b.getAttribute('data-eabook').split('|');
    window.ECLAT_LOADREMOTE(function () {
      window.ECLAT_OPENWIZ(p[0] ? { serviceId: p[0], date: p[1], startMin: +p[2] } : { date: p[1], anyMaster: true });
    });
    addMsg('user', 'Выбираю время ' + E.m2hm(+p[2]) + '…');
  });
  window.addEventListener('beforeunload', function () { logDialog(outcome); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) logDialog(outcome); });
})();
