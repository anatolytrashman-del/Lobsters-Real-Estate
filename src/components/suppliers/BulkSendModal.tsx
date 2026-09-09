import { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, TriangleAlert, Paperclip, FileText, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { countryFlag, SUPPLIER_COUNTRIES, type SupplierRequest, type SupplierOffer } from '../../data/supplierResearch';
import type { SupplierOfferEmail } from '../../data/supplierOfferEmails';
import type { LedgerAttachment } from '../../lib/materialLedgerXlsx';
import type { LegalEntity } from '../../data/legalEntities';
import type { EmailTemplate } from '../../data/emailTemplates';
import { insertBulkSendJob } from '../../lib/bulkSendJobsApi';
import { emailSignature } from './SupplierCorrespondenceTab';
import { TemplateFormModal } from './EmailTemplates';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

// Владелец, 2026-09-04: "Альмира сформировала универсальную большую
// ведомость и хочет разослать её нескольким универсальным поставщикам...
// чтобы не было похоже на массовую отправку — можем отправлять всего
// 2 письма в минуту, как будто это делает человек" — плейсхолдеры не нужны,
// список материала — это и есть ведомость. Владелец, 2026-09-09: "можем
// сделать отправку фоновым процессом, чтобы вкладку можно было закрыть?" —
// эта модалка больше НЕ гоняет цикл отправки сама (раньше — прямо в
// браузере, с паузами 25-35с между письмами, закрыл вкладку — рассылка
// обрывается) — она только СТАВИТ задание в очередь (bulk_send_jobs +
// bulk_send_job_items, insertBulkSendJob), а реальную отправку с тем же
// темпом делает scripts/process-bulk-send-jobs.mjs через крон-воркфлоу
// (.github/workflows/process-bulk-send-jobs.yml, раз в 5 минут) — вкладку
// можно закрыть сразу после постановки в очередь.
const WARN_THRESHOLD = 8;

// Владелец, 2026-09-09: "юрлицо и страну нужно выбирать вручную, ООО
// Матрёшка не должна подставляться по умолчанию" — оба поля начинаются
// пустыми (плейсхолдер в Select), эти сентинелы — явный осознанный выбор
// "без карточки"/"все страны", отличный от "ещё не выбрано" (пустая
// строка), который блокирует отправку и список получателей.
const NO_LEGAL_ENTITY = 'Без карточки организации';
const ALL_COUNTRIES = 'Все страны';

function defaultBulkBody(): string {
  return `Добрый день.
Прикладываем ведомость материалов. Просьба прислать коммерческое предложение/счёт по позициям, которые можете поставить — на каждую позицию готовы рассмотреть альтернативы.

Планируем оплачивать со счета юрлица.

С уважением,
${emailSignature()}`;
}

// Владелец, 2026-09-04, доп. правка: "заголовок ведет на плейсхолдеры мне
// вообще не нужны" — тема/текст одинаковы для всех получателей, поэтому
// достаточно одной формы на всю рассылку, без превью на конкретном
// получателе. Каждый получатель получает СВОЮ новую заявку (SupplierOrder)
// — та же логика, что и у "1 заявка на поставку — одна ветка": если
// получатель когда-нибудь уже переписывался по другому поводу, массовая
// рассылка не подмешивается в старый тред. Персонализация {компания}/
// {контакт} и вложение карточки организации (только первому письму
// конкретному поставщику) теперь считаются в worker-скрипте на отправке,
// не здесь.
export function BulkSendModal({
  request,
  requests,
  attachment,
  offers,
  emails,
  templates,
  legalEntities,
  onClose,
  onTemplatesChange,
}: {
  request: SupplierRequest;
  // Владелец, 2026-09-09: "нельзя добавить новый шаблон" — полный список
  // запросов нужен форме создания шаблона (TemplateFormModal), чтобы можно
  // было привязать шаблон к любому запросу, не только к текущему. Он же,
  // 2026-09-09 (второй заход): "непонятно, как ты выбираешь категорию
  // поставщиков... нужен ручной выбор" — категория теперь выбирается прямо
  // в этой модалке (Select ниже), а не жёстко фиксирована тем, по какой
  // категории кликнули "Массовая отправка" снаружи.
  requests: SupplierRequest[];
  attachment: LedgerAttachment;
  offers: SupplierOffer[];
  emails: SupplierOfferEmail[];
  templates: EmailTemplate[];
  legalEntities: LegalEntity[];
  onClose: () => void;
  onTemplatesChange: (templates: EmailTemplate[]) => void;
}) {
  // Категория — стартует с той, по которой кликнули "Массовая отправка"
  // снаружи (это уже осознанный клик), но её можно сменить, не закрывая
  // модалку — владелец: "нужен ручной выбор категории поставщиков".
  const [selectedRequestId, setSelectedRequestId] = useState(request.id);
  const selectedRequest = requests.find((r) => r.id === selectedRequestId) ?? request;

  // Владелец, 2026-09-09: "ООО Матрёшка будет не по умолчанию. Выбор
  // юрлица и страны нужен ручной" — обе пустые, пока человек сам не
  // выберет (Select показывает плейсхолдер), никакого resolveRequestLegalEntity
  // с фолбэком на юрлицо по умолчанию.
  const [selectedLegalEntityId, setSelectedLegalEntityId] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const legalEntityChosen = selectedLegalEntityId !== '';
  const countryChosen = selectedCountry !== '';
  const legalEntity =
    selectedLegalEntityId && selectedLegalEntityId !== 'none'
      ? legalEntities.find((e) => e.id === selectedLegalEntityId) ?? null
      : null;

  // Владелец, 2026-09-09: "если выбираем ИП Трэшмен или Матрешка, страна
  // автоматически Россия; а если ЛАВЭ — Беларусь" — юрлицо однозначно
  // определяет страну поставки (LegalEntity.country, см. карточку юрлица),
  // поэтому выбор юрлица сразу подставляет страну в соседний Select — не
  // нарушает "ручной выбор" из предыдущей правки (страна по-прежнему видна
  // и остаётся обычным Select, можно поправить вручную), просто убирает
  // лишний клик там, где ответ и так предопределён.
  useEffect(() => {
    if (legalEntity?.country) setSelectedCountry(legalEntity.country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLegalEntityId]);

  // Владелец, 2026-09-04: "поставщик становится доступен для email-переписок"
  // только после верификации (см. более раннюю правку) — рассылать
  // неверифицированным просто некуда, то же самое ограничение, что и на
  // вкладке "Письма" целиком. Владелец, 2026-09-09: страна теперь ФИЛЬТРУЕТ
  // список — пока страна не выбрана, получателей не показываем вовсе
  // (не смысла демонстрировать список, который может тут же перефильтроваться).
  const candidates = countryChosen
    ? offers.filter(
        (o) =>
          o.requestId === selectedRequestId &&
          o.email &&
          o.verified &&
          (selectedCountry === ALL_COUNTRIES || (o.country || SUPPLIER_COUNTRIES[0]) === selectedCountry),
      )
    : [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Пересобираем список отмеченных получателей при смене категории/страны —
  // прежний набор id мог относиться к другому фильтру. По умолчанию отмечены
  // те, с кем ещё не переписывались.
  useEffect(() => {
    const contactedIds = new Set(emails.map((e) => e.offerId));
    setSelected(new Set(candidates.filter((o) => !contactedIds.has(o.id)).map((o) => o.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRequestId, selectedCountry]);

  const [subject, setSubject] = useState(() => request.title || 'Поставка материалов');
  const [body, setBody] = useState(() => defaultBulkBody());
  const [queuing, setQueuing] = useState(false);
  const [queuedCount, setQueuedCount] = useState<number | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Владелец, 2026-09-09: "отправка единичных и массовых писем должна быть
  // максимально похожа" — тот же выбор шаблона, что и в EmailThread (own
  // request первыми, общие следом). Текст шаблона подставляется как есть, с
  // НЕразрешёнными плейсхолдерами {компания}/{контакт} — единого "офера" на
  // всю рассылку нет, каждый получатель получает свою подстановку в момент
  // отправки (worker-скрипт), а не один и тот же текст на всех.
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [addTemplateOpen, setAddTemplateOpen] = useState(false);
  const orderedTemplates = useMemo(() => {
    const own = templates.filter((t) => t.requestId === selectedRequestId);
    const shared = templates.filter((t) => t.requestId !== selectedRequestId);
    return [...own, ...shared];
  }, [templates, selectedRequestId]);

  function handlePickTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    if (body.trim() && !window.confirm('Заменить уже введённый текст письма шаблоном?')) return;
    setSubject(template.subject);
    setBody(template.body);
  }

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

  async function handleQueue() {
    if (queuing || selected.size === 0 || !subject.trim() || !body.trim() || !legalEntityChosen || !countryChosen) return;
    setQueuing(true);
    setQueueError(null);
    try {
      await insertBulkSendJob({
        requestId: selectedRequestId,
        legalEntityId: legalEntity?.id ?? null,
        subject,
        body,
        attachment,
        offerIds: [...selected],
      });
      setQueuedCount(selected.size);
    } catch (err) {
      setQueueError(errorMessage(err, 'Не удалось поставить рассылку в очередь'));
    } finally {
      setQueuing(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Массовая рассылка">
      <div className="flex flex-col gap-4">
        {queuedCount !== null ? (
          <p className="text-sm text-success">
            Готово: {queuedCount} писем поставлено в очередь. Можно закрыть вкладку — рассылка идёт в фоне, с паузами между
            письмами.
          </p>
        ) : (
          <>
            <Select
              label="Категория поставщиков"
              placeholder="Не выбрана"
              options={requests.map((r) => r.title)}
              value={selectedRequest.title}
              onChange={(label) => {
                const r = requests.find((x) => x.title === label);
                if (r) setSelectedRequestId(r.id);
              }}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Юрлицо"
                placeholder="Выберите юрлицо"
                options={[NO_LEGAL_ENTITY, ...legalEntities.map((e) => e.shortName || e.name)]}
                value={
                  selectedLegalEntityId === ''
                    ? ''
                    : selectedLegalEntityId === 'none'
                      ? NO_LEGAL_ENTITY
                      : legalEntities.find((e) => e.id === selectedLegalEntityId)?.shortName ||
                        legalEntities.find((e) => e.id === selectedLegalEntityId)?.name ||
                        ''
                }
                onChange={(label) => {
                  if (label === NO_LEGAL_ENTITY) {
                    setSelectedLegalEntityId('none');
                    return;
                  }
                  const e = legalEntities.find((x) => (x.shortName || x.name) === label);
                  setSelectedLegalEntityId(e?.id ?? '');
                }}
              />
              <Select
                label="Страна получателей"
                placeholder="Выберите страну"
                options={[ALL_COUNTRIES, ...SUPPLIER_COUNTRIES]}
                value={selectedCountry}
                onChange={(label) => setSelectedCountry(label)}
              />
            </div>

            {!legalEntityChosen || !countryChosen ? (
              <p className="text-sm text-ink-faint">Выберите юрлицо и страну получателей, чтобы увидеть список поставщиков.</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-ink-faint">
                В категории «{selectedRequest.title}»
                {selectedCountry !== ALL_COUNTRIES ? ` и стране «${selectedCountry}»` : ''} нет верифицированных поставщиков
                с email — рассылать некому.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-muted">Получатели ({selected.size} из {candidates.length})</span>
                  <button type="button" onClick={toggleAll} className="text-sm font-medium text-primary hover:underline">
                    {selected.size === candidates.length ? 'Снять выбор' : 'Выбрать всех'}
                  </button>
                </div>
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-control bg-surface-muted p-2">
                  {candidates.map((o) => {
                    const hadEmails = emails.some((e) => e.offerId === o.id);
                    return (
                      <label key={o.id} className="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 text-sm hover:bg-surface">
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => toggle(o.id)}
                          className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">
                          <span title={o.country || SUPPLIER_COUNTRIES[0]}>{countryFlag(o.country || SUPPLIER_COUNTRIES[0])}</span> {o.name}
                          {hadEmails && <span className="text-ink-faint"> · уже переписывались</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Владелец, 2026-09-09: "нельзя добавить новый шаблон из этого
                    интерфейса" — кнопка "+" рядом с селектом открывает ту же
                    форму, что и общий менеджер шаблонов (TemplateFormModal),
                    сразу привязывая новый шаблон к текущей категории
                    (initialRequestId) и выбирая его после сохранения. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm text-ink-muted">Шаблон</span>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => handlePickTemplate(e.target.value)}
                      className="flex-1 rounded-control border border-transparent bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-primary"
                    >
                      <option value="">Без шаблона</option>
                      {orderedTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setAddTemplateOpen(true)}>
                      Новый
                    </Button>
                  </div>
                </div>

                <Input label="Тема" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Textarea label="Сообщение" rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                <p className="-mt-2 text-xs text-ink-faint">
                  {'{компания} и {контакт} подставляются отдельно для каждого получателя при отправке.'}
                </p>

                <div className="flex flex-col gap-1.5 rounded-control border border-border-strong bg-surface-muted p-3 text-xs text-ink-muted">
                  <div className="flex items-center gap-2">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{attachment.fileName} — уйдёт вложением каждому получателю</span>
                  </div>
                  {/* Владелец, 2026-09-09: "в прикреплённых файлах вижу только
                      ведомость материала, но не реквизиты" — карточка
                      организации теперь всегда отдельной строкой, если у
                      выбранного вручную юрлица есть файл карточки (само
                      прикрепление — только первому письму каждому поставщику
                      — считает worker-скрипт на отправке). */}
                  {legalEntity?.cardFile && (
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {legalEntity.cardFile.fileName} — карточка «{legalEntity.shortName || legalEntity.name}», уйдёт
                        только тем, кому пишем впервые
                      </span>
                    </div>
                  )}
                </div>
                {legalEntity && !legalEntity.cardFile && (
                  <p className="text-xs text-ink-faint">
                    Юрлицо «{legalEntity.shortName || legalEntity.name}» выбрано, но карточка организации для него ещё не
                    загружена (Документы → Юрлица) — первым письмам она не приложится.
                  </p>
                )}

                {selected.size > WARN_THRESHOLD && (
                  <div className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
                    <TriangleAlert className="h-4 w-4 shrink-0 translate-y-0.5" />
                    <span>
                      {selected.size} получателей — рассылка пойдёт фоном с паузами между письмами, чтобы не выглядеть
                      массовой. Вкладку можно закрыть сразу после постановки в очередь.
                    </span>
                  </div>
                )}

                {queueError && <p className="text-sm text-danger">{queueError}</p>}
              </>
            )}
          </>
        )}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            {queuedCount !== null ? 'Закрыть' : 'Отмена'}
          </Button>
          {legalEntityChosen && countryChosen && candidates.length > 0 && queuedCount === null && (
            <Button
              type="button"
              icon={queuing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              disabled={queuing || selected.size === 0 || !subject.trim() || !body.trim()}
              onClick={handleQueue}
            >
              {queuing ? 'Ставим в очередь...' : `Поставить в очередь (${selected.size})`}
            </Button>
          )}
        </div>
      </div>

      <TemplateFormModal
        open={addTemplateOpen}
        template={null}
        requests={requests}
        initialRequestId={selectedRequestId}
        onClose={() => setAddTemplateOpen(false)}
        onSaved={(t) => {
          onTemplatesChange([...templates, t]);
          setSelectedTemplateId(t.id);
          setSubject(t.subject);
          setBody(t.body);
        }}
      />
    </Modal>
  );
}
