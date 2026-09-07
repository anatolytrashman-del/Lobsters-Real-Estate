// Месячные агрегаты рынка коммерческой недвижимости — public.market_snapshots
// (см. scripts/build-market-snapshots.mjs, ANALYTICSPLAN.md §3.1, §9 спринт 1).
// Сегменты: 'ofisy_bc' (офисы в БЦ), 'torgovye' (торговые), 'sklady' (склады)
// — цена за м² (unit='usd_per_sqm'); 'mashinomesta' (машиноместа) — цена за
// ОБЪЕКТ целиком, не за м² (unit='usd_total', см. sync-citywide-parking-
// offers.mjs). Тип сегмента открытый (string), не строгий enum.
export interface MarketSnapshot {
  id: number;
  period: string; // 'YYYY-MM-01'
  segment: string;
  deal: 'rent' | 'sale';
  sliceType: 'city' | 'class' | 'district' | 'building_type';
  sliceKey: string;
  currency: string;
  unit: string; // 'usd_per_sqm' | 'usd_total'
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
  unit: string;
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
}

// Порог из ANALYTICSPLAN.md §3.2: срез с меньшим n не считается надёжным
// (показываем как "недостаточно данных", а не как обычную цифру).
export const MIN_RELIABLE_N = 15;

// Внешние источники (ANALYTICSPLAN.md §2) — public.external_metrics, ручной
// ввод (сейчас — через ProxyAPI/web_fetch, каждое число дважды перепроверено
// перед записью, см. журнал CLAUDE.md за 2026-09-07). Не связаны с нашими
// собственными данными, показываются рядом для сравнения.
export interface ExternalMetric {
  id: number;
  source: string;
  segment: string;
  deal: 'rent' | 'sale' | null;
  sliceKey: string | null;
  metric: string;
  value: number;
  unit: string;
  period: string;
  url: string | null;
  note: string | null;
  fetchedAt: string;
}

export interface ExternalMetricRow {
  id: number;
  source: string;
  segment: string;
  deal: string | null;
  slice_key: string | null;
  metric: string;
  value: number;
  unit: string;
  period: string;
  url: string | null;
  note: string | null;
  fetched_at: string;
}

export const SOURCE_LABELS: Record<string, string> = {
  'tvoya-stolitsa': 'Твоя столица',
  colliers: 'Colliers International',
};
