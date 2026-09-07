// Пререндер публичных лендингов объектов (SEO_PLAN.md, Э2-1) — после
// vite build открывает каждую опубликованную страницу headless-браузером
// и сохраняет реально отрисованный HTML в dist/<path>/index.html.
//
// Зачем: у SPA один статический index.html на все роуты, а контент
// (title/meta, H1, цены) появляется только после клиентского фетча из
// Supabase. Яндекс рендерит JS нестабильно (официальная рекомендация —
// SSR/пререндер), AI-краулеры (GPTBot, PerplexityBot, ClaudeBot) вообще
// не выполняют JS — без пререндера для них лендинга не существует.
//
// dist/<slug>/index.html Vercel отдаёт как статический файл РАНЬШЕ общего
// rewrite "/(.*)" → "/index.html" из vercel.json (проверено curl-ом после
// первого деплоя, см. журнал SEO_PLAN.md) — тот же принцип, что и у
// dist/tz.html (generate-tz-preview-html.mjs), только там просто другой
// <head> поверх пустого SPA-шелла, а здесь — уже отрисованный контент.
//
// Список слагов — не захардкожен: запрос к Supabase (тот же публичный
// anon-ключ, что и в lib/supabase.ts, доступ регулируется RLS, не
// секретностью ключа) за всеми объектами с непустым landing_slug — новые
// объекты с продающей страницей подхватываются сами, без правки скрипта.
//
// Один HTML-снапшот на слаг не протухнет молча: рабочий процесс — трекнуть
// сборку с Vercel Deploy Hook при сохранении объекта в админке (см.
// lib/objectsApi.ts, api/trigger-rebuild.js), не расписание.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT_DIR = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(ROOT_DIR, 'dist');
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Публичный anon-ключ (см. src/lib/supabase.ts) — тот же, что зашит в
// клиентский бандл, отдельного секрета для сборки не требует.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_EQwXLOy5TmSPj5tzKjbSeg_xj6SM2Iz';

// Все публичные страницы теперь под /minsk/... (см. CLAUDE.md, урл-
// структура) — переменная переименована из STATIC_SLUGS в STATIC_PATHS:
// это уже полные пути от корня, не голые слаги (у хабов их и не может
// быть, они не привязаны к одному сегменту). Добавлять сюда каждую новую
// контентную страницу вне сущности "объект" (гиды — Э3-1 в SEO_PLAN.md).
// /minsk/analytics и /minsk/analytics/minsk-mir были в списке — раздел
// аналитики по районам целиком удалён владельцем 2026-08-25.
// Хаб-страницы каталога БЦ по классу/району (Fable-анализ, 2026-09-06,
// src/lib/businessCenterHubs.ts) — slug'и конечного известного множества
// (4 класса + 9 админ-районов Минска + "Великий камень"), сознательно
// продублированы здесь как плоский список, а не импортированы из .ts
// модуля — этот скрипт запускается голым node без TS-загрузчика (см.
// package.json), импорт .ts напрямую не заработает. Если карта slug'ов в
// businessCenterHubs.ts когда-нибудь изменится — обновить и здесь.
const CLASS_HUB_SLUGS = ['a', 'b-plus', 'b', 'c'];
const DISTRICT_HUB_SLUGS = [
  'tsentralny',
  'oktyabrsky',
  'sovetsky',
  'frunzensky',
  'zavodskoy',
  'pervomaysky',
  'partizansky',
  'moskovsky',
  'leninsky',
  'velikiy-kamen',
];

// Посадочные под подсказки Google по Минск Миру — тот же список, что
// MINSK_MIR_TOPIC_SLUGS в src/data/minskMirTopics.ts (продублирован plain-
// массивом по той же причине, что и хабы каталога ниже).
const MINSK_MIR_TOPIC_SLUGS = ['biznes-centr', 'kovorking', 'kupit-ofis', 'arenda-ofisa', 'kommercheskie-pomeshcheniya'];

const STATIC_PATHS = [
  'minsk',
  'minsk/minsk-mir',
  ...MINSK_MIR_TOPIC_SLUGS.map((s) => `minsk/minsk-mir/${s}`),
  'minsk/bcminsk',
  'minsk/bcminsk/stroyashchiesya',
  'minsk/bcminsk/reyting',
  ...CLASS_HUB_SLUGS.map((s) => `minsk/bcminsk/class/${s}`),
  ...DISTRICT_HUB_SLUGS.map((s) => `minsk/bcminsk/raion/${s}`),
];

// Хаб-страницы по пересечению класс×район (владелец, 2026-09-06: "структура
// урлов [пересечений]... точечные страницы будут очень хорошо приняты
// поиском") — slug'и класса/района из тех же конечных списков выше, но сам
// список НЕПУСТЫХ пар — динамический (запрос business_class+district всех
// БЦ, группировка на месте), не хардкожен: план (`BCMINSK_SEO_PLAN.md`)
// явно предупреждал не генерировать хаб для комбинации без единого БЦ.
const CLASS_HUB_SLUG_BY_VALUE = { A: 'a', 'B+': 'b-plus', B: 'b', C: 'c' };
const DISTRICT_HUB_SLUG_BY_NAME = {
  Центральный: 'tsentralny',
  Октябрьский: 'oktyabrsky',
  Советский: 'sovetsky',
  Фрунзенский: 'frunzensky',
  Заводской: 'zavodskoy',
  Первомайский: 'pervomaysky',
  Партизанский: 'partizansky',
  Московский: 'moskovsky',
  Ленинский: 'leninsky',
};

// Хабы по неформальным микрорайонам (владелец, 2026-09-07: "Бизнес-центры
// Уручье") — та же карта slug'ов, что в businessCenterHubs.ts (сознательно
// продублирована, см. комментарий выше про DISTRICT_HUB_SLUGS — этот скрипт
// без TS-загрузчика). Список НЕПУСТЫХ микрорайонов — динамический (та же
// защита от тонкого контента, что и у комбо класс×район).
const MICRODISTRICT_HUB_SLUG_BY_NAME = {
  Комаровка: 'komarovka',
  Чкаловский: 'chkalovsky',
  'Каменная Горка': 'kamennaya-gorka',
  Веснянка: 'vesnyanka',
  'Зелёный Луг': 'zelenyy-lug',
  Сухарево: 'suharevo',
  'Золотая Горка': 'zolotaya-gorka',
  Уручье: 'uruchye',
  Степянка: 'stepyanka',
  Барановщина: 'baranovschina',
  Магистр: 'magistr',
  Радужный: 'raduzhny',
  'Раковское Шоссе-1': 'rakovskoe-shosse-1',
  Лошица: 'loshitsa',
  'Великий Лес': 'velikiy-les',
  Грушевка: 'grushevka',
  Слепянка: 'slepyanka',
  'Михалово-2': 'mihalovo-2',
};


// Хабы по станциям метро (аудит поиска 2026-09-07) — та же карта slug'ов и
// тот же радиус 1500 м, что в src/lib/businessCenterHubs.ts
// (METRO_STATION_SLUGS / METRO_HUB_MAX_DISTANCE_M — продублировано, скрипт
// без TS-загрузчика). Хаб — только для станций с ≥1 БЦ в радиусе.
const METRO_HUB_MAX_DISTANCE_M = 1500;
const METRO_HUB_SLUG_BY_STATION = {
  Молодёжная: 'molodezhnaya',
  Фрунзенская: 'frunzenskaya',
  'Площадь Франтишка Богушевича': 'ploshchad-bogushevicha',
  'Академия наук': 'akademiya-nauk',
  Пушкинская: 'pushkinskaya',
  'Институт культуры': 'institut-kultury',
  Вокзальная: 'vokzalnaya',
  'Юбилейная площадь': 'yubileynaya-ploshchad',
  'Площадь Победы': 'ploshchad-pobedy',
  Купаловская: 'kupalovskaya',
  'Ковальская Слобода': 'kovalskaya-sloboda',
  Московская: 'moskovskaya',
  'Площадь Якуба Коласа': 'ploshchad-yakuba-kolasa',
  Михалово: 'mihalovo',
  'Площадь Ленина': 'ploshchad-lenina',
  Грушевка: 'grushevka',
  Восток: 'vostok',
  Петровщина: 'petrovshchina',
  Немига: 'nemiga',
  Аэродромная: 'aerodromnaya',
  Уручье: 'uruchye',
  Октябрьская: 'oktyabrskaya',
  'Борисовский тракт': 'borisovskiy-trakt',
  'Каменная горка': 'kamennaya-gorka',
  'Парк Челюскинцев': 'park-chelyuskintsev',
  Спортивная: 'sportivnaya',
  Кунцевщина: 'kuntsevshchina',
  Первомайская: 'pervomayskaya',
  'Тракторный завод': 'traktornyy-zavod',
  Партизанская: 'partizanskaya',
  Пролетарская: 'proletarskaya',
  Малиновка: 'malinovka',
  Автозаводская: 'avtozavodskaya',
  Могилёвская: 'mogilevskaya',
};

async function fetchMetroHubStations() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/business_centers?select=nearest_metro_stations&nearest_metro_stations=not.is.null`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе nearest_metro_stations`);
  const rows = await res.json();
  const slugs = new Set();
  for (const r of rows) {
    for (const s of Array.isArray(r.nearest_metro_stations) ? r.nearest_metro_stations : []) {
      const slug = METRO_HUB_SLUG_BY_STATION[s?.name];
      if (slug && typeof s.distanceMeters === 'number' && s.distanceMeters <= METRO_HUB_MAX_DISTANCE_M) slugs.add(slug);
    }
  }
  return [...slugs];
}

async function fetchMetroHubPaths() {
  return (await fetchMetroHubStations()).map((slug) => `minsk/bcminsk/metro/${slug}`);
}

async function fetchMicrodistrictHubPaths() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/business_centers?select=microdistrict&microdistrict=not.is.null`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе microdistrict`);
  const rows = await res.json();
  const slugs = new Set();
  for (const r of rows) {
    const slug = MICRODISTRICT_HUB_SLUG_BY_NAME[r.microdistrict];
    if (slug) slugs.add(`minsk/bcminsk/microrayon/${slug}`);
  }
  return [...slugs];
}

async function fetchClassDistrictComboPaths() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/business_centers?select=business_class,district`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе business_class/district`);
  const rows = await res.json();
  const combos = new Set();
  for (const r of rows) {
    const classSlug = CLASS_HUB_SLUG_BY_VALUE[r.business_class];
    const districtSlug = DISTRICT_HUB_SLUG_BY_NAME[r.district];
    if (classSlug && districtSlug) combos.add(`minsk/bcminsk/class/${classSlug}/raion/${districtSlug}`);
  }
  return [...combos];
}

async function fetchLandingPaths() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/objects?select=landing_slug&landing_slug=not.is.null`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе landing_slug`);
  const rows = await res.json();
  return rows
    .map((r) => r.landing_slug)
    .filter((slug) => typeof slug === 'string' && slug.trim() !== '')
    .map((slug) => `minsk/${slug}`);
}

// Отдельные страницы бизнес-центров (/minsk/bcminsk/:slug) — та же причина
// пререндера, что и у лендингов объектов выше: без снапшота у AI-краулеров/
// Яндекса контента конкретного БЦ не существует. Список слагов — из той же
// таблицы, что читает публичная страница (business_centers), не хардкожен.
async function fetchBusinessCenterPaths() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/business_centers?select=slug`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе business_centers.slug`);
  const rows = await res.json();
  return rows
    .map((r) => r.slug)
    .filter((slug) => typeof slug === 'string' && slug.trim() !== '')
    .map((slug) => `minsk/bcminsk/${slug}`);
}

// `vite preview` — тот же сервер, что уже настроен как npm-скрипт
// (package.json → "preview"), отдаёт dist/ с правильными MIME-типами и
// SPA-фолбэком из коробки. Не переизобретаю сервер вручную — самодельный
// без точного MIME для .js/.css рискует сломать загрузку ES-модулей в
// headless-браузере (Chromium требует text/javascript у <script type="module">).
function startPreviewServer() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT_DIR,
    stdio: 'pipe',
  });
  return proc;
}

async function waitForServer(timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {
      // сервер ещё не поднялся — подождать и попробовать снова
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('vite preview не поднялся за 20с');
}

// На Vercel обычный playwright-браузер не факт что запустится (минимальный
// build-контейнер, нет гарантии системных библиотек под Chromium) —
// @sparticuz/chromium собран специально под такие serverless/build-среды
// (тот же образ, что используют для Lambda). Локально (эта песочница,
// возможная будущая разработка) используем уже готовый Chromium из
// PLAYWRIGHT_BROWSERS_PATH напрямую по пути — тот же приём, что скилл `run`
// советует для случаев с закреплённой версией браузера в окружении.
//
// `sparticuzChromium.executablePath()` при первом вызове РАСПАКОВЫВАЕТ
// бинарник Chromium во временный файл — это не идемпотентное чтение
// готового пути, а запись. Реальный сбой на проде (PAGESPEED_PLAN.md,
// Э0-3): несколько воркеров стартуют параллельно и все разом зовут
// `executablePath()` — один процесс ещё дописывает файл, другой в этот
// момент пытается его запустить → `spawn ETXTBSY` ("text file busy"),
// сборка падает целиком. Фикс — распаковка ровно один раз на всю сборку
// (кэшируем ПРОМИС, не результат, иначе конкурентные вызовы до его
// разрешения всё равно затеяли бы вторую параллельную распаковку);
// `launchBrowser()` теперь зовётся на КАЖДЫЙ рендер (см. историю у
// WORKER_COUNT ниже — переиспользование браузера между страницами в этой
// сборке не работает), так что без этого кэша распаковка гонялась бы не
// 4 раза, а сотни.
let launchOptionsPromise = null;
function resolveLaunchOptions() {
  if (!launchOptionsPromise) {
    launchOptionsPromise = (async () => {
      if (process.env.VERCEL) {
        const sparticuzChromium = (await import('@sparticuz/chromium')).default;
        return {
          args: sparticuzChromium.args,
          executablePath: await sparticuzChromium.executablePath(),
          headless: true,
        };
      }
      return { executablePath: '/opt/pw-browsers/chromium', headless: true };
    })();
  }
  return launchOptionsPromise;
}

async function launchBrowser() {
  const options = await resolveLaunchOptions();
  return chromium.launch(options);
}

async function main() {
  if (!existsSync(DIST_DIR)) throw new Error('dist/ не найден — запускать после vite build');

  const landingPaths = await fetchLandingPaths();
  const paths = [
    ...landingPaths,
    ...(await fetchBusinessCenterPaths()),
    ...(await fetchClassDistrictComboPaths()),
    ...(await fetchMicrodistrictHubPaths()),
    ...(await fetchMetroHubPaths()),
    ...STATIC_PATHS,
  ];
  if (paths.length === 0) {
    console.warn('[prerender] пререндерить нечего — нет ни объектов с landing_slug, ни статических страниц');
    return;
  }

  // Пути, без снапшота которых сборка не должна тихо проезжать (PAGESPEED_PLAN.md,
  // Э0-2) — лендинги объектов (деньги) и все статические контентные страницы
  // (в т.ч. /minsk/minsk-mir). Карточки БЦ и хабы класса×района сюда
  // намеренно не входят — их 150+, единичный сбой не должен ронять весь
  // деплой, но полный список пропущенных путей всё равно печатается ниже.
  const criticalPaths = new Set([...landingPaths, ...STATIC_PATHS]);

  // История (важно для будущих правок этого файла, четыре захода подряд):
  // 1) Исходно — новый браузер на КАЖДУЮ страницу и КАЖДУЮ попытку. Со
  //    182+ страницами в каталоге (145 карточек БЦ + хабы класса/района +
  //    32 хаба пересечений класс×район + лендинги объектов) это стало
  //    заметно давить на время сборки — запуск headless-браузера на
  //    порядок дороже открытия вкладки в уже запущенном.
  // 2) 2026-09-06, "оптимизируй пайплайн" — переехали на ОДИН браузер на
  //    всю сборку + пул из WORKER_COUNT=4 параллельных вкладок
  //    (`newPage()` в одном и том же браузере). На проде (Build Logs,
  //    владелец прислал) это дало ~94 из ~194 путей потерянными
  //    («page.content: Target page, context or browser has been closed»),
  //    включая сам /minsk/minsk-mir. Причина — `@sparticuz/chromium` на
  //    Vercel запускает Chromium с флагом `--single-process` (виден в
  //    логах при релонче): один OS-процесс на весь браузер И все его
  //    вкладки разом, без изоляции рендереров — крах рендерера ОДНОЙ
  //    вкладки убивал процесс целиком, вместе с остальными вкладками ТОГО
  //    ЖЕ браузера, открытыми в этот момент другими воркерами.
  // 3) Первый фикс — WORKER_COUNT=1, строго последовательно: убрал потери,
  //    но увеличил время пререндера примерно в 4 раза — неприемлемо долго.
  // 4) Второй фикс — свой процесс браузера на каждый воркер (переиспользуем
  //    его между страницами ОДНОГО воркера). Ловил `spawn ETXTBSY` при
  //    параллельной распаковке (см. ниже, resolveLaunchOptions), но и
  //    после фикса ETXTBSY на реальном деплое (Build Logs) вскрылось: у
  //    ЭТОЙ СБОРКИ `--single-process`-браузер надёжно переживает ровно
  //    ОДНУ страницу — на второй же `newPage()` того же процесса стабильно
  //    падает с "Target page, context or browser has been closed", и
  //    приходится закрывать/перезапускать процесс заново на каждой
  //    странице всё равно, просто ценой одной гарантированно провальной
  //    попытки перед этим (лишний relaunch + backoff на КАЖДУЮ страницу).
  // 5) Настоящий фикс — раз переиспользование браузера между страницами в
  //    этой сборке в принципе не работает, не пытаемся: свежий браузер
  //    (свой OS-процесс) на КАЖДЫЙ рендер, без попытки его переживать между
  //    страницами — это и есть исходная схема (п.1), просто с сохранённым
  //    параллелизмом (WORKER_COUNT воркеров, каждый в своём цикле). Не
  //    красивее, зато без единой лишней проваленной попытки на страницу.
  const WORKER_COUNT = 4;

  const serverProc = startPreviewServer();

  // Пути, которые не удалось снять снапшотом ни за одну попытку — собираем,
  // чтобы в конце сборки явно провалиться, если среди них есть что-то
  // критичное (см. criticalPaths выше), а не молча оставить старый/пустой
  // HTML на проде.
  const failedPaths = [];

  const RENDER_ATTEMPTS = 3;

  async function renderPath(path) {
    for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
      let browser;
      let page;
      try {
        browser = await launchBrowser();
        page = await browser.newPage();
        // ?prerender=1 — сигнал для инлайн-скрипта Яндекс.Метрики в
        // index.html не считать этот заход реальным визитом (см.
        // комментарий там же). В сохранённый HTML параметр не попадает —
        // только управляет тем, что выполнится при заходе именно отсюда.
        await page.goto(`${BASE_URL}/${path}?prerender=1`, { waitUntil: 'domcontentloaded' });
        // ObjectLandingPage держит спиннер, пока не пришли данные из
        // Supabase (см. состояние loading) — h1 в разметке появляется
        // только у реального контента, это и есть сигнал готовности
        // (для статических страниц вроде DistrictGuidePage h1 есть сразу).
        await page.waitForSelector('h1', { timeout: 20_000 });
        // У гида района h1 статический и появляется ДО прихода данных из
        // Supabase — таблицы первичного/вторичного рынка в этот момент ещё
        // показывают плейсхолдер «Загрузка…», и он попадал в снапшот
        // (проверено на проде 2026-08-25: обе таблицы отсутствовали в
        // сохранённом HTML). Дожидаемся, пока на странице не останется ни
        // одного «Загрузка…» (данные пришли ИЛИ отрисовался терминальный
        // «Данные пока не собраны»). Не фатально: по таймауту снимаем как
        // есть — хуже прежнего поведения не станет.
        await page
          .waitForFunction(() => !document.body.innerText.includes('Загрузка…'), { timeout: 15_000 })
          .catch(() => console.warn(`[prerender] /${path}: «Загрузка…» не исчезла за 15с — снапшот с плейсхолдером`));
        // scripts/defer-entry-script.mjs подключает главный JS не из <head>,
        // а инлайн-лоадером после первого кадра — в живом DOM к этому
        // моменту уже висят вставленные им <script type="module">/<link
        // rel="modulepreload"> (помечены data-entry-injected). В снапшот они
        // попасть не должны: иначе на проде модуль подключится напрямую из
        // разметки, сразу (весь смысл отложенной загрузки пропадёт), а
        // лоадер добавит его второй раз. Сам лоадер (data-entry-loader) —
        // обычный инлайн-скрипт в конце body, остаётся как есть.
        await page.evaluate(() => {
          document.querySelectorAll('[data-entry-injected]').forEach((el) => el.remove());
        });
        const html = await page.content();
        if (!html.includes('data-entry-loader')) {
          throw new Error('в снапшоте нет лоадера главного JS (data-entry-loader) — defer-entry-script.mjs не отработал?');
        }
        const dir = join(DIST_DIR, path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), html);
        console.log(`[prerender] /${path} → dist/${path}/index.html (${Math.round(html.length / 1024)} КБ)`);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === RENDER_ATTEMPTS) {
          // Одна проблемная страница не должна ронять сборку остальных —
          // без снапшота роут просто останется на клиентском рендере, как
          // и было раньше, до Э2-1 (не хуже текущего состояния). Критичность
          // конкретно этого пути разбирается в конце main() (criticalPaths).
          console.error(`[prerender] /${path} пропущен после ${RENDER_ATTEMPTS} попыток:`, message);
          failedPaths.push(path);
        } else {
          console.warn(`[prerender] /${path}: попытка ${attempt} не удалась (${message}), повтор`);
          await new Promise((r) => setTimeout(r, 300 * attempt));
        }
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // страница могла умереть вместе с браузером — не роняем сборку
          }
        }
        if (browser) {
          try {
            await browser.close();
          } catch {
            // мог быть уже мёртв — не мешает финалу
          }
        }
      }
    }
  }

  try {
    await waitForServer();
    let cursor = 0;
    async function worker() {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        await renderPath(path);
      }
    }
    await Promise.all(Array.from({ length: WORKER_COUNT }, worker));
  } finally {
    serverProc.kill();
  }

  // Э0-2 (PAGESPEED_PLAN.md) — раньше пропуск ЛЮБОГО пути (включая
  // /minsk/minsk-mir и лендинги объектов) был тихим console.error, сборка
  // всё равно завершалась успешно и на прод уезжал пустой SPA-шелл вместо
  // контента. Теперь пропуск критичного пути валит сборку явно — Vercel
  // покажет красный деплой и оставит прод на прошлой рабочей версии, а не
  // тихо задеплоит регресс.
  const failedCritical = failedPaths.filter((p) => criticalPaths.has(p));
  if (failedCritical.length > 0) {
    console.error(
      `[prerender] СБОЙ: ${failedCritical.length} критичных путей остались без снапшота:\n` +
        failedCritical.map((p) => `  - /${p}`).join('\n'),
    );
    process.exitCode = 1;
  } else if (failedPaths.length > 0) {
    console.warn(
      `[prerender] ${failedPaths.length} некритичных путей (карточки БЦ/хабы) остались без снапшота — сборка продолжается:\n` +
        failedPaths.map((p) => `  - /${p}`).join('\n'),
    );
  }
}

main().catch((err) => {
  console.error('[prerender] сбой:', err);
  process.exit(1);
});
