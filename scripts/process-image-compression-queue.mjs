// Месячный докат очереди сжатия картинок (см. .github/workflows/
// process-image-compression-queue.yml) — владелец: "лимит 500 картинок в
// месяц, поэтому просто сжимаем все картинки по умолчанию, а если вышли
// за лимит — делай очередь и прогоняй в новый месяц".
//
// api/tinypng-compress.js сжимает картинку сразу после загрузки; если
// TinyPNG в этот момент уже отдал 429 (месячный лимит исчерпан), строка в
// image_compressions остаётся status='pending' — этот скрипт запускается
// раз в месяц (после того как лимит на новый месяц обнулился) и дотягивает
// всё, что накопилось. Останавливается сам, как только TinyPNG снова отдаст
// 429 (например, если за месяц накопилось больше 500 картинок) — остаток
// останется pending до следующего месячного запуска, ничего вручную делать
// не нужно.
//
// Логика сжатия — общая с api/tinypng-compress.js (см. api/_tinypng.js,
// обычный ESM-модуль без Vercel-специфики, импортируется тем же путём, что
// и остальной код проекта).

import { createClient } from '@supabase/supabase-js';
import { shrinkBuffer, tinifyKeyProblem, TinifyQuotaExceededError, TINIFY_SUPPORTED_CONTENT_TYPES } from '../api/_tinypng.js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}
const keyProblem = tinifyKeyProblem();
if (keyProblem && !DRY_RUN) {
  console.error(keyProblem);
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function fetchPendingRows() {
  const { data, error } = await supabase
    .from('image_compressions')
    .select('id, bucket, path')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function processRow(row) {
  const { data: fileBlob, error: downloadError } = await supabase.storage.from(row.bucket).download(row.path);
  if (downloadError) {
    await supabase
      .from('image_compressions')
      .update({ status: 'failed', error: downloadError.message, processed_at: new Date().toISOString() })
      .eq('id', row.id);
    console.log(`  ${row.bucket}/${row.path} — не удалось скачать: ${downloadError.message}`);
    return;
  }

  const contentType = fileBlob.type || 'application/octet-stream';
  if (!TINIFY_SUPPORTED_CONTENT_TYPES.has(contentType)) {
    await supabase
      .from('image_compressions')
      .update({ status: 'skipped', error: `content-type не поддерживается: ${contentType}`, processed_at: new Date().toISOString() })
      .eq('id', row.id);
    console.log(`  ${row.bucket}/${row.path} — пропущено (${contentType})`);
    return;
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const result = await shrinkBuffer(buffer);

  const { error: uploadError } = await supabase.storage
    .from(row.bucket)
    .upload(row.path, result.buffer, { upsert: true, contentType });
  if (uploadError) throw uploadError;

  await supabase
    .from('image_compressions')
    .update({
      status: 'done',
      original_size: result.originalSize,
      compressed_size: result.compressedSize,
      processed_at: new Date().toISOString(),
    })
    .eq('id', row.id);
  console.log(`  ${row.bucket}/${row.path} — сжато: ${result.originalSize} → ${result.compressedSize} байт`);
}

async function main() {
  if (DRY_RUN) {
    console.log('[dry-run] Прочитал бы pending-строки image_compressions и сжал каждую через TinyPNG');
    return;
  }

  const rows = await fetchPendingRows();
  console.log(`В очереди: ${rows.length}`);
  let processed = 0;
  for (const row of rows) {
    try {
      await processRow(row);
      processed++;
    } catch (err) {
      if (err instanceof TinifyQuotaExceededError) {
        console.log(`Месячный лимит TinyPNG снова исчерпан — обработано ${processed} из ${rows.length}, остальное ждёт следующего месяца`);
        return;
      }
      console.error(`  ${row.bucket}/${row.path} — ошибка: ${err instanceof Error ? err.message : err}`);
      await supabase
        .from('image_compressions')
        .update({ status: 'failed', error: err instanceof Error ? err.message : String(err), processed_at: new Date().toISOString() })
        .eq('id', row.id);
    }
  }
  console.log(`Готово: обработано ${processed} из ${rows.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
