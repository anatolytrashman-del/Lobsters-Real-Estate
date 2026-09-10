import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type {
  MetrikaDailyStat,
  MetrikaDailyStatRow,
  MetrikaTrafficSource,
  MetrikaTrafficSourceRow,
  MetrikaTopPage,
  MetrikaTopPageRow,
  MetrikaGoalCompletion,
  MetrikaGoalCompletionRow,
} from '../data/metrikaStats';

function dailyFromRow(row: MetrikaDailyStatRow): MetrikaDailyStat {
  return {
    date: row.date,
    visits: row.visits,
    users: row.users,
    pageviews: row.pageviews,
    bounceRate: row.bounce_rate,
    pageDepth: row.page_depth,
    avgDurationSeconds: row.avg_duration_seconds,
  };
}

export async function fetchMetrikaDailyStats(): Promise<MetrikaDailyStat[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('yandex_metrika_daily_stats')
      .select('*')
      .order('date', { ascending: true });
    if (error) throw error;
    return (data as MetrikaDailyStatRow[]).map(dailyFromRow);
  });
}

function trafficFromRow(row: MetrikaTrafficSourceRow): MetrikaTrafficSource {
  return {
    source: row.source,
    visits: row.visits,
    users: row.users,
    windowDays: row.window_days,
    updatedAt: row.updated_at,
  };
}

export async function fetchMetrikaTrafficSources(): Promise<MetrikaTrafficSource[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('yandex_metrika_traffic_sources')
      .select('*')
      .order('visits', { ascending: false });
    if (error) throw error;
    return (data as MetrikaTrafficSourceRow[]).map(trafficFromRow);
  });
}

function topPageFromRow(row: MetrikaTopPageRow): MetrikaTopPage {
  return {
    path: row.path,
    pageviews: row.pageviews,
    users: row.users,
    windowDays: row.window_days,
    updatedAt: row.updated_at,
  };
}

export async function fetchMetrikaTopPages(): Promise<MetrikaTopPage[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('yandex_metrika_top_pages')
      .select('*')
      .order('pageviews', { ascending: false });
    if (error) throw error;
    return (data as MetrikaTopPageRow[]).map(topPageFromRow);
  });
}

function goalFromRow(row: MetrikaGoalCompletionRow): MetrikaGoalCompletion {
  return {
    date: row.date,
    goalName: row.goal_name,
    goalId: row.goal_id,
    reaches: row.reaches,
    conversionRate: row.conversion_rate,
  };
}

export async function fetchMetrikaGoalCompletions(): Promise<MetrikaGoalCompletion[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('yandex_metrika_goal_completions')
      .select('*')
      .order('date', { ascending: true });
    if (error) throw error;
    return (data as MetrikaGoalCompletionRow[]).map(goalFromRow);
  });
}
