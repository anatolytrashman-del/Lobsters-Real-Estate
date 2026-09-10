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
//
// 2026-09-10, доп. заход в ТОТ ЖЕ день — владелец спросил "написано, что в
// поиске 0 страниц, это правда?" после первого живого прогона. Проверка
// вживую через URL Inspection API (реальный, per-URL статус из индекса
// Google, не агрегат из sitemap) на 5 страницах показала: 3 из 5 реально
// "Submitted and indexed", а Sitemaps.get отдавал 0 — известная особенность
// Google: отчёт по sitemap считается отдельным, гораздо более медленным
// конвейером и может отставать от реального индекса на недели. Число
// pages_submitted (просто "сколько URL Google распарсил из sitemap") этой
// проблемы не имеет — оставлено как есть. pages_indexed из Sitemaps.get
// тоже оставлен (дёшево, часть той же истории по дням), но теперь это
// вспомогательная, не главная метрика — реальный, точный статус даёт
// per-page трекер ниже (google_search_console_page_index).
//
// Трекер намеренно НЕ проверяет весь сайт (285+ URL — дорого, упёрлось бы
// в квоту urlInspection и заняло бы минуты) — только куратированный список
// самых важных страниц (KEY_PAGE_PATHS: городские/аналитические хабы,
// гид района, каталог БЦ) + лендинги реальных объектов (objects.landing_slug,
// читается напрямую из базы тем же сервисным ключом, что и весь скрипт —
// не хардкодится, появится новый объект с лендингом — появится и в трекере
// на следующий день). Одна инспекция — один HTTP-запрос, при провале одной
// страницы (сеть/квота/что угодно) остальные не страдают — try/catch на
// каждую отдельно, ошибка только логируется.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const SEARCH_CONSOLE_API = 'https://www.googleapis.com/webmasters/v3';
const SEARCH_CONSOLE_INSPECTION_API = 'https://searchconsole.googleapis.com/v1';
const TARGET_DOMAIN = 'redevelopment.pro';
const SITE_ORIGIN = 'https://redevelopment.pro';
const SITEMAP_PATH = 'https://redevelopment.pro/sitemap.xml';

// Куратированный список ключевых страниц для точной проверки — тот же
// принцип отбора, что уже применялся при переобходе Яндекса тем же днём
// ("хабы, не единичные карточки БЦ/объектов"): хаб-страницы, приводящие ко
// всему остальному через внутренние ссылки, важнее сотен листовых страниц.
const KEY_PAGE_PATHS = [
  'minsk',
  'minsk/minsk-mir',
  'minsk/analytics',
  'minsk/analytics/metodika',
  'minsk/analytics/minsk-mir',
  'minsk/analytics/rajony',
  'minsk/analytics/ofisy/arenda',
  'minsk/analytics/torgovye/arenda',
  'minsk/analytics/sklady/arenda',
  'minsk/analytics/mashinomesta/arenda',
  'minsk/bcminsk',
  'minsk/bcminsk/reyting',
  'minsk/bcminsk/stroyashchiesya',
];

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

async function fetchLandingPagePaths() {
  const { data, error } = await supabase.from('objects').select('landing_slug').not('landing_slug', 'is', null);
  if (error) throw new Error(`Не удалось прочитать objects.landing_slug: ${error.message}`);
  return (data ?? [])
    .map((r) => r.landing_slug)
    .filter((slug) => typeof slug === 'string' && slug.trim() !== '')
    .map((slug) => `minsk/${slug}`);
}

async function inspectUrl(accessToken, siteUrl, path) {
  const inspectionUrl = `${SITE_ORIGIN}/${path}`;
  const res = await fetch(`${SEARCH_CONSOLE_INSPECTION_API}/urlInspection/index:inspect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl, siteUrl }),
  });
  if (!res.ok) {
    throw new Error(`urlInspection для ${path} вернул ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  const result = body.inspectionResult?.indexStatusResult ?? {};
  return {
    path,
    verdict: result.verdict ?? null,
    coverage_state: result.coverageState ?? null,
    last_crawl_time: result.lastCrawlTime ?? null,
    checked_at: new Date().toISOString(),
  };
}

// Владелец, 2026-09-10, сразу после первого живого прогона: "если страница
// уже в поиске, во второй раз гонять скрипт не надо — просто прогоняй новые
// страницы на предмет попадания в выдачу". "В индексе" — стабильный
// результат (Google не выкидывает страницу из индекса просто так), поэтому
// уже подтверждённые ("Submitted and indexed") пропускаем на последующих
// прогонах — экономим квоту urlInspection и время. Перепроверяем только те,
// что ещё НЕ в индексе (могли появиться в поиске с прошлого прогона) и
// новые (появившиеся в KEY_PAGE_PATHS/landingPaths после прошлого раза).
async function fetchAlreadyIndexedPaths() {
  const { data, error } = await supabase
    .from('google_search_console_page_index')
    .select('path')
    .eq('coverage_state', 'Submitted and indexed');
  if (error) throw new Error(`Не удалось прочитать google_search_console_page_index: ${error.message}`);
  return new Set((data ?? []).map((r) => r.path));
}

async function syncPageIndex(accessToken, siteUrl) {
  const landingPaths = await fetchLandingPagePaths();
  const allPaths = [...new Set([...KEY_PAGE_PATHS, ...landingPaths])];
  const alreadyIndexed = await fetchAlreadyIndexedPaths();
  const paths = allPaths.filter((p) => !alreadyIndexed.has(p));

  if (paths.length === 0) {
    console.log(`Все ${allPaths.length} ключевых страниц уже подтверждённо в индексе — новых проверок не требуется.`);
    return;
  }
  console.log(`Проверяю ${paths.length} из ${allPaths.length} ключевых страниц (${allPaths.length - paths.length} уже в индексе — пропускаю).`);

  const rows = [];
  for (const path of paths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      rows.push(await inspectUrl(accessToken, siteUrl, path));
    } catch (err) {
      console.error(`Не удалось проверить ${path}:`, err.message ?? err);
    }
  }

  if (rows.length === 0) {
    console.log('Ни одну ключевую страницу не удалось проверить — пропускаю запись в google_search_console_page_index.');
    return;
  }

  const newlyIndexed = rows.filter((r) => r.coverage_state === 'Submitted and indexed').length;
  const totalIndexed = alreadyIndexed.size + newlyIndexed;
  console.log(
    `Проверено ${rows.length} страниц, из них ${newlyIndexed} впервые попали в индекс. Всего в индексе: ${totalIndexed} из ${allPaths.length}.`,
  );

  if (DRY_RUN) {
    console.log('[dry-run] Записал бы в google_search_console_page_index:');
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const { error } = await supabase.from('google_search_console_page_index').upsert(rows, { onConflict: 'path' });
  if (error) throw error;
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
  } else if (DRY_RUN) {
    console.log('[dry-run] Записал бы в google_search_console_stats:');
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const { error } = await supabase.from('google_search_console_stats').upsert(rows, { onConflict: 'date' });
    if (error) throw error;
    console.log(`Сохранено ${rows.length} записей в google_search_console_stats.`);
  }

  // Точная проверка ключевых страниц — отдельный шаг, не роняет сохранение
  // агрегатной статистики выше, даже если сам этот блок целиком упадёт
  // (квота урezана, сеть моргнула и т.п.).
  try {
    await syncPageIndex(accessToken, siteUrl);
  } catch (err) {
    console.error('Проверка ключевых страниц не удалась:', err.message ?? err);
  }
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
