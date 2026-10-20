/* =====================================================================
   ÉCLAT STUDIO — движок расписания (чистая логика, без DOM)
   Используется сайтом (js/app.js), админкой (js/admin.js) и тестами.
   ===================================================================== */
(function (root) {
  'use strict';

  function hm2m(s) { var p = String(s).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function m2hm(m) {
    m = Math.max(0, Math.round(m));
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function dstr(d) {
    var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function pdate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function overlap(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

  /* ---------- график мастера в конкретный день ---------- */
  function masterDay(master, dateS, SITE) {
    if (!master || master.active === false) return null;
    var d = pdate(dateS);
    var sch = master.schedule || {};
    var days = sch.days || [0, 1, 2, 3, 4, 5, 6];
    if (days.indexOf(d.getDay()) < 0) return null;
    var vac = master.vacation || [];
    for (var i = 0; i < vac.length; i++) {
      var v = vac[i];
      if (v === dateS || (v.from && v.to && dateS >= v.from && dateS <= v.to)) return null;
    }
    var open = Math.max(hm2m(SITE.open || '08:00'), hm2m(sch.start || SITE.open || '08:00'));
    var close = Math.min(hm2m(SITE.close || '22:00'), hm2m(sch.end || SITE.close || '22:00'));
    if (close <= open) return null;
    return { open: open, close: close, breaks: (sch.breaks || []).map(function (b) { return { s: hm2m(b.start), e: hm2m(b.end) }; }) };
  }

  function activeBookings(bookings) {
    return (bookings || []).filter(function (b) { return b.status !== 'cancelled'; });
  }

  /* ---------- занятые интервалы мастера на дату (записи + блоки) ---------- */
  function busyIntervals(masterId, dateS, bookings, blocks) {
    var out = [];
    activeBookings(bookings).forEach(function (b) {
      if (b.masterId === masterId && b.date === dateS) out.push({ s: b.startMin, e: b.endMin, kind: 'book' });
    });
    (blocks || []).forEach(function (bl) {
      if ((bl.masterId === masterId || bl.masterId === 'all') && bl.date === dateS) out.push({ s: bl.startMin, e: bl.endMin, kind: 'block' });
    });
    return out.sort(function (a, b) { return a.s - b.s; });
  }

  /* ---------- свободен ли интервал у мастера ---------- */
  function rangeFree(master, dateS, s, e, bookings, blocks, SITE, SETTINGS) {
    var day = masterDay(master, dateS, SITE);
    if (!day) return false;
    if (s < day.open || e > day.close) return false;
    var buf = (SETTINGS && SETTINGS.bufferMin) || 0;
    var busy = busyIntervals(master.id, dateS, bookings, blocks);
    for (var i = 0; i < busy.length; i++) {
      var b = busy[i];
      var bs = b.kind === 'book' ? b.s - buf : b.s;
      var be = b.kind === 'book' ? b.e + buf : b.e;
      if (overlap(s, e, bs, be)) return false;
    }
    for (var j = 0; j < day.breaks.length; j++) {
      if (overlap(s, e, day.breaks[j].s, day.breaks[j].e)) return false;
    }
    return true;
  }

  /* ---------- сетка свободных слотов для списка мастеров на дату ---------- */
  function freeSlots(masters, dateS, minutes, bookings, blocks, SITE, SETTINGS, nowMin) {
    var step = (SETTINGS && SETTINGS.slotStep) || 15;
    var open = hm2m(SITE.open || '08:00'), close = hm2m(SITE.close || '22:00');
    var from = open;
    if (nowMin != null) from = Math.max(from, Math.ceil(nowMin / step) * step);
    var out = [];
    for (var t = from; t + minutes <= close; t += step) {
      for (var i = 0; i < masters.length; i++) {
        var m = masters[i];
        if (rangeFree(m, dateS, t, t + minutes, bookings, blocks, SITE, SETTINGS)) {
          out.push({ start: t, startHM: m2hm(t), endHM: m2hm(t + minutes), masterId: m.id });
          break; /* слот доступен: достаточно одного подходящего мастера */
        }
      }
    }
    return out;
  }

  /* ---------- мастера, которые выполняют услугу и работают в этот день ---------- */
  function eligibleMasters(service, masters, dateS, SITE) {
    return (masters || []).filter(function (m) {
      if (m.active === false) return false;
      if (service && (service.masters || []).length && service.masters.indexOf(m.id) < 0) return false;
      if (dateS && !masterDay(m, dateS, SITE)) return false;
      return true;
    });
  }

  /* ---------- телефон: +7 ставится автоматически, клиент вводит 10 цифр ---------- */
  function formatRuPhone(raw) {
    var d = String(raw == null ? '' : raw).replace(/\D/g, '');
    if (d.charAt(0) === '8') d = '7' + d.slice(1);
    if (d.charAt(0) === '7') d = d.slice(1);
    d = d.slice(0, 10);
    var out = '+7';
    if (d.length) out += ' ' + d.slice(0, 3);
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }
  function phoneOk(p) {
    var d = String(p || '').replace(/\D/g, '');
    return d.length === 11 && d.charAt(0) === '7';
  }

  /* ---------- цена с учётом пенсионной скидки ---------- */
  function calcPrice(service, opts, DISCOUNT) {
    var price = service.price || 0;
    var want = !!(opts && opts.pension);
    var applies = want && DISCOUNT && DISCOUNT.enabled && service.pension !== false;
    if (!applies) return { base: price, percent: 0, final: price, applied: false };
    var percent = DISCOUNT.percent || 0;
    var final = Math.round(price * (100 - percent) / 100);
    return { base: price, percent: percent, final: final, applied: true };
  }

  /* ---------- полная проверка заявки (та же логика дублируется на сервере) ---------- */
  function validateBooking(p, DATA, bookings, blocks, nowDate) {
    var errors = [];
    var SITE = DATA.SITE, SETTINGS = DATA.SETTINGS, DISCOUNT = DATA.DISCOUNT;
    var service = (DATA.SERVICES || []).filter(function (s) { return s.id === p.serviceId; })[0];
    if (!service) errors.push('Услуга не найдена.');
    else if (service.active === false) errors.push('Услуга временно недоступна.');
    var master = (DATA.MASTERS || []).filter(function (m) { return m.id === p.masterId; })[0];
    if (!master) errors.push('Мастер не найден.');
    if (service && master && (service.masters || []).length && service.masters.indexOf(master.id) < 0)
      errors.push('Выбранный мастер не выполняет эту услугу.');
    if (!p.date) errors.push('Не выбрана дата.');
    if (p.startMin == null) errors.push('Не выбрано время.');
    var now = nowDate || new Date();
    var nowS = dstr(now);
    if (p.date && p.date < nowS) errors.push('Нельзя записаться в прошедшую дату.');
    var nowMin = now.getHours() * 60 + now.getMinutes();
    if (service && master && p.date && p.startMin != null) {
      var end = p.startMin + service.minutes;
      if (p.date === nowS && p.startMin <= nowMin) errors.push('Это время уже прошло — выберите другое.');
      if (!rangeFree(master, p.date, p.startMin, end, bookings, blocks, SITE, SETTINGS))
        errors.push('Время уже занято или вне графика мастера. Выберите другой интервал.');
    }
    if (!p.name || p.name.trim().length < 2) errors.push('Укажите имя.');
    if (!phoneOk(p.phone)) errors.push('Введите телефон полностью: 10 цифр после +7.');
    if (!p.consent) errors.push('Нужно согласие на обработку персональных данных.');
    var price = service ? calcPrice(service, { pension: p.pension }, DISCOUNT) : { base: 0, final: 0, percent: 0, applied: false };
    return {
      ok: errors.length === 0,
      errors: errors,
      endMin: (service && p.startMin != null) ? p.startMin + service.minutes : null,
      price: price
    };
  }

  var API = {
    hm2m: hm2m, m2hm: m2hm, dstr: dstr, pdate: pdate, addDays: addDays, overlap: overlap,
    masterDay: masterDay, busyIntervals: busyIntervals, rangeFree: rangeFree,
    freeSlots: freeSlots, eligibleMasters: eligibleMasters, calcPrice: calcPrice,
    validateBooking: validateBooking, activeBookings: activeBookings,
    formatRuPhone: formatRuPhone, phoneOk: phoneOk
  };
  root.ECLAT = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
