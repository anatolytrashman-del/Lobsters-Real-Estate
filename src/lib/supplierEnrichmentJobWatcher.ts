import { useEffect } from 'react';
import { fetchSupplierEnrichmentJobs } from './supplierEnrichmentApi';
import { addNotification } from './notifications';

// Фоновый опрос завершённых заданий обогащения контактов поставщиков — тот
// же принцип, что и у supplierWebSearchJobWatcher.ts (событие рождается в
// фоновом GitHub Actions скрипте, не в открытой вкладке). НЕ ограничен
// isSuperAdmin — конвейером поставщиков пользуется и Альмира.
//
// Владелец, 2026-09-11: обогащение запускается само, сразу после того как
// поиск добавил найденных поставщиков в базу — поэтому уведомление здесь не
// про "задание выполнено", а про то, что реально важно человеку: поставщик
// дособран и ГОТОВ К ВЕРИФИКАЦИИ (см. supplierVerificationStatus).
const POLL_INTERVAL_MS = 60_000;
const SEEN_KEY = 'redevelopment-seen-supplier-enrichment-job-ids';

function readSeenIds(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return null;
  }
}

function writeSeenIds(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    // тихо игнорируем — не критично
  }
}

async function pollOnce(): Promise<void> {
  const jobs = await fetchSupplierEnrichmentJobs();
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error');
  const currentIds = finished.map((j) => j.id);
  const seen = readSeenIds();

  if (seen != null) {
    const fresh = finished.filter((j) => !seen.has(j.id));
    const done = fresh.filter((j) => j.status === 'done');
    const failed = fresh.filter((j) => j.status === 'error');

    if (done.length === 1) {
      addNotification({
        title: 'Поставщик готов к верификации',
        body: 'Контакты собраны с сайта — проверьте карточку на странице «Закупки».',
      });
    } else if (done.length > 1) {
      addNotification({
        title: 'Поставщики готовы к верификации',
        body: `У ${done.length} поставщиков собраны контакты — проверьте их на странице «Закупки».`,
      });
    }

    if (failed.length === 1) {
      addNotification({
        title: 'Не удалось собрать контакты поставщика',
        body: failed[0].error || 'см. вкладку «Поставщики»',
      });
    } else if (failed.length > 1) {
      addNotification({
        title: 'Часть контактов собрать не удалось',
        body: `${failed.length} поставщиков остались без автоматически собранных контактов — проверьте их вручную.`,
      });
    }
  }

  writeSeenIds(currentIds);
}

// Один хук на всё приложение (вызывается из AppLayout), не с каждой
// страницы отдельно.
export function useSupplierEnrichmentJobWatcher(): void {
  useEffect(() => {
    pollOnce().catch(() => {});
    const timer = window.setInterval(() => {
      pollOnce().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
