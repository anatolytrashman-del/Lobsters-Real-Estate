import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { MarketSnapshot, MarketSnapshotRow } from '../data/marketSnapshots';

function fromRow(row: MarketSnapshotRow): MarketSnapshot {
  return {
    id: row.id,
    period: row.period,
    segment: row.segment,
    deal: row.deal as MarketSnapshot['deal'],
    sliceType: row.slice_type as MarketSnapshot['sliceType'],
    sliceKey: row.slice_key,
    currency: row.currency,
    n: row.n,
    median: row.median,
    p25: row.p25,
    p75: row.p75,
  };
}

// Забирает снимки сегмента за самый свежий доступный период (не за
// конкретный календарный месяц — если крон ещё не прогонялся в этом
// месяце, страница показывает прошлый снимок, а не пустоту).
export async function fetchLatestMarketSnapshots(segment: string): Promise<MarketSnapshot[]> {
  return withRetry(async () => {
    const { data: latest, error: latestError } = await supabase
      .from('market_snapshots')
      .select('period')
      .eq('segment', segment)
      .order('period', { ascending: false })
      .limit(1);
    if (latestError) throw latestError;
    const period = latest?.[0]?.period;
    if (!period) return [];

    const { data, error } = await supabase
      .from('market_snapshots')
      .select('*')
      .eq('segment', segment)
      .eq('period', period);
    if (error) throw error;
    return (data as MarketSnapshotRow[]).map(fromRow);
  });
}
