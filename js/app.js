/* =====================================================================
   ÉCLAT STUDIO — клиентская часть: рендер, мастер записи, труба, почта
   ===================================================================== */
(function () {
  'use strict';
  var E = window.ECLAT;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var money = function (n) { return Math.round(n).toLocaleString('ru-RU') + ' ₽'; };
  var LS_B = 'eclat_bookings', LS_K = 'eclat_blocks';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = { bookings: [], blocks: [], loaded: false };
  function lsGet(k, d) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadLocal() { state.bookings = lsGet(LS_B, []); state.blocks = lsGet(LS_K, []); state.loaded = true; }

  /* ---------- JSONP-клиент трубы (Google Apps Script) ---------- */
  function jsonp(url, params, cb, fail, ms) {
    var cbName = 'eclat_cb_' + Math.random().toString(36).slice(2);
    var sc = document.createElement('script');
    var done = false;
    var timer = setTimeout(function () { cleanup(); fail && fail('timeout'); }, ms || 30000);
    function cleanup() { clearTimeout(timer); delete window[cbName]; if (sc.parentNode) sc.parentNode.removeChild(sc); }
    window[cbName] = function (data) { if (done) return; done = true; cleanup(); cb(data); };
    params.cb = cbName;
    var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    sc.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + qs;
    sc.onerror = function () { if (done) return; done = true; cleanup(); fail && fail('network'); };
    document.head.appendChild(sc);
  }

  function loadRemote(cb) {
    if (!SETTINGS.pipeUrl) { loadLocal(); cb && cb(); return; }
    var from = E.dstr(new Date()), to = E.dstr(E.addDays(new Date(), SETTINGS.maxDaysAhead || 60));
    jsonp(SETTINGS.pipeUrl, { action: 'busy', from: from, to: to }, function (d) {
      if (d && d.ok) { state.bookings = d.bookings || []; state.blocks = d.blocks || []; state.loaded = true; }
      else loadLocal();
      cb && cb();
    }, function () { loadLocal(); cb && cb(); });
  }

  /* ---------- рендер статики из site-data.js ---------- */
  function renderAll() {
    $('#hero-name').textContent = SITE.name;
    $('#hero-slogan').textContent = SITE.slogan;
    $('#hero-lead').textContent = SITE.lead || '';
    $('#hero-facts').innerHTML =
      '<div class="rv"><b>3</b><span>зала: женский, мужской, детский</span></div>' +
      '<div class="rv"><b>' + SERVICES.length + '</b><span>услуг в каталоге</span></div>' +
      '<div class="rv"><b>' + esc(SITE.hours.replace('Ежедневно с ', '').replace(' до ', '–')) + '</b><span>без выходных</span></div>';
    var mq = '<span>' + esc(TEXTS.marquee) + '</span>';
    $('#marquee').innerHTML = mq + mq + mq + mq;
    $('#about-title').textContent = TEXTS.aboutTitle;
    $('#about-text').textContent = TEXTS.aboutText;
    $('#about-facts').innerHTML =
      '<div><b>08–22</b><span>каждый день</span></div>' +
      '<div><b>50%</b><span>скидка пенсионерам</span></div>' +
      '<div><b>1 мин</b><span>онлайн-запись</span></div>';
    renderDirs(); renderFilters(); renderServices('all'); renderPension();
    renderMasters(); renderGallery(); renderReviews(); renderContacts();
    $('#year').textContent = new Date().getFullYear();
  }

  var DIRS = [
    { cat: 'women', t: 'WOMEN', h: 'Женский зал', p: 'Стильные стрижки, окрашивание, укладки и уход.', img: 'img/women-hall.jpg' },
    { cat: 'men', t: 'MEN', h: 'Мужской зал', p: 'Современные стрижки, fade, оформление бороды и индивидуальный стиль.', img: 'img/men-hall.jpg' },
    { cat: 'kids', t: 'KIDS', h: 'Детский зал', p: 'Комфортные детские стрижки и дружелюбная атмосфера.', img: 'img/kids-hall.jpg' }
  ];
  function renderDirs() {
    $('#dirs-grid').innerHTML = DIRS.map(function (d) {
      return '<article class="dir rv"><img src="' + d.img + '" alt="' + esc(d.h) + '" loading="lazy">' +
        '<div class="dir__in"><h3><em>' + d.t + '</em>' + esc(d.h) + '</h3><p>' + esc(d.p) + '</p>' +
        '<button class="btn btn--sm" data-dir="' + d.cat + '">Выбрать услугу</button></div></article>';
    }).join('');
  }

  function renderFilters() {
    var f = [{ id: 'all', t: 'Все услуги' }, { id: 'women', t: 'Женские' }, { id: 'men', t: 'Мужские' }, { id: 'kids', t: 'Детские' }];
    $('#svc-filters').innerHTML = f.map(function (x) {
      return '<button data-f="' + x.id + '"' + (x.id === 'all' ? ' class="on"' : '') + '>' + x.t + '</button>';
    }).join('');
  }
  function renderServices(cat) {
    var list = SERVICES.filter(function (s) { return s.active !== false && (cat === 'all' || s.cat === cat); });
    $('#svc-grid').innerHTML = list.map(function (s) {
      /* в каталоге — обычная цена для всех; скидка 50% описана только в пенсионном разделе */
      var p = money(s.price);
      return '<article class="svc-card rv"><div class="svc-card__ph"><img src="' + s.photo + '" alt="' + esc(s.title) + '" loading="lazy">' +
        '<span class="svc-card__time">' + s.minutes + ' мин</span></div>' +
        '<div class="svc-card__in"><h3>' + esc(s.title) + '</h3><p>' + esc(s.desc || '') + '</p>' +
        '<div class="svc-card__row"><span class="price">' + p + '</span>' +
        '<button class="btn btn--sm" data-svc="' + s.id + '">Записаться</button></div></div></article>';
    }).join('');
    observeReveal();
  }

  function renderPension() {
    if (!DISCOUNT.enabled) { $('#pension').style.display = 'none'; return; }
    $('#pension-box').innerHTML =
      '<h2>' + esc(DISCOUNT.title) + '</h2>' +
      '<div class="big neon">' + esc(DISCOUNT.subtitle) + '</div>' +
      '<p>' + esc(DISCOUNT.terms) + '</p>' +
      '<button class="btn" data-pension="1">Выбрать услугу</button>';
  }

  function renderMasters() {
    $('#masters-grid').innerHTML = MASTERS.filter(function (m) { return m.active !== false; }).map(function (m) {
      return '<article class="master rv"><div class="master__ph"><img src="' + m.photo + '" alt="' + esc(m.name) + '" loading="lazy">' +
        (m.demo ? '<span class="demo-badge">ДЕМО-ПРОФИЛЬ</span>' : '') + '</div>' +
        '<div class="master__in"><h3>' + esc(m.name) + '</h3><div class="role">' + esc(m.role) + '</div>' +
        '<p>' + esc(m.desc || '') + '</p><button class="btn btn--sm" data-master="' + m.id + '">Записаться</button></div></article>';
    }).join('');
  }

  function renderGallery() {
    $('#gal').innerHTML = GALLERY.map(function (g, i) {
      return '<figure class="rv" data-lb="' + i + '"><img src="' + g.src + '" alt="' + esc(g.caption) + '" loading="lazy"><figcaption>' + esc(g.caption) + '</figcaption></figure>';
    }).join('');
  }

  function renderReviews() {
    if (!REVIEWS || !REVIEWS.length) {
      $('#reviews-box').innerHTML = '<div class="reviews-empty"><b>Отзывов пока нет</b>' + esc(TEXTS.reviewsNote) + '</div>';
      return;
    }
    $('#reviews-box').innerHTML = REVIEWS.map(function (r) {
      return '<div class="reviews-empty" style="border-style:solid;text-align:left;margin-bottom:12px"><b>' + esc(r.name) + '</b>' + esc(r.text) + '</div>';
    }).join('');
  }

  function renderContacts() {
    var soc = (SITE.socials || []).map(function (s) {
      return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>';
    }).join(' · ');
    $('#c-card').innerHTML =
      crow('📍', 'Адрес', esc(SITE.address) + (SITE.metro ? '<br><span class="muted small">' + esc(SITE.metro) + '</span>' : '') +
        '<br><a class="btn btn--sm btn--ghost" style="margin-top:10px" href="https://yandex.ru/maps/?text=' + encodeURIComponent(SITE.address) + '" target="_blank" rel="noopener">Построить маршрут</a>') +
      crow('📞', 'Телефон', '<a href="tel:' + esc(SITE.phoneRaw) + '">' + esc(SITE.phone) + '</a> · <a href="https://wa.me/' + esc(SITE.whatsapp) + '" target="_blank" rel="noopener">WhatsApp</a>') +
      crow('✉️', 'Почта', '<a href="mailto:' + esc(SITE.email) + '">' + esc(SITE.email) + '</a>') +
      crow('🕗', 'График', esc(SITE.hours)) +
      (soc ? crow('💬', 'Мы в соцсетях', soc) : '');
    $('#map-box').innerHTML = '<iframe src="' + esc(SITE.mapSrc) + '" loading="lazy" title="Карта: ' + esc(SITE.address) + '"></iframe>';
  }
  function crow(ico, b, html) {
    return '<div class="c-row"><div class="ico">' + ico + '</div><div><b>' + b + '</b>' + html + '</div></div>';
  }

  /* ---------- появление секций и параллакс ---------- */
  var io = null;
  function observeReveal() {
    if (reduceMotion) { $$('.rv').forEach(function (n) { n.classList.add('in'); }); return; }
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    $$('.rv:not(.in)').forEach(function (n) { io.observe(n); });
  }
  window.addEventListener('scroll', function () {
    $('#top-header').classList.toggle('scrolled', window.scrollY > 30);
    if (!reduceMotion) {
      var img = $('#hero-bg img');
      if (img && window.scrollY < window.innerHeight) img.style.transform = 'scale(1.06) translateY(' + (window.scrollY * 0.12) + 'px)';
    }
  }, { passive: true });

  /* =================================================================
     МАСТЕР ЗАПИСИ
     ================================================================= */
  var W = null;
  var STEPS = ['Направление', 'Услуга', 'Мастер', 'Дата', 'Время', 'Данные', 'Проверка', 'Готово'];

  function openWiz(opts) {
    opts = opts || {};
    W = { step: 1, cat: opts.cat || null, serviceId: opts.serviceId || null, masterId: opts.masterId || null,
      anyMaster: !!opts.anyMaster, date: null, startMin: null, endHM: null, slotMaster: null,
      name: '', phone: '', comment: '', pension: !!opts.pension, consent: false, month: new Date() };
    if (W.serviceId) { var s = svcById(W.serviceId); if (s) W.cat = s.cat; }
    if (opts.date) W.date = opts.date;
    if (opts.startMin != null && curService() && W.date) {
      var ms0 = E.eligibleMasters(curService(), MASTERS, W.date, SITE);
      for (var mi = 0; mi < ms0.length; mi++) {
        if (E.rangeFree(ms0[mi], W.date, opts.startMin, opts.startMin + curService().minutes, state.bookings, state.blocks, SITE, SETTINGS)) {
          W.masterId = ms0[mi].id; break;
        }
      }
      W.anyMaster = false;
      W.startMin = opts.startMin;
      W.endHM = E.m2hm(W.startMin + curService().minutes);
      W.step = 6;
    }
    /* Telegram Mini App: имя клиента подставляется из его профиля Telegram */
    if (TG && TG.initDataUnsafe && TG.initDataUnsafe.user && !W.name) {
      var u = TG.initDataUnsafe.user;
      W.name = (u.first_name || '') + (u.last_name ? ' ' + u.last_name : '');
    }
    if (TG) TG.MainButton.hide();
    $('#wiz').classList.add('on');
    document.body.style.overflow = 'hidden';
    drawWiz();
  }
  function closeWiz() { $('#wiz').classList.remove('on'); document.body.style.overflow = ''; if (TG) TG.MainButton.show(); }
  function svcById(id) { return SERVICES.filter(function (s) { return s.id === id; })[0]; }
  function masterById(id) { return MASTERS.filter(function (m) { return m.id === id; })[0]; }
  function curService() { return W.serviceId ? svcById(W.serviceId) : null; }
  function dateMin() { return E.dstr(new Date()); }
  function dateMax() { return E.dstr(E.addDays(new Date(), SETTINGS.maxDaysAhead || 60)); }

  function drawSteps() {
    $('#wiz-steps').innerHTML = STEPS.map(function (_, i) { return '<i class="' + (i < W.step ? 'on' : '') + '"></i>'; }).join('');
    $('#wiz-title').textContent = W.step === 8 ? 'Запись создана' : 'Запись: шаг ' + W.step + ' из 7 — ' + STEPS[W.step - 1];
    $('#wiz-back').style.visibility = (W.step > 1 && W.step < 8) ? 'visible' : 'hidden';
    $('#wiz-next').style.display = W.step < 7 ? '' : 'none';
    if (W.step === 7) { $('#wiz-next').style.display = ''; $('#wiz-next').textContent = 'Подтвердить запись'; }
    else $('#wiz-next').textContent = 'Далее';
  }

  function drawWiz() {
    drawSteps();
    var b = $('#wiz-body');
    if (W.step === 1) {
      b.innerHTML = '<h4>Выберите направление</h4><div class="chips">' + DIRS.map(function (d) {
        return '<button class="chip' + (W.cat === d.cat ? ' on' : '') + '" data-w="dir" data-v="' + d.cat + '"><b>' + d.h + '</b><span>' + esc(d.p) + '</span></button>';
      }).join('') + '</div>';
    }
    if (W.step === 2) {
      var list = SERVICES.filter(function (s) { return s.active !== false && s.cat === W.cat; });
      if (W.masterId) list = list.filter(function (s) { return !s.masters || !s.masters.length || s.masters.indexOf(W.masterId) >= 0; });
      b.innerHTML = '<h4>Выберите услугу</h4><p class="hint">Цена и продолжительность учитываются при подборе времени.</p><div class="optlist">' +
        list.map(function (s) {
          return '<button class="chip' + (W.serviceId === s.id ? ' on' : '') + '" data-w="svc" data-v="' + s.id + '">' +
            '<img src="' + s.photo + '" alt=""><span style="flex:1"><b>' + esc(s.title) + '</b><span>' + s.minutes + ' мин · ' + esc(dirName(s.cat)) + '</span></span>' +
            '<span class="price">' + money(s.price) + '</span></button>';
        }).join('') + '</div>';
    }
    if (W.step === 3) {
      var s = curService();
      var ms = E.eligibleMasters(s, MASTERS, null, SITE);
      b.innerHTML = '<h4>Выберите мастера</h4><div class="optlist">' +
        '<button class="chip' + (W.anyMaster ? ' on' : '') + '" data-w="master" data-v="any"><span style="flex:1"><b>Любой свободный мастер</b><span>Система найдёт ближайший свободный интервал у подходящего специалиста</span></span></button>' +
        ms.map(function (m) {
          return '<button class="chip' + (!W.anyMaster && W.masterId === m.id ? ' on' : '') + '" data-w="master" data-v="' + m.id + '">' +
            '<img src="' + m.photo + '" alt=""><span style="flex:1"><b>' + esc(m.name) + '</b><span>' + esc(m.role) + (m.demo ? ' · демо' : '') + '</span></span></button>';
        }).join('') + '</div>';
    }
    if (W.step === 4) drawCalendar(b);
    if (W.step === 5) drawSlots(b);
    if (W.step === 6) {
      b.innerHTML = '<h4>Ваши данные</h4>' +
        '<div class="fld"><label for="f-name">Имя *</label><input id="f-name" maxlength="60" value="' + esc(W.name) + '" placeholder="Как к вам обращаться"></div>' +
        '<div class="fld"><label for="f-phone">Телефон * <span class="small muted" style="font-weight:400">— введите 10 цифр, +7 подставится само</span></label><input id="f-phone" type="tel" inputmode="tel" maxlength="18" value="' + esc(W.phone) + '" placeholder="931 357-96-00"></div>' +
        '<div class="fld"><label for="f-comment">Комментарий (необязательно)</label><textarea id="f-comment" rows="2" placeholder="Пожелания, длина волос, детское кресло…">' + esc(W.comment) + '</textarea></div>' +
        (DISCOUNT.enabled ? '<label class="check" style="margin-bottom:12px"><input type="checkbox" id="f-pension"' + (W.pension ? ' checked' : '') + '><span>Я пенсионер — применить скидку ' + DISCOUNT.percent + '%<br><span class="small muted">' + esc(DISCOUNT.terms) + '</span></span></label>' : '') +
        '<label class="check"><input type="checkbox" id="f-consent"' + (W.consent ? ' checked' : '') + '><span>' + esc(TEXTS.consent) + ' *</span></label>' +
        '<div id="wiz-err"></div>';
    }
    if (W.step === 7) drawSummary(b);
    if (W.step === 8) { /* рисуется после подтверждения */ }
    bindWizBody();
  }
  function dirName(c) { return c === 'women' ? 'женский зал' : c === 'men' ? 'мужской зал' : 'детский зал'; }

  function drawCalendar(b) {
    var m = W.month, y = m.getFullYear(), mo = m.getMonth();
    var first = new Date(y, mo, 1), startDow = (first.getDay() + 6) % 7;
    var days = new Date(y, mo + 1, 0).getDate();
    var s = curService();
    var masters = W.anyMaster || !W.masterId ? E.eligibleMasters(s, MASTERS, null, SITE) : [masterById(W.masterId)];
    var html = '<h4>Выберите дату</h4><div class="cal"><div class="nav-m" style="grid-column:1/-1">' +
      '<button data-w="mon" data-v="-1">←</button><b>' + monthName(mo) + ' ' + y + '</b><button data-w="mon" data-v="1">→</button></div>';
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(function (d) { html += '<div class="dow">' + d + '</div>'; });
    for (var i = 0; i < startDow; i++) html += '<span></span>';
    var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    for (var d = 1; d <= days; d++) {
      var ds = E.dstr(new Date(y, mo, d));
      var ok = ds >= dateMin() && ds <= dateMax();
      var has = ok && masters.some(function (mm) { return E.masterDay(mm, ds, SITE); });
      if (has && ds === dateMin()) {
        has = E.freeSlots(masters, ds, s.minutes, state.bookings, state.blocks, SITE, SETTINGS, nowMin).length > 0;
      } else if (has) {
        has = E.freeSlots(masters, ds, s.minutes, state.bookings, state.blocks, SITE, SETTINGS, null).length > 0;
      }
      html += '<button data-w="date" data-v="' + ds + '"' + (has ? '' : ' disabled') + (W.date === ds ? ' class="on"' : '') + '>' + d + '</button>';
    }
    html += '</div><p class="hint" style="margin-top:12px">Серым отмечены дни без свободных окон: выходных мастеров, перерывы и занятые окна учтены.</p>';
    b.innerHTML = html;
  }
  function monthName(m) { return ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][m]; }
  function dateRu(ds) { var d = E.pdate(ds); return d.getDate() + ' ' + monthName(d.getMonth()) + ' ' + d.getFullYear(); }

  function drawSlots(b) {
    var s = curService();
    var masters = W.anyMaster || !W.masterId ? E.eligibleMasters(s, MASTERS, W.date, SITE) : [masterById(W.masterId)];
    var now = new Date();
    var nowMin = W.date === E.dstr(now) ? now.getHours() * 60 + now.getMinutes() : null;
    var slots = E.freeSlots(masters, W.date, s.minutes, state.bookings, state.blocks, SITE, SETTINGS, nowMin);
    b.innerHTML = '<h4>Свободное время — ' + dateRu(W.date) + '</h4>' +
      (slots.length ? '<div class="slots">' + slots.map(function (sl) {
        return '<button data-w="slot" data-v="' + sl.start + '" data-m="' + sl.masterId + '" class="' + (W.startMin === sl.start ? 'on' : '') + '" style="animation-delay:' + Math.min(sl.start / 60, 40) * 12 + 'ms">' + sl.startHM + '</button>';
      }).join('') + '</div><p class="hint" style="margin-top:12px">Услуга длится ' + s.minutes + ' мин. Последняя запись заканчивается до закрытия салона (' + SITE.close + ').</p>'
        : '<div class="errbox">На эту дату свободных окон не осталось. Выберите другую дату.</div>');
  }

  function drawSummary(b) {
    var s = curService(), m = masterById(W.masterId);
    var pr = E.calcPrice(s, { pension: W.pension }, DISCOUNT);
    b.innerHTML = '<h4>Проверьте детали записи</h4><div class="sum">' +
      row('Услуга', esc(s.title)) + row('Мастер', esc(m ? m.name : '—')) + row('Дата', dateRu(W.date)) +
      row('Время', E.m2hm(W.startMin) + '–' + W.endHM + ' (' + s.minutes + ' мин)') +
      (pr.applied ? row('Скидка пенсионера', '−' + pr.percent + '% (' + money(pr.base) + ')') : '') +
      '<div class="r total"><b>Итого</b><span class="price">' + money(pr.final) + '</span></div>' +
      '<div class="r"><b></b><span class="small muted">' + esc(TEXTS.payNote) + '</span></div></div>' +
      '<div id="wiz-err"></div>';
    function row(k, v) { return '<div class="r"><b>' + k + '</b><span>' + v + '</span></div>'; }
  }

  function bindWizBody() {
    $$('#wiz-body [data-w]').forEach(function (n) {
      n.addEventListener('click', function () {
        var v = n.getAttribute('data-v');
        var w = n.getAttribute('data-w');
        if (w === 'dir') { W.cat = v; W.serviceId = null; drawWiz(); return; }
        if (w === 'svc') { W.serviceId = v; drawWiz(); return; }
        if (w === 'master') { W.anyMaster = v === 'any'; W.masterId = v === 'any' ? null : v; drawWiz(); return; }
        if (w === 'mon') { W.month = new Date(W.month.getFullYear(), W.month.getMonth() + (+v), 1); drawWiz(); return; }
        if (w === 'date') { W.date = v; W.startMin = null; W.step = 5; drawWiz(); return; }
        if (w === 'slot') {
          W.startMin = +v;
          if (W.anyMaster || !W.masterId) W.masterId = n.getAttribute('data-m');
          var s = curService(); W.endHM = E.m2hm(W.startMin + s.minutes);
          W.step = 6; drawWiz(); return;
        }
      });
    });
    var bind = function (id, prop) { var n = $(id); if (n) n.addEventListener('input', function () { W[prop] = n.type === 'checkbox' ? n.checked : n.value; }); };
    bind('#f-name', 'name'); bind('#f-comment', 'comment'); bind('#f-pension', 'pension'); bind('#f-consent', 'consent');
    var ph = $('#f-phone');
    if (ph) {
      ph.addEventListener('focus', function () { if (!ph.value) { ph.value = '+7 '; W.phone = '+7 '; } });
      ph.addEventListener('input', function () { W.phone = E.formatRuPhone(ph.value); ph.value = W.phone; });
      ph.addEventListener('blur', function () { if (ph.value.replace(/\D/g, '') === '7') { ph.value = ''; W.phone = ''; } });
    }
  }

  function wizNext() {
    if (W.step === 1 && !W.cat) return toastWiz('Выберите направление.');
    if (W.step === 2 && !W.serviceId) return toastWiz('Выберите услугу.');
    if (W.step === 3 && !W.masterId && !W.anyMaster) return toastWiz('Выберите мастера или «любой свободный».');
    if (W.step === 4 && !W.date) return toastWiz('Выберите дату.');
    if (W.step === 5 && W.startMin == null) return toastWiz('Выберите время.');
    if (W.step === 6) {
      var v = E.validateBooking(payload(), DATA_ALL(), state.bookings, state.blocks, new Date());
      var nameOk = W.name.trim().length >= 2, phoneOk = W.phone.replace(/\D/g, '').length >= 10;
      if (!nameOk || !phoneOk || !W.consent) {
        return toastWiz(!nameOk ? 'Укажите имя.' : !phoneOk ? 'Укажите корректный телефон.' : 'Нужно согласие на обработку данных.');
      }
      W.step = 7; drawWiz(); return;
    }
    if (W.step === 7) { submit(); return; }
    W.step++; drawWiz();
  }
  function toastWiz(msg) {
    var e = $('#wiz-err');
    if (!e) { $('#wiz-body').insertAdjacentHTML('beforeend', '<div id="wiz-err"></div>'); e = $('#wiz-err'); }
    e.className = 'errbox'; e.style.marginTop = '14px'; e.textContent = msg;
  }
  function payload() {
    var s = curService();
    return { serviceId: W.serviceId, masterId: W.masterId, date: W.date, startMin: W.startMin,
      name: W.name.trim(), phone: W.phone.trim(), comment: W.comment.trim(), pension: !!W.pension, consent: !!W.consent, minutes: s ? s.minutes : 0 };
  }
  function DATA_ALL() { return { SITE: SITE, SETTINGS: SETTINGS, DISCOUNT: DISCOUNT, MASTERS: MASTERS, SERVICES: SERVICES }; }

  /* ---------- подтверждение: труба или локальный демо-режим ---------- */
  function submit() {
    var p = payload();
    W._p = p;
    var btn = $('#wiz-next'); btn.disabled = true; btn.textContent = 'Сохраняем…';
    if (SETTINGS.pipeUrl) {
      /* Google изредка отбивает запросы, пришедшие пачкой (чат в этот момент
         тоже общается с трубой). Поэтому прежде чем падать в локальный
         запасной путь, пробуем ещё дважды с паузами. */
      var attempt = 0;
      var tryBook = function () {
        jsonp(SETTINGS.pipeUrl, { action: 'book', data: JSON.stringify(p) }, function (d) {
          if (d && d.ok) { absorbPipe(d.booking, p); finish(d.id, 'pipe', '', ''); }
          else conflict(d && (d.reason === 'conflict' || d.ru) ? (d.ru || 'Это время только что заняли. Выберите другой интервал.') : (d && d.error));
        }, function () {
          attempt++;
          if (attempt === 1) { setTimeout(tryBook, 2500); return; }
          if (attempt === 2) { setTimeout(tryBook, 9000); return; }
          /* труба недоступна: запасной путь — локально + резервное письмо */
          localSave(p, 'Сервер записи недоступен — заявка сохранена локально и продублирована резервным письмом.');
        }, 45000);
      };
      tryBook();
    } else {
      setTimeout(function () { localSave(p, ''); }, 350);
    }
  }
  function localSave(p, note) {
    var v = E.validateBooking(p, DATA_ALL(), state.bookings, state.blocks, new Date());
    if (!v.ok) { conflict(v.errors[0]); return; }
    var id = genId();
    state.bookings.push({ id: id, masterId: p.masterId, date: p.date, startMin: p.startMin, endMin: p.startMin + p.minutes,
      status: 'confirmed', name: p.name, phone: p.phone, comment: p.comment,
      priceBase: v.price.base, priceFinal: v.price.final, discountPercent: v.price.percent,
      source: 'site', created: new Date().toISOString() });
    lsSet(LS_B, state.bookings);
    /* экран успеха показываем СРАЗУ; письмо долетает фоном и обновляет строчку */
    finish(id, 'pending', '', note);
    mailOwner(p, id, v.price, function (ok, msg) { setMailLine(ok, msg); });
  }
  /* сервер принял запись — забираем её себе в состояние, чтобы мастер записи
     сразу увидел занятое окно (и не предложил то же время следующему клиенту) */
  function absorbPipe(b, p) {
    if (!b) return;
    state.bookings = state.bookings.filter(function (x) { return x.id !== b.id; });
    state.bookings.push({
      id: b.id, masterId: b.masterId || (p && p.masterId), serviceId: b.serviceId || (p && p.serviceId),
      date: b.date, startMin: b.startMin, endMin: b.endMin != null ? b.endMin : b.startMin + ((p && p.minutes) || 0),
      status: b.status || 'confirmed', name: b.name, phone: b.phone, comment: b.comment || '',
      priceBase: b.priceBase != null ? b.priceBase : b.price, priceFinal: b.price, discountPercent: b.discountPercent || 0,
      source: b.source || 'site', created: b.created || new Date().toISOString()
    });
    state.loaded = true;
    lsSet(LS_B, state.bookings);
  }
  function conflict(msg) {
    var btn = $('#wiz-next'); btn.disabled = false; btn.textContent = 'Подтвердить запись';
    toastWiz(msg || 'Не удалось сохранить запись. Попробуйте ещё раз.');
    if (msg && /занят|conflict|прошл/i.test(msg)) { W.step = 5; W.startMin = null; loadRemote(function () { drawWiz(); }); }
  }
  function finish(id, mailState, mailMsg, note) {
    var s = curService(), m = masterById(W.masterId), pr = E.calcPrice(s, { pension: W.pension }, DISCOUNT);
    W._id = id; W._pr = pr;
    W.step = 8; drawSteps();
    var noteLine = note ? '<br><span class="small" style="color:var(--blue)">' + esc(note) + '</span>' : '';
    var mailLine;
    if (mailState === 'pipe') mailLine = '<br><span class="small">Салон получил заявку: она в базе записей и письме у администратора.</span>';
    else if (mailState === 'ok') mailLine = '<br><span class="small">Заявка отправлена на почту салона: ' + esc(SITE.email) + '.</span>';
    else if (mailState === 'fail') mailLine = failMailLine(mailMsg) + copyBtnHtml();
    else mailLine = '<br><span class="small" id="wiz-mail-line">Запись сохранена. Отправляем письмо салону…</span>';
    $('#wiz-body').innerHTML = '<div class="done"><div class="ok"><svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg></div>' +
      '<h4 style="font-size:24px">Вы записаны!</h4>' +
      '<div class="num">Номер записи: ' + esc(id) + '</div>' +
      '<p class="small muted" style="margin:-6px 0 10px">Номер короткий — его легко запомнить и назвать в салоне.</p>' +
      '<p class="muted">' + esc(s.title) + ' · ' + esc(m.name) + ' · ' + dateRu(W.date) + ' · ' + E.m2hm(W.startMin) + '–' + W.endHM + '<br>' +
      'Итого: <b style="color:var(--milk)">' + money(pr.final) + '</b>. ' + esc(TEXTS.payNote) + '.' + noteLine + mailLine +
      '</p><button class="btn" id="wiz-done">Отлично</button></div>';
    bindCopy();
    $('#wiz-done').addEventListener('click', closeWiz);
    $('#wiz-next').disabled = false;
    if (TG && TG.HapticFeedback) TG.HapticFeedback.notificationOccurred('success');
  }
  function failMailLine(msg) {
    return '<br><span class="small">Письмо не ушло' + (msg ? ' (' + esc(msg) + ')' : '') +
      '. Запись сохранена — позвоните нам: ' + esc(SITE.phone) + '.</span>';
  }
  function copyBtnHtml() { return '<br><button class="btn btn--ghost btn--sm" style="margin-top:10px" id="wiz-copy">Скопировать текст заявки</button>'; }
  function bindCopy() {
    var cp = $('#wiz-copy');
    if (!cp) return;
    cp.addEventListener('click', function () {
      copyText(buildMailBody(W._p || payload(), W._id, W._pr), function (ok) {
        cp.textContent = ok ? 'Скопировано — пришлите нам в любой мессенджер' : 'Не удалось скопировать — позвоните нам';
        cp.disabled = ok;
      });
    });
  }
  function setMailLine(ok, msg) {
    var el = document.getElementById('wiz-mail-line');
    if (!el) return;
    if (ok) el.outerHTML = '<span class="small">Заявка отправлена на почту салона: ' + esc(SITE.email) + '.</span>';
    else { el.outerHTML = failMailLine(msg) + copyBtnHtml(); bindCopy(); }
  }
  /* короткий номер записи: ECL-001, ECL-002… — легко запомнить и продиктовать */
  function genId() {
    var max = 0;
    state.bookings.forEach(function (b) { var m = /ECL-(\d+)$/.exec(b.id || ''); if (m) max = Math.max(max, +m[1]); });
    var n = String(max + 1); while (n.length < 3) n = '0' + n;
    return 'ECL-' + n;
  }
  /* письмо владельцу через FormSubmit; cb(true/false) — дошло или нет */
  function mailOwner(p, id, price, cb) {
    var s = curService(), m = masterById(W.masterId);
    var body = {
      _subject: 'Запись ' + id + ' — ' + SITE.name,
      _template: 'table', _captcha: 'false',
      'Номер записи': id, 'Имя': p.name, 'Телефон': p.phone,
      'Услуга': s.title, 'Мастер': m ? m.name : '', 'Дата': dateRu(p.date),
      'Время': E.m2hm(p.startMin) + '–' + E.m2hm(p.startMin + p.minutes),
      'Стоимость': price.final + ' руб.' + (price.applied ? ' (скидка ' + price.percent + '%)' : ''),
      'Комментарий': p.comment || '—'
    };
    var done = false, ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctl) ctl.abort();
      if (!done) { done = true; cb && cb(false, 'почтовый сервис не ответил за 20 секунд'); }
    }, 20000);
    fetch('https://formsubmit.co/ajax/' + encodeURIComponent(SITE.email), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined
    }).then(function (r) { clearTimeout(timer); return r.json(); })
      .then(function (j) {
        if (done) return; done = true;
        var ok = !!(j && (j.success === 'true' || j.success === true));
        if (!ok) console.warn('FormSubmit ответил:', j);
        cb && cb(ok, (j && j.message) || (ok ? '' : 'ответ без статуса'));
      })
      .catch(function (e) {
        clearTimeout(timer);
        if (done) return; done = true;
        console.warn('FormSubmit недоступен:', e); cb && cb(false, 'сервис недоступен из сети');
      });
  }
  function buildMailBody(p, id, pr) {
    var s = curService(), m = masterById(W.masterId);
    return 'Запись ' + id + ' — ' + SITE.name +
      '\nИмя: ' + p.name + '\nТелефон: ' + p.phone +
      '\nУслуга: ' + s.title + '\nМастер: ' + (m ? m.name : '') +
      '\nДата: ' + dateRu(p.date) + '\nВремя: ' + E.m2hm(p.startMin) + '–' + E.m2hm(p.startMin + p.minutes) +
      '\nСтоимость: ' + pr.final + ' руб.' + (p.comment ? '\nКомментарий: ' + p.comment : '');
  }
  function copyText(t, cb) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { cb(true); }, function () { cb(fallbackCopy(t)); });
    } else cb(fallbackCopy(t));
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove(); return ok;
  }

  /* ---------- события страницы ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-book],[data-dir],[data-svc],[data-master],[data-pension],[data-f],[data-lb]');
    if (!t) return;
    if (t.hasAttribute('data-book')) { e.preventDefault(); closeMenu(); loadRemote(function () { openWiz({}); }); return; }
    if (t.hasAttribute('data-dir')) { loadRemote(function () { openWiz({ cat: t.getAttribute('data-dir'), anyMaster: true }); }); return; }
    if (t.hasAttribute('data-svc')) { var sid = t.getAttribute('data-svc'); loadRemote(function () { openWiz({ serviceId: sid, anyMaster: true }); }); return; }
    if (t.hasAttribute('data-master')) { var mid = t.getAttribute('data-master'); loadRemote(function () { openWiz({ masterId: mid }); }); return; }
    if (t.hasAttribute('data-pension')) { loadRemote(function () { openWiz({ pension: true, anyMaster: true }); }); return; }
    if (t.hasAttribute('data-f')) {
      $$('#svc-filters button').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on'); renderServices(t.getAttribute('data-f')); return;
    }
    if (t.hasAttribute('data-lb')) {
      var g = GALLERY[+t.getAttribute('data-lb')];
      $('#lb-img').src = g.src; $('#lb-cap').textContent = g.caption; $('#lightbox').classList.add('on'); return;
    }
  });
  $('#wiz-next').addEventListener('click', wizNext);
  $('#wiz-back').addEventListener('click', function () { if (W.step > 1) { W.step--; drawWiz(); } });
  $('#wiz-close').addEventListener('click', closeWiz);
  $('#lb-close').addEventListener('click', function () { $('#lightbox').classList.remove('on'); });
  $('#lightbox').addEventListener('click', function (e) { if (e.target.id === 'lightbox') $('#lightbox').classList.remove('on'); });
  $('#burger').addEventListener('click', function () { $('#mmenu').classList.add('on'); });
  $('#mmenu-close').addEventListener('click', closeMenu);
  $$('#mmenu a').forEach(function (a) { a.addEventListener('click', closeMenu); });
  function closeMenu() { $('#mmenu').classList.remove('on'); }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeWiz(); closeMenu(); $('#lightbox').classList.remove('on'); }
  });

  /* ---------- Telegram Mini App ----------
     Скрипт Телеграма теперь грузится ПОСЛЕДНИМ и не имеет права тормозить сайт.
     Поэтому мини-апп включаем лениво: сразу, если скрипт уже есть,
     и ещё раз по событию load, когда он доедет. */
  var TG = null;
  function initTG() {
    var T = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData) ? window.Telegram.WebApp : null;
    if (!T || TG) return;
    TG = T;
    TG.ready(); TG.expand();
    document.body.classList.add('tg');
    TG.MainButton.setText('Записаться онлайн');
    TG.MainButton.show();
    TG.MainButton.onClick(function () { loadRemote(function () { openWiz({}); }); });
  }
  initTG();
  window.addEventListener('load', initTG);

  /* доступ ассистенту к занятым окнам (живой календарь) */
  window.ECLAT_BOOKINGS = function () { return state.bookings; };
  window.ECLAT_BLOCKS = function () { return state.blocks; };
  window.ECLAT_OPENWIZ = openWiz;
  window.ECLAT_LOADREMOTE = loadRemote;

  renderAll();
  observeReveal();
  loadRemote();
})();
