// Фоновая отправка массовой рассылки поставщикам — владелец, 2026-09-09:
// "можем сделать отправку фоновым процессом, чтобы вкладку можно было
// закрыть?" — раньше BulkSendModal (src/components/suppliers/BulkSendModal.tsx)
// сам гонял цикл отправки прямо в браузере с паузами 25-35с между письмами
// (античтобы не выглядело как массовая рассылка) — закрыл вкладку, рассылка
// обрывается на середине. Теперь клиент только СТАВИТ задание в очередь
// (bulk_send_jobs + bulk_send_job_items), а этот скрипт, запускаемый по
// расписанию (.github/workflows/process-bulk-send-jobs.yml, раз в 5 минут),
// реально шлёт письма с тем же темпом — от постановки в очередь до первого
// письма может пройти до 5 минут (следующий тик крона), это принятый
// компромисс, чтобы не заводить ещё один Vercel serverless endpoint
// (Hobby-план и так на пределе 12 функций, см. комментарий в
// api/purchase-send-email.js).
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

const RESEND_FROM_NAME = 'Redevelopment Закупки';
const ATTACHMENTS_BUCKET = 'object-documents';
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
  if (!res.ok) throw new Error('Не удалось загрузить карточку организации');
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

async function sendOneEmail({ offer, request, legalEntity, job, order }) {
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

  if (isFirstOutgoing && legalEntity?.card_file) {
    try {
      const cardAttachment = await fetchDocumentFileAsBase64(legalEntity.card_file);
      resendAttachments.push({ filename: cardAttachment.fileName, content: cardAttachment.contentBase64 });
      const bytes = Buffer.from(cardAttachment.contentBase64, 'base64');
      storedFiles.push(await uploadAttachmentToStorage(bytes, cardAttachment.contentType, cardAttachment.fileName));
    } catch (err) {
      console.error('  Не удалось приложить карточку организации:', err.message);
    }
  }

  const fromAddress = emailAddress(order.short_code);

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
    order_id: order.id,
    direction: 'out',
    from_address: fromAddress,
    to_address: offer.email,
    subject: rendered.subject,
    body: rendered.body,
    files: storedFiles,
    resend_message_id: resendJson?.id ?? null,
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

    for (const item of items ?? []) {
      work.push({ job, item, request: requestRow, legalEntity });
    }
  }
  return work;
}

async function processItem({ job, item, request, legalEntity }) {
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
    const { data: order, error: orderError } = await supabase
      .from('supplier_orders')
      .insert({
        offer_id: offer.id,
        title: request.title ? `Рассылка: ${request.title}` : 'Массовая рассылка',
        communication_status: '',
        price: 0,
        currency: 'USD',
        deadline: '',
        requirements: '',
        items: [],
        files: [],
      })
      .select()
      .single();
    if (orderError) throw orderError;

    await sendOneEmail({
      offer: { id: offer.id, name: offer.name, contact: offer.contact, email: offer.email },
      request: { title: request.title, items: request.items ?? [] },
      legalEntity,
      job,
      order,
    });

    await supabase
      .from('bulk_send_job_items')
      .update({ status: 'sent', order_id: order.id, sent_at: new Date().toISOString() })
      .eq('id', item.id);
    console.log(`  ✓ ${offer.name} <${offer.email}>`);
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
