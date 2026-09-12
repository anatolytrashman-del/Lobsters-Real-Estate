import { describe, expect, it } from 'vitest';
import { adoptBuildAssets, assetRefsOf, extractBuildBlocks } from './prerender-snapshot.mjs';

// Формы HTML взяты с реального прода и реального dist/index.html
// (2026-09-12): в копии с прода атрибуты сериализованы браузером
// (`crossorigin=""`, `data-entry-loader=""`), в хэшах чанков встречаются
// дефисы — ровно тот случай, на котором сломалось перенацеливание по стему
// и сборка ушла в 10 минут.

const loaderOf = (entry, preloads) =>
  `<script data-entry-loader>(function(){var done=false;function inject(){${JSON.stringify(preloads)}.forEach(function(href){var l=document.createElement('link');l.rel='modulepreload';l.href=href;l.setAttribute('data-entry-injected','');document.head.appendChild(l);});${JSON.stringify([entry])}.forEach(function(src){var s=document.createElement('script');s.type='module';s.src=src;s.setAttribute('data-entry-injected','');document.body.appendChild(s);});}var $x='$&';setTimeout(inject,3500);})();</script>`;

const NEW_ENTRY = '/assets/index-9zN-b8-n.js';
const NEW_PRELOADS = ['/assets/react-BatatxyT.js', '/assets/chevron-up-vBYbzeS-.js', '/assets/badgeColor-DYi-Cv2y.js'];
const NEW_CSS = '/assets/index-vmqKJlxP.css';
const NEW_FILES = new Set([NEW_ENTRY, ...NEW_PRELOADS, NEW_CSS].map((p) => p.slice('/assets/'.length)));
const assetExists = (name) => NEW_FILES.has(name);

const template = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="preload" as="font" type="font/woff2" href="/fonts/Montserrat-Regular.woff2" crossorigin>
    <link rel="stylesheet" crossorigin href="${NEW_CSS}">
  </head>
  <body>
    <div id="root"></div>
    ${loaderOf(NEW_ENTRY, NEW_PRELOADS)}
  </body>
</html>`;

const OLD_ENTRY = '/assets/index-BDEH5jS3.js';
const OLD_PRELOADS = ['/assets/react-BatatxyT.js', '/assets/chevron-up-Cq1x2Yz-.js', '/assets/badgeColor-Dold1234.js'];
const OLD_CSS = '/assets/index-Cold9876.css';

const snapshot = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><link rel="icon" href="/favicon.ico" sizes="any"><link rel="preload" as="font" type="font/woff2" href="/fonts/Montserrat-Regular.woff2" crossorigin=""><link rel="stylesheet" crossorigin="" href="${OLD_CSS}"><title>БЦ А-100 — аренда офисов</title><meta property="og:image" content="https://redevelopment.pro/og/minsk-bcminsk-a-100.png"></head><body><div id="root"><h1>Бизнес-центр А-100</h1><p>Цена $12/м²</p></div>${loaderOf(OLD_ENTRY, OLD_PRELOADS).replace('<script data-entry-loader>', '<script data-entry-loader="">')}</body></html>`;

describe('extractBuildBlocks', () => {
  it('достаёт stylesheet-ссылку и лоадер из dist/index.html', () => {
    const blocks = extractBuildBlocks(template);
    expect(blocks.stylesheets).toEqual([`<link rel="stylesheet" crossorigin href="${NEW_CSS}">`]);
    expect(blocks.loader.startsWith('<script data-entry-loader>')).toBe(true);
    expect(blocks.loader.endsWith('</script>')).toBe(true);
    expect(blocks.loader).toContain(NEW_ENTRY);
  });

  it('падает, если сборка не оставила лоадера или stylesheet — это системная проблема, а не одного пути', () => {
    expect(() => extractBuildBlocks(template.replace(/<script data-entry-loader>[\s\S]*?<\/script>/, ''))).toThrow(/data-entry-loader/);
    expect(() => extractBuildBlocks(template.replace(/<link rel="stylesheet"[^>]*>/, ''))).toThrow(/stylesheet/);
  });
});

describe('adoptBuildAssets', () => {
  const blocks = extractBuildBlocks(template);

  it('подменяет оба блока на текущие, разметку и meta не трогает (случай с дефисами в хэшах, 2026-09-12)', () => {
    const { html, reason } = adoptBuildAssets(snapshot, blocks, assetExists);
    expect(reason).toBeNull();
    expect(html).toContain('<h1>Бизнес-центр А-100</h1>');
    expect(html).toContain('<title>БЦ А-100 — аренда офисов</title>');
    expect(html).toContain('og/minsk-bcminsk-a-100.png');
    expect(html).toContain(`<link rel="stylesheet" crossorigin href="${NEW_CSS}">`);
    expect(html).toContain(NEW_ENTRY);
    for (const p of NEW_PRELOADS) expect(html).toContain(p);
    // ни одной ссылки на прошлую сборку
    expect(html).not.toContain(OLD_CSS);
    expect(html).not.toContain(OLD_ENTRY);
    expect(html).not.toContain('index-BDEH5jS3');
    expect(html).not.toContain('Cq1x2Yz-');
    // `$&` внутри лоадера не раскрылся в «всё совпадение» строковой замены
    expect(html).toContain("var $x='$&'");
    // ровно один лоадер и одна stylesheet-ссылка
    expect(html.match(/data-entry-loader/g)).toHaveLength(1);
    expect(html.match(/rel="stylesheet"/g)).toHaveLength(1);
    // все ссылки на ассеты — только существующие файлы этой сборки
    expect(assetRefsOf(html).every(assetExists)).toBe(true);
  });

  it('состав чанков в лоадере не сопоставляется по именам — новый/переименованный чанк не мешает', () => {
    const extraBlocks = extractBuildBlocks(template.replace(JSON.stringify(NEW_PRELOADS), JSON.stringify([...NEW_PRELOADS, '/assets/newShared-Zz9-_-aa.js'])));
    const exists = (name) => assetExists(name) || name === 'newShared-Zz9-_-aa.js';
    const { html, reason } = adoptBuildAssets(snapshot, extraBlocks, exists);
    expect(reason).toBeNull();
    expect(html).toContain('/assets/newShared-Zz9-_-aa.js');
  });

  it('вычищает остатки прямых modulepreload/script type=module, если они вдруг попали в копию', () => {
    const dirty = snapshot
      .replace('<title>', `<link rel="modulepreload" crossorigin="" href="/assets/stale-Abc12345.js"><title>`)
      .replace('</body>', `<script type="module" crossorigin="" src="/assets/index-BDEH5jS3.js"></script></body>`);
    const { html, reason } = adoptBuildAssets(dirty, blocks, assetExists);
    expect(reason).toBeNull();
    expect(html).not.toContain('stale-Abc12345');
    expect(html).not.toContain('type="module"');
  });

  it('отказывается от копии, если после подстановки остались ссылки на отсутствующие файлы', () => {
    const withImage = snapshot.replace('<p>Цена', '<img src="/assets/plan-Old0000.png"><p>Цена');
    const { html, reason } = adoptBuildAssets(withImage, blocks, assetExists);
    expect(html).toBeNull();
    expect(reason).toContain('/assets/plan-Old0000.png');
  });

  it('отказывается от копии без лоадера или без stylesheet (голый шелл/чужая разметка)', () => {
    const noLoader = snapshot.replace(/<script data-entry-loader=""[\s\S]*?<\/script>/, '');
    expect(adoptBuildAssets(noLoader, blocks, assetExists).reason).toMatch(/data-entry-loader/);
    const noCss = snapshot.replace(/<link rel="stylesheet"[^>]*>/, '');
    expect(adoptBuildAssets(noCss, blocks, assetExists).reason).toMatch(/stylesheet/);
  });
});

describe('assetRefsOf', () => {
  it('находит ссылки в атрибутах, JSON лоадера и url() и не дублирует их', () => {
    const html = `<link href="/assets/a-1.css"><style>.x{background:url(/assets/bg-Q_w-2.png)}</style><script>["/assets/a-1.css","/assets/b-Zz-9.js"]</script>`;
    expect(assetRefsOf(html).sort()).toEqual(['a-1.css', 'b-Zz-9.js', 'bg-Q_w-2.png']);
  });
});
