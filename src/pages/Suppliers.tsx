import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Loader2, Trash2, Pencil, Send, Phone, Globe, Paperclip, Upload, X, ImageOff, Mail, Search, Check, FileText, ExternalLink, MessageCircle, ChevronDown } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { AddableSelect } from '../components/ui/AddableSelect';
import { Textarea } from '../components/ui/Textarea';
import { Modal } from '../components/ui/Modal';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Select } from '../components/ui/Select';
import { ContactValue } from '../components/ui/ContactValue';
import { ContractorsResearch } from '../components/contractors/ContractorsResearch';
import { cn } from '../lib/cn';
import { formatPhoneDisplay } from '../lib/formatPhone';
import { currencySymbols, type Currency } from '../data/transactions';
import type { ExchangeRate } from '../data/exchangeRates';
import { fetchTodayRate } from '../lib/exchangeRatesApi';
import { convertToUsd } from '../lib/currencyConvert';
import type { DocumentFile } from '../data/contractorDocuments';
import {
  RESEARCH_CONTACT_METHODS,
  RESEARCH_CURRENCIES,
  SUPPLIER_COUNTRIES,
  SUPPLIER_REQUEST_GROUPS,
  SUPPLIER_REQUEST_GROUP_LABELS,
  SUPPLIER_COMPARISON_MODES,
  SUPPLIER_COMPARISON_MODE_LABELS,
  SUPPLIER_COMPARISON_MODE_HINTS,
  guessCountryFromWebsite,
  countryFlag,
  messengerLink,
  offerCommunicationStatus,
  OFFER_COMMUNICATION_STATUS_LABEL,
  SUPPLIER_MESSENGER_TYPES,
  type ResearchContactMethod,
  type SupplierRequest,
  type SupplierRequestGroup,
  type SupplierComparisonMode,
  type SupplierOffer,
  type SupplierMessengerType,
  type SupplierMessengerContact,
} from '../data/supplierResearch';
import type { SupplierOfferEmail } from '../data/supplierOfferEmails';
import { fetchAllSupplierOfferEmails, markSupplierOfferEmailsRead } from '../lib/supplierOfferEmailsApi';
import { EmailThread, SupplierCorrespondenceTab, countUnreadSupplierEmails } from '../components/suppliers/SupplierCorrespondenceTab';
import { MaterialLedgerModal } from '../components/suppliers/MaterialLedgerModal';
import { BulkSendModal } from '../components/suppliers/BulkSendModal';
import type { LedgerAttachment } from '../lib/materialLedgerXlsx';
import type { EmailTemplate } from '../data/emailTemplates';
import { fetchEmailTemplates } from '../lib/emailTemplatesApi';
import type { MaterialLedger } from '../data/materialLedgers';
import { fetchMaterialLedgers, deleteMaterialLedger } from '../lib/materialLedgersApi';
import type { SupplierOrder } from '../data/supplierOrders';
import { fetchSupplierOrders } from '../lib/supplierOrdersApi';
import type { SupplierQuote } from '../data/supplierQuotes';
import { fetchSupplierQuotes, updateSupplierQuote, deleteSupplierQuote } from '../lib/supplierQuotesApi';
import {
  fetchSupplierRequests,
  insertSupplierRequest,
  updateSupplierRequest,
  deleteSupplierRequest,
  fetchSupplierOffers,
  insertSupplierOffer,
  updateSupplierOffer,
  deleteSupplierOffer,
  uploadSupplierFile,
  type SupplierRequestInput,
} from '../lib/supplierResearchApi';
import {
  queueSupplierWebSearch,
  fetchSupplierWebSearchJobs,
  recognizeInvoiceFile,
  type SupplierWebSearchJob,
  type RecognizedInvoiceItem,
} from '../lib/supplierWebSearchApi';
import {
  fetchSupplierEnrichmentJobs,
  enrichmentStateByOffer,
  supplierVerificationStatus,
  SUPPLIER_VERIFICATION_LABEL,
  type SupplierEnrichmentJob,
  type SupplierVerificationStatus,
  type OfferEnrichmentState,
} from '../lib/supplierEnrichmentApi';
import { logActivity } from '../lib/activityLogApi';
import { purchaseItemTotal, type PurchaseItem } from '../data/purchases';
import { emptySection, type Estimate, type EstimateMaterial, type EstimateSection } from '../data/estimates';
import { fetchEstimates, updateEstimate } from '../lib/estimatesApi';
import type { RealtyObject } from '../data/objects';
import { fetchObjects } from '../lib/objectsApi';
import type { LegalEntity } from '../data/legalEntities';
import { fetchLegalEntities } from '../lib/legalEntitiesApi';
import { MaterialsTable, groupMaterials } from '../components/estimates/MaterialsTable';
import { EstimateMaterialFormModal } from '../components/estimates/EstimateMaterialFormModal';
import { EstimateMaterialCommentsModal } from '../components/estimates/EstimateMaterialCommentsModal';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatPrice(price: number, currency: Currency): string {
  const formatted = price.toLocaleString('ru-RU');
  const symbol = currencySymbols[currency];
  return currency === 'USD' ? `${symbol}${formatted}` : `${formatted} ${symbol}`;
}

// Короткий вид ссылки в таблице — просто домен, без протокола/пути, чтобы
// колонка не растягивалась длинными урлами. Если строка не парсится как URL
// (ввели без https://), показываем как есть — свободный ввод, не хотим
// блокировать сохранение из-за формата.
// Сколько времени показывать баннер "Готово: добавлено N поставщиков" после
// завершения поиска (см. latestVisibleJobForRequest).
const DONE_BANNER_TTL_MS = 30 * 60_000;

// "добавлен 31 поставщик" / "добавлено 2 поставщика" / "добавлено 5
// поставщиков" — иначе в баннере получалось "добавлено 31 поставщиков".
function addedSuppliersLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `добавлен ${count} поставщик`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `добавлено ${count} поставщика`;
  return `добавлено ${count} поставщиков`;
}

// Подпись на спойлере со списком поставщиков в карточке категории
// (владелец, 2026-09-11: "у меня стало очень много поставщиков").
function suppliersCountLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} поставщик`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} поставщика`;
  return `${count} поставщиков`;
}

function siteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Владелец, 2026-09-03: "Порядок страниц такой: Ресерч, Email, Закупки" —
// вкладка "Каталог" (карточки-компании без прайса, отдельно от сравнения
// предложений в Ресерче) убрана тем же днём — "поставщиков из Каталога
// перенеси в ресерч, а эту страницу пока вообще удали". Данные трёх
// поставщиков (Iotans.by/Подпись.бай/SipSim) перенесены прямым SQL в
// supplier_research_requests/offers (категории "Оборудование"/"IT-сервисы"),
// сами строки contractors с team_tier=null НЕ удалены (осторожность —
// "пока" в формулировке владельца, легко восстановить вкладку обратно, если
// понадобится). Весь код вкладки (Contractor*/contractorsApi/catalogForm и
// т.п.) удалён вместе с ней — не оставляли полу-мёртвый код с noUnusedLocals.
//
// Владелец, тем же днём чуть позже: "давай пока вообще уберем Закупки, они
// только путают... пока не получается продумать архитектуру закупок,
// продумаю потом" — вкладка "Закупки" (компонент Purchases, embedded) и всё,
// что с ней было связано на этой странице (кнопка "Создать закупку" у
// предложения, черновик покупки), убраны тем же способом, что и "Каталог"
// чуть выше — код удалён, не спрятан; сам Purchases.tsx/purchasesApi.ts и
// таблицы purchases/purchase_emails в базе НЕ трогали (то же "пока" —
// вернуться к архитектуре закупок отдельным заходом). На освободившееся
// место — "Ведомости материалов" (владелец: "Поставщики - Ведомости
// материалов - Письма. Вот эти сущности пока"): та же единая ведомость по
// разделам сметы, что и на странице "Сметы" (EstimateMaterialsLedgerModal),
// только не всплывающим окном, а прямо вкладкой — переиспользованы те же
// MaterialsTable/groupMaterials и формы материала/комментариев, просто со
// своим выбором сметы (здесь, в отличие от страницы сметы, нет "текущей").
// "Ресерч" переименован в "Поставщики" (владелец сам так назвал сущность),
// "Email" — в "Письма" (то же самое: подпись вкладки — статичная строка,
// не "Письма (N)", см. комментарий про badges выше по истории этого файла).
//
// Владелец, 2026-09-09: "нам как будто нужна отдельная вкладка Сравнение
// цен. И внутри уже группировка по запросам, как грильято" — то самое
// сравнение "лучшая цена"/таблица по позициям, которое до этого жило только
// внутри карточки запроса на вкладке "Поставщики", получило свою отдельную
// вкладку — чистый вид только для сравнения, без кнопок управления запросом/
// предложением, сгруппированный по тем же категориям (Материалы и
// оборудование/Сервисы), что и "Поставщики".
const SUPPLIER_TABS = ['Поставщики', 'Сравнение цен', 'Ведомости материалов', 'Письма'] as const;
type SupplierTab = (typeof SUPPLIER_TABS)[number];

// Владелец, 2026-09-04: "меня бесит, что у всей страницы Поставщики
// одинаковый url... обновляешь — и всё слетело. Мне бы кастомный урл и на
// каждый раздел внутри" — вкладка живёт в query-параметре ?tab=, а не в
// локальном стейте, F5 остаётся на той же вкладке. Слаги, не сами русские
// названия — если вкладку когда-нибудь переименуют, старые сохранённые
// ссылки не должны сломаться.
const SUPPLIER_TAB_SLUGS: Record<SupplierTab, string> = {
  'Поставщики': 'suppliers',
  'Сравнение цен': 'comparison',
  'Ведомости материалов': 'ledger',
  Письма: 'letters',
};
const SLUG_TO_SUPPLIER_TAB: Record<string, SupplierTab> = Object.fromEntries(
  (Object.entries(SUPPLIER_TAB_SLUGS) as [SupplierTab, string][]).map(([t, slug]) => [slug, t]),
);

const emptyRequestForm = {
  title: '',
  group: 'materials' as SupplierRequestGroup,
  estimateId: '' as string,
  sectionId: '' as string,
  sectionTitle: '',
  legalEntityId: '' as string,
  comparisonMode: 'material' as SupplierComparisonMode,
};

function requestToForm(r: SupplierRequest) {
  return {
    title: r.title,
    group: r.group,
    estimateId: r.estimateId ?? '',
    sectionId: r.sectionId ?? '',
    sectionTitle: r.sectionTitle,
    legalEntityId: r.legalEntityId ?? '',
    comparisonMode: r.comparisonMode,
  };
}

const emptyOfferForm = {
  name: '',
  contactMethod: 'Телефон' as ResearchContactMethod,
  contact: '',
  email: '',
  managerName: '',
  country: '',
  websiteUrl: '',
  listingUrl: '',
  messengers: [] as SupplierMessengerContact[],
  catalogModelName: '',
  catalogModelPhoto: null as DocumentFile | null,
  // Владелец, 2026-09-09: файлы теперь грузятся сразу по выбору (как и
  // catalogModelPhoto), не откладываются до сабмита — иначе распознавание
  // счёта (см. handleOfferFilesSelect) нечем было бы вызвать: recognizeInvoice
  // читает файл по публичному Storage-URL, у ещё не загруженного File его нет.
  existingFiles: [] as DocumentFile[],
  // Владелец, 2026-09-09: "у Альмиры есть сметы, которые она собрала
  // вручную — PDF/Excel/письма с ценами... вручную не будем ничего
  // указывать, система должна распознавать так же, как в переписке" —
  // price/currency/items заполняются автораспознаванием загруженного файла
  // (handleOfferFilesSelect → recognizeInvoiceFile → карточка "Похоже, это
  // счёт" → confirmOfferExtraction), не вводом с клавиатуры. Поля остаются
  // редактируемыми — как и в переписке, это доступная поправка после
  // распознавания (например, если модель ошиблась в цифре), а не приглашение
  // печатать всё с нуля. price — строка (не number), как и в остальных
  // денежных полях формы этого проекта (например ContractorsResearch.tsx) —
  // value контролируемого <input type="number"> должен быть строкой, иначе
  // пустое поле нельзя стереть до конца.
  price: '' as string,
  currency: RESEARCH_CURRENCIES[0] as Currency,
  items: [] as PurchaseItem[],
};

// Владелец, 2026-09-09: "нам нужен интерфейс для вывода лучшей цены" — тот
// же принцип сравнения "дешевле всех" в общем знаменателе USD, что и у
// rankOffers в ContractorsResearch.tsx (см. комментарий там), только считает
// по offer.price/currency — итоговой цене по счёту, единственному
// АВТОРИТЕТНОМУ источнику суммы (не сумма позиций, см. комментарий у
// SupplierOffer.price). Предложения без цены — в хвост списка, не участвуют
// в сравнении (0 не должен ложно выигрывать). Лидеров может быть несколько
// (тот же принцип, что и там же).
//
// Владелец, 2026-09-11: "если указано, что это альтернатива, давай прямо возле
// поставки выводить уведомление" — предложение, все КП которого помечены как
// аналог (alternativeOfferIds), в борьбе за "лучшую цену" не участвует: оно
// почти всегда дешевле просто потому, что это другой товар (реальный случай —
// ГРИЛЬЯТО-Мастер со стальным h30 против алюминиевого h40 у остальных), и
// зелёный бейдж на нём means "сравнили разное". В списке оно остаётся и цену
// показывает, рядом — предупреждение.
function rankOffersByPrice(
  offers: SupplierOffer[],
  rate: ExchangeRate | undefined,
  alternativeOfferIds: Set<string> = new Set(),
): { sorted: SupplierOffer[]; cheapestIds: Set<string> } {
  const withUsd = offers.map((o) => ({
    offer: o,
    usd: o.price > 0 ? convertToUsd(o.price, o.currency, rate) : null,
  }));
  const priced = withUsd.filter((x) => x.usd != null).sort((a, b) => a.usd! - b.usd!);
  const unpriced = withUsd.filter((x) => x.usd == null);
  // Место в списке альтернатива занимает по своей цене, как все — прячем от
  // неё только бейдж "дешевле всех".
  const comparable = priced.filter((x) => !alternativeOfferIds.has(x.offer.id));
  const minUsd = comparable[0] ? Math.round(comparable[0].usd! * 100) : null;
  const cheapestIds = new Set(
    minUsd == null ? [] : comparable.filter((x) => Math.round(x.usd! * 100) === minUsd).map((x) => x.offer.id),
  );
  return { sorted: [...priced, ...unpriced].map((x) => x.offer), cheapestIds };
}

// Владелец, 2026-09-09: "та же поставка Грильято — это не 1 позиция, а
// множество доп. компонентов. Предложи решение по организации инфы и цен с
// учётом множества строк" — построчное сравнение: строка на каждое
// уникальное название позиции (матчинг точным совпадением по названию без
// регистра/пробелов по краям — счета разных поставщиков не всегда называют
// один и тот же компонент дословно одинаково, более умный матчинг здесь не
// Владелец, 2026-09-09: "нам как будто нужна отдельная вкладка Сравнение
// цен. И внутри уже группировка по запросам, как грильято" — вынесено из
// Статус поставщика в конвейере "нашли → добавили → обогатили → проверил
// человек" (владелец, 2026-09-11) — один бейдж на все три места, где он
// показывается (список предложений категории, разбивка по материалам в
// "Сравнении цен", детальная карточка), чтобы не расходились подписи.
function VerificationBadge({
  offer,
  enrichmentState,
}: {
  offer: { id: string; verified: boolean; email: string; contact: string };
  enrichmentState: Map<string, OfferEnrichmentState>;
}) {
  const status = supplierVerificationStatus(offer, enrichmentState);
  // Владелец, 2026-09-11: "измени красный цвет надписи Готово к верификации
  // на жёлтый" — светофор по смыслу «что требуется от человека»: серый —
  // ничего (данные ещё собираются или собирать нечего), жёлтый — готово,
  // ждём проверки, зелёный — проверено.
  const tone = status === 'verified' ? 'success' : status === 'ready' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{SUPPLIER_VERIFICATION_LABEL[status]}</Badge>;
}

// Владелец, 2026-09-11: "давай выводить цены и статус «лучшая цена» на
// странице сравнения цен, а в списке поставщиков просто оставим самих
// поставщиков со статусом Верифицировано/Нет" — раньше и здесь, и на
// вкладке "Сравнение цен" рисовался один и тот же OfferTotalComparison
// (цены, бейдж "лучшая цена", статус переписки, разбивка по КП). Теперь
// сравнение цен живёт ровно в одном месте — на своей вкладке, а вкладка
// "Поставщики" отвечает только за состав списка: кто у нас есть по этой
// категории и в каком состоянии его проверка. Отсюда и новое имя
// компонента — сравнением он больше не является.
// Свой стейт страны — самодостаточный компонент, реюзабельный без прокидки
// состояния через родителя.
function SupplierListBlock({
  offers,
  onOpenDetail,
  emptyHint,
  country: controlledCountry,
  onCountryChange,
  showCountryToggle = true,
  enrichmentState,
}: {
  offers: SupplierOffer[];
  onOpenDetail: (o: SupplierOffer) => void;
  enrichmentState: Map<string, OfferEnrichmentState>;
  // Владелец, 2026-09-03: "для материалов и сервисов мне нужно список — для
  // Беларуси и для России... в идеале переключение списков прямо внутри
  // самого блока" — подсказка для пустого списка отличается в зависимости
  // от контекста (на "Поставщики" есть кнопка "Добавить предложение" рядом,
  // на "Сравнение цен" её нет).
  emptyHint: string;
  // RequestCard (вкладка "Поставщики") использует этот же переключатель
  // страны и для кнопки "Найти в сети" — там страна контролируется
  // родителем (controlled), чтобы оба места читали одно и то же значение.
  country?: string;
  onCountryChange?: (country: string) => void;
  // Владелец, 2026-09-11: "у меня стало очень много поставщиков" — в
  // RequestCard список спрятан под спойлер, а переключатель страны вынесен
  // во всегда видимую шапку карточки (он общий с кнопкой "Найти в сети",
  // прятать его вместе со списком нельзя — поиск ушёл бы в невидимую
  // пользователю страну). Здесь он в этом случае просто не рисуется второй раз.
  showCountryToggle?: boolean;
}) {
  const [internalCountry, setInternalCountry] = useState<string>(SUPPLIER_COUNTRIES[0]);
  const country = controlledCountry ?? internalCountry;
  const setCountry = onCountryChange ?? setInternalCountry;
  const offersInCountry = offers.filter((o) => (o.country || SUPPLIER_COUNTRIES[0]) === country);

  // Сортировки по цене здесь больше нет (как и самих цен) — порядок по
  // состоянию проверки: проверенные сверху, за ними те, где ход за
  // человеком, и только потом ещё собираемые; внутри статуса — по алфавиту.
  const verificationOrder: Record<SupplierVerificationStatus, number> = {
    verified: 0,
    ready: 1,
    needs_verification: 2,
    enriching: 3,
  };
  const sortedOffers = [...offersInCountry].sort((a, b) => {
    const diff =
      verificationOrder[supplierVerificationStatus(a, enrichmentState)] -
      verificationOrder[supplierVerificationStatus(b, enrichmentState)];
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ru');
  });

  return (
    <>
      {showCountryToggle && <ToggleGroup options={[...SUPPLIER_COUNTRIES]} value={country} onChange={setCountry} />}

      {sortedOffers.length === 0 ? (
        <p className="text-sm text-ink-faint">{offers.length === 0 ? 'Пока нет предложений.' : `Нет предложений из «${country}» — ${emptyHint}`}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedOffers.map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{o.name}</span>
                <VerificationBadge offer={o} enrichmentState={enrichmentState} />
              </div>
              <Button type="button" variant="secondary" onClick={() => onOpenDetail(o)}>
                Подробнее
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Владелец, 2026-09-09: "нам нужен интерфейс для вывода лучшей цены" —
// сравнение "дешевле всех" по ИТОГОВОЙ цене всего КП (offer.price), список
// отсортирован по возрастанию цены, самая низкая (может быть несколько при
// равенстве) подсвечена зелёным + бейдж "лучшая цена" — тот же принцип, что
// и у сравнения предложений подрядчиков (ContractorsResearch.tsx). Плюс
// разбивка по компонентам снизу, если у сравниваемых КП есть построчная
// структура. Используется на вкладке "Сравнение цен" — в
// MaterialPriceComparisonCard для категорий с comparisonMode:'lot' (только
// confirmed — владелец, 2026-09-09: "Грильято, где есть комплектующие,
// нужно оценивать полностью... мы не будем заказывать
// несущие в одном месте, а подвесы в другом" — там сравнение "лучшая цена
// по каждой позиции" вводило бы в заблуждение, реальный выбор — это ОДИН
// поставщик на всю поставку целиком).
function OfferTotalComparison({
  offers,
  emails,
  quotes,
  rate,
  onOpenDetail,
  enrichmentState,
}: {
  offers: SupplierOffer[];
  emails: SupplierOfferEmail[];
  quotes: SupplierQuote[];
  rate: ExchangeRate | undefined;
  onOpenDetail: (o: SupplierOffer) => void;
  enrichmentState: Map<string, OfferEnrichmentState>;
}) {
  const quotesByOffer = useMemo(() => {
    const map = new Map<string, SupplierQuote[]>();
    quotes.forEach((q) => map.set(q.offerId, [...(map.get(q.offerId) ?? []), q]));
    return map;
  }, [quotes]);

  // Поставщик считается "предложил аналог" только когда ВСЕ его КП помечены
  // альтернативой: если рядом есть хоть одно КП ровно по заявке, сравнивать
  // его с остальными честно.
  const alternativeOfferIds = useMemo(() => {
    const ids = new Set<string>();
    quotesByOffer.forEach((list, offerId) => {
      if (list.length > 0 && list.every((q) => q.isAlternative)) ids.add(offerId);
    });
    return ids;
  }, [quotesByOffer]);

  const { sorted: sortedOffers, cheapestIds } = rankOffersByPrice(offers, rate, alternativeOfferIds);

  return (
    <div className="flex flex-col gap-2">
      {sortedOffers.map((o) => {
        const status = offerCommunicationStatus(o, emails);
        const isCheapest = cheapestIds.has(o.id);
        const offerQuotes = quotesByOffer.get(o.id) ?? [];
        const alternativeQuotes = offerQuotes.filter((q) => q.isAlternative);
        return (
          <div
            key={o.id}
            className={cn(
              'flex flex-col gap-2 rounded-control border px-4 py-3',
              isCheapest ? 'border-success/30 bg-success-bg' : 'border-border',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{o.name}</span>
                <VerificationBadge offer={o} enrichmentState={enrichmentState} />
                {isCheapest && (
                  <span className="rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-white">
                    лучшая цена
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <span className="max-w-[200px] truncate text-sm text-ink-muted">{OFFER_COMMUNICATION_STATUS_LABEL[status]}</span>
                <span className={cn('tabular-nums font-semibold', isCheapest ? 'text-success' : 'text-ink')}>
                  {o.price > 0 ? formatPrice(o.price, o.currency) : '—'}
                </span>
                <Button type="button" variant="secondary" onClick={() => onOpenDetail(o)}>
                  Подробнее
                </Button>
              </div>
            </div>

            {/* Владелец, 2026-09-11: "надо бы показывать все" — поставщик может
                прислать в одну ветку несколько счетов, раньше в карточке
                оставался только последний. Показываем, когда их правда
                несколько; одно КП и так уже видно ценой выше. */}
            {offerQuotes.length > 1 && (
              <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-muted/40 px-3 py-2">
                <span className="text-xs font-medium text-ink-muted">Получено КП: {offerQuotes.length}</span>
                {offerQuotes.map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-ink">{q.title}</span>
                    {q.isAlternative && (
                      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning">
                        аналог
                      </span>
                    )}
                    <span className="tabular-nums font-medium text-ink">
                      {q.price > 0 ? formatPrice(q.price, q.currency) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Само уведомление — рядом с ценой, а не внутри карточки: решение
                принимают, глядя на эту строку. */}
            {alternativeQuotes.length > 0 && (
              <div className="flex flex-col gap-0.5 rounded-control border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-ink">
                <span className="font-medium">
                  {alternativeQuotes.length === offerQuotes.length
                    ? 'Это аналог, а не то, что запрашивали — цены сопоставимы не напрямую'
                    : 'Среди КП есть аналог — не то, что запрашивали'}
                </span>
                {alternativeQuotes
                  .filter((q) => q.alternativeNote.trim())
                  .map((q) => (
                    <span key={q.id} className="text-ink-muted">
                      {q.title}: {q.alternativeNote}
                    </span>
                  ))}
              </div>
            )}

            {/* Владелец, 2026-09-09: "названия позиций будут 100% отличаться,
                ты перекрестные сравнения не найдешь" — раньше здесь строилась
                ОБЩАЯ таблица, сопоставляющая позиции разных поставщиков по
                совпадению названия (buildItemComparison) — ненадёжно, у
                каждого поставщика свои формулировки в счёте. Теперь список
                позиций — под спойлером и СТРОГО отдельно на каждого
                поставщика, без попытки свести их в одну таблицу. */}
            {o.items.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                  Список материалов ({o.items.length} поз.)
                </summary>
                <div className="mt-2 overflow-x-auto rounded-control border border-border">
                  <table className="w-full min-w-[360px] border-collapse text-sm">
                    <thead>
                      <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                        <th className="px-3 py-2">Название</th>
                        <th className="px-3 py-2 text-right">Кол-во</th>
                        <th className="px-3 py-2 text-right">Цена</th>
                        <th className="px-3 py-2 text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.items.map((item) => (
                        <tr key={item.id} className="border-t border-border align-top">
                          <td className="px-3 py-2 text-ink">
                            {item.name}
                            {item.unit && <span className="text-ink-faint"> ({item.unit})</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">{item.quantity ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">
                            {item.price != null ? formatPrice(item.price, o.currency) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">
                            {formatPrice(purchaseItemTotal(item), o.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Владелец, 2026-09-09: "В сравнении цен нужно добавлять только тех, кто
// уже прислал КП" + "не списки поставщиков, а материал — КП по убыванию" —
// вкладка "Сравнение цен" перестроена целиком под этот принцип, отдельно от
// списка на вкладке "Поставщики" (SupplierListBlock — там нужен весь состав,
// включая ещё не ответивших, это управление запросом, а не сравнение цен;
// с 2026-09-11 цен там нет вовсе). Здесь: (1) только
// offerCommunicationStatus === 'confirmed' — offer.items или offer.price уже зафиксированы, счёт реально
// получен, не просто отправлено письмо; (2) единица сравнения — не
// поставщик, а МАТЕРИАЛ: заголовок самого запроса (request.title) плюс
// любые доп. компоненты, обнаруженные в разбивке присланных счетов (см.
// точку 3 из истории про Грильято — сложное КП это не 1 цена, а много
// строк). Под каждым материалом — список полученных КП по убыванию (не по
// возрастанию, как у лучшей цены выше — тут задача увидеть весь диапазон
// сверху вниз), самая низкая цена всё равно подсвечена зелёным, где бы она
// ни оказалась в списке.
interface MaterialQuote {
  offerId: string;
  offerName: string;
  verified: boolean;
  // Нужны только бейджу статуса (см. supplierVerificationStatus): без
  // собранных контактов поставщик остаётся "Требуется верификация".
  offerEmail: string;
  offerContact: string;
  amount: number;
  currency: Currency;
  usd: number | null;
}

interface MaterialGroup {
  key: string;
  name: string;
  unit: string;
  quotes: MaterialQuote[];
  cheapestOfferIds: Set<string>;
}

function buildMaterialQuotes(request: SupplierRequest, confirmedOffers: SupplierOffer[], rate: ExchangeRate | undefined): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>();

  function addQuote(name: string, unit: string, offer: SupplierOffer, amount: number) {
    const key = name.trim().toLowerCase();
    if (!key) return;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: name.trim(), unit, quotes: [], cheapestOfferIds: new Set() };
      groups.set(key, group);
    }
    group.quotes.push({
      offerId: offer.id,
      offerName: offer.name,
      verified: offer.verified,
      offerEmail: offer.email,
      offerContact: offer.contact,
      amount,
      currency: offer.currency,
      usd: convertToUsd(amount, offer.currency, rate),
    });
  }

  // У запроса больше нет собственных позиций (поле удалено, владелец,
  // 2026-09-11) — сам request.title и есть "материал", про который вообще
  // идёт речь, когда счёт поставщика распознан только итогом без разбивки.
  const fallbackName = request.title;
  const fallbackUnit = '';

  for (const offer of confirmedOffers) {
    if (offer.items.length > 0) {
      for (const item of offer.items) {
        if (item.price == null) continue;
        addQuote(item.name, item.unit, offer, purchaseItemTotal(item));
      }
    } else if (offer.price > 0) {
      // Счёт распознан только итогом, без разбивки — весь итог относим к
      // единственному материалу, про который создавался этот запрос.
      addQuote(fallbackName, fallbackUnit, offer, offer.price);
    }
  }

  const primaryKey = fallbackName.trim().toLowerCase();
  const list = Array.from(groups.values());
  for (const group of list) {
    const priced = group.quotes.filter((q) => q.usd != null).sort((a, b) => b.usd! - a.usd!);
    const unpriced = group.quotes.filter((q) => q.usd == null);
    group.quotes = [...priced, ...unpriced];
    if (priced.length > 0) {
      const minUsd = Math.round(priced[priced.length - 1].usd! * 100);
      for (const q of priced) {
        if (Math.round(q.usd! * 100) === minUsd) group.cheapestOfferIds.add(q.offerId);
      }
    }
  }
  // Материал самого запроса — первым, остальные (доп. компоненты) — по
  // числу полученных КП (сначала там, где реально есть с чем сравнивать).
  list.sort((a, b) => {
    if (a.key === primaryKey) return -1;
    if (b.key === primaryKey) return 1;
    return b.quotes.length - a.quotes.length;
  });
  return list;
}

function MaterialPriceComparisonCard({
  request,
  offers,
  emails,
  quotes,
  rate,
  onOpenDetail,
  enrichmentState,
}: {
  request: SupplierRequest;
  offers: SupplierOffer[];
  emails: SupplierOfferEmail[];
  quotes: SupplierQuote[];
  rate: ExchangeRate | undefined;
  onOpenDetail: (o: SupplierOffer) => void;
  enrichmentState: Map<string, OfferEnrichmentState>;
}) {
  const [country, setCountry] = useState<string>(SUPPLIER_COUNTRIES[0]);
  const offersInCountry = offers.filter((o) => (o.country || SUPPLIER_COUNTRIES[0]) === country);
  const confirmedOffers = offersInCountry.filter((o) => offerCommunicationStatus(o, emails) === 'confirmed');
  // Владелец, 2026-09-09: "Грильято, где есть комплектующие, нужно
  // оценивать полностью... мы не будем заказывать несущие в одном месте, а
  // подвесы в другом. Поэтому логика такая — формируем поставку — сравниваем
  // цену на поставку в целом. Но, в то же время, если бы позиции были
  // штукатурка и плитка, то могли бы заказать и в разных местах" —
  // comparisonMode:'lot' сравнивает КП целиком (OfferTotalComparison, та же
  // логика, что и на вкладке "Поставщики"), а не по отдельным материалам.
  const isLot = request.comparisonMode === 'lot';
  const materialGroups = isLot ? [] : buildMaterialQuotes(request, confirmedOffers, rate);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold text-ink">{request.title}</span>
        {isLot && (
          <span
            className="rounded-full border border-border-strong px-2 py-0.5 text-[11px] font-medium text-ink-muted"
            title={SUPPLIER_COMPARISON_MODE_HINTS.lot}
          >
            поставка целиком
          </span>
        )}
      </div>
      <ToggleGroup options={[...SUPPLIER_COUNTRIES]} value={country} onChange={setCountry} />

      {isLot ? (
        confirmedOffers.length === 0 ? (
          <p className="text-sm text-ink-faint">Пока никто из «{country}» не прислал КП — переключите страну выше.</p>
        ) : (
          <OfferTotalComparison
            offers={confirmedOffers}
            emails={emails}
            quotes={quotes}
            rate={rate}
            onOpenDetail={onOpenDetail}
            enrichmentState={enrichmentState}
          />
        )
      ) : materialGroups.length === 0 ? (
        <p className="text-sm text-ink-faint">Пока никто из «{country}» не прислал КП — переключите страну выше.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {materialGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">
                {group.name}
                {group.unit && <span className="font-normal text-ink-faint"> ({group.unit})</span>}
              </span>
              <div className="flex flex-col gap-1.5">
                {group.quotes.map((q) => {
                  const isCheapest = group.cheapestOfferIds.has(q.offerId);
                  return (
                    <div
                      key={q.offerId}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-3 rounded-control border px-3 py-2',
                        isCheapest ? 'border-success/30 bg-success-bg' : 'border-border',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{q.offerName}</span>
                        <VerificationBadge
                          offer={{ id: q.offerId, verified: q.verified, email: q.offerEmail, contact: q.offerContact }}
                          enrichmentState={enrichmentState}
                        />
                        {isCheapest && (
                          <span className="rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-white">
                            лучшая цена
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn('tabular-nums text-sm font-semibold', isCheapest ? 'text-success' : 'text-ink')}>
                          {formatPrice(q.amount, q.currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const offer = offers.find((o) => o.id === q.offerId);
                            if (offer) onOpenDetail(offer);
                          }}
                          className="shrink-0 text-xs font-medium text-primary-hover hover:underline"
                        >
                          Подробнее
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Владелец, 2026-09-03: "для материалов и сервисов мне нужно список — для
// Беларуси и для России... в идеале переключение списков прямо внутри
// самого блока, чем делать две отдельные таблицы". Переключатель — локальный
// стейт карточки (не персистится), по умолчанию Беларусь. Предложения без
// страны (старые записи до поля country) на всякий случай считаем
// белорусскими — иначе они пропали бы из обеих вкладок молча.
function RequestCard({
  request,
  offers,
  onEditRequest,
  onDeleteRequest,
  onAddOffer,
  onOpenDetail,
  onWebSearch,
  onToggleComparisonMode,
  searching,
  searchJob,
  searchQueueError,
  onDismissSearchJob,
  enrichmentState,
}: {
  request: SupplierRequest;
  offers: SupplierOffer[];
  onEditRequest: (r: SupplierRequest) => void;
  onDeleteRequest: (r: SupplierRequest) => void;
  onAddOffer: (r: SupplierRequest) => void;
  onOpenDetail: (o: SupplierOffer) => void;
  onWebSearch: (r: SupplierRequest, country: string) => void;
  onToggleComparisonMode: (r: SupplierRequest) => void;
  searching: boolean;
  // Владелец, 2026-09-11: веб-поиск переехал на фоновую очередь (см.
  // supplierWebSearchApi.ts) — searchJob здесь ТОЛЬКО отображает последнее
  // ещё не скрытое задание этой категории: pending/processing — идёт поиск
  // (можно закрыть вкладку, уведомление придёт само), done — поиск завершён
  // и найденные поставщики уже добавлены в базу, error — поиск не удался.
  searchJob: SupplierWebSearchJob | undefined;
  searchQueueError: string | null;
  onDismissSearchJob: (jobId: string) => void;
  enrichmentState: Map<string, OfferEnrichmentState>;
}) {
  // Владелец, 2026-09-03: страна выбирается ОДНИМ переключателем (см.
  // SupplierListBlock выше — здесь он controlled, значение общее и для
  // фильтра списка, и для кнопки "Найти в сети").
  const [country, setCountry] = useState<string>(SUPPLIER_COUNTRIES[0]);
  // Владелец, 2026-09-11: "у меня стало очень много поставщиков — давай
  // сделаем название категории и основные кнопки видимыми, а список
  // поставщиков будем прятать под спойлер". По умолчанию свёрнуто: страница
  // становится компактным перечнем категорий, список раскрывается по клику
  // и живёт только в стейте карточки (не персистится).
  const [listOpen, setListOpen] = useState(false);
  const offersInCountry = offers.filter((o) => (o.country || SUPPLIER_COUNTRIES[0]) === country);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold text-ink">{request.title}</span>
            <button
              type="button"
              onClick={() => onToggleComparisonMode(request)}
              title="Клик — переключить тип сравнения на «Сравнение цен»"
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-medium hover:border-primary hover:text-primary',
                request.comparisonMode === 'lot'
                  ? 'border-border-strong text-ink-muted'
                  : 'border-border text-ink-faint',
              )}
            >
              {SUPPLIER_COMPARISON_MODE_LABELS[request.comparisonMode]}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={searching || searchJob?.status === 'pending' || searchJob?.status === 'processing'}
            icon={searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            onClick={() => onWebSearch(request, country)}
          >
            {searching ? 'Ставим в очередь...' : 'Найти в сети'}
          </Button>
          <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => onAddOffer(request)}>
            Добавить предложение
          </Button>
          <button
            type="button"
            onClick={() => onEditRequest(request)}
            aria-label="Переименовать запрос"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteRequest(request)}
            aria-label="Удалить запрос"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-danger hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {searchQueueError && <p className="text-sm text-danger">{searchQueueError}</p>}

      {/* Владелец, 2026-09-11: "я формирую поиск, система ищет в фоне, я
          закрываю вкладку, когда найдёт — уведомление" — статус фонового
          задания веб-поиска этой категории, отдельно от кнопки "Найти в
          сети" выше (та просто ставит в очередь и сразу освобождается). */}
      {searchJob && (searchJob.status === 'pending' || searchJob.status === 'processing') && (
        <div className="flex items-center gap-2 rounded-control border border-border bg-surface-muted px-3 py-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Ищем поставщиков в сети — можно закрыть вкладку, о готовности придёт уведомление.
        </div>
      )}
      {/* Владелец, 2026-09-11: результаты больше НЕ открываются модалкой для
          ручного добавления — поисковый скрипт сам создаёт предложения и сам
          ставит их на обогащение (см. createOffersAndQueueEnrichment в
          scripts/process-supplier-web-search-jobs.mjs), поэтому здесь просто
          сообщение о том, что произошло: новые поставщики уже в списке ниже,
          со статусом "Собираем данные..." → "Готово к верификации". */}
      {searchJob && searchJob.status === 'done' && (
        <div className="flex items-center justify-between gap-2 rounded-control border border-success/30 bg-success-bg px-3 py-2 text-sm font-medium text-success">
          <span className="flex items-center gap-2">
            <Check className="h-4 w-4 shrink-0" />
            {searchJob.addedCount === 0
              ? 'Поиск завершён — новых поставщиков не нашлось (всё найденное уже есть в списке)'
              : `Готово: ${addedSuppliersLabel(searchJob.addedCount ?? searchJob.results.length)} — собираем их контакты`}
          </span>
          <button
            type="button"
            onClick={() => onDismissSearchJob(searchJob.id)}
            aria-label="Скрыть сообщение"
            className="shrink-0 rounded-full p-1 hover:bg-success/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {searchJob && searchJob.status === 'error' && (
        <div className="flex items-center justify-between gap-2 rounded-control border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <span>Поиск не удался: {searchJob.error || 'см. журнал ошибок'}</span>
          <button
            type="button"
            onClick={() => onDismissSearchJob(searchJob.id)}
            aria-label="Скрыть сообщение об ошибке"
            className="shrink-0 rounded-full p-1 hover:bg-danger/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Переключатель страны остаётся видимым и в свёрнутом виде: он общий
          с кнопкой "Найти в сети" выше, и если спрятать его вместе со
          списком, поиск уходил бы в невыбранную на глазах страну. */}
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup options={[...SUPPLIER_COUNTRIES]} value={country} onChange={setCountry} />
        <button
          type="button"
          onClick={() => setListOpen((open) => !open)}
          aria-expanded={listOpen}
          className="flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-primary"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', listOpen ? '' : '-rotate-90')} />
          {listOpen
            ? 'Скрыть список'
            : offersInCountry.length === 0
              ? 'Показать список'
              : `Показать ${suppliersCountLabel(offersInCountry.length)}`}
        </button>
      </div>

      {listOpen && (
        <SupplierListBlock
          offers={offers}
          onOpenDetail={onOpenDetail}
          emptyHint="переключите страну выше или добавьте предложение."
          country={country}
          onCountryChange={setCountry}
          showCountryToggle={false}
          enrichmentState={enrichmentState}
        />
      )}
    </Card>
  );
}

function OfferDetailModal({
  offer,
  emails,
  onClose,
  onEmail,
  onEdit,
  onDelete,
  deleting,
  onDeleteFile,
  deletingFileIndex,
  enrichmentState,
  onVerify,
  verifying,
  offerQuotes,
  onQuoteAlternativeChange,
  onQuoteDelete,
  savingQuoteId,
  deletingQuoteId,
}: {
  offer: SupplierOffer;
  emails: SupplierOfferEmail[];
  onClose: () => void;
  onEmail: (o: SupplierOffer) => void;
  onEdit: (o: SupplierOffer) => void;
  onDelete: (o: SupplierOffer) => void;
  deleting: boolean;
  onDeleteFile: (o: SupplierOffer, index: number) => void;
  deletingFileIndex: number | null;
  offerQuotes: SupplierQuote[];
  onQuoteAlternativeChange: (quote: SupplierQuote, isAlternative: boolean, note: string) => void;
  onQuoteDelete: (quote: SupplierQuote) => void;
  savingQuoteId: string | null;
  deletingQuoteId: string | null;
  enrichmentState: Map<string, OfferEnrichmentState>;
  onVerify: (o: SupplierOffer) => void;
  verifying: boolean;
}) {
  const status = offerCommunicationStatus(offer, emails);
  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="min-w-0 truncate">{offer.name}</span>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums text-lg font-semibold text-ink">
            {offer.price > 0 ? formatPrice(offer.price, offer.currency) : 'Цена не указана'}
          </span>
          <VerificationBadge offer={offer} enrichmentState={enrichmentState} />
          {offer.country && (
            <span className="text-base" title={offer.country}>
              {countryFlag(offer.country)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-faint">Статус</span>
          <span className="text-ink">{OFFER_COMMUNICATION_STATUS_LABEL[status]}</span>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-faint">Контакт</span>
          {offer.contact ? (
            <span className="flex items-center gap-1.5 text-ink">
              {offer.contactMethod === 'Telegram' ? (
                <Send className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Phone className="h-3.5 w-3.5 shrink-0" />
              )}
              <ContactValue
                contact={offer.contactMethod === 'Телефон' ? formatPhoneDisplay(offer.contact) : offer.contact}
                contactMethod={offer.contactMethod}
              />
            </span>
          ) : (
            <span className="text-ink">—</span>
          )}
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-faint">Email</span>
          <span className="text-ink">{offer.email || '—'}</span>
        </div>

        {offer.messengers.length > 0 && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-ink-faint">Мессенджеры</span>
            <div className="flex flex-wrap gap-1.5">
              {offer.messengers.map((m, i) => {
                const { href, label } = messengerLink(m);
                const inner = (
                  <>
                    <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                      {m.type}: {label}
                    </span>
                  </>
                );
                return href ? (
                  <a
                    key={i}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-primary-hover hover:border-primary hover:underline"
                  >
                    {inner}
                  </a>
                ) : (
                  <span key={i} className="flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-ink">
                    {inner}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-faint">Менеджер</span>
          <span className="text-ink">{offer.managerName || '—'}</span>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink-faint">Сайт</span>
          {offer.websiteUrl ? (
            <a
              href={/^https?:\/\//.test(offer.websiteUrl) ? offer.websiteUrl : `https://${offer.websiteUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-1.5 text-primary-hover hover:underline"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              {siteLabel(offer.websiteUrl)}
            </a>
          ) : (
            <span className="text-ink">—</span>
          )}
        </div>

        {offer.listingUrl && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-ink-faint">Ссылка на позицию</span>
            <a
              href={/^https?:\/\//.test(offer.listingUrl) ? offer.listingUrl : `https://${offer.listingUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex w-fit items-center gap-1.5 text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              Открыть позицию на сайте
            </a>
          </div>
        )}

        {(offer.catalogModelName || offer.catalogModelPhoto) && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-ink-faint">Модель в каталоге</span>
            <div className="flex items-center gap-2">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-muted">
                {offer.catalogModelPhoto ? (
                  <img src={offer.catalogModelPhoto.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageOff className="h-5 w-5 text-ink-faint" />
                )}
              </span>
              <span className="text-ink">{offer.catalogModelName || '—'}</span>
            </div>
          </div>
        )}

        {offer.items.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-faint">Позиции КП</span>
            <div className="overflow-x-auto rounded-control border border-border">
              <table className="w-full min-w-[420px] border-collapse text-sm">
                <thead>
                  <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2">Название</th>
                    <th className="px-3 py-2 text-right">Кол-во</th>
                    <th className="px-3 py-2 text-right">Цена</th>
                    <th className="px-3 py-2 text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {offer.items.map((item) => (
                    <tr key={item.id} className="border-t border-border align-top">
                      <td className="px-3 py-2 text-ink">
                        {item.name}
                        {item.unit && <span className="text-ink-faint"> ({item.unit})</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-ink">{item.quantity ?? '—'}</td>
                      <td className="px-3 py-2 text-right text-ink">
                        {item.price != null ? `${item.price.toLocaleString('ru-RU')} ${currencySymbols[offer.currency]}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-ink">
                        {purchaseItemTotal(item).toLocaleString('ru-RU')} {currencySymbols[offer.currency]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Все КП этого поставщика (data/supplierQuotes.ts). Здесь же ставится
            пометка "аналог": по данным счёта отличить его от запрошенного
            нельзя, это знание человека — зато после пометки предупреждение
            видно прямо в сравнении цен, где принимают решение. */}
        {offerQuotes.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-faint">Полученные КП</span>
            {offerQuotes.map((q) => (
              <div key={q.id} className="flex flex-col gap-1.5 rounded-control border border-border px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{q.title}</span>
                  <span className="tabular-nums font-semibold text-ink">
                    {q.price > 0 ? formatPrice(q.price, q.currency) : '—'}
                  </span>
                  {/* Владелец, 2026-09-11: поставщик прислал в ту же ветку счёт
                      "по ошибке" (не по нашей заявке), и убрать его из сравнения
                      было нечем — строка КП рисуется и в списке "Получено КП", и
                      в предупреждении про аналог, а удаления не существовало
                      вовсе (deleteSupplierQuote был написан, но не вызывался
                      ниоткуда). Крестик — тот же приём, что у файлов ниже. */}
                  <button
                    type="button"
                    onClick={() => onQuoteDelete(q)}
                    disabled={deletingQuoteId === q.id || savingQuoteId === q.id}
                    aria-label={`Удалить КП «${q.title}»`}
                    title="Удалить только это КП — поставщик, переписка и файлы карточки останутся"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={q.isAlternative}
                    disabled={savingQuoteId === q.id}
                    onChange={(e) => onQuoteAlternativeChange(q, e.target.checked, q.alternativeNote)}
                    className="h-3.5 w-3.5"
                  />
                  Это аналог, а не то, что запрашивали
                </label>
                {q.isAlternative && (
                  <Input
                    placeholder="Чем отличается (например: сталь h30 вместо алюминия h40)"
                    defaultValue={q.alternativeNote}
                    disabled={savingQuoteId === q.id}
                    onBlur={(e) => {
                      if (e.target.value !== q.alternativeNote) onQuoteAlternativeChange(q, true, e.target.value);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {offer.files.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-faint">Файлы</span>
            {offer.files.map((f, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-sm">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary-hover hover:underline">
                  {f.fileName}
                </a>
                <button
                  type="button"
                  onClick={() => onDeleteFile(offer, i)}
                  disabled={deletingFileIndex === i}
                  aria-label={`Удалить файл «${f.fileName}»`}
                  title="Удалить только этот файл — сам поставщик и переписка не пострадают"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Владелец, 2026-09-11: "внизу три кнопки — Верифицировать кнопкой с
            текстом, Редактировать кнопкой с текстом, Удалить иконкой корзины".
            Карандаш из заголовка карточки при этом убран — он дублировал бы
            кнопку "Редактировать" один в один. */}
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {/* Текст кнопки свёрнут в иконку по просьбе владельца, но смысл из
              параллельной правки сохранён в подсказке: это удаление ВСЕГО
              поставщика (карточка, файлы, переписка), а не одного файла —
              для файлов есть свой крестик в списке выше. */}
          <button
            type="button"
            onClick={() => onDelete(offer)}
            disabled={deleting}
            aria-label="Удалить поставщика целиком"
            title="Удаляет всего поставщика целиком: карточку, все файлы и всю переписку с ним"
            className="mr-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <Button type="button" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(offer)}>
            Редактировать
          </Button>
          {/* Владелец, 2026-09-11: "добавь галочку «Верифицировать» прямо в
              карточку, чтобы даже редактирование открывать не нужно было" —
              раньше единственным способом отметить поставщика проверенным
              было открыть форму и сохранить её (submitOffer всегда ставит
              verified:true). Теперь это один клик прямо здесь, карточка
              после него закрывается. */}
          {!offer.verified && (
            <Button
              type="button"
              icon={verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              disabled={verifying}
              onClick={() => onVerify(offer)}
            >
              {verifying ? 'Сохраняем...' : 'Верифицировать'}
            </Button>
          )}
          {/* Владелец, 2026-09-04: "поставщик становится доступен для
              email-переписок" только после верификации — поэтому до неё здесь
              стоит кнопка верификации (выше), а не заблокированная "Написать":
              две кнопки рядом всё равно не помещались в подвал карточки, а
              смысл у них взаимоисключающий — сначала подтверди, потом пиши. */}
          {offer.verified && (
            <Button type="button" variant="secondary" icon={<Mail className="h-4 w-4" />} onClick={() => onEmail(offer)}>
              Написать
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Владелец, 2026-08-29: "это страница Закупки в стройке" — Каталог
// поставщиков/Ресерч/Закупки вместе на одной странице (компонент и файл
// по историческим причинам называется Suppliers — не переименовывал,
// чтобы не гонять лишний диф ради имени; название страницы для
// пользователя задаётся через PageHeader/data/pages.ts).
export function Suppliers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: SupplierTab = SLUG_TO_SUPPLIER_TAB[searchParams.get('tab') ?? ''] ?? 'Поставщики';
  function setTab(next: SupplierTab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set('tab', SUPPLIER_TAB_SLUGS[next]);
        // Уходя с "Письма", адрес конкретного треда переписки в URL больше
        // не актуален — иначе он продолжал бы указывать на уже скрытую
        // категорию/поставщика.
        if (next !== 'Письма') {
          params.delete('category');
          params.delete('offer');
          params.delete('order');
        }
        return params;
      },
      { replace: true },
    );
  }
  // Владелец, 2026-09-04: "Шаблоны — на уровень меню Поставщики/Письма, но
  // видна только когда открыты Письма" — кнопка теперь в шапке страницы
  // (см. рендер ниже), модалка живёт внутри SupplierCorrespondenceTab как и
  // раньше, открытость управляется отсюда.
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  // Владелец, 2026-09-04: "на этой странице делать Шаблоны" (про "Ведомости
  // материалов") — управление пресетами ведомостей (MaterialLedger) прямо
  // с этой вкладки, вне контекста конкретного письма. Переиспользован
  // MaterialLedgerModal (тот же список materialLedgers, что и у "Прикрепить
  // ведомость"/"Массовая отправка"), только без onAttach — тут нечего
  // прикреплять, только создавать/править/удалять.
  //
  // Владелец, 2026-09-09: "непонятно, зачем графа «Готовая ведомость»,
  // когда я добавляю новый шаблон" + "не хватает отображения шаблонов на
  // странице ведомостей" — вместо одного булева "открыта/закрыта" модалка
  // теперь целится в конкретную ведомость: null — закрыта, 'new' — создание
  // с нуля, id строкой — редактирование конкретной. Выбор "какую
  // редактировать" переехал на саму страницу (список ниже), поэтому
  // внутренний селект "Готовая ведомость" в самой модалке для этого сценария
  // скрыт (hideLedgerPicker).
  const [ledgerModalTarget, setLedgerModalTarget] = useState<'new' | string | null>(null);

  // Владелец, 2026-09-04: "давай реализуем массовую отправку... Альмира
  // сформировала универсальную большую ведомость и хочет разослать её
  // нескольким универсальным поставщикам" — мастер из двух шагов: (1) выбор/
  // сборка ведомости (переиспользуем MaterialLedgerModal как есть — та же
  // модалка, что и у "Прикрепить ведомость" в одиночном письме), (2) выбор
  // получателей и сама рассылка (BulkSendModal). Оба живут здесь, на уровне
  // страницы, а не внутри SupplierCorrespondenceTab — иначе переключение
  // вкладки "Письма" → "Поставщики"/"Ведомости материалов" размонтировало бы
  // компонент и оборвало бы уже идущую рассылку (там реальная пауза между
  // письмами, десятки секунд на каждое).
  const [bulkLedgerPickerRequest, setBulkLedgerPickerRequest] = useState<SupplierRequest | null>(null);
  const [bulkSendConfig, setBulkSendConfig] = useState<{ request: SupplierRequest; attachment: LedgerAttachment } | null>(null);

  const [requests, setRequests] = useState<SupplierRequest[]>([]);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Курс на сегодня — только для сравнения "лучшая цена" в общем
  // знаменателе USD между офферами в разных валютах (см. rankOffersByPrice/
  // buildItemComparison выше). Не подтянулся — не блокируем страницу,
  // просто предложения не в USD выпадают из сравнения (convertToUsd без
  // курса возвращает null).
  const [rate, setRate] = useState<ExchangeRate | undefined>(undefined);

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [objects, setObjects] = useState<RealtyObject[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);

  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<SupplierRequest | null>(null);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [savingRequest, setSavingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerRequestId, setOfferRequestId] = useState<string | null>(null);
  const [editingOffer, setEditingOffer] = useState<SupplierOffer | null>(null);
  const [offerForm, setOfferForm] = useState(emptyOfferForm);
  const [offerManualItemName, setOfferManualItemName] = useState('');
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [deletingOfferFileIndex, setDeletingOfferFileIndex] = useState<number | null>(null);
  const [savingQuoteId, setSavingQuoteId] = useState<string | null>(null);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Владелец, 2026-09-09: автораспознавание КП, загруженного вручную в
  // форму предложения — offerUploadingFile крутится во время загрузки
  // файла(ов) в Storage, offerExtractionBusy отдельно во время самого
  // распознавания (файл уже виден в списке, распознавание может идти
  // ещё пару секунд после этого). offerExtraction — незакрытая карточка
  // "Похоже, это счёт" (максимум одна за раз — распознаём файлы по
  // очереди, не параллельно, см. handleOfferFilesSelect).
  const [offerUploadingFile, setOfferUploadingFile] = useState(false);
  const [offerExtractionBusy, setOfferExtractionBusy] = useState(false);
  const [offerExtractionError, setOfferExtractionError] = useState<string | null>(null);
  // Владелец, 2026-09-09 (живой баг на проде — «Глассвэй»): успешное
  // распознавание с ответом isInvoice:false раньше было ПОЛНОСТЬЮ молчаливым
  // — ни карточки подтверждения, ни ошибки, файл просто прикреплялся, и
  // цена оставалась незаполненной без единого объяснения почему. Теперь
  // такой исход тоже виден на экране (имя файла, которое не распозналось
  // как счёт), а не только два прежних состояния busy/error.
  const [offerNotInvoiceFile, setOfferNotInvoiceFile] = useState<string | null>(null);
  const [offerExtraction, setOfferExtraction] = useState<{
    price: number | null;
    currency: string | null;
    items: RecognizedInvoiceItem[];
    fileName: string;
  } | null>(null);
  const [emailOfferId, setEmailOfferId] = useState<string | null>(null);
  // Вся переписка по всем предложениям Ресерча разом — единственный
  // источник правды для OfferEmailModal и вкладки "Email" (см.
  // EMAIL_CORRESPONDENCE_PLAN.md, этап 2), обновляется локально при
  // отправке/прочтении, без повторного fetch на каждое действие.
  const [supplierEmails, setSupplierEmails] = useState<SupplierOfferEmail[]>([]);
  // Шаблоны писем поставщикам (EMAIL_CORRESPONDENCE_PLAN.md, этап 3) — тот
  // же принцип "один источник правды на странице", что и у supplierEmails.
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  // Ведомости материалов (владелец, 2026-09-03) — тот же принцип, что и у
  // шаблонов писем: пресеты не привязаны к конкретному поставщику/запросу,
  // один источник на всю страницу.
  const [materialLedgers, setMaterialLedgers] = useState<MaterialLedger[]>([]);
  // Доп. заявки поставщиков (владелец, 2026-09-03: "1 заявка на поставку —
  // одна ветка") — все сразу, группировка по offerId на клиенте
  // (SupplierCorrespondenceTab), тот же принцип, что и у offers/emails.
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrder[]>([]);
  // Все КП поставщиков (data/supplierQuotes.ts) — несколько счетов в одной
  // ветке переписки больше не схлопываются в карточку, см. сравнение цен.
  const [supplierQuotes, setSupplierQuotes] = useState<SupplierQuote[]>([]);
  // Владелец, 2026-08-29: "слишком много инфы на превью, все вразнобой.
  // Давай выводить название + цену + статус + кнопка Подробнее" — остальные
  // поля (контакт/сайт/модель/срок/требования/файлы) и действия
  // (написать/редактировать/удалить/создать закупку) переехали сюда,
  // в отдельную карточку по клику.
  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);

  // Вкладка "Ведомости материалов" — та же единая ведомость по разделам, что
  // и на странице "Смета" (EstimateMaterialsLedgerModal), но не всплывающим
  // окном, а прямо вкладкой на "Закупках" (владелец, 2026-09-03: "приходится
  // бегать на другую вкладку ради ведомости... Поставщики - Ведомости
  // материалов - Письма. Вот эти сущности пока"). Смету нужно выбрать явно —
  // у этой страницы, в отличие от EstimateDetail.tsx, нет "текущей" сметы.
  const [ledgerEstimateId, setLedgerEstimateId] = useState('');
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [materialSectionId, setMaterialSectionId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<EstimateMaterial | null>(null);
  const [commentsMaterialSectionId, setCommentsMaterialSectionId] = useState<string | null>(null);
  const [commentsMaterial, setCommentsMaterial] = useState<EstimateMaterial | null>(null);
  // Переименование/добавление/удаление разделов прямо в ведомости — владелец,
  // 2026-09-09: "нужна возможность вручную добавлять разделы" (у сметы без
  // объекта стартовый набор из 4 стандартных разделов не всегда подходит).
  // Тот же паттерн rename-формы, что и у разделов на странице сметы
  // (EstimateDetail.tsx: startEditSection/saveSection/addSection).
  const [editingLedgerSectionId, setEditingLedgerSectionId] = useState<string | null>(null);
  const [ledgerSectionTitleDraft, setLedgerSectionTitleDraft] = useState('');
  const [savingLedgerSection, setSavingLedgerSection] = useState(false);

  // "Найти в сети" (владелец, 2026-08-31) — веб-поиск поставщиков через
  // claude-haiku-4-5 (scripts/process-supplier-web-search-jobs.mjs).
  // Владелец сразу же пожаловался, что клик сразу запускает поиск без
  // возможности что-то уточнить — поэтому кнопка открывает не сам поиск, а
  // сначала webQueryModal: список материалов (редактируемый, вдруг что-то
  // не то подтянулось из раздела сметы) + свободное поле "Дополнительные
  // пожелания" (бренд/бюджет/регион и т.п.), и только по кнопке "Искать"
  // уходит запрос. webSearchingId — id запроса, для которого сейчас идёт
  // ПОСТАНОВКА в очередь (дизейблит кнопку именно этой карточки на время
  // самого INSERT — доли секунды, не сам поиск).
  const [webQueryModal, setWebQueryModal] = useState<SupplierRequest | null>(null);
  // country — страна поиска (карточка запроса передаёт свою текущую
  // вкладку страны, см. RequestCard/ToggleGroup выше), но реальный баг
  // (2026-09-07): она никогда не доходила до самого поиска — сервер был
  // жёстко зашит на "Беларусь (Минск)" независимо от неё и от того, что
  // написано в "Дополнительные пожелания" (например, город "Москва").
  // Теперь страна редактируема прямо в этой форме (вдруг нужно
  // переключить перед конкретным поиском) и уходит на сервер как есть.
  const [webQueryForm, setWebQueryForm] = useState({ itemsText: '', extra: '', country: SUPPLIER_COUNTRIES[0] as string });
  const [webSearchingId, setWebSearchingId] = useState<string | null>(null);
  // Владелец, 2026-09-11: "минуту ждать перед открытой вкладкой не
  // захочется... я формирую поиск, система ищет в фоне, я закрываю вкладку,
  // когда найдёт — уведомление". Веб-поиск переведён с синхронного HTTP-
  // запроса на асинхронную очередь (supplier_web_search_jobs, см.
  // supplierWebSearchApi.ts) — все задания страницы разом, чтобы у каждой
  // категории посчитать своё последнее незавершённое/неоткрытое.
  const [webSearchJobs, setWebSearchJobs] = useState<SupplierWebSearchJob[]>([]);
  // Владелец, 2026-09-11: обогащение контактов поставщика с его сайта (email
  // для заказов/телефон/мессенджеры) — тот же принцип фоновой очереди, что и
  // у веб-поиска (supplierEnrichmentApi.ts). enrichmentJobs — все задания,
  // опрашиваются вместе с offers (см. поллинг ниже), чтобы карточка
  // предложения сама обновилась, как только фоновый скрипт применит
  // найденное к supplier_research_offers.
  const [enrichmentJobs, setEnrichmentJobs] = useState<SupplierEnrichmentJob[]>([]);
  const [verifyingOfferId, setVerifyingOfferId] = useState<string | null>(null);
  // Ошибка ПОСТАНОВКИ в очередь (сам INSERT не прошёл — сетевая икота и
  // т.п.), не ошибка самого поиска (та приходит как status:'error' у уже
  // поставленного задания и показывается через searchJob на карточке).
  const [webSearchQueueError, setWebSearchQueueError] = useState<{ requestId: string; message: string } | null>(null);
  // Задания, чью карточку "Готово"/"Ошибка" уже открыли или явно скрыли —
  // не показываем их бейдж повторно (если позже для той же категории
  // появится НОВОЕ задание — оно не в этом Set, бейдж покажется снова).
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([fetchSupplierRequests(), fetchSupplierOffers()])
      .then(([r, o]) => {
        setRequests(r);
        setOffers(o);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить поставщиков')))
      .finally(() => setLoading(false));
    fetchEstimates().then(setEstimates).catch(() => setEstimates([]));
    fetchObjects().then(setObjects).catch(() => setObjects([]));
    fetchLegalEntities().then(setLegalEntities).catch(() => setLegalEntities([]));
    fetchAllSupplierOfferEmails().then(setSupplierEmails).catch(() => setSupplierEmails([]));
    fetchEmailTemplates().then(setEmailTemplates).catch(() => setEmailTemplates([]));
    fetchMaterialLedgers().then(setMaterialLedgers).catch(() => setMaterialLedgers([]));
    fetchSupplierOrders().then(setSupplierOrders).catch(() => setSupplierOrders([]));
    fetchSupplierQuotes().then(setSupplierQuotes).catch(() => setSupplierQuotes([]));
    fetchTodayRate().then(setRate).catch(() => setRate(undefined));
    fetchSupplierWebSearchJobs().then(setWebSearchJobs).catch(() => setWebSearchJobs([]));
    fetchSupplierEnrichmentJobs().then(setEnrichmentJobs).catch(() => setEnrichmentJobs([]));
  }, []);

  // Владелец, 2026-09-03: "в ведомости по умолчанию всегда выбран Red One" —
  // единственный объект с landingSlug 'one' (см. SEO_OVERRIDES в
  // lib/pageMeta.ts — тот же признак используется там для той же цели).
  // Срабатывает один раз, как только оба списка подгрузились и смета ещё не
  // выбрана вручную — не перезаписывает осознанный выбор пользователя.
  useEffect(() => {
    if (ledgerEstimateId || estimates.length === 0 || objects.length === 0) return;
    const redOne = objects.find((o) => o.landingSlug === 'one');
    if (!redOne) return;
    const redOneEstimate = estimates.find((e) => e.objectId === redOne.id);
    if (redOneEstimate) setLedgerEstimateId(redOneEstimate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimates, objects]);

  // Владелец, 2026-09-03: "нужно, чтобы новые письма подгружались и были
  // уведомления даже когда страница открыта... сейчас страницу нужно
  // обновлять вручную". Фоновый вотчер (supplierEmailWatcher.ts) и так
  // опрашивает раз в 60с ради уведомлений в колокольчик, но НЕ обновляет
  // supplierEmails на этой странице — новый ответ был виден только после
  // ручного F5. Отдельный лёгкий поллинг здесь (раз в 20с, пока страница
  // открыта) держит саму ленту переписки свежей без перезагрузки. Полная
  // замена (не merge) — supplierEmails и так приходит целиком с сервера,
  // объединять нечего; единственный побочный эффект — оптимистичная отметка
  // "прочитано" (см. handleMarkSupplierEmailsRead) может на секунду
  // откатиться, если опрос попал между локальной отметкой и ответом
  // сервера, и тут же поправится следующим тиком — не критично.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAllSupplierOfferEmails()
        .then(setSupplierEmails)
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // Тот же принцип — задания веб-поиска обрабатываются фоновым GitHub
  // Actions скриптом, не этой вкладкой (см. supplierWebSearchApi.ts).
  // Глобальный вотчер (supplierWebSearchJobWatcher.ts) шлёт уведомление в
  // колокольчик, но не обновляет эту страницу — лёгкий поллинг здесь
  // держит бейджи "Ищем..."/"Готово" на карточках свежими без перезагрузки.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSupplierWebSearchJobs()
        .then(setWebSearchJobs)
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // Тот же принцип для обогащения контактов — сам фоновый скрипт пишет
  // найденное напрямую в supplier_research_offers (не только в
  // supplier_enrichment_jobs), поэтому поллинг обновляет ОБА списка разом:
  // иначе карточка предложения не подхватила бы новый email/телефон/
  // мессенджеры без ручного F5.
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSupplierEnrichmentJobs()
        .then(setEnrichmentJobs)
        .catch(() => {});
      fetchSupplierOffers()
        .then(setOffers)
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, []);

  // Оптимистично помечает входящие письма этого предложения прочитанными в
  // локальном состоянии сразу (счётчик гаснет мгновенно), запрос на сервер —
  // фоном; сбой запроса намеренно не откатывает локальную отметку и не
  // показывает ошибку — это не критичная операция, при следующей загрузке
  // страницы всё равно синхронизируется с базой.
  function handleMarkSupplierEmailsRead(offerId: string, orderId: string | null) {
    setSupplierEmails((prev) =>
      prev.map((e) =>
        e.offerId === offerId && (e.orderId ?? null) === orderId && e.direction === 'in' && !e.readAt
          ? { ...e, readAt: new Date().toISOString() }
          : e,
      ),
    );
    markSupplierOfferEmailsRead(offerId, orderId).catch(() => {});
  }

  function handleSupplierEmailSent(email: SupplierOfferEmail) {
    setSupplierEmails((prev) => [...prev, email]);
  }

  // Владелец, 2026-09-03 — распознавание счёта/КП из вложения: подтверждение
  // (ручное или автоматическое) пишет в карточку предложения и отмечает
  // письмо разобранным — обе правки приходят снизу из EmailThread через
  // SupplierCorrespondenceTab/OfferEmailModal, здесь единственное место,
  // где реально живут offers/supplierEmails на всю страницу.
  function handleSupplierOfferUpdated(updated: SupplierOffer) {
    setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  }

  function handleSupplierEmailUpdated(updated: SupplierOfferEmail) {
    setSupplierEmails((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  function handleEmailTemplateSaved(template: EmailTemplate) {
    setEmailTemplates((prev) => (prev.some((t) => t.id === template.id) ? prev.map((t) => (t.id === template.id ? template : t)) : [...prev, template]));
  }

  function objectLabel(objectId: string): string {
    const o = objects.find((x) => x.id === objectId);
    return o ? o.name || o.address : 'Объект без названия';
  }

  // Юрлицо по умолчанию — используется в подписи-плейсхолдере поля
  // "Юрлицо" формы категории, когда сама категория его не выбрала явно.
  const defaultLegalEntity = useMemo(() => legalEntities.find((e) => e.isDefault) ?? null, [legalEntities]);

  // Смета может быть без объекта (владелец, 2026-09-09: "Смета Зелёный" —
  // общая смета внутри платформы) — тогда вместо объекта показываем её
  // собственное название (title), а не пытаемся искать несуществующий id.
  const estimateOptions = useMemo(
    () =>
      estimates.map((e) => ({
        id: e.id,
        label: `Смета — ${e.objectId ? objectLabel(e.objectId) : e.title || 'без объекта'}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estimates, objects],
  );

  // Владелец, 2026-09-03: "у нас же загружена ведомость в платформу, давай
  // делать этот список, буду выбирать из него" — при сборке ведомости
  // материалов для письма (MaterialLedgerModal) выбирать позиции руками
  // неудобно. Плоский список ВСЕХ материалов ВСЕХ смет (тот же источник,
  // что и у вкладки "Ведомости материалов" на этой же странице) — поиск по
  // нему в модалке.
  const allEstimateMaterials = useMemo(() => {
    const list: { item: PurchaseItem; context: string }[] = [];
    for (const e of estimates) {
      const objLabel = e.objectId ? objectLabel(e.objectId) : e.title || 'без объекта';
      for (const s of e.sections) {
        for (const m of s.materials) {
          list.push({
            item: { id: crypto.randomUUID(), sourceMaterialId: m.id, name: m.name, unit: m.unit, quantity: m.quantity, price: null, note: m.note },
            context: `${objLabel} · ${s.title}`,
          });
        }
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimates, objects]);

  const selectedRequestEstimate = estimates.find((e) => e.id === requestForm.estimateId) ?? null;
  const selectedRequestSection = selectedRequestEstimate?.sections.find((s) => s.id === requestForm.sectionId) ?? null;

  // Владелец, 2026-09-03: "будут поставщики из Беларуси и России" — пресет
  // + фактически встречающиеся значения (тот же паттерн, что и у
  // leadRequirements в Leads.tsx).
  const knownCountries = useMemo(() => {
    const set = new Set<string>(SUPPLIER_COUNTRIES);
    offers.forEach((o) => o.country && set.add(o.country));
    return [...set];
  }, [offers]);

  // Состояние обогащения по каждому предложению — считается один раз на все
  // карточки/бейджи страницы (см. VerificationBadge выше), а не перебором
  // всех заданий на каждую строку.
  const enrichmentState = useMemo(() => enrichmentStateByOffer(enrichmentJobs), [enrichmentJobs]);

  // Ведомость материалов — та же логика, что у saveEstimatePatch/
  // openEditMaterial/deleteMaterial и т.п. в EstimateDetail.tsx (просто
  // работает с локальным списком estimates этой страницы, а не с одной
  // загруженной сметой).
  const ledgerEstimate = estimates.find((e) => e.id === ledgerEstimateId) ?? null;

  // Владелец, 2026-09-09: "шаблон ведомости материала привязывался к смете...
  // когда выбран Red One, всё равно видны шаблоны Зелёного" — список
  // "Готовые ведомости" на этой вкладке теперь показывает только ведомости
  // ВЫБРАННОЙ здесь сметы (MaterialLedger.estimateId), не все сразу. Без
  // выбранной сметы список пуст (не имеет смысла показывать чужие ведомости
  // без контекста, к какой смете их отнести).
  const scopedMaterialLedgers = useMemo(
    () => (ledgerEstimateId ? materialLedgers.filter((l) => l.estimateId === ledgerEstimateId) : []),
    [materialLedgers, ledgerEstimateId],
  );

  const materialGroupOptions = useMemo(() => {
    const set = new Set<string>();
    (ledgerEstimate?.sections ?? []).forEach((s) => s.materials.forEach((m) => m.group && set.add(m.group)));
    return [...set];
  }, [ledgerEstimate]);

  // Владелец, 2026-09-09: "если я делаю ведомость на Зелёный, не надо
  // выводить мне позиции для Red One" — чек-лист "Шаблонов" на этой вкладке
  // ограничен материалами ВЫБРАННОЙ здесь сметы (ledgerEstimate), а не всем
  // allEstimateMaterials разом (тот список нужен для остальных мест, где
  // нет своего контекста сметы — например "Прикрепить ведомость" в
  // одиночном письме). Если смета ещё не выбрана — общий список как фолбэк
  // (лучше, чем пустой чек-лист).
  const ledgerEstimateChecklistMaterials = useMemo(() => {
    if (!ledgerEstimate) return allEstimateMaterials;
    const objLabel = ledgerEstimate.objectId ? objectLabel(ledgerEstimate.objectId) : ledgerEstimate.title || 'без объекта';
    return allEstimateMaterials.filter((m) => m.context.startsWith(`${objLabel} · `));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEstimateMaterials, ledgerEstimate]);

  async function saveLedgerSections(estimateId: string, sections: Estimate['sections']) {
    const target = estimates.find((e) => e.id === estimateId);
    if (!target) throw new Error('Смета не найдена');
    const updated = await updateEstimate(estimateId, {
      sections,
      questions: target.questions,
      status: target.status,
      floor2Deferred: target.floor2Deferred,
    });
    setEstimates((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    return updated;
  }

  function startEditLedgerSection(section: EstimateSection) {
    setEditingLedgerSectionId(section.id);
    setLedgerSectionTitleDraft(section.title);
    setLedgerError(null);
  }

  async function saveLedgerSectionTitle() {
    if (!ledgerEstimate || !editingLedgerSectionId) return;
    setSavingLedgerSection(true);
    setLedgerError(null);
    try {
      const sections = ledgerEstimate.sections.map((s) =>
        s.id === editingLedgerSectionId ? { ...s, title: ledgerSectionTitleDraft.trim() || 'Без названия' } : s,
      );
      await saveLedgerSections(ledgerEstimate.id, sections);
      setEditingLedgerSectionId(null);
    } catch (err) {
      setLedgerError(errorMessage(err, 'Не удалось сохранить раздел'));
    } finally {
      setSavingLedgerSection(false);
    }
  }

  async function addLedgerSection() {
    if (!ledgerEstimate) return;
    const section = emptySection('Новый раздел');
    try {
      await saveLedgerSections(ledgerEstimate.id, [...ledgerEstimate.sections, section]);
      startEditLedgerSection(section);
    } catch (err) {
      setLedgerError(errorMessage(err, 'Не удалось добавить раздел'));
    }
  }

  async function deleteLedgerSection(sectionId: string) {
    if (!ledgerEstimate) return;
    if (!window.confirm('Удалить раздел вместе с содержимым?')) return;
    setLedgerError(null);
    try {
      await saveLedgerSections(
        ledgerEstimate.id,
        ledgerEstimate.sections.filter((s) => s.id !== sectionId),
      );
    } catch (err) {
      setLedgerError(errorMessage(err, 'Не удалось удалить раздел'));
    }
  }

  // Удаление ведомости-пресета прямо из списка на странице (не только
  // изнутри модалки редактирования) — владелец, 2026-09-09.
  async function handleDeleteLedgerFromList(id: string, name: string) {
    if (!window.confirm(`Удалить ведомость «${name}»?`)) return;
    try {
      await deleteMaterialLedger(id);
      setMaterialLedgers((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setLedgerError(errorMessage(err, 'Не удалось удалить ведомость'));
    }
  }

  function openAddMaterial(sectionId: string) {
    setMaterialSectionId(sectionId);
    setEditingMaterial(null);
    setMaterialModalOpen(true);
  }

  function openEditMaterial(sectionId: string, material: EstimateMaterial) {
    setMaterialSectionId(sectionId);
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  }

  async function saveMaterial(saved: EstimateMaterial) {
    if (!ledgerEstimate || !materialSectionId) return;
    const sections = ledgerEstimate.sections.map((s) => {
      if (s.id !== materialSectionId) return s;
      const exists = s.materials.some((m) => m.id === saved.id);
      return { ...s, materials: exists ? s.materials.map((m) => (m.id === saved.id ? saved : m)) : [...s.materials, saved] };
    });
    await saveLedgerSections(ledgerEstimate.id, sections);
  }

  function openMaterialComments(sectionId: string, material: EstimateMaterial) {
    setCommentsMaterialSectionId(sectionId);
    setCommentsMaterial(material);
  }

  async function saveMaterialComments(updated: EstimateMaterial) {
    if (!ledgerEstimate || !commentsMaterialSectionId) return;
    const sections = ledgerEstimate.sections.map((s) =>
      s.id === commentsMaterialSectionId ? { ...s, materials: s.materials.map((m) => (m.id === updated.id ? updated : m)) } : s,
    );
    const saved = await saveLedgerSections(ledgerEstimate.id, sections);
    const savedSection = saved.sections.find((s) => s.id === commentsMaterialSectionId);
    setCommentsMaterial(savedSection?.materials.find((m) => m.id === updated.id) ?? null);
  }

  async function deleteMaterial(sectionId: string, materialId: string) {
    if (!ledgerEstimate) return;
    if (!window.confirm('Удалить материал?')) return;
    const sections = ledgerEstimate.sections.map((s) =>
      s.id === sectionId ? { ...s, materials: s.materials.filter((m) => m.id !== materialId) } : s,
    );
    setLedgerError(null);
    try {
      await saveLedgerSections(ledgerEstimate.id, sections);
    } catch (err) {
      setLedgerError(errorMessage(err, 'Не удалось удалить материал'));
    }
  }

  function openAddRequest(group: SupplierRequestGroup = 'materials') {
    setEditingRequest(null);
    setRequestForm({ ...emptyRequestForm, group });
    setRequestError(null);
    setRequestModalOpen(true);
  }

  function openEditRequest(r: SupplierRequest) {
    setEditingRequest(r);
    setRequestForm(requestToForm(r));
    setRequestError(null);
    setRequestModalOpen(true);
  }

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!requestForm.title.trim() || savingRequest) return;
    setSavingRequest(true);
    setRequestError(null);
    const input: SupplierRequestInput = {
      title: requestForm.title.trim(),
      group: requestForm.group,
      estimateId: requestForm.estimateId || null,
      sectionId: requestForm.sectionId || null,
      sectionTitle: requestForm.sectionTitle,
      legalEntityId: requestForm.legalEntityId || null,
      comparisonMode: requestForm.comparisonMode,
    };
    try {
      if (editingRequest) {
        const updated = await updateSupplierRequest(editingRequest.id, input);
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } else {
        const created = await insertSupplierRequest(input);
        setRequests((prev) => [created, ...prev]);
      }
      setRequestModalOpen(false);
    } catch (err) {
      setRequestError(errorMessage(err, 'Не удалось сохранить запрос'));
    } finally {
      setSavingRequest(false);
    }
  }

  async function handleDeleteRequest(r: SupplierRequest) {
    if (!window.confirm(`Удалить запрос «${r.title}» вместе со всеми предложениями?`)) return;
    try {
      await deleteSupplierRequest(r.id);
      setRequests((prev) => prev.filter((x) => x.id !== r.id));
      setOffers((prev) => prev.filter((o) => o.requestId !== r.id));
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить запрос'));
    }
  }

  // Владелец, 2026-09-09: "где и как отмечается, какая поставка идёт целиком,
  // а какие по частям? Это должно быть очевидно и просто" — раньше тип
  // сравнения менялся только через полную форму "Редактировать запрос"
  // (Select "Тип сравнения цен" внутри модалки), сам текущий выбор нигде не
  // был виден на самой карточке "Поставщики" (только на "Сравнение цен", и
  // то лишь когда выбран 'lot'). Теперь прямо на карточке категории —
  // кликабельная пилюля с текущим режимом, переключается в один клик, без
  // открытия формы.
  async function toggleComparisonMode(r: SupplierRequest) {
    const nextMode: SupplierComparisonMode = r.comparisonMode === 'lot' ? 'material' : 'lot';
    const input: SupplierRequestInput = {
      title: r.title,
      group: r.group,
      estimateId: r.estimateId,
      sectionId: r.sectionId,
      sectionTitle: r.sectionTitle,
      legalEntityId: r.legalEntityId,
      comparisonMode: nextMode,
    };
    try {
      const updated = await updateSupplierRequest(r.id, input);
      setRequests((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось изменить тип сравнения'));
    }
  }

  function openAddOffer(request: SupplierRequest) {
    setOfferRequestId(request.id);
    setEditingOffer(null);
    // Владелец, 2026-09-09: "вручную не будем ничего указывать" — items
    // больше НЕ предзаполняются материалами категории (как было раньше в
    // этом же заходе): пустые строки "что просим оценить" рядом с реально
    // распознанными позициями КП только путали бы (два ряда на один
    // материал — один пустой, один с ценой). Позиции появляются
    // исключительно через confirmOfferExtraction.
    setOfferForm(emptyOfferForm);
    setOfferManualItemName('');
    setOfferExtraction(null);
    setOfferExtractionError(null);
    setOfferNotInvoiceFile(null);
    setOfferError(null);
    setOfferModalOpen(true);
  }

  function updateOfferItem(id: string, patch: Partial<PurchaseItem>) {
    setOfferForm((f) => ({ ...f, items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }

  function removeOfferItem(id: string) {
    setOfferForm((f) => ({ ...f, items: f.items.filter((i) => i.id !== id) }));
  }

  function addManualOfferItem() {
    if (!offerManualItemName.trim()) return;
    const item: PurchaseItem = {
      id: crypto.randomUUID(),
      sourceMaterialId: null,
      name: offerManualItemName.trim(),
      unit: '',
      quantity: null,
      price: null,
      note: '',
    };
    setOfferForm((f) => ({ ...f, items: [...f.items, item] }));
    setOfferManualItemName('');
  }

  function openWebQueryModal(request: SupplierRequest, country: string) {
    setWebQueryForm({ itemsText: request.title, extra: '', country });
    setWebQueryModal(request);
  }

  // Последнее ещё не скрытое задание категории — источник правды для
  // бейджа на RequestCard (см. searchJob-проп там же). webSearchJobs уже
  // отсортирован по created_at desc сервером, а свежепоставленные задания
  // добавляются в НАЧАЛО массива (см. submitWebQuery/searchMoreSuppliers),
  // поэтому первое совпадение по requestId всегда самое новое.
  function latestVisibleJobForRequest(requestId: string): SupplierWebSearchJob | undefined {
    const job = webSearchJobs.find((j) => j.requestId === requestId);
    if (!job || dismissedJobIds.has(job.id)) return undefined;
    // Владелец, 2026-09-11: "это уведомление не пропадает, хотя поставщики
    // уже давно добавлены в базу" — крестик прятал баннер только в памяти
    // вкладки, после F5 он возвращался снова. "Готово" — разовая новость о
    // том, что поиск отработал, а не постоянный статус категории (сами
    // поставщики уже видны в списке ниже), поэтому баннер живёт ограниченное
    // время после завершения задания. Ошибку не прячем по таймеру — она
    // требует действия и снимается только крестиком.
    if (job.status === 'done' && job.completedAt && Date.now() - new Date(job.completedAt).getTime() > DONE_BANNER_TTL_MS) {
      return undefined;
    }
    return job;
  }

  function dismissWebSearchJob(jobId: string) {
    setDismissedJobIds((prev) => new Set(prev).add(jobId));
  }

  async function submitWebQuery(e: React.FormEvent) {
    e.preventDefault();
    const request = webQueryModal;
    if (!request || !webQueryForm.itemsText.trim()) return;
    setWebQueryModal(null);
    setWebSearchingId(request.id);
    setWebSearchQueueError(null);
    try {
      const job = await queueSupplierWebSearch({
        requestId: request.id,
        itemsText: webQueryForm.itemsText.trim(),
        sectionTitle: request.sectionTitle || request.title,
        extra: webQueryForm.extra.trim(),
        country: webQueryForm.country,
        // Уже добавленные поставщики этой категории — чтобы повторный поиск
        // искал НОВЫХ, а не приносил те же компании (раньше это работало
        // только у отдельной кнопки "Искать ещё" в модалке результатов;
        // теперь результаты добавляются в базу автоматически, поэтому
        // доисключение нужно каждому поиску, а сама кнопка "Искать ещё"
        // больше не нужна — достаточно нажать "Найти в сети" ещё раз).
        excludeCompanies: offers
          .filter((o) => o.requestId === request.id)
          .map((o) => ({ name: o.name, website: o.websiteUrl })),
      });
      setWebSearchJobs((prev) => [job, ...prev]);
    } catch (err) {
      setWebSearchQueueError({ requestId: request.id, message: errorMessage(err, 'Не удалось поставить поиск в очередь') });
    } finally {
      setWebSearchingId(null);
    }
  }

  function openEditOffer(o: SupplierOffer) {
    setOfferRequestId(o.requestId);
    setEditingOffer(o);
    setOfferForm({
      name: o.name,
      contactMethod: o.contactMethod,
      contact: o.contact,
      email: o.email,
      managerName: o.managerName,
      // Если страна ещё не проставлена у уже существующего предложения (со
      // старой записью, до этой правки) — подсказка по домену сайта, как
      // и при вводе нового websiteUrl. Ничего не сохраняет само по себе,
      // только предзаполняет форму.
      country: o.country || guessCountryFromWebsite(o.websiteUrl),
      websiteUrl: o.websiteUrl,
      listingUrl: o.listingUrl,
      messengers: o.messengers,
      catalogModelName: o.catalogModelName,
      catalogModelPhoto: o.catalogModelPhoto,
      existingFiles: o.files,
      price: o.price > 0 ? String(o.price) : '',
      currency: o.currency,
      items: o.items,
    });
    setOfferManualItemName('');
    setOfferExtraction(null);
    setOfferExtractionError(null);
    setOfferNotInvoiceFile(null);
    setOfferError(null);
    setOfferModalOpen(true);
    setDetailOfferId(null);
  }

  async function handleCatalogPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingPhoto(true);
    setOfferError(null);
    try {
      const uploaded = await uploadSupplierFile(file);
      setOfferForm((f) => ({ ...f, catalogModelPhoto: uploaded }));
    } catch (err) {
      setOfferError(errorMessage(err, 'Не удалось загрузить фото'));
    } finally {
      setUploadingPhoto(false);
    }
  }

  // Только те расширения, что реально умеет читать recognizeInvoice
  // (api/_invoiceRecognition.js — PDF, картинка или .docx с текстом) — для
  // остального (.xlsx и т.п.) просто загружаем файл без попытки распознать.
  // Владелец, 2026-09-09: реальный счёт (ЗАО "Волок") пришёл файлом .docx с
  // разбивкой на позиции — раньше .docx был исключён вместе с .xlsx под
  // предлогом "каталог на много страниц", хотя это обычный формат для
  // разового счёта конкретного поставщика — добавлен явно, текст
  // извлекается на сервере (api/_docxText.js), Claude сам файл не видит.
  function isRecognizableFileName(fileName: string): boolean {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'docx'].includes(ext);
  }

  function isValidOfferCurrency(value: string | null): value is Currency {
    return !!value && (RESEARCH_CURRENCIES as readonly string[]).includes(value);
  }

  // Владелец, 2026-09-09: "у нас есть поставщик с КП, найденный вручную...
  // добавляем его как нового поставщика и загружаем КП, система распознаёт
  // КП и записывает цену в базу" — тот же принцип, что и на автоматике по
  // входящим письмам (SupplierCorrespondenceTab.tsx), только без письма:
  // распознавание запускается сразу после загрузки файла в форму. По
  // очереди (await в цикле, не Promise.all) — иначе несколько счетов подряд
  // дали бы несколько одновременных карточек "Похоже, это счёт", непонятно
  // какую подтверждать первой.
  async function handleOfferFilesSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!picked.length) return;
    setOfferUploadingFile(true);
    setOfferError(null);
    try {
      for (const file of picked) {
        const uploaded = await uploadSupplierFile(file);
        setOfferForm((f) => ({ ...f, existingFiles: [...f.existingFiles, uploaded] }));
        if (isRecognizableFileName(uploaded.fileName)) {
          await tryRecognizeOfferFile(uploaded.url, uploaded.fileName);
        }
      }
    } catch (err) {
      setOfferError(errorMessage(err, 'Не удалось загрузить файл'));
    } finally {
      setOfferUploadingFile(false);
    }
  }

  async function tryRecognizeOfferFile(fileUrl: string, fileName: string) {
    setOfferExtractionBusy(true);
    setOfferExtractionError(null);
    setOfferNotInvoiceFile(null);
    try {
      const result = await recognizeInvoiceFile(fileUrl, fileName);
      if (result.isInvoice) {
        setOfferExtraction({ price: result.price, currency: result.currency, items: result.items, fileName });
      } else {
        setOfferNotInvoiceFile(fileName);
      }
    } catch (err) {
      setOfferExtractionError(errorMessage(err, 'Не удалось распознать документ'));
    } finally {
      setOfferExtractionBusy(false);
    }
  }

  // Тот же merge, что и у applyExtractionToOffer (SupplierCorrespondenceTab.tsx):
  // price — из итога самого документа (не сумма позиций — реальный КП может
  // включать доставку/скидку сверх суммы строк), currency — только если
  // модель вернула значение из известного набора, items — добавляются к уже
  // имеющимся, не заменяют их (несколько загруженных счетов копятся вместе).
  function confirmOfferExtraction() {
    if (!offerExtraction) return;
    const newItems: PurchaseItem[] = offerExtraction.items.map((i) => ({
      id: crypto.randomUUID(),
      sourceMaterialId: null,
      name: i.name,
      unit: i.unit,
      quantity: i.quantity,
      price: i.price,
      note: '',
    }));
    setOfferForm((f) => ({
      ...f,
      price: offerExtraction.price != null ? String(offerExtraction.price) : f.price,
      currency: isValidOfferCurrency(offerExtraction.currency) ? offerExtraction.currency : f.currency,
      items: [...f.items, ...newItems],
    }));
    setOfferExtraction(null);
  }

  function dismissOfferExtraction() {
    setOfferExtraction(null);
  }

  // Владелец, 2026-09-03: сначала "пусть только заголовок будет обязательным
  // полем, остальное опционально" — но у поля "Адрес сайта" остался
  // HTML required (не заметил в первый заход, браузер блокировал сабмит
  // нативной подсказкой независимо от canSubmitOffer), убрано отдельно. Тем
  // же сообщением уточнил: "Название + 1 любое поле, и этого должно
  // хватить" — совсем пустая карточка (только имя, никакого способа связаться
  // или хоть что-то ещё) толку не несёт, поэтому помимо названия нужно
  // заполнить хотя бы одно из остальных полей (любое, не обязательно сайт
  // или контакт конкретно). price/items добавлены в список 2026-09-09 —
  // без этого нельзя было бы сохранить карточку "Название + вручную
  // вписанная цена", ничего больше не заполняя.
  const canSubmitOffer =
    offerForm.name.trim().length > 0 &&
    (offerForm.contact.trim().length > 0 ||
      offerForm.email.trim().length > 0 ||
      offerForm.country.trim().length > 0 ||
      offerForm.websiteUrl.trim().length > 0 ||
      offerForm.listingUrl.trim().length > 0 ||
      offerForm.catalogModelName.trim().length > 0 ||
      offerForm.existingFiles.length > 0 ||
      offerForm.price.trim().length > 0 ||
      offerForm.items.length > 0);

  const offerItemsTotal = offerForm.items.reduce((sum, i) => sum + purchaseItemTotal(i), 0);

  // Владелец, 2026-09-04: "закупщик заполняет все возможные поля, жмёт
  // сохранить — поставщик становится доступен для email-переписок" — любое
  // сохранение через эту форму (новое предложение или правка уже
  // существующего) считается верификацией: человек проверил/ввёл данные.
  // Единственный путь получить verified:false — прямое добавление из
  // веб-поиска (addWebSearchResults ниже), минуя эту форму.
  async function submitOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitOffer || savingOffer || !offerRequestId) return;
    setSavingOffer(true);
    setOfferError(null);
    try {
      const payload = {
        requestId: offerRequestId,
        name: offerForm.name.trim(),
        contactMethod: offerForm.contactMethod,
        contact: offerForm.contact.trim(),
        email: offerForm.email.trim(),
        managerName: offerForm.managerName.trim(),
        country: offerForm.country,
        websiteUrl: offerForm.websiteUrl.trim(),
        listingUrl: offerForm.listingUrl.trim(),
        messengers: offerForm.messengers,
        catalogModelName: offerForm.catalogModelName.trim(),
        catalogModelPhoto: offerForm.catalogModelPhoto,
        price: offerForm.price.trim() ? Number(offerForm.price) : 0,
        currency: offerForm.currency,
        items: offerForm.items,
        // Файлы грузятся в Storage сразу по выбору (handleOfferFilesSelect),
        // а не откладываются до сабмита — тут уже готовый список.
        files: offerForm.existingFiles,
        verified: true,
      };
      // Владелец, 2026-09-05: лог действий Альмиры для страницы "Метрики" —
      // те же два события, что различает комментарий выше ("верификация" vs
      // "добавление вручную"). Логируем именно здесь, а не в самих
      // insertSupplierOffer/updateSupplierOffer (те — общий API-слой без
      // понятия "кто и зачем сохраняет", а различие "было ли уже verified"
      // видно только тут, по editingOffer до сохранения).
      if (editingOffer) {
        if (!editingOffer.verified) logActivity('supplier_offer_verified');
        const updated = await updateSupplierOffer(editingOffer.id, payload);
        setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
      } else {
        logActivity('supplier_offer_added_manually');
        const created = await insertSupplierOffer(payload);
        setOffers((prev) => [...prev, created]);
      }
      setOfferModalOpen(false);
    } catch (err) {
      setOfferError(errorMessage(err, 'Не удалось сохранить предложение'));
    } finally {
      setSavingOffer(false);
    }
  }

  // Верификация одним кликом прямо из карточки (владелец, 2026-09-11) — тот
  // же смысл, что и сохранение формы предложения: человек подтвердил, что
  // данные верны. Логируем то же событие, что и submitOffer, чтобы метрика
  // "Верифицировано поставщиков" (Metrics.tsx) считала оба пути одинаково.
  async function handleVerifyOffer(o: SupplierOffer) {
    setVerifyingOfferId(o.id);
    try {
      logActivity('supplier_offer_verified');
      const updated = await updateSupplierOffer(o.id, { ...o, verified: true });
      setOffers((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setDetailOfferId(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось верифицировать поставщика'));
    } finally {
      setVerifyingOfferId(null);
    }
  }

  async function handleDeleteOffer(o: SupplierOffer) {
    if (
      !window.confirm(
        `Удалить поставщика «${o.name}» целиком? Вместе с карточкой удалятся ВСЕ файлы и ВСЯ переписка с ним — восстановить это будет нельзя.\n\nЧтобы удалить только один файл (например, ошибочный счёт), закройте это окно и нажмите ✕ рядом с нужным файлом в списке «Файлы».`,
      )
    )
      return;
    setDeletingOfferId(o.id);
    try {
      await deleteSupplierOffer(o.id);
      setOffers((prev) => prev.filter((x) => x.id !== o.id));
      setDetailOfferId((id) => (id === o.id ? null : id));
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить предложение'));
    } finally {
      setDeletingOfferId(null);
    }
  }

  async function handleQuoteAlternativeChange(quote: SupplierQuote, isAlternative: boolean, note: string) {
    setSavingQuoteId(quote.id);
    try {
      const updated = await updateSupplierQuote(quote.id, {
        offerId: quote.offerId,
        title: quote.title,
        price: quote.price,
        currency: quote.currency,
        items: quote.items,
        files: quote.files,
        isAlternative,
        alternativeNote: isAlternative ? note : '',
        sourceEmailId: quote.sourceEmailId,
      });
      setSupplierQuotes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось сохранить пометку КП'));
    } finally {
      setSavingQuoteId(null);
    }
  }

  // Владелец, 2026-09-11: "Добавь крестик для удаления КП". До этого ошибочно
  // распознанное КП (поставщик может прислать в ту же ветку чужой счёт —
  // реальный случай: "произошла ошибка, счет не Ваш") убиралось только
  // SQL-запросом в supplier_offer_quotes. Удаляется ровно строка КП: цена,
  // позиции и файлы самой карточки поставщика живут отдельно в supplier_
  // research_offers (их наливает applyExtractionToOffer при подтверждении
  // распознавания) и здесь не трогаются — об этом и предупреждаем в confirm,
  // чтобы удаление КП не выглядело откатом карточки.
  async function handleDeleteQuote(quote: SupplierQuote) {
    if (deletingQuoteId) return;
    if (
      !window.confirm(
        `Удалить КП «${quote.title}»? Оно пропадёт из сравнения цен и из пометки про аналог. ` +
          'Сам поставщик, переписка и цена с позициями в его карточке останутся.',
      )
    )
      return;
    setDeletingQuoteId(quote.id);
    try {
      await deleteSupplierQuote(quote.id);
      setSupplierQuotes((prev) => prev.filter((q) => q.id !== quote.id));
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить КП'));
    } finally {
      setDeletingQuoteId(null);
    }
  }

  // Владелец, 2026-09-11: раньше единственным способом убрать один ошибочно
  // прикреплённый файл (например, задвоенный счёт) была кнопка "Удалить" на
  // всю карточку поставщика — она удаляла не только файл, а весь supplier_
  // research_offers, каскадом стирая переписку (supplier_offer_emails),
  // заявки (supplier_orders) и т.п. (см. FK ON DELETE CASCADE в БД). Отдельное
  // удаление одного файла из offer.files через updateSupplierOffer — без
  // затрагивания самой карточки и переписки.
  async function handleDeleteOfferFile(o: SupplierOffer, index: number) {
    const file = o.files[index];
    if (!file || deletingOfferFileIndex !== null) return;
    if (!window.confirm(`Удалить файл «${file.fileName}»? Сам поставщик и переписка с ним останутся.`)) return;
    setDeletingOfferFileIndex(index);
    try {
      const updated = await updateSupplierOffer(o.id, {
        requestId: o.requestId,
        name: o.name,
        contact: o.contact,
        contactMethod: o.contactMethod,
        email: o.email,
        managerName: o.managerName,
        messengers: o.messengers,
        country: o.country,
        websiteUrl: o.websiteUrl,
        listingUrl: o.listingUrl,
        catalogModelName: o.catalogModelName,
        catalogModelPhoto: o.catalogModelPhoto,
        price: o.price,
        currency: o.currency,
        items: o.items,
        files: o.files.filter((_, i) => i !== index),
        verified: o.verified,
      });
      handleSupplierOfferUpdated(updated);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить файл'));
    } finally {
      setDeletingOfferFileIndex(null);
    }
  }

  const supplierAddButton =
    tab === 'Поставщики' ? (
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => openAddRequest()}>
        Новый запрос
      </Button>
    ) : undefined;

  const unreadSupplierEmailsCount = countUnreadSupplierEmails(supplierEmails);

  return (
    <>
      <PageHeader title="Поставщики" action={supplierAddButton} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          options={[...SUPPLIER_TABS]}
          value={tab}
          onChange={(v) => setTab(v as SupplierTab)}
          badges={{ Письма: unreadSupplierEmailsCount }}
        />
        {/* Владелец, 2026-09-04: "перенеси Шаблоны направо, на уровень меню
            Поставщики/Письма, но видна только когда открываешь Письма". */}
        {tab === 'Письма' && (
          <Button type="button" variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => setTemplatesModalOpen(true)}>
            Шаблоны
          </Button>
        )}
      </div>

      {tab === 'Поставщики' && (
      <div className="mt-6 flex flex-col gap-8">
        {loading && (
          <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем поставщиков...
          </Card>
        )}
        {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}

        {/* Владелец, 2026-09-03: "Страницу Поставщики разбиваем на 3
            логических блока — Материалы и оборудование, Работы, Сервисы".
            Первые два — SupplierRequest.group (см. data/supplierResearch.ts),
            третий — полностью самостоятельный компонент ContractorsResearch
            (перенесён сюда раньше со страницы "Команда"), без общих данных с
            первыми двумя. */}
        {!loading && !loadError && (
          <>
            {(['materials', 'services'] as const).map((group) => {
              const groupRequests = requests.filter((r) => r.group === group);
              return (
                <div key={group} className="flex flex-col gap-6">
                  <div className="text-lg font-bold text-ink">{SUPPLIER_REQUEST_GROUP_LABELS[group]}</div>

                  {groupRequests.length === 0 && (
                    <Card className="py-10 text-center text-sm text-ink-muted">Пока нет запросов — нажмите «Новый запрос»</Card>
                  )}

                  {groupRequests.map((r) => (
                    <RequestCard
                      key={r.id}
                      request={r}
                      offers={offers.filter((o) => o.requestId === r.id)}
                      onEditRequest={openEditRequest}
                      onDeleteRequest={handleDeleteRequest}
                      onAddOffer={openAddOffer}
                      onOpenDetail={(o) => setDetailOfferId(o.id)}
                      onWebSearch={openWebQueryModal}
                      onToggleComparisonMode={toggleComparisonMode}
                      searching={webSearchingId === r.id}
                      searchJob={latestVisibleJobForRequest(r.id)}
                      searchQueueError={webSearchQueueError?.requestId === r.id ? webSearchQueueError.message : null}
                      onDismissSearchJob={dismissWebSearchJob}
                      enrichmentState={enrichmentState}
                    />
                  ))}

                  <Button
                    type="button"
                    variant="secondary"
                    icon={<Plus className="h-4 w-4" />}
                    className="w-fit"
                    onClick={() => openAddRequest(group)}
                  >
                    Новый запрос
                  </Button>
                </div>
              );
            })}
          </>
        )}

        <div className="flex flex-col gap-6 border-t border-border pt-8">
          <div className="text-lg font-bold text-ink">Работы</div>
          <ContractorsResearch />
        </div>
      </div>
      )}

      {/* Владелец, 2026-09-09: "нам как будто нужна отдельная вкладка
          Сравнение цен... как грильято", уточнение тем же днём: "нужно
          добавлять только тех, кто уже прислал КП" + "не списки
          поставщиков, а материал — КП по убыванию" — MaterialPriceComparisonCard
          (не SupplierListBlock — тот для "Поставщики", там просто состав
          списка, без цен). Категория попадает сюда, только если у неё есть
          хотя бы одно ПОДТВЕРЖДЁННОЕ предложение
          (offerCommunicationStatus === 'confirmed') хоть в одной стране —
          иначе сравнивать нечего. */}
      {tab === 'Сравнение цен' && (
        <div className="mt-6 flex flex-col gap-8">
          {loading && (
            <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем поставщиков...
            </Card>
          )}
          {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}

          {!loading && !loadError && (() => {
            const groups = (['materials', 'services'] as const).map((group) => ({
              group,
              requestsWithOffers: requests.filter(
                (r) => r.group === group && offers.some((o) => o.requestId === r.id && offerCommunicationStatus(o, supplierEmails) === 'confirmed'),
              ),
            }));
            const anyOffers = groups.some((g) => g.requestsWithOffers.length > 0);
            if (!anyOffers) {
              return (
                <Card className="py-10 text-center text-sm text-ink-muted">
                  Пока ни один поставщик не прислал КП — сравнивать пока нечего.
                </Card>
              );
            }
            return groups.map(({ group, requestsWithOffers }) => {
              if (requestsWithOffers.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-6">
                  <div className="text-lg font-bold text-ink">{SUPPLIER_REQUEST_GROUP_LABELS[group]}</div>
                  {requestsWithOffers.map((r) => (
                    <MaterialPriceComparisonCard
                      key={r.id}
                      request={r}
                      offers={offers.filter((o) => o.requestId === r.id)}
                      emails={supplierEmails}
                      quotes={supplierQuotes}
                      rate={rate}
                      onOpenDetail={(o) => setDetailOfferId(o.id)}
                      enrichmentState={enrichmentState}
                    />
                  ))}
                </div>
              );
            });
          })()}
        </div>
      )}

      {tab === 'Ведомости материалов' && (
        <div className="mt-6 flex flex-col gap-6">
          <Select
            label="Смета"
            placeholder="Не выбрана"
            options={estimateOptions.map((o) => o.label)}
            value={estimateOptions.find((o) => o.id === ledgerEstimateId)?.label ?? ''}
            onChange={(label) => {
              const o = estimateOptions.find((x) => x.label === label);
              setLedgerEstimateId(o?.id ?? '');
            }}
          />

          {/* Владелец, 2026-09-09: "не хватает отображения шаблонов готовых
              ведомостей на странице ведомостей" — список сохранённых
              MaterialLedger виден прямо на странице, не только внутри
              модалки. Владелец, тем же днём позже: "шаблон ведомости
              материала привязывался к смете... когда выбран Red One, всё
              равно видны шаблоны Зелёного" — список СОЗНАТЕЛЬНО ограничен
              ведомостями ВЫБРАННОЙ выше сметы (scopedMaterialLedgers), не
              всеми сразу, и требует сначала выбрать смету. */}
          <div className="flex flex-col gap-3">
            <span className="text-lg font-bold text-ink">Готовые ведомости</span>
            {!ledgerEstimateId && <p className="text-sm text-ink-faint">Выберите смету, чтобы увидеть её ведомости.</p>}
            {ledgerEstimateId && scopedMaterialLedgers.length === 0 && (
              <p className="text-sm text-ink-faint">Для этой сметы пока нет ни одной сохранённой ведомости.</p>
            )}
            {scopedMaterialLedgers.length > 0 && (
              <div className="flex flex-col gap-2">
                {scopedMaterialLedgers.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{l.name}</div>
                      <div className="text-xs text-ink-faint">
                        {l.items.length} {l.items.length === 1 ? 'позиция' : 'позиций'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setLedgerModalTarget(l.id)}
                        aria-label="Редактировать ведомость"
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteLedgerFromList(l.id, l.name)}
                        aria-label="Удалить ведомость"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {ledgerEstimateId && (
              <Button
                type="button"
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                className="w-fit"
                onClick={() => setLedgerModalTarget('new')}
              >
                Новая ведомость
              </Button>
            )}
          </div>

          {ledgerError && <p className="text-sm text-danger">{ledgerError}</p>}

          {!ledgerEstimate && (
            <Card className="py-10 text-center text-sm text-ink-muted">Выберите смету, чтобы увидеть ведомость материалов</Card>
          )}

          {ledgerEstimate && ledgerEstimate.sections.length === 0 && (
            <Card className="py-10 text-center text-sm text-ink-muted">В этой смете пока нет разделов</Card>
          )}

          {ledgerEstimate && (
            <div className="flex flex-col gap-8">
              {ledgerEstimate.sections.map((section) => {
                const { ungrouped, groups } = groupMaterials(section.materials);
                return (
                  <div key={section.id} className="flex flex-col gap-3">
                    {editingLedgerSectionId === section.id ? (
                      <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
                        <Input
                          label="Название раздела"
                          value={ledgerSectionTitleDraft}
                          onChange={(e) => setLedgerSectionTitleDraft(e.target.value)}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" onClick={() => setEditingLedgerSectionId(null)}>
                            Отмена
                          </Button>
                          <Button type="button" onClick={saveLedgerSectionTitle} disabled={savingLedgerSection}>
                            {savingLedgerSection ? 'Сохраняем...' : 'Сохранить'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-lg font-bold text-ink">{section.title}</span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEditLedgerSection(section)}
                            aria-label="Переименовать раздел"
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteLedgerSection(section.id)}
                            aria-label="Удалить раздел"
                            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {section.materials.length === 0 && <p className="text-sm text-ink-faint">Материалов пока нет.</p>}

                    {ungrouped.length > 0 && (
                      <MaterialsTable
                        materials={ungrouped}
                        onEdit={(m) => openEditMaterial(section.id, m)}
                        onDelete={(m) => deleteMaterial(section.id, m.id)}
                        onOpenComments={(m) => openMaterialComments(section.id, m)}
                      />
                    )}

                    {groups.map((g) => (
                      <div key={g.name} className="flex flex-col gap-2">
                        <span className="w-fit rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary">
                          {g.name}
                        </span>
                        <MaterialsTable
                          materials={g.materials}
                          onEdit={(m) => openEditMaterial(section.id, m)}
                          onDelete={(m) => deleteMaterial(section.id, m.id)}
                          onOpenComments={(m) => openMaterialComments(section.id, m)}
                        />
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="secondary"
                      icon={<Plus className="h-4 w-4" />}
                      className="w-fit"
                      onClick={() => openAddMaterial(section.id)}
                    >
                      Добавить материал в «{section.title}»
                    </Button>
                  </div>
                );
              })}

              <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={addLedgerSection}>
                Добавить раздел
              </Button>
            </div>
          )}
        </div>
      )}

      {tab === 'Письма' && (
        // Владелец, 2026-09-10: "надо, чтобы влезало полностью, вне
        // зависимости от экрана... даже если боковой список поставщиков
        // будет как-то скрываться" — вкладка "Письма" на lg+ занимает всю
        // высоту, доступную от AppLayout (main теперь overflow-y-auto, не
        // документ целиком), дальше цепочка flex-1/min-h-0 идёт вниз до
        // самого списка писем внутри SupplierCorrespondenceTab/EmailThread —
        // композер всегда виден целиком, скроллится только лента писем.
        <div className="mt-6 flex flex-col lg:min-h-0 lg:flex-1">
          <SupplierCorrespondenceTab
            requests={requests}
            offers={offers}
            orders={supplierOrders}
            emails={supplierEmails}
            templates={emailTemplates}
            ledgers={materialLedgers}
            allMaterials={allEstimateMaterials}
            legalEntities={legalEntities}
            templatesModalOpen={templatesModalOpen}
            onCloseTemplatesModal={() => setTemplatesModalOpen(false)}
            onOpenBulkSend={setBulkLedgerPickerRequest}
            onEmailSent={handleSupplierEmailSent}
            onMarkRead={handleMarkSupplierEmailsRead}
            onTemplatesChange={setEmailTemplates}
            onLedgersChange={setMaterialLedgers}
            onOfferUpdated={handleSupplierOfferUpdated}
            onOrdersChange={setSupplierOrders}
            onQuoteAdded={(q) => setSupplierQuotes((prev) => [...prev, q])}
            onEmailUpdated={handleSupplierEmailUpdated}
          />
        </div>
      )}

      <Modal open={requestModalOpen} onClose={() => setRequestModalOpen(false)} title={editingRequest ? 'Редактировать запрос' : 'Новый запрос'}>
        <form onSubmit={submitRequest} className="flex flex-col gap-4">
          <Input
            label="Название запроса"
            placeholder="Например, Поиск ЦСП-плит"
            value={requestForm.title}
            onChange={(e) => setRequestForm((f) => ({ ...f, title: e.target.value }))}
            required
            autoFocus
          />

          <ToggleGroup
            label="Блок"
            options={SUPPLIER_REQUEST_GROUPS.map((g) => SUPPLIER_REQUEST_GROUP_LABELS[g])}
            value={SUPPLIER_REQUEST_GROUP_LABELS[requestForm.group]}
            onChange={(label) =>
              setRequestForm((f) => ({
                ...f,
                group: (SUPPLIER_REQUEST_GROUPS.find((g) => SUPPLIER_REQUEST_GROUP_LABELS[g] === label) ?? f.group),
              }))
            }
          />

          <Select
            label="Смета"
            placeholder="Не выбрана"
            options={estimateOptions.map((o) => o.label)}
            value={estimateOptions.find((o) => o.id === requestForm.estimateId)?.label ?? ''}
            onChange={(label) => {
              const o = estimateOptions.find((x) => x.label === label);
              setRequestForm((f) => ({ ...f, estimateId: o?.id ?? '', sectionId: '', sectionTitle: '' }));
            }}
          />

          <Select
            label="Юрлицо"
            placeholder={
              defaultLegalEntity
                ? `По умолчанию (${defaultLegalEntity.shortName || defaultLegalEntity.name})`
                : 'Не выбрано'
            }
            options={legalEntities.map((e) => e.shortName || e.name)}
            value={(() => {
              const picked = legalEntities.find((e) => e.id === requestForm.legalEntityId);
              return picked ? picked.shortName || picked.name : '';
            })()}
            onChange={(label) => {
              const e = legalEntities.find((x) => (x.shortName || x.name) === label);
              setRequestForm((f) => ({ ...f, legalEntityId: e?.id ?? '' }));
            }}
          />

          {/* Владелец, 2026-09-09: "формируем поставку — сравниваем цену на
              поставку в целом. Но, если бы позиции были штукатурка и плитка,
              то могли бы заказать и в разных местах" — тип сравнения на
              вкладке "Сравнение цен" выбирается один раз при создании
              категории, не автоматика (см. SUPPLIER_COMPARISON_MODES в
              data/supplierResearch.ts). */}
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Тип сравнения цен</span>
            <ToggleGroup
              options={SUPPLIER_COMPARISON_MODES.map((m) => SUPPLIER_COMPARISON_MODE_LABELS[m])}
              value={SUPPLIER_COMPARISON_MODE_LABELS[requestForm.comparisonMode]}
              onChange={(label) => {
                const mode = SUPPLIER_COMPARISON_MODES.find((m) => SUPPLIER_COMPARISON_MODE_LABELS[m] === label);
                if (mode) setRequestForm((f) => ({ ...f, comparisonMode: mode }));
              }}
            />
            <span className="text-xs text-ink-faint">{SUPPLIER_COMPARISON_MODE_HINTS[requestForm.comparisonMode]}</span>
          </div>

          {selectedRequestEstimate && (
            <Select
              label="Раздел сметы"
              placeholder="Не выбран"
              options={selectedRequestEstimate.sections.map((s) => s.title)}
              value={selectedRequestSection?.title ?? ''}
              onChange={(title) => {
                const s = selectedRequestEstimate.sections.find((x) => x.title === title);
                setRequestForm((f) => ({ ...f, sectionId: s?.id ?? '', sectionTitle: s?.title ?? '' }));
              }}
            />
          )}

          {requestError && <p className="text-sm text-danger">{requestError}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setRequestModalOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!requestForm.title.trim() || savingRequest}>
              {savingRequest ? 'Сохраняем...' : editingRequest ? 'Сохранить' : 'Создать'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={offerModalOpen} onClose={() => setOfferModalOpen(false)} title={editingOffer ? 'Редактировать предложение' : 'Новое предложение'}>
        <form onSubmit={submitOffer} className="flex flex-col gap-4">
          <Input
            label="Название"
            placeholder="Имя или название компании"
            value={offerForm.name}
            onChange={(e) => setOfferForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Контакт</span>
            <div className="flex gap-2">
              <ToggleGroup
                options={[...RESEARCH_CONTACT_METHODS]}
                value={offerForm.contactMethod}
                onChange={(v) => setOfferForm((f) => ({ ...f, contactMethod: v as ResearchContactMethod }))}
              />
              <Input
                placeholder={
                  offerForm.contactMethod === 'Telegram'
                    ? '@username'
                    : offerForm.country === 'Россия'
                      ? '+7 9__ ...'
                      : '+375 29 ...'
                }
                type={offerForm.contactMethod === 'Telegram' ? 'text' : 'tel'}
                value={offerForm.contact}
                onChange={(e) => setOfferForm((f) => ({ ...f, contact: e.target.value }))}
                className="flex-1"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Мессенджеры</span>
            {offerForm.messengers.map((m, i) => (
              <div key={i} className="flex gap-2">
                <div className="w-36 shrink-0">
                  <Select
                    options={[...SUPPLIER_MESSENGER_TYPES]}
                    value={m.type}
                    onChange={(v) =>
                      setOfferForm((f) => ({
                        ...f,
                        messengers: f.messengers.map((x, xi) => (xi === i ? { ...x, type: v as SupplierMessengerType } : x)),
                      }))
                    }
                  />
                </div>
                <Input
                  placeholder="+7 9__ ..."
                  value={m.number}
                  onChange={(e) =>
                    setOfferForm((f) => ({
                      ...f,
                      messengers: f.messengers.map((x, xi) => (xi === i ? { ...x, number: e.target.value } : x)),
                    }))
                  }
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setOfferForm((f) => ({ ...f, messengers: f.messengers.filter((_, xi) => xi !== i) }))}
                  aria-label="Удалить мессенджер"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-danger hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              className="w-fit"
              onClick={() =>
                setOfferForm((f) => ({ ...f, messengers: [...f.messengers, { type: SUPPLIER_MESSENGER_TYPES[0], number: '' }] }))
              }
            >
              Мессенджер
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Email"
              placeholder="mail@example.com"
              type="email"
              value={offerForm.email}
              onChange={(e) => setOfferForm((f) => ({ ...f, email: e.target.value }))}
            />
            <Input
              label="Менеджер"
              placeholder="Имя контактного лица"
              value={offerForm.managerName}
              onChange={(e) => setOfferForm((f) => ({ ...f, managerName: e.target.value }))}
            />
          </div>

          <Input
            label="Адрес сайта"
            placeholder="https://..."
            value={offerForm.websiteUrl}
            onChange={(e) => {
              const websiteUrl = e.target.value;
              // Владелец, 2026-09-03: "для поставщиков с сайтом в зоне .by
              // автоматически проставляй Беларусь, для .ru — Россию" — не
              // трогает страну, если она уже выбрана (вручную или раньше).
              setOfferForm((f) => ({ ...f, websiteUrl, country: f.country || guessCountryFromWebsite(websiteUrl) }));
            }}
          />

          <Input
            label="Ссылка на позицию"
            placeholder="https://... (страница конкретного товара, не главная сайта)"
            value={offerForm.listingUrl}
            onChange={(e) => setOfferForm((f) => ({ ...f, listingUrl: e.target.value }))}
          />

          <AddableSelect
            label="Страна"
            placeholder="Не выбрано"
            options={knownCountries}
            value={offerForm.country}
            onChange={(v) => setOfferForm((f) => ({ ...f, country: v }))}
            addLabel="+ Добавить страну"
            newPlaceholder="Название страны"
          />

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Модель в каталоге</span>
            <Input
              placeholder="Название модели"
              value={offerForm.catalogModelName}
              onChange={(e) => setOfferForm((f) => ({ ...f, catalogModelName: e.target.value }))}
            />
            <div className="flex items-center gap-3">
              {offerForm.catalogModelPhoto ? (
                <div className="flex items-center gap-2">
                  <img
                    src={offerForm.catalogModelPhoto.url}
                    alt=""
                    className="h-14 w-14 shrink-0 rounded-control object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setOfferForm((f) => ({ ...f, catalogModelPhoto: null }))}
                    className="flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-danger"
                  >
                    <X className="h-4 w-4" />
                    Убрать фото
                  </button>
                </div>
              ) : (
                <label className="flex w-fit cursor-pointer items-center gap-2 rounded-control border border-dashed border-border px-4 py-2.5 text-sm text-ink-muted hover:border-border-strong">
                  {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploadingPhoto ? 'Загружаем...' : 'Загрузить фото'}
                  <input type="file" accept="image/*" className="hidden" disabled={uploadingPhoto} onChange={handleCatalogPhotoSelect} />
                </label>
              )}
            </div>
          </div>

          {/* Владелец, 2026-09-04: "Статус коммуникации — вполне можем
              определять автоматически" / "Срок — убирай, срок доставки будет
              отличаться для каждой поставки" / "Требования — убирай" — статус
              теперь считается сам из переписки (offerCommunicationStatus), у
              срока/требований больше нет места на уровне поставщика в целом
              (переезжают на уровень конкретной заявки на поставку). "Итоговая
              цена"/"Позиции КП" тогда же были убраны как "вручную это
              указывать тупо" в пользу единственного пути — автораспознавания
              счёта из переписки (applyExtractionToOffer в
              SupplierCorrespondenceTab.tsx). Владелец, 2026-09-09: "у нас есть
              поставщик с КП, найденный вручную... добавляем его как нового
              поставщика и загружаем КП, система распознаёт КП и записывает
              цену в базу — вручную не будем ничего указывать" — оба поля
              возвращены, но заполняются НЕ вводом с клавиатуры, а тем же
              автораспознаванием, что и на входящих письмах (см.
              handleOfferFilesSelect ниже — привязано к загрузке файла в
              "Файлы", идёт перед этим блоком по той же причине). Поля
              остаются редактируемыми — как и в переписке, это поправка уже
              распознанного, а не приглашение печатать с нуля. */}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Файлы (счета, спецификации...) — загрузите КП, цена распознается сама</span>
            {offerForm.existingFiles.map((file, i) => (
              <div
                key={`existing-${i}`}
                className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink"
              >
                <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
                {/* Владелец, 2026-09-09 (баг «Глассвэй» на проде): автораспознавание
                    при загрузке — одноразовая попытка, без видимого способа
                    повторить, если она молча не сработала (сетевая икота,
                    временная ошибка ProxyAPI) или файл добавлен раньше этой
                    возможности. Кнопка позволяет вызвать распознавание заново по
                    уже прикреплённому файлу в любой момент. */}
                {isRecognizableFileName(file.fileName) && (
                  <button
                    type="button"
                    onClick={() => tryRecognizeOfferFile(file.url, file.fileName)}
                    disabled={offerExtractionBusy}
                    className="shrink-0 text-xs font-medium text-primary-hover hover:underline disabled:opacity-50"
                  >
                    Распознать
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setOfferForm((f) => ({ ...f, existingFiles: f.existingFiles.filter((_, idx) => idx !== i) }))
                  }
                  aria-label="Убрать файл"
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-control border border-dashed border-border px-4 py-2.5 text-sm text-ink-muted hover:border-border-strong">
              {offerUploadingFile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {offerUploadingFile ? 'Загружаем...' : 'Добавить файлы'}
              <input
                type="file"
                multiple
                className="hidden"
                disabled={offerUploadingFile}
                onChange={handleOfferFilesSelect}
              />
            </label>
            {offerExtractionBusy && <p className="text-xs text-ink-faint">Распознаём документ...</p>}
            {offerExtractionError && <p className="text-xs text-danger">{offerExtractionError}</p>}
            {offerNotInvoiceFile && (
              <p className="text-xs text-ink-faint">
                «{offerNotInvoiceFile}» не похож на счёт с итоговой суммой — цену и позиции придётся внести
                вручную, либо нажать «Распознать» ещё раз, если это ошибка.
              </p>
            )}
            {offerExtraction && (
              <div className="flex flex-col gap-2 rounded-control border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm">
                <span className="font-medium text-ink">
                  Похоже, это счёт («{offerExtraction.fileName}»):{' '}
                  {offerExtraction.price != null
                    ? formatPrice(
                        offerExtraction.price,
                        isValidOfferCurrency(offerExtraction.currency) ? offerExtraction.currency : offerForm.currency,
                      )
                    : 'сумма не распознана'}
                  {offerExtraction.items.length > 0 ? `, ${offerExtraction.items.length} поз.` : ''}
                </span>
                <div className="flex gap-2">
                  <Button type="button" onClick={confirmOfferExtraction}>
                    Подтвердить
                  </Button>
                  <Button type="button" variant="secondary" onClick={dismissOfferExtraction}>
                    Это не счёт
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Итоговая цена</span>
            <div className="flex gap-2">
              <Input
                placeholder="0"
                type="number"
                min="0"
                value={offerForm.price}
                onChange={(e) => setOfferForm((f) => ({ ...f, price: e.target.value }))}
                className="flex-1"
              />
              <ToggleGroup
                options={RESEARCH_CURRENCIES}
                value={offerForm.currency}
                onChange={(v) => setOfferForm((f) => ({ ...f, currency: v as Currency }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Позиции КП</span>
            {offerForm.items.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {offerForm.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1.5 rounded-control border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-ink">{item.name}</span>
                      <input
                        type="number"
                        placeholder="Кол-во"
                        value={item.quantity ?? ''}
                        onChange={(e) =>
                          updateOfferItem(item.id, { quantity: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        className="w-16 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                      />
                      {item.unit && <span className="w-10 shrink-0 text-ink-faint">{item.unit}</span>}
                      <input
                        type="number"
                        placeholder="Цена"
                        value={item.price ?? ''}
                        onChange={(e) =>
                          updateOfferItem(item.id, { price: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        className="w-24 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => removeOfferItem(item.id)}
                        aria-label="Удалить позицию"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {item.note && <span className="text-xs text-ink-faint">{item.note}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Добавить позицию вручную"
                value={offerManualItemName}
                onChange={(e) => setOfferManualItemName(e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={addManualOfferItem} disabled={!offerManualItemName.trim()}>
                Добавить
              </Button>
            </div>
            {offerItemsTotal > 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-faint">
                <span>Сумма по позициям: {formatPrice(offerItemsTotal, offerForm.currency)}</span>
                <button
                  type="button"
                  onClick={() => setOfferForm((f) => ({ ...f, price: String(offerItemsTotal) }))}
                  className="text-primary-hover hover:underline"
                >
                  Подставить в итоговую цену
                </button>
              </div>
            )}
          </div>

          {offerError && <p className="text-sm text-danger">{offerError}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOfferModalOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmitOffer || savingOffer}>
              {savingOffer ? 'Сохраняем...' : editingOffer ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </form>
      </Modal>

      {emailOfferId &&
        (() => {
          const offer = offers.find((o) => o.id === emailOfferId);
          const request = offer ? requests.find((r) => r.id === offer.requestId) : undefined;
          if (!offer || !request) return null;
          return (
            <OfferEmailModal
              offer={offer}
              request={request}
              requests={requests}
              emails={supplierEmails.filter((e) => e.offerId === offer.id)}
              templates={emailTemplates}
              ledgers={materialLedgers}
              allMaterials={allEstimateMaterials}
              legalEntities={legalEntities}
              onEmailSent={handleSupplierEmailSent}
              onMarkRead={handleMarkSupplierEmailsRead}
              onTemplateSaved={handleEmailTemplateSaved}
              onLedgersChange={setMaterialLedgers}
              onOfferUpdated={handleSupplierOfferUpdated}
              onEmailUpdated={handleSupplierEmailUpdated}
              onQuoteAdded={(q) => setSupplierQuotes((prev) => [...prev, q])}
              onClose={() => setEmailOfferId(null)}
            />
          );
        })()}

      {detailOfferId &&
        (() => {
          const offer = offers.find((o) => o.id === detailOfferId);
          if (!offer) return null;
          return (
            <OfferDetailModal
              offer={offer}
              emails={supplierEmails}
              onClose={() => setDetailOfferId(null)}
              onEmail={(o) => {
                setEmailOfferId(o.id);
                setDetailOfferId(null);
              }}
              onEdit={openEditOffer}
              onDelete={handleDeleteOffer}
              deleting={deletingOfferId === offer.id}
              onDeleteFile={handleDeleteOfferFile}
              deletingFileIndex={deletingOfferId === offer.id ? null : deletingOfferFileIndex}
              offerQuotes={supplierQuotes.filter((q) => q.offerId === offer.id)}
              onQuoteAlternativeChange={handleQuoteAlternativeChange}
              onQuoteDelete={handleDeleteQuote}
              savingQuoteId={savingQuoteId}
              deletingQuoteId={deletingQuoteId}
              enrichmentState={enrichmentState}
              onVerify={handleVerifyOffer}
              verifying={verifyingOfferId === offer.id}
            />
          );
        })()}

      <Modal open={!!webQueryModal} onClose={() => setWebQueryModal(null)} title={`Найти в сети: ${webQueryModal?.title ?? ''}`}>
        <form onSubmit={submitWebQuery} className="flex flex-col gap-4">
          <div>
            <div className="mb-1.5 text-sm font-medium text-ink">Страна поиска</div>
            <ToggleGroup
              options={[...SUPPLIER_COUNTRIES]}
              value={webQueryForm.country}
              onChange={(country) => setWebQueryForm((f) => ({ ...f, country }))}
            />
          </div>
          <Textarea
            label="Что ищем"
            rows={3}
            value={webQueryForm.itemsText}
            onChange={(e) => setWebQueryForm((f) => ({ ...f, itemsText: e.target.value }))}
          />
          <Textarea
            label="Дополнительные пожелания (необязательно)"
            rows={3}
            placeholder="Например: бренд Ceresit, бюджет до $500, готовы смотреть не только Минск"
            value={webQueryForm.extra}
            onChange={(e) => setWebQueryForm((f) => ({ ...f, extra: e.target.value }))}
          />
          <p className="text-xs text-ink-faint">
            Поиск идёт в фоне — вкладку можно сразу закрыть, о готовности придёт уведомление.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setWebQueryModal(null)}>
              Отмена
            </Button>
            <Button type="submit" icon={<Search className="h-4 w-4" />} disabled={!webQueryForm.itemsText.trim()}>
              Искать
            </Button>
          </div>
        </form>
      </Modal>

      <EstimateMaterialFormModal
        open={materialModalOpen}
        material={editingMaterial}
        groupOptions={materialGroupOptions}
        onClose={() => setMaterialModalOpen(false)}
        onSaved={saveMaterial}
      />

      <EstimateMaterialCommentsModal
        material={commentsMaterial}
        onClose={() => {
          setCommentsMaterialSectionId(null);
          setCommentsMaterial(null);
        }}
        onSave={saveMaterialComments}
      />

      {/* Владелец, 2026-09-04: "давай реализуем массовую отправку" — мастер
          из двух модалок, оба рендерятся здесь (не внутри вкладки "Письма"),
          чтобы переключение вкладок страницы не обрывало уже идущую
          рассылку (см. комментарий у bulkSendConfig выше). Шаг 1 —
          переиспользованный MaterialLedgerModal (тот же пикер, что и у
          "Прикрепить ведомость" в одиночном письме), его onAttach передаёт
          готовый xlsx дальше, в шаг 2 (BulkSendModal). */}
      {/* Владелец, 2026-09-04: "на этой странице делать Шаблоны" —
          управление пресетами ведомостей вне контекста конкретного письма
          (нет onAttach — только создание/правка/удаление). Тот же общий
          список materialLedgers, что и у "Прикрепить ведомость"/"Массовая
          отправка" на "Письмах" — правка здесь сразу видна там же.
          Владелец, 2026-09-09: список ведомостей теперь виден прямо на
          странице (см. блок "Готовые ведомости" выше) — модалка целится в
          конкретную ведомость через ledgerModalTarget ('new' или id),
          внутренний селект "Готовая ведомость" скрыт (hideLedgerPicker) —
          выбор какую редактировать уже сделан кликом в списке на странице,
          повторять его внутри модалки было непонятно, зачем. Чек-лист
          материалов ограничен выбранной на странице сметой
          (ledgerEstimateChecklistMaterials), чтобы не путать позиции Red One
          с позициями Смета Зелёный. Владелец, 2026-09-09 (второй заход):
          "шаблон ведомости привязывался к смете" — новая ведомость, созданная
          здесь, сохраняется с estimateId=ledgerEstimateId (проп estimateId
          ниже), сам список на странице (scopedMaterialLedgers) фильтруется по
          этому же полю — открыв Red One, Зелёный больше не виден. */}
      {ledgerModalTarget !== null && (
        <MaterialLedgerModal
          open
          hideLedgerPicker
          initialLedgerId={ledgerModalTarget === 'new' ? undefined : ledgerModalTarget}
          estimateId={ledgerEstimateId || null}
          requestItems={[]}
          allMaterials={ledgerEstimateChecklistMaterials}
          ledgers={materialLedgers}
          onClose={() => setLedgerModalTarget(null)}
          onLedgersChange={setMaterialLedgers}
        />
      )}

      {bulkLedgerPickerRequest && (
        <MaterialLedgerModal
          open
          readyOnly
          requestItems={[]}
          allMaterials={allEstimateMaterials}
          ledgers={materialLedgers}
          onClose={() => setBulkLedgerPickerRequest(null)}
          onLedgersChange={setMaterialLedgers}
          onAttach={(attachment) => {
            const request = bulkLedgerPickerRequest;
            setBulkLedgerPickerRequest(null);
            setBulkSendConfig({ request, attachment });
          }}
        />
      )}

      {bulkSendConfig && (
        <BulkSendModal
          request={bulkSendConfig.request}
          requests={requests}
          attachment={bulkSendConfig.attachment}
          offers={offers}
          emails={supplierEmails}
          templates={emailTemplates}
          legalEntities={legalEntities}
          onClose={() => setBulkSendConfig(null)}
          onTemplatesChange={setEmailTemplates}
        />
      )}
    </>
  );
}

// Тонкая обёртка над общим EmailThread (см. components/suppliers/
// SupplierCorrespondenceTab.tsx) — письма и их отправка/отметка
// прочитанным идут через тот же supplierEmails на уровне страницы, что и
// у вкладки "Email", отдельного fetch здесь больше нет.
function OfferEmailModal({
  offer,
  request,
  requests,
  emails,
  templates,
  ledgers,
  allMaterials,
  legalEntities,
  onEmailSent,
  onMarkRead,
  onTemplateSaved,
  onLedgersChange,
  onOfferUpdated,
  onEmailUpdated,
  onQuoteAdded,
  onClose,
}: {
  offer: SupplierOffer;
  request: SupplierRequest;
  requests: SupplierRequest[];
  emails: SupplierOfferEmail[];
  templates: EmailTemplate[];
  ledgers: MaterialLedger[];
  allMaterials: { item: PurchaseItem; context: string }[];
  legalEntities: LegalEntity[];
  onEmailSent: (email: SupplierOfferEmail) => void;
  onMarkRead: (offerId: string, orderId: string | null) => void;
  onTemplateSaved: (template: EmailTemplate) => void;
  onLedgersChange: (ledgers: MaterialLedger[]) => void;
  onOfferUpdated: (offer: SupplierOffer) => void;
  onEmailUpdated: (email: SupplierOfferEmail) => void;
  onQuoteAdded: (quote: SupplierQuote) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" — эта
    // модалка (быстрое "Написать" из карточки предложения) всегда
    // открывает "основную" переписку (order=null); полный чек-лист заявок
    // с переключением между ними — только на вкладке "Письма"
    // (SupplierCorrespondenceTab).
    onMarkRead(offer.id, null);
    // onMarkRead — стабильная ссылка из родителя (не зависит от рендера),
    // намеренно не в зависимостях, чтобы не звать повторно на каждый чужой
    // ре-рендер — только при реальной смене предложения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.id]);

  return (
    <Modal open onClose={onClose} title={offer.name}>
      <EmailThread
        offer={offer}
        order={null}
        request={request}
        requests={requests}
        emails={emails}
        templates={templates}
        ledgers={ledgers}
        allMaterials={allMaterials}
        legalEntities={legalEntities}
        onEmailSent={onEmailSent}
        onTemplateSaved={onTemplateSaved}
        onLedgersChange={onLedgersChange}
        onOfferUpdated={onOfferUpdated}
        onOrderUpdated={() => {}}
        onEmailUpdated={onEmailUpdated}
        onQuoteAdded={onQuoteAdded}
      />
    </Modal>
  );
}
