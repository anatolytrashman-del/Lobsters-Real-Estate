import type { DocumentFile } from './contractorDocuments';

// Результат распознавания счёта/КП во вложении письма (Claude Haiku 4.5,
// см. api/_invoiceRecognition.js) — и от автоматического срабатывания на
// входящих, и от ручной кнопки "Распознать данные автоматически". null —
// либо распознавание ещё не запускалось, либо вложение признано не счётом
// (в этом случае оно вообще не сохраняется — не засорять письма пустыми
// "не подошло"). status: 'pending' — Альмире есть что подтвердить,
// 'confirmed'/'dismissed' — уже разобрано (карточка сворачивается).
export interface EmailExtractionItem {
  name: string;
  quantity: number | null;
  unit: string;
  price: number | null;
}

// sourceFile — какое именно вложение распознано (нужно, чтобы при
// подтверждении прикрепить сам файл счёта к карточке предложения, не
// только цифры из него) — null у записей, сделанных до 2026-09-03
// (в момент, когда поле появилось), но новые всегда его заполняют.
export interface EmailExtraction {
  status: 'pending' | 'confirmed' | 'dismissed';
  isInvoice: boolean;
  price: number | null;
  currency: string | null;
  items: EmailExtractionItem[];
  // ИНН поставщика, выставившего счёт (не наш, не покупателя — см. промпт
  // в api/_invoiceRecognition.js, там про это отдельно). null — в счёте не
  // нашёлся, или модель не смогла уверенно отличить его от ИНН покупателя.
  // Проверен на контрольный разряд ещё на сервере, до записи сюда.
  supplierInn: string | null;
  sourceFile: { url: string; fileName: string } | null;
  recognizedAt: string;
}

// Одно письмо в переписке по конкретному предложению Ресерча поставщиков —
// см. data/supplierResearch.ts (supplierOfferEmailAddress) и
// api/purchase-send-email.js/purchase-email-webhook.js (несмотря на имя,
// обрабатывают оба направления переписки — закупки и Ресерч, см. комментарий
// в самих файлах). Один в один PurchaseEmail (data/purchaseEmails.ts),
// просто своя таблица — переписка по предложению до выбора поставщика и
// переписка по уже оформленной закупке концептуально разные вещи (RFQ vs
// твёрдый заказ), поэтому не смешиваем в одной таблице.
export interface SupplierOfferEmail {
  id: string;
  offerId: string;
  // Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" — null значит
  // письмо принадлежит "основной" переписке поставщика (той, что была
  // всегда, живёт прямо на offer), непустое значение — конкретной
  // дополнительной заявке (SupplierOrder). offerId всё равно заполнен и
  // здесь — общий счётчик непрочитанных по поставщику (countUnreadSupplierEmails,
  // группировка в SupplierCorrespondenceTab) считает по offerId независимо
  // от того, в какой конкретно ветке письмо.
  orderId: string | null;
  direction: 'in' | 'out';
  fromAddress: string;
  toAddress: string;
  subject: string;
  body: string;
  files: DocumentFile[];
  resendMessageId: string | null;
  // Когда письмо отмечено прочитанным — только для direction='in' (см.
  // markSupplierOfferEmailsRead в lib/supplierOfferEmailsApi.ts), у
  // исходящих всегда null. Непрочитанные входящие — вкладка "Переписка"
  // (src/pages/Suppliers.tsx) и колокольчик уведомлений.
  readAt: string | null;
  extraction: EmailExtraction | null;
  createdAt: string;
}

// Владелец, 2026-09-06: "карточку организации... только к первому письму" —
// "первое" здесь про поставщика (offerId) целиком, не про конкретный тред:
// у одного поставщика может быть несколько заявок/тредов (см. orderId выше,
// "1 заявка на поставку — одна ветка"), но карточку с реквизитами нужно
// отправить один раз за всё время знакомства, не на каждую новую заявку.
// emails — весь список писем ЭТОГО поставщика по всем его тредам разом (тот
// же проп, что уже передаётся в EmailThread/BulkSendModal).
export function isFirstOutgoingToOffer(emails: SupplierOfferEmail[], offerId: string): boolean {
  return !emails.some((e) => e.offerId === offerId && e.direction === 'out');
}

export interface SupplierOfferEmailRow {
  id: string;
  offer_id: string;
  order_id: string | null;
  direction: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  body: string | null;
  files: DocumentFile[] | null;
  resend_message_id: string | null;
  read_at: string | null;
  extraction: EmailExtraction | null;
  created_at: string;
}
