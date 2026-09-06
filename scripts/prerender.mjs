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

const STATIC_PATHS = [
  'minsk',
  'minsk/minsk-mir',
  'minsk/bcminsk',
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
async function launchBrowser() {
  if (process.env.VERCEL) {
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
}

async function main() {
  if (!existsSync(DIST_DIR)) throw new Error('dist/ не найден — запускать после vite build');

  const landingPaths = await fetchLandingPaths();
  const paths = [
    ...landingPaths,
    ...(await fetchBusinessCenterPaths()),
    ...(await fetchClassDistrictComboPaths()),
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

  // 2026-09-06, "оптимизируй пайплайн" — с ростом каталога (145 карточек БЦ +
  // хабы класса/района + 32 хаба пересечений класс×район + лендинги
  // объектов, 190+ страниц) схема "новый браузер на КАЖДУЮ страницу и
  // КАЖДУЮ попытку" стала заметно давить на время сборки, поэтому браузер
  // сделали одним на всю сборку с self-healing (см. ensureBrowser ниже) и
  // пулом из WORKER_COUNT=4 параллельных вкладок.
  //
  // 2026-09-06, PAGESPEED_PLAN.md Э0 — на реальном деплое (Build Logs,
  // владелец прислал) это дало ~94 из ~194 путей потерянными («page.content:
  // Target page, context or browser has been closed»), включая сам
  // /minsk/minsk-mir. Причина — `@sparticuz/chromium` на Vercel запускает
  // Chromium с флагом `--single-process` (виден в Build Logs при релонче):
  // это ОДИН OS-процесс на весь браузер И все его вкладки разом, без
  // изоляции рендереров. Крах рендерера ОДНОЙ вкладки убивает процесс
  // целиком — вместе с ним падают И остальные вкладки, открытые в этот
  // момент другими воркерами. Чем выше WORKER_COUNT, тем больше вкладок
  // гарантированно гибнет одновременно при каждом таком крахе — сам пул
  // параллелизма не ускоряет сборку, а систематически множит потери.
  // WORKER_COUNT=1 (строго по одной вкладке за раз) — единственный
  // надёжный вариант при этом флаге: крах роняет максимум одну текущую
  // страницу, следующая попытка получает свежий браузер (ensureBrowser).
  // Дороже по времени, но пропавший на проде SEO-контент дороже.
  const WORKER_COUNT = 1;

  const serverProc = startPreviewServer();
  let browser = null;
  // Единственный "полёт" перезапуска браузера на все воркеры разом — при
  // WORKER_COUNT>1 несколько вкладок могут словить "browser closed" от
  // ОДНОГО и того же упавшего браузера одновременно (проверено локальным
  // тестом пула перед деплоем: без этой блокировки 4 воркера гонялись за
  // релончем разом и запускали браузер 5 раз вместо 1 — не падение сборки,
  // но чистая трата времени, обратная всему смыслу оптимизации). Пока
  // relaunchPromise не пуст — все параллельные вызовы просто ждут его
  // результат, не плодя свои собственные launchBrowser().
  let relaunchPromise = null;

  async function ensureBrowser() {
    if (browser && browser.isConnected()) return browser;
    if (!relaunchPromise) {
      relaunchPromise = (async () => {
        try {
          await browser?.close();
        } catch {
          // мог быть уже мёртв — не мешает перезапуску
        }
        browser = await launchBrowser();
        relaunchPromise = null;
        return browser;
      })();
    }
    return relaunchPromise;
  }

  // Пути, которые не удалось снять снапшотом ни за одну попытку — собираем,
  // чтобы в конце сборки явно провалиться, если среди них есть что-то
  // критичное (см. criticalPaths выше), а не молча оставить старый/пустой
  // HTML на проде.
  const failedPaths = [];

  const RENDER_ATTEMPTS = 3;

  async function renderPath(path) {
    for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
      let page;
      try {
        const activeBrowser = await ensureBrowser();
        page = await activeBrowser.newPage();
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
        const html = await page.content();
        const dir = join(DIST_DIR, path);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), html);
        console.log(`[prerender] /${path} → dist/${path}/index.html (${Math.round(html.length / 1024)} КБ)`);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isBrowserDeath =
          message.includes('closed') || message.includes('crashed') || message.includes('disconnected');
        if (attempt === RENDER_ATTEMPTS) {
          // Одна проблемная страница не должна ронять сборку остальных —
          // без снапшота роут просто останется на клиентском рендере, как
          // и было раньше, до Э2-1 (не хуже текущего состояния). Критичность
          // конкретно этого пути разбирается в конце main() (criticalPaths).
          console.error(`[prerender] /${path} пропущен после ${RENDER_ATTEMPTS} попыток:`, message);
          failedPaths.push(path);
        } else {
          console.warn(`[prerender] /${path}: попытка ${attempt} не удалась (${message}), повтор`);
        }
        // Ошибка похожа на "браузер умер" — форсируем переоткрытие на
        // следующей попытке, а не оставляем висеть мёртвый объект, который
        // ensureBrowser() иначе продолжил бы считать живым. Небольшая пауза
        // перед повтором — браузеру/ОС нужно время, чтобы реально освободить
        // ресурсы упавшего процесса, иначе следующий launch() рискует
        // застать то же нестабильное состояние.
        if (isBrowserDeath) {
          try {
            await browser?.close();
          } catch {
            // уже мёртв — и так сойдёт
          }
          browser = null;
          if (attempt < RENDER_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      } finally {
        if (page) {
          try {
            await page.close();
          } catch {
            // страница могла умереть вместе с браузером — не роняем сборку
          }
        }
      }
    }
  }

  try {
    await waitForServer();
    await ensureBrowser();
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
    try {
      await browser?.close();
    } catch {
      // не мешаем финалу сборки из-за неудачного close()
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

main().catch((err) => {
  console.error('[prerender] сбой:', err);
  process.exit(1);
});
