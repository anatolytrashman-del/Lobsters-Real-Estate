// Массовая рассылка поставщикам БЕЗ GitHub Actions — Supabase Edge Function.
//
// Владелец, 2026-09-11: "массовая рассылка должна работать сразу, а не через
// сутки". Раньше очередь (bulk_send_jobs + bulk_send_job_items) разбирал
// scripts/process-bulk-send-jobs.mjs по крону GitHub Actions раз в 5 минут —
// но GitHub затроттлил Actions аккаунта (см. journal за эту дату), и рассылка
// встала совсем. Эта функция делает ровно ту же работу внутри Supabase, а
// дёргает её pg_cron раз в минуту — от постановки в очередь до первого письма
// теперь меньше минуты вместо пяти.
//
// Темп отправки сохранён специально: 25-35 секунд между письмами, чтобы
// рассылка не выглядела машинной (требование владельца, 2026-09-09). Из-за
// wall-clock рантайма (~150с) за один вызов уходит не больше MAX_EMAILS_PER_RUN
// писем — остальные заберёт следующий тик крона через минуту, и пауза между
// письмами при этом только больше, а не меньше.
//
// Письмо захватывается атомарно (UPDATE ... WHERE status='pending'), поэтому
// два одновременных вызова (крон + ручной прогон скрипта, если GitHub оживёт)
// не отправят одно письмо дважды.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const RESEND_FROM_NAME = 'Redevelopment Закупки';
const ATTACHMENTS_BUCKET = 'object-documents';
const MIN_DELAY_MS = 25000;
const MAX_DELAY_MS = 35000;
const MAX_EMAILS_PER_RUN = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
const emailAddress = (shortCode: string) => `zakupki+${shortCode}@redevelopment.pro`;

function emailHtml(body: string): string {
  const escaped = String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#14151a;white-space:pre-wrap;">${escaped}</div>`;
}

// Подстановка плейсхолдеров и сборка списка материалов — продублированы из
// scripts/process-bulk-send-jobs.mjs (который, в свою очередь, дублирует
// src/lib/emailTemplates.ts): общий модуль между TS-фронтом, .mjs-скриптом и
// Deno-функцией городить дороже, чем держать три копии десяти строк.
function formatRequestItemsText(items: any[], fallback: string): string {
  if (!items || items.length === 0) return fallback;
  return items
    .map((i) => {
      const qty = i.quantity ? ` (${i.quantity}${i.unit ? ` ${i.unit}` : ''})` : '';
      const note = i.note && String(i.note).trim() ? ` — ${String(i.note).trim()}` : '';
      return `${i.name}${qty}${note}`;
    })
    .join(', ');
}

function renderTemplate(text: string, offer: any, request: any): string {
  return String(text).replace(/\{([^{}]*)\}/g, (match, rawKey) => {
    const key = String(rawKey).trim().toLowerCase();
    if (key === 'компания') return offer.name;
    if (key === 'запрос') return request.title;
    if (key === 'материалы') return formatRequestItemsText(request.items ?? [], request.title);
    if (key === 'контакт') return offer.contact;
    return match;
  });
}

const fileExtension = (fileName: string) => {
  const parts = String(fileName).split('.');
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : 'bin';
};
const sanitizeFileName = (fileName: string) => String(fileName).replace(/[\\/]/g, '_');

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Порциями: apply на большом массиве упирается в лимит аргументов.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// Копия вложения в Storage — чтобы файл был виден в ленте переписки, а не
// только улетел в почтовый ящик (тот же принцип, что у одиночной отправки).
async function uploadAttachmentToStorage(bytes: Uint8Array, contentType: string, fileName: string) {
  const path = `bulk-send-attachments/${crypto.randomUUID()}.${fileExtension(fileName)}`;
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!resp.ok) throw new Error(`Не удалось загрузить вложение: ${(await resp.text()).slice(0, 200)}`);
  return {
    url: `${SUPABASE_URL}/storage/v1/object/public/${ATTACHMENTS_BUCKET}/${path}`,
    fileName: sanitizeFileName(fileName),
  };
}

async function fetchDocumentFileAsBase64(file: { url: string; fileName: string }) {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error('Не удалось загрузить карточку организации');
  const bytes = new Uint8Array(await res.arrayBuffer());
  const ext = fileExtension(file.fileName);
  const contentType =
    ext === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : ext === 'doc'
        ? 'application/msword'
        : ext === 'pdf'
          ? 'application/pdf'
          : 'application/octet-stream';
  return { fileName: file.fileName, contentType, contentBase64: bytesToBase64(bytes) };
}

async function sendOneEmail(offer: any, request: any, legalEntity: any, job: any) {
  const subject = renderTemplate(job.subject, offer, request).trim();
  const body = renderTemplate(job.body, offer, request);

  // Карточка организации прикладывается только к ПЕРВОМУ письму поставщику.
  const { data: firstOutgoing } = await supabase
    .from('supplier_offer_emails')
    .select('id')
    .eq('offer_id', offer.id)
    .eq('direction', 'out')
    .limit(1);
  const isFirstOutgoing = (firstOutgoing ?? []).length === 0;

  const resendAttachments = [{ filename: job.attachment.fileName, content: job.attachment.contentBase64 }];
  const storedFiles: { url: string; fileName: string }[] = [];
  try {
    storedFiles.push(
      await uploadAttachmentToStorage(base64ToBytes(job.attachment.contentBase64), job.attachment.contentType, job.attachment.fileName),
    );
  } catch (err) {
    console.error('  не удалось сохранить ведомость в Storage:', err instanceof Error ? err.message : err);
  }

  if (isFirstOutgoing && legalEntity?.card_file) {
    try {
      const card = await fetchDocumentFileAsBase64(legalEntity.card_file);
      resendAttachments.push({ filename: card.fileName, content: card.contentBase64 });
      storedFiles.push(await uploadAttachmentToStorage(base64ToBytes(card.contentBase64), card.contentType, card.fileName));
    } catch (err) {
      console.error('  не удалось приложить карточку организации:', err instanceof Error ? err.message : err);
    }
  }

  const fromAddress = emailAddress(offer.short_code);
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${RESEND_FROM_NAME} <${fromAddress}>`,
      to: [offer.email],
      subject: subject || 'Запрос цены',
      html: emailHtml(body),
      attachments: resendAttachments,
    }),
  });
  if (!resendResp.ok) throw new Error(`Resend: ${(await resendResp.text()).slice(0, 300)}`);
  const resendJson = await resendResp.json();

  // order_id всегда null: массовая рассылка не заводит заявку, иначе письма
  // прячутся во вкладке "Заявка" (реальный баг 2026-09-09).
  const { error } = await supabase.from('supplier_offer_emails').insert({
    offer_id: offer.id,
    order_id: null,
    direction: 'out',
    from_address: fromAddress,
    to_address: offer.email,
    subject,
    body,
    files: storedFiles,
    resend_message_id: resendJson?.id ?? null,
  });
  if (error) throw error;
}

async function closeFinishedJobs() {
  const { data: jobs } = await supabase.from('bulk_send_jobs').select('id').eq('status', 'queued');
  for (const job of jobs ?? []) {
    const { count } = await supabase
      .from('bulk_send_job_items')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', job.id)
      .in('status', ['pending', 'sending']);
    if (count === 0) await supabase.from('bulk_send_jobs').update({ status: 'done' }).eq('id', job.id);
  }
}

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY не задан в секретах функции' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = { sent: 0, failed: 0, errors: [] as string[] };

  const { data: jobs } = await supabase
    .from('bulk_send_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true });

  outer: for (const job of jobs ?? []) {
    const { data: request } = await supabase
      .from('supplier_research_requests')
      .select('*')
      .eq('id', job.request_id)
      .single();
    if (!request) continue;

    let legalEntity = null;
    if (job.legal_entity_id) {
      const { data } = await supabase.from('legal_entities').select('*').eq('id', job.legal_entity_id).single();
      legalEntity = data;
    }

    const { data: items } = await supabase
      .from('bulk_send_job_items')
      .select('*')
      .eq('job_id', job.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    for (const item of items ?? []) {
      if (summary.sent + summary.failed >= MAX_EMAILS_PER_RUN) break outer;

      // Атомарный захват: если письмо уже взял другой вызов — пропускаем.
      const { data: claimed } = await supabase
        .from('bulk_send_job_items')
        .update({ status: 'sending' })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id');
      if ((claimed?.length ?? 0) === 0) continue;

      const { data: offer } = await supabase.from('supplier_research_offers').select('*').eq('id', item.offer_id).single();
      if (!offer) {
        await supabase.from('bulk_send_job_items').update({ status: 'error', error_message: 'Предложение не найдено' }).eq('id', item.id);
        summary.failed++;
        continue;
      }

      if (summary.sent + summary.failed > 0) await sleep(randomDelay());

      try {
        await sendOneEmail(offer, { title: request.title, items: request.items ?? [] }, legalEntity, job);
        await supabase
          .from('bulk_send_job_items')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', item.id);
        summary.sent++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await supabase.from('bulk_send_job_items').update({ status: 'error', error_message: message.slice(0, 400) }).eq('id', item.id);
        summary.errors.push(`${offer.name}: ${message.slice(0, 150)}`);
        summary.failed++;
      }
    }
  }

  await closeFinishedJobs();
  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
