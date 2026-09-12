export interface GoogleSearchConsolePageIndex {
  path: string;
  verdict: string | null;
  coverageState: string | null;
  lastCrawlTime: string | null;
  checkedAt: string;
}

export interface GoogleSearchConsolePageIndexRow {
  path: string;
  verdict: string | null;
  coverage_state: string | null;
  last_crawl_time: string | null;
  checked_at: string;
}
