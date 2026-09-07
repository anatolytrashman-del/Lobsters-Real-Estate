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
  phone: string;
  email: string;
  note: string;
}

export async function searchSuppliersOnline(
  itemsText: string,
  sectionTitle: string,
  extra: string,
  country: string,
): Promise<SupplierSearchResult[]> {
  return withRetry(
    async () => {
      const resp = await authFetch('/api/supplier-web-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemsText, sectionTitle, extra, country }),
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
