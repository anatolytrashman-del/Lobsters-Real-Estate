import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Loader2, Trash2, Pencil, Send, Phone, Globe, Paperclip, Upload, X, ImageOff, Mail, Search, Check, FileText } from 'lucide-react';
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
import type { DocumentFile } from '../data/contractorDocuments';
import {
  RESEARCH_CONTACT_METHODS,
  SUPPLIER_COUNTRIES,
  SUPPLIER_REQUEST_GROUPS,
  SUPPLIER_REQUEST_GROUP_LABELS,
  guessCountryFromWebsite,
  countryFlag,
  offerCommunicationStatus,
  OFFER_COMMUNICATION_STATUS_LABEL,
  type ResearchContactMethod,
  type SupplierRequest,
  type SupplierRequestGroup,
  type SupplierOffer,
  formatRequestItemsText,
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
import { searchSuppliersOnline, type SupplierSearchResult } from '../lib/supplierWebSearchApi';
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
const SUPPLIER_TABS = ['Поставщики', 'Ведомости материалов', 'Письма'] as const;
type SupplierTab = (typeof SUPPLIER_TABS)[number];

// Владелец, 2026-09-04: "меня бесит, что у всей страницы Поставщики
// одинаковый url... обновляешь — и всё слетело. Мне бы кастомный урл и на
// каждый раздел внутри" — вкладка живёт в query-параметре ?tab=, а не в
// локальном стейте, F5 остаётся на той же вкладке. Слаги, не сами русские
// названия — если вкладку когда-нибудь переименуют, старые сохранённые
// ссылки не должны сломаться.
const SUPPLIER_TAB_SLUGS: Record<SupplierTab, string> = {
  'Поставщики': 'suppliers',
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
  items: [] as PurchaseItem[],
  legalEntityId: '' as string,
};

function requestToForm(r: SupplierRequest) {
  return {
    title: r.title,
    group: r.group,
    estimateId: r.estimateId ?? '',
    sectionId: r.sectionId ?? '',
    sectionTitle: r.sectionTitle,
    items: r.items,
    legalEntityId: r.legalEntityId ?? '',
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
  catalogModelName: '',
  catalogModelPhoto: null as DocumentFile | null,
  existingFiles: [] as DocumentFile[],
  newFiles: [] as File[],
};

// Владелец, 2026-09-03: "для материалов и сервисов мне нужно список — для
// Беларуси и для России... в идеале переключение списков прямо внутри
// самого блока, чем делать две отдельные таблицы". Переключатель — локальный
// стейт карточки (не персистится), по умолчанию Беларусь. Предложения без
// страны (старые записи до поля country) на всякий случай считаем
// белорусскими — иначе они пропали бы из обеих вкладок молча.
function RequestCard({
  request,
  offers,
  emails,
  onEditRequest,
  onDeleteRequest,
  onAddOffer,
  onOpenDetail,
  onWebSearch,
  searching,
}: {
  request: SupplierRequest;
  offers: SupplierOffer[];
  emails: SupplierOfferEmail[];
  onEditRequest: (r: SupplierRequest) => void;
  onDeleteRequest: (r: SupplierRequest) => void;
  onAddOffer: (requestId: string) => void;
  onOpenDetail: (o: SupplierOffer) => void;
  onWebSearch: (r: SupplierRequest, country: string) => void;
  searching: boolean;
}) {
  const [country, setCountry] = useState<string>(SUPPLIER_COUNTRIES[0]);
  const offersInCountry = offers.filter((o) => (o.country || SUPPLIER_COUNTRIES[0]) === country);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold text-ink">{request.title}</div>
          {request.items.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {request.items.map((item) => (
                <span
                  key={item.id}
                  className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs text-ink-muted"
                >
                  {item.name}
                  {item.quantity ? ` · ${item.quantity}${item.unit ? ` ${item.unit}` : ''}` : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={searching}
            icon={searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            onClick={() => onWebSearch(request, country)}
          >
            {searching ? 'Ищем в сети...' : 'Найти в сети'}
          </Button>
          <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => onAddOffer(request.id)}>
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

      <ToggleGroup options={[...SUPPLIER_COUNTRIES]} value={country} onChange={setCountry} />

      {offersInCountry.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {offers.length === 0
            ? 'Пока нет предложений — нажмите «Добавить предложение».'
            : `Нет предложений из «${country}» — переключите страну выше или добавьте предложение.`}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Владелец, 2026-09-04: "Лучшую цену на этой странице не выводим
              вообще. Просто показываем либо верифицированного, либо нет
              поставщика" — сравнение "дешевле всех" по офферу в целом
              убрано (цена теперь живёт на уровне конкретной заявки на
              поставку, не самого поставщика), вместо зелёного бейджа —
              статус верификации. */}
          {offersInCountry.map((o) => {
            const status = offerCommunicationStatus(o, emails);
            return (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-ink">{o.name}</span>
                  {o.verified ? (
                    <Badge tone="success">Верифицирован</Badge>
                  ) : (
                    <Badge tone="warning">Требуется верификация</Badge>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="max-w-[200px] truncate text-sm text-ink-muted">{OFFER_COMMUNICATION_STATUS_LABEL[status]}</span>
                  <span className="tabular-nums font-semibold text-ink">
                    {o.price > 0 ? formatPrice(o.price, o.currency) : '—'}
                  </span>
                  <Button type="button" variant="secondary" onClick={() => onOpenDetail(o)}>
                    Подробнее
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// Модалка результатов "Найти в сети" — владелец, 2026-08-31: "веб-поиск
// поставщиков делай через клод, модель sonnet5". Результат ни во что не
// сохраняется сам по себе (нет отдельной таблицы под "предложенных
// веб-поиском") — каждый найденный вариант сразу добавляется предложением
// (тот же insertSupplierOffer, что и у обычной формы, просто с дефолтной
// ценой/валютой — владелец правит/уточняет цену уже в самом предложении
// через обычный карандаш редактирования, отдельного пути правки здесь нет).
//
// Владелец, 2026-09-03: "оно нашло штук 5, я выбрал 1, открылась карточка
// первого магазина, а когда я сохранил, все остальные пропали. Мне нужна
// возможность добавлять массово" — старая версия открывала форму
// добавления ПОВЕРХ этой модалки и закрывала саму модалку сразу по клику
// (ещё до сохранения), теряя весь оставшийся список. Переделано: никакого
// промежуточного окна редактирования — клик по "Добавить" (в строке или
// массово через чекбоксы) сразу создаёт предложение и помечает строку
// добавленной (галочка), модалка результатов при этом никогда не
// закрывается сама — только явным "Закрыть"/крестиком.
function SupplierWebSearchModal({
  requestTitle,
  results,
  error,
  selected,
  added,
  addingIndices,
  bulkAdding,
  addError,
  onClose,
  onToggleSelect,
  onToggleSelectAll,
  onAddOne,
  onAddSelected,
}: {
  requestTitle: string;
  results: SupplierSearchResult[];
  error: string | null;
  selected: Set<number>;
  added: Set<number>;
  addingIndices: Set<number>;
  bulkAdding: boolean;
  addError: string | null;
  onClose: () => void;
  onToggleSelect: (index: number) => void;
  onToggleSelectAll: () => void;
  onAddOne: (index: number) => void;
  onAddSelected: () => void;
}) {
  const selectableCount = results.filter((_, i) => !added.has(i)).length;
  const allSelected = selectableCount > 0 && selected.size === selectableCount;

  return (
    <Modal open onClose={onClose} title={`Найдено в сети: ${requestTitle}`}>
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!error && results.length === 0 && (
          <p className="text-sm text-ink-faint">Ничего подходящего не нашлось — попробуйте уточнить список материалов в запросе.</p>
        )}

        {results.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
            <button
              type="button"
              onClick={onToggleSelectAll}
              disabled={selectableCount === 0}
              className="text-sm font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {allSelected ? 'Снять выбор' : `Выбрать все (${selectableCount})`}
            </button>
            <Button
              type="button"
              icon={bulkAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              disabled={selected.size === 0 || bulkAdding}
              onClick={onAddSelected}
            >
              {bulkAdding ? 'Добавляем...' : `Добавить выбранные (${selected.size})`}
            </Button>
          </div>
        )}

        {addError && <p className="text-sm text-danger">{addError}</p>}

        {results.map((r, i) => {
          const isAdded = added.has(i);
          const isAdding = addingIndices.has(i);
          return (
            <div key={i} className={cn('flex flex-col gap-2 rounded-control border px-4 py-3', isAdded ? 'border-success/30 bg-success-bg' : 'border-border')}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <label className="flex min-w-0 items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    disabled={isAdded}
                    onChange={() => onToggleSelect(i)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-50"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{r.name}</span>
                    {r.note && <span className="block text-sm text-ink-muted">{r.note}</span>}
                  </span>
                </label>
                {isAdded ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-success px-2.5 py-1 text-xs font-semibold text-white">
                    <Check className="h-3.5 w-3.5" />
                    Добавлено
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    icon={isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    disabled={isAdding || bulkAdding}
                    onClick={() => onAddOne(i)}
                  >
                    Добавить
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 pl-6 text-sm text-ink-muted">
                {r.website && (
                  <a
                    href={/^https?:\/\//.test(r.website) ? r.website : `https://${r.website}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    {siteLabel(r.website)}
                  </a>
                )}
                {r.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {r.phone}
                  </span>
                )}
                {r.email && (
                  <span className="flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 shrink-0" />
                    {r.email}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
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
}: {
  offer: SupplierOffer;
  emails: SupplierOfferEmail[];
  onClose: () => void;
  onEmail: (o: SupplierOffer) => void;
  onEdit: (o: SupplierOffer) => void;
  onDelete: (o: SupplierOffer) => void;
  deleting: boolean;
}) {
  const status = offerCommunicationStatus(offer, emails);
  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{offer.name}</span>
          {/* Владелец, 2026-09-04: "перенеси кнопку редактирования наверх" —
              рядом с заголовком карточки, а не в футере среди остальных
              действий. */}
          <button
            type="button"
            onClick={() => onEdit(offer)}
            aria-label="Редактировать предложение"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums text-lg font-semibold text-ink">
            {offer.price > 0 ? formatPrice(offer.price, offer.currency) : 'Цена не указана'}
          </span>
          {offer.verified ? (
            <Badge tone="success">Верифицирован</Badge>
          ) : (
            <Badge tone="warning">Требуется верификация</Badge>
          )}
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
              className="flex w-fit items-center gap-1.5 text-primary hover:underline"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              {siteLabel(offer.websiteUrl)}
            </a>
          ) : (
            <span className="text-ink">—</span>
          )}
        </div>

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
                  <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
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

        {offer.files.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-faint">Файлы</span>
            {offer.files.map((f, i) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-sm text-primary hover:underline"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
              </a>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} disabled={deleting} onClick={() => onDelete(offer)} className="mr-auto">
            Удалить
          </Button>
          {/* Владелец, 2026-09-04: "поставщик становится доступен для
              email-переписок" только после верификации — до этого "Написать"
              недоступна, нужно сначала открыть форму (кнопка Редактировать
              наверху) и сохранить известные данные. */}
          <Button
            type="button"
            variant="secondary"
            icon={<Mail className="h-4 w-4" />}
            disabled={!offer.verified}
            title={offer.verified ? undefined : 'Сначала заполните данные через «Редактировать» и сохраните'}
            onClick={() => onEmail(offer)}
          >
            Написать
          </Button>
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

  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [objects, setObjects] = useState<RealtyObject[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntity[]>([]);

  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<SupplierRequest | null>(null);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [manualItemName, setManualItemName] = useState('');
  const [savingRequest, setSavingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerRequestId, setOfferRequestId] = useState<string | null>(null);
  const [editingOffer, setEditingOffer] = useState<SupplierOffer | null>(null);
  const [offerForm, setOfferForm] = useState(emptyOfferForm);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
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
  // claude-haiku-4-5 (api/supplier-web-search.js; изначально был
  // claude-sonnet-5, переведено тем же днём из-за цены — см. подробный
  // комментарий в самой функции). Владелец сразу же пожаловался, что клик
  // сразу запускает поиск без возможности что-то уточнить — поэтому
  // кнопка открывает не сам поиск, а сначала
  // webQueryModal: список материалов (редактируемый, вдруг что-то не то
  // подтянулось из раздела сметы) + свободное поле "Дополнительные
  // пожелания" (бренд/бюджет/регион и т.п.), и только по кнопке "Искать"
  // уходит запрос. webSearchingId — id запроса, для которого сейчас идёт
  // поиск (дизейблит кнопку именно этой карточки, не все разом);
  // webSearchModal — какой запрос показывать в модалке результатов и сами
  // результаты/ошибка.
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
  const [webSearchModal, setWebSearchModal] = useState<{
    request: SupplierRequest;
    results: SupplierSearchResult[];
    error: string | null;
  } | null>(null);
  // Выбор/статус строк модалки результатов — индексы в webSearchModal.results.
  // Сбрасываются при каждом новом поиске (см. submitWebQuery). added — уже
  // созданные предложения (не снимается кликом, чтобы случайно не добавить
  // дубль), addingIndices — идёт создание конкретной строки (свой спиннер,
  // не блокирует остальные), bulkAdding — идёт массовое добавление.
  const [webSearchSelected, setWebSearchSelected] = useState<Set<number>>(new Set());
  const [webSearchAdded, setWebSearchAdded] = useState<Set<number>>(new Set());
  const [webSearchAddingIndices, setWebSearchAddingIndices] = useState<Set<number>>(new Set());
  const [webSearchBulkAdding, setWebSearchBulkAdding] = useState(false);
  const [webSearchAddError, setWebSearchAddError] = useState<string | null>(null);

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
  // материалов для письма (MaterialLedgerModal) не все категории имеют
  // собственные request.items (например, "Универсальные поставщики" —
  // пустая категория без привязки к смете), выбирать позиции руками
  // неудобно. Плоский список ВСЕХ материалов ВСЕХ смет (тот же источник,
  // что и у вкладки "Ведомости материалов" на этой же странице) — поиск по
  // нему в модалке, не жёсткая привязка к текущей категории.
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

  function addMaterialToRequestItems(m: EstimateMaterial) {
    if (requestForm.items.some((i) => i.sourceMaterialId === m.id)) return;
    const item: PurchaseItem = {
      id: crypto.randomUUID(),
      sourceMaterialId: m.id,
      name: m.name,
      unit: m.unit,
      quantity: m.quantity,
      price: null,
      note: m.note,
    };
    setRequestForm((f) => ({ ...f, items: [...f.items, item] }));
  }

  function addManualRequestItem() {
    if (!manualItemName.trim()) return;
    const item: PurchaseItem = {
      id: crypto.randomUUID(),
      sourceMaterialId: null,
      name: manualItemName.trim(),
      unit: '',
      quantity: null,
      price: null,
      note: '',
    };
    setRequestForm((f) => ({ ...f, items: [...f.items, item] }));
    setManualItemName('');
  }

  function updateRequestItem(id: string, patch: Partial<PurchaseItem>) {
    setRequestForm((f) => ({ ...f, items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }

  function removeRequestItem(id: string) {
    setRequestForm((f) => ({ ...f, items: f.items.filter((i) => i.id !== id) }));
  }

  // Владелец, 2026-09-03: "будут поставщики из Беларуси и России" — пресет
  // + фактически встречающиеся значения (тот же паттерн, что и у
  // leadRequirements в Leads.tsx).
  const knownCountries = useMemo(() => {
    const set = new Set<string>(SUPPLIER_COUNTRIES);
    offers.forEach((o) => o.country && set.add(o.country));
    return [...set];
  }, [offers]);

  // Ведомость материалов — та же логика, что у saveEstimatePatch/
  // openEditMaterial/deleteMaterial и т.п. в EstimateDetail.tsx (просто
  // работает с локальным списком estimates этой страницы, а не с одной
  // загруженной сметой).
  const ledgerEstimate = estimates.find((e) => e.id === ledgerEstimateId) ?? null;

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
    setManualItemName('');
    setRequestError(null);
    setRequestModalOpen(true);
  }

  function openEditRequest(r: SupplierRequest) {
    setEditingRequest(r);
    setRequestForm(requestToForm(r));
    setManualItemName('');
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
      items: requestForm.items,
      legalEntityId: requestForm.legalEntityId || null,
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

  function openAddOffer(requestId: string) {
    setOfferRequestId(requestId);
    setEditingOffer(null);
    setOfferForm(emptyOfferForm);
    setOfferError(null);
    setOfferModalOpen(true);
  }

  function openWebQueryModal(request: SupplierRequest, country: string) {
    setWebQueryForm({ itemsText: formatRequestItemsText(request.items, request.title), extra: '', country });
    setWebQueryModal(request);
  }

  async function submitWebQuery(e: React.FormEvent) {
    e.preventDefault();
    const request = webQueryModal;
    if (!request || !webQueryForm.itemsText.trim()) return;
    setWebQueryModal(null);
    setWebSearchingId(request.id);
    // Новый поиск — новые результаты, сбрасываем статус выбора/добавления
    // от предыдущего (если это повторный поиск по тому же запросу).
    setWebSearchSelected(new Set());
    setWebSearchAdded(new Set());
    setWebSearchAddingIndices(new Set());
    setWebSearchAddError(null);
    try {
      const results = await searchSuppliersOnline(
        webQueryForm.itemsText.trim(),
        request.sectionTitle || request.title,
        webQueryForm.extra.trim(),
        webQueryForm.country,
      );
      setWebSearchModal({ request, results, error: null });
    } catch (err) {
      setWebSearchModal({ request, results: [], error: errorMessage(err, 'Не удалось выполнить веб-поиск') });
    } finally {
      setWebSearchingId(null);
    }
  }

  function toggleWebSearchSelect(index: number) {
    setWebSearchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleWebSearchSelectAll() {
    if (!webSearchModal) return;
    const selectable = webSearchModal.results.map((_, i) => i).filter((i) => !webSearchAdded.has(i));
    setWebSearchSelected((prev) => (prev.size === selectable.length ? new Set() : new Set(selectable)));
  }

  // Создаёт предложения напрямую (без промежуточной формы, см. комментарий
  // у SupplierWebSearchModal) — с дефолтной ценой/валютой, владелец
  // уточняет их потом через обычный карандаш редактирования у уже
  // созданного предложения, как и любое другое.
  async function addWebSearchResults(requestId: string, items: { index: number; r: SupplierSearchResult }[]) {
    if (items.length === 0) return;
    setWebSearchAddError(null);
    const indices = items.map((x) => x.index);
    if (items.length === 1) {
      setWebSearchAddingIndices((prev) => new Set(prev).add(items[0].index));
    } else {
      setWebSearchBulkAdding(true);
    }
    try {
      const created = await Promise.all(
        items.map(({ r }) =>
          insertSupplierOffer({
            requestId,
            name: r.name,
            contactMethod: 'Телефон',
            contact: r.phone,
            email: r.email,
            managerName: '',
            country: guessCountryFromWebsite(r.website),
            websiteUrl: r.website,
            catalogModelName: '',
            catalogModelPhoto: null,
            price: 0,
            currency: 'USD',
            items: [],
            files: [],
            // Владелец, 2026-09-04: "когда поставщик только добавлен из
            // поиска, ставим ему статус 'Требуется верификация'" — до тех
            // пор скрыт из "Письма" (см. SupplierCorrespondenceTab.tsx),
            // становится доступен после того, как кто-то откроет
            // "Подробнее", заполнит поля и сохранит через форму (submitOffer
            // всегда выставляет verified:true).
            verified: false,
          }),
        ),
      );
      setOffers((prev) => [...prev, ...created]);
      setWebSearchAdded((prev) => {
        const next = new Set(prev);
        indices.forEach((i) => next.add(i));
        return next;
      });
      setWebSearchSelected((prev) => {
        const next = new Set(prev);
        indices.forEach((i) => next.delete(i));
        return next;
      });
    } catch (err) {
      setWebSearchAddError(errorMessage(err, 'Не удалось добавить предложение'));
    } finally {
      setWebSearchAddingIndices((prev) => {
        const next = new Set(prev);
        indices.forEach((i) => next.delete(i));
        return next;
      });
      setWebSearchBulkAdding(false);
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
      catalogModelName: o.catalogModelName,
      catalogModelPhoto: o.catalogModelPhoto,
      existingFiles: o.files,
      newFiles: [],
    });
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

  // Владелец, 2026-09-03: сначала "пусть только заголовок будет обязательным
  // полем, остальное опционально" — но у поля "Адрес сайта" остался
  // HTML required (не заметил в первый заход, браузер блокировал сабмит
  // нативной подсказкой независимо от canSubmitOffer), убрано отдельно. Тем
  // же сообщением уточнил: "Название + 1 любое поле, и этого должно
  // хватить" — совсем пустая карточка (только имя, никакого способа связаться
  // или хоть что-то ещё) толку не несёт, поэтому помимо названия нужно
  // заполнить хотя бы одно из остальных полей (любое, не обязательно сайт
  // или контакт конкретно).
  const canSubmitOffer =
    offerForm.name.trim().length > 0 &&
    (offerForm.contact.trim().length > 0 ||
      offerForm.email.trim().length > 0 ||
      offerForm.country.trim().length > 0 ||
      offerForm.websiteUrl.trim().length > 0 ||
      offerForm.catalogModelName.trim().length > 0 ||
      offerForm.existingFiles.length > 0 ||
      offerForm.newFiles.length > 0);

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
      const uploadedNewFiles = await Promise.all(offerForm.newFiles.map(uploadSupplierFile));
      const payload = {
        requestId: offerRequestId,
        name: offerForm.name.trim(),
        contactMethod: offerForm.contactMethod,
        contact: offerForm.contact.trim(),
        email: offerForm.email.trim(),
        managerName: offerForm.managerName.trim(),
        country: offerForm.country,
        websiteUrl: offerForm.websiteUrl.trim(),
        catalogModelName: offerForm.catalogModelName.trim(),
        catalogModelPhoto: offerForm.catalogModelPhoto,
        price: editingOffer?.price ?? 0,
        currency: editingOffer?.currency ?? ('USD' as Currency),
        items: editingOffer?.items ?? [],
        files: [...offerForm.existingFiles, ...uploadedNewFiles],
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

  async function handleDeleteOffer(o: SupplierOffer) {
    if (!window.confirm(`Удалить предложение «${o.name}»?`)) return;
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
                      emails={supplierEmails}
                      onEditRequest={openEditRequest}
                      onDeleteRequest={handleDeleteRequest}
                      onAddOffer={openAddOffer}
                      onOpenDetail={(o) => setDetailOfferId(o.id)}
                      onWebSearch={openWebQueryModal}
                      searching={webSearchingId === r.id}
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

      {tab === 'Ведомости материалов' && (
        <div className="mt-6 flex flex-col gap-6">
          {/* Владелец, 2026-09-09: "не хватает отображения шаблонов готовых
              ведомостей на странице ведомостей" — раньше список сохранённых
              MaterialLedger был виден только внутри самой модалки "Шаблоны"
              (через выпадающий список), тут он выведен прямо на страницу.
              Список не зависит от выбранной ниже сметы — готовые ведомости
              не привязаны к конкретному объекту. */}
          <div className="flex flex-col gap-3">
            <span className="text-lg font-bold text-ink">Готовые ведомости</span>
            {materialLedgers.length === 0 && (
              <p className="text-sm text-ink-faint">Пока нет ни одной сохранённой ведомости.</p>
            )}
            {materialLedgers.length > 0 && (
              <div className="flex flex-col gap-2">
                {materialLedgers.map((l) => (
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
            <Button
              type="button"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              className="w-fit"
              onClick={() => setLedgerModalTarget('new')}
            >
              Новая ведомость
            </Button>
          </div>

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
        <div className="mt-6">
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

          {selectedRequestSection && selectedRequestSection.materials.length > 0 && (
            <div className="flex flex-col gap-2 rounded-control bg-surface-muted p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Материалы раздела «{selectedRequestSection.title}»
              </span>
              <div className="flex flex-col gap-1.5">
                {selectedRequestSection.materials.map((m) => {
                  const added = requestForm.items.some((i) => i.sourceMaterialId === m.id);
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink">
                        {m.name}
                        {m.unit && (
                          <span className="text-ink-faint">
                            {' '}
                            · {m.quantity ?? '—'} {m.unit}
                          </span>
                        )}
                      </span>
                      <Button type="button" variant="secondary" disabled={added} onClick={() => addMaterialToRequestItems(m)}>
                        {added ? 'Добавлено' : 'Добавить'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Что просим оценить у поставщиков</span>
            {requestForm.items.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {requestForm.items.map((item) => (
                  <div key={item.id} className="flex flex-col gap-1.5 rounded-control border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-ink">{item.name}</span>
                      <input
                        type="number"
                        placeholder="Кол-во"
                        value={item.quantity ?? ''}
                        onChange={(e) =>
                          updateRequestItem(item.id, { quantity: e.target.value === '' ? null : Number(e.target.value) })
                        }
                        className="w-20 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                      />
                      {item.unit && <span className="w-12 text-ink-faint">{item.unit}</span>}
                      <button
                        type="button"
                        onClick={() => removeRequestItem(item.id)}
                        aria-label="Удалить позицию"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {/* Владелец, 2026-09-09: "важно не только объём, но и ряд
                        параметров... нет поля комментария, которое бы и в
                        таблицу попадало, и в письмо" (пример — Grigliato:
                        нужны не только м², но и фактура/формат и т.п.) —
                        note у PurchaseItem уже существовал (для сопоставления
                        счетов), просто не был виден/редактируем здесь; теперь
                        попадает и в ведомость (materialLedgerXlsx.ts), и в
                        текст письма ({материалы}, formatRequestItemsText). */}
                    <input
                      type="text"
                      placeholder="Важные параметры — фактура, формат, цвет и т.п. (попадёт и в ведомость, и в письмо)"
                      value={item.note}
                      onChange={(e) => updateRequestItem(item.id, { note: e.target.value })}
                      className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Добавить позицию вручную"
                value={manualItemName}
                onChange={(e) => setManualItemName(e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={addManualRequestItem} disabled={!manualItemName.trim()}>
                Добавить
              </Button>
            </div>
          </div>

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
              определять автоматически" / "Итоговая цена — убирай" / "Срок —
              убирай, срок доставки будет отличаться для каждой поставки" /
              "Позиции КП — убирай, вручную это указывать тупо, зато когда
              получим КП от поставщика, вполне можем записать в базу" /
              "Требования — убирай" — все пять полей убраны из формы: статус
              теперь считается сам из переписки (offerCommunicationStatus),
              цена/позиции заполняются только автораспознаванием счёта
              (applyExtractionToOffer в SupplierCorrespondenceTab.tsx), у
              срока/требований больше нет места на уровне поставщика в целом
              (переезжают на уровень конкретной заявки на поставку). */}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Файлы (счета, спецификации...)</span>
            {offerForm.existingFiles.map((file, i) => (
              <div
                key={`existing-${i}`}
                className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink"
              >
                <span className="min-w-0 flex-1 truncate">{file.fileName}</span>
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
            {offerForm.newFiles.map((file, i) => (
              <div
                key={`new-${i}`}
                className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink"
              >
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setOfferForm((f) => ({ ...f, newFiles: f.newFiles.filter((_, idx) => idx !== i) }))}
                  aria-label="Убрать файл"
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-control border border-dashed border-border px-4 py-2.5 text-sm text-ink-muted hover:border-border-strong">
              <Upload className="h-4 w-4" />
              Добавить файлы
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (picked.length) setOfferForm((f) => ({ ...f, newFiles: [...f.newFiles, ...picked] }));
                }}
              />
            </label>
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

      {webSearchModal && (
        <SupplierWebSearchModal
          requestTitle={webSearchModal.request.title}
          results={webSearchModal.results}
          error={webSearchModal.error}
          selected={webSearchSelected}
          added={webSearchAdded}
          addingIndices={webSearchAddingIndices}
          bulkAdding={webSearchBulkAdding}
          addError={webSearchAddError}
          onClose={() => setWebSearchModal(null)}
          onToggleSelect={toggleWebSearchSelect}
          onToggleSelectAll={toggleWebSearchSelectAll}
          onAddOne={(i) => addWebSearchResults(webSearchModal.request.id, [{ index: i, r: webSearchModal.results[i] }])}
          onAddSelected={() =>
            addWebSearchResults(
              webSearchModal.request.id,
              [...webSearchSelected].map((i) => ({ index: i, r: webSearchModal.results[i] })),
            )
          }
        />
      )}

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
          с позициями Смета Зелёный. */}
      {ledgerModalTarget !== null && (
        <MaterialLedgerModal
          open
          hideLedgerPicker
          initialLedgerId={ledgerModalTarget === 'new' ? undefined : ledgerModalTarget}
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
          requestItems={bulkLedgerPickerRequest.items}
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
          attachment={bulkSendConfig.attachment}
          offers={offers}
          emails={supplierEmails}
          templates={emailTemplates}
          legalEntities={legalEntities}
          onClose={() => setBulkSendConfig(null)}
          onOrderCreated={(order) => setSupplierOrders((prev) => [...prev, order])}
          onEmailSent={handleSupplierEmailSent}
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
      />
    </Modal>
  );
}
