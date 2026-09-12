import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { authFetch } from './authFetch';
import type { EmailExtraction, SupplierOfferEmail, SupplierOfferEmailRow } from '../data/supplierOfferEmails';

function fromRow(row: SupplierOfferEmailRow): SupplierOfferEmail {
  return {
    id: row.id,
    offerId: row.offer_id,
    orderId: row.order_id ?? null,
    direction: row.direction === 'in' ? 'in' : 'out',
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject ?? '',
    body: row.body ?? '',
    files: row.files ?? [],
    resendMessageId: row.resend_message_id,
    readAt: row.read_at ?? null,
    extraction: row.extraction ?? null,
    sentByProfileId: row.sent_by_profile_id ?? null,
    sentByName: row.sent_by_name ?? null,
    createdAt: row.created_at,
  };
}

export function fetchSupplierOfferEmails(offerId: string): Promise<SupplierOfferEmail[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_offer_emails')
      .select('*')
      .eq('offer_id', offerId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as SupplierOfferEmailRow[]).map(fromRow);
  });
}

// Вся переписка по всем предложениям разом — вкладка "Переписка"
// (Suppliers.tsx) и фоновый вотчер новых ответов (supplierEmailWatcher.ts).
// Объём маленький (десятки-сотни строк на весь Ресерч), один запрос без
// пагинации.
export function fetchAllSupplierOfferEmails(): Promise<SupplierOfferEmail[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('supplier_offer_emails').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data as SupplierOfferEmailRow[]).map(fromRow);
  });
}

// Облегчённый срез исходящих писем для страницы метрик (/admin/metrics) —
// только те три поля, по которым там считаются плитки. Отдельная функция, а не
// fetchAllSupplierOfferEmails, именно из-за автообновления: метрики
// перезапрашиваются раз в минуту в фоне, а `select('*')` тянет ещё и body
// каждого письма (полный HTML со всей цитируемой перепиской) — на такой
// частоте это мегабайты трафика впустую.
export interface OutgoingEmailMetric {
  createdAt: string;
  sentByName: string | null;
  toAddress: string;
}

export function fetchOutgoingEmailMetrics(): Promise<OutgoingEmailMetric[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_offer_emails')
      .select('created_at, sent_by_name, to_address')
      .eq('direction', 'out')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as Pick<SupplierOfferEmailRow, 'created_at' | 'sent_by_name' | 'to_address'>[]).map((row) => ({
      createdAt: row.created_at,
      sentByName: row.sent_by_name ?? null,
      toAddress: row.to_address,
    }));
  });
}

// Отмечает прочитанными все ВХОДЯЩИЕ письма этого треда, у которых read_at
// ещё не проставлен — вызывается при открытии треда. orderId=null — тред
// "основной" переписки офера, конкретный id — тред отдельной заявки
// (владелец, 2026-09-03: "1 заявка на поставку — одна ветка"; отметка
// прочитанным идёт именно за открытый тред, не за всю переписку офера
// разом — иначе непрочитанные в других заявках гасли бы сами по себе).
// Обычная клиентская запись (RLS authenticated_all), без серверной функции —
// не privileged-операция, любой залогиненный сотрудник может отмечать
// письма прочитанными.
export function markSupplierOfferEmailsRead(offerId: string, orderId: string | null): Promise<void> {
  return withRetry(async () => {
    let query = supabase
      .from('supplier_offer_emails')
      .update({ read_at: new Date().toISOString() })
      .eq('offer_id', offerId)
      .eq('direction', 'in')
      .is('read_at', null);
    query = orderId ? query.eq('order_id', orderId) : query.is('order_id', null);
    const { error } = await query;
    if (error) throw error;
  });
}

// Владелец подтвердил/отклонил распознанный счёт — обновляем status на
// самой строке письма (extraction — jsonb целиком, PATCH заменяет объект,
// не отдельные поля). Обычная клиентская запись, RLS authenticated_all.
export function setSupplierOfferEmailExtractionStatus(
  emailId: string,
  extraction: EmailExtraction,
  status: EmailExtraction['status'],
): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('supplier_offer_emails')
      .update({ extraction: { ...extraction, status } })
      .eq('id', emailId);
    if (error) throw error;
  });
}

// Отправка — через api/purchase-send-email.js (общий эндпоинт с закупками,
// см. комментарий в файле — Vercel Hobby ограничен 12 serverless-функциями,
// отдельный файл на каждую пару send/receive не поместился бы).
export async function sendSupplierOfferEmail(input: {
  offerId: string;
  // Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" — если письмо
  // идёт в дополнительной заявке (не в основной переписке офера), сервер
  // строит адрес отправителя из shortCode этой заявки, а не офера (см.
  // api/purchase-send-email.js).
  orderId?: string | null;
  toAddress: string;
  subject: string;
  body: string;
  // Ведомости материалов (владелец, 2026-09-03) — .xlsx, сгенерированный на
  // клиенте (lib/materialLedgerXlsx.ts), уходит сюда уже base64-строкой;
  // сервер сам решает, что с ним делать (см. api/purchase-send-email.js).
  attachments?: { fileName: string; contentType: string; contentBase64: string }[];
}): Promise<SupplierOfferEmail> {
  const res = await authFetch('/api/purchase-send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Не удалось отправить письмо');
  return fromRow(json.email as SupplierOfferEmailRow);
}
