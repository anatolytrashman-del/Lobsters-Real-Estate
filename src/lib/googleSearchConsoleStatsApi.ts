import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { GoogleSearchConsoleStat, GoogleSearchConsoleStatRow } from '../data/googleSearchConsoleStats';

function fromRow(row: GoogleSearchConsoleStatRow): GoogleSearchConsoleStat {
  return {
    date: row.date,
    pagesSubmitted: row.pages_submitted,
    pagesIndexed: row.pages_indexed,
    impressions: row.impressions,
    clicks: row.clicks,
    avgPosition: row.avg_position,
  };
}

export function fetchGoogleSearchConsoleStats(): Promise<GoogleSearchConsoleStat[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('google_search_console_stats').select('*').order('date', { ascending: true });
    if (error) throw error;
    return (data as GoogleSearchConsoleStatRow[]).map(fromRow);
  });
}
