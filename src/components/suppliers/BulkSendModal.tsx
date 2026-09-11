import { useEffect, useMemo, useState } from 'react';
import { Send, Loader2, TriangleAlert, Paperclip, FileText, Plus } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { ToggleGroup } from '../ui/ToggleGroup';
import { countryFlag, SUPPLIER_COUNTRIES, type SupplierRequest, type SupplierOffer } from '../../data/supplierResearch';
import type { SupplierOfferEmail } from '../../data/supplierOfferEmails';
import type { LedgerAttachment } from '../../lib/materialLedgerXlsx';
import type { LegalEntity } from '../../data/legalEntities';
import type { EmailTemplate } from '../../data/emailTemplates';
import { insertBulkSendJob, fetchQueuedBulkSendOfferIds } from '../../lib/bulkSendJobsApi';
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

// Владелец, 2026-09-11: "я собрал 20 поставщиков и разослал ТЗ всем, потом
// собрал ещё 20 — теперь хочу написать массово по категории, но только тем,
// кому не писал ранее". Раньше история переписки влияла только на
// галочки по умолчанию (уже писавшие приходили снятыми) — в списке из
// сорока строк это нечитаемо и легко испортить одним "Выбрать всех".
// Теперь это полноценный фильтр самого списка, "Новые" — режим по
// умолчанию, то есть повторная рассылка по категории по умолчанию уходит
// ровно новому пополнению.
const FILTER_NEW = 'Кому ещё не писали';
const FILTER_ALL = 'Все';
const FILTER_CONTACTED = 'Кому уже писали';
const FILTERS = [FILTER_NEW, FILTER_ALL, FILTER_CONTACTED];

// Что мы знаем про предыдущие контакты с конкретным поставщиком.
// 'sent' — реально ушедшее письмо (любое исходящее, хоть массовое, хоть
// из одиночного треда). 'queued' — письмо этому поставщику уже стоит в
// очереди рассылки, строки supplier_offer_emails ещё нет (см.
// fetchQueuedBulkSendOfferIds). 'sameEmail' — этому поставщику не писали,
// но на ТОТ ЖЕ адрес уже уходило письмо с другой карточки: при сборе
// поставщиков пачками один и тот же поставщик легко попадает в несколько
// категорий разными карточками, и для человека на том конце это всё равно
// "мне уже писали".
// Владелец, 2026-09-11 (продолжение того же захода): "по ООО ГЛАССВЭЙ у нас
// есть КП в базе, значит мы ему писали вручную и такому поставщику вообще не
// нужно писать по этой закупке". Реальные данные: у ГЛАССВЭЙ price=1 000 272
// и 8 позиций, а писем в системе ноль — переписка шла мимо (телефон, личная
// почта, счёт занесли в карточку руками). Поэтому 'quoted' — отдельный
// признак "мы с ним уже работаем", не завязанный на supplier_offer_emails.
type ContactStatus =
  | { kind: 'none' }
  | { kind: 'sent'; at: string }
  | { kind: 'queued' }
  | { kind: 'quoted' }
  | { kind: 'sameEmail'; via: string }
  | { kind: 'sameDomain'; via: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Публичные почтовики: адреса на них не связывают карточки между собой —
// два разных поставщика вполне могут сидеть на @mail.ru.
const PUBLIC_EMAIL_DOMAINS = new Set([
  'mail.ru',
  'inbox.ru',
  'bk.ru',
  'list.ru',
  'internet.ru',
  'gmail.com',
  'googlemail.com',
  'yandex.ru',
  'yandex.by',
  'yandex.com',
  'ya.ru',
  'rambler.ru',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'tut.by',
  'mail.by',
]);

// Владелец, 2026-09-11: в категории "Грильято" оказались ДВЕ карточки одной
// компании "Авангард" — mm4@avangardrf.ru и mm6@avangardrf.ru (разные
// менеджеры одного поставщика): одному писали, у второго лежит КП, а дедуп
// по адресу их не связал, потому что адреса разные. Корпоративный домен —
// признак той же компании; публичные почтовики (см. выше) сюда не идут.
function corporateDomain(email: string): string | null {
  const at = normalizeEmail(email).lastIndexOf('@');
  if (at < 0) return null;
  const domain = normalizeEmail(email).slice(at + 1);
  if (!domain || PUBLIC_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

// "Мы уже работаем с этим поставщиком" по самой карточке, без писем: есть
// распознанное/занесённое КП. files сюда сознательно НЕ входят — к карточке
// могли приложить презентацию или прайс, это ещё не переписка, а вот цена
// и позиции появляются только из реального КП.
function hasQuote(offer: SupplierOffer): boolean {
  return offer.price > 0 || offer.items.length > 0;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

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
  const candidates = useMemo(
    () =>
      countryChosen
        ? offers.filter(
            (o) =>
              o.requestId === selectedRequestId &&
              o.email &&
              o.verified &&
              (selectedCountry === ALL_COUNTRIES || (o.country || SUPPLIER_COUNTRIES[0]) === selectedCountry),
            )
        : [],
    [offers, countryChosen, selectedRequestId, selectedCountry],
  );

  // Письма, уже стоящие в очереди рассылки (ещё не отправленные воркером) —
  // без них вторая рассылка по той же категории, поставленная пока идёт
  // первая, ушла бы части поставщиков дублем. Грузим один раз на открытии
  // модалки; ошибка не блокирует рассылку — просто считаем, что очередь
  // пуста (худший случай — то же поведение, что было до этой правки).
  const [queuedOfferIds, setQueuedOfferIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    fetchQueuedBulkSendOfferIds()
      .then((ids) => {
        if (!cancelled) setQueuedOfferIds(new Set(ids));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // История контактов по всем поставщикам разом: последнее ИСХОДЯЩЕЕ письмо
  // на карточку (входящие не в счёт — "кому я писал" это про исходящие) и
  // отдельно — по адресу почты, чтобы поймать одного и того же поставщика,
  // заведённого разными карточками в разных категориях.
  const contactedByOffer = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of emails) {
      if (e.direction !== 'out') continue;
      const prev = map.get(e.offerId);
      if (!prev || e.createdAt > prev) map.set(e.offerId, e.createdAt);
    }
    return map;
  }, [emails]);

  // Карточка, с которой мы уже как-то контактировали: письмо ушло, стоит в
  // очереди или лежит КП. От неё считаются "тот же адрес"/"тот же домен" —
  // адрес и домен ведут на название той карточки, чтобы в списке было видно,
  // с кем именно уже работаем.
  const touched = useMemo(
    () => (o: SupplierOffer) => contactedByOffer.has(o.id) || queuedOfferIds.has(o.id) || hasQuote(o),
    [contactedByOffer, queuedOfferIds],
  );

  const contactedByEmail = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of offers) {
      if (!o.email || !touched(o)) continue;
      const key = normalizeEmail(o.email);
      if (!map.has(key)) map.set(key, o.name);
    }
    return map;
  }, [offers, touched]);

  const contactedByDomain = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of offers) {
      if (!o.email || !touched(o)) continue;
      const domain = corporateDomain(o.email);
      if (domain && !map.has(domain)) map.set(domain, o.name);
    }
    return map;
  }, [offers, touched]);

  const statusOf = useMemo(() => {
    const cache = new Map<string, ContactStatus>();
    return (offer: SupplierOffer): ContactStatus => {
      const cached = cache.get(offer.id);
      if (cached) return cached;
      const sentAt = contactedByOffer.get(offer.id);
      const domain = offer.email ? corporateDomain(offer.email) : null;
      const viaEmail = offer.email ? contactedByEmail.get(normalizeEmail(offer.email)) : undefined;
      const viaDomain = domain ? contactedByDomain.get(domain) : undefined;
      let status: ContactStatus;
      if (sentAt) status = { kind: 'sent', at: sentAt };
      else if (queuedOfferIds.has(offer.id)) status = { kind: 'queued' };
      else if (hasQuote(offer)) status = { kind: 'quoted' };
      else if (viaEmail) status = { kind: 'sameEmail', via: viaEmail };
      else if (viaDomain) status = { kind: 'sameDomain', via: viaDomain };
      else status = { kind: 'none' };
      cache.set(offer.id, status);
      return status;
    };
  }, [contactedByOffer, contactedByEmail, contactedByDomain, queuedOfferIds]);

  // Владелец, 2026-09-11: "у нас дохера поставщиков новых по Грильято, а оно
  // видит только два" — в той категории 56 поставщиков, но 40 из них не
  // верифицированы, а рассылка работает только по верифицированным (правило
  // 2026-09-04: закупщик сперва проверяет поля карточки). Владелец правило
  // оставил ("тогда сначала верифицируем"), но молча прятать сорок карточек
  // нельзя — иначе каждый раз гадать, куда делось пополнение.
  const unverifiedCount = useMemo(
    () =>
      countryChosen
        ? offers.filter(
            (o) =>
              o.requestId === selectedRequestId &&
              o.email &&
              !o.verified &&
              (selectedCountry === ALL_COUNTRIES || (o.country || SUPPLIER_COUNTRIES[0]) === selectedCountry),
          ).length
        : 0,
    [offers, countryChosen, selectedRequestId, selectedCountry],
  );

  const [filter, setFilter] = useState(FILTER_NEW);
  const newCount = useMemo(() => candidates.filter((o) => statusOf(o).kind === 'none').length, [candidates, statusOf]);
  const visible = useMemo(() => {
    if (filter === FILTER_ALL) return candidates;
    const wantNew = filter === FILTER_NEW;
    return candidates.filter((o) => (statusOf(o).kind === 'none') === wantNew);
  }, [candidates, filter, statusOf]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Пересобираем список отмеченных получателей при смене категории/страны/
  // фильтра — прежний набор id мог относиться к другому срезу. По умолчанию
  // отмечены только те, кому ещё не писали: в режиме "Кому уже писали" это
  // значит пустой выбор, повторное письмо нужно отметить руками, случайным
  // "Выбрать всех" дубль не уедет.
  useEffect(() => {
    setSelected(new Set(visible.filter((o) => statusOf(o).kind === 'none').map((o) => o.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRequestId, selectedCountry, filter, queuedOfferIds]);

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

  // "Выбрать всех" — всегда про видимый сейчас срез, не про всю категорию:
  // в режиме "Кому уже писали" он не должен вытягивать обратно тех, кого
  // фильтр только что скрыл.
  function toggleAll() {
    setSelected((prev) => {
      const allVisibleSelected = visible.length > 0 && visible.every((o) => prev.has(o.id));
      return allVisibleSelected ? new Set() : new Set(visible.map((o) => o.id));
    });
  }

  // Отмеченные и при этом видимые — страховка от отправки тому, кто отпал
  // после смены фильтра/категории (селект сбрасывается эффектом, но порядок
  // рендера на это закладывать не стоит).
  const recipients = visible.filter((o) => selected.has(o.id));

  async function handleQueue() {
    if (queuing || recipients.length === 0 || !subject.trim() || !body.trim() || !legalEntityChosen || !countryChosen) return;
    setQueuing(true);
    setQueueError(null);
    try {
      await insertBulkSendJob({
        requestId: selectedRequestId,
        legalEntityId: legalEntity?.id ?? null,
        subject,
        body,
        attachment,
        offerIds: recipients.map((o) => o.id),
      });
      setQueuedCount(recipients.length);
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
                {/* Владелец, 2026-09-11: "хочу написать массово по категории,
                    но только тем, кому не писал ранее" — счётчик в подписи
                    показывает размер пополнения категории, чтобы не считать
                    строки глазами. */}
                <ToggleGroup
                  label={`Кому пишем — новых в категории: ${newCount} из ${candidates.length}`}
                  options={FILTERS}
                  value={filter}
                  onChange={setFilter}
                />

                {unverifiedCount > 0 && (
                  <p className="-mt-1 text-xs text-ink-faint">
                    Ещё {unverifiedCount} с email в этой категории не прошли верификацию — в рассылку они не попадают.
                    Откройте карточку, проверьте поля и сохраните, тогда появятся здесь.
                  </p>
                )}

                {visible.length === 0 ? (
                  <p className="text-sm text-ink-faint">
                    {filter === FILTER_NEW
                      ? 'В этой категории всем подходящим поставщикам уже писали — новых нет. Переключите на «Все», если нужно написать повторно.'
                      : 'Здесь пусто: этой категории ещё не писали ни одному поставщику.'}
                  </p>
                ) : (
                  <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-muted">Получатели ({recipients.length} из {visible.length})</span>
                  <button type="button" onClick={toggleAll} className="text-sm font-medium text-primary-hover hover:underline">
                    {recipients.length === visible.length ? 'Снять выбор' : 'Выбрать всех'}
                  </button>
                </div>
                <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-control bg-surface-muted p-2">
                  {visible.map((o) => {
                    const status = statusOf(o);
                    // Строка обрезается по ширине модалки, поэтому подпись
                    // про предыдущий контакт дублируется в title — на узком
                    // экране её иначе не прочитать.
                    const statusHint =
                      status.kind === 'sent'
                        ? `Писали ${formatDay(status.at)}`
                        : status.kind === 'queued'
                          ? 'Письмо этому поставщику уже стоит в очереди рассылки'
                          : status.kind === 'quoted'
                            ? 'В карточке уже есть КП — с этим поставщиком мы работаем, писать по закупке заново не нужно'
                            : status.kind === 'sameEmail'
                              ? `На адрес ${o.email} уже писали — карточка «${status.via}»`
                              : status.kind === 'sameDomain'
                                ? `Та же компания, что и «${status.via}» (общий почтовый домен ${corporateDomain(o.email)}) — ей уже писали`
                                : 'Ещё не писали';
                    return (
                      <label
                        key={o.id}
                        title={`${o.name} — ${statusHint}`}
                        className="flex items-center gap-2.5 rounded-control px-1.5 py-1.5 text-sm hover:bg-surface"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(o.id)}
                          onChange={() => toggle(o.id)}
                          className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">
                          <span title={o.country || SUPPLIER_COUNTRIES[0]}>{countryFlag(o.country || SUPPLIER_COUNTRIES[0])}</span> {o.name}
                          {status.kind === 'sent' && <span className="text-ink-faint"> · писали {formatDay(status.at)}</span>}
                          {status.kind === 'queued' && <span className="text-warning"> · письмо уже в очереди</span>}
                          {status.kind === 'quoted' && <span className="text-ink-faint"> · есть КП, уже работаем</span>}
                          {status.kind === 'sameEmail' && (
                            <span className="text-ink-faint"> · на этот адрес уже писали</span>
                          )}
                          {status.kind === 'sameDomain' && (
                            <span className="text-ink-faint"> · та же компания, что «{status.via}»</span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
                  </>
                )}

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

                {recipients.length > WARN_THRESHOLD && (
                  <div className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg p-3 text-xs text-warning">
                    <TriangleAlert className="h-4 w-4 shrink-0 translate-y-0.5" />
                    <span>
                      {recipients.length} получателей — рассылка пойдёт фоном с паузами между письмами, чтобы не выглядеть
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
              disabled={queuing || recipients.length === 0 || !subject.trim() || !body.trim()}
              onClick={handleQueue}
            >
              {queuing ? 'Ставим в очередь...' : `Поставить в очередь (${recipients.length})`}
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
