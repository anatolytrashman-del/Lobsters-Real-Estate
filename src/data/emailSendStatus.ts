// Состояние отправки ИСХОДЯЩЕГО письма — общее для обеих переписок (Ресерч
// поставщиков и закупки), поэтому отдельным файлом, а не дублем в каждом.
//
// Владелец, 2026-09-12: в этот день закончился дневной лимит Resend, и стало
// видно, что одиночное письмо при отказе почты не сохранялось нигде (см.
// api/purchase-send-email.js и supabase/functions/process-outgoing-emails).
// Теперь запись создаётся всегда:
//   'sent'   — ушло (и все письма, созданные до появления поля, а также
//              массовая рассылка и входящие: колонка в базе с default 'sent');
//   'queued' — почта временно отказала, письмо стоит в очереди и уйдёт само;
//   'failed' — отправить не удалось совсем (постоянная ошибка либо трое
//              суток безуспешных попыток), нужен ручной разбор.
export type EmailSendStatus = 'sent' | 'queued' | 'failed';

export function emailSendStatusFromRow(value: string | null | undefined): EmailSendStatus {
  return value === 'queued' || value === 'failed' ? value : 'sent';
}

// Подпись в шапке письма в ленте переписки — вместо простого "Отправлено".
export const emailSendStatusLabel: Record<EmailSendStatus, string> = {
  sent: 'Отправлено',
  queued: 'В очереди',
  failed: 'Не отправлено',
};
