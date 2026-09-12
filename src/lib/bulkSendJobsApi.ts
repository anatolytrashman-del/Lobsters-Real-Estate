import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { authFetch } from './authFetch';
import { getCurrentProfile } from './accessProfile';
import type { BulkSendJob, BulkSendJobRow } from '../data/bulkSendJobs';

// Владелец, 2026-09-09: "при каждой отправке письма запускай костыль, после
// отправки всех писем — останавливай" — вместо периодического опроса сессией
// Claude (переживает только пока сессия открыта) настоящий автотриггер:
// сразу после постановки задания в очередь дёргаем api/trigger-rebuild.js
// (action:'dispatch-bulk-send'), тот вызывает workflow_dispatch на
// process-bulk-send-jobs.yml напрямую — не дожидаясь ни сломанного планового
// крона (см. журнал docs/session-journal.md), ни ручного вмешательства. Fire-and-forget —
// неудача не должна мешать самой постановке в очередь (плановый крон
// остаётся подстраховкой).
function dispatchBulkSendWorkflow() {
  authFetch('/api/trigger-rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dispatch-bulk-send' }),
  }).catch(() => {});
}

function fromRow(row: BulkSendJobRow): BulkSendJob {
  return {
    id: row.id,
    requestId: row.request_id,
    legalEntityId: row.legal_entity_id,
    subject: row.subject,
    body: row.body,
    attachment: row.attachment,
    status: row.status === 'done' ? 'done' : 'queued',
    createdByProfileId: row.created_by_profile_id ?? null,
    createdByName: row.created_by_name ?? null,
    createdAt: row.created_at,
  };
}

// Ставит задание на массовую рассылку в очередь — сама отправка идёт фоново,
// через scripts/process-bulk-send-jobs.mjs (см. комментарий в
// data/bulkSendJobs.ts). offerIds — уже отфильтрованные/отмеченные вручную
// получатели (BulkSendModal).
export function insertBulkSendJob(input: {
  requestId: string;
  legalEntityId: string | null;
  subject: string;
  body: string;
  attachment: BulkSendJob['attachment'];
  offerIds: string[];
}): Promise<BulkSendJob> {
  return withRetry(async () => {
    const profile = getCurrentProfile();
    const { data: jobData, error: jobError } = await supabase
      .from('bulk_send_jobs')
      .insert({
        request_id: input.requestId,
        legal_entity_id: input.legalEntityId,
        subject: input.subject,
        body: input.body,
        attachment: input.attachment,
        created_by_profile_id: profile.id,
        created_by_name: profile.displayName,
      })
      .select()
      .single();
    if (jobError) throw jobError;
    const job = fromRow(jobData as BulkSendJobRow);

    const { error: itemsError } = await supabase
      .from('bulk_send_job_items')
      .insert(input.offerIds.map((offerId) => ({ job_id: job.id, offer_id: offerId })));
    if (itemsError) throw itemsError;

    dispatchBulkSendWorkflow();
    return job;
  });
}

// Поставщики, письма которым УЖЕ поставлены в очередь, но воркер (scripts/
// process-bulk-send-jobs.mjs) до них ещё не дошёл — строки supplier_offer_emails
// у них появятся только в момент реальной отправки, а между постановкой в
// очередь и последним письмом проходит 25-35с × количество получателей (на
// 20 поставщиков — минут десять). Без этого списка "кому ещё не писали" в
// BulkSendModal считал бы их нетронутыми и владелец, поставив вторую
// рассылку по той же категории, отправил бы части поставщиков дубль.
// Статус 'error' сюда сознательно не попадает — письмо не ушло, повторить
// такому поставщику как раз нужно.
export function fetchQueuedBulkSendOfferIds(): Promise<string[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('bulk_send_job_items').select('offer_id').eq('status', 'pending');
    if (error) throw error;
    return (data as { offer_id: string }[]).map((r) => r.offer_id);
  });
}

// Повторная рассылка по получателям прошлой — владелец, 2026-09-12: "я
// отправил неправильную ведомость по керамограниту... хочу написать всем,
// кому я ошибно написал ранее. То есть не новые добавленные, а только те,
// кому уже отправлено письмо". Фильтр "Кому уже писали" в BulkSendModal для
// этого не годится: он показывает всех, с кем мы как-то контактировали
// (включая тех, у кого просто лежит КП или совпал домен почты), и не знает,
// в какой именно рассылке ушёл испорченный файл. Здесь — точный список:
// строки конкретного задания, по которым письмо РЕАЛЬНО ушло.
export interface PastBulkSend {
  id: string;
  requestId: string;
  subject: string;
  body: string;
  legalEntityId: string | null;
  // Имя файла ведомости, которая ушла в той рассылке — по нему владелец и
  // опознаёт "ту самую, неправильную". Тянем только имя (attachment->>fileName),
  // а не всю jsonb-колонку: в ней лежит base64 самого xlsx, на десяток
  // заданий это мегабайты в браузер.
  ledgerName: string | null;
  createdAt: string;
  createdByName: string | null;
  // Кому письмо уже ушло (status='sent') — это и есть аудитория повтора.
  sentOfferIds: string[];
  // Кому ещё не ушло, но уйдёт (status='pending'/'sending'): если рассылка
  // с ошибочной ведомостью не доехала до конца, эти письма прямо сейчас
  // продолжают уходить со старым файлом — см. cancelQueuedBulkSendItems.
  // Строки со status='error' сюда не идут: письмо не ушло и не уйдёт.
  pendingOfferIds: string[];
}

interface PastJobRow {
  id: string;
  request_id: string;
  subject: string;
  body: string;
  legal_entity_id: string | null;
  created_at: string;
  created_by_name: string | null;
  ledgerName: string | null;
}

// Прошлые рассылки по одной категории поставщиков, свежие первыми. Задания,
// по которым не ушло ни одного письма и ничего не осталось в очереди
// (например, всё упало с ошибкой), в список не попадают — повторять там
// нечего.
export function fetchPastBulkSends(requestId: string, limit = 20): Promise<PastBulkSend[]> {
  return withRetry(async () => {
    const { data: jobData, error: jobError } = await supabase
      .from('bulk_send_jobs')
      .select('id, request_id, subject, body, legal_entity_id, created_at, created_by_name, ledgerName:attachment->>fileName')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (jobError) throw jobError;
    const jobs = (jobData ?? []) as unknown as PastJobRow[];
    if (jobs.length === 0) return [];

    const { data: itemData, error: itemError } = await supabase
      .from('bulk_send_job_items')
      .select('job_id, offer_id, status')
      .in(
        'job_id',
        jobs.map((j) => j.id),
      );
    if (itemError) throw itemError;

    const sent = new Map<string, string[]>();
    const pending = new Map<string, string[]>();
    for (const item of (itemData ?? []) as { job_id: string; offer_id: string; status: string }[]) {
      const bucket = item.status === 'sent' ? sent : item.status === 'pending' || item.status === 'sending' ? pending : null;
      if (!bucket) continue;
      const list = bucket.get(item.job_id);
      if (list) list.push(item.offer_id);
      else bucket.set(item.job_id, [item.offer_id]);
    }

    return jobs
      .map((job) => ({
        id: job.id,
        requestId: job.request_id,
        subject: job.subject,
        body: job.body,
        legalEntityId: job.legal_entity_id,
        ledgerName: job.ledgerName,
        createdAt: job.created_at,
        createdByName: job.created_by_name ?? null,
        sentOfferIds: sent.get(job.id) ?? [],
        pendingOfferIds: pending.get(job.id) ?? [],
      }))
      .filter((job) => job.sentOfferIds.length > 0 || job.pendingOfferIds.length > 0);
  });
}

// Снять с очереди ещё не ушедшие письма рассылки. Нужно ровно в том же
// сценарии, что и повтор: ведомость оказалась неправильной, а рассылка на
// 20 поставщиков идёт по 25-35 секунд на письмо — пока владелец заметил
// ошибку, половина адресатов ещё в очереди, и без отмены они получат
// старый файл уже ПОСЛЕ повторного письма с правильным.
// Статус 'cancelled' воркеры (supabase/functions/process-bulk-send-jobs,
// scripts/process-bulk-send-jobs.mjs) не разбирают — они берут только
// 'pending', — а closeFinishedJobs закроет задание на следующем тике.
// Возвращает, сколько писем реально сняли: строку, которую воркер уже взял
// в работу ('sending'), не трогаем — письмо либо уже ушло, либо уходит.
export function cancelQueuedBulkSendItems(jobId: string): Promise<number> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('bulk_send_job_items')
      .update({ status: 'cancelled' })
      .eq('job_id', jobId)
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;
    return (data ?? []).length;
  });
}
