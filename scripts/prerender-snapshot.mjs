// Подстановка ассетов ТЕКУЩЕЙ сборки в снапшот страницы, скопированный с
// живого прода (быстрый режим scripts/prerender.mjs). Вынесено в отдельный
// модуль без побочных эффектов, чтобы покрыть юнит-тестами реальные формы
// HTML — именно отсутствие теста дало дожить до прода двум сломанным версиям
// этой логики подряд (см. историю ниже).
//
// История, зачем это вообще (коротко; подробно — docs/session-journal.md,
// 2026-09-11 и 2026-09-12):
//
// 1) Копия с прода тащит ссылки на `/assets/<чанк>-<хэш>.js/.css` ПРОШЛОЙ
//    сборки; в новой хэши другие, файлов с такими именами нет, SPA-рерайт
//    отдаёт на них index.html — приложение на странице не стартует
//    (реальный инцидент 2026-09-11, прод лежал).
// 2) Первый фикс — «копия годится, только если ссылается на входной чанк
//    этой сборки» — выродил быстрый режим в полный почти на каждом деплое
//    (хэш меняется от любой правки фронта): 9 минут пререндера на пуш в
//    админку.
// 3) Второй фикс (утро 2026-09-12) — перенацеливание ссылок по «стему»
//    имени файла регуляркой `^(.+)-([A-Za-z0-9_-]+)\.(js|css)$`. Сломался
//    тем же днём: хэш Vite/Rolldown — base64url, в нём бывает ДЕФИС
//    (`index-9zN-b8-n.js`, `chevron-up-vBYbzeS-.js`, `badgeColor-DYi-Cv2y.js`),
//    жадный `(.+)` резал стем по последнему дефису → стем «index-9zN-b8»
//    вместо «index» → ссылка из копии «не сопоставилась» → честный рендер
//    ВСЕХ 284 путей → 10 минут сборки (Build Logs деплоя 49e74ed, 13:31).
//    Вероятность дефиса в 8-символьном хэше ~12%, чанков на странице ~30 —
//    то есть ломалось бы практически при каждом изменении хэшей.
//
// Настоящий инвариант: между снапшотом и текущей сборкой различаются ТОЛЬКО
// два блока, и оба целиком порождаются нашей же сборкой —
//   • `<link rel="stylesheet" href="/assets/index-<hash>.css">` в <head>
//     (Vite), и
//   • `<script data-entry-loader>…</script>` в конце <body>
//     (scripts/defer-entry-script.mjs — внутри него JSON-списки всех
//     чанков: входной + modulepreload'ы).
// Поэтому имена файлов не сопоставляем вообще: берём оба блока из
// dist/index.html текущей сборки как есть и подставляем ВМЕСТО блоков копии.
// Что бы ни случилось с именами/составом чанков (дефисы в хэше, новый общий
// чанк, переименованный стем, другой лоадер) — результат ссылается ровно на
// то, что лежит в dist/assets этой сборки, потому что это буквально её
// собственный <head>-блок и её собственный лоадер.
//
// Страховка — не эвристика по именам, а проверка ПО ДИСКУ: после подстановки
// каждая ссылка `/assets/<файл>` в результате должна существовать в
// dist/assets. Любая отсутствующая — снапшот не используем, вызывающий код
// делает честный рендер этого пути (та же защита от инцидента 2026-09-11,
// но без ложных срабатываний на именах).

const LINK_TAG_RE = /<link\b[^>]*>/g;
// В dist/index.html атрибут голый (`data-entry-loader`), в копии с прода —
// сериализованный браузером (`data-entry-loader=""`); лоадер не содержит
// `</script>` внутри, поэтому ленивый захват до первого закрывающего тега
// корректен.
const LOADER_RE = /<script\b[^>]*\bdata-entry-loader(?:=(?:""|''))?(?:\s[^>]*)?>[\s\S]*?<\/script>/;
// Прямые <script type="module" src="/assets/…"> в снапшоте быть не должны
// (defer-entry-script.mjs выносит их в лоадер, а renderPath удаляет
// вставленные лоадером элементы перед сохранением) — но если вдруг остались,
// они бы ссылались на прошлую сборку: вычищаем, лоадер текущей сборки
// подключит всё сам.
const MODULE_SCRIPT_RE = /\s*<script\b[^>]*\btype="module"[^>]*\bsrc="\/assets\/[^"]+"[^>]*><\/script>/g;
// Любая ссылка на /assets/… в любом контексте (атрибут, JSON в лоадере,
// url() в инлайн-стилях). Захват до первого символа, который не может быть
// частью имени файла в этих контекстах; если имя захватилось «не до конца»,
// проверка по диску его не найдёт и путь уйдёт на честный рендер — ошибка в
// безопасную сторону.
const ASSET_REF_RE = /\/assets\/([^\s"'()<>`\\]+)/g;

const isBuildStylesheetLink = (tag) => /\brel="stylesheet"/.test(tag) && /\bhref="\/assets\/[^"]+"/.test(tag);
const isBuildModulePreload = (tag) => /\brel="modulepreload"/.test(tag) && /\bhref="\/assets\/[^"]+"/.test(tag);

/**
 * Достаёт из dist/index.html текущей сборки оба блока, зависящих от имён
 * ассетов. Бросает, если формат вывода сборки неожиданный — вызывающий код
 * в этом случае уходит в полный режим целиком (это системная проблема, а не
 * беда одного пути).
 * @param {string} templateHtml содержимое dist/index.html ПОСЛЕ defer-entry-script.mjs
 * @returns {{ stylesheets: string[], loader: string }}
 */
export function extractBuildBlocks(templateHtml) {
  const stylesheets = (templateHtml.match(LINK_TAG_RE) ?? []).filter(isBuildStylesheetLink);
  const loader = templateHtml.match(LOADER_RE)?.[0] ?? null;
  if (stylesheets.length === 0) {
    throw new Error('в dist/index.html нет <link rel="stylesheet" href="/assets/…"> — формат вывода Vite изменился?');
  }
  if (!loader) {
    throw new Error('в dist/index.html нет <script data-entry-loader> — defer-entry-script.mjs не отработал?');
  }
  return { stylesheets, loader };
}

/**
 * Возвращает список всех `/assets/<имя>` ссылок в HTML (без дубликатов).
 * @param {string} html
 * @returns {string[]}
 */
export function assetRefsOf(html) {
  return [...new Set([...html.matchAll(ASSET_REF_RE)].map((m) => m[1]))];
}

/**
 * Подставляет в копию с прода блоки текущей сборки и проверяет результат по
 * диску.
 * @param {string} snapshotHtml HTML страницы, скачанный с живого прода
 * @param {{ stylesheets: string[], loader: string }} blocks из extractBuildBlocks()
 * @param {(assetFileName: string) => boolean} assetExists есть ли такой файл в dist/assets
 * @returns {{ html: string, reason: null } | { html: null, reason: string }}
 *   html — готовый снапшот; reason — почему копию использовать нельзя
 *   (вызывающий код рендерит этот путь честно и учитывает причину в сводке).
 */
export function adoptBuildAssets(snapshotHtml, blocks, assetExists) {
  let replacedStylesheet = false;
  let html = snapshotHtml.replace(LINK_TAG_RE, (tag) => {
    if (isBuildStylesheetLink(tag)) {
      if (replacedStylesheet) return ''; // второй и далее — убираем, все нужные уже вставлены на месте первого
      replacedStylesheet = true;
      return blocks.stylesheets.join('\n    ');
    }
    if (isBuildModulePreload(tag)) return '';
    return tag;
  });
  if (!replacedStylesheet) return { html: null, reason: 'в копии нет <link rel="stylesheet" href="/assets/…">' };

  if (!LOADER_RE.test(html)) return { html: null, reason: 'в копии нет <script data-entry-loader>' };
  // Функция вместо строки: в лоадере есть `$`, а строковая замена трактует
  // `$&`/`$1` как спец-последовательности.
  html = html.replace(LOADER_RE, () => blocks.loader);

  html = html.replace(MODULE_SCRIPT_RE, '');

  const missing = assetRefsOf(html).filter((name) => !assetExists(name));
  if (missing.length > 0) {
    const shown = missing
      .slice(0, 3)
      .map((name) => `/assets/${name}`)
      .join(', ');
    return { html: null, reason: `ссылки на файлы, которых нет в этой сборке: ${shown}${missing.length > 3 ? ', …' : ''}` };
  }
  return { html, reason: null };
}
