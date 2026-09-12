#!/usr/bin/env node
// Шаг 2б: записать результаты классификации в supplier_site_snapshots.
//
//   node scripts/supply-categories/import.mjs [--out=DIR] [--dry]
//
// Читает все out/result-*.json — массивы вида
//   [{ "host": "albes.ru", "categories": ["Подвесные потолки"], "note": "..." }]
// Группы сверяются со справочником src/data/supplyCategories.ts: незнакомые
// в базу не пишутся, а печатаются списком (это кандидаты на добавление в
// справочник; после правки — переклассифицировать через export --all).
// Пустой массив categories — тоже результат (сайт ни о чём), строка
// помечается classified_at, чтобы не выгружаться снова.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = 'iohcdylttyuhwovztrbk';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN не задан');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const outDir = args.out ?? path.join(process.cwd(), 'scripts/supply-categories/out');
const dry = !!args.dry;

// Справочник — прямо из TS-файла (регулярка по полю name, без сборки).
const dictSource = fs.readFileSync(path.join(process.cwd(), 'src/data/supplyCategories.ts'), 'utf8');
const known = new Set([...dictSource.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]));
if (known.size === 0) throw new Error('справочник src/data/supplyCategories.ts не прочитался');

// Названия, которые классификаторы устойчиво выдумывают вместо справочных.
// Держим здесь, а не расширяем справочник: это те же группы под другим
// именем, а не новые (в отличие от «Гидроизоляции», которая стала своей
// группой — см. supplyCategories.ts).
const ALIASES = new Map([
  ['Строительный инструмент', 'Инструмент и оборудование'],
  ['Инструменты', 'Инструмент и оборудование'],
  ['Мебель для ванной', 'Сантехническое оборудование'],
  ['Сантехника', 'Сантехническое оборудование'],
  ['Керамическая плитка', 'Плитка керамическая'],
  ['Лакокрасочные материалы', 'Краски и ЛКМ'],
  ['Краски и лаки', 'Краски и ЛКМ'],
  ['Сухие смеси', 'Сухие строительные смеси'],
  ['Освещение', 'Светильники и освещение'],
  ['Крепёж', 'Крепёж и метизы'],
  ['Крепеж и метизы', 'Крепёж и метизы'],
  ['Метизы и крепеж', 'Крепёж и метизы'],
  ['Метизы и крепёж', 'Крепёж и метизы'],
]);

const results = new Map();
const unknown = new Map();
for (const f of fs.readdirSync(outDir).filter((f) => /^result-.*\.json$/.test(f)).sort()) {
  const parsed = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const host = String(item?.host ?? '').trim().toLowerCase();
    if (!host) continue;
    const categories = [];
    for (const raw of Array.isArray(item.categories) ? item.categories : []) {
      const trimmed = String(raw).trim();
      if (!trimmed) continue;
      const c = ALIASES.get(trimmed) ?? trimmed;
      if (known.has(c)) {
        if (!categories.includes(c)) categories.push(c);
      } else {
        unknown.set(c, (unknown.get(c) ?? 0) + 1);
      }
    }
    results.set(host, { categories, note: String(item.note ?? '').trim().slice(0, 300) });
  }
}

if (unknown.size) {
  console.log('Не из справочника (в базу НЕ записаны):');
  for (const [c, n] of [...unknown].sort((a, b) => b[1] - a[1])) console.log(`  ${n}× ${c}`);
}
console.log(`доменов к записи: ${results.size}${dry ? ' (dry run)' : ''}`);
if (dry || results.size === 0) process.exit(0);

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const values = [...results]
  .map(([host, r]) => `(${lit(host)}, array[${r.categories.map(lit).join(', ')}]::text[], ${lit(r.note)})`)
  .join(',\n');
const sql = `
  update supplier_site_snapshots s
  set categories = v.categories, categories_note = v.note, classified_at = now()
  from (values ${values}) as v(host, categories, note)
  where s.host = v.host
  returning s.host
`;
const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
if (!resp.ok) throw new Error(`Management API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
const updated = await resp.json();
console.log(`записано: ${Array.isArray(updated) ? updated.length : '?'}`);
