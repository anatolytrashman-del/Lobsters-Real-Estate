// Идентификатор «публичной части» фронта — отпечаток исходников, из которых
// собираются маркетинговые страницы (всё, что пререндерится).
//
// Зачем (владелец, 2026-09-12: «большинство правок я вношу в админку, а оно
// рендерит и все маркетинговые страницы; мне нужен быстрый рендер чисто для
// админки и полный при правках маркетинговых страниц»): быстрый режим
// scripts/prerender.mjs копирует снапшоты страниц с живого прода. Для правок
// админки/API это ровно то, что нужно — публичная разметка не поменялась. Но
// если правился код самой публичной страницы, скопированный снапшот заморозит
// СТАРЫЙ текст (боты и соцсети увидят его до следующего полного прогона).
// Отличить одно от другого по хэшам чанков нельзя: они пересчитываются
// каскадом от любой правки (см. scripts/prerender-assets.mjs).
//
// Отсюда отдельный отпечаток: сборка кладёт его в dist/public-build-id.txt,
// пререндер сравнивает свой с тем, что лежит на живом проде. Совпало —
// публичный код не менялся, копии снапшотов корректны, быстрый режим. Не
// совпало (или прод недоступен/файла ещё нет) — полный рендер.
//
// Что входит в отпечаток: граф СТАТИЧЕСКИХ импортов от src/main.tsx плюс
// index.html (SPA-шелл — его <head> попадает в каждый снапшот). Именно этот
// граф и есть публичная часть: в src/App.tsx все админ-страницы подключены
// через lazy(() => import(...)), а все публичные — обычным import (так
// сделано ради пререндера, см. комментарий в App.tsx). Поэтому динамические
// import() в App.tsx пропускаются — это и есть граница «админка против
// маркетинга»; в остальных файлах динамические импорты учитываются (внутри
// публичной страницы такой импорт — часть её же контента).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT_DIR = resolve(new URL('..', import.meta.url).pathname);
const ENTRY_FILES = ['src/main.tsx'];
// Не импортируется ниоткуда, но попадает в каждый снапшот (мета, счётчики).
const EXTRA_FILES = ['index.html'];
// Единственный файл, из которого динамические импорты НЕ считаем публичными
// (там за ними стоят админ-страницы, см. шапку).
const DYNAMIC_IMPORT_IGNORED_IN = 'src/App.tsx';

const STATIC_IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;'"\n]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '/index.ts', '/index.tsx', '/index.js'];

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // пакет из node_modules — в отпечаток не входит
  const base = resolve(dirname(fromFile), spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file, source) {
  const specs = [];
  for (const re of [STATIC_IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(source))) specs.push(m[1]);
  }
  if (relative(ROOT_DIR, file) !== DYNAMIC_IMPORT_IGNORED_IN) {
    DYNAMIC_IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = DYNAMIC_IMPORT_RE.exec(source))) specs.push(m[1]);
  }
  return specs;
}

// Список файлов публичного графа — отсортированные пути от корня репозитория.
export function collectPublicSourceFiles() {
  const seen = new Set();
  const queue = [...ENTRY_FILES, ...EXTRA_FILES].map((p) => join(ROOT_DIR, p));
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    if (/\.(html|css)$/i.test(file)) continue; // в html/css искать импорты нечего
    const source = readFileSync(file, 'utf8');
    for (const spec of importsOf(file, source)) {
      const resolved = resolveImport(file, spec);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return [...seen].map((f) => relative(ROOT_DIR, f)).sort();
}

export function computePublicBuildId() {
  const files = collectPublicSourceFiles();
  const hash = createHash('sha256');
  for (const rel of files) {
    hash.update(rel);
    hash.update('\0');
    hash.update(createHash('sha256').update(readFileSync(join(ROOT_DIR, rel))).digest('hex'));
    hash.update('\n');
  }
  return { id: hash.digest('hex').slice(0, 32), files };
}

// Прямой запуск (шаг сборки в package.json) — положить отпечаток в dist,
// откуда Vercel отдаст его статикой по /public-build-id.txt.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const { writeFileSync } = await import('node:fs');
  const { id, files } = computePublicBuildId();
  writeFileSync(join(ROOT_DIR, 'dist', 'public-build-id.txt'), `${id}\n`);
  console.log(`[public-build-id] ${id} (файлов в публичном графе: ${files.length}) → dist/public-build-id.txt`);
}
