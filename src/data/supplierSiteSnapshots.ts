// Снимок сайта поставщика: что компания поставляет — по разделам её
// каталога. Строка на ДОМЕН (не на карточку): одна компания живёт в
// нескольких категориях закупок, а сайт у неё один; фронт находит снимок
// по supplierWebsiteHost(offer.websiteUrl).
//
// Заполняется в два шага без участия админки: Edge Function
// process-supplier-jobs скачивает разделы (sections, без модели), сессия
// Claude Code раскладывает их по товарным группам (categories, справочник —
// data/supplyCategories.ts). Новые домены ставит в очередь триггер в базе
// при сохранении карточки с сайтом. Подробности — миграция
// supabase/migrations/20260912-supplier-site-snapshots.sql.
export type SupplierSiteSnapshotStatus = 'pending' | 'processing' | 'done' | 'error';

export interface SupplierSiteSection {
  title: string;
  url: string;
}

export interface SupplierSiteSnapshot {
  host: string;
  websiteUrl: string;
  status: SupplierSiteSnapshotStatus;
  pageTitle: string;
  metaDescription: string;
  sections: SupplierSiteSection[];
  error: string | null;
  fetchedAt: string | null;
  // Товарные группы из справочника SUPPLY_CATEGORIES (пусто — ещё не
  // классифицирован или по сайту ничего не понять).
  categories: string[];
  categoriesNote: string;
  classifiedAt: string | null;
}

export interface SupplierSiteSnapshotRow {
  host: string;
  website_url: string;
  status: string;
  page_title: string | null;
  meta_description: string | null;
  sections: unknown;
  error: string | null;
  fetched_at: string | null;
  categories: string[] | null;
  categories_note: string | null;
  classified_at: string | null;
}
