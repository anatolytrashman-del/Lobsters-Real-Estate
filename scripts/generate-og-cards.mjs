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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

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

async function launchBrowser() {
  // Тот же выбор бинарника, что в scripts/prerender.mjs (см. комментарий там):
  // на Vercel — @sparticuz/chromium, локально — браузер из окружения.
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
  if (!existsSync(DIST_DIR)) {
    console.warn('[og-cards] нет каталога dist — нечего обрабатывать');
    return;
  }

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
    // dist/minsk/one/index.html → minsk/one; dist/tz.html → tz
    const path = rel.endsWith('/index.html') ? rel.slice(0, -'/index.html'.length) : rel.slice(0, -'.html'.length);
    pages.push({ file, html, path, title: trimTitle(title) });
  }

  if (pages.length === 0) {
    console.warn('[og-cards] публичных страниц в dist не нашлось — пропускаю');
    return;
  }

  mkdirSync(CARDS_DIR, { recursive: true });

  let browser = await launchBrowser();
  let page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const failed = [];
  let done = 0;

  for (const entry of pages) {
    const slug = cardSlug(entry.path);
    let rendered = false;
    for (let attempt = 1; attempt <= 2 && !rendered; attempt++) {
      try {
        await page.setContent(cardHtml(entry.title, kickerFor(entry.path, entry.title)), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(FIT_SCRIPT);
        await page.locator('.card').screenshot({ path: join(CARDS_DIR, `${slug}.png`) });
        rendered = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt === 2) {
          failed.push(`${entry.path} (${message})`);
          break;
        }
        // Единственный известный способ, которым этот шаг реально падает на
        // Vercel, — смерть single-process Chromium (та же болячка, что
        // описана в prerender.mjs у WORKER_COUNT): поднимаем заново и
        // повторяем именно эту карточку.
        console.warn(`[og-cards] /${entry.path}: ${message} — перезапускаю браузер`);
        try {
          await browser.close();
        } catch {
          // мог уже умереть — не мешает
        }
        browser = await launchBrowser();
        page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
      }
    }
    if (!rendered) continue;

    const cardUrl = `${SITE_ORIGIN}/og/${slug}.png`;
    const html = entry.html
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${cardUrl}$2`)
      .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${cardUrl}$2`);
    writeFileSync(entry.file, html);
    done += 1;
  }

  await browser.close().catch(() => {});

  console.log(`[og-cards] готово: ${done} страниц со своей обложкой (dist/og/*.png)`);
  if (failed.length > 0) {
    console.warn(`[og-cards] ${failed.length} страниц остались с прежним og:image:\n  - ${failed.join('\n  - ')}`);
  }
}

main().catch((err) => {
  // Обложки — украшение превью, а не контент: уронить из-за них весь деплой
  // хуже, чем оставить прежний og:image.
  console.error('[og-cards] сбой, оставляю прежние обложки:', err);
});
