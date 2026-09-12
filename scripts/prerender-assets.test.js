import { describe, expect, it } from 'vitest';
import { assetRefsOf, retargetAssetRefs, unknownAssetRefs } from './prerender-assets.mjs';

// Снапшот страницы, снятый с прода ПРОШЛОЙ сборкой: свои хэши и в css, и в
// инлайновом лоадере (его кладёт scripts/defer-entry-script.mjs).
const oldSnapshot = `<!doctype html>
<html lang="ru"><head>
<title>Офисы в Минске</title>
<link rel="stylesheet" crossorigin="" href="/assets/index-OLDCSS11.css">
</head><body><div id="root"><h1>Бизнес-центры Минска</h1></div>
<script data-entry-loader>(function(){["/assets/react-OLD11111.js","/assets/cn-OLD22222.js"].forEach(function(h){});["/assets/index-OLD33333.js"].forEach(function(s){});})();</script>
</body></html>`;

// Свежесобранный dist/index.html той же сборки, что сейчас деплоится.
const newShell = `<!doctype html>
<html lang="ru"><head>
<title>SPA-шелл</title>
<link rel="stylesheet" crossorigin href="/assets/index-NEWCSS99.css">
</head><body><div id="root"></div>
<script data-entry-loader>(function(){["/assets/react-NEW11111.js","/assets/cn-NEW22222.js"].forEach(function(h){});["/assets/index-NEW33333.js"].forEach(function(s){});})();</script>
</body></html>`;

const newBuildAssets = new Set([
  'index-NEWCSS99.css',
  'react-NEW11111.js',
  'cn-NEW22222.js',
  'index-NEW33333.js',
]);

describe('retargetAssetRefs', () => {
  it('переносит ссылки на бандл текущей сборки, сохраняя разметку страницы', () => {
    const out = retargetAssetRefs(oldSnapshot, newShell);
    expect(out).not.toBeNull();
    expect(out).toContain('<h1>Бизнес-центры Минска</h1>');
    expect(out).toContain('<title>Офисы в Минске</title>');
    expect(out).toContain('/assets/index-NEWCSS99.css');
    expect(out).toContain('/assets/index-NEW33333.js');
    expect(out).not.toContain('OLD');
    // Главное свойство: ни одной ссылки на файл, которого нет в этой сборке —
    // ровно на них прод и лёг 2026-09-11.
    expect(unknownAssetRefs(out, newBuildAssets)).toEqual([]);
  });

  it('находит ссылки на чанки чужой сборки до перенацеливания', () => {
    expect(assetRefsOf(oldSnapshot)).toContain('/assets/index-OLD33333.js');
    expect(unknownAssetRefs(oldSnapshot, newBuildAssets)).toHaveLength(4);
  });

  it('возвращает null, если в снапшоте нет наших мест подстановки (тогда путь рендерится честно)', () => {
    expect(retargetAssetRefs('<html><body><h1>без бандла</h1></body></html>', newShell)).toBeNull();
    expect(retargetAssetRefs(oldSnapshot, '<html><head></head><body></body></html>')).toBeNull();
  });

  it('снапшот с несколькими css-ссылками не размножает теги шелла', () => {
    const twoCss = oldSnapshot.replace(
      '<link rel="stylesheet" crossorigin="" href="/assets/index-OLDCSS11.css">',
      '<link rel="stylesheet" href="/assets/index-OLDCSS11.css"><link rel="stylesheet" href="/assets/extra-OLDCSS22.css">',
    );
    const out = retargetAssetRefs(twoCss, newShell);
    expect(out.match(/index-NEWCSS99\.css/g)).toHaveLength(1);
    expect(unknownAssetRefs(out, newBuildAssets)).toEqual([]);
  });
});
