// Перенацеливание ссылок на JS/CSS-бандл в снапшоте, скопированном с живого
// прода (быстрый режим scripts/prerender.mjs).
//
// Зачем (история в docs/session-journal.md, 2026-09-11 и 2026-09-12): быстрый
// режим копирует HTML живой страницы целиком, вместе с её ссылками на
// `/assets/<имя>-<hash>.js|css`. Хэш в имени пересчитывается от содержимого,
// причём КАСКАДОМ: правка одной строки в ленивом чанке админки меняет имя
// этого чанка → меняется содержимое чанков, которые на него ссылаются →
// меняются и их имена, вплоть до входного `index-*.js` (проверено локально:
// одна строка в src/pages/Suppliers.tsx переименовала ~60 файлов из ~110,
// включая index-*). В новом деплое файлов со старыми именами физически нет,
// SPA-рерайт vercel.json отдаёт на них index.html, браузер отказывается
// исполнять HTML как ES-модуль — страница остаётся статикой без приложения
// (ровно это положило прод 2026-09-11).
//
// Первый фикс просто отвергал такую копию (рендерил путь честно). Он был
// верным, но с каскадом хэшей означал «любой пуш кода = полный рендер всех
// ~285 путей» — сборки снова по 10 минут вместо минуты, включая пуши, не
// трогающие ни одной публичной страницы.
//
// Здесь — вместо отказа перенацеливание: ссылки на бандл в снапшоте
// заменяются на ссылки ТЕКУЩЕЙ сборки, взятые из свежесобранного
// dist/index.html (он же SPA-шелл). Разметка самой страницы (тексты, meta,
// JSON-LD) остаётся от прода, меняется только то, чем страница «оживает».
// Мест ровно два, оба генерирует наша же сборка:
//   1) <link rel="stylesheet" href="/assets/index-<hash>.css"> в <head>;
//   2) инлайновый <script data-entry-loader> в конце <body> — его кладёт
//      scripts/defer-entry-script.mjs, внутри списком лежат и modulepreload
//      чанков, и сам входной index-*.js.
// Если в шелле не нашлось ни того, ни другого — возвращаем null, и
// вызывающий код честно рендерит путь (безопасный дефолт, как раньше).

const STYLESHEET_TAG_RE = /<link\b[^>]*href="\/assets\/[^"]+\.css"[^>]*>/gi;
const ENTRY_LOADER_TAG_RE = /<script\b[^>]*\bdata-entry-loader\b[^>]*>[\s\S]*?<\/script>/i;
const ASSET_REF_RE = /\/assets\/[A-Za-z0-9_.-]+/g;

export function assetRefsOf(html) {
  return [...new Set(html.match(ASSET_REF_RE) ?? [])];
}

// Ссылки на /assets/..., которых нет среди файлов текущей сборки —
// именно они ломают страницу в проде (404 → SPA-рерайт → HTML вместо JS).
export function unknownAssetRefs(html, buildAssetNames) {
  return assetRefsOf(html).filter((ref) => !buildAssetNames.has(ref.slice('/assets/'.length)));
}

export function retargetAssetRefs(snapshotHtml, shellHtml) {
  const shellStylesheets = shellHtml.match(STYLESHEET_TAG_RE);
  const shellLoader = shellHtml.match(ENTRY_LOADER_TAG_RE);
  if (!shellStylesheets || !shellLoader) return null;

  let replacedStylesheet = false;
  let html = snapshotHtml.replace(STYLESHEET_TAG_RE, () => {
    if (replacedStylesheet) return ''; // второй и последующие — просто убрать, всё уже вставлено
    replacedStylesheet = true;
    return shellStylesheets.join('\n    ');
  });
  if (!replacedStylesheet) return null;

  let replacedLoader = false;
  html = html.replace(ENTRY_LOADER_TAG_RE, () => {
    replacedLoader = true;
    return shellLoader[0];
  });
  if (!replacedLoader) return null;

  return html;
}
