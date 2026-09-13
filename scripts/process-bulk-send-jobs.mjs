// Фоновая отправка массовой рассылки поставщикам — владелец, 2026-09-09:
// "можем сделать отправку фоновым процессом, чтобы вкладку можно было
// закрыть?" — раньше BulkSendModal (src/components/suppliers/BulkSendModal.tsx)
// сам гонял цикл отправки прямо в браузере с паузами 25-35с между письмами
// (античтобы не выглядело как массовая рассылка) — закрыл вкладку, рассылка
// обрывается на середине. Теперь клиент только СТАВИТ задание в очередь
// (bulk_send_jobs + bulk_send_job_items), а фоновый воркер реально шлёт
// письма с тем же темпом.
//
// ЖИВОЙ воркер с 2026-09-11 — не этот файл, а Edge Function
// supabase/functions/process-bulk-send-jobs (pg_cron раз в минуту, см.
// CLAUDE.md). Здесь — ручной запасной путь на случай, если Edge Function
// недоступна: .github/workflows/process-bulk-send-jobs.yml, только
// workflow_dispatch, без расписания. Запускать его "чтобы побыстрее"
// не нужно: очередь и так разбирается раз в минуту.
//
// Оба пути могут работать одновременно и не задваивают письма только за
// счёт атомарного захвата строки задания (см. processItem) — до 2026-09-12
// захвата здесь не было, и параллельный ручной запуск разослал по два
// одинаковых письма 38 поставщикам. Любая правка порядка "захват → проверка
// → отправка" должна делаться в обоих файлах сразу.
//
// Логика отправки одного письма (адрес-плюс из short_code, сборка HTML,
// вызов Resend, запись строки supplier_offer_emails, заливка вложений в
// Storage) сознательно ПРОДУБЛИРОВАНА из api/purchase-send-email.js —
// тот эндпоинт требует сессию сотрудника (requireStaffAuth) и вызывается
// через authFetch с токеном браузера, у крон-скрипта такого токена нет и
// быть не должно (SUPABASE_SERVICE_ROLE_KEY — эквивалент прав, но идёт в
// обход RLS напрямую, не через HTTP-эндпоинт).
//
// Подстановка плейсхолдеров {компания}/{запрос}/{материалы}/{контакт} —
// продублирована из src/lib/emailTemplates.ts (та же логика, чистая
// строковая подстановка, тут её нельзя импортировать напрямую — TS-модуль).

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const RESEND_FROM_NAME = 'Анатолий Трэшмен';
const ATTACHMENTS_BUCKET = 'object-documents';

// Копия письма с ведомостью владельцу — владелец, 2026-09-11: "при каждой
// отправке уникальной ведомости копия письма с ведомостью уходила на ящик".
// Одна копия на СОДЕРЖИМОЕ ведомости, не на письмо: дедупликация общая с
// живым путём отправки (supabase/functions/process-bulk-send-jobs) и с
// одиночной (api/purchase-send-email.js) — таблица material_ledger_copies,
// вставка с ignoreDuplicates = атомарный захват, поэтому ручной прогон
// этого скрипта поверх работающего крона копию не задвоит.
const LEDGER_COPY_TO = process.env.LEDGER_COPY_TO || 'anatoly.trashman@gmail.com';
const LEDGER_COPY_FROM = process.env.LEDGER_COPY_FROM || `${RESEND_FROM_NAME} <zakupki@redevelopment.pro>`;
const MIN_DELAY_MS = 25000;
const MAX_DELAY_MS = 35000;

if (!DRY_RUN) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
    process.exit(1);
  }
  if (!RESEND_API_KEY) {
    console.error('Не задана переменная окружения RESEND_API_KEY (или запусти с --dry-run)');
    process.exit(1);
  }
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function randomDelay() {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emailAddress(shortCode) {
  return `zakupki+${shortCode}@redevelopment.pro`;
}

function emailHtml(body) {
  const escaped = String(body)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#14151a;white-space:pre-wrap;">${escaped}</div>`;
}

// Продублировано из src/data/supplierResearch.ts (formatRequestItemsText).
function formatRequestItemsText(items, fallback) {
  if (!items || items.length === 0) return fallback;
  return items
    .map((i) => {
      const qty = i.quantity ? ` (${i.quantity}${i.unit ? ` ${i.unit}` : ''})` : '';
      const note = i.note && i.note.trim() ? ` — ${i.note.trim()}` : '';
      return `${i.name}${qty}${note}`;
    })
    .join(', ');
}

// Продублировано из src/lib/emailTemplates.ts (renderEmailTemplate).
function renderTemplate(text, { offer, request }) {
  return text.replace(/\{([^{}]*)\}/g, (match, rawKey) => {
    const key = rawKey.trim().toLowerCase();
    if (key === 'компания') return offer.name;
    if (key === 'запрос') return request.title;
    if (key === 'материалы') return formatRequestItemsText(request.items, request.title);
    if (key === 'контакт') return offer.contact;
    return match;
  });
}

function fileExtension(fileName) {
  const parts = String(fileName).split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : 'bin';
}

function sanitizeFileName(fileName) {
  return String(fileName).replace(/[\\/]/g, '_');
}

// Продублировано из api/_attachments.js (uploadAttachment) — тот файл
// импортирует свои зависимости относительно api/, здесь проще
// продублировать маленькую функцию, чем городить общий модуль между
// Vercel-функциями и голыми .mjs-скриптами (тот же принцип, что уже принят
// в этом проекте — см. комментарий в sync-citywide-retail-offers.mjs про
// продублированный dedupKey).
async function uploadAttachmentToStorage(bytes, contentType, fileName) {
  const path = `bulk-send-attachments/${randomUUID()}.${fileExtension(fileName)}`;
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Не удалось загрузить вложение: ${text}`);
  }
  return { url: `${SUPABASE_URL}/storage/v1/object/public/${ATTACHMENTS_BUCKET}/${path}`, fileName: sanitizeFileName(fileName) };
}

async function fetchDocumentFileAsBase64(file) {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error('Не удалось загрузить файл юрлица');
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = fileExtension(file.fileName);
  const contentType =
    ext === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === 'doc'
        ? 'application/msword'
        : ext === 'pdf'
          ? 'application/pdf'
          : 'application/octet-stream';
  return { fileName: file.fileName, contentType, contentBase64: buf.toString('base64') };
}

async function claimLedgerCopy(contentKey, ledgerName, context) {
  const { data, error } = await supabase
    .from('material_ledger_copies')
    .upsert({ content_key: contentKey, ledger_name: ledgerName, context }, { onConflict: 'content_key', ignoreDuplicates: true })
    .select('content_key');
  if (error) throw error;
  return (data ?? []).length > 0;
}

function ledgerCopyBody({ ledgerFileName, context, subject, body }) {
  const sentAt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return [
    'Копия исходящего письма с ведомостью материалов.',
    '',
    `Ведомость: ${ledgerFileName}`,
    `Кому: ${context}`,
    `Отправлено: ${sentAt}`,
    `Тема: ${subject}`,
    '',
    '— — — текст письма — — —',
    '',
    body,
  ].join('\n');
}

// Best-effort, как и в Edge Function: письмо поставщику уже ушло, сбой копии
// не должен помечать его ошибкой. Захват снимается, чтобы копия ушла со
// следующей отправкой этой же ведомости.
async function sendLedgerCopy({ job, request, offer, recipientsCount }) {
  const attachment = job.attachment;
  if (!attachment?.contentKey || !attachment?.contentBase64) return;
  const context = `массовая рассылка по запросу «${request.title}», получателей: ${recipientsCount} (текст — как ушёл «${offer.name}»)`;
  let claimed = false;
  try {
    claimed = await claimLedgerCopy(attachment.contentKey, attachment.fileName ?? '', context);
    if (!claimed) return;
    const subject = renderTemplate(job.subject, { offer, request }).trim() || 'Запрос цены';
    const body = renderTemplate(job.body, { offer, request });
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: LEDGER_COPY_FROM,
        to: [LEDGER_COPY_TO],
        subject: `[Копия] ${subject}`,
        html: emailHtml(ledgerCopyBody({ ledgerFileName: attachment.fileName, context, subject, body })),
        attachments: [{ filename: attachment.fileName, content: attachment.contentBase64 }],
      }),
    });
    if (!resp.ok) throw new Error(`Resend: ${(await resp.text()).slice(0, 300)}`);
    console.log('  ✓ копия ведомости владельцу');
  } catch (err) {
    console.error('  копия ведомости владельцу не ушла:', err.message);
    if (claimed) await supabase.from('material_ledger_copies').delete().eq('content_key', attachment.contentKey);
  }
}

async function sendOneEmail({ offer, request, legalEntity, job, item }) {
  // Второй рубеж против дубля (первый — атомарный захват в processItem):
  // по каждой строке задания в переписке может быть только одно письмо.
  // Та же проверка стоит в Edge Function, а в базе — уникальный индекс
  // supplier_offer_emails_bulk_job_item_uniq по bulk_job_item_id.
  const { data: alreadySent, error: alreadySentError } = await supabase
    .from('supplier_offer_emails')
    .select('id')
    .eq('bulk_job_item_id', item.id)
    .limit(1);
  if (alreadySentError) throw alreadySentError;
  if ((alreadySent ?? []).length > 0) {
    console.log(`  ⤼ письмо по этой строке задания уже отправлено, повтор не шлём (item ${item.id})`);
    return;
  }

  const rendered = {
    subject: renderTemplate(job.subject, { offer, request }).trim(),
    body: renderTemplate(job.body, { offer, request }),
  };

  const { data: firstOutgoingRows, error: firstOutgoingError } = await supabase
    .from('supplier_offer_emails')
    .select('id')
    .eq('offer_id', offer.id)
    .eq('direction', 'out')
    .limit(1);
  if (firstOutgoingError) throw firstOutgoingError;
  const isFirstOutgoing = (firstOutgoingRows ?? []).length === 0;

  const resendAttachments = [{ filename: job.attachment.fileName, content: job.attachment.contentBase64 }];
  const storedFiles = [];
  // Storage-копия ведомости — тот же принцип, что и у остальных вложений
  // исходящих писем (см. api/purchase-send-email.js), чтобы файл был виден
  // и в самой ленте переписки, не только долетел до почтового ящика.
  try {
    const bytes = Buffer.from(job.attachment.contentBase64, 'base64');
    storedFiles.push(await uploadAttachmentToStorage(bytes, job.attachment.contentType, job.attachment.fileName));
  } catch (err) {
    console.error('  Не удалось сохранить ведомость в Storage:', err.message);
  }

  // Файлы юрлица, которые идут только первому письму конкретному поставщику:
  // карточка организации (реквизиты) и — владелец, 2026-09-11 — "Информация
  // по доставке" (адрес объекта, машины до 20 тонн с боковой разгрузкой,
  // разгрузка нашими силами; текст задаётся на странице юрлица, .docx
  // собирается там же, см. src/lib/deliveryInfoDocx.ts). Оба лежат в Storage
  // обычным {url, fileName}, обработка одинаковая — один цикл. Сбой на одном
  // файле не роняет письмо: уходит без него, как и раньше с карточкой.
  const firstEmailFiles = isFirstOutgoing
    ? [legalEntity?.card_file, legalEntity?.delivery_file].filter(Boolean)
    : [];
  for (const file of firstEmailFiles) {
    try {
      const attachment = await fetchDocumentFileAsBase64(file);
      resendAttachments.push({ filename: attachment.fileName, content: attachment.contentBase64 });
      const bytes = Buffer.from(attachment.contentBase64, 'base64');
      storedFiles.push(await uploadAttachmentToStorage(bytes, attachment.contentType, attachment.fileName));
    } catch (err) {
      console.error(`  Не удалось приложить файл юрлица (${file.fileName}):`, err.message);
    }
  }

  // Реальный баг, найденный владельцем 2026-09-09 на живой рассылке (сразу
  // после запуска этой фичи): каждому получателю создавалась своя
  // одноразовая "заявка" (supplier_orders, title "Рассылка: ...") и письмо
  // цеплялось к НЕЙ (order_id != null) — в интерфейсе "Письма" по умолчанию
  // открыта вкладка "Основная" (order_id = null), поэтому реально
  // отправленные письма были не видны без клика в скрытую вкладку "Заявка".
  // Тот же паттерн, что и у обычной одиночной отправки одного письма
  // (api/purchase-send-email.js — там orderId вообще не передаётся для
  // обычного письма, шлётся с order_id:null и адресом-плюс от short_code
  // самого offer, не заявки) — синхронизировано с этим поведением: заявка
  // (SupplierOrder) — это то, что человек явно создаёт кнопкой "+ Новая
  // заявка", массовая рассылка не должна заводить её сама.
  const fromAddress = emailAddress(offer.short_code);

  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${fromAddress}>`,
      to: [offer.email],
      subject: rendered.subject || 'Запрос цены',
      html: emailHtml(rendered.body),
      attachments: resendAttachments,
    }),
  });
  if (!resendResp.ok) {
    const text = await resendResp.text();
    throw new Error(`Resend: ${text}`);
  }
  const resendJson = await resendResp.json();

  const { error: insertEmailError } = await supabase.from('supplier_offer_emails').insert({
    offer_id: offer.id,
    order_id: null,
    direction: 'out',
    from_address: fromAddress,
    to_address: offer.email,
    subject: rendered.subject,
    body: rendered.body,
    files: storedFiles,
    resend_message_id: resendJson?.id ?? null,
    // Строка задания, по которой ушло письмо — под уникальным индексом,
    // то есть повторная вставка по той же строке физически невозможна
    // (последняя страховка от дубля, см. комментарий в начале функции).
    bulk_job_item_id: item.id,
    // Автор рассылки переносится в каждое её письмо (владелец, 2026-09-12 —
    // учёт работы с письмами по сотрудникам, см. Metrics.tsx): в момент
    // фоновой отправки вошедшего пользователя уже нет, единственный
    // достоверный источник — кто поставил задание (bulk_send_jobs).
    sent_by_profile_id: job.created_by_profile_id ?? null,
    sent_by_name: job.created_by_name ?? null,
  });
  if (insertEmailError) throw insertEmailError;
}

async function fetchQueuedWork() {
  const { data: jobs, error: jobsError } = await supabase
    .from('bulk_send_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });
  if (jobsError) throw jobsError;
  if (!jobs || jobs.length === 0) return [];

  const work = [];
  for (const job of jobs) {
    const { data: items, error: itemsError } = await supabase
      .from('bulk_send_job_items')
      .select('*')
      .eq('job_id', job.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (itemsError) throw itemsError;

    const { data: requestRow, error: requestError } = await supabase
      .from('supplier_research_requests')
      .select('*')
      .eq('id', job.request_id)
      .single();
    if (requestError) throw requestError;

    let legalEntity = null;
    if (job.legal_entity_id) {
      const { data: legalEntityRow, error: legalEntityError } = await supabase
        .from('legal_entities')
        .select('*')
        .eq('id', job.legal_entity_id)
        .single();
      if (legalEntityError) throw legalEntityError;
      legalEntity = legalEntityRow;
    }

    // Всего получателей задания (не только оставшихся) — для текста копии.
    const { count: recipientsCount } = await supabase
      .from('bulk_send_job_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id);

    for (const item of items ?? []) {
      work.push({ job, item, request: requestRow, legalEntity, recipientsCount: recipientsCount ?? 0 });
    }
  }
  return work;
}

async function processItem({ job, item, request, legalEntity, recipientsCount }) {
  // Атомарный захват письма — ровно как в supabase/functions/process-bulk-
  // send-jobs (владелец, 2026-09-12: "это что, письмо задублировалось?").
  // Список писем здесь набирается ОДИН раз в начале запуска
  // (fetchQueuedWork), а сам запуск живёт десятки минут — за это время те же
  // строки успевает разобрать Edge Function, которую pg_cron дёргает раз в
  // минуту. Без захвата оба пути слали каждому поставщику по письму: 12.09
  // так ушло 38 лишних писем по двум рассылкам. Ноль обновлённых строк —
  // письмо уже взял другой исполнитель, молча пропускаем.
  const { data: claimed, error: claimError } = await supabase
    .from('bulk_send_job_items')
    .update({ status: 'sending' })
    .eq('id', item.id)
    .eq('status', 'pending')
    .select('id');
  if (claimError) throw claimError;
  if ((claimed ?? []).length === 0) {
    console.log(`  ⤼ письмо уже взял другой исполнитель, пропускаем (item ${item.id})`);
    return;
  }

  const { data: offer, error: offerError } = await supabase
    .from('supplier_research_offers')
    .select('*')
    .eq('id', item.offer_id)
    .single();
  if (offerError || !offer) {
    await supabase
      .from('bulk_send_job_items')
      .update({ status: 'error', error_message: 'Предложение не найдено' })
      .eq('id', item.id);
    return;
  }

  try {
    await sendOneEmail({
      offer: { id: offer.id, name: offer.name, contact: offer.contact, email: offer.email, short_code: offer.short_code },
      request: { title: request.title, items: request.items ?? [] },
      legalEntity,
      job,
      item,
    });

    await supabase
      .from('bulk_send_job_items')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', item.id);
    console.log(`  ✓ ${offer.name} <${offer.email}>`);
    await sendLedgerCopy({
      job,
      request: { title: request.title, items: request.items ?? [] },
      offer,
      recipientsCount: recipientsCount ?? 0,
    });
  } catch (err) {
    await supabase.from('bulk_send_job_items').update({ status: 'error', error_message: err.message }).eq('id', item.id);
    console.error(`  ✗ ${offer.name} <${offer.email}>: ${err.message}`);
  }
}

async function closeFinishedJobs() {
  const { data: jobs, error } = await supabase.from('bulk_send_jobs').select('id').eq('status', 'queued');
  if (error) throw error;
  for (const job of jobs ?? []) {
    const { count, error: pendingError } = await supabase
      .from('bulk_send_job_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id)
      .eq('status', 'pending');
    if (pendingError) throw pendingError;
    if (count === 0) {
      await supabase.from('bulk_send_jobs').update({ status: 'done' }).eq('id', job.id);
    }
  }
}

async function main() {
  console.log(`process-bulk-send-jobs — ${new Date().toISOString()}${DRY_RUN ? ' (dry-run)' : ''}`);

  if (DRY_RUN) {
    console.log('Dry-run: реальные запросы к Supabase/Resend не выполняются.');
    return;
  }

  const work = await fetchQueuedWork();
  if (work.length === 0) {
    console.log('Очередь пуста.');
    return;
  }
  console.log(`В очереди ${work.length} писем.`);

  for (let i = 0; i < work.length; i++) {
    await processItem(work[i]);
    if (i < work.length - 1) await sleep(randomDelay());
  }

  await closeFinishedJobs();
  console.log('Готово.');
}

main().catch((err) => {
  console.error('Ошибка воркера:', err);
  process.exit(1);
});
