import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { MarketOffer, MarketOfferRow, FinishStatus } from '../data/marketOffers';

function fromRow(row: MarketOfferRow): MarketOffer {
  return {
    id: row.id,
    source: row.source,
    adId: row.ad_id,
    dealType: row.deal_type as MarketOffer['dealType'],
    propertyType: row.property_type,
    size: row.size,
    pricePerSqm: row.price_per_sqm,
    finishStatus: row.finish_status,
    reviewed: row.reviewed,
    rejected: row.rejected,
    flaggedForDiscussion: row.flagged_for_discussion,
    discussionNote: row.discussion_note,
    ownerNote: row.owner_note,
    floor: row.floor,
    hasTerrace: row.has_terrace,
    terraceArea: row.terrace_area,
    address: row.address,
    adLink: row.ad_link,
    updatedAt: row.updated_at,
  };
}

export function fetchMarketOffers(): Promise<MarketOffer[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('market_offers').select('*').order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as MarketOfferRow[]).map(fromRow);
  });
}

// PAGESPEED_PLAN.md, Э5-1 — публичная страница (DistrictGuidePage.tsx) не
// может читать market_offers напрямую: с P0.2 аудита безопасности
// (2026-08-28) anon имел только колоночный GRANT, а `select=*` при
// column-level privileges Postgres проваливает ВСЕМ запросом (не тихо
// прячет непозволенные колонки) — 42501 на каждый заход, страница месяцами
// показывала «Данные пока не собраны». 2026-09-06: колоночный грант на
// anon снят совсем, вместо него — вью `public_market_offers`
// (владелец/postgres-миграция через Management API), которая уже
// фильтрует reviewed=true AND rejected=false и отдаёт только безопасные
// для публики колонки — тот же контракт, что PublicMarketOffer ниже.
// Внутренние поля (owner_note/discussion_note/flagged_for_discussion/
// адрес/ссылка/source/ad_id) в неё не входят — на публичной странице они
// и не использовались, буквально ничего не потеряно.
export interface PublicMarketOfferRow {
  id: number;
  deal_type: string;
  property_type: string;
  size: number;
  price_per_sqm: number;
  finish_status: string;
  has_terrace: boolean;
  terrace_area: number | null;
  updated_at: string;
}

// Форма MarketOffer (не PublicMarketOfferRow) — buildMarketPivot/
// countSmallFinishedOffices/formatLatestUpdate в DistrictGuidePage.tsx
// написаны против полного типа и сами проверяют reviewed/rejected; вью
// уже гарантирует reviewed=true/rejected=false для каждой строки, поэтому
// эти два поля здесь константы, а не выдумка — они отражают реальный
// WHERE вью. Остальные внутренние поля (заметки/адрес/ссылка/источник),
// которых у вью нет, странице не нужны — не подставляем фиктивные значения
// туда, где их использование было бы ошибкой, просто честные пустые/нулевые.
function fromPublicRow(row: PublicMarketOfferRow): MarketOffer {
  return {
    id: row.id,
    source: '',
    adId: '',
    dealType: row.deal_type as MarketOffer['dealType'],
    propertyType: row.property_type,
    size: row.size,
    pricePerSqm: row.price_per_sqm,
    finishStatus: row.finish_status,
    reviewed: true,
    rejected: false,
    flaggedForDiscussion: false,
    discussionNote: null,
    ownerNote: null,
    floor: null,
    hasTerrace: row.has_terrace,
    terraceArea: row.terrace_area,
    address: null,
    adLink: null,
    updatedAt: row.updated_at,
  };
}

export function fetchPublicMarketOffers(): Promise<MarketOffer[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('public_market_offers')
      .select('id, deal_type, property_type, size, price_per_sqm, finish_status, has_terrace, terrace_area, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as PublicMarketOfferRow[]).map(fromPublicRow);
  });
}

// Узкая выборка только для фонового опроса "не появилась ли новая карточка
// на обсуждение" (см. lib/marketOfferDiscussionWatcher.ts) — не весь
// market_offers (сотни-тысячи строк), только id/адрес уже отфлагованных.
export function fetchFlaggedForDiscussionOffers(): Promise<{ id: number; address: string | null }[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('market_offers').select('id, address').eq('flagged_for_discussion', true);
    if (error) throw error;
    return data as { id: number; address: string | null }[];
  });
}

// Быстрая простановка статуса отделки прямо из таблицы — считается
// обработкой строки (reviewed=true), чтобы следующий месячный синк её не
// перезаписал (см. scripts/sync-kufar-market-offers.mjs).
export function setMarketOfferFinishStatus(id: number, finishStatus: FinishStatus): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('market_offers').update({ finish_status: finishStatus, reviewed: true }).eq('id', id);
    if (error) throw error;
  });
}

// Независимый тумблер "Не обработано"/"Проверено" — владелец может
// отметить строку разобранной, даже не меняя в ней ничего (например,
// свериться по ссылке и убедиться, что "не указано" — это и есть правда).
export function setMarketOfferReviewed(id: number, reviewed: boolean): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('market_offers').update({ reviewed }).eq('id', id);
    if (error) throw error;
  });
}

// "Не подходит" / "Восстановить" — см. MarketOffer.rejected в
// data/marketOffers.ts. Отклонение всегда заодно ставит reviewed=true
// (это тоже обработка строки); восстановление reviewed не трогает —
// строка уже была разобрана, просто решение поменялось.
export function setMarketOfferRejected(id: number, rejected: boolean): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('market_offers')
      .update(rejected ? { rejected, reviewed: true } : { rejected })
      .eq('id', id);
    if (error) throw error;
  });
}

export interface MarketOfferEditPatch {
  dealType: 'sale' | 'rent';
  propertyType: string;
  size: number;
  pricePerSqm: number;
  finishStatus: string;
  floor: number | null;
  hasTerrace: boolean;
  terraceArea: number | null;
  address: string;
}

// Полное редактирование строки (цена/тип/площадь/сделка/отделка/этаж/
// терраса/адрес) — тоже считается обработкой. Заодно закрывает обсуждение
// (см. MarketOffer.flaggedForDiscussion) — обычное сохранение и есть
// финальная обработка вопроса, комментарии Светланы/владельца своё
// отслужили и очищаются.
export function updateMarketOffer(id: number, patch: MarketOfferEditPatch): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('market_offers')
      .update({
        deal_type: patch.dealType,
        property_type: patch.propertyType,
        size: patch.size,
        price_per_sqm: patch.pricePerSqm,
        finish_status: patch.finishStatus,
        floor: patch.floor,
        has_terrace: patch.hasTerrace,
        terrace_area: patch.hasTerrace ? patch.terraceArea : null,
        address: patch.address || null,
        reviewed: true,
        flagged_for_discussion: false,
        discussion_note: null,
        owner_note: null,
      })
      .eq('id', id);
    if (error) throw error;
  });
}

// "Обсудить с Анатолием" — Светлана флагует одну карточку или сразу целую
// группу дублей (ids.length > 1, один и тот же комментарий на все).
// reviewed НЕ трогаем: объявление по сути так и остаётся непроверенным,
// просто временно скрыто из очереди — см. комментарий у
// MarketOffer.flaggedForDiscussion. ownerNote на всякий случай обнуляем —
// это начало нового раунда обсуждения, старый ответ владельца (если
// вопрос уже поднимали раньше и он был закрыт обычным сохранением) тут
// быть не должен, но на случай гонки данных явно перезаписываем.
export function flagMarketOffersForDiscussion(ids: number[], note: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('market_offers')
      .update({ flagged_for_discussion: true, discussion_note: note, owner_note: null })
      .in('id', ids);
    if (error) throw error;
  });
}

// "Вернуть на доработку" — снимает флаг обсуждения (карточка(и) снова
// попадают в обычную очередь Светланы), сохраняет ответ владельца рядом с
// исходным вопросом — Светлана увидит оба текста при следующей проверке
// (см. рендер в MarketOffersReview.tsx).
export function resolveMarketOfferDiscussion(ids: number[], ownerNote: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('market_offers')
      .update({ flagged_for_discussion: false, owner_note: ownerNote })
      .in('id', ids);
    if (error) throw error;
  });
}

// "Не подходит" прямо из карточки обсуждения (владелец, 2026-08-27: чтобы
// не гонять туда-обратно на "Вернуть на доработку", если объявление сразу
// понятно, что не годится) — в отличие от resolveMarketOfferDiscussion
// закрывает вопрос отклонением объявления(й) целиком, а не просто снятием
// флага. Комментарий необязателен — тот же принцип, что и у обычного
// "Не подходит" в таблице (setMarketOfferRejected), просто групповая версия
// (карточка обсуждения может быть целой группой дублей) и заодно снимает
// flagged_for_discussion.
export function rejectMarketOfferDiscussion(ids: number[], ownerNote: string | null): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase
      .from('market_offers')
      .update({ rejected: true, reviewed: true, flagged_for_discussion: false, owner_note: ownerNote })
      .in('id', ids);
    if (error) throw error;
  });
}

export function deleteMarketOffer(id: number): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('market_offers').delete().eq('id', id);
    if (error) throw error;
  });
}

// Группы дублей, которые ассистент уже посмотрел вручную и подтвердил —
// это реально два разных помещения, не повтор. Ключ — тот же dedupKey
// (data/marketOffers.ts), что группирует карточки на /admin/market-offers;
// раз отклонённая группа больше не считается дублем и не подсвечивается.
export function fetchDismissedDedupKeys(): Promise<Set<string>> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('market_offer_dedup_dismissals').select('key');
    if (error) throw error;
    return new Set((data ?? []).map((row) => row.key as string));
  });
}

export function dismissDuplicateGroup(key: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('market_offer_dedup_dismissals').upsert({ key }, { onConflict: 'key' });
    if (error) throw error;
  });
}
