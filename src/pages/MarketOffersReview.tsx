import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Play,
  Trash2,
  Undo2,
} from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import {
  fetchMarketOffers,
  updateMarketOffer,
  deleteMarketOffer,
  setMarketOfferRejected,
  flagMarketOffersForDiscussion,
  resolveMarketOfferDiscussion,
  rejectMarketOfferDiscussion,
  fetchDismissedDedupKeys,
  dismissDuplicateGroup,
} from '../lib/marketOffersApi';
import { logActivity } from '../lib/activityLogApi';
import { DistrictBusinessesTab } from '../components/marketOffers/DistrictBusinessesTab';
import { BusinessCentersAdminTab } from '../components/marketOffers/BusinessCentersAdminTab';
import { FINISH_STATUSES, MARKET_PROPERTY_TYPES, areaBucket, dedupKey, netSize, netPricePerSqm } from '../data/marketOffers';
import type { MarketOffer, FinishStatus } from '../data/marketOffers';

// Ручная верификация объявлений с Kufar (и позже Realt): помощница (Светлана)
// сверяет объявление по ссылке и правит поля, если источник отдал их
// неверно. Это ЖИВОЙ источник для таблицы на /minsk/minsk-mir — правки
// здесь видны там сразу, без пересинка (DistrictGuidePage.tsx считает
// медиану прямо из этих же строк).
//
// Верификация — только через карточку редактирования (кнопка
// "Редактировать"): в строке таблицы нет отдельных кликабельных
// переключателей отделки/обработки — это раньше загромождало таблицу и
// путало (см. историю в SEO_PLAN.md), теперь строка только показывает
// статусы (статичные бейджи), а меняются они в модалке. Любое сохранение
// через модалку — это и есть "проверил объявление", поэтому оно всегда
// ставит reviewed=true (см. updateMarketOffer), даже если по факту ничего
// не поменяли (свериться по ссылке и подтвердить "не указано" — тоже
// проверка). Reviewed=true заодно защищает всю строку от перезаписи при
// следующем месячном синке (см. scripts/sync-kufar-market-offers.mjs).
//
// Порядок работы: сначала группы дублей (адрес+площадь+иногда этаж
// совпадают у нескольких объявлений) — их нужно разобрать до одиночных
// объявлений, поэтому секция дублей всегда идёт первой на странице, а
// объявления внутри неё не показываются повторно в общей таблице ниже.
//
// "Начать верификацию" — пошаговый режим поверх того же порядка: по одной
// показывает либо ближайшую нерешённую группу дублей, либо (когда группы
// кончились) ближайшее непроверенное одиночное объявление. Минимум кликов
// (владелец) — как только цель меняется, само открывается: для одиночного
// объявления — и ссылка источника (позиционированное окно, см.
// openAdWindow), и карточка редактирования; для группы дублей — только
// ссылка ПЕРВОГО объявления (сравнение — весь смысл шага, обе ссылки одним
// окном не показать), карточка не открывается — решение там обычно "Это
// разные помещения"/"Обсудить", а не правка полей. Ссылка переиспользует
// одно и то же окно (window.open с именем 'market-offer-check' в
// openAdWindow) — 1 объявление = 1 переход в этом окне, не плодит вкладки.
// После решения группы/сохранения карточки подставляется следующее
// автоматически (см. verifyGroupTarget/verifySingleTarget ниже — оба
// выводятся реактивно из текущих данных, без отдельной очереди с индексом,
// поэтому переживают удаления/отклонения прямо во время прохода).
//
// "Отмена"/крестик карточки — просто закрывает её, БЕЗ побочных эффектов
// (не пропускает цель, не открывает следующую). Раньше "Отмена" ошибочно
// пропускала текущую цель, из-за чего эффект тут же открывал СЛЕДУЮЩЕЕ
// объявление и его ссылку — несколько кликов "Отмена" подряд открывали
// серию внешних страниц Kufar за секунды и словили бан по IP ("слишком
// много запросов", владелец поймал вживую, см. журнал docs/session-journal.md). Гварды
// автооткрытия — по РЕФАМ (id/key объявления), НЕ по editingOffer: иначе
// закрытие карточки без смены цели тут же открывало бы её и окно заново на
// каждый ре-рендер. "Пропустить" в шапке — единственный способ явно
// перейти к следующему без сохранения, откладывает текущее до конца ЭТОЙ
// сессии верификации (skippedGroupKeys/skippedSingleIds — сбрасываются
// каждый раз при новом запуске), не путать с "Это разные помещения"
// (постоянное решение в БД).
//
// "Не подходит" (кнопка в строке) — для объявлений, которые Светлана
// разобрала, но которые не годятся для сводки (не тот сегмент, явный
// мусор и т.п.). НЕ удаляет строку — просто ставит rejected=true (заодно
// reviewed=true). Владелец: "сохраняй его в памяти, чтобы в следующем
// месяце при парсинге он не отображался снова" — удалённая строка была бы
// неотличима от новой при следующем месячном синке (тот же ad_id всё ещё
// есть у источника) и появилась бы в очереди верификации заново; оставленная
// в базе с rejected=true не показывается ни в очереди верификации, ни в
// группах дублей, ни в сводной статистике на /minsk/minsk-mir (см.
// buildMarketPivot/countSmallFinishedOffices в DistrictGuidePage.tsx),
// но остаётся видна на этой странице через фильтр "Не подходит" — на случай,
// если решение нужно будет отменить ("Восстановить").
//
// "Обсудить с Анатолием" — у Светланы в ходе проверки возник вопрос по
// карточке (или сразу по целой группе дублей — тогда комментарий один на
// всю группу). reviewed НЕ выставляется (по сути объявление остаётся
// непроверенным), но карточка прячется из очереди верификации, чтобы
// Светлана могла двигаться дальше — см. вкладку "Обсуждение" ниже, где
// владелец видит список таких карточек с её комментарием, добавляет свой
// и жмёт "Вернуть на доработку" (снимает флаг — карточка снова попадает в
// обычную очередь). Оба комментария видны в карточке редактирования при
// следующей проверке и очищаются, когда Светлана обычным образом
// сохраняет карточку (см. updateMarketOffer) — вопрос закрыт.

const FINISH_FILTER_OPTIONS = ['Все', 'Не указано', 'С отделкой', 'Без отделки'] as const;
type FinishFilter = (typeof FINISH_FILTER_OPTIONS)[number];

const FINISH_FILTER_TO_DB: Record<FinishFilter, FinishStatus | null> = {
  Все: null,
  'Не указано': 'не указано',
  'С отделкой': 'с отделкой',
  'Без отделки': 'без отделки',
};

const DEAL_FILTER_OPTIONS = ['Все', 'Продажа', 'Аренда'] as const;
type DealFilter = (typeof DEAL_FILTER_OPTIONS)[number];

const REVIEW_FILTER_OPTIONS = ['Все', 'Не обработано', 'Проверено', 'Не подходит', 'Обсуждается'] as const;
type ReviewFilter = (typeof REVIEW_FILTER_OPTIONS)[number];

const SOURCE_FILTER_OPTIONS = ['Все', 'Kufar', 'Realt'] as const;
type SourceFilter = (typeof SOURCE_FILTER_OPTIONS)[number];

const FINISH_PILL_LABEL: Record<FinishStatus, string> = {
  'с отделкой': 'С отделкой',
  'без отделки': 'Без отделки',
  'не указано': 'Не указано',
};

function FinishStatusPicker({
  value,
  onChange,
}: {
  value: FinishStatus;
  onChange: (status: FinishStatus) => void;
}) {
  return (
    <div className="flex gap-1">
      {FINISH_STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          onClick={() => onChange(status)}
          className={cn(
            'whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-colors',
            value === status ? 'bg-ink/80 text-white' : 'bg-surface-muted text-ink-muted hover:bg-border',
          )}
        >
          {FINISH_PILL_LABEL[status]}
        </button>
      ))}
    </div>
  );
}

// Статичные бейджи вместо переключателей — статус в строке таблицы только
// для справки, менять его можно только через карточку редактирования
// (см. комментарий вверху файла).
function FinishBadge({ status }: { status: FinishStatus }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'с отделкой' ? 'bg-ink/80 text-white' : 'bg-surface-muted text-ink-muted',
      )}
    >
      {FINISH_PILL_LABEL[status]}
    </span>
  );
}

function ReviewedBadge({
  reviewed,
  rejected,
  flaggedForDiscussion,
}: {
  reviewed: boolean;
  rejected: boolean;
  flaggedForDiscussion: boolean;
}) {
  if (flaggedForDiscussion) {
    return (
      <span className="whitespace-nowrap rounded-full bg-info-bg px-2.5 py-0.5 text-xs font-medium text-info-text">
        На обсуждении
      </span>
    );
  }
  if (rejected) {
    return (
      <span className="whitespace-nowrap rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink-faint">
        Не подходит
      </span>
    );
  }
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        reviewed ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
      )}
    >
      {reviewed ? 'Проверено' : 'Не обработано'}
    </span>
  );
}

interface EditFormState {
  dealType: 'sale' | 'rent';
  propertyType: string;
  size: string;
  pricePerSqm: string;
  finishStatus: FinishStatus;
  floor: string;
  hasTerrace: boolean;
  terraceArea: string;
  address: string;
}

function offerToForm(offer: MarketOffer): EditFormState {
  return {
    dealType: offer.dealType,
    propertyType: offer.propertyType,
    size: String(offer.size),
    pricePerSqm: String(offer.pricePerSqm),
    finishStatus: offer.finishStatus as FinishStatus,
    floor: offer.floor == null ? '' : String(offer.floor),
    hasTerrace: offer.hasTerrace,
    terraceArea: offer.terraceArea == null ? '' : String(offer.terraceArea),
    address: offer.address ?? '',
  };
}

// Открывает объявление источника (Kufar/Realt) в отдельном окне на
// половину экрана, а не просто в новой вкладке — Светлане больше не нужно
// переключаться между вкладками с CRM и с источником: окно вылезает сразу
// нужного размера/позиции. Встроить сам сайт источника в iframe нельзя —
// такие площадки блокируют встраивание через X-Frame-Options/CSP, поэтому
// это отдельное окно, не разбитая на две части страница. Размер и позиция
// считаются от РЕАЛЬНОГО экрана в момент клика (window.screen), а не
// зашиты заранее — подстраивается под любой монитор. Одно и то же имя окна
// ('market-offer-check') — повторный клик по другому объявлению переиспользует
// то же окно (просто переходит на новый адрес), а не плодит новые окна.
function openAdWindow(url: string) {
  const width = Math.round(window.screen.availWidth / 2);
  const height = window.screen.availHeight;
  const left = window.screen.availWidth - width;
  window.open(url, 'market-offer-check', `width=${width},height=${height},left=${left},top=0`);
}

// Отображение площади/цены округляем на выводе, а не в самих данных
// (netSize/netPricePerSqm в data/marketOffers.ts используются ещё и для
// медианы на /minsk/minsk-mir — там точность важна). Площадь — до 0.1 м²
// (иначе вычитание террасы иногда даёт "70.19999999999999" из-за плавающей
// запятой), цена — до целого доллара.
function formatArea(size: number): string {
  return size.toFixed(1);
}

function formatPrice(pricePerSqm: number): string {
  return String(Math.round(pricePerSqm));
}

function discussLabel(offer: MarketOffer): string {
  return `${offer.address ?? 'без адреса'} · ${formatArea(offer.size)} м²`;
}

// Одна строка объявления — переиспользуется и в обычной таблице, и внутри
// карточек групп дублей (там сравнение построено вокруг компактной
// мини-таблицы на каждую группу, чтобы Kufar/Realt-варианты одного
// помещения были видны рядом).
function OfferRow({
  offer,
  pending,
  onEdit,
  onDelete,
  onToggleReject,
  onDiscuss,
  showActions = true,
}: {
  offer: MarketOffer;
  pending: boolean;
  onEdit: (offer: MarketOffer) => void;
  onDelete: (offer: MarketOffer) => void;
  onToggleReject: (offer: MarketOffer) => void;
  onDiscuss: (offer: MarketOffer) => void;
  // false — на вкладке "Обсуждение" (см. MarketOffersReview ниже): там
  // строка только информационная, решения принимаются в блоке
  // комментария под таблицей, а не кнопками в строке.
  showActions?: boolean;
}) {
  return (
    <tr className={pending ? 'opacity-50' : undefined}>
      <td className="max-w-[240px] py-2.5 pr-3">
        {offer.adLink ? (
          <a
            href={offer.adLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              // Обычный клик — открываем позиционированное окно (см.
              // openAdWindow). Ctrl/Cmd/Shift/средняя кнопка — оставляем
              // браузеру штатное поведение (открыть в новой вкладке и т.п.),
              // не мешаем привычным жестам.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              openAdWindow(offer.adLink!);
            }}
            className="flex min-w-0 items-center gap-1 text-ink hover:underline"
          >
            <span className="truncate">{offer.address ?? '—'}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-ink-faint" />
          </a>
        ) : (
          <span className="truncate">{offer.address ?? '—'}</span>
        )}
        <div className="text-xs text-ink-faint">{offer.source}</div>
      </td>
      <td className="max-w-[130px] py-2.5 px-2 text-ink-muted">{offer.propertyType}</td>
      <td className="whitespace-nowrap py-2.5 px-2 text-ink-muted">{offer.dealType === 'sale' ? 'Продажа' : 'Аренда'}</td>
      <td className="max-w-[140px] py-2.5 px-2 text-right tabular-nums text-ink-muted">
        <span className="whitespace-nowrap">
          {formatArea(offer.size)} м² <span className="text-ink-faint">({areaBucket(netSize(offer))})</span>
        </span>
        {offer.hasTerrace && (
          <div className="text-xs text-warning">
            терраса {offer.terraceArea ?? '?'} · чисто {formatArea(netSize(offer))} м²
          </div>
        )}
      </td>
      <td className="whitespace-nowrap py-2.5 px-2 text-right tabular-nums text-ink-muted">{offer.floor ?? '—'}</td>
      <td className="max-w-[150px] py-2.5 px-2 text-right tabular-nums text-ink-muted">
        <span className="whitespace-nowrap">
          {formatPrice(offer.pricePerSqm)} $/м²{offer.dealType === 'rent' ? '/мес' : ''}
        </span>
        {offer.hasTerrace && (
          <div className="text-xs text-warning">на чистую — {formatPrice(netPricePerSqm(offer))} $/м²</div>
        )}
      </td>
      <td className="whitespace-nowrap py-2.5 px-2">
        <FinishBadge status={offer.finishStatus as FinishStatus} />
      </td>
      <td className="whitespace-nowrap py-2.5 px-2">
        <ReviewedBadge reviewed={offer.reviewed} rejected={offer.rejected} flaggedForDiscussion={offer.flaggedForDiscussion} />
      </td>
      <td className="whitespace-nowrap py-2.5 pl-2">
        {showActions && (
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(offer)}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs font-medium text-ink hover:border-border-strong hover:bg-surface-muted"
            >
              <Pencil className="h-3.5 w-3.5" />
              Редактировать
            </button>
            <button
              type="button"
              onClick={() => onDiscuss(offer)}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs font-medium text-ink-muted hover:border-border-strong hover:bg-surface-muted"
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              Обсудить
            </button>
            <button
              type="button"
              onClick={() => onToggleReject(offer)}
              className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs font-medium text-ink-muted hover:border-border-strong hover:bg-surface-muted"
            >
              {offer.rejected ? (
                <>
                  <Undo2 className="h-3.5 w-3.5" />
                  Восстановить
                </>
              ) : (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  Не подходит
                </>
              )}
            </button>
            <button type="button" onClick={() => onDelete(offer)} aria-label="Удалить объявление" className="p-1 text-ink-faint hover:text-danger">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function OfferTableHead() {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
        <th className="py-2 pr-3">Адрес / источник</th>
        <th className="py-2 px-2">Тип</th>
        <th className="py-2 px-2">Сделка</th>
        <th className="py-2 px-2 text-right">Площадь</th>
        <th className="py-2 px-2 text-right">Этаж</th>
        <th className="py-2 px-2 text-right">Цена / м²</th>
        <th className="py-2 px-2">Отделка</th>
        <th className="py-2 px-2">Обработка</th>
        <th className="py-2 pl-2" />
      </tr>
    </thead>
  );
}

const PAGE_TABS = ['Верификация', 'Обсуждение', 'Дома', 'Бизнес-центры'] as const;
type PageTab = (typeof PAGE_TABS)[number];

export function MarketOffersReview() {
  const [tab, setTab] = useState<PageTab>('Верификация');
  const [offers, setOffers] = useState<MarketOffer[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [finishFilter, setFinishFilter] = useState<FinishFilter>('Все');
  const [dealFilter, setDealFilter] = useState<DealFilter>('Все');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('Не обработано');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('Все');
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pendingGroupKey, setPendingGroupKey] = useState<string | null>(null);
  const [editingOffer, setEditingOffer] = useState<MarketOffer | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [verifying, setVerifying] = useState(false);
  const [skippedGroupKeys, setSkippedGroupKeys] = useState<Set<string>>(new Set());
  const [skippedSingleIds, setSkippedSingleIds] = useState<Set<number>>(new Set());
  // "Обсудить с Анатолием" — модалка с комментарием, общая для строки,
  // группы дублей и кнопки внутри карточки редактирования (см. ниже).
  const [discussTarget, setDiscussTarget] = useState<{ ids: number[]; label: string } | null>(null);
  const [discussComment, setDiscussComment] = useState('');
  const [discussSaving, setDiscussSaving] = useState(false);
  // Черновики ответа владельца на вкладке "Обсуждение", по одному на
  // группу/карточку (ключ — тот же, что и в discussingGroups ниже).
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);

  useEffect(() => {
    fetchMarketOffers()
      .then(setOffers)
      .catch(() => setError('Не удалось загрузить объявления.'));
    fetchDismissedDedupKeys()
      .then(setDismissedKeys)
      .catch(() => {}); // не критично — просто снова покажутся уже разобранные группы
  }, []);

  // Возможные дубли — один и тот же объект на разных площадках (или дважды
  // на одной), см. dedupKey в data/marketOffers.ts. Считаем по ВСЕМ
  // объявлениям, не по уже отфильтрованным — иначе включённые фильтры
  // (например, "Продажа") случайно спрятали бы вторую половину пары.
  // Группы, которые ассистент уже посмотрел и подтвердил как два разных
  // помещения (dismissedKeys), из подсчёта убираем — они разобраны.
  const duplicateGroups = useMemo(() => {
    if (!offers) return new Map<string, MarketOffer[]>();
    const groups = new Map<string, MarketOffer[]>();
    for (const offer of offers) {
      if (offer.rejected || offer.flaggedForDiscussion) continue;
      const key = dedupKey(offer);
      if (!key || dismissedKeys.has(key)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(offer);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) groups.delete(key);
    }
    return groups;
  }, [offers, dismissedKeys]);

  const duplicateKeyByOfferId = useMemo(() => {
    const map = new Map<number, string>();
    for (const [key, group] of duplicateGroups) {
      for (const offer of group) map.set(offer.id, key);
    }
    return map;
  }, [duplicateGroups]);

  const counts = useMemo(() => {
    if (!offers) return null;
    return {
      total: offers.length,
      kufar: offers.filter((o) => o.source === 'Kufar').length,
      realt: offers.filter((o) => o.source === 'Realt').length,
      reviewed: offers.filter((o) => o.reviewed && !o.rejected).length,
      rejected: offers.filter((o) => o.rejected).length,
      discussing: offers.filter((o) => o.flaggedForDiscussion).length,
      duplicates: [...duplicateGroups.values()].reduce((sum, g) => sum + g.length, 0),
    };
  }, [offers, duplicateGroups]);

  // Карточки/группы на обсуждении — для вкладки "Обсуждение". Группируем
  // по dedupKey (та же логика, что и у duplicateGroups) — так как
  // "Обсудить с Анатолием" на группе дублей флагует все её карточки одним
  // комментарием, они и тут показываются вместе; одиночные карточки без
  // dedupKey — сами по себе (ключ "single-<id>").
  const discussingGroups = useMemo(() => {
    const flagged = (offers ?? []).filter((o) => o.flaggedForDiscussion);
    const map = new Map<string, MarketOffer[]>();
    for (const offer of flagged) {
      const key = dedupKey(offer) ?? `single-${offer.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(offer);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [offers]);

  // Одиночные объявления — таблица под секцией дублей (см. рендер ниже).
  // Дублей в ней не показываем: они уже разобраны отдельными карточками
  // выше, повтор в общем списке только путал бы, что уже проверено.
  const filtered = useMemo(() => {
    if (!offers) return [];
    const query = search.trim().toLowerCase();
    return offers
      .filter((o) => {
        if (duplicateKeyByOfferId.has(o.id)) return false;
        const wantedFinish = FINISH_FILTER_TO_DB[finishFilter];
        if (wantedFinish && o.finishStatus !== wantedFinish) return false;
        if (dealFilter === 'Продажа' && o.dealType !== 'sale') return false;
        if (dealFilter === 'Аренда' && o.dealType !== 'rent') return false;
        if (reviewFilter === 'Не обработано' && (o.reviewed || o.flaggedForDiscussion)) return false;
        if (reviewFilter === 'Проверено' && (!o.reviewed || o.rejected)) return false;
        if (reviewFilter === 'Не подходит' && !o.rejected) return false;
        if (reviewFilter === 'Обсуждается' && !o.flaggedForDiscussion) return false;
        if (sourceFilter !== 'Все' && o.source !== sourceFilter) return false;
        if (query && !(o.address ?? '').toLowerCase().includes(query) && !o.propertyType.toLowerCase().includes(query)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.size - b.size);
  }, [offers, search, finishFilter, dealFilter, reviewFilter, sourceFilter, duplicateKeyByOfferId]);

  const duplicateGroupsList = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...duplicateGroups.entries()]
      .filter(([, group]) => !query || group.some((o) => (o.address ?? '').toLowerCase().includes(query)))
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [duplicateGroups, search]);

  // Верификация всегда идёт по ВСЕМ группам/объявлениям, игнорируя поиск и
  // остальные фильтры на странице — это отдельный сквозной проход, не
  // привязанный к тому, что сейчас введено в поиске.
  const allGroupsSorted = useMemo(
    () => [...duplicateGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [duplicateGroups],
  );

  const ungroupedUnreviewed = useMemo(
    () =>
      (offers ?? [])
        .filter((o) => !o.reviewed && !o.flaggedForDiscussion && !duplicateKeyByOfferId.has(o.id))
        .sort((a, b) => a.size - b.size),
    [offers, duplicateKeyByOfferId],
  );

  const hasPendingVerification = allGroupsSorted.length > 0 || ungroupedUnreviewed.length > 0;

  // Текущая цель — первая группа/объявление, которые ещё не отложены в этой
  // сессии верификации ("Пропустить"). Оба выводятся заново на каждый
  // рендер, поэтому после удаления строки, отклонения группы или сохранения
  // карточки следующее подставляется само — без ручного управления индексом.
  const verifyGroupTarget = useMemo(() => {
    if (!verifying) return null;
    return allGroupsSorted.find(([key]) => !skippedGroupKeys.has(key)) ?? null;
  }, [verifying, allGroupsSorted, skippedGroupKeys]);

  const verifySingleTarget = useMemo(() => {
    if (!verifying || verifyGroupTarget) return null;
    return ungroupedUnreviewed.find((o) => !skippedSingleIds.has(o.id)) ?? null;
  }, [verifying, verifyGroupTarget, ungroupedUnreviewed, skippedSingleIds]);

  // "Осталось" не уменьшается от "Пропустить" — пропущенное всё ещё не
  // разобрано, просто временно не показывается в этом проходе.
  const verifyRemaining =
    allGroupsSorted.filter(([key]) => !skippedGroupKeys.has(key)).length +
    ungroupedUnreviewed.filter((o) => !skippedSingleIds.has(o.id)).length;

  const verifySkippedCount = skippedGroupKeys.size + skippedSingleIds.size;

  function patchOffer(id: number, patch: Partial<MarketOffer>) {
    setOffers((prev) => (prev ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  async function handleDelete(offer: MarketOffer) {
    setPendingId(offer.id);
    try {
      await deleteMarketOffer(offer.id);
      setOffers((prev) => (prev ?? []).filter((o) => o.id !== offer.id));
    } catch {
      setError('Не удалось удалить объявление — попробуйте ещё раз.');
    } finally {
      setPendingId(null);
    }
  }

  // "Не подходит" — не удаляет строку (см. MarketOffer.rejected):
  // объявление остаётся в базе с тем же ad_id, поэтому следующий месячный
  // синк не заведёт его заново как новое.
  async function handleToggleReject(offer: MarketOffer) {
    const nextRejected = !offer.rejected;
    setPendingId(offer.id);
    try {
      await setMarketOfferRejected(offer.id, nextRejected);
      patchOffer(offer.id, { rejected: nextRejected, reviewed: nextRejected ? true : offer.reviewed });
    } catch {
      setError('Не удалось сохранить решение — попробуйте ещё раз.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleDismissGroup(key: string) {
    setPendingGroupKey(key);
    try {
      await dismissDuplicateGroup(key);
      setDismissedKeys((prev) => new Set(prev).add(key));
    } catch {
      setError('Не удалось сохранить — попробуйте ещё раз.');
    } finally {
      setPendingGroupKey(null);
    }
  }

  function openEdit(offer: MarketOffer) {
    setEditingOffer(offer);
    setEditForm(offerToForm(offer));
  }

  function openDiscussModal(ids: number[], label: string) {
    setDiscussComment('');
    setDiscussTarget({ ids, label });
  }

  // Кнопка "Обсудить" внутри карточки редактирования — закрываем карточку
  // сразу (см. комментарий в top-of-file про то, что объявление уходит из
  // очереди), а не держим обе модалки открытыми одновременно.
  function openDiscussFromEdit(offer: MarketOffer) {
    setEditingOffer(null);
    setEditForm(null);
    openDiscussModal([offer.id], `${offer.address ?? 'без адреса'} · ${formatArea(offer.size)} м²`);
  }

  async function submitDiscuss() {
    if (!discussTarget || !discussComment.trim() || discussSaving) return;
    const note = discussComment.trim();
    setDiscussSaving(true);
    try {
      await flagMarketOffersForDiscussion(discussTarget.ids, note);
      setOffers((prev) =>
        (prev ?? []).map((o) =>
          discussTarget.ids.includes(o.id)
            ? { ...o, flaggedForDiscussion: true, discussionNote: note, ownerNote: null }
            : o,
        ),
      );
      logActivity('market_offer_flagged_for_discussion');
      setDiscussTarget(null);
      setDiscussComment('');
    } catch {
      setError('Не удалось отправить на обсуждение — попробуйте ещё раз.');
    } finally {
      setDiscussSaving(false);
    }
  }

  async function handleResolveDiscussion(key: string, ids: number[]) {
    const note = (replyDrafts[key] ?? '').trim();
    if (!note || resolvingKey) return;
    setResolvingKey(key);
    try {
      await resolveMarketOfferDiscussion(ids, note);
      setOffers((prev) =>
        (prev ?? []).map((o) => (ids.includes(o.id) ? { ...o, flaggedForDiscussion: false, ownerNote: note } : o)),
      );
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      logActivity('market_offer_discussion_resolved');
    } catch {
      setError('Не удалось сохранить ответ — попробуйте ещё раз.');
    } finally {
      setResolvingKey(null);
    }
  }

  // "Не подходит" прямо из карточки обсуждения (владелец, 2026-08-27) —
  // комментарий необязателен, в отличие от "Вернуть на доработку": если
  // сразу понятно, что объявление не годится, не нужно ничего писать.
  async function handleRejectDiscussion(key: string, ids: number[]) {
    if (rejectingKey) return;
    const note = (replyDrafts[key] ?? '').trim() || null;
    setRejectingKey(key);
    try {
      await rejectMarketOfferDiscussion(ids, note);
      setOffers((prev) =>
        (prev ?? []).map((o) =>
          ids.includes(o.id) ? { ...o, rejected: true, reviewed: true, flaggedForDiscussion: false, ownerNote: note } : o,
        ),
      );
      setReplyDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      logActivity('market_offer_rejected_from_discussion');
    } catch {
      setError('Не удалось отклонить — попробуйте ещё раз.');
    } finally {
      setRejectingKey(null);
    }
  }

  function startVerification() {
    setSkippedGroupKeys(new Set());
    setSkippedSingleIds(new Set());
    // Сбрасываем "уже открывали" — иначе если первая цель НОВОЙ сессии
    // верификации совпадает с той, на которой закончилась предыдущая (тот
    // же id/key всё ещё не разобран), эффект ниже решит, что уже открывал
    // её, и не откроет автоматически.
    lastAutoOpenedGroupKeyRef.current = null;
    lastAutoOpenedSingleIdRef.current = null;
    setVerifying(true);
  }

  function stopVerification() {
    setVerifying(false);
    setEditingOffer(null);
    setEditForm(null);
  }

  function skipCurrentVerification() {
    if (verifyGroupTarget) {
      setSkippedGroupKeys((prev) => new Set(prev).add(verifyGroupTarget[0]));
    } else if (verifySingleTarget) {
      setSkippedSingleIds((prev) => new Set(prev).add(verifySingleTarget.id));
    }
  }

  function closeEdit() {
    // Просто закрыть — без побочных эффектов. Раньше здесь ещё и пропускала
    // текущую цель верификации, из-за чего "Отмена" на самом деле означала
    // "перейти к следующему объявлению и открыть ЕГО ссылку на Kufar" — при
    // нескольких кликах подряд это открывало серию внешних страниц Kufar за
    // секунды и словило бан по IP ("слишком много запросов", см. журнал
    // docs/session-journal.md). "Отмена"/крестик теперь только закрывают карточку — цель
    // верификации не меняется, эффект ниже её не переоткроет (гвард по
    // id, не по editingOffer), а перейти к следующей Светлана может сама
    // через "Пропустить" в шапке, когда действительно готова.
    setEditingOffer(null);
    setEditForm(null);
  }

  // Минимум кликов во время верификации — как только цель меняется, сами
  // открываем ссылку источника (позиционированное окно, см. openAdWindow) и,
  // для одиночных объявлений, карточку редактирования. Для группы дублей —
  // только ссылка ПЕРВОГО объявления (сравнение — весь смысл шага, открыть
  // сразу обе ссылки одним окном нельзя), карточка не открывается — решение
  // там обычно "Это разные помещения"/"Обсудить", а не правка полей. Ссылка
  // переиспользует одно и то же окно (window.open с именем
  // 'market-offer-check' в openAdWindow) — 1 объявление = 1 открытие/
  // переход в этом окне, не плодит вкладки.
  //
  // Гварды — по РЕФАМ (id/key), НЕ по editingOffer — иначе закрытие
  // карточки без смены цели (Отмена/крестик) тут же открывало бы её и окно
  // заново на каждый ре-рендер: реальный баг, который поймал владелец
  // ("нажимаю Отмена, а вместо закрытия открываются новые страницы") —
  // несколько кликов подряд открывали серию страниц Kufar за секунды и
  // словили бан по IP ("слишком много запросов", см. журнал docs/session-journal.md).
  // closeEdit ниже НЕ меняет цель верификации (не пропускает, не двигает
  // дальше) — именно это и остановило переоткрытие, а не отказ от самой
  // автоматики (владелец подтвердил: "если 1 запрос — 1 открытие, то всё
  // норм, не убирай").
  const lastAutoOpenedGroupKeyRef = useRef<string | null>(null);
  const lastAutoOpenedSingleIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!verifying) return;
    if (verifyGroupTarget) {
      const [key, group] = verifyGroupTarget;
      if (lastAutoOpenedGroupKeyRef.current === key) return;
      lastAutoOpenedGroupKeyRef.current = key;
      if (group[0]?.adLink) openAdWindow(group[0].adLink);
      return;
    }
    if (verifySingleTarget && lastAutoOpenedSingleIdRef.current !== verifySingleTarget.id) {
      lastAutoOpenedSingleIdRef.current = verifySingleTarget.id;
      openEdit(verifySingleTarget);
      if (verifySingleTarget.adLink) openAdWindow(verifySingleTarget.adLink);
    }
  }, [verifying, verifyGroupTarget, verifySingleTarget]);

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingOffer || !editForm) return;
    const size = Number(editForm.size.replace(',', '.'));
    const pricePerSqm = Number(editForm.pricePerSqm.replace(',', '.'));
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(pricePerSqm) || pricePerSqm <= 0) {
      setError('Площадь и цена должны быть положительными числами.');
      return;
    }
    const floorTrimmed = editForm.floor.trim();
    const floor = floorTrimmed === '' ? null : Number(floorTrimmed);
    if (floor != null && !Number.isFinite(floor)) {
      setError('Этаж должен быть числом (или оставьте поле пустым).');
      return;
    }
    let terraceArea: number | null = null;
    if (editForm.hasTerrace) {
      terraceArea = Number(editForm.terraceArea.replace(',', '.'));
      if (!Number.isFinite(terraceArea) || terraceArea <= 0 || terraceArea >= size) {
        setError('Площадь террасы должна быть положительным числом меньше общей площади.');
        return;
      }
    }
    setSaving(true);
    try {
      const patch = {
        dealType: editForm.dealType,
        propertyType: editForm.propertyType,
        size,
        pricePerSqm,
        finishStatus: editForm.finishStatus,
        floor,
        hasTerrace: editForm.hasTerrace,
        terraceArea,
        address: editForm.address,
      };
      await updateMarketOffer(editingOffer.id, patch);
      patchOffer(editingOffer.id, {
        ...patch,
        address: editForm.address || null,
        reviewed: true,
        flaggedForDiscussion: false,
        discussionNote: null,
        ownerNote: null,
      });
      logActivity('market_offer_verified');
      setEditingOffer(null);
      setEditForm(null);
    } catch {
      setError('Не удалось сохранить изменения — попробуйте ещё раз.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Аналитика рынка" />

      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup options={[...PAGE_TABS]} value={tab} onChange={(v) => setTab(v as PageTab)} />
        {discussingGroups.length > 0 && (
          <span className="whitespace-nowrap rounded-full bg-info-bg px-3 py-1.5 text-xs font-semibold text-info-text">
            {discussingGroups.length} на обсуждении
          </span>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {offers === null && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      )}

      {offers !== null && tab === 'Верификация' && (
        <div className="flex flex-col gap-4">
          {counts && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-muted">
                Всего {counts.total} объявлений (Kufar {counts.kufar} · Realt {counts.realt}) · обработано{' '}
                {counts.reviewed} из {counts.total}
                {counts.rejected > 0 && <> · не подходит {counts.rejected}</>}
                {counts.discussing > 0 && <> · на обсуждении {counts.discussing}</>}
                {counts.duplicates > 0 && (
                  <>
                    {' '}
                    ·{' '}
                    <span className="font-semibold text-warning">возможных дублей — {counts.duplicates}</span>
                  </>
                )}
              </p>
              {!verifying && (
                <Button icon={<Play className="h-4 w-4" />} disabled={!hasPendingVerification} onClick={startVerification}>
                  Начать верификацию
                </Button>
              )}
            </div>
          )}

          {verifying ? (
            <div className="flex flex-col gap-3">
              <div className={cn('flex flex-wrap items-center justify-between gap-3 p-4', glassCardClass)} style={glassCardShadow}>
                <p className="text-sm font-semibold text-ink">Верификация — осталось {verifyRemaining}</p>
                <div className="flex gap-2">
                  {(verifyGroupTarget || verifySingleTarget) && (
                    <Button variant="secondary" onClick={skipCurrentVerification}>
                      Пропустить
                    </Button>
                  )}
                  <Button variant="ghost" onClick={stopVerification}>
                    Завершить проверку
                  </Button>
                </div>
              </div>

              {verifyGroupTarget ? (
                <div className={cn('flex flex-col gap-3 p-4', glassCardClass)} style={glassCardShadow}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink-muted">
                      <span className="font-semibold text-ink">{verifyGroupTarget[1][0].address ?? 'без адреса'}</span> ·{' '}
                      {formatArea(verifyGroupTarget[1][0].size)} м² · этаж {verifyGroupTarget[1][0].floor ?? '?'} ·{' '}
                      {verifyGroupTarget[1].length} объявления похожи друг на друга
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        icon={<MessageCircleQuestion className="h-4 w-4" />}
                        onClick={() =>
                          openDiscussModal(
                            verifyGroupTarget[1].map((o) => o.id),
                            discussLabel(verifyGroupTarget[1][0]),
                          )
                        }
                      >
                        Обсудить с Анатолием
                      </Button>
                      <Button
                        variant="secondary"
                        icon={<Check className="h-4 w-4" />}
                        disabled={pendingGroupKey === verifyGroupTarget[0]}
                        onClick={() => handleDismissGroup(verifyGroupTarget[0])}
                      >
                        Это разные помещения
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      <OfferTableHead />
                      <tbody className="divide-y divide-border">
                        {verifyGroupTarget[1].map((offer) => (
                          <OfferRow
                            key={offer.id}
                            offer={offer}
                            pending={pendingId === offer.id}
                            onEdit={openEdit}
                            onDelete={handleDelete}
                            onToggleReject={handleToggleReject}
                            onDiscuss={(o) => openDiscussModal([o.id], discussLabel(o))}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : verifySingleTarget ? (
                <p className="py-10 text-center text-sm text-ink-faint">
                  Ссылка на источник и карточка редактирования открылись сами — заполните и сохраните, следующее
                  объявление откроется точно так же.
                </p>
              ) : (
                <div className={cn('flex flex-col items-center gap-2 p-8 text-center', glassCardClass)} style={glassCardShadow}>
                  <CheckCircle2 className="h-8 w-8 text-success" />
                  <p className="text-sm font-semibold text-ink">Всё проверено!</p>
                  {verifySkippedCount > 0 && (
                    <p className="text-xs text-ink-faint">
                      Пропущено {verifySkippedCount} — найдёте их в обычном списке ниже.
                    </p>
                  )}
                  <Button className="mt-2" onClick={stopVerification}>
                    Вернуться к списку
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className={cn('flex flex-col gap-2 p-4', glassCardClass)} style={glassCardShadow}>
                <SearchInput
                  placeholder="Поиск по адресу или типу…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="sm:max-w-xs"
                />
                <p className="text-xs text-ink-faint">
                  Правки сразу учитываются в таблице на /minsk/minsk-mir и не перезатираются автоматическим синком.
                </p>
              </div>

              {duplicateGroups.size > 0 && (
                <div className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold text-ink">
                    Дубли для проверки — {duplicateGroups.size} {duplicateGroups.size === 1 ? 'группа' : 'группы'}
                  </h2>
                  <p className="text-xs text-ink-faint">
                    Похожие объявления сгруппированы по адресу и площади (и этажу, если он известен) — откройте
                    ссылку, сверьте вручную и либо удалите лишнюю копию, либо подтвердите, что это разные помещения.
                    Разберите дубли, прежде чем переходить к одиночным объявлениям ниже. Фильтры ниже сюда не
                    относятся — группа показывается целиком, чтобы не спрятать половину пары.
                  </p>
                  {duplicateGroupsList.map(([key, group]) => (
                    <div key={key} className={cn('flex flex-col gap-3 p-4', glassCardClass)} style={glassCardShadow}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-ink-muted">
                          <span className="font-semibold text-ink">{group[0].address ?? 'без адреса'}</span> ·{' '}
                          {formatArea(group[0].size)} м² · этаж {group[0].floor ?? '?'} · {group.length} объявления похожи друг
                          на друга
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            icon={<MessageCircleQuestion className="h-4 w-4" />}
                            onClick={() => openDiscussModal(group.map((o) => o.id), discussLabel(group[0]))}
                          >
                            Обсудить с Анатолием
                          </Button>
                          <Button
                            variant="secondary"
                            icon={<Check className="h-4 w-4" />}
                            disabled={pendingGroupKey === key}
                            onClick={() => handleDismissGroup(key)}
                          >
                            Это разные помещения
                          </Button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] border-collapse text-sm">
                          <OfferTableHead />
                          <tbody className="divide-y divide-border">
                            {group.map((offer) => (
                              <OfferRow
                                key={offer.id}
                                offer={offer}
                                pending={pendingId === offer.id}
                                onEdit={openEdit}
                                onDelete={handleDelete}
                                onToggleReject={handleToggleReject}
                                onDiscuss={(o) => openDiscussModal([o.id], discussLabel(o))}
                              />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                  {duplicateGroupsList.length === 0 && (
                    <p className="py-4 text-center text-sm text-ink-faint">Дублей по этому запросу не найдено.</p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-3">
                {duplicateGroups.size > 0 && <h2 className="text-sm font-semibold text-ink">Одиночные объявления</h2>}
                <div className={cn('flex flex-wrap gap-3 p-4', glassCardClass)} style={glassCardShadow}>
                  <ToggleGroup
                    label="Обработка"
                    options={[...REVIEW_FILTER_OPTIONS]}
                    value={reviewFilter}
                    onChange={(v) => setReviewFilter(v as ReviewFilter)}
                  />
                  <ToggleGroup
                    label="Источник"
                    options={[...SOURCE_FILTER_OPTIONS]}
                    value={sourceFilter}
                    onChange={(v) => setSourceFilter(v as SourceFilter)}
                  />
                  <ToggleGroup
                    label="Сделка"
                    options={[...DEAL_FILTER_OPTIONS]}
                    value={dealFilter}
                    onChange={(v) => setDealFilter(v as DealFilter)}
                  />
                  <ToggleGroup
                    label="Отделка"
                    options={[...FINISH_FILTER_OPTIONS]}
                    value={finishFilter}
                    onChange={(v) => setFinishFilter(v as FinishFilter)}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-sm">
                    <OfferTableHead />
                    <tbody className="divide-y divide-border">
                      {filtered.map((offer) => (
                        <OfferRow
                          key={offer.id}
                          offer={offer}
                          pending={pendingId === offer.id}
                          onEdit={openEdit}
                          onDelete={handleDelete}
                          onToggleReject={handleToggleReject}
                          onDiscuss={(o) => openDiscussModal([o.id], discussLabel(o))}
                        />
                      ))}
                    </tbody>
                  </table>
                  {filtered.length === 0 && (
                    <p className="py-6 text-center text-sm text-ink-faint">Ничего не найдено.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {offers !== null && tab === 'Обсуждение' && (
        <div className="flex flex-col gap-4">
          <p className="text-xs text-ink-faint">
            Карточки, которые Светлана отметила "Обсудить с Анатолием" во время проверки — они остались
            непроверенными и не показываются ей в очереди, пока вы не вернёте их с ответом.
          </p>
          {discussingGroups.length === 0 ? (
            <div className={cn('py-10 text-center text-sm text-ink-muted', glassCardClass)} style={glassCardShadow}>
              Сейчас ничего не ждёт обсуждения.
            </div>
          ) : (
            discussingGroups.map(([key, group]) => {
              const ids = group.map((o) => o.id);
              const draft = replyDrafts[key] ?? '';
              return (
                <div key={key} className={cn('flex flex-col gap-3 p-4', glassCardClass)} style={glassCardShadow}>
                  <p className="text-sm text-ink-muted">
                    <span className="font-semibold text-ink">{group[0].address ?? 'без адреса'}</span> ·{' '}
                    {formatArea(group[0].size)} м²
                    {group.length > 1 && <> · {group.length} объявления в группе</>}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] border-collapse text-sm">
                      <OfferTableHead />
                      <tbody className="divide-y divide-border">
                        {group.map((offer) => (
                          <OfferRow
                            key={offer.id}
                            offer={offer}
                            pending={false}
                            onEdit={openEdit}
                            onDelete={handleDelete}
                            onToggleReject={handleToggleReject}
                            onDiscuss={() => {}}
                            showActions={false}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col gap-1.5 rounded-control bg-info-bg/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-info-text">Вопрос Светланы</p>
                    <p className="whitespace-pre-wrap text-sm text-ink">{group[0].discussionNote}</p>
                  </div>
                  <Textarea
                    label="Ваш комментарий"
                    placeholder="Что решили, что нужно уточнить у Светланы..."
                    rows={2}
                    value={draft}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="secondary"
                      disabled={rejectingKey === key || resolvingKey === key}
                      onClick={() => handleRejectDiscussion(key, ids)}
                    >
                      {rejectingKey === key ? 'Отклоняем…' : 'Не подходит'}
                    </Button>
                    <Button
                      disabled={!draft.trim() || resolvingKey === key || rejectingKey === key}
                      onClick={() => handleResolveDiscussion(key, ids)}
                    >
                      {resolvingKey === key ? 'Сохраняем…' : 'Вернуть на доработку'}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === 'Дома' && <DistrictBusinessesTab />}
      {tab === 'Бизнес-центры' && <BusinessCentersAdminTab />}

      <Modal
        open={!!discussTarget}
        onClose={() => (discussSaving ? undefined : setDiscussTarget(null))}
        title="Обсудить с Анатолием"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">{discussTarget?.label}</p>
          <Textarea
            label="Что нужно обсудить?"
            placeholder="Опишите, что вызывает вопрос..."
            rows={4}
            value={discussComment}
            onChange={(e) => setDiscussComment(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setDiscussTarget(null)} disabled={discussSaving}>
              Отмена
            </Button>
            <Button type="button" disabled={!discussComment.trim() || discussSaving} onClick={submitDiscuss}>
              {discussSaving ? 'Отправляем…' : 'Отправить'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editingOffer} onClose={closeEdit} title="Редактировать объявление">
        {editForm && (
          <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
            {editingOffer?.adLink && (
              <a
                href={editingOffer.adLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  // Открытие внешней страницы — только по явному клику
                  // (не автоматически) — см. комментарий у эффекта
                  // автооткрытия карточки ниже про бан по IP от Kufar.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  openAdWindow(editingOffer.adLink!);
                }}
                className="flex w-fit items-center gap-1 text-sm text-ink hover:underline"
              >
                Открыть объявление на {editingOffer.source}
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              </a>
            )}
            {(editingOffer?.discussionNote || editingOffer?.ownerNote) && (
              <div className="flex flex-col gap-2 rounded-control bg-info-bg/60 p-3">
                {editingOffer.discussionNote && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-info-text">Вопрос Светланы</p>
                    <p className="whitespace-pre-wrap text-sm text-ink">{editingOffer.discussionNote}</p>
                  </div>
                )}
                {editingOffer.ownerNote && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-info-text">Ответ Анатолия</p>
                    <p className="whitespace-pre-wrap text-sm text-ink">{editingOffer.ownerNote}</p>
                  </div>
                )}
              </div>
            )}
            <Select
              label="Тип помещения"
              options={MARKET_PROPERTY_TYPES}
              value={editForm.propertyType}
              onChange={(v) => setEditForm((f) => f && { ...f, propertyType: v })}
            />
            <div>
              <span className="mb-1.5 block text-sm text-ink-muted">Сделка</span>
              <ToggleGroup
                options={['Продажа', 'Аренда']}
                value={editForm.dealType === 'sale' ? 'Продажа' : 'Аренда'}
                onChange={(v) => setEditForm((f) => f && { ...f, dealType: v === 'Продажа' ? 'sale' : 'rent' })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Площадь, м²"
                type="text"
                inputMode="decimal"
                value={editForm.size}
                onChange={(e) => setEditForm((f) => f && { ...f, size: e.target.value })}
              />
              <Input
                label={`Цена за м²${editForm.dealType === 'rent' ? '/мес' : ''}, $`}
                type="text"
                inputMode="decimal"
                value={editForm.pricePerSqm}
                onChange={(e) => setEditForm((f) => f && { ...f, pricePerSqm: e.target.value })}
              />
            </div>
            <Input
              label="Этаж (не обязательно)"
              type="text"
              inputMode="numeric"
              value={editForm.floor}
              onChange={(e) => setEditForm((f) => f && { ...f, floor: e.target.value })}
            />
            <div className="flex flex-col gap-3 rounded-control bg-surface-muted p-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={editForm.hasTerrace}
                  onChange={(e) => setEditForm((f) => f && { ...f, hasTerrace: e.target.checked })}
                  className="h-4 w-4 rounded border-border"
                />
                Помещение с террасой
              </label>
              {editForm.hasTerrace && (
                <>
                  <p className="text-xs text-ink-faint">
                    Терраса стоит дешевле закрытого помещения и занижает цену за м² в сводке — считаем цену на
                    чистую площадь.
                  </p>
                  <Input
                    label="Терраса, м²"
                    type="text"
                    inputMode="decimal"
                    value={editForm.terraceArea}
                    onChange={(e) => setEditForm((f) => f && { ...f, terraceArea: e.target.value })}
                  />
                  <p className="text-sm text-ink-muted">
                    Чистая площадь:{' '}
                    <span className="font-semibold text-ink">
                      {(() => {
                        const total = Number(editForm.size.replace(',', '.'));
                        const terrace = Number(editForm.terraceArea.replace(',', '.'));
                        if (!Number.isFinite(total) || !Number.isFinite(terrace) || terrace <= 0) return '—';
                        const net = total - terrace;
                        return net > 0 ? `${formatArea(net)} м²` : '—';
                      })()}
                    </span>
                  </p>
                </>
              )}
            </div>
            <div>
              <span className="mb-1.5 block text-sm text-ink-muted">Отделка</span>
              <FinishStatusPicker
                value={editForm.finishStatus}
                onChange={(status) => setEditForm((f) => f && { ...f, finishStatus: status })}
              />
            </div>
            <Input
              label="Адрес"
              value={editForm.address}
              onChange={(e) => setEditForm((f) => f && { ...f, address: e.target.value })}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {verifying && (
                  <button type="button" onClick={stopVerification} className="text-xs text-ink-faint underline hover:text-ink">
                    Завершить проверку
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => editingOffer && openDiscussFromEdit(editingOffer)}
                  className="flex items-center gap-1 text-xs text-ink-faint underline hover:text-ink"
                >
                  <MessageCircleQuestion className="h-3.5 w-3.5" />
                  Обсудить с Анатолием
                </button>
              </div>
              <div className="flex flex-1 justify-end gap-3">
                <Button type="button" variant="secondary" onClick={closeEdit}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
