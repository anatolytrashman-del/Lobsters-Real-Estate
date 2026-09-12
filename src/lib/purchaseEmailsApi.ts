import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { authFetch } from './authFetch';
import type { PurchaseEmail, PurchaseEmailRow } from '../data/purchaseEmails';
import { emailSendStatusFromRow } from '../data/emailSendStatus';

function fromRow(row: PurchaseEmailRow): PurchaseEmail {
  return {
    id: row.id,
    purchaseId: row.purchase_id,
    direction: row.direction === 'in' ? 'in' : 'out',
    fromAddress: row.from_address,
    toAddress: row.to_address,
    subject: row.subject ?? '',
    body: row.body ?? '',
    files: row.files ?? [],
    resendMessageId: row.resend_message_id,
    sendStatus: emailSendStatusFromRow(row.send_status),
    sendError: row.send_error ?? null,
    createdAt: row.created_at,
  };
}

export function fetchPurchaseEmails(purchaseId: string): Promise<PurchaseEmail[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('purchase_emails')
      .select('*')
      .eq('purchase_id', purchaseId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as PurchaseEmailRow[]).map(fromRow);
  });
}

// Отправка идёт через api/purchase-send-email.js (нужен сервисный ключ и
// Resend API — не операция анонимного клиента). Функция сама вставляет
// письмо в purchase_emails на сервере и возвращает готовую запись, чтобы
// не делать два отдельных запроса (отправить + вставить) с фронта.
export async function sendPurchaseEmail(input: {
  purchaseId: string;
  toAddress: string;
  subject: string;
  body: string;
}): Promise<PurchaseEmail> {
  const res = await authFetch('/api/purchase-send-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || 'Не удалось отправить письмо');
  return fromRow(json.email as PurchaseEmailRow);
}
