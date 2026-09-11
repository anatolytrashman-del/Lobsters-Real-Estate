import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { authFetch } from './authFetch';
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
    const { data: jobData, error: jobError } = await supabase
      .from('bulk_send_jobs')
      .insert({
        request_id: input.requestId,
        legal_entity_id: input.legalEntityId,
        subject: input.subject,
        body: input.body,
        attachment: input.attachment,
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
