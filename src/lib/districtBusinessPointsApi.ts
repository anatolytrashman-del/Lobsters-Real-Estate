import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { DistrictBusinessPoint, DistrictBusinessPointRow } from '../data/districtBusinessPoints';

function fromRow(row: DistrictBusinessPointRow): DistrictBusinessPoint {
  return {
    id: row.id,
    externalId: row.external_id,
    title: row.title,
    rawCategory: row.raw_category,
    address: row.address,
    street: row.street,
    house: row.house,
    quarterId: row.quarter_id,
    lat: row.lat,
    lon: row.lon,
    status: row.status,
    reviewCount: row.review_count,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export function fetchDistrictBusinessPoints(): Promise<DistrictBusinessPoint[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('district_business_points').select('*').order('title');
    if (error) throw error;
    return (data as DistrictBusinessPointRow[]).map(fromRow);
  });
}

export interface ParsedBusinessEntry {
  title: string;
  rawCategory: string | null;
  // Число оценок на Яндекс.Картах — есть только из .webarchive-выгрузки
  // (см. lib/webarchiveOrgParser.ts), у ручного .txt-разбора всегда null.
  reviewCount: number | null;
}

// Разбор текстового файла, который Светлана выгружает с Яндекс.Карт
// (панель "Организации внутри" карточки дома) — по наблюдению за реальной
// панелью (см. журнал docs/session-journal.md, скриншот владельца) название организации
// и строка с категорией/часами работы идут ПОДРЯД, категория обычно
// содержит "·" (например "Круглосуточно · Вывоз мусора и отходов") или
// одно из типичных слов часов работы. Если Светлана скопирует просто
// список названий (без строки категории) — тоже сработает, категория
// останется пустой. Пустые строки — разделители, игнорируются.
const HOURS_HINT = /·|круглосуточно|открыто|закрыто|выходной|не указан/i;

export function parseBusinessListText(raw: string): ParsedBusinessEntry[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: ParsedBusinessEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HOURS_HINT.test(line)) continue; // это строка категории, а не название — уже подхвачена на предыдущем шаге
    const next = lines[i + 1];
    if (next && HOURS_HINT.test(next)) {
      entries.push({ title: line, rawCategory: next, reviewCount: null });
      i++; // следующую строку уже использовали как категорию
    } else {
      entries.push({ title: line, rawCategory: null, reviewCount: null });
    }
  }
  return entries;
}

export interface HouseDiff {
  toAdd: ParsedBusinessEntry[];
  toRemove: DistrictBusinessPoint[];
  unchanged: DistrictBusinessPoint[];
}

export function diffHouseBusinesses(current: DistrictBusinessPoint[], parsed: ParsedBusinessEntry[]): HouseDiff {
  const parsedTitles = new Set(parsed.map((p) => p.title.trim().toLowerCase()));
  const currentTitles = new Set(current.map((c) => c.title.trim().toLowerCase()));

  return {
    toAdd: parsed.filter((p) => !currentTitles.has(p.title.trim().toLowerCase())),
    toRemove: current.filter((c) => !parsedTitles.has(c.title.trim().toLowerCase())),
    unchanged: current.filter((c) => parsedTitles.has(c.title.trim().toLowerCase())),
  };
}

// Применяет уже посчитанный diff (см. diffHouseBusinesses) — добавляет
// новые организации, удаляет пропавшие. Ничего не трогает у "unchanged",
// кроме last_seen_at (подтверждаем, что запись всё ещё актуальна).
export function applyHouseDiff(
  house: { street: string; house: string; quarterId: string },
  diff: HouseDiff,
): Promise<void> {
  return withRetry(async () => {
    const now = new Date().toISOString();

    if (diff.toAdd.length > 0) {
      const { error } = await supabase.from('district_business_points').insert(
        diff.toAdd.map((entry) => ({
          title: entry.title,
          raw_category: entry.rawCategory,
          review_count: entry.reviewCount,
          street: house.street,
          house: house.house,
          quarter_id: house.quarterId,
          last_seen_at: now,
        })),
      );
      if (error) throw error;
    }

    if (diff.unchanged.length > 0) {
      const { error } = await supabase
        .from('district_business_points')
        .update({ last_seen_at: now })
        .in(
          'id',
          diff.unchanged.map((c) => c.id),
        );
      if (error) throw error;
    }

    if (diff.toRemove.length > 0) {
      const { error } = await supabase
        .from('district_business_points')
        .delete()
        .in(
          'id',
          diff.toRemove.map((c) => c.id),
        );
      if (error) throw error;
    }
  });
}

export function insertDistrictBusinessPoint(entry: {
  title: string;
  rawCategory: string | null;
  street: string;
  house: string;
  quarterId: string;
}): Promise<DistrictBusinessPoint> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('district_business_points')
      .insert({
        title: entry.title,
        raw_category: entry.rawCategory,
        street: entry.street,
        house: entry.house,
        quarter_id: entry.quarterId,
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as DistrictBusinessPointRow);
  });
}

export function deleteDistrictBusinessPoint(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('district_business_points').delete().eq('id', id);
    if (error) throw error;
  });
}
