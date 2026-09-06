// Разовый бэкафилл: ставит в очередь image_compressions ВСЕ уже
// существующие картинки в бакетах Storage, загруженные ДО того, как
// заработал api/tinypng-compress.js (тот сжимает только новые загрузки).
// Владелец: "прогнать через него все изображения, что на платформе" — это
// и есть тот прогон, дальше новые загрузки попадают в очередь сами.
//
// Приоритет владельца (2026-09-06): "в первую очередь сожми лендинг
// комплекса one... а потом всё остальное" — фото объекта "one" (по его
// landing_slug) вставляются в очередь ПЕРВЫМИ (более ранний created_at,
// т.к. process-image-compression-queue.mjs обрабатывает по возрастанию
// даты), весь остальной бэклог — следом.
//
// Идемпотентно: INSERT ... ON CONFLICT (bucket, path) DO NOTHING — повторный
// запуск не дублирует и не трогает уже поставленные в очередь/обработанные
// строки.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const PRIORITY_LANDING_SLUG = 'one';

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Те же бакеты, что в api/tinypng-compress.js (IMAGE_BUCKETS) — держать в
// синхроне, если список там поменяется.
const IMAGE_BUCKETS = [
  'object-photos',
  'building-plans',
  'financing-logos',
  'design-project-photos',
  'lead-photos',
  'pledge-photos',
  'contractor-photos',
  'object-documents',
];

function pathFromPublicUrl(url, bucket) {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx === -1 ? null : url.slice(idx + marker.length);
}

// Список всех объектов в бакете постранично (Storage API отдаёт максимум
// 1000 за раз по умолчанию, но постранично на случай будущего роста).
async function listAllPaths(bucket) {
  const paths = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list('', { limit, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const item of data) {
      // Папки (id === null) пропускаем — все аплоадеры кладут файлы плоско
      // в корень бакета (см. `${crypto.randomUUID()}.${ext}`), но на всякий
      // случай не считаем их файлами.
      if (item.id) paths.push(item.name);
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return paths;
}

async function insertPendingRows(rows) {
  if (rows.length === 0) return 0;
  const { data, error } = await supabase
    .from('image_compressions')
    .upsert(
      rows.map((r) => ({ ...r, status: 'pending' })),
      { onConflict: 'bucket,path', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

async function priorityRows() {
  const { data: object, error } = await supabase
    .from('objects')
    .select('photo_urls')
    .eq('landing_slug', PRIORITY_LANDING_SLUG)
    .maybeSingle();
  if (error) {
    console.warn(`Не удалось найти объект по landing_slug="${PRIORITY_LANDING_SLUG}": ${error.message}`);
    return [];
  }
  if (!object?.photo_urls) return [];
  const rows = [];
  for (const url of object.photo_urls) {
    const path = pathFromPublicUrl(url, 'object-photos');
    if (path) rows.push({ bucket: 'object-photos', path });
  }
  return rows;
}

async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] Собрал бы список файлов во всех бакетах и добавил недостающие в image_compressions как pending');
    return;
  }

  const priority = await priorityRows();
  const insertedPriority = await insertPendingRows(priority);
  console.log(`Приоритет (объект "${PRIORITY_LANDING_SLUG}"): найдено ${priority.length} фото, добавлено в очередь ${insertedPriority}`);

  // Небольшая пауза, чтобы приоритетные строки гарантированно получили более
  // ранний created_at, чем всё остальное (упорядочивание по created_at в
  // process-image-compression-queue.mjs).
  await new Promise((r) => setTimeout(r, 1000));

  let totalFound = 0;
  let totalInserted = 0;
  for (const bucket of IMAGE_BUCKETS) {
    const paths = await listAllPaths(bucket);
    const rows = paths.map((path) => ({ bucket, path }));
    const inserted = await insertPendingRows(rows);
    console.log(`${bucket}: найдено ${paths.length}, добавлено в очередь ${inserted}`);
    totalFound += paths.length;
    totalInserted += inserted;
  }
  console.log(`Итого: найдено ${totalFound} файлов, добавлено в очередь ${totalInserted} новых (остальные уже были в очереди/обработаны)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
