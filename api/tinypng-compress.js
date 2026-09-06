// Vercel serverless function: фоновое сжатие только что загруженной картинки
// через TinyPNG. Клиент вызывает это сразу после успешной загрузки файла в
// Supabase Storage (см. src/lib/tinypngCompress.ts), не дожидаясь ответа —
// сжатие best-effort, оптимизация поверх уже успешного аплоада, не должно
// ронять/тормозить форму. Владелец: "по умолчанию сжимать все картинки,
// загруженные на платформу... лимит 500 в месяц, сверх лимита — очередь на
// следующий месяц".
//
// НЕ требует сессию сотрудника (в отличие от большинства api/*.js) — часть
// загрузок картинок идёт с публичных страниц без входа (например счета/КП
// в object-documents через /estimate/:token, см. EstimateMaterialsPanel).
// Вместо авторизации — узкая защита от произвольного bucket/path:
//   1) bucket — только из фиксированного списка бакетов с картинками;
//   2) path — строго вида "<uuid>.<ext>", как ГЕНЕРИРУЮТ все аплоадеры
//      в src/lib/*Api.ts (crypto.randomUUID() + расширение, без участия
//      пользовательского ввода) — угадать чужой путь физически нереально;
//   3) идемпотентность через уникальный (bucket, path) в image_compressions:
//      один и тот же объект компрессируется не больше одного раза, повторный
//      вызов (двойной клик, ретрай) не жжёт квоту повторно.
//
// Таблица image_compressions — только service_role (RLS без единой policy,
// тот же принцип, что у deploy_debounce, см. trigger-rebuild.js).

import { shrinkBuffer, tinifyKeyProblem, TinifyQuotaExceededError, TINIFY_SUPPORTED_CONTENT_TYPES } from './_tinypng.js';

// Бакеты, где реально лежат картинки (не PDF/аудио/резюме) — см. журнал
// CLAUDE.md, "Паттерн работы с данными". object-documents — смешанный
// (счета/КП/снепшоты вперемешку с PDF), поэтому пропускаем через проверку
// content-type ниже, а не заранее исключаем.
const IMAGE_BUCKETS = new Set([
  'object-photos',
  'building-plans',
  'financing-logos',
  'design-project-photos',
  'lead-photos',
  'pledge-photos',
  'contractor-photos',
  'object-documents',
]);

// Ровно тот путь, который строят все uploadX-функции: `${crypto.randomUUID()}.${ext}`.
const PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-zA-Z0-9]+$/;

function restHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function downloadFromStorage(bucket, path) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: restHeaders(),
  });
  if (!resp.ok) throw new Error(`Не удалось скачать файл из хранилища (${resp.status})`);
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType };
}

async function overwriteInStorage(bucket, path, buffer, contentType) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: restHeaders({ 'Content-Type': contentType, 'x-upsert': 'true' }),
    body: buffer,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Не удалось перезаписать сжатый файл (${resp.status}): ${text.slice(0, 300)}`);
  }
}

// Пытается "застолбить" (bucket, path) новой строкой pending — если такая
// уже есть (любой статус), запрос вернёт пустой массив (ON CONFLICT DO
// NOTHING) — это и есть идемпотентность: тот же объект второй раз не
// обрабатывается.
async function claimRow(bucket, path) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/image_compressions?on_conflict=bucket,path`, {
    method: 'POST',
    headers: restHeaders({
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    }),
    body: JSON.stringify({ bucket, path, status: 'pending' }),
  });
  if (!resp.ok) throw new Error(`Не удалось обратиться к очереди сжатия (${resp.status})`);
  const rows = await resp.json();
  return rows[0] ?? null;
}

async function updateRow(id, patch) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/image_compressions?id=eq.${id}`, {
    method: 'PATCH',
    headers: restHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...patch, processed_at: new Date().toISOString() }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { bucket, path } = req.body ?? {};
  if (typeof bucket !== 'string' || !IMAGE_BUCKETS.has(bucket) || typeof path !== 'string' || !PATH_RE.test(path)) {
    // Best-effort: молчаливый пропуск, не 400 — вызывающий код не проверяет
    // ответ (fire-and-forget), незачем поднимать шум клиенту.
    res.status(200).json({ skipped: true, reason: 'bad bucket/path' });
    return;
  }

  const keyProblem = tinifyKeyProblem();
  if (keyProblem) {
    res.status(200).json({ skipped: true, reason: keyProblem });
    return;
  }

  let claimed;
  try {
    claimed = await claimRow(bucket, path);
  } catch (err) {
    res.status(200).json({ skipped: true, reason: err instanceof Error ? err.message : 'claim failed' });
    return;
  }
  if (!claimed) {
    // Уже обработан (или уже в очереди) раньше — не трогаем повторно.
    res.status(200).json({ alreadyProcessed: true });
    return;
  }

  try {
    const { buffer, contentType } = await downloadFromStorage(bucket, path);

    if (!TINIFY_SUPPORTED_CONTENT_TYPES.has(contentType)) {
      await updateRow(claimed.id, { status: 'skipped', error: `content-type не поддерживается: ${contentType}` });
      res.status(200).json({ skipped: true, reason: 'unsupported content-type' });
      return;
    }

    const result = await shrinkBuffer(buffer);
    await overwriteInStorage(bucket, path, result.buffer, contentType);
    await updateRow(claimed.id, {
      status: 'done',
      original_size: result.originalSize,
      compressed_size: result.compressedSize,
    });
    res.status(200).json({ done: true, originalSize: result.originalSize, compressedSize: result.compressedSize });
  } catch (err) {
    if (err instanceof TinifyQuotaExceededError) {
      // Строка остаётся status='pending' (мы её и завели такой) — заберёт
      // месячный докат очереди (scripts/process-image-compression-queue.mjs).
      res.status(200).json({ queued: true });
      return;
    }
    await updateRow(claimed.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    res.status(200).json({ failed: true, error: err instanceof Error ? err.message : String(err) });
  }
}
