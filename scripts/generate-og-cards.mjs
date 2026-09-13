// Своя обложка соцсетей (og:image) под КАЖДУЮ публичную страницу — владелец,
// 2026-09-12: «у лендингов для клиентов я бы сделал не картинку с сайта, а
// свой кастомный формат — заливка красным фоном, а на ней заголовок таким же
// шрифтом как R, только поменьше».
//
// Что было: og:image у всех страниц, кроме лендингов объектов и карточек БЦ,
// — общая заглушка /og-image.png (красная обложка с «R»), а у лендингов —
// фото объекта из Supabase Storage. То есть в мессенджере десятки разных
// страниц выглядели одинаково.
//
// Что стало: на каждый снятый пререндером HTML рисуется своя карточка
// 1200×630 — фирменный красный #e4152b (--color-primary из src/index.css),
// «R» ExtraBold как в логотипе, заголовок страницы Montserrat SemiBold
// (в интерфейсе font-bold рендерится именно SemiBold, см. карту весов в
// @font-face блоках src/index.css — карточка должна выглядеть как сайт, а не
// жирнее его). Макет согласован с владельцем 2026-09-12 («вариант B»).
//
// Почему источник заголовка — готовый HTML из dist, а не данные из Supabase:
// заголовки собираются в трёх разных местах (SEO_OVERRIDES, fallbackObjectMeta,
// fallbackBusinessCenterMeta, плюс десяток статических страниц) — повторять
// эту логику голым node-скриптом значит гарантированно с ней разойтись.
// Пререндер уже положил в dist готовый og:title каждой страницы, его и берём.
// Отсюда же порядок запуска: скрипт идёт ПОСЛЕ prerender.mjs (см. npm run build).
//
// Админка сюда не попадает — у её разделов своя, общая красная обложка с «R»
// (см. scripts/generate-admin-shells.mjs, решение владельца там же).
//
// Сбой рендера конкретной карточки не роняет сборку: у страницы просто
// остаётся прежний og:image (заглушка или фото объекта) — не хуже, чем было.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import os from 'node:os';

const DIST_DIR = 'dist';
const FONTS_DIR = 'public/fonts';
const CARDS_DIR = join(DIST_DIR, 'og');
const SITE_ORIGIN = 'https://redevelopment.pro';
const RED = '#e4152b';

// index.html — общий SPA-фолбэк на неизвестные пути (и 404.html — копия с
// него): у них остаётся дефолтная обложка с «R», своей страницы за ними нет.
const SKIP_FILES = new Set(['index.html', '404.html']);

// Подпись под заголовком — по разделу сайта, без обращения к данным: адрес
// страницы уже однозначно говорит, что это за раздел.
function sectionKicker(path) {
  if (path === 'minsk') return 'Объекты, аналитика, справочник бизнес-центров';
  if (path.startsWith('minsk/analytics')) return 'Аналитика рынка · redevelopment.pro';
  if (path.startsWith('minsk/bcminsk')) return 'Справочник бизнес-центров Минска';
  if (path.startsWith('minsk/minsk-mir')) return 'Гид по району · redevelopment.pro';
  if (path === 'tz') return 'Просчёт объёмов работ по объекту';
  if (path === 'estimate') return 'Смета на ремонт помещения';
  if (path === 'plan') return 'Свободные кабинеты и рабочие места';
  if (path === 'summary') return 'Итоги и следующие шаги встречи';
  if (path === 'business-upload') return 'Сбор данных об организациях района';
  if (path.startsWith('minsk/')) return 'Аренда и продажа помещений · redevelopment.pro';
  return 'redevelopment.pro';
}

// Заголовки статических страниц часто уже содержат ровно ту же мысль, что и
// подпись раздела («Саммери встречи» + «Саммери встречи», «Коммерческая
// недвижимость в Минске — Redevelopment» + «Коммерческая недвижимость в
// Минске») — дважды одно и то же на карточке выглядит небрежно. В таком
// случае оставляем нейтральный адрес сайта. Сравниваем по упрощённой форме:
// регистр, ё/е и знаки препинания тут значения не имеют.
const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9 ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function kickerFor(path, title) {
  const kicker = sectionKicker(path);
  const [a, b] = [normalize(kicker), normalize(title)];
  return a && b && (b.includes(a) || a.includes(b)) ? 'redevelopment.pro' : kicker;
}

// Путь → имя файла карточки: /minsk/bcminsk/one → dist/og/minsk-bcminsk-one.png.
const cardSlug = (path) => path.replace(/\//g, '-') || 'index';

// Точечное переопределение текста ОДНОЙ карточки, когда владелец просит
// заголовок/подпись превью короче или иначе, чем og:title/раздел страницы
// (2026-09-13, af839571-minsk-mir-meta-task — обновление превью
// /minsk/minsk-mir без пересборки текста <title>). Ключ — точный путь
// (без trailing slash), не префикс: /minsk/minsk-mir/:topic сюда не попадает.
// title подобран так, чтобы FIT_SCRIPT уложил его именно в 3 строки, не 4
// (владелец, 2026-09-13: «4 строчки — тяжело воспринимается») — проверено
// локальным рендером карточки, порядок слов «цены и аналитика» через
// двоеточие вместо тире короче на пару символов и переносится ровно на
// границах слов «Коммерческая / недвижимость Минск / Мира: цены и аналитика».
const CARD_TEXT_OVERRIDES = {
  'minsk/minsk-mir': {
    title: 'Коммерческая недвижимость Минск Мира: цены и аналитика',
    kicker: 'Обновляется ежемесячно · redevelopment.pro',
  },
};

function collectHtmlFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Шеллы админки рисовать не надо — у них общая обложка с «R».
      if (relative(DIST_DIR, full) === 'admin') continue;
      collectHtmlFiles(full, acc);
    } else if (entry.endsWith('.html')) {
      acc.push(full);
    }
  }
  return acc;
}

const decodeEntities = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function readTitle(html) {
  const og = html.match(/<meta property="og:title" content="([^"]*)"/);
  const plain = html.match(/<title>([\s\S]*?)<\/title>/);
  const raw = (og?.[1] ?? plain?.[1] ?? '').trim();
  return raw ? decodeEntities(raw) : '';
}

// Montserrat инлайним в data:-URI: страница карточки рендерится из
// setContent, без сервера и сети — по относительному /fonts/... шрифт бы
// просто не загрузился и заголовок ушёл бы системным шрифтом.
function fontFaces() {
  const face = (weight, file) => {
    const data = readFileSync(join(FONTS_DIR, file)).toString('base64');
    return `@font-face{font-family:'Montserrat';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  };
  // Та же карта весов, что в src/index.css: 550–899 → SemiBold, 900 → ExtraBold.
  return face(500, 'Montserrat-Medium.woff2') + face('550 899', 'Montserrat-SemiBold.woff2') + face(900, 'Montserrat-ExtraBold.woff2');
}

const CARD_CSS = `*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Montserrat',sans-serif}
.card{width:1200px;height:630px;background:${RED};color:#fff;display:flex;flex-direction:column;justify-content:space-between;padding:66px 84px}
.top{display:flex;align-items:center;gap:22px}
.mark{font-weight:900;font-size:62px;line-height:1}
.site{font-weight:700;font-size:27px;opacity:.85;letter-spacing:.01em}
.title{font-weight:700;line-height:1.14;letter-spacing:-0.005em;overflow:hidden}
.kicker{font-weight:500;font-size:29px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;

// Заголовки бывают и в 20 символов, и в 90 — кегль подбираем не по формуле,
// а по факту: уменьшаем, пока текст не перестанет вылезать за отведённую
// высоту (три-четыре строки). Совсем длинные (карточки БЦ с адресом) режем
// по границе слова, чтобы не упереться в нечитаемый мелкий кегль.
const FIT_SCRIPT = `(function () {
  var el = document.querySelector('.title');
  var max = 360;
  for (var size = 92; size >= 44; size -= 3) {
    el.style.fontSize = size + 'px';
    if (el.scrollHeight <= max) return size;
  }
  return 44;
})()`;

function cardHtml(title, kicker) {
  return `<html><head><style>${fontFaces()}${CARD_CSS}</style></head><body><div class="card">
  <div class="top"><span class="mark">R</span><span class="site">redevelopment.pro</span></div>
  <div class="title">${escapeHtml(title)}</div>
  <div class="kicker">${escapeHtml(kicker)}</div>
</div></body></html>`;
}

function trimTitle(title) {
  const LIMIT = 96;
  if (title.length <= LIMIT) return title;
  const cut = title.slice(0, LIMIT);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[\s,—-]+$/, '')}…`;
}

// Тот же бинарник, что в scripts/prerender.mjs: на Vercel — @sparticuz/chromium,
// локально — браузер из окружения. И та же правка 2026-09-12: без
// `--single-process` (флаг под AWS Lambda; в контейнере сборки Vercel он
// только мешал — крах одной вкладки валил весь браузер, из-за чего карточки
// рисовались строго по одной). Многопроцессный Chromium позволяет рисовать
// в нескольких вкладках параллельно. PRERENDER_SINGLE_PROCESS=1 — вернуть
// старый режим (одна вкладка, --single-process), если вдруг понадобится.
const SINGLE_PROCESS = process.env.PRERENDER_SINGLE_PROCESS === '1';

async function launchBrowser() {
  if (process.env.VERCEL) {
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: SINGLE_PROCESS ? sparticuzChromium.args : sparticuzChromium.args.filter((a) => a !== '--single-process'),
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
}

// 2026-09-12 — обложки в быстром режиме пререндера берём с прода, а не
// рисуем заново. Раньше этот шаг рендерил все ~290 PNG браузером на КАЖДОЙ
// сборке (~45 секунд — половина всего быстрого билда, см. Build Logs деплоя
// d337cd6: пререндер 6с, обложки 46с). Пререндер оставляет в корне
// репозитория .prerender-result.json со списком путей, чей HTML скопирован с
// прода как есть (см. PRERENDER_RESULT_PATH в scripts/prerender.mjs). У такой
// страницы og:title тот же, что на проде, а рисунок — чистая функция от
// title/kicker и ЭТОГО скрипта (он входит в отпечаток публичного кода,
// scripts/public-build-id.mjs, поэтому в быстром режиме гарантированно не
// менялся) — значит, PNG на проде ровно тот, что мы бы нарисовали. Скачиваем.
// Файл читаем один раз и удаляем, чтобы он не пережил сборку; нет файла или
// не читается (полный режим, PRERENDER_SKIP=1, локальный прогон без
// пререндера) — рисуем всё, как раньше. Не скачалось/не PNG — рисуем эту
// страницу браузером, как раньше.
const PRERENDER_RESULT_PATH = '.prerender-result.json';
const COPY_WORKER_COUNT = 16;
const PNG_MAGIC = 0x89504e47;

function readCopiedFromProd() {
  try {
    const raw = readFileSync(PRERENDER_RESULT_PATH, 'utf8');
    rmSync(PRERENDER_RESULT_PATH, { force: true });
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed.copiedFromProd) ? parsed.copiedFromProd : []);
  } catch {
    return new Set();
  }
}

async function copyCardFromLive(slug) {
  try {
    const res = await fetch(`${SITE_ORIGIN}/og/${slug}.png`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    // SPA-рерайт vercel.json отдаёт на несуществующий путь index.html с кодом
    // 200 — проверяем сигнатуру PNG, а не только статус.
    if (buf.length < 8 || buf.readUInt32BE(0) !== PNG_MAGIC) return false;
    writeFileSync(join(CARDS_DIR, `${slug}.png`), buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    console.warn('[og-cards] нет каталога dist — нечего обрабатывать');
    return;
  }
  const copiedFromProd = readCopiedFromProd();
  const pages = [];
  for (const file of collectHtmlFiles(DIST_DIR)) {
    const rel = relative(DIST_DIR, file);
    if (SKIP_FILES.has(rel)) continue;
    const html = readFileSync(file, 'utf8');
    const title = readTitle(html);
    if (!title) {
      console.warn(`[og-cards] ${rel}: не нашёл og:title/<title> — оставляю прежнюю обложку`);
      continue;
    }
    const path = rel.endsWith('/index.html') ? rel.slice(0, -'/index.html'.length) : rel.slice(0, -'.html'.length);
    pages.push({ file, html, path, title: trimTitle(CARD_TEXT_OVERRIDES[path]?.title ?? title) });
  }
  if (pages.length === 0) {
    console.warn('[og-cards] публичных страниц в dist не нашлось — пропускаю');
    return;
  }
  mkdirSync(CARDS_DIR, { recursive: true });

  // Прописать в HTML страницы абсолютный URL её обложки (у копии с прода он
  // уже такой — запись идемпотентна).
  const finishPage = (entry) => {
    const cardUrl = `${SITE_ORIGIN}/og/${cardSlug(entry.path)}.png`;
    const html = entry.html
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${cardUrl}$2`)
      .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${cardUrl}$2`);
    writeFileSync(entry.file, html);
  };

  // 1) Страницы, скопированные с прода — обложку тоже с прода, параллельно.
  const toCopy = pages.filter((p) => copiedFromProd.has(p.path));
  const toRender = pages.filter((p) => !copiedFromProd.has(p.path));
  let copied = 0;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: COPY_WORKER_COUNT }, async () => {
      while (cursor < toCopy.length) {
        const entry = toCopy[cursor++];
        if (await copyCardFromLive(cardSlug(entry.path))) {
          finishPage(entry);
          copied += 1;
        } else {
          console.warn(`[og-cards] /${entry.path}: обложка с прода не скачалась — рисую`);
          toRender.push(entry);
        }
      }
    }),
  );

  // 2) Остальное — рисуем браузером. Один браузер, несколько вкладок
  //    параллельно (скриншот 1200×630 + PNG-кодирование — это CPU, поэтому по
  //    вкладке на ядро, не больше 6; RENDER_WORKERS — ручная настройка). До
  //    2026-09-12 рисовали строго по одной карточке — 291 штука занимала ~46с
  //    на каждой сборке. Браузер поднимаем, только если есть что рисовать
  //    (в быстром режиме — обычно ничего). В режиме --single-process
  //    параллелить нельзя — там одна вкладка, как раньше.
  const failed = [];
  let rendered = 0;
  if (toRender.length > 0) {
    const cpuCount = os.cpus().length || 2;
    const RENDER_WORKERS = SINGLE_PROCESS ? 1 : Number(process.env.RENDER_WORKERS) || Math.min(6, Math.max(2, cpuCount));
    let browserPromise = launchBrowser();
    browserPromise.catch(() => {}); // отказ получит await ниже, не unhandledRejection
    // Перезапуск общего браузера после падения — один раз на падение, а не
    // по разу от каждой вкладки, которая его заметила.
    const relaunch = async (used) => {
      if (browserPromise !== used) return;
      browserPromise = launchBrowser();
      browserPromise.catch(() => {});
      try {
        await (await used).close();
      } catch {
        // уже мёртв
      }
    };
    let cursor = 0;
    const worker = async () => {
      let page = null;
      let used = null;
      while (cursor < toRender.length) {
        const entry = toRender[cursor++];
        const slug = cardSlug(entry.path);
        let ok = false;
        for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
          try {
            if (!page) {
              used = browserPromise;
              page = await (await used).newPage({ viewport: { width: 1200, height: 630 } });
            }
            const kicker = CARD_TEXT_OVERRIDES[entry.path]?.kicker ?? kickerFor(entry.path, entry.title);
            await page.setContent(cardHtml(entry.title, kicker), { waitUntil: 'load' });
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(FIT_SCRIPT);
            await page.locator('.card').screenshot({ path: join(CARDS_DIR, `${slug}.png`) });
            ok = true;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const browser = used ? await used.catch(() => null) : null;
            if (!browser || !browser.isConnected() || /has been closed|Target closed|crashed/i.test(message)) {
              await relaunch(used);
            } else {
              try {
                await page?.close();
              } catch {
                // не мешает
              }
            }
            page = null;
            if (attempt === 2) {
              failed.push(`${entry.path} (${message})`);
              break;
            }
            console.warn(`[og-cards] /${entry.path}: ${message} — повтор`);
          }
        }
        if (!ok) continue;
        finishPage(entry);
        rendered += 1;
      }
      try {
        await page?.close();
      } catch {
        // не мешает
      }
    };
    await Promise.all(Array.from({ length: Math.min(RENDER_WORKERS, toRender.length) }, worker));
    try {
      await (await browserPromise).close();
    } catch {
      // уже закрыт
    }
  }
  console.log(
    `[og-cards] готово: ${copied + rendered} страниц со своей обложкой (dist/og/*.png; скопировано с прода ${copied}, отрендерено ${rendered})`,
  );
  if (failed.length > 0) {
    console.warn(`[og-cards] ${failed.length} страниц остались с прежним og:image:\n  - ${failed.join('\n  - ')}`);
  }
}

main().catch((err) => {
  // Обложки — не повод ронять деплой: без них страницы просто остаются с
  // прежним og:image.
  console.error('[og-cards] сбой, оставляю прежние обложки:', err);
});
