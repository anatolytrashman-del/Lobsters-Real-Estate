// Раз в сутки (см. .github/workflows/sync-yandex-metrika.yml) забирает из
// Яндекс.Метрики (Reporting/Stats API) статистику посещаемости сайта и
// складывает в 4 таблицы Supabase — читает их страница «Показатели»
// (/admin/metrics). Счётчик — тот же, что вшит в index.html и
// src/lib/metrika.ts (METRIKA_COUNTER_ID) — держать оба места в синхроне.
//
// OAuth-токен НЕ передаётся секретом GitHub Actions — хранится в таблице
// external_api_tokens (service='yandex', RLS закрыт для всех кроме
// service_role) и читается отсюда каждый прогон. Так его не нужно
// перевставлять в GitHub Actions при перевыпуске — достаточно один раз
// обновить строку в базе (см. CLAUDE.md, если появится инструмент/страница
// для этого). У Яндекс-API свой формат заголовка авторизации — именно
// `Authorization: OAuth <токен>`, не Bearer, это не опечатка.
//
// Источник разбит на 4 независимых запроса, каждый обёрнут в try/catch —
// сбой одного (например, метрика/измерение с опечаткой, или Яндекс поменял
// имя поля) не должен ронять остальные 3, они не зависят друг от друга:
//  1. daily-stats  — визиты/пользователи/просмотры/отказы по дням (тренд).
//  2. traffic      — источники трафика ЗА ВСЁ ОКНО целиком (WINDOW_DAYS),
//                     не по дням — полная замена таблицы на каждом прогоне.
//  3. top-pages     — топ страниц ЗА ВСЁ ОКНО целиком, та же логика замены.
//  4. goal          — достижения цели по дням (тренд, как и (1)) — только
//                     если цель 'booking_submitted' (см. metrika.ts) удалось
//                     найти через Management API; ID цели у Метрики
//                     числовой и меняется от инсталляции к инсталляции,
//                     matching идёт по условию цели/имени, не хардкожен.
//
// (2) и (3) сознательно НЕ разбиты по дням — «топ-N по дням» через один
// такой запрос физически не получить (limit у Stats API режет ГЛОБАЛЬНО
// отсортированный список, не по N на группу), а сама задача — рейтинг за
// период, не дневной тренд, так что снимок за окно и есть правильная
// форма данных, не костыль.
//
// Флаги: --dry-run (не пишет в Supabase, только печатает сводку),
// --json (печатает сырые ответы API целиком, для отладки).
//
// 2026-09-10 — исключение /admin/* (владелец: «нужна только клиентская
// часть», внутренняя CRM не должна попадать в статистику посещаемости).
// Основная защита теперь на уровне отправки хитов (App.tsx/index.html —
// с /admin счётчик вообще не шлёт события в Метрику), но ЭТОТ фильтр в
// самих запросах к Stats API нужен отдельно и не лишний: он же чистит уже
// накопленную ДО этой правки историю визитов внутри WINDOW_DAYS (Метрика
// хранит сырые данные по визиту независимо от того, что мы решили дальше с
// ними не делать хитов) — без него старые admin-визиты продолжали бы
// искажать «Показатели» ещё 90 дней.
//
// Первая версия ("NOT EXISTS ym:pv:...", без скобок) была НЕВЕРНОЙ —
// Метрика API реально отвечала 400 "Incorrectly specified filter for
// segmentation, error code 4003" на каждом прогоне, но ошибка тихо
// глоталась try/catch на уровне раздела (main()) — «визиты по дням»/
// «источники трафика»/«достижения целей» молча не обновлялись НИ РАЗУ с
// момента добавления фильтра, старые (домер-фикса) числа просто
// продолжали лежать в Supabase. Владелец поймал это на живых цифрах
// (список страниц очистился, а общая сумма визитов — нет) — см.
// --debug-filter ниже, которым и было подтверждено. Правильный синтаксис
// для session-уровневых (`ym:s:*`) запросов, где нужно условие по
// pageview-уровню (`ym:pv:*`) — ОТДЕЛЬНЫЙ оператор `NONE(...)` (не
// `NOT EXISTS`), обязательно со скобками вокруг условия: NONE(ym:pv:X)
// значит «нет ни одного просмотра страницы, удовлетворяющего условию»
// (см. WebSearch по официальной документации `yandex.ru/dev/metrika/ru/
// stat/segmentation` — сам домен закрыт прокси песочницы напрямую, но
// сниппеты поиска дали точный пример `filters=NONE(ym:pv:URL=@'x')`).
// Для pageview-уровневого запроса (топ страниц) — прямой `!~`, тот
// работал и раньше без изменений, не трогаем.
const ADMIN_EXCLUDE_FILTER_SESSION = "NONE(ym:pv:URLPathFull=~'^/admin')";
const ADMIN_EXCLUDE_FILTER_PAGEVIEW = "ym:pv:URLPathFull!~'^/admin'";

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DRY_RUN = process.argv.includes('--dry-run');
const PRINT_JSON = process.argv.includes('--json');
// 2026-09-10 — живая A/B-проверка ADMIN_EXCLUDE_FILTER_SESSION: печатает
// сумму визитов ЗА ОДИН И ТОТ ЖЕ период с фильтром и без — единственный
// способ убедиться, реально ли Метрика исключает сессии с /admin, а не
// молча игнорирует непонятный ей синтаксис EXISTS (что и произошло —
// владелец поймал на живых цифрах: список страниц очистился, а общее
// число визитов — нет). Ничего не пишет в Supabase, только печатает.
const DEBUG_FILTER = process.argv.includes('--debug-filter');

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Должен совпадать с METRIKA_COUNTER_ID в src/lib/metrika.ts.
const COUNTER_ID = 111858495;
const WINDOW_DAYS = 90;
const GOAL_IDENTIFIER = 'booking_submitted';

const METRIKA_API = 'https://api-metrika.yandex.net';

async function fetchYandexToken() {
  const { data, error } = await supabase
    .from('external_api_tokens')
    .select('access_token')
    .eq('service', 'yandex')
    .maybeSingle();
  if (error) throw error;
  if (!data?.access_token) {
    throw new Error(
      "В таблице external_api_tokens нет строки service='yandex' — токен не сохранён или удалён.",
    );
  }
  return data.access_token;
}

async function metrikaFetch(token, path, params) {
  const url = new URL(`${METRIKA_API}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: { Authorization: `OAuth ${token}` },
  });
  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`Метрика вернула не-JSON (${res.status}): ${bodyText.slice(0, 500)}`);
  }
  if (!res.ok) {
    const message = body?.message || body?.errors?.[0]?.message || bodyText.slice(0, 500);
    throw new Error(`Метрика API вернул ${res.status}: ${message}`);
  }
  return body;
}

async function findGoalId(token) {
  const body = await metrikaFetch(token, `/management/v1/counter/${COUNTER_ID}/goals`, {});
  const goals = body?.goals ?? [];
  const byCondition = goals.find((g) =>
    (g.conditions ?? []).some((c) => c.url === GOAL_IDENTIFIER || c.value === GOAL_IDENTIFIER),
  );
  const byName = goals.find((g) => g.name === GOAL_IDENTIFIER);
  const goal = byCondition ?? byName;
  if (!goal) {
    console.warn(
      `Цель '${GOAL_IDENTIFIER}' не найдена среди ${goals.length} целей счётчика — раздел «Достижение целей» будет пропущен.`,
    );
    return null;
  }
  return goal.id;
}

function windowDateParams() {
  return { date1: `${WINDOW_DAYS - 1}daysAgo`, date2: 'today' };
}

async function syncDailyStats(token) {
  const body = await metrikaFetch(token, '/stat/v1/data', {
    ids: COUNTER_ID,
    metrics: 'ym:s:visits,ym:s:users,ym:s:pageviews,ym:s:bounceRate,ym:s:pageDepth,ym:s:avgVisitDurationSeconds',
    dimensions: 'ym:s:date',
    sort: 'ym:s:date',
    limit: WINDOW_DAYS + 10,
    filters: ADMIN_EXCLUDE_FILTER_SESSION,
    ...windowDateParams(),
  });
  if (PRINT_JSON) console.log('daily-stats raw:', JSON.stringify(body, null, 2));

  const rows = (body.data ?? []).map((row) => {
    const [visits, users, pageviews, bounceRate, pageDepth, avgDuration] = row.metrics;
    return {
      date: row.dimensions[0].name,
      visits: Math.round(visits ?? 0),
      users: Math.round(users ?? 0),
      pageviews: Math.round(pageviews ?? 0),
      bounce_rate: bounceRate ?? null,
      page_depth: pageDepth ?? null,
      avg_duration_seconds: avgDuration ?? null,
      updated_at: new Date().toISOString(),
    };
  });
  console.log(`Визиты по дням: ${rows.length} строк.`);
  if (DRY_RUN || rows.length === 0) return;

  const { error } = await supabase.from('yandex_metrika_daily_stats').upsert(rows, { onConflict: 'date' });
  if (error) throw error;
}

// row.dimensions[0].name у ym:s:lastTrafficSource/ym:pv:URLPathFull должен
// быть уже готовым текстом (у trafficSource — локализованное имя вроде
// "Переходы из поисковых систем", у URLPathFull — сам путь) — так это
// исторически работает у Stats API, но живьём не проверено (домен закрыт
// прокси песочницы, см. журнал CLAUDE.md за 2026-09-10). Если после первого
// реального прогона в логе GitHub Actions (--json) окажется, что там id/код,
// а не читаемое имя — поправить на row.dimensions[0].id или завести словарь
// кодов здесь же, не трогая остальной скрипт.
async function syncTrafficSources(token) {
  const body = await metrikaFetch(token, '/stat/v1/data', {
    ids: COUNTER_ID,
    metrics: 'ym:s:visits,ym:s:users',
    dimensions: 'ym:s:lastTrafficSource',
    sort: '-ym:s:visits',
    limit: 30,
    filters: ADMIN_EXCLUDE_FILTER_SESSION,
    ...windowDateParams(),
  });
  if (PRINT_JSON) console.log('traffic-sources raw:', JSON.stringify(body, null, 2));

  const now = new Date().toISOString();
  const rows = (body.data ?? []).map((row) => ({
    source: row.dimensions[0].name,
    visits: Math.round(row.metrics[0] ?? 0),
    users: Math.round(row.metrics[1] ?? 0),
    window_days: WINDOW_DAYS,
    updated_at: now,
  }));
  console.log(`Источники трафика: ${rows.length} строк.`);
  if (DRY_RUN) return;

  const del = await supabase.from('yandex_metrika_traffic_sources').delete().gte('visits', 0);
  if (del.error) throw del.error;
  if (rows.length === 0) return;
  const { error } = await supabase.from('yandex_metrika_traffic_sources').insert(rows);
  if (error) throw error;
}

async function syncTopPages(token) {
  const body = await metrikaFetch(token, '/stat/v1/data', {
    ids: COUNTER_ID,
    metrics: 'ym:pv:pageviews,ym:pv:users',
    dimensions: 'ym:pv:URLPathFull',
    sort: '-ym:pv:pageviews',
    limit: 30,
    filters: ADMIN_EXCLUDE_FILTER_PAGEVIEW,
    ...windowDateParams(),
  });
  if (PRINT_JSON) console.log('top-pages raw:', JSON.stringify(body, null, 2));

  const now = new Date().toISOString();
  const rows = (body.data ?? []).map((row) => ({
    path: row.dimensions[0].name,
    pageviews: Math.round(row.metrics[0] ?? 0),
    users: Math.round(row.metrics[1] ?? 0),
    window_days: WINDOW_DAYS,
    updated_at: now,
  }));
  console.log(`Топ страниц: ${rows.length} строк.`);
  if (DRY_RUN) return;

  const del = await supabase.from('yandex_metrika_top_pages').delete().gte('pageviews', 0);
  if (del.error) throw del.error;
  if (rows.length === 0) return;
  const { error } = await supabase.from('yandex_metrika_top_pages').insert(rows);
  if (error) throw error;
}

async function syncGoalCompletions(token) {
  const goalId = await findGoalId(token);
  if (!goalId) return;

  const body = await metrikaFetch(token, '/stat/v1/data', {
    ids: COUNTER_ID,
    metrics: `ym:s:goal${goalId}reaches,ym:s:goal${goalId}conversionRate`,
    dimensions: 'ym:s:date',
    sort: 'ym:s:date',
    limit: WINDOW_DAYS + 10,
    filters: ADMIN_EXCLUDE_FILTER_SESSION,
    ...windowDateParams(),
  });
  if (PRINT_JSON) console.log('goal-completions raw:', JSON.stringify(body, null, 2));

  const now = new Date().toISOString();
  const rows = (body.data ?? []).map((row) => ({
    date: row.dimensions[0].name,
    goal_name: GOAL_IDENTIFIER,
    goal_id: String(goalId),
    reaches: Math.round(row.metrics[0] ?? 0),
    conversion_rate: row.metrics[1] ?? null,
    updated_at: now,
  }));
  console.log(`Достижения цели '${GOAL_IDENTIFIER}' (id ${goalId}): ${rows.length} строк.`);
  if (DRY_RUN || rows.length === 0) return;

  const { error } = await supabase
    .from('yandex_metrika_goal_completions')
    .upsert(rows, { onConflict: 'date,goal_name' });
  if (error) throw error;
}

async function debugAdminFilter(token) {
  const params = {
    ids: COUNTER_ID,
    metrics: 'ym:s:visits',
    dimensions: 'ym:s:date',
    sort: 'ym:s:date',
    limit: WINDOW_DAYS + 10,
    ...windowDateParams(),
  };

  const withoutFilter = await metrikaFetch(token, '/stat/v1/data', params);
  const withFilter = await metrikaFetch(token, '/stat/v1/data', {
    ...params,
    filters: ADMIN_EXCLUDE_FILTER_SESSION,
  });

  const sumVisits = (body) => (body.data ?? []).reduce((acc, row) => acc + (row.metrics[0] ?? 0), 0);
  const totalWithout = sumVisits(withoutFilter);
  const totalWith = sumVisits(withFilter);

  console.log(`Визиты БЕЗ фильтра (${WINDOW_DAYS} дней): ${totalWithout}`);
  console.log(`Визиты С фильтром "${ADMIN_EXCLUDE_FILTER_SESSION}" (${WINDOW_DAYS} дней): ${totalWith}`);
  console.log(
    totalWith === totalWithout
      ? 'ФИЛЬТР НЕ ДАЛ ЭФФЕКТА — либо синтаксис не поддержан API, либо реально нет ни одной сессии с /admin в окне.'
      : `Фильтр реально исключил ${totalWithout - totalWith} визитов.`,
  );
  if (PRINT_JSON) {
    console.log('without-filter raw:', JSON.stringify(withoutFilter, null, 2));
    console.log('with-filter raw:', JSON.stringify(withFilter, null, 2));
  }
}

async function main() {
  const token = await fetchYandexToken();

  if (DEBUG_FILTER) {
    await debugAdminFilter(token);
    return;
  }

  const sections = [
    ['визиты по дням', () => syncDailyStats(token)],
    ['источники трафика', () => syncTrafficSources(token)],
    ['топ страниц', () => syncTopPages(token)],
    ['достижения целей', () => syncGoalCompletions(token)],
  ];

  let failures = 0;
  for (const [label, run] of sections) {
    try {
      await run();
    } catch (err) {
      failures += 1;
      console.error(`Раздел «${label}» не синхронизировался:`, err.message ?? err);
    }
  }

  if (failures === sections.length) {
    // Ни один раздел не прошёл — скорее всего протух токен/сменились
    // права. Валим весь прогон явно, а не тихо оставляем пустые таблицы.
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
