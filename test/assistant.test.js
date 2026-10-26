/* Тесты трубы ИИ-ассистента (backend/eclat-pipe.gs) на эмуляторе Apps Script.
   Запуск: node test/assistant.test.js                                        */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------- эмулятор таблиц (повторяет поведение Google Sheets) ---------- */
function sheetsParse(v) {
  if (typeof v === 'string' && /^[+=@]/.test(v)) return '#ERROR!';
  return v;
}
class Sheet {
  constructor(name) { this.name = name; this.v = []; this.fmt = {}; this.widths = {}; this.maxCols = 26;
                      this.maxRows = 1000; this.style = {}; this.resized = null; this.rowH = {}; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  deleteColumns(start, n) { this.maxCols = Math.min(this.maxCols, start - 1); this.deleted = [start, n]; return this; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  deleteRows(start, n) { this.maxRows = Math.max(1, start - 1); this.v = this.v.slice(0, start - 1); return this; }
  setRowHeight(r, h) { this.rowH[r] = h; return this; }
  autoResizeRows(start, n) { this.resized = [start, n]; return this; }
  setName(n) { this.name = n; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getName() { return this.name; }
  getLastRow() { return this.v.length; }
  getLastColumn() { return this.v.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.v.push(row.map(sheetsParse)); return this; }
  deleteRow(i) { this.v.splice(i - 1, 1); }
  getDataRange() { const s = this; return { getValues: () => s.v.map(r => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const s = this; nr = nr || 1; nc = nc || 1;
    const range = {
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = s.v[r - 1 + i] || []; const line = [];
          for (let j = 0; j < nc; j++) line.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
          out.push(line);
        }
        return out;
      },
      setValue: (val) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          const row = s.v[r - 1 + i]; if (!row) continue;
          row[c - 1 + j] = (s.fmt[(r + i) + ':' + (c + j)] === '@') ? val : sheetsParse(val);
        }
        return range;
      },
      setNumberFormat: (f) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt[(r + i) + ':' + (c + j)] = f;
        return range;
      },
      setWrap: (on) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':wrap'] = on !== false; return range; },
      setVerticalAlignment: (a) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':valign'] = a; return range; },
      setHorizontalAlignment: () => range,
      setFontWeight: (w) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bold'] = w; return range; },
      setFontColor: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':color'] = col; return range; },
      setBackground: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bg'] = col; return range; },
      setValues: (rows2d) => {
        for (let i = 0; i < nr; i++) { const row = s.v[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = rows2d[i][j]; }
        return range;
      }
    };
    return range;
  }
}
class Spreadsheet {
  constructor(n) { this.n = n; this.sheets = []; }
  getSheetByName(n) { return this.sheets.filter(s => s.name === n)[0] || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(x => x !== sh); return this; }
  getId() { return 'FAKE_ASSIST'; }
}

const DB = new Spreadsheet('ÉCLAT assistant');
const SENT_MAIL = [];
const TG_SENT = [];
const CACHE = {};
const PROPS = {};
const FETCH_LOG = [];

global.SpreadsheetApp = { getActiveSpreadsheet: () => null, openById: () => DB, create: () => DB };
global.CacheService = { getScriptCache: () => ({ get: k => CACHE[k] || null, put: (k, v) => { CACHE[k] = String(v); }, remove: k => { delete CACHE[k]; } }) };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => PROPS[k], setProperty: (k, v) => { PROPS[k] = v; } }) };
global.MailApp = { sendEmail: (to, s, b) => SENT_MAIL.push({ to, s, b }) };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.example/exec' }) };
global.Session = { getScriptTimeZone: () => 'Etc/GMT' };
global.Utilities = {
  formatDate: (d, tz, p) => { const z = n => String(n).padStart(2, '0');
    return p.replace('yyyy', d.getFullYear()).replace('MM', z(d.getMonth() + 1)).replace('dd', z(d.getDate()))
            .replace('HH', z(d.getHours())).replace('mm', z(d.getMinutes())).replace('ss', z(d.getSeconds())); }
};
global.ContentService = { MimeType: { JAVASCRIPT: 'js' }, createTextOutput: t => ({ setMimeType: () => ({ getContent: () => t }) }) };
global.UrlFetchApp = {
  fetch: (url, opts) => {
    FETCH_LOG.push(url);
    if (/site-data\.js/.test(url)) return { getContentText: () => fs.readFileSync(path.join(__dirname, '..', 'site-data.js'), 'utf8'), getResponseCode: () => 200 };
    if (/api\.z\.ai/.test(url)) {
      const auth = (opts.headers || {})['Authorization'] || '';
      if (/GOODKEY/.test(auth)) {
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ choices: [{ message: { content: 'Женская стрижка у нас стоит 2700 ₽ и длится час 💇' } }] }) };
      }
      return { getResponseCode: () => 401, getContentText: () => '{"error":"invalid key"}' };
    }
    if (/api\.telegram\.org/.test(url)) {
      const body = opts.payload ? (typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload)) : '';
      TG_SENT.push({ url, body });
      return { getResponseCode: () => 200, getContentText: () => '{"ok":true}' };
    }
    return { getResponseCode: () => 500, getContentText: () => '' };
  }
};

/* ---------- грузим трубу ---------- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'backend', 'eclat-pipe.gs'), 'utf8');
(0, eval)(SRC);

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const call = (params) => JSON.parse(global.doGet({ parameter: params }).getContent());

console.log('\n=== ÉCLAT assistant pipe: тесты ===\n');

/* --- диагностика и жизнь без ключей --- */
t('test показывает, какие ключи заданы (сейчас — никакие)', () => {
  const r = call({ action: 'test' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.zaiKeySet, false);
  assert.strictEqual(r.botTokenSet, false);
  assert.strictEqual(r.catalogOk, true, 'каталог сайта не читается');
  assert.strictEqual(r.services, 21);
  assert.strictEqual(r.masters, 4);
});
t('JSONP-обёртка: callback оборачивается', () => {
  const raw = global.doGet({ parameter: { action: 'ping', callback: 'ea_cb_x' } }).getContent();
  assert.ok(/^ea_cb_x\(\{/.test(raw), raw.slice(0, 30));
});
t('без ключа Z.ai чат не падает и не пугает клиента «401»', () => {
  const r = call({ action: 'chat', msg: 'сколько стоит женская стрижка?' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ai, false);
  assert.ok(!/401|сервер ответил/i.test(r.reply), r.reply);
  assert.ok(/цен|окн|услуг/i.test(r.reply), r.reply);
});

/* --- заявки: главное, что они не теряются --- */
t('заявка БЕЗ бота и без ключей: сохраняется в лист и дублируется письмом', () => {
  const before = SENT_MAIL.length;
  const r = call({ action: 'lead', name: 'Анна', contact: '+7 927 850-44-16', message: 'Клиент: хочу стрижку', source: 'eclat-assistant', sid: 's1' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sheet, true);
  assert.strictEqual(r.telegram, false, 'без токена Telegram молчит');
  assert.strictEqual(r.mail, true);
  assert.strictEqual(SENT_MAIL.length, before + 1);
});
t('телефон в листе «Заявки» лежит текстом, со знаком + (не #ERROR!)', () => {
  const sh = DB.getSheetByName('Заявки');
  const row = sh.v[1];
  assert.ok(row, 'нет строки заявки');
  assert.strictEqual(row[2], '+7 927 850-44-16', 'контакт: ' + row[2]);
  assert.ok(!/#ERROR/.test(row.join('|')));
  assert.strictEqual(sh.fmt['2:3'], '@', 'колонка контакта не помечена текстом');
});
t('журнал: один разговор = одна строка, дообновляется по sid', () => {
  call({ action: 'log', sid: 's1', page: 'eclat-assistant', client: '', bot: 'Клиент: привет', outcome: 'kb' });
  const sh = DB.getSheetByName('Диалоги');
  assert.strictEqual(sh.v.length, 2, 'строк: ' + sh.v.length);
  call({ action: 'log', sid: 's1', page: 'eclat-assistant', client: 'lead', bot: 'Клиент: привет\nАссистент: здравствуйте', outcome: 'lead' });
  assert.strictEqual(sh.v.length, 2, 'после обновления строка задублировалась');
  assert.strictEqual(sh.v[1][3], 'lead');
  assert.strictEqual(sh.v[1][5], 'lead');
});

/* --- включаем бота и ключ --- */
t('с токеном бота заявка дополнительно уходит в Telegram', () => {
  global.BOT_TOKEN = '123:ABC'; global.CHAT_ID = '777';
  const tgBefore = TG_SENT.length;
  const r = call({ action: 'lead', name: 'Бот Тест', contact: '+7 900 111-22-33', message: 'диалог', source: 'eclat-assistant', sid: 's2' });
  assert.strictEqual(r.telegram, true);
  assert.ok(TG_SENT.length >= tgBefore + 2, 'ожидали карточку + диалог, пришло: ' + (TG_SENT.length - tgBefore));
  assert.ok(TG_SENT.some(m => /новая заявка/.test(m.body)), 'нет карточки заявки');
  assert.ok(TG_SENT.some(m => /Диалог с клиентом/.test(m.body)), 'нет сообщения с диалогом');
});
t('с ключом Z.ai чат отвечает нейросетью (ai:true)', () => {
  global.ZAI_KEY = 'GOODKEY';
  const r = call({ action: 'chat', msg: 'сколько стоит женская стрижка?', hist: JSON.stringify([{ role: 'user', text: 'привет' }, { role: 'assistant', text: 'здравствуйте' }]) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ai, true);
  assert.ok(/2700/.test(r.reply), r.reply);
});
t('если Z.ai отвечает ошибкой — клиент получает вежливый запасной ответ', () => {
  global.ZAI_KEY = 'BADKEY';
  const r = call({ action: 'chat', msg: 'что-то сложное' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ai, false);
  assert.ok(!/BADKEY|401/i.test(r.reply));
});
t('alert шлёт в Telegram, а без бота — письмом', () => {
  global.BOT_TOKEN = '123:ABC';
  const mBefore = SENT_MAIL.length;
  call({ action: 'alert', text: 'тест тревоги' });
  assert.strictEqual(SENT_MAIL.length, mBefore, 'при живом боте письмо не нужно');
  global.BOT_TOKEN = 'ВСТАВЬ_BOT_TOKEN';
  call({ action: 'alert', text: 'тест тревоги без бота' });
  assert.strictEqual(SENT_MAIL.length, mBefore + 1, 'без бота тревога должна прийти письмом');
});
t('неизвестное действие отвечает списком доступных', () => {
  const r = call({ action: 'ololo' });
  assert.strictEqual(r.ok, false);
  assert.ok(/chat/.test(r.hint));
});

t('лист «Заявки» приведён к размеру: 5 колонок, шапка закреплена, диалог широкий', () => {
  const sh = DB.getSheetByName('Заявки');
  assert.strictEqual(sh.maxCols, 5, 'колонок: ' + sh.maxCols);
  assert.strictEqual(sh.frozen, 1, 'шапка не закреплена');
  assert.strictEqual(sh.widths[4], 620, 'ширина колонки диалога: ' + sh.widths[4]);
});
t('doPost: журнал диалога создаёт лист «Диалоги» и пишет строку', () => {
  global.doPost({ postData: { contents: JSON.stringify({ sid: 's9', page: 'eclat-assistant', bot: 'Клиент: привет\nАссистент: здравствуйте', outcome: 'kb' }) } });
  const sh = DB.getSheetByName('Диалоги');
  assert.ok(sh, 'лист «Диалоги» не создан');
  assert.ok(sh.v.length >= 2, 'строки журнала нет');
  assert.strictEqual(sh.v[sh.v.length - 1][1], 's9');
  assert.strictEqual(sh.maxCols, 6, 'колонок журнала: ' + sh.maxCols);
});
t('doPost: заявка сохраняет источник из запроса, а не «telegram» по умолчанию', () => {
  global.doPost({ postData: { contents: JSON.stringify({ name: 'Источник Тест', contact: '+79001234567', message: 'm', source: 'eclat-assistant', sid: 's10' }) } });
  const sh = DB.getSheetByName('Заявки');
  const row = sh.v[sh.v.length - 1];
  assert.strictEqual(row[1], 'Источник Тест');
  assert.strictEqual(row[4], 'eclat-assistant', 'источник: ' + row[4]);
});

/* --- красота и полнота текста (v2.2) --- */
t('версия трубы 2.2 — таблицы делаются красивыми сами', () => {
  assert.strictEqual(call({ action: 'ping' }).version, 2.2);
  assert.strictEqual(call({ action: 'test' }).version, 2.2);
});

t('заголовки по-русски: «SID» заменён на «Код диалога», старая шапка чинится сама', () => {
  const sh = DB.getSheetByName('Диалоги');
  sh.v[0] = ['Дата', 'SID', 'Страница', 'Контакт', 'Весь диалог', 'Итог'];
  global.tidyAll();
  assert.deepStrictEqual(sh.v[0], ['Дата', 'Код диалога', 'Страница', 'Контакт', 'Весь диалог', 'Итог']);
  sh.v[0].forEach(h => assert.ok(/[а-яА-Я]/.test(h), 'заголовок не по-русски: ' + h));
});

t('шапка оформлена по-фирменному и закреплена', () => {
  const sh = DB.getSheetByName('Заявки');
  assert.strictEqual(sh.style['1:1:bg'], '#4C2E9E', 'фон шапки: ' + sh.style['1:1:bg']);
  assert.strictEqual(sh.style['1:1:color'], '#FFFFFF');
  assert.strictEqual(sh.style['1:5:bold'], 'bold');
  assert.strictEqual(sh.frozen, 1);
  assert.strictEqual(sh.maxCols, 5, 'лишние колонки: ' + sh.maxCols);
});

t('диалог сохраняется ПОЛНОСТЬЮ: 30 000 знаков без обрезки', () => {
  const long = Array.from({ length: 600 }, (_, i) => 'Клиент: реплика ' + (i + 1) + ' — спрашивает про стрижку и свободные окна.').join('\n');
  assert.ok(long.length > 30000, 'тест короткий: ' + long.length);
  const r = call({ action: 'lead', name: 'Полный Текст', contact: '+7 900 555-44-33', message: long, source: 'eclat-assistant' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const row = DB.getSheetByName('Заявки').v.slice(-1)[0];
  assert.strictEqual(row[3], long, 'сохранено ' + row[3].length + ' из ' + long.length);
});

t('журнал диалога: весь разговор целиком, с переносом строк и широкой колонкой', () => {
  const long = Array.from({ length: 900 }, (_, i) => 'Ассистент: ответ ' + (i + 1)).join('\n');
  call({ action: 'log', sid: 'long-1', page: 'eclat-assistant', bot: long, outcome: 'kb' });
  const sh = DB.getSheetByName('Диалоги');
  const row = sh.v.slice(-1)[0];
  assert.strictEqual(row[4].length, long.length, 'обрезано: ' + row[4].length + ' из ' + long.length);
  assert.ok(sh.widths[5] >= 620, 'колонка диалога узкая: ' + sh.widths[5]);
  assert.strictEqual(sh.style[sh.v.length + ':5:wrap'], true, 'нет переноса текста');
  assert.deepStrictEqual(sh.resized, [2, sh.v.length - 1], 'высота строк не подобрана');
});

t('пустая вкладка «Sheet1» удаляется при приборке', () => {
  const junk = new Sheet('Sheet1');
  DB.sheets.push(junk);
  global.tidyAll();
  assert.strictEqual(DB.getSheetByName('Sheet1'), null, 'пустая вкладка осталась');
  assert.ok(DB.getSheetByName('Заявки') && DB.getSheetByName('Диалоги'), 'рабочие листы задеты');
});

t('tidy доступен по ссылке и не ломает данные', () => {
  const before = DB.getSheetByName('Заявки').v.length;
  const r = call({ action: 'tidy' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(DB.getSheetByName('Заявки').v.length, before, 'приборка съела строки');
});

console.log('\n=== ' + pass + ' пройдено, ' + fail + ' провалено ===');
console.log('Писем: ' + SENT_MAIL.length + ', Telegram: ' + TG_SENT.length + ', заявок в листе: ' + (DB.getSheetByName('Заявки').v.length - 1) + '\n');
process.exit(fail ? 1 : 0);
