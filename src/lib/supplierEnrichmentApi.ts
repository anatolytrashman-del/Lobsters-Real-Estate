import { supabase } from './supabase';
import type { SupplierMessengerContact } from '../data/supplierResearch';

// Автообогащение контактов поставщика с его же сайта (email для заказов,
// телефон, мессенджеры) — владелец, 2026-09-11: "мы делали связку с
// проксиапи и ИИшка ходила по сайтам бизнес-центров и собирала информацию с
// них... хочу так же для поставщиков". Реальную обработку (ProxyAPI,
// инструмент web_fetch_20250910 — см. живую проверку сайтов БЦ,
// docs/session-journal.md 2026-09-06) делает scripts/process-supplier-
// enrichment-jobs.mjs.
//
// Клиент задания НЕ ставит — ни кнопкой, ни массово. Владелец, 2026-09-11
// (после первой версии с кнопками): "мне не нужна кнопка обогащения. Хочу
// так: запустили поиск по категории → ИИ нашёл → сразу добавил в базу →
// скрипт обогащения сразу берёт в работу → когда вся инфа собрана,
// поставщик получает статус «Готово к верификации»". Поэтому задания
// создаёт сам поисковый скрипт (scripts/process-supplier-web-search-jobs.mjs,
// createOffersAndQueueEnrichment) сразу после того, как создал предложения;
// здесь остаётся только ЧТЕНИЕ состояния — для статуса поставщика в UI и
// уведомления в колокольчик.
//
// Задание всегда привязано к КОНКРЕТНОМУ предложению (offer_id) — обогащаем
// то, что уже в базе. Сам скрипт применяет найденное НЕПОСРЕДСТВЕННО к
// supplier_research_offers (email, contact/contact_method, messengers),
// только в пустые поля — не перезаписывает то, что уже заполнено вручную или
// из предыдущего обогащения.
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

// Состояние обогащения по каждому предложению — считается один раз на весь
// список заданий, а не перебором массива на каждую строку таблицы.
// 'active' — задание ещё в очереди или выполняется (данные собираются),
// 'done' — сбор завершён (в том числе неудачей: сайт не открылся — это тоже
// законченная попытка, дальше нужен человек, а не ещё один автоматический шаг).
export type OfferEnrichmentState = 'active' | 'done';

export function enrichmentStateByOffer(jobs: SupplierEnrichmentJob[]): Map<string, OfferEnrichmentState> {
  const state = new Map<string, OfferEnrichmentState>();
  for (const job of jobs) {
    const active = job.status === 'pending' || job.status === 'processing';
    // Активное задание важнее уже завершённого: если поставщика поставили в
    // очередь повторно, показываем "собираем", а не старое "готово".
    if (active) state.set(job.offerId, 'active');
    else if (!state.has(job.offerId)) state.set(job.offerId, 'done');
  }
  return state;
}

// Статус поставщика в конвейере "нашли → добавили → обогатили → проверил
// человек" (владелец, 2026-09-11). verified — ручная отметка закупщика
// (единственный путь — сохранение формы предложения), остальное считается из
// состояния заданий обогащения.
export type SupplierVerificationStatus = 'verified' | 'ready' | 'enriching' | 'needs_verification';

export const SUPPLIER_VERIFICATION_LABEL: Record<SupplierVerificationStatus, string> = {
  verified: 'Верифицирован',
  ready: 'Готово к верификации',
  enriching: 'Собираем данные...',
  needs_verification: 'Требуется верификация',
};

export function supplierVerificationStatus(
  offer: { id: string; verified: boolean },
  enrichmentState: Map<string, OfferEnrichmentState>,
): SupplierVerificationStatus {
  if (offer.verified) return 'verified';
  const state = enrichmentState.get(offer.id);
  if (state === 'active') return 'enriching';
  if (state === 'done') return 'ready';
  return 'needs_verification';
}
