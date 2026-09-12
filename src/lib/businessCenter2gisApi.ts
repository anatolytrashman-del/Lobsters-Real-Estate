import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type {
  BusinessCenter2gisSnapshot,
  BusinessCenter2gisSnapshotRow,
  Gis2AttributeGroup,
  Gis2Parking,
  Gis2Reviews,
  Gis2Rubric,
  Gis2Schedule,
} from '../data/businessCenter2gis';

const SCHEDULE_DAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

// Разбор максимально защитный — building_only записи (37 из 143, см. журнал
// docs/session-journal.md) шлют rubrics/schedule/reviews/attribute_groups как null (нет
// найденной организации, только геокод здания), а формат самого 2GIS нигде
// не гарантирован документацией, только присланным примером ответа.
function parseRubrics(raw: unknown): Gis2Rubric[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof r.name === 'string')
    .map((r) => ({ name: r.name as string, kind: typeof r.kind === 'string' ? r.kind : 'additional' }));
}

function parseSchedule(raw: unknown): Gis2Schedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const days: Gis2Schedule['days'] = {};
  for (const key of SCHEDULE_DAY_KEYS) {
    const day = obj[key];
    if (!day || typeof day !== 'object') continue;
    const hours = (day as Record<string, unknown>).working_hours;
    if (!Array.isArray(hours)) continue;
    const workingHours = hours
      .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
      .map((h) => ({ from: String(h.from ?? ''), to: String(h.to ?? '') }))
      .filter((h) => h.from && h.to);
    if (workingHours.length > 0) days[key] = { workingHours };
  }
  return { days, is24x7: obj.is_24x7 === true };
}

function parseReviews(raw: unknown): Gis2Reviews | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const orgRating = typeof obj.org_rating === 'number' ? obj.org_rating : null;
  const orgReviewCount = typeof obj.org_review_count === 'number' ? obj.org_review_count : null;
  if (orgRating === null && orgReviewCount === null) return null;
  return { orgRating, orgReviewCount };
}

function parseParking(links: unknown): Gis2Parking[] {
  if (!links || typeof links !== 'object') return [];
  const raw = (links as Record<string, unknown>).parking;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof p.name === 'string')
    .map((p) => ({
      name: p.name as string,
      isPaid: p.is_paid === true,
      capacity: typeof p.capacity === 'string' && p.capacity.trim() !== '' ? Number(p.capacity) : null,
    }))
    .filter((p) => !Number.isNaN(p.capacity ?? 0));
}

function parseAttributeGroups(raw: unknown): Gis2AttributeGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (g): g is Record<string, unknown> =>
        !!g && typeof g === 'object' && typeof g.name === 'string' && Array.isArray(g.attributes),
    )
    .map((g) => ({ name: g.name as string, attributes: (g.attributes as unknown[]).filter((a): a is string => typeof a === 'string') }))
    .filter((g) => g.attributes.length > 0);
}

function fromRow(row: BusinessCenter2gisSnapshotRow): BusinessCenter2gisSnapshot {
  return {
    slug: row.business_center_slug,
    matchStatus: row.match_status ?? 'unknown',
    rubrics: parseRubrics(row.rubrics),
    schedule: parseSchedule(row.schedule),
    reviews: parseReviews(row.reviews),
    parking: parseParking(row.links),
    attributeGroups: parseAttributeGroups(row.attribute_groups),
    fetchedAt: row.fetched_at,
  };
}

// По одному слагу за раз (не все 143 разом) — в отличие от business_centers
// целиком (нужен весь список для навигации prev/next), это исследовательские
// данные ровно ОДНОГО БЦ, тот же принцип, что и у fetchBusinessCenterOffers.
// RLS для anon открывает только перечисленные ниже колонки — raw_item/
// geocode_raw/gis_org_id/gis_building_id/point/id/data_quality_flag не
// читаемы анонимным ключом вовсе (см. миграцию в журнале docs/session-journal.md).
export function fetchBusinessCenter2gisSnapshot(slug: string): Promise<BusinessCenter2gisSnapshot | null> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('business_center_2gis_snapshots')
      .select('business_center_slug,match_status,rubrics,schedule,reviews,links,attribute_groups,fetched_at')
      .eq('business_center_slug', slug)
      .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as BusinessCenter2gisSnapshotRow) : null;
  });
}
