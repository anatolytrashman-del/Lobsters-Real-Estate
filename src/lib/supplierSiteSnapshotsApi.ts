import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type {
  SupplierSiteSection,
  SupplierSiteSnapshot,
  SupplierSiteSnapshotRow,
  SupplierSiteSnapshotStatus,
} from '../data/supplierSiteSnapshots';

// Только чтение: снимки создаёт триггер в базе, заполняет Edge Function,
// классифицирует сессия Claude Code (см. data/supplierSiteSnapshots.ts).
// Админке нужны товарные группы на карточке и в поиске по поставщикам.

const STATUSES: SupplierSiteSnapshotStatus[] = ['pending', 'processing', 'done', 'error'];

function fromRow(row: SupplierSiteSnapshotRow): SupplierSiteSnapshot {
  const sections: SupplierSiteSection[] = Array.isArray(row.sections)
    ? row.sections
        .filter((s): s is { title: string; url: string } => !!s && typeof s === 'object' && typeof (s as { title?: unknown }).title === 'string')
        .map((s) => ({ title: s.title, url: typeof s.url === 'string' ? s.url : '' }))
    : [];
  return {
    host: row.host,
    websiteUrl: row.website_url,
    status: STATUSES.includes(row.status as SupplierSiteSnapshotStatus) ? (row.status as SupplierSiteSnapshotStatus) : 'pending',
    pageTitle: row.page_title ?? '',
    metaDescription: row.meta_description ?? '',
    sections,
    error: row.error,
    fetchedAt: row.fetched_at,
    categories: Array.isArray(row.categories) ? row.categories.filter((c) => typeof c === 'string' && c.trim()) : [],
    categoriesNote: row.categories_note ?? '',
    classifiedAt: row.classified_at,
  };
}

// Без home_text: он нужен только классификатору, а на 259+ доменов это
// ~700 КБ лишнего трафика при каждом открытии страницы поставщиков.
const COLUMNS =
  'host, website_url, status, page_title, meta_description, sections, error, fetched_at, categories, categories_note, classified_at';

export function fetchSupplierSiteSnapshots(): Promise<SupplierSiteSnapshot[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_site_snapshots')
      .select(COLUMNS)
      .order('host', { ascending: true });
    if (error) throw error;
    return ((data ?? []) as unknown as SupplierSiteSnapshotRow[]).map(fromRow);
  });
}
