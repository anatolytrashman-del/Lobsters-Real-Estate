// Раз в сутки (см. .github/workflows/sync-google-search-console-stats.yml)
// забирает у Google Search Console индексацию сайта (сколько URL из
// sitemap.xml реально проиндексировано) и статистику по поисковым
// запросам (показы/клики/позиция) — сохраняет в
// public.google_search_console_stats, одна строка на календарный день.
// Ровно тот же принцип, что и у scripts/sync-yandex-webmaster-stats.mjs —
// источник данных для блока "Индексация в Google" на странице "Показатели"
// (владелец, 2026-09-10: "подключим гугл консоль в таком же формате").
//
// В отличие от Яндекса, у Google OAuth-токен — это refresh token, который
// нужно обменивать на короткоживущий access token перед каждым вызовом
// (client_id/client_secret/refresh_token — все три читаются из
// external_api_tokens, service='google_search_console'; получены владельцем
// разовым локальным запуском scripts/get-google-search-console-refresh-token.mjs,
// см. комментарий там же).
//
// "Проиндексировано" — НЕ из URL Inspection API (это заняло бы отдельный
// запрос на каждую из 285+ страниц сайта, дорого и медленно), а из
// Sitemaps.get: у каждого зарегистрированного в Search Console sitemap
// Google отдаёт contents[].submitted/contents[].indexed по типу контента
// (обычно один тип "web") — то же самое, что видно в интерфейсе Search
// Console на вкладке "Файлы Sitemap". Это state-счётчик (не событие),
// как и "Страниц в поиске" у Яндекса — берём последнее известное значение,
// не суммируем по дням.
//
// siteUrl (свойство Search Console) не хардкодится — вычисляется через
// sites.list на лету, найденное свойство может быть либо URL-префиксом
// ("https://redevelopment.pro/"), либо доменным свойством
// ("sc-domain:redevelopment.pro") — сверяем оба формата по домену.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const SEARCH_CONSOLE_API = 'https://www.googleapis.com/webmasters/v3';
const TARGET_DOMAIN = 'redevelopment.pro';
const SITEMAP_PATH = 'https://redevelopment.pro/sitemap.xml';

// Сколько дней истории запросов подтягивать за один прогон — у Search
// Console данные приходят с лагом 2-3 дня, запас с лихвой не портит.
const QUERY_HISTORY_DAYS = 30;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchCredentials() {
  const { data, error } = await supabase
    .from('external_api_tokens')
    .select('access_token, client_id, client_secret')
    .eq('service', 'google_search_console')
    .single();
  if (error) throw new Error(`Не удалось прочитать токен Google из external_api_tokens: ${error.message}`);
  if (!data?.access_token || !data?.client_id || !data?.client_secret) {
    throw new Error('В external_api_tokens нет полного набора (access_token/client_id/client_secret) для service=google_search_console');
  }
  return { refreshToken: data.access_token, clientId: data.client_id, clientSecret: data.client_secret };
}

async function getAccessToken({ refreshToken, clientId, clientSecret }) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) {
    throw new Error(`Не удалось обменять refresh token Google на access token: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.access_token;
}

async function searchConsoleFetch(accessToken, path, options = {}) {
  const res = await fetch(`${SEARCH_CONSOLE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Search Console ${path} вернул ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function resolveSiteUrl(accessToken) {
  const { siteEntry } = await searchConsoleFetch(accessToken, '/sites');
  const sites = siteEntry ?? [];
  const match = sites.find((s) => s.siteUrl?.includes(TARGET_DOMAIN));
  if (!match) {
    throw new Error(
      `В аккаунте Search Console не нашлось свойства для ${TARGET_DOMAIN} — сначала добавьте и подтвердите сайт на search.google.com/search-console`,
    );
  }
  return match.siteUrl;
}

async function fetchSitemapCoverage(accessToken, siteUrl) {
  const path = `/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(SITEMAP_PATH)}`;
  const sitemap = await searchConsoleFetch(accessToken, path);
  const contents = sitemap.contents ?? [];
  // Суммируем по всем типам контента (обычно один — "web") — на случай,
  // если Google когда-нибудь разложит по нескольким типам сразу.
  const submitted = contents.reduce((acc, c) => acc + Number(c.submitted ?? 0), 0);
  const indexed = contents.reduce((acc, c) => acc + Number(c.indexed ?? 0), 0);
  return { submitted, indexed };
}

async function fetchQueryHistory(accessToken, siteUrl) {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - QUERY_HISTORY_DAYS);

  const body = {
    startDate: isoDate(dateFrom),
    endDate: isoDate(dateTo),
    dimensions: ['date'],
    rowLimit: 1000,
  };

  const path = `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const { rows } = await searchConsoleFetch(accessToken, path, { method: 'POST', body: JSON.stringify(body) });

  const byDate = new Map();
  for (const row of rows ?? []) {
    const date = row.keys?.[0];
    if (!date) continue;
    byDate.set(date, { impressions: row.impressions ?? null, clicks: row.clicks ?? null, position: row.position ?? null });
  }
  return byDate;
}

async function main() {
  const credentials = await fetchCredentials();
  const accessToken = await getAccessToken(credentials);
  const siteUrl = await resolveSiteUrl(accessToken);
  console.log(`Свойство Search Console: ${siteUrl}`);

  const [coverage, queryByDate] = await Promise.all([
    fetchSitemapCoverage(accessToken, siteUrl),
    fetchQueryHistory(accessToken, siteUrl),
  ]);
  console.log(`Sitemap: submitted=${coverage.submitted}, indexed=${coverage.indexed}. Запросы: ${queryByDate.size} дней с данными.`);

  const today = isoDate(new Date());
  const rows = [...queryByDate.entries()].map(([date, q]) => ({
    date,
    // Покрытие sitemap — состояние на СЕГОДНЯ (Google не отдаёт его историю
    // по дням), пишем его только в сегодняшнюю строку, у остальных дат —
    // null (страница показывает "последнее известное значение", как и у
    // аналогичного показателя Яндекса).
    pages_submitted: date === today ? coverage.submitted : null,
    pages_indexed: date === today ? coverage.indexed : null,
    impressions: q.impressions,
    clicks: q.clicks,
    avg_position: q.position,
    updated_at: new Date().toISOString(),
  }));

  // Если сегодняшнего дня нет среди дат с данными по запросам (свежий день
  // ещё не обработан Search Console) — всё равно записываем отдельной
  // строкой хотя бы покрытие sitemap, не теряем его.
  if (!rows.some((r) => r.date === today)) {
    rows.push({
      date: today,
      pages_submitted: coverage.submitted,
      pages_indexed: coverage.indexed,
      impressions: null,
      clicks: null,
      avg_position: null,
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) {
    console.log('Нет данных для сохранения.');
    return;
  }

  if (DRY_RUN) {
    console.log('[dry-run] Записал бы в google_search_console_stats:');
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const { error } = await supabase.from('google_search_console_stats').upsert(rows, { onConflict: 'date' });
  if (error) throw error;

  console.log(`Сохранено ${rows.length} записей в google_search_console_stats.`);
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
