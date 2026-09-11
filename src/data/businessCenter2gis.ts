// Снапшот карточки БЦ из 2GIS (владелец подключил 2GIS API в параллельной
// ветке, 2026-09-06 — "парсинг закончен... 143 строки"). Отдельная таблица
// `business_center_2gis_snapshots` (не колонка на business_centers, как
// technicalParams/nearestMetroStations) — это ИССЛЕДОВАТЕЛЬСКИЙ снепшот,
// один на слаг, с полями, которые сама 2GIS отдаёт под организацию/здание;
// на карточке БЦ показываем только выбранную честную выжимку (расписание,
// рейтинг 2ГИС, особенности здания, парковка) — RLS для anon открывает
// только эти безопасные колонки (см. миграцию в docs/session-journal.md), НЕ raw_item/
// geocode_raw/gis_org_id/gis_building_id/point/id/data_quality_flag —
// внутренние технические поля исследовательской таблицы, не для публики.
export interface Gis2Rubric {
  name: string;
  kind: string;
}

export interface Gis2ScheduleDay {
  workingHours: { from: string; to: string }[];
}

// is24x7 — отдельный булев флаг у 2GIS (`schedule.is_24x7`), не день недели.
export interface Gis2Schedule {
  days: Partial<Record<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun', Gis2ScheduleDay>>;
  is24x7: boolean;
}

export interface Gis2Reviews {
  orgRating: number | null;
  orgReviewCount: number | null;
}

export interface Gis2Parking {
  name: string;
  isPaid: boolean;
  capacity: number | null;
}

export interface Gis2AttributeGroup {
  name: string;
  attributes: string[];
}

export interface BusinessCenter2gisSnapshot {
  slug: string;
  matchStatus: string;
  rubrics: Gis2Rubric[];
  schedule: Gis2Schedule | null;
  reviews: Gis2Reviews | null;
  parking: Gis2Parking[];
  attributeGroups: Gis2AttributeGroup[];
  fetchedAt: string | null;
}

export interface BusinessCenter2gisSnapshotRow {
  business_center_slug: string;
  match_status: string | null;
  rubrics: unknown;
  schedule: unknown;
  reviews: unknown;
  links: unknown;
  attribute_groups: unknown;
  fetched_at: string | null;
}
