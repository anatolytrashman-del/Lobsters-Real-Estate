import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type {
  GoogleSearchConsolePageIndex,
  GoogleSearchConsolePageIndexRow,
} from '../data/googleSearchConsolePageIndex';

function fromRow(row: GoogleSearchConsolePageIndexRow): GoogleSearchConsolePageIndex {
  return {
    path: row.path,
    verdict: row.verdict,
    coverageState: row.coverage_state,
    lastCrawlTime: row.last_crawl_time,
    checkedAt: row.checked_at,
  };
}

export function fetchGoogleSearchConsolePageIndex(): Promise<GoogleSearchConsolePageIndex[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('google_search_console_page_index')
      .select('*')
      .order('path', { ascending: true });
    if (error) throw error;
    return (data as GoogleSearchConsolePageIndexRow[]).map(fromRow);
  });
}
