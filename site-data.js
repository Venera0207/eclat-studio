/* =====================================================================
   ÉCLAT STUDIO — СОДЕРЖИМОЕ САЙТА
   ---------------------------------------------------------------------
   Файл собран для правки в редакторе redaktor.html — меняйте содержимое
   там, полями. Вручную правьте осторожно: лишняя кавычка или запятая —
   и сайт перестанет читать данные.
   ===================================================================== */

/* ---------- НАСТРОЙКИ САЙТА (контакты, график, карта) ---------- */
var SITE = {
  name: 'ÉCLAT STUDIO',
  slogan: 'Сияние начинается здесь',
  lead: 'Премиальный парикмахерский салон с неоновой душой и точными ножницами. Три зала — женский, мужской и детский — и онлайн-запись за одну минуту.',
  phone: '+7 931 357-96-00',          // как показывать на сайте
  phoneRaw: '+79313579600',           // тот же номер без пробелов — для кнопки звонка
  whatsapp: '79313579600',            // для кнопки WhatsApp
  email: 'venera.web.4@gmail.com',    // сюда приходят заявки с формы
  address: 'Шлиссельбургский пр., 24, к1',  // из проекта «Атланта» по ТЗ; замените на адрес салона перед запуском
  metro: '8 минут пешком от м. «Рыбацкое»',
  hours: 'Ежедневно с 08:00 до 22:00',
  open: '08:00',                      // начало рабочего дня салона
  close: '22:00',                     // конец рабочего дня салона
  timezone: 'Europe/Moscow',
  mapSrc: 'https://yandex.ru/map-widget/v1/?text=%D0%A8%D0%BB%D0%B8%D1%81%D1%81%D0%B5%D0%BB%D1%8C%D0%B1%D1%83%D1%80%D0%B3%D1%81%D0%BA%D0%B8%D0%B9%20%D0%BF%D1%80.%2C%2024%D0%BA1%2C%20%D0%A1%D0%B0%D0%BD%D0%BA%D1%82-%D0%9F%D0%B5%D1%82%D0%B5%D1%80%D0%B1%D1%83%D1%80%D0%B3&z=17',
  socials: []                         // например: [{title:'Telegram', url:'https://t.me/...'}]
};

/* ---------- РЕЖИМЫ РАБОТЫ САЙТА ---------- */
var SETTINGS = {
  slotStep: 15,        // шаг сетки времени, минут
  bufferMin: 10,       // перерыв между записями, минут
  maxDaysAhead: 60,    // на сколько дней вперёд можно записаться
  pipeUrl: 'https://script.google.com/macros/s/AKfycby5QU83WgqvnfSlclUlPVyXu9WLTAiYWflEfTrOjw3z1l-dWXKvCu-RzSDSm5oH9peO-w/exec', // адрес сервера записи (Google Apps Script)
  assistantUrl: '',    // адрес трубы ИИ-ассистента (Google Apps Script). Пусто = ассистент отвечает по локальной базе
  pipeNote: 'Пока сервер не подключён, записи хранятся локально в браузере (демо-режим). Подключение: backend/README.md'
};

/* ---------- ПЕНСИОННАЯ СКИДКА ---------- */
var DISCOUNT = {
  enabled: true,
  percent: 50,
  title: 'Ваша элегантность не знает возраста',
  subtitle: 'Пенсионерам — скидка 50%',
  terms: 'Скидка 50% для пенсионеров. Подтвердите пенсионное удостоверение в салоне. Скидка применяется к стоимости услуги и не суммируется с другими акциями.',
  stackable: false
};

/* ---------- МАСТЕРА (демо-профили: помечены demo:true) ---------- */
var MASTERS = [
  { id: 'm1', name: 'Алиса', role: 'Топ-мастер женского зала',
    desc: 'Стрижки, укладки и формы, которые держатся без усилий. Демо-профиль для витрины.',
    photo: 'img/master-1.jpg', active: true, demo: true,
    schedule: { days: [1,2,3,4,5,6], start: '08:00', end: '22:00', breaks: [{ start: '13:00', end: '14:00' }] },
    vacation: [] },
  { id: 'm2', name: 'Марина', role: 'Колорист',
    desc: 'Окрашивание в один тон, мелирование, balayage и тонирование. Демо-профиль для витрины.',
    photo: 'img/master-2.jpg', active: true, demo: true,
    schedule: { days: [2,3,4,5,6,0], start: '10:00', end: '22:00', breaks: [{ start: '14:00', end: '15:00' }] },
    vacation: [] },
  { id: 'm3', name: 'Марк', role: 'Барбер',
    desc: 'Мужские стрижки, fade, оформление бороды и камуфляж седины. Демо-профиль для витрины.',
    photo: 'img/master-3.jpg', active: true, demo: true,
    schedule: { days: [1,2,3,4,5,6], start: '08:00', end: '20:00', breaks: [{ start: '12:00', end: '13:00' }] },
    vacation: [] },
  { id: 'm4', name: 'Диана', role: 'Универсальный мастер, детский зал',
    desc: 'Детские стрижки без слёз и женские стрижки и укладки. Демо-профиль для витрины.',
    photo: 'img/master-4.jpg', active: true, demo: true,
    schedule: { days: [1,3,4,5,6,0], start: '09:00', end: '21:00', breaks: [{ start: '13:00', end: '13:30' }] },
    vacation: [] }
];

/* ---------- УСЛУГИ (цены демонстрационные, меняются в редакторе) ---------- */
var SERVICES = [
  { id: 'w1',  cat: 'women', title: 'Женская стрижка',            price: 2500, minutes: 60,  photo: 'img/svc-women-cut.jpg',   pension: true,  masters: ['m1','m4'], desc: 'Форма под тип лица и текстуру волос, с укладкой-финишем.' },
  { id: 'w2',  cat: 'women', title: 'Стрижка и укладка',          price: 3200, minutes: 90,  photo: 'img/styling-waves.jpg', pension: true, masters: ['m1','m4'], desc: 'Полный цикл: стрижка, уход и укладка с эффектом волны.' },
  { id: 'w3',  cat: 'women', title: 'Коррекция чёлки',            price: 500,  minutes: 20,  photo: 'img/svc-bang.jpg',   pension: true,  masters: ['m1','m4'], desc: 'Быстрая и точная коррекция между стрижками.' },
  { id: 'w4',  cat: 'women', title: 'Мытьё и укладка',            price: 1500, minutes: 45,  photo: 'img/care.jpg',         pension: true,  masters: ['m1','m4'], desc: 'SPA-мытьё, кондиционирование и укладка на выход.' },
  { id: 'w5',  cat: 'women', title: 'Вечерняя укладка',           price: 2500, minutes: 60,  photo: 'img/svc-evening.jpg', pension: true, masters: ['m1','m4'], desc: 'Локоны, волны или гладкий пучок — под ваш образ.' },
  { id: 'w6',  cat: 'women', title: 'Окрашивание в один тон',     price: 3500, minutes: 120, photo: 'img/svc-onetone.jpg',     pension: false, masters: ['m2'],      desc: 'Ровный глубокий цвет с защитой волос во время процедуры.' },
  { id: 'w7',  cat: 'women', title: 'Мелирование',                price: 5500, minutes: 180, photo: 'img/coloring.jpg',     pension: false, masters: ['m2'],      desc: 'Классическое мелирование на фольгу с тонированием.' },
  { id: 'w8',  cat: 'women', title: 'Сложное окрашивание / balayage', price: 7500, minutes: 240, photo: 'img/svc-balayage.jpg', pension: false, masters: ['m2'],  desc: 'Растяжка цвета с эффектом выгоревших прядей.' },
  { id: 'w9',  cat: 'women', title: 'Тонирование',                price: 2500, minutes: 60,  photo: 'img/svc-toning.jpg',     pension: false, masters: ['m2'],      desc: 'Освежение оттенка и блеска без стойкого воздействия.' },
  { id: 'w10', cat: 'women', title: 'Уходовая процедура',         price: 2000, minutes: 45,  photo: 'img/svc-careproc.jpg',         pension: false, masters: ['m1','m2','m4'], desc: 'Восстановление, питание и блеск: уход под тип волос.' },
  { id: 'h1',  cat: 'men',   title: 'Классическая стрижка',       price: 1500, minutes: 40,  photo: 'img/svc-men-classic.jpg',     pension: true,  masters: ['m3'],      desc: 'Ножницы и расчёска: аккуратная форма на каждый день.' },
  { id: 'h2',  cat: 'men',   title: 'Модельная стрижка',          price: 1800, minutes: 45,  photo: 'img/svc-men-style.jpg',     pension: true,  masters: ['m3'],      desc: 'Стрижка по форме лица с укладкой стайлингом.' },
  { id: 'h3',  cat: 'men',   title: 'Fade',                       price: 1800, minutes: 45,  photo: 'img/svc-men-fade.jpg',       pension: true,  masters: ['m3'],      desc: 'Чистый градиент любой высоты: low, mid или high.' },
  { id: 'h4',  cat: 'men',   title: 'Стрижка машинкой',           price: 1000, minutes: 25,  photo: 'img/svc-men-machine.jpg',       pension: true,  masters: ['m3'],      desc: 'Быстро и ровно: одна насадка или под ноль.' },
  { id: 'h5',  cat: 'men',   title: 'Коррекция бороды',           price: 1000, minutes: 20,  photo: 'img/barber.jpg',       pension: true,  masters: ['m3'],      desc: 'Окантовка и форма опасной бритвой или триммером.' },
  { id: 'h6',  cat: 'men',   title: 'Стрижка и оформление бороды', price: 2500, minutes: 60, photo: 'img/svc-men-combo.jpg',       pension: true,  masters: ['m3'],      desc: 'Полный мужской цикл: стрижка, борода, уход.' },
  { id: 'h7',  cat: 'men',   title: 'Камуфляж седины',            price: 1500, minutes: 30,  photo: 'img/svc-men-gray.jpg',     pension: false, masters: ['m3'],      desc: 'Деликатное тонирование седины без эффекта краски.' },
  { id: 'k1',  cat: 'kids',  title: 'Детская стрижка',            price: 1000, minutes: 30,  photo: 'img/svc-kids-cut.jpg',    pension: false, masters: ['m4'],      desc: 'Стрижка для мальчиков и девочек до 7 лет.' },
  { id: 'k2',  cat: 'kids',  title: 'Детская модельная стрижка',  price: 1300, minutes: 40,  photo: 'img/svc-kids-model.jpg',    pension: false, masters: ['m4'],      desc: 'Модельная форма для детей от 7 до 12 лет.' },
  { id: 'k3',  cat: 'kids',  title: 'Стрижка для девочки',        price: 1300, minutes: 40,  photo: 'img/svc-kids-girl.jpg',    pension: false, masters: ['m4'],      desc: 'Длина, чёлка и форма — бережно и с терпением.' },
  { id: 'k4',  cat: 'kids',  title: 'Первая стрижка',             price: 1000, minutes: 40,  photo: 'img/svc-kids-first.jpg',    pension: false, masters: ['m4'],      desc: 'Ритуал первой стрижки: кресло-самолётик и диплом смельчака.' }
];

/* ---------- ГАЛЕРЕЯ ---------- */
var GALLERY = [
  { src: 'img/gal-bob.jpg',        caption: 'Глянцевый боб: идеальная линия' },
  { src: 'img/gal-blonde.jpg',     caption: 'Огненный рыжий: сочный цвет' },
  { src: 'img/gal-copper.jpg',     caption: 'Шоколадный глянец после тонирования' },
  { src: 'img/gal-men-pomp.jpg',   caption: 'Мужской помпадур с фейдом' },
  { src: 'img/gal-bridal.jpg',     caption: 'Свадебная укладка с жемчугом' },
  { src: 'img/gal-kids-result.jpg', caption: 'Первая стрижка — и улыбка' },
  { src: 'img/gal-palette.jpg',    caption: 'Палитра колориста перед работой' },
  { src: 'img/gal-mirror.jpg',     caption: 'Неоновое зеркало и орхидеи' }
];

/* ---------- ТЕКСТЫ ---------- */
var TEXTS = {
  marquee: 'ЖЕНСКИЕ СТРИЖКИ • МУЖСКОЙ СТИЛЬ • ДЕТСКИЕ СТРИЖКИ • ОКРАШИВАНИЕ • ТВОЁ ПРЕОБРАЖЕНИЕ • СКИДКА ПЕНСИОНЕРАМ 50%',
  aboutTitle: 'О салоне',
  aboutText: 'ÉCLAT STUDIO — это три зала под одной неоновой крышей: женский, мужской и детский. Мы собрали мастеров, которые любят своё дело, и атмосферу, в которую хочется вернуться. Записывайтесь онлайн — выберите услугу, мастера и время, а остальное мы возьмём на себя.',
  reviewsNote: 'Здесь появятся настоящие отзывы клиентов. Мы не публикуем выдуманные истории и рейтинги.',
  consent: 'Согласен(на) на обработку персональных данных',
  payNote: 'Оплата производится в салоне'
};

/* ---------- ОТЗЫВЫ (пусто = блок показывает честную заглушку) ---------- */
var REVIEWS = [];
