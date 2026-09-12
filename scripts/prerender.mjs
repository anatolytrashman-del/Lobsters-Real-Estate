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
// 2026-09-09 — БЫСТРЫЙ/ПОЛНЫЙ режим (владелец: "разделим маркетинговые
// страницы и платформу... чтобы можно было быстро править платформу, не
// ожидая полного рендера всего сервака на 250+ страниц"). Полный рендер
// (headless-браузер на каждый путь) — единственная по-настоящему долгая
// часть всей сборки (минуты, не секунды — запуск браузера на страницу,
// см. историю WORKER_COUNT ниже), и раньше выполнялся на КАЖДЫЙ пуш,
// включая пуши, не трогающие ни одну публичную страницу (правки CRM/API).
//
// Теперь по умолчанию (обычный пуш кода) — БЫСТРЫЙ режим: вместо рендера
// каждый путь просто СКАЧИВАЕТСЯ с уже живого прода (redevelopment.pro) —
// на порядок быстрее (голый HTTP, без браузера) и не оставляет ни одну
// страницу без снапшота (копируется актуальный на данный момент прод, не
// пусто). Если для конкретного пути живой копии нет/она невалидна (совсем
// новая страница, сетевая ошибка) — для НЕЁ ОДНОЙ делается настоящий
// рендер (fetchPathLive → renderPath как fallback), не всей сборки целиком.
//
// ПОЛНЫЙ режим (настоящий рендер каждого пути свежими данными) включается
// автоматически, когда сборку запустил Vercel Deploy Hook по сохранению
// объекта в админке (lib/objectsApi.ts → api/trigger-rebuild.js) — та же
// таблица deploy_debounce, что и debounce хука, служит вторым сигналом:
// свежий triggered_at (< FORCE_FULL_RECENT_MS) означает "эту сборку
// запустило реальное изменение данных, нужен настоящий рендер", а не
// просто пуш кода. Дополнительно — явный env `PRERENDER_FORCE_FULL=1` (для
// ручного полного прогона) и локальные/дев-запуски (без process.env.VERCEL)
// — там всегда полный режим, как и было. Любая ошибка при проверке флага
// (нет SUPABASE_SERVICE_ROLE_KEY, сеть подвела) — безопасный дефолт: полный
// рендер, не быстрый (чтобы баг в этой логике никогда не стал тихой SEO-
// регрессией).
//
// 2026-09-12 (вечер) — быстрый режим больше не сопоставляет имена чанков:
// в копию с прода целиком подставляются stylesheet-ссылка и лоадер ТЕКУЩЕЙ
// сборки из dist/index.html, результат проверяется по диску
// (scripts/prerender-snapshot.mjs — там история трёх сломанных версий и
// почему именно так; покрыто юнит-тестами). Итог быстрого режима пишется в
// .prerender-result.json для generate-og-cards.mjs (обложки скопированных
// страниц тоже берутся с прода, а не рисуются заново).
//
// 2026-09-12 — у полного режима появился ВТОРОЙ автоматический сигнал:
// правка кода самих публичных страниц (отпечаток их исходников,
// scripts/public-build-id.mjs, сверяется с живым продом — см.
// publicCodeChangedSinceLive ниже). Правки админки/API/скриптов отпечаток не
// меняют и идут быстрым путём.
//
// Важное следствие: страницы БЕЗ своего триггера обновления (каталог БЦ,
// хабы, аналитика — только лендинги объектов дёргают хук) больше не
// освежаются попутно от каждого пуша кода, как раньше — держать в голове,
// если понадобится гарантированная свежесть для них: либо завести им
// такой же вызов trigger-rebuild.js, либо гонять полный прогон по
// расписанию (см. вариант с крон-воркфлоу, ещё не заведён). Частично закрыто
// 2026-09-09 через ALWAYS_FULL_RENDER_PATHS ниже — короткий ручной список
// часто правящихся руками страниц, которые всегда получают настоящий рендер
// даже в быстром режиме, без полного прогона всех ~250 путей ради одной.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { computePublicBuildId } from './public-build-id.mjs';
import { adoptBuildAssets, extractBuildBlocks } from './prerender-snapshot.mjs';

const ROOT_DIR = new URL('..', import.meta.url).pathname;
const DIST_DIR = join(ROOT_DIR, 'dist');
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// Публичный anon-ключ (см. src/lib/supabase.ts) — тот же, что зашит в
// клиентский бандл, отдельного секрета для сборки не требует.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_EQwXLOy5TmSPj5tzKjbSeg_xj6SM2Iz';
// Только для проверки deploy_debounce (см. быстрый/полный режим ниже) —
// эта таблица закрыта RLS даже на select для anon (P0.2 аудита
// безопасности), нужен сервисный ключ. Он уже есть в Vercel env (используют
// api/*.js) — новый секрет от владельца не требуется.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_ORIGIN = 'https://redevelopment.pro';
// Сборка, запущенная Deploy Hook'ом (реальное изменение данных), должна
// успеть дойти до этой проверки, пока triggered_at ещё «свежий» — щедрый
// запас на очередь Vercel + предыдущие шаги сборки (tsc/vite build/сгенери-
// рованные html/sitemap), которые все идут ДО prerender.mjs.
const FORCE_FULL_RECENT_MS = 15 * 60_000;

// Все публичные страницы теперь под /minsk/... (см. docs/session-journal.md, урл-
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

// Владелец, 2026-09-09 — прямой вопрос после правки контента
// /minsk/minsk-mir: "это лендинг, они парсятся отдельно, да? Как бы
// перезапустить только одну страницу, а не все сотни". Реальная причина
// вопроса — правка КОДА содержания (текст/структура таблицы) не то же
// самое, что правка ДАННЫХ через сохранение объекта в админке: у последней
// есть свой триггер (lib/objectsApi.ts → api/trigger-rebuild.js →
// deploy_debounce → ПОЛНЫЙ режим на следующей сборке), а у первой — нет
// никакого (см. комментарий "Важное следствие" в шапке файла, это был
// известный, но не закрытый пробел). Без явного полного режима обычный
// пуш кода идёт БЫСТРЫМ путём — а тот для уже существующего пути просто
// СКАЧИВАЕТ текущую живую (ещё СТАРУЮ) страницу с прода, значит свежий
// текст рискует не попасть в сохранённый снапшот именно на той сборке,
// где его правили (реальным посетителям с JS не мешает — React
// перерисует поверх снапшота, — но боты/соцсети до следующего полного
// прогона видели бы старый текст).
//
// Решение — не гонять полный рендер ВСЕХ ~250 путей ради одной правленой
// страницы (дорого и не нужно), а держать здесь короткий список "всегда
// рендерить по-настоящему, даже в быстром режиме" — эти несколько страниц
// правятся руками достаточно часто, чтобы цена лишних секунд рендера на
// каждую сборку была разумной платой за гарантированную свежесть. Хабы
// каталога БЦ/лендинги объектов сюда сознательно не входят — их сотни, и
// у объектов уже есть свой триггер выше.
//
// 2026-09-10 — найден реальный, более тяжёлый баг того же механизма,
// затронувший /minsk/one: `fetchPathLive` копирует HTML живой страницы
// КАК ЕСТЬ, включая её ссылки на JS-чанки (`/assets/index-<hash>.js` и
// т.д.) — а хэши этих файлов у КАЖДОЙ новой сборки перегенерируются
// заново (обычный content-hash Vite), даже если сама эта страница
// внешне не менялась, стоит поменяться хоть одному файлу общего бандла
// (публичные страницы не lazy — см. "Код-сплиттинг админки" в другой
// части журнала). Итог — снапшот путей БЕЗ полного рендера ссылается на
// JS-файлы уже ПРЕДЫДУЩЕЙ сборки, которых в текущем деплое физически
// нет: `/assets/index-<старый-hash>.js` отдаёт 404 → общий SPA-рерайт
// vercel.json подменяет его на index.html → браузер получает вместо
// JS-модуля HTML и не может его выполнить → JS вообще не запускается.
// Это ОПРОВЕРГАЕТ прежнее допущение в комментарии выше ("реальным
// посетителям с JS не мешает — React перерисует поверх снапшота") — на
// самом деле мешает, React ничего не перерисовывает, если сам его код
// не смог загрузиться. Живой пример: коммит, убравший вкладки "План/
// Список" с лендинга Red One (/minsk/one), ушёл в деплой, где эта
// страница пошла быстрым путём — посетители час спустя всё ещё видели
// старые вкладки с планировкой, потому что снапшот страницы был
// заморожен на JS предыдущей сборки. `minsk/one` добавлен в этот же
// список по той же логике, что и minsk-mir — это не рядовой лендинг
// объекта, а флагманская продающая страница, которую правят часто и
// которой критично не зависать на устаревшем JS. Если тот же симптом
// повторится на других лендингах объектов — добавлять их сюда по
// одному, не переводить всю сотню сразу.
const ALWAYS_FULL_RENDER_PATHS = new Set(['minsk/minsk-mir', 'minsk/one']);

const STATIC_PATHS = [
  'minsk',
  'minsk/analytics',
  'minsk/analytics/metodika',
  'minsk/analytics/ofisy/arenda',
  'minsk/analytics/ofisy/prodazha',
  'minsk/analytics/torgovye/arenda',
  'minsk/analytics/torgovye/prodazha',
  'minsk/analytics/sklady/arenda',
  'minsk/analytics/sklady/prodazha',
  'minsk/analytics/mashinomesta/arenda',
  'minsk/analytics/mashinomesta/prodazha',
  'minsk/analytics/minsk-mir',
  'minsk/analytics/rajony',
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

// Хабы по улицам (аудит поиска 2026-09-07) — та же карта slug'ов, что в
// src/lib/businessCenterHubs.ts (STREET_SLUGS — продублировано, скрипт без
// TS-загрузчика), тот же streetOfAddress (businessCenterDisplay.ts,
// продублирован как streetOfAddressJs — чистая синтаксическая функция от
// адреса, не тянет БД). Хаб — только для улиц с 2+ БЦ (STREET_HUB_SLUG_BY_NAME
// содержит только уже подтверждённые slug'и таких улиц).
const STREET_HUB_SLUG_BY_NAME = {
  'пр-т Победителей': 'pr-t-pobediteley',
  'пр-т Независимости': 'pr-t-nezavisimosti',
  'пр-т Дзержинского': 'pr-t-dzerzhinskogo',
  'ул. Притыцкого': 'ul-pritytskogo',
  'ул. Сурганова': 'ul-surganova',
  'ул. Платонова': 'ul-platonova',
  'ул. Клары Цеткин': 'ul-klary-tsetkin',
  'пер. Козлова': 'per-kozlova',
  'пр-т Партизанский': 'pr-t-partizanskiy',
  'Логойский тракт': 'logoyskiy-trakt',
  'ул. Хоружей': 'ul-horuzhey',
  'ул. Филимонова': 'ul-filimonova',
  'ул. Немига': 'ul-nemiga',
  'ул. Мележа': 'ul-melezha',
  'ул. Толбухина': 'ul-tolbuhina',
  'ул. Железнодорожная': 'ul-zheleznodorozhnaya',
  'ул. Интернациональная': 'ul-internatsionalnaya',
  'ул. Лобанка': 'ul-lobanka',
  'ул. Ольшевского': 'ul-olshevskogo',
  'ул. Свердлова': 'ul-sverdlova',
  'ул. Скрыганова': 'ul-skryganova',
  'ул. Тимирязева': 'ul-timiryazeva',
  'ул. Скорины': 'ul-skoriny',
};

function shortAddressJs(a) {
  return a
    .replace(/^г\.\s*Минск,\s*/i, '')
    .replace(/^Минская\s+область,\s*/i, '')
    .replace(/^[А-ЯЁ][а-яё]+\s+район,\s*/, '')
    .trim();
}

function streetOfAddressJs(fullAddress) {
  const short = shortAddressJs(fullAddress);
  const parts = short.split(',').map((p) => p.trim());
  const houseIndex = parts.findIndex((p) => /^\d/.test(p));
  if (houseIndex > 0) return parts.slice(0, houseIndex).join(', ');
  if (houseIndex === 0) return short;
  return parts.length > 1 ? parts.slice(0, -1).join(', ') : short;
}

// Запрос к Supabase с повторами (2026-09-12). Реальная причина: за один день
// два прод-деплоя упали красным на ровном месте — Supabase free-tier отдал
// 504 на обычный select (сборки 05:59 и 11:59, Build Logs: «[prerender] сбой:
// Error: Supabase вернул 504 при запросе landing_slug»). Одна такая осечка
// роняла весь билд, и пересборку приходилось заказывать заново — ещё один
// цикл ожидания поверх и без того долгого пререндера. Та же беда, от которой
// на фронте защищает src/lib/withRetry.ts («холодный старт» free-tier), здесь
// защиты не было вовсе. Повторяем до трёх раз с нарастающей паузой; таймаут
// на попытку — чтобы зависший запрос не съедал минуты сборки молча.
const SUPABASE_ATTEMPTS = 3;

async function supabaseSelect(query, what) {
  let lastError;
  for (let attempt = 1; attempt <= SUPABASE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе ${what}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < SUPABASE_ATTEMPTS) {
        const pauseMs = attempt * 2000;
        console.warn(
          `[prerender] ${what}: попытка ${attempt} не удалась (${err instanceof Error ? err.message : err}) — повтор через ${pauseMs / 1000}с`,
        );
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
    }
  }
  throw lastError;
}

async function fetchStreetHubPaths() {
  const rows = await supabaseSelect('business_centers?select=address', 'business_centers.address');
  const slugs = new Set();
  for (const r of rows) {
    const slug = STREET_HUB_SLUG_BY_NAME[streetOfAddressJs(r.address)];
    if (slug) slugs.add(`minsk/bcminsk/ulitsa/${slug}`);
  }
  return [...slugs];
}

async function fetchMetroHubStations() {
  const rows = await supabaseSelect(
    'business_centers?select=nearest_metro_stations&nearest_metro_stations=not.is.null',
    'nearest_metro_stations',
  );
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
  const rows = await supabaseSelect(
    'business_centers?select=microdistrict&microdistrict=not.is.null',
    'microdistrict',
  );
  const slugs = new Set();
  for (const r of rows) {
    const slug = MICRODISTRICT_HUB_SLUG_BY_NAME[r.microdistrict];
    if (slug) slugs.add(`minsk/bcminsk/microrayon/${slug}`);
  }
  return [...slugs];
}

async function fetchClassDistrictComboPaths() {
  const rows = await supabaseSelect('business_centers?select=business_class,district', 'business_class/district');
  const combos = new Set();
  for (const r of rows) {
    const classSlug = CLASS_HUB_SLUG_BY_VALUE[r.business_class];
    const districtSlug = DISTRICT_HUB_SLUG_BY_NAME[r.district];
    if (classSlug && districtSlug) combos.add(`minsk/bcminsk/class/${classSlug}/raion/${districtSlug}`);
  }
  return [...combos];
}

async function fetchLandingPaths() {
  const rows = await supabaseSelect('objects?select=landing_slug&landing_slug=not.is.null', 'landing_slug');
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
  const rows = await supabaseSelect('business_centers?select=slug', 'business_centers.slug');
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
// Свой статический сервер для dist вместо `vite preview` (2026-09-12):
//  • SPA-шелл (dist/index.html) на любой навигацию без расширения — ровно то,
//    что нужно рендеру; файлы (assets/fonts/images/…) — как есть;
//  • /assets/* отдаются с `Cache-Control: immutable` — vite preview отдавал
//    `no-cache`, и браузер на каждой странице перепроверял каждый чанк; с
//    общим на воркер контекстом (см. renderPath) бандл и его скомпилированный
//    код теперь переживают переход между страницами;
//  • никакого дочернего процесса: раньше `proc.kill()` убивал npx, а его
//    дочерний vite оставался сиротой и держал пайпы — node не завершался после
//    последней страницы (локально висел до таймаута с уже записанным
//    результатом).
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function startPreviewServer() {
  const shell = readFileSync(join(DIST_DIR, 'index.html'));
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST_DIR, rel);
    const ext = extname(rel);
    if (ext && file.startsWith(DIST_DIR) && existsSync(file)) {
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(readFileSync(file));
      return;
    }
    if (ext) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(shell);
  });
  return server;
}

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve());
  });
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
//
// 2026-09-12 (вечер) — ОБЩИЙ МНОГОПРОЦЕССНЫЙ БРАУЗЕР вместо отдельного на
// каждую страницу. Вся история выше (п.2–5 у WORKER_COUNT в main) упиралась
// в одно: @sparticuz/chromium запускает Chromium с `--single-process` — это
// флаг под AWS Lambda, где нет места под процессы-рендереры; в нём крах или
// закрытие ОДНОЙ вкладки валит весь процесс вместе с чужими вкладками,
// поэтому и пришлось запускать браузер заново на каждый путь (~7с на
// страницу при 4 воркерах, ~8.5 минут на 286 путей — Build Logs 3d750e2).
// Сборка Vercel — не Lambda, а обычный контейнер (несколько vCPU, гигабайты
// памяти): убираем `--single-process` из аргументов sparticuz, и Chromium
// работает как везде — по процессу на вкладку, вкладки изолированы, ОДИН
// браузер на всю сборку, страницы открываются/закрываются в нём, JS-бандл и
// скомпилированный код кешируются между страницами. Остальные аргументы
// sparticuz (`--no-zygote`, `--disable-dev-shm-usage`-подобные, swiftshader)
// с многопроцессным режимом совместимы.
//
// Страховка на случай, если многопроцессный Chromium в контейнере сборки всё
// же нестабилен: падение общего браузера считается; после
// MAX_SHARED_BROWSER_CRASHES падений оставшиеся пути рендерятся по-старому —
// отдельный `--single-process`-браузер на страницу (медленно, но надёжно,
// ровно как до этой правки). Ручной выключатель — PRERENDER_SINGLE_PROCESS=1.
//
// `sparticuzChromium.executablePath()` при первом вызове РАСПАКОВЫВАЕТ
// бинарник во временный файл — это запись, не чтение: параллельные вызовы
// ловили `spawn ETXTBSY` (PAGESPEED_PLAN.md, Э0-3). Кешируем ПРОМИС, чтобы
// распаковка шла ровно один раз на сборку.
const MAX_SHARED_BROWSER_CRASHES = 3;
let legacyPerPageBrowser = process.env.PRERENDER_SINGLE_PROCESS === '1';

let executablePathPromise = null;
async function chromiumExecutable() {
  if (!executablePathPromise) {
    executablePathPromise = (async () => {
      if (!process.env.VERCEL) return { executablePath: '/opt/pw-browsers/chromium', args: [] };
      const sparticuzChromium = (await import('@sparticuz/chromium')).default;
      return { executablePath: await sparticuzChromium.executablePath(), args: sparticuzChromium.args };
    })();
  }
  return executablePathPromise;
}

async function launchBrowser({ singleProcess }) {
  const { executablePath, args } = await chromiumExecutable();
  return chromium.launch({
    executablePath,
    args: singleProcess ? args : args.filter((a) => a !== '--single-process'),
    headless: true,
  });
}

let sharedBrowserPromise = null;
let sharedBrowserCrashes = 0;
function sharedBrowser() {
  if (!sharedBrowserPromise) {
    sharedBrowserPromise = launchBrowser({ singleProcess: false });
    // Пустой обработчик: отказ запуска получит тот, кто ждёт промис через
    // await; без обработчика он стал бы unhandledRejection и убил процесс.
    sharedBrowserPromise.catch(() => {});
  }
  return sharedBrowserPromise;
}
// Перезапуск общего браузера после его падения. `used` — промис, с которым
// работал упавший воркер: если другой воркер уже перезапустил браузер, второй
// раз не трогаем (иначе несколько воркеров, упавших разом от одного краха,
// перезапускали бы его по кругу и накрутили бы счётчик).
async function resetSharedBrowser(used, reason) {
  if (sharedBrowserPromise !== used) return;
  sharedBrowserPromise = null;
  sharedBrowserCrashes++;
  console.warn(`[prerender] общий браузер потерян (${reason}) — падение №${sharedBrowserCrashes}, перезапускаю`);
  try {
    await (await used).close();
  } catch {
    // уже мёртв
  }
  if (sharedBrowserCrashes >= MAX_SHARED_BROWSER_CRASHES && !legacyPerPageBrowser) {
    legacyPerPageBrowser = true;
    console.warn(
      `[prerender] общий браузер падал ${sharedBrowserCrashes} раз — дальше по-старому: отдельный --single-process браузер на каждую страницу`,
    );
  }
}
const isBrowserGone = (browser, message) =>
  !browser || !browser.isConnected() || /has been closed|Target closed|crashed|Browser closed|Connection closed/i.test(message);

// true — полный рендер headless-браузером (см. комментарий про быстрый/
// полный режим в шапке файла), false — быстрое скачивание с живого прода.
//
// 2026-09-10 — реальный баг, пойманный владельцем на живом проде: билды
// снова стали занимать ~9 минут вместо ~1, «рендерит вообще все страницы,
// включая бизнес-центры». Причина — старая версия просто читала
// triggered_at и сравнивала с окном FORCE_FULL_RECENT_MS (15 минут): КАЖДЫЙ
// билд, попавший в это окно, уходил в полный рендер, не только тот, что
// реально запустил Deploy Hook по сохранению объекта. Живой инцидент
// (проверено через Vercel API + Management API): сохранение объекта в
// 10:47:53 выставило triggered_at → ручной Redeploy владельца в 10:48:08
// (15с спустя) попал в окно и занял 547с; следующий обычный пуш кода в
// 10:50:24 — тоже попал в то же окно (ещё < 15 минут прошло) и тоже ушёл в
// полный рендер, хотя не имел отношения к тому сохранению. При активной
// работе (пуши раз в несколько минут) это означает каскад медленных
// сборок от одного-единственного сохранения объекта.
//
// Настоящий инвариант, который нужен: НЕ «каждый билд в окне N минут», а
// «хотя бы ОДИН прод-билд после сохранения объекта должен сделать полный
// рендер с живыми данными» — дальше все остальные fast-режимные билды и
// так корректно скопируют уже посвежевший прод (fetchPathLive читает
// ЖИВУЮ страницу, а не конкретный git-коммит — какой именно билд сделал
// полный рендер, не важно, лишь бы хоть один). Поэтому вместо временного
// окна — атомарное «потребление один раз» (PATCH ... WHERE consumed_at IS
// NULL RETURNING ...): первый прод-билд, дошедший до этой проверки после
// триггера, забирает флаг и делает полный рендер, ВСЕ последующие видят
// его уже потреблённым и идут быстрым путём, даже если попали в то же
// «окно». FORCE_FULL_RECENT_MS остаётся подстраховкой на случай, если
// очередь Vercel аномально большая — не потреблять флаг, если он старше
// этого возраста (не зависать в полном режиме навечно из-за протухшего
// триггера).
//
// Preview/dev-сборки исключены из потребления флага совсем (не SEO-
// критичны, никто их не индексирует) — иначе гонка «кто первый прочитает»
// между прод- и preview-билдом одного и того же пуша могла бы отдать флаг
// preview, оставив прод на устаревшем быстром снапшоте. Неизвестный/не
// проставленный VERCEL_ENV — НЕ считается «точно preview», падаем в общую
// логику ниже (безопасный дефолт этой функции — при любой неуверенности
// полный рендер, не тихая регрессия).
async function shouldForceFullPrerender() {
  if (process.env.PRERENDER_FORCE_FULL === '1') return true;
  if (!process.env.VERCEL) return true; // локальный/ручной прогон — как и раньше, всегда полный
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return false;
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[prerender] SUPABASE_SERVICE_ROLE_KEY не задан — не могу проверить deploy_debounce, полный режим');
    return true;
  }
  try {
    const cutoffIso = new Date(Date.now() - FORCE_FULL_RECENT_MS).toISOString();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/deploy_debounce?id=eq.default&consumed_at=is.null&triggered_at=gt.${encodeURIComponent(cutoffIso)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ consumed_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return true;
    const rows = await res.json();
    if (rows.length > 0) return true; // забрали флаг первыми — наш билд делает полный рендер
  } catch (err) {
    console.warn('[prerender] не удалось проверить/потребить deploy_debounce — полный режим на всякий случай:', err);
    return true;
  }
  // Данные не менялись — остаётся вопрос, не менялся ли КОД публичных страниц.
  return await publicCodeChangedSinceLive();
}

// Второй сигнал полного режима (владелец, 2026-09-12: «большинство правок я
// вношу в админку, а оно рендерит и все маркетинговые страницы; нужен быстрый
// рендер чисто для админки и полный при правках маркетинговых страниц»).
//
// Перенацеливание ассетов выше починило быстрый режим технически: копия с
// прода снова годится, чем бы ни отличались имена чанков. Но остаётся вторая,
// содержательная половина вопроса — копия несёт РАЗМЕТКУ прода, а она
// устаревает, как только правится код самой публичной страницы (боты и
// соцсети видели бы старый текст до следующего полного прогона; ровно от
// этого и защищал ALWAYS_FULL_RENDER_PATHS, но вручную и лишь для двух
// страниц). Отличить «правили админку» от «правили маркетинг» по хэшам
// чанков нельзя: они пересчитываются каскадом от любой правки.
//
// Поэтому отдельный отпечаток исходников публичной части
// (scripts/public-build-id.mjs — граф СТАТИЧЕСКИХ импортов от src/main.tsx;
// админ-страницы в него не попадают по построению, они все за lazy() в
// App.tsx). Сборка кладёт его в dist/public-build-id.txt, здесь сверяем свой
// с тем, что лежит на живом проде: совпал — правки маркетинга не касались,
// копии корректны; не совпал — полный рендер.
//
// Любая неопределённость (файла на проде ещё нет, сеть подвела, отпечаток не
// посчитался) — полный режим, как и везде в этой логике: тихая SEO-регрессия
// дороже лишних минут сборки.
async function publicCodeChangedSinceLive() {
  let localId;
  try {
    localId = computePublicBuildId().id;
  } catch (err) {
    console.warn('[prerender] не удалось посчитать отпечаток публичного кода — полный режим:', err);
    return true;
  }
  try {
    const res = await fetch(`${SITE_ORIGIN}/public-build-id.txt`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.log(`[prerender] /public-build-id.txt на проде недоступен (${res.status}) — полный режим`);
      return true;
    }
    // До первого деплоя с этим шагом сборки файла на проде нет, и SPA-рерайт
    // vercel.json отдаёт на этот путь index.html с кодом 200 — поэтому
    // недостаточно проверить res.ok, нужен ещё и формат отпечатка.
    const liveId = (await res.text()).trim();
    if (!/^[0-9a-f]{32}$/.test(liveId)) {
      console.log('[prerender] на проде ещё нет /public-build-id.txt (ответ не похож на отпечаток) — полный режим');
      return true;
    }
    if (liveId === localId) {
      console.log(`[prerender] публичный код не менялся (отпечаток ${localId}) — правки не касаются маркетинговых страниц`);
      return false;
    }
    console.log(`[prerender] публичный код изменился (${liveId} → ${localId}) — полный режим`);
    return true;
  } catch (err) {
    console.warn('[prerender] не удалось сверить отпечаток публичного кода с продом — полный режим:', err);
    return true;
  }
}

// Быстрый путь: вместо рендера — скачать уже готовый снапшот с прода и
// подставить в него ассеты ТЕКУЩЕЙ сборки (scripts/prerender-snapshot.mjs —
// там же история трёх сломанных версий этой логики и почему теперь именно
// так). Валидной считаем только страницу с реальным <h1> (то же условие,
// что renderPath ждёт от headless-рендера) — «голый» SPA-шелл (например,
// если путь на проде почему-то ещё не был пререндерен) не проходит, и
// вызывающий код делает настоящий рендер именно для этого пути.

// Итог быстрого режима для следующего шага сборки
// (scripts/generate-og-cards.mjs): какие пути скопированы с прода — для них
// и OG-обложку можно взять с прода, а не рисовать браузером заново (это было
// ~45 секунд на КАЖДОЙ сборке, половина всего быстрого билда). Лежит в корне
// репозитория: не в dist/ (в деплой не попадает) и не в node_modules/.cache
// (его Vercel восстанавливает между сборками — устаревший список был бы
// опасен). Стирается в начале каждого прогона и читателем после чтения.
const PRERENDER_RESULT_PATH = join(ROOT_DIR, '.prerender-result.json');

// Блоки текущей сборки (stylesheet + лоадер) из dist/index.html — читаются
// один раз, лениво (к этому моменту vite build и defer-entry-script.mjs уже
// отработали). Бросает, если формат вывода сборки неожиданный — main()
// в этом случае уходит в полный режим целиком, с внятной строкой в логе.
let buildBlocksCache;
function currentBuildBlocks() {
  if (!buildBlocksCache) buildBlocksCache = extractBuildBlocks(readFileSync(join(DIST_DIR, 'index.html'), 'utf8'));
  return buildBlocksCache;
}

const assetExistsInDist = (name) => existsSync(join(DIST_DIR, 'assets', name));

// { ok: true } — снапшот записан; { ok: false, reason } — копию использовать
// нельзя, вызывающий код рендерит путь честно и учитывает причину в сводке.
async function fetchPathLive(path) {
  try {
    const res = await fetch(`${SITE_ORIGIN}/${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, reason: `прод ответил ${res.status}` };
    const html = await res.text();
    if (!/<h1[\s>]/i.test(html)) return { ok: false, reason: 'на проде нет снапшота (голый SPA-шелл без <h1>)' };
    const adopted = adoptBuildAssets(html, currentBuildBlocks(), assetExistsInDist);
    if (!adopted.html) return { ok: false, reason: adopted.reason };
    const dir = join(DIST_DIR, path);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.html'), adopted.html);
    console.log(`[prerender] /${path} → dist/${path}/index.html (скопировано с прода, ${Math.round(adopted.html.length / 1024)} КБ)`);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `не удалось скачать живую копию: ${err instanceof Error ? err.message : err}` };
  }
}

async function main() {
  rmSync(PRERENDER_RESULT_PATH, { force: true });
  // PRERENDER_SKIP=1 — полностью пропустить пререндер (2026-09-11, владелец:
  // «меняю админку, мне не нужна повторная регенерация страниц маркетинга»).
  // Локальный прогон идёт в ПОЛНОМ режиме (см. shouldForceFullPrerender) —
  // это ~285 путей по headless-браузеру на каждый, минут двадцать, тогда как
  // весь остальной билд (tsc + vite + sitemap + preview-html) укладывается в
  // ~10 секунд. Для проверки правок админки/CRM пререндер не нужен вообще:
  // `npm run build:app` (см. package.json) просто не доходит до этого шага,
  // а этот env — тот же выход для тех, кто всё же зовёт `npm run build`.
  if (process.env.PRERENDER_SKIP === '1') {
    console.log('[prerender] PRERENDER_SKIP=1 — пропускаю пререндер целиком');
    return;
  }
  if (!existsSync(DIST_DIR)) throw new Error('dist/ не найден — запускать после vite build');

  const landingPaths = await fetchLandingPaths();
  const paths = [
    ...landingPaths,
    ...(await fetchBusinessCenterPaths()),
    ...(await fetchClassDistrictComboPaths()),
    ...(await fetchMicrodistrictHubPaths()),
    ...(await fetchMetroHubPaths()),
    ...(await fetchStreetHubPaths()),
    ...STATIC_PATHS,
  ];
  if (paths.length === 0) {
    console.warn('[prerender] пререндерить нечего — нет ни объектов с landing_slug, ни статических страниц');
    return;
  }
  // PRERENDER_ONLY=префикс[,префикс…] — только для локальных замеров/отладки:
  // оставить пути, начинающиеся с одного из префиксов (например
  // `PRERENDER_ONLY=minsk/minsk-mir,minsk/bcminsk/raion`). На Vercel намеренно
  // игнорируется, чтобы случайно не уехал частичный прод.
  if (!process.env.VERCEL && process.env.PRERENDER_ONLY) {
    const prefixes = process.env.PRERENDER_ONLY.split(',').map((p) => p.trim()).filter(Boolean);
    const kept = paths.filter((p) => prefixes.some((prefix) => p.startsWith(prefix)));
    paths.splice(0, paths.length, ...kept);
    console.log(`[prerender] PRERENDER_ONLY — ограничиваюсь ${paths.length} путями по префиксам: ${prefixes.join(', ')}`);
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
  //    параллельной распаковке (см. выше, chromiumExecutable), но и
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
  // 2026-09-12 (вечер): один общий многопроцессный браузер (см. launchBrowser
  // выше), поэтому параллелизм ограничен уже не «сколько отдельных Chromium
  // выдержит контейнер», а CPU: по две вкладки на ядро, в пределах 4..8;
  // PRERENDER_WORKERS — ручная настройка без правки кода.
  const cpuCount = os.cpus().length || 2;
  const WORKER_COUNT = Number(process.env.PRERENDER_WORKERS) || Math.min(8, Math.max(4, cpuCount * 2));
  console.log(
    `[prerender] машина сборки: ${cpuCount} vCPU, ${Math.round(os.totalmem() / 2 ** 30)} ГБ; воркеров полного режима: ${WORKER_COUNT}` +
      (legacyPerPageBrowser ? ' (PRERENDER_SINGLE_PROCESS=1 — отдельный браузер на страницу)' : ''),
  );
  // Быстрый режим — просто HTTP GET, без единого браузера: constraint выше
  // (single-process Chromium) тут ни при чём, можно куда больше параллелизма.
  const FAST_WORKER_COUNT = 16;

  let fullMode = await shouldForceFullPrerender();
  if (!fullMode) {
    try {
      currentBuildBlocks();
    } catch (err) {
      console.warn(
        '[prerender] не удалось взять блоки ассетов текущей сборки из dist/index.html — полный режим:',
        err instanceof Error ? err.message : err,
      );
      fullMode = true;
    }
  }
  console.log(
    fullMode
      ? '[prerender] ПОЛНЫЙ режим — рендерю каждый путь headless-браузером (реальное изменение данных или ручной прогон)'
      : '[prerender] БЫСТРЫЙ режим — копирую уже живые страницы с прода, рендерю только то, чего там ещё нет',
  );
  if (fullMode && !process.env.VERCEL) {
    console.warn(
      `[prerender] это локальный полный прогон: ${paths.length} путей по отдельному headless-браузеру на каждый — ` +
        'десятки минут. Если правились только админка/CRM/api — прерывайте и используйте `npm run build:app` ' +
        '(тот же tsc + vite build + sitemap, без пререндера) либо `PRERENDER_SKIP=1 npm run build`.',
    );
  }

  const server = startPreviewServer();

  // Пути, которые не удалось снять снапшотом ни за одну попытку — собираем,
  // чтобы в конце сборки явно провалиться, если среди них есть что-то
  // критичное (см. criticalPaths выше), а не молча оставить старый/пустой
  // HTML на проде.
  const failedPaths = [];

  const RENDER_ATTEMPTS = 3;

  // Контексты воркеров: ключ — сам объект браузера, чтобы после перезапуска
  // общего браузера старые контексты не переиспользовались. При legacy-режиме
  // (свой браузер на страницу) контекст тоже свой — там переиспользовать нечего.
  const workerContexts = new WeakMap();
  async function workerContext(browser, workerId) {
    let byWorker = workerContexts.get(browser);
    if (!byWorker) {
      byWorker = new Map();
      workerContexts.set(browser, byWorker);
    }
    if (!byWorker.has(workerId)) byWorker.set(workerId, await browser.newContext());
    return byWorker.get(workerId);
  }

  async function renderPath(path, workerId = 0) {
    for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
      let browser;
      let context;
      let page;
      let ownBrowser = false;
      let usedShared = null;
      try {
        if (legacyPerPageBrowser) {
          browser = await launchBrowser({ singleProcess: true });
          ownBrowser = true;
        } else {
          usedShared = sharedBrowser();
          browser = await usedShared;
        }
        // Один BrowserContext на воркер (см. workerContext): страницы одного
        // воркера делят HTTP-кеш и скомпилированный код бандла — мегабайт JS не
        // качается и не компилируется заново на каждый путь. Сторадж между
        // путями при этом общий, но публичный код в него не пишет (проверено
        // 2026-09-12: sessionStorage трогает только ErrorBoundary при краше).
        // Вкладка на каждый путь — своя, чтобы JS-состояние одной страницы не
        // пережило переход к следующей.
        context = await workerContext(browser, workerId);
        page = await context.newPage();
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
        // есть — хуже прежнего поведения не станет. Опрос раз в 200мс, а не
        // каждый кадр: innerText большой страницы — это полный layout.
        await page
          .waitForFunction(() => !document.body.innerText.includes('Загрузка…'), { timeout: 15_000, polling: 200 })
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
        if (usedShared && isBrowserGone(browser, message)) await resetSharedBrowser(usedShared, message);
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
        if (ownBrowser && browser) {
          try {
            await browser.close();
          } catch {
            // мог быть уже мёртв — не мешает финалу
          }
        }
      }
    }
  }

  // Быстрый режим: сперва пробуем скачать живую копию с прода, и только если
  // её нет/не прошла проверку — настоящий рендер именно для этого пути
  // (тот же renderPath, что и в полном режиме, с его же ретраями/failedPaths).
  const copiedFromProd = [];
  const rerenderReasons = new Map(); // причина → сколько путей
  let alwaysFullCount = 0;

  async function processPathFast(path, workerId) {
    // ALWAYS_FULL_RENDER_PATHS — см. комментарий у самой константы: эти
    // несколько страниц правятся кодом достаточно часто, чтобы не
    // полагаться на "скачать текущую (возможно ещё старую) живую копию".
    if (ALWAYS_FULL_RENDER_PATHS.has(path)) {
      alwaysFullCount++;
      await renderPath(path, workerId);
      return;
    }
    const live = await fetchPathLive(path);
    if (live.ok) {
      copiedFromProd.push(path);
      return;
    }
    console.log(`[prerender] /${path}: ${live.reason} — рендерю заново`);
    rerenderReasons.set(live.reason, (rerenderReasons.get(live.reason) ?? 0) + 1);
    await renderPath(path, workerId);
  }

  try {
    await waitForServer(server);
    let cursor = 0;
    async function worker(workerId) {
      while (cursor < paths.length) {
        const path = paths[cursor++];
        await (fullMode ? renderPath(path, workerId) : processPathFast(path, workerId));
      }
    }
    await Promise.all(Array.from({ length: fullMode ? WORKER_COUNT : FAST_WORKER_COUNT }, (_, i) => worker(i)));
  } finally {
    server.close();
    if (sharedBrowserPromise) {
      try {
        await (await sharedBrowserPromise).close();
      } catch {
        // уже закрыт
      }
    }
  }

  writeFileSync(PRERENDER_RESULT_PATH, JSON.stringify({ fullMode, copiedFromProd }));

  // Одна строка-итог, по которой видно здоровье быстрого режима, не листая
  // сотни строк лога: «отрендерено из-за непригодной копии» в норме 0 (или
  // единицы — реально новые страницы). Десятки/сотни — сломан сам быстрый
  // путь (как 2026-09-11 и дважды 2026-09-12), и причины напечатаны ниже.
  if (!fullMode) {
    const rerendered = paths.length - copiedFromProd.length;
    console.log(
      `[prerender] ИТОГ быстрого режима: путей ${paths.length}, скопировано с прода ${copiedFromProd.length}, ` +
        `отрендерено браузером ${rerendered} (по списку ALWAYS_FULL_RENDER_PATHS: ${alwaysFullCount}, ` +
        `из-за непригодной копии: ${rerendered - alwaysFullCount})`,
    );
    if (rerenderReasons.size > 0) {
      const top = [...rerenderReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      console.warn(
        '[prerender] причины повторного рендера (много одинаковых — баг быстрого пути, а не новые страницы):\n' +
          top.map(([reason, n]) => `  - ${n} × ${reason}`).join('\n'),
      );
    }
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

main()
  .then(() => {
    // Явный выход: после main() не должно оставаться ни живых хендлов
    // (браузер закрыт, preview-сервер убит), но если что-то всё же держит
    // event loop — сборка не должна висеть до таймаута Vercel.
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error('[prerender] сбой:', err);
    process.exit(1);
  });
