// Досылка ОДИНОЧНЫХ писем, которые Resend не принял с первого раза —
// Supabase Edge Function, крон раз в минуту (pg_cron, как и у двух соседних
// функций; см. CLAUDE.md, фоновые очереди живут в Supabase, не в Actions).
//
// Владелец, 2026-09-12: в этот день упёрлись в дневной лимит Resend на
// бесплатном тарифе (108 исходящих при лимите 100). Массовая рассылка такое
// переживает без потерь — у неё своя очередь (bulk_send_jobs), — а одиночный
// ответ из вкладки "Письма" уходил синхронно: api/purchase-send-email.js →
// Resend → и запись в переписке создавалась ТОЛЬКО после успешного ответа.
// Отказ Resend = письмо нигде не сохранено, текст жил лишь в открытом окне
// композера, до первой перезагрузки страницы.
//
// Теперь при ВРЕМЕННОМ отказе (429/5xx/обрыв связи) эндпоинт всё равно
// создаёт запись письма — со статусом send_status='queued', она сразу видна
// в ленте с пометкой "В очереди", — и кладёт задание в outgoing_email_jobs.
// Эта функция задания и разбирает.
//
// Чего здесь СПЕЦИАЛЬНО нет, в отличие от process-bulk-send-jobs: паузы в
// 25-35 секунд между письмами. Она там нужна, чтобы рассылка по десяткам
// поставщиков не выглядела машинной; здесь же в очереди лежат живые ответы
// конкретным людям, которые и так уже задержались — их нужно дослать сразу,
// как только почта заработает. Остаётся только SEND_GAP_MS, чтобы не
// упереться в частотный лимит Resend (2 запроса в секунду).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const RESEND_FROM_NAME = 'Анатолий Трэшмен';
const MAX_EMAILS_PER_RUN = 10;
const SEND_GAP_MS = 700;
// Шаг повторов: 1, 5, 15, 30 минут, дальше раз в час. Дневной лимит Resend
// сбрасывается по UTC, тариф владелец обновляет руками — час опроса это
// покрывает, а первые короткие шаги ловят обычный сетевой сбой.
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];
// Сколько всего пытаемся: трое суток. Дальше письмо помечается "Не
// отправлено" — за это время либо тариф вернулся, либо дело не в лимите и
// ответ поставщику всё равно уже потерял смысл без ручного разбора.
const GIVE_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
// Задание, застрявшее в 'sending' (функция умерла между отправкой и записью
// результата), возвращаем в очередь. От повторной отправки уже принятого
// письма страхует Idempotency-Key — он хранится в задании и переживает
// перезапуск (Resend помнит ключ 24 часа).
const STALE_SENDING_MS = 15 * 60 * 1000;

// Копия письма с ведомостью материалов владельцу — та же логика и та же
// таблица-дедупликатор, что в api/purchase-send-email.js и
// process-bulk-send-jobs: одна копия на СОДЕРЖИМОЕ ведомости (content_key),
// вставка с ignoreDuplicates работает атомарным захватом.
const LEDGER_COPY_TO = Deno.env.get('LEDGER_COPY_TO') ?? 'anatoly.trashman@gmail.com';
const LEDGER_COPY_FROM = Deno.env.get('LEDGER_COPY_FROM') ?? `${RESEND_FROM_NAME} <zakupki@redevelopment.pro>`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emailHtml(body: string): string {
  const escaped = String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#14151a;white-space:pre-wrap;">${escaped}</div>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// Ошибка отправки с разметкой "повторять или нет" — ровно те же правила, что
// в api/purchase-send-email.js (isRetryableSendFailure): 429 (лимит тарифа
// или частотный), 5xx и обрыв связи повторяем, остальное — нет.
class SendError extends Error {
  retryable: boolean;
  quota: boolean;
  constructor(message: string, retryable: boolean, quota = false) {
    super(message);
    this.retryable = retryable;
    this.quota = quota;
  }
}

async function attachmentContent(a: any): Promise<string> {
  if (a?.contentBase64) return a.contentBase64;
  if (!a?.url) throw new SendError(`Вложение «${a?.fileName ?? '?'}» потеряно: нет ни файла, ни ссылки`, false);
  const resp = await fetch(a.url);
  if (!resp.ok) {
    // Файл в Storage не отдаётся — сам собой это не починится, а отправлять
    // письмо "прикрепили" без вложения нельзя.
    throw new SendError(`Вложение «${a.fileName}» не скачалось из хранилища (${resp.status})`, false);
  }
  return bytesToBase64(new Uint8Array(await resp.arrayBuffer()));
}

async function sendViaResend(payload: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: { filename: string; content: string }[];
  idempotencyKey: string | null;
}) {
  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(payload.idempotencyKey ? { 'Idempotency-Key': payload.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: payload.from,
        to: [payload.to],
        subject: payload.subject,
        html: emailHtml(payload.body),
        ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
      }),
    });
  } catch (err) {
    throw new SendError(`Resend недоступен: ${err instanceof Error ? err.message : err}`, true);
  }
  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 300);
    const quota = resp.status === 429 || /quota|rate.?limit|too many|exceed/i.test(text);
    throw new SendError(`Resend: ${text}`, quota || resp.status >= 500, quota);
  }
  return await resp.json();
}

async function claimLedgerCopy(contentKey: string, ledgerName: string, context: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('material_ledger_copies')
    .upsert({ content_key: contentKey, ledger_name: ledgerName, context }, { onConflict: 'content_key', ignoreDuplicates: true })
    .select('content_key');
  if (error) throw error;
  return (data ?? []).length > 0;
}

function ledgerCopyBody(ledgerFileName: string, context: string, subject: string, body: string): string {
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

// Копии ведомостей уходят уже ПОСЛЕ реальной отправки самого письма (у
// одиночной отправки так же) — best-effort, сбой копии не должен возвращать
// письмо в очередь: оно уже ушло поставщику.
async function sendLedgerCopies(job: any, contents: Map<string, string>) {
  const subject = job.subject || 'Запрос цены';
  const context = `письмо на ${job.to_address}`;
  for (const a of Array.isArray(job.attachments) ? job.attachments : []) {
    if (!a?.contentKey) continue;
    const content = contents.get(a.fileName);
    if (!content) continue;
    let claimed = false;
    try {
      claimed = await claimLedgerCopy(a.contentKey, a.fileName ?? '', context);
      if (!claimed) continue;
      await sendViaResend({
        from: LEDGER_COPY_FROM,
        to: LEDGER_COPY_TO,
        subject: `[Копия] ${subject}`,
        body: ledgerCopyBody(a.fileName, context, subject, job.body),
        attachments: [{ filename: a.fileName, content }],
        idempotencyKey: null,
      });
    } catch (err) {
      console.error('  копия ведомости владельцу не ушла:', err instanceof Error ? err.message : err);
      if (claimed) await supabase.from('material_ledger_copies').delete().eq('content_key', a.contentKey);
    }
  }
}

async function markFailed(job: any, message: string) {
  await supabase
    .from('outgoing_email_jobs')
    .update({ status: 'error', last_error: message.slice(0, 400) })
    .eq('id', job.id);
  await supabase
    .from(job.email_table)
    .update({ send_status: 'failed', send_error: message.slice(0, 400) })
    .eq('id', job.email_id);
}

async function deferJob(job: any, message: string) {
  const attempts = (job.attempts ?? 0) + 1;
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  await supabase
    .from('outgoing_email_jobs')
    .update({
      status: 'pending',
      attempts,
      last_error: message.slice(0, 400),
      next_attempt_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
    })
    .eq('id', job.id);
  // Статус самой записи письма остаётся 'queued' — в ленте это по-прежнему
  // "В очереди", просто с актуальной причиной задержки.
  await supabase.from(job.email_table).update({ send_error: message.slice(0, 400) }).eq('id', job.email_id);
}

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY не задан в секретах функции' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = { sent: 0, deferred: 0, failed: 0, errors: [] as string[] };

  await supabase
    .from('outgoing_email_jobs')
    .update({ status: 'pending' })
    .eq('status', 'sending')
    .lt('next_attempt_at', new Date(Date.now() - STALE_SENDING_MS).toISOString());

  const { data: jobs } = await supabase
    .from('outgoing_email_jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(MAX_EMAILS_PER_RUN);

  for (const job of jobs ?? []) {
    // Атомарный захват: если задание уже взял другой вызов — пропускаем.
    // next_attempt_at здесь заодно отмечает МОМЕНТ ЗАХВАТА — по нему выше
    // распознаётся задание, застрявшее в 'sending' (иначе давно просроченное
    // next_attempt_at считало бы застрявшим и только что взятое задание).
    const { data: claimed } = await supabase
      .from('outgoing_email_jobs')
      .update({ status: 'sending', next_attempt_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending')
      .select('id');
    if ((claimed?.length ?? 0) === 0) continue;

    // Запись письма — единственный источник правды о том, ушло ли оно:
    // отправка могла произойти в прошлом вызове, который не успел закрыть
    // задание (или письмо удалили из переписки руками).
    const { data: emailRow } = await supabase
      .from(job.email_table)
      .select('id, send_status')
      .eq('id', job.email_id)
      .maybeSingle();
    if (!emailRow) {
      await supabase
        .from('outgoing_email_jobs')
        .update({ status: 'error', last_error: 'Запись письма удалена' })
        .eq('id', job.id);
      continue;
    }
    if (emailRow.send_status === 'sent') {
      await supabase
        .from('outgoing_email_jobs')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', job.id);
      continue;
    }

    if (summary.sent + summary.deferred + summary.failed > 0) await sleep(SEND_GAP_MS);

    try {
      // Содержимое вложений держим отдельно: те же байты нужны потом копии
      // ведомости владельцу, второй раз качать их из Storage незачем.
      const contents = new Map<string, string>();
      const attachments: { filename: string; content: string }[] = [];
      for (const a of Array.isArray(job.attachments) ? job.attachments : []) {
        if (!a?.fileName) continue;
        const content = await attachmentContent(a);
        contents.set(a.fileName, content);
        attachments.push({ filename: a.fileName, content });
      }

      const resendJson = await sendViaResend({
        from: `${RESEND_FROM_NAME} <${job.from_address}>`,
        to: job.to_address,
        subject: job.subject || 'Запрос цены',
        body: job.body,
        attachments,
        idempotencyKey: job.idempotency_key ?? null,
      });

      await supabase
        .from(job.email_table)
        .update({ send_status: 'sent', send_error: null, resend_message_id: resendJson?.id ?? null })
        .eq('id', job.email_id);
      await supabase
        .from('outgoing_email_jobs')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', job.id);
      summary.sent++;

      await sendLedgerCopies(job, contents);
    } catch (err) {
      const retryable = err instanceof SendError ? err.retryable : true;
      const quota = err instanceof SendError ? err.quota : false;
      const message = err instanceof Error ? err.message : String(err);
      const expired = Date.now() - new Date(job.created_at).getTime() > GIVE_UP_AFTER_MS;

      if (!retryable || expired) {
        await markFailed(job, expired ? `${message} (попытки прекращены через трое суток)` : message);
        summary.failed++;
      } else {
        await deferJob(job, message);
        summary.deferred++;
      }
      summary.errors.push(`${job.to_address}: ${message.slice(0, 150)}`);

      // Упёрлись в лимит тарифа — остальные письма в этом тике упрутся в
      // него же. Они остаются 'pending' и будут взяты следующим тиком, но
      // счётчик попыток на них зря не тратится.
      if (quota) break;
    }
  }

  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
