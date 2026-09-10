// Статистика посещаемости из Яндекс.Метрики — четыре таблицы Supabase,
// раз в сутки заполняются scripts/sync-yandex-metrika.mjs (сам OAuth-токен
// лежит отдельно в external_api_tokens, сюда не попадает ни разу — видны
// только уже посчитанные цифры). RLS: select только authenticated (страница
// «Показатели» внутри /admin), пишет исключительно сервисный ключ скрипта.

export interface MetrikaDailyStat {
  date: string; // 'YYYY-MM-DD'
  visits: number;
  users: number;
  pageviews: number;
  bounceRate: number | null; // %
  pageDepth: number | null; // просмотров за визит
  avgDurationSeconds: number | null;
}

export interface MetrikaDailyStatRow {
  date: string;
  visits: number;
  users: number;
  pageviews: number;
  bounce_rate: number | null;
  page_depth: number | null;
  avg_duration_seconds: number | null;
}

// Источники/топ страниц — не разбивка по дням, а снимок за окно (см.
// windowDays у самих строк — WINDOW_DAYS в скрипте синка, сейчас 90),
// полностью перезаписывается на каждом прогоне.
export interface MetrikaTrafficSource {
  source: string;
  visits: number;
  users: number;
  windowDays: number;
  updatedAt: string;
}

export interface MetrikaTrafficSourceRow {
  source: string;
  visits: number;
  users: number;
  window_days: number;
  updated_at: string;
}

export interface MetrikaTopPage {
  path: string;
  pageviews: number;
  users: number;
  windowDays: number;
  updatedAt: string;
}

export interface MetrikaTopPageRow {
  path: string;
  pageviews: number;
  users: number;
  window_days: number;
  updated_at: string;
}

// Достижения цели — по дням, как и daily stats (не снимок за окно): тренд
// «сколько броней в день» полезнее одной суммарной цифры. goalName — тот же
// идентификатор, что в src/lib/metrika.ts (reachGoal), goalId — числовой id
// цели внутри самой Метрики (найден автоматически скриптом синка, у разных
// целей будет разным, не хардкожен).
export interface MetrikaGoalCompletion {
  date: string;
  goalName: string;
  goalId: string | null;
  reaches: number;
  conversionRate: number | null; // %
}

export interface MetrikaGoalCompletionRow {
  date: string;
  goal_name: string;
  goal_id: string | null;
  reaches: number;
  conversion_rate: number | null;
}
