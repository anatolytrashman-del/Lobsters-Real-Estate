import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { PrimaryMarketOffer, PrimaryMarketOfferRow } from '../data/primaryMarketOffers';

// PAGESPEED_PLAN.md, Э5-4 — buildPrimaryMarketPivot() (сводная таблица) и
// PrimaryMarketProModal фактически используют только эти 6 полей из 13
// (не house/floor/unitNumber/complex/adLink/source/externalId/scrapedAt) —
// узкий select не только режет трафик (~6 158 строк × 13 полей → 6), но и
// снимает часть нагрузки с pgrst на каждый заход страницы. sold_at добавлен
// 2026-09-10 — нужен и для сводки "что сейчас на рынке" (buildPrimaryMarketPivot
// теперь сам исключает проданное), и для новой сводки "продажи застройщика"
// (buildPrimarySalesSummary) — оба потребителя уже есть у этого фетча,
// седьмое поле не расширяет число мест, которые его вызывают.
const SELECT_COLUMNS = 'id, category, house, area_m2, terrace_area_m2, stage, price_total_eur, sold_at';

type NarrowRow = Pick<
  PrimaryMarketOfferRow,
  'id' | 'category' | 'house' | 'area_m2' | 'terrace_area_m2' | 'stage' | 'price_total_eur' | 'sold_at'
>;

function fromRow(row: NarrowRow): PrimaryMarketOffer {
  return {
    id: row.id,
    // Остальные поля странице не нужны (см. SELECT_COLUMNS выше) — честные
    // пустые/нулевые значения, не выдумка: их реальных значений мы здесь
    // не запрашивали, использовать их для чего-то другого было бы ошибкой.
    source: '',
    externalId: '',
    category: row.category,
    complex: null,
    house: row.house,
    unitNumber: null,
    floor: null,
    areaM2: row.area_m2,
    terraceAreaM2: row.terrace_area_m2,
    yearHandover: null,
    stage: row.stage,
    priceTotalByn: 0,
    priceTotalEur: row.price_total_eur,
    adLink: null,
    scrapedAt: '',
    soldAt: row.sold_at,
  };
}

// PostgREST по умолчанию отдаёт максимум 1000 строк за один select — в
// таблице их 6000+ (bir.by, см. scripts/sync-bir-primary-market.mjs),
// поэтому без пагинации возвращались бы только первые ~1000. Раньше страницы
// тянулись ПОСЛЕДОВАТЕЛЬНО (7 круговых задержек подряд на каждый заход
// гида района) — теперь сначала узнаём точное количество строк одним
// HEAD-запросом (Prefer: count=exact), считаем число страниц и грузим их
// все параллельно через Promise.all (один и тот же supabase-клиент,
// отдельные HTTP-запросы друг друга не блокируют). .order('id') — раньше
// пагинация шла без ORDER BY: Postgres/PostgREST не гарантируют стабильный
// порядок между отдельными запросами без явной сортировки, то есть
// возможны были пропуски/дубли строк между смежными страницами (баг
// корректности сводки, не только скорости).
const PAGE_SIZE = 1000;

export function fetchPrimaryMarketOffers(): Promise<PrimaryMarketOffer[]> {
  return withRetry(async () => {
    const { count, error: countError } = await supabase
      .from('primary_market_offers')
      .select('id', { count: 'exact', head: true });
    if (countError) throw countError;

    const total = count ?? 0;
    if (total === 0) return [];

    const pageStarts: number[] = [];
    for (let from = 0; from < total; from += PAGE_SIZE) pageStarts.push(from);

    const pages = await Promise.all(
      pageStarts.map(async (from) => {
        const { data, error } = await supabase
          .from('primary_market_offers')
          .select(SELECT_COLUMNS)
          .order('id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        return data as NarrowRow[];
      }),
    );

    return pages.flat().map(fromRow);
  });
}
