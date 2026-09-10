import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { YandexWebmasterStat, YandexWebmasterStatRow } from '../data/yandexWebmasterStats';

function fromRow(row: YandexWebmasterStatRow): YandexWebmasterStat {
  return {
    date: row.date,
    pagesInSearch: row.pages_in_search,
    impressions: row.impressions,
    clicks: row.clicks,
    avgPosition: row.avg_position,
    avgClickPosition: row.avg_click_position,
  };
}

export function fetchYandexWebmasterStats(): Promise<YandexWebmasterStat[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('yandex_webmaster_stats').select('*').order('date', { ascending: true });
    if (error) throw error;
    return (data as YandexWebmasterStatRow[]).map(fromRow);
  });
}
