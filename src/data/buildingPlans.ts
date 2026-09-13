export const zoneTypes = ['room', 'common', 'bathroom', 'technical'] as const;
export type ZoneType = (typeof zoneTypes)[number];

export const zoneTypeLabels: Record<ZoneType, string> = {
  room: 'Кабинет',
  common: 'МОП (коридор, лестница)',
  bathroom: 'Санузел',
  technical: 'Техническое помещение',
};

export const zoneStatuses = ['Свободно', 'Забронировано', 'Продано'] as const;
export type ZoneStatus = (typeof zoneStatuses)[number];

export const zoneStatusBadgeClass: Record<ZoneStatus, string> = {
  Свободно: 'bg-success-bg text-success',
  Забронировано: 'bg-warning/15 text-warning',
  Продано: 'bg-danger/15 text-danger',
};

export const zoneFeatures = [
  'Свой санузел',
  'Есть мокрая точка',
  'Можно сделать мокрую точку',
  'Отдельный вход',
] as const;
export type ZoneFeature = (typeof zoneFeatures)[number];

export interface ZonePoint {
  x: number; // проценты от ширины картинки, 0–100
  y: number; // проценты от высоты картинки, 0–100
}

// Ставка и доля первого взноса — общие для всех кабинетов на всех объектах.
// Вынесены сюда, а не в конкретный компонент, чтобы внутренняя карточка
// объекта и публичная страница для клиента считали цену одинаково.
export const PRICE_PER_METER = 2100;
export const DOWN_PAYMENT_RATE = 0.1;

// Наценка за кабинет со своим санузлом (feature 'Свой санузел') — фиксированная
// добавка к цене, не зависит от площади. Не путать с WET_POINT_ADDON_PRICE в
// PublicPlanAndUnits.tsx — та опциональная доплата, которую клиент выбирает сам
// при бронировании ("можно сделать мокрую точку"), эта же — постоянная часть
// цены кабинета, у которого санузел уже есть.
export const BATHROOM_ADDON_PRICE = 3500;
export const BATHROOM_ADDON_LABEL = 'Отдельный санузел';

export function zonePrice(area: number, features: string[] = []): number {
  return area * PRICE_PER_METER + (features.includes('Свой санузел') ? BATHROOM_ADDON_PRICE : 0);
}

export function zoneDownPayment(area: number, features: string[] = []): number {
  return zonePrice(area, features) * DOWN_PAYMENT_RATE;
}

// Фиксированное рабочее место — отдельный формат лота внутри зоны-кабинета:
// вместо продажи всей площади одним лотом зона делится на N мест с
// фиксированной ценой за штуку (не считается через zonePrice/площадь).
export const WORKSTATION_PRICE = 12000;

// Аренда — отдельная линейка цен для переключателя "Покупка"/"Аренда" на
// продающей странице (см. ObjectLandingPage.tsx). Не доля/наценка от цены
// продажи — независимая ставка, которую задал владелец напрямую, поэтому
// не через zonePrice/WORKSTATION_PRICE, а свои константы и хелперы.
export const RENT_PRICE_PER_METER = 20;
export const RENT_WORKSTATION_PRICE = 100;

export type DealMode = 'sale' | 'rent';

export function pricePerMeterForDeal(dealMode: DealMode): number {
  return dealMode === 'rent' ? RENT_PRICE_PER_METER : PRICE_PER_METER;
}

// Аренда — без наценки за санузел (features не учитываются), в отличие от
// zonePrice для продажи.
export function priceForDeal(dealMode: DealMode, area: number, features: string[] = []): number {
  return dealMode === 'rent' ? area * RENT_PRICE_PER_METER : zonePrice(area, features);
}

export function workstationPriceForDeal(dealMode: DealMode): number {
  return dealMode === 'rent' ? RENT_WORKSTATION_PRICE : WORKSTATION_PRICE;
}

export function workstationsRemaining(zone: Pick<BuildingPlanZone, 'workstationCount' | 'workstationsSold'>): number {
  if (zone.workstationCount == null) return 0;
  return Math.max(zone.workstationCount - zone.workstationsSold, 0);
}

// Статус/клиент/площадь/особенности имеют смысл только для zoneType === 'room' —
// у общих зон (МОП, санузел, техническое) это просто подписанный контур.
export interface BuildingPlanZone {
  id: string;
  buildingPlanId: string;
  zoneType: ZoneType;
  label: string;
  area: number | null;
  status: ZoneStatus;
  leadId: string;
  features: string[];
  points: ZonePoint[];
  // Если задано — зона продаётся не как единый кабинет, а как набор из N
  // фиксированных рабочих мест (см. WORKSTATION_PRICE). null — обычный кабинет.
  workstationCount: number | null;
  // Сколько из workstationCount уже забронировано/продано.
  workstationsSold: number;
  // Проставляется вручную в админке по каждому кабинету — нет способа
  // вычислить его из контура на плане.
  windowCount: number | null;
}

// Форма строки в таблице Supabase (snake_case-колонки) — см. src/lib/buildingPlansApi.ts
export interface BuildingPlanZoneRow {
  id: string;
  building_plan_id: string;
  zone_type: string;
  label: string;
  area: number | null;
  status: string;
  lead_id: string | null;
  features: string[] | null;
  points: ZonePoint[];
  workstation_count: number | null;
  workstations_sold: number | null;
  window_count: number | null;
}

export interface BuildingPlan {
  id: string;
  name: string;
  imageUrl: string;
}

export interface BuildingPlanRow {
  id: string;
  name: string;
  image_url: string;
}
