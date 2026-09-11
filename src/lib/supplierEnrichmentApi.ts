import { supabase } from './supabase';
import { authFetch } from './authFetch';
import type { SupplierMessengerContact } from '../data/supplierResearch';

// Автообогащение контактов поставщика с его же сайта (email для заказов,
// телефон, мессенджеры) — владелец, 2026-09-11: "мы делали связку с
// проксиапи и ИИшка ходила по сайтам бизнес-центров и собирала информацию с
// них... хочу так же для поставщиков". Тот же принцип очереди, что и у
// веб-поиска поставщиков (supplierWebSearchApi.ts) — клиент только СТАВИТ
// задание (обычная authenticated-запись), реальную обработку (ProxyAPI,
// инструмент web_fetch_20250910 — см. живую проверку сайтов БЦ,
// docs/session-journal.md 2026-09-06) делает scripts/process-supplier-
// enrichment-jobs.mjs по расписанию + мгновенно через workflow_dispatch
// (api/trigger-rebuild.js, action:'dispatch-supplier-enrichment').
//
// В отличие от веб-поиска (одно задание — один свободный запрос), здесь
// задание всегда привязано к КОНКРЕТНОМУ уже добавленному предложению
// (offer_id) — обогащаем то, что уже в базе, не ищем новое. Сам скрипт
// применяет найденное НЕПОСРЕДСТВЕННО к supplier_research_offers (email,
// contact/contact_method, messengers), только в пустые поля — не
// перезаписывает то, что уже заполнено вручную или из предыдущего
// обогащения. result здесь — просто то, что реально нашла модель (для
// отображения в уведомлении/карточке), не сырой ответ для ручного подтверждения.
export type SupplierEnrichmentJobStatus = 'pending' | 'processing' | 'done' | 'error';

export interface SupplierEnrichmentResult {
  orderEmail: string;
  phone: string;
  messengers: SupplierMessengerContact[];
  note: string;
  siteAccessible: boolean;
}

export interface SupplierEnrichmentJob {
  id: string;
  offerId: string;
  status: SupplierEnrichmentJobStatus;
  result: SupplierEnrichmentResult | null;
  error: string;
  createdAt: string;
  completedAt: string | null;
}

interface SupplierEnrichmentJobRow {
  id: string;
  offer_id: string;
  status: string;
  result: SupplierEnrichmentResult | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function fromRow(row: SupplierEnrichmentJobRow): SupplierEnrichmentJob {
  return {
    id: row.id,
    offerId: row.offer_id,
    status: (row.status as SupplierEnrichmentJobStatus) || 'pending',
    result: row.result ?? null,
    error: row.error ?? '',
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// Небольшая таблица — читаем целиком, как и fetchSupplierWebSearchJobs.
export async function fetchSupplierEnrichmentJobs(): Promise<SupplierEnrichmentJob[]> {
  const { data, error } = await supabase
    .from('supplier_enrichment_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SupplierEnrichmentJobRow[]).map(fromRow);
}

// Ставит по одному заданию на каждый offerId (один запрос insert массивом)
// и best-effort дёргает мгновенный workflow_dispatch — тот же принцип, что и
// у queueSupplierWebSearch. Используется и для одиночного обогащения (один
// id в массиве — кнопка на карточке предложения), и для массового (кнопка
// "Обогатить всех" на карточке категории).
export async function queueSupplierEnrichment(offerIds: string[]): Promise<SupplierEnrichmentJob[]> {
  if (offerIds.length === 0) return [];
  const { data, error } = await supabase
    .from('supplier_enrichment_jobs')
    .insert(offerIds.map((offer_id) => ({ offer_id })))
    .select();
  if (error) throw error;
  authFetch('/api/trigger-rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dispatch-supplier-enrichment' }),
  }).catch(() => {});
  return (data as SupplierEnrichmentJobRow[]).map(fromRow);
}
