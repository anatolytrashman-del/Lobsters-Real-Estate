// Ежедневный снимок статистики Яндекс.Вебмастера по redevelopment.pro —
// сколько страниц реально в поиске + показы/клики/позиция по запросам.
// Заполняется скриптом scripts/sync-yandex-webmaster-stats.mjs (раз в
// сутки, см. .github/workflows/sync-yandex-webmaster-stats.yml) —
// источник данных для страницы "Показатели" в маркетинге (владелец,
// 2026-09-10: там же будут данные Яндекс.Метрики).
//
// impressions/clicks/avgPosition/avgClickPosition часто будут null —
// Вебмастер либо ещё не накопил данные по запросам (сайт молодой), либо
// скрывает их при слишком малом объёме. pagesInSearch обычно есть почти
// всегда, как только Яндекс хоть раз пересчитал индекс.
export interface YandexWebmasterStat {
  date: string;
  pagesInSearch: number | null;
  impressions: number | null;
  clicks: number | null;
  avgPosition: number | null;
  avgClickPosition: number | null;
}

export interface YandexWebmasterStatRow {
  date: string;
  pages_in_search: number | null;
  impressions: number | null;
  clicks: number | null;
  avg_position: number | null;
  avg_click_position: number | null;
  updated_at: string;
}
