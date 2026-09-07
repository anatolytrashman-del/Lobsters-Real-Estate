// Месячные агрегаты рынка коммерческой недвижимости — public.market_snapshots
// (см. scripts/build-market-snapshots.mjs, ANALYTICSPLAN.md §3.1, §9 спринт 1).
// Сейчас единственный сегмент с данными — 'ofisy_bc' (офисы в бизнес-центрах,
// city-wide, из business_center_offers). Тип сегмента открытый (string), не
// строгий enum — остальные сегменты плана (торговля/склады/офисы вне БЦ)
// появятся позже, без изменения схемы.
export interface MarketSnapshot {
  id: number;
  period: string; // 'YYYY-MM-01'
  segment: string;
  deal: 'rent' | 'sale';
  sliceType: 'city' | 'class' | 'district';
  sliceKey: string;
  currency: string;
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

export interface MarketSnapshotRow {
  id: number;
  period: string;
  segment: string;
  deal: string;
  slice_type: string;
  slice_key: string;
  currency: string;
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

// Порог из ANALYTICSPLAN.md §3.2: срез с меньшим n не считается надёжным
// (показываем как "недостаточно данных", а не как обычную цифру).
export const MIN_RELIABLE_N = 15;
