// Разовый (и повторно запускаемый — см. манифест ниже) прогон TinyPNG по
// картинкам, закоммиченным прямо в репозиторий (public/images/**) — в
// отличие от картинок, загружаемых через формы админки (те сжимаются
// автоматически при загрузке, см. api/tinypng-compress.js), эти файлы
// попадают на сайт через обычный git-коммит, поэтому сжимаются отдельным
// разовым прогоном, не через очередь image_compressions в Supabase.
//
// Владелец, 2026-09-06: "в первую очередь сожми лендинг комплекса one,
// страницу про Минск Мир и бизнес-центры, а потом всё остальное" — лендинг
// "one" сам по себе использует динамические фото объекта из Supabase Storage
// (уже покрыты общим пайплайном), а вот логотипы/фото на странице гида
// района (public/images/district) и все карточки бизнес-центров
// (public/images/business-centers[-hero]) — статика, для них и этот скрипт.
//
// Порядок папок ниже — ровно это: district → business-centers-hero →
// business-centers → всё остальное под public/images (сейчас больше папок
// нет, задел на будущее).
//
// Манифест (scripts/data/tinypng-static-manifest.json) хранит sha256 уже
// сжатого файла на момент сжатия — повторный запуск пропускает файл, если
// его содержимое с тех пор не поменялось (не жжёт квоту заново на то же
// самое), и сжимает заново, если файл заменили новым (хэш другой).
//
// Останавливается на первом же TinifyQuotaExceededError (месячный лимит
// TinyPNG исчерпан, см. api/_tinypng.js) — уже обработанные файлы остаются
// сжатыми, необработанные ждут следующего запуска (владелец: "если вышли
// за лимит — делай очередь и прогоняй в новый месяц" — для статики это тот
// же принцип, только в роли "очереди" выступает сам факт, что файл ещё не
// попал в манифест, а не отдельная таблица).

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from 'node:fs/promises';
import { shrinkBuffer, tinifyKeyProblem, TinifyQuotaExceededError, TINIFY_SUPPORTED_CONTENT_TYPES } from '../api/_tinypng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'public', 'images');
const MANIFEST_PATH = path.join(ROOT, 'scripts', 'data', 'tinypng-static-manifest.json');
const DRY_RUN = process.argv.includes('--dry-run');

// Порядок обхода — приоритет владельца (см. комментарий выше). Любая папка
// public/images, не названная явно здесь, идёт последней ("всё остальное").
const PRIORITY_DIRS = ['district', 'business-centers-hero', 'business-centers'];

const CONTENT_TYPE_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveManifest(manifest) {
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function listImageFiles() {
  const all = [];
  for await (const entry of glob('**/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', { cwd: IMAGES_DIR })) {
    all.push(entry);
  }
  const priorityIndex = (rel) => {
    const idx = PRIORITY_DIRS.findIndex((dir) => rel.startsWith(dir + path.sep) || rel.startsWith(dir + '/'));
    return idx === -1 ? PRIORITY_DIRS.length : idx;
  };
  return all.sort((a, b) => priorityIndex(a) - priorityIndex(b) || a.localeCompare(b));
}

async function main() {
  const keyProblem = tinifyKeyProblem();
  if (keyProblem && !DRY_RUN) {
    console.error(keyProblem);
    process.exit(1);
  }

  const files = await listImageFiles();
  const manifest = await loadManifest();

  let toProcess = 0;
  for (const rel of files) {
    const full = path.join(IMAGES_DIR, rel);
    const buffer = await readFile(full);
    const hash = sha256(buffer);
    if (manifest[rel] === hash) continue; // уже сжато этим же содержимым
    toProcess++;
  }
  console.log(`Всего картинок: ${files.length}, к сжатию: ${toProcess}`);
  if (DRY_RUN) {
    console.log('[dry-run] Дальше не иду — ключ TinyPNG не тратится');
    return;
  }

  let processed = 0;
  let totalOriginal = 0;
  let totalCompressed = 0;
  for (const rel of files) {
    const full = path.join(IMAGES_DIR, rel);
    const buffer = await readFile(full);
    const hash = sha256(buffer);
    if (manifest[rel] === hash) continue;

    const ext = path.extname(rel).toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext];
    if (!contentType || !TINIFY_SUPPORTED_CONTENT_TYPES.has(contentType)) {
      console.log(`  ${rel} — пропущено (неподдерживаемый формат)`);
      continue;
    }

    try {
      const result = await shrinkBuffer(buffer);
      await writeFile(full, result.buffer);
      const newHash = sha256(result.buffer);
      manifest[rel] = newHash;
      await saveManifest(manifest); // сохраняем после каждого файла — прогон можно прервать без потери прогресса
      totalOriginal += result.originalSize;
      totalCompressed += result.compressedSize;
      processed++;
      const saved = result.originalSize > 0 ? Math.round((1 - result.compressedSize / result.originalSize) * 100) : 0;
      console.log(`  ${rel} — ${result.originalSize} → ${result.compressedSize} байт (−${saved}%)`);
    } catch (err) {
      if (err instanceof TinifyQuotaExceededError) {
        console.log(`Месячный лимит TinyPNG исчерпан — сжато ${processed} из ${toProcess}, остальное дождётся следующего запуска`);
        return;
      }
      console.error(`  ${rel} — ошибка: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`Готово: сжато ${processed} из ${toProcess}. Суммарно ${totalOriginal} → ${totalCompressed} байт.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
