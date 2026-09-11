import { useEffect } from 'react';
import { fetchSupplierWebSearchJobs } from './supplierWebSearchApi';
import { addNotification } from './notifications';

// Фоновый опрос завершённых заданий веб-поиска поставщиков — тот же
// принцип, что и у supplierEmailWatcher.ts (событие рождается в фоновом
// GitHub Actions скрипте, не в этой вкладке — push/сокета нет, поэтому
// обычный поллинг Supabase с клиента). Владелец, 2026-09-11: "я формирую
// поиск, система ищет в фоне, я закрываю вкладку, когда найдёт — по
// аналогии с письмами появится уведомление... отправляй и в колокольчик,
// чтобы и я, и Альмира его видели" — НЕ ограничен isSuperAdmin, ровно как
// и у supplierEmailWatcher (веб-поиск поставщиков ведёт и Альмира).
const POLL_INTERVAL_MS = 60_000;
const SEEN_KEY = 'redevelopment-seen-supplier-search-job-ids';

function readSeenIds(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw == null) return null; // null = ни разу не опрашивали в этом браузере
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
    // тихо игнорируем — не критично, просто более многословный follow-up-опрос
  }
}

function jobLabel(job: { sectionTitle: string; itemsText: string }): string {
  const base = job.sectionTitle || job.itemsText;
  return base.length > 60 ? `${base.slice(0, 60)}…` : base;
}

async function pollOnce(): Promise<void> {
  const jobs = await fetchSupplierWebSearchJobs();
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'error');
  const currentIds = finished.map((j) => j.id);
  const seen = readSeenIds();

  // Первый опрос в этом браузере — только фиксируем базовый набор, без
  // уведомлений: задания, завершённые ДО появления вотчера, не новость.
  if (seen != null) {
    const fresh = finished.filter((j) => !seen.has(j.id));
    const done = fresh.filter((j) => j.status === 'done');
    const failed = fresh.filter((j) => j.status === 'error');

    if (done.length === 1) {
      addNotification({
        title: 'Поиск поставщиков завершён',
        body: `«${jobLabel(done[0])}» — найдено ${done[0].results.length}. Смотрите вкладку «Ресерч» на странице «Поставщики».`,
      });
    } else if (done.length > 1) {
      addNotification({
        title: 'Поиск поставщиков завершён',
        body: `${done.length} завершённых поиска — смотрите вкладку «Ресерч» на странице «Поставщики».`,
      });
    }

    if (failed.length === 1) {
      addNotification({
        title: 'Поиск поставщиков не удался',
        body: `«${jobLabel(failed[0])}»: ${failed[0].error || 'см. вкладку «Ресерч»'}`,
      });
    } else if (failed.length > 1) {
      addNotification({
        title: 'Поиск поставщиков не удался',
        body: `${failed.length} заданий завершились ошибкой — смотрите вкладку «Ресерч» на странице «Поставщики».`,
      });
    }
  }

  // Не объединяем с прежним seen, а заменяем целиком — тот же принцип, что
  // и у остальных вотчеров (если задание когда-нибудь исчезнет из выборки,
  // повторное появление снова будет новостью, не потеряется молча).
  writeSeenIds(currentIds);
}

// Один хук на всё приложение (вызывается из AppLayout), не с каждой
// страницы отдельно — иначе опрос запускался бы параллельно N раз.
export function useSupplierWebSearchJobWatcher(): void {
  useEffect(() => {
    pollOnce().catch(() => {
      // Фоновый опрос — молчаливая неудача не должна мешать работе в CRM,
      // следующий тик просто попробует ещё раз.
    });
    const timer = window.setInterval(() => {
      pollOnce().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}
