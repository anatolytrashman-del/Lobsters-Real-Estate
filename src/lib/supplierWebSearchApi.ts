import { withRetry } from './withRetry';
import { authFetch } from './authFetch';

// Веб-поиск поставщиков (вкладка "Ресерч" на странице Suppliers.tsx) —
// api/supplier-web-search.js, claude-haiku-4-5 через ProxyAPI (переведено
// с claude-sonnet-5 2026-08-31 — реальная причина дороговизны была не в
// модели, а в "программном вызове инструмента", см. подробный комментарий
// в самой функции; gpt-4o-mini-search-preview как альтернатива не
// сработала вовсе — ProxyAPI отдаёт "Model not supported" на все
// search-модели OpenAI). Живой прогон после фикса — 8с и 13 943 входных
// токена (было 20-115с и 41-45 тыс.) — таймаут ниже оставлен прежним
// щедрым запасом (280с), не сокращал специально: один быстрый прогон не
// гарантирует, что медленный запрос с 3 поисками не встретится позже.
// Результат не сохраняется в базу — это одноразовая подсказка, которую
// владелец либо добавляет как предложение (кнопка в модалке результатов),
// либо закрывает. БЕЗ повторной попытки при неудаче (withRetry с
// retries=0): при потенциально долгом вызове молчаливый повтор на всю его
// длительность ещё раз — плохой компромисс, лучше сразу показать ошибку.
const WEB_SEARCH_TIMEOUT_MS = 280000;

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
// вызванный напрямую по URL уже загруженного в Storage файла. Без
// withRetry (как и у поиска выше) — распознавание одного документа не
// такое долгое, но повторный вызов при сетевой икоте всё равно не то, что
// хочется молча ждать второй раз подряд.
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

// Владелец, 2026-09-11: "поиск ещё" в существующей категории — уже
// найденных (добавленных как предложения ИЛИ просто показанных в этом же
// поиске) поставщиков нужно узнавать по тому же принципу, что и сервер
// (api/supplier-web-search.js, dedupKey) — нормализованный домен сайта, а
// при его отсутствии нормализованное имя компании. Не выносил в общий
// модуль с сервером (там plain JS без сборки, здесь TS) — логика в 4
// строки, синхронизировать вручную при правке одной стороны не сложнее,
// чем тянуть общий импорт через границу клиент/сервер.
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

export async function searchSuppliersOnline(
  itemsText: string,
  sectionTitle: string,
  extra: string,
  country: string,
  exclude?: SupplierExcludeEntry[],
): Promise<SupplierSearchResult[]> {
  return withRetry(
    async () => {
      const resp = await authFetch('/api/supplier-web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemsText,
          sectionTitle,
          extra,
          country,
          excludeCompanies: exclude && exclude.length ? exclude : undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `Ошибка веб-поиска (${resp.status})`);
      return Array.isArray(data.results) ? data.results : [];
    },
    1000,
    WEB_SEARCH_TIMEOUT_MS,
    0,
  );
}
