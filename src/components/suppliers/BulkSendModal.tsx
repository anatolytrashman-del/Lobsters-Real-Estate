import { useState } from 'react';
import { Send, Loader2, CheckCircle2, XCircle, TriangleAlert, Paperclip } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import type { SupplierRequest, SupplierOffer } from '../../data/supplierResearch';
import type { SupplierOrder } from '../../data/supplierOrders';
import { insertSupplierOrder } from '../../lib/supplierOrdersApi';
import type { SupplierOfferEmail } from '../../data/supplierOfferEmails';
import { companyCardAttachment } from '../../data/supplierOfferEmails';
import { sendSupplierOfferEmail } from '../../lib/supplierOfferEmailsApi';
import type { LedgerAttachment } from '../../lib/materialLedgerXlsx';
import { emailSignature } from './SupplierCorrespondenceTab';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

// Владелец, 2026-09-04: "Альмира сформировала универсальную большую
// ведомость и хочет разослать её нескольким универсальным поставщикам...
// чтобы не было похоже на массовую отправку — можем отправлять всего
// 2 письма в минуту, как будто это делает человек" — выбрал именно этот
// вариант (не AI-уникализация текста): "плейсхолдеры мне вообще не нужны,
// список материала — это и есть ведомость" — письмо у всех получателей
// буквально одинаковое (кроме адреса и заявки, в которую оно попадает),
// весь анти-спам эффект — только в темпе отправки. ~30с между письмами
// (случайный разброс 25-35с, не ровный интервал) — не жёстко "2/мин", а
// "не быстрее, чем мог бы вручную нажимать человек".
const MIN_DELAY_MS = 25000;
const MAX_DELAY_MS = 35000;
const WARN_THRESHOLD = 8;

function randomDelay(): number {
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultBulkBody(): string {
  return `Добрый день.
Прикладываем ведомость материалов. Просьба прислать коммерческое предложение/счёт по позициям, которые можете поставить — на каждую позицию готовы рассмотреть альтернативы.

Планируем оплачивать со счета юрлица.

С уважением,
${emailSignature()}`;
}

type SendState = 'idle' | 'sending' | 'sent' | 'error';

// Владелец, 2026-09-04, доп. правка: "заголовок ведет на плейсхолдеры мне
// вообще не нужны" — тема/текст одинаковы для всех получателей, поэтому
// достаточно одной формы на всю рассылку, без превью на конкретном
// получателе. Каждый получатель получает СВОЮ новую заявку (SupplierOrder)
// — та же логика, что и у "1 заявка на поставку — одна ветка": если
// получатель когда-нибудь уже переписывался по другому поводу, массовая
// рассылка не подмешивается в старый тред.
export function BulkSendModal({
  request,
  attachment,
  offers,
  emails,
  onClose,
  onOrderCreated,
  onEmailSent,
}: {
  request: SupplierRequest;
  attachment: LedgerAttachment;
  offers: SupplierOffer[];
  emails: SupplierOfferEmail[];
  onClose: () => void;
  onOrderCreated: (order: SupplierOrder) => void;
  onEmailSent: (email: SupplierOfferEmail) => void;
}) {
  // Владелец, 2026-09-04: "поставщик становится доступен для email-переписок"
  // только после верификации (см. более раннюю правку) — рассылать
  // неверифицированным просто некуда, то же самое ограничение, что и на
  // вкладке "Письма" целиком.
  const candidates = offers.filter((o) => o.requestId === request.id && o.email && o.verified);

  // Родитель монтирует этот компонент заново на каждую новую рассылку
  // (bulkSendConfig в Suppliers.tsx — свежий объект на каждое открытие, а не
  // toggle одного и того же), поэтому ленивые инициализаторы useState вместо
  // эффекта сброса — в отличие от MaterialLedgerModal/TemplateFormModal,
  // которые родитель держит смонтированными всегда между открытиями.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const contactedIds = new Set(emails.map((e) => e.offerId));
    return new Set(candidates.filter((o) => !contactedIds.has(o.id)).map((o) => o.id));
  });
  const [subject, setSubject] = useState(() => request.title || 'Поставка материалов');
  const [body, setBody] = useState(() => defaultBulkBody());
  const [sending, setSending] = useState(false);
  const [states, setStates] = useState<Record<string, SendState>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sentCount, setSentCount] = useState(0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === candidates.length ? new Set() : new Set(candidates.map((o) => o.id))));
  }

  async function handleSend() {
    if (sending || selected.size === 0 || !subject.trim() || !body.trim()) return;
    setSending(true);
    const targets = candidates.filter((o) => selected.has(o.id));
    setStates(Object.fromEntries(targets.map((o) => [o.id, 'idle' as SendState])));
    setSentCount(0);

    for (let i = 0; i < targets.length; i++) {
      const offer = targets[i];
      setStates((prev) => ({ ...prev, [offer.id]: 'sending' }));
      try {
        const order = await insertSupplierOrder({
          offerId: offer.id,
          title: request.title ? `Рассылка: ${request.title}` : 'Массовая рассылка',
          communicationStatus: '',
          price: 0,
          currency: 'USD',
          deadline: '',
          requirements: '',
          items: [],
          files: [],
        });
        onOrderCreated(order);
        // Владелец, 2026-09-06: карточка организации — только к первому
        // письму конкретному поставщику (не к каждой новой рассылке ему же).
        // 2026-09-07: для российских поставщиков — карточка ИП, к каждому
        // письму (см. companyCardAttachment в data/supplierOfferEmails.ts).
        const companyCard = companyCardAttachment(offer.country, emails, offer.id);
        const attachments = [attachment, ...(companyCard ? [companyCard] : [])];
        const email = await sendSupplierOfferEmail({
          offerId: offer.id,
          orderId: order.id,
          toAddress: offer.email,
          subject: subject.trim(),
          body,
          attachments,
        });
        onEmailSent(email);
        setStates((prev) => ({ ...prev, [offer.id]: 'sent' }));
        setSentCount((n) => n + 1);
      } catch (err) {
        setStates((prev) => ({ ...prev, [offer.id]: 'error' }));
        setErrors((prev) => ({ ...prev, [offer.id]: errorMessage(err, 'Не удалось отправить') }));
      }
      if (i < targets.length - 1) await sleep(randomDelay());
    }
    setSending(false);
  }

  const done = !sending && sentCount > 0;
  const estimatedMinutes = Math.ceil((selected.size * (MIN_DELAY_MS + MAX_DELAY_MS)) / 2 / 60000);

  return (
    <Modal open onClose={sending ? () => {} : onClose} title={`Разослать «${attachment.fileName}»`}>
      <div className="flex flex-col gap-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-faint">
            В категории «{request.title}» нет верифицированных поставщиков с email — рассылать некому.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-ink-muted">Получатели ({selected.size} из {candidates.length})</span>
              <button type="button" onClick={toggleAll} disabled={sending} className="text-sm font-medium text-primary hover:underline disabled:opacity-50">
                {selected.size === candidates.length ? 'Снять выбор' : 'Выбрать всех'}
              </button>
            </div>
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-control bg-surface-muted p-2">
              {candidates.map((o) => {
                const state = states[o.id];
                const hadEmails = emails.some((e) => e.offerId === o.id);
                return (
                  <label key={o.id} className="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 text-sm hover:bg-surface">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      disabled={sending}
                      onChange={() => toggle(o.id)}
                      className="h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-50"
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {o.name}
                      {hadEmails && <span className="text-ink-faint"> · уже переписывались</span>}
                      {(() => {
                        const companyCard = companyCardAttachment(o.country, emails, o.id);
                        if (!companyCard) return null;
                        return (
                          <span className="text-ink-faint" title={`${companyCard.fileName}${o.country === 'Россия' ? '' : ' — первое письмо этому поставщику'}`}>
                            {' '}· + {o.country === 'Россия' ? 'карточка ИП' : 'карточка организации'}
                          </span>
                        );
                      })()}
                    </span>
                    {state === 'sending' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-muted" />}
                    {state === 'sent' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
                    {state === 'error' && (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-danger" title={errors[o.id]}>
                        <XCircle className="h-4 w-4" />
                        ошибка
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <Input label="Тема" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sending} />
            <Textarea label="Сообщение" rows={5} value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} />

            <div className="flex items-center gap-2 rounded-control border border-border-strong bg-surface-muted p-3 text-xs text-ink-muted">
              <Paperclip className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{attachment.fileName} — уйдёт вложением каждому получателю</span>
            </div>

            {selected.size > WARN_THRESHOLD && (
              <div className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
                <TriangleAlert className="h-4 w-4 shrink-0 translate-y-0.5" />
                <span>
                  {selected.size} получателей — чтобы не выглядело как массовая рассылка, письма уходят по одному с паузой
                  ~30с. Вся отправка займёт примерно {estimatedMinutes} мин, не закрывайте вкладку.
                </span>
              </div>
            )}

            {sending && (
              <p className="text-sm text-ink-muted">
                Отправлено {sentCount} из {selected.size} — идёт рассылка, не закрывайте вкладку.
              </p>
            )}
            {done && <p className="text-sm text-success">Готово: отправлено {sentCount} из {selected.size}.</p>}
          </>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={sending}>
            {done ? 'Закрыть' : 'Отмена'}
          </Button>
          {candidates.length > 0 && !done && (
            <Button
              type="button"
              icon={sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              disabled={sending || selected.size === 0 || !subject.trim() || !body.trim()}
              onClick={handleSend}
            >
              {sending ? 'Отправляем...' : `Разослать (${selected.size})`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
