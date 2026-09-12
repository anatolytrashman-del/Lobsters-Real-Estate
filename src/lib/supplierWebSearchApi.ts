import { supabase } from './supabase';
import { authFetch } from './authFetch';
import { getCurrentProfile } from './accessProfile';

export interface SupplierSearchResult {
  name: string;
  website: string;
  // Прямая ссылка на найденную позицию/товар на сайте (не главная страница
  // сайта) — владелец, 2026-09-10: "чтобы вручную на сайте не искать".
  // Пустая строка, если модель не нашла в поиске страницу конкретного товара.
  link: string;
  phone: string;
  email: string;
  note: string;
}

// Владелец, 2026-09-09: распознавание КП, загруженного вручную в форму
// предложения (не из переписки) — тот же серверный хелпер, что и у
// автоматики на входящих письмах (api/_invoiceRecognition.js), только
// вызванный напрямую по URL уже загруженного в Storage файла.
export interface RecognizedInvoiceItem {
  name: string;
  quantity: number | null;
  unit: string;
  price: number | null;
}

export interface RecognizedInvoice {
  isInvoice: boolean;
  price: number | null;
  currency: string | null;
  // ИНН поставщика, выставившего счёт (не покупателя). Уже проверен по
  // контрольному разряду на сервере; null — в документе не нашёлся.
  supplierInn: string | null;
  items: RecognizedInvoiceItem[];
}

export async function recognizeInvoiceFile(fileUrl: string, fileName: string): Promise<RecognizedInvoice> {
  const resp = await authFetch('/api/supplier-web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'recognize-invoice', fileUrl, fileName }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Не удалось распознать документ (${resp.status})`);
  return data.extraction;
}

// Ключ дедупликации результатов веб-поиска — нормализованный домен сайта, а
// при его отсутствии нормализованное имя компании. Тот же принцип, что и в
// scripts/process-supplier-web-search-jobs.mjs (dedupKey) — не выносил в
// общий модуль между клиентом и голым .mjs-скриптом (логика в 4 строки,
// синхронизировать вручную при правке одной стороны не сложнее, чем тянуть
// общий импорт через границу браузер/Node-скрипт).
export function supplierResultKey(r: { name: string; website: string }): string {
  const site = r.website.trim().toLowerCase();
  if (site) {
    return site
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
      .split(/[/?#]/)[0];
  }
  return r.name.trim().toLowerCase();
}

export interface SupplierExcludeEntry {
  name: string;
  website: string;
}

// Веб-поиск поставщиков (вкладка "Ресерч" на странице Suppliers.tsx).
//
// 2026-09-11: переведён с синхронного HTTP-запроса (клиент ждал ответ
// прямо во время открытого модального окна — до 2×40-115с на живой
// диагностике, см. комментарий в scripts/process-supplier-web-search-jobs.mjs)
// на асинхронную очередь. Владелец: "минуту ждать перед открытой вкладкой
// не захочется... я формирую поиск, система ищет в фоне, я закрываю
// вкладку, когда найдёт — уведомление, по аналогии с письмами". Тот же
// принцип, что и у массовой рассылки писем поставщикам (bulk_send_jobs) —
// клиент только СТАВИТ задание в очередь (обычная authenticated-запись,
// RLS уже разрешает — отдельный serverless endpoint под это не заводили,
// Hobby-план и так на пределе 12 функций), реальную обработку делает
// scripts/process-supplier-web-search-jobs.mjs по расписанию + мгновенно
// через workflow_dispatch (см. queueSupplierWebSearch ниже). Результат и
// прогресс — supplierWebSearchJobWatcher.ts (уведомление в колокольчик) и
// повторный fetchSupplierWebSearchJobs() на самой странице.
export type SupplierWebSearchJobStatus = 'pending' | 'processing' | 'done' | 'error';

export interface SupplierWebSearchJob {
  id: string;
  requestId: string;
  itemsText: string;
  sectionTitle: string;
  extra: string;
  // Регион поиска ('Москва'/'Россия'/'Беларусь', см. SUPPLIER_SEARCH_REGIONS
  // в data/supplierResearch.ts). В базе колонка исторически называется
  // country — заводилась, когда выбор был только между двумя странами;
  // переименовывать её ради этого не стали, значение читает только
  // обработчик очереди (supabase/functions/process-supplier-jobs).
  region: string;
  excludeCompanies: SupplierExcludeEntry[];
  status: SupplierWebSearchJobStatus;
  results: SupplierSearchResult[];
  // Сколько из найденного реально добавлено предложениями (владелец,
  // 2026-09-11: результаты поиска теперь создаёт сам скрипт, без ручного
  // добавления из модалки, см. createOffersAndQueueEnrichment в
  // scripts/process-supplier-web-search-jobs.mjs). Меньше results.length,
  // если часть найденного уже была в этой категории. null — задание из
  // времён ручного добавления (колонки тогда не было).
  addedCount: number | null;
  // Кто запустил поиск (владелец, 2026-09-12 — учёт добавления новых
  // поставщиков по сотрудникам, см. Metrics.tsx). Именно через задание, а не
  // через activity_log: только здесь рядом лежит addedCount, то есть сколько
  // поставщиков реально появилось на платформе по запросу этого человека.
  // null — задание из времён до появления колонок.
  createdByProfileId: string | null;
  createdByName: string | null;
  error: string;
  createdAt: string;
  completedAt: string | null;
}

interface SupplierWebSearchJobRow {
  id: string;
  request_id: string;
  items_text: string;
  section_title: string;
  extra: string;
  country: string;
  exclude_companies: SupplierExcludeEntry[] | null;
  status: string;
  results: SupplierSearchResult[] | null;
  added_count: number | null;
  created_by_profile_id: string | null;
  created_by_name: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function fromRow(row: SupplierWebSearchJobRow): SupplierWebSearchJob {
  return {
    id: row.id,
    requestId: row.request_id,
    itemsText: row.items_text,
    sectionTitle: row.section_title,
    extra: row.extra,
    region: row.country,
    excludeCompanies: Array.isArray(row.exclude_companies) ? row.exclude_companies : [],
    status: (row.status as SupplierWebSearchJobStatus) || 'pending',
    results: Array.isArray(row.results) ? row.results : [],
    addedCount: row.added_count,
    createdByProfileId: row.created_by_profile_id,
    createdByName: row.created_by_name,
    error: row.error ?? '',
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

// Небольшая таблица (одна CRM-фича, не десятки тысяч строк) — читаем целиком,
// как и большинство остальных *Api.ts в проекте, без пагинации.
export async function fetchSupplierWebSearchJobs(): Promise<SupplierWebSearchJob[]> {
  const { data, error } = await supabase
    .from('supplier_web_search_jobs')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as SupplierWebSearchJobRow[]).map(fromRow);
}

// То же, но только три поля, нужные странице метрик (/admin/metrics): она
// опрашивает данные раз в минуту, а в строке задания лежит ещё и results —
// весь JSON найденного поиском, десятки килобайт на задание. См. такой же
// облегчённый fetchOutgoingEmailMetrics в supplierOfferEmailsApi.ts.
export interface SupplierWebSearchJobMetric {
  createdAt: string;
  createdByName: string | null;
  addedCount: number | null;
}

export async function fetchSupplierWebSearchJobMetrics(): Promise<SupplierWebSearchJobMetric[]> {
  const { data, error } = await supabase
    .from('supplier_web_search_jobs')
    .select('created_at, created_by_name, added_count')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Pick<SupplierWebSearchJobRow, 'created_at' | 'created_by_name' | 'added_count'>[]).map((row) => ({
    createdAt: row.created_at,
    createdByName: row.created_by_name,
    addedCount: row.added_count,
  }));
}

// Ставит задание в очередь и best-effort дёргает мгновенный
// workflow_dispatch (api/trigger-rebuild.js, action:'dispatch-supplier-search'),
// чтобы не ждать планового крона (раз в 5 минут). Неудача дёргания —
// не критична и не пробрасывается наружу, крон всё равно разберёт очередь.
export async function queueSupplierWebSearch(params: {
  requestId: string;
  itemsText: string;
  sectionTitle: string;
  extra: string;
  region: string;
  excludeCompanies?: SupplierExcludeEntry[];
}): Promise<SupplierWebSearchJob> {
  const profile = getCurrentProfile();
  const { data, error } = await supabase
    .from('supplier_web_search_jobs')
    .insert({
      request_id: params.requestId,
      items_text: params.itemsText,
      section_title: params.sectionTitle,
      extra: params.extra,
      country: params.region,
      exclude_companies: params.excludeCompanies ?? [],
      created_by_profile_id: profile.id,
      created_by_name: profile.displayName,
    })
    .select()
    .single();
  if (error) throw error;
  authFetch('/api/trigger-rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dispatch-supplier-search' }),
  }).catch(() => {});
  return fromRow(data as SupplierWebSearchJobRow);
}
