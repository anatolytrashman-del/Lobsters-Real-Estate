// Фоновая обработка очереди веб-поиска поставщиков (supplier_web_search_jobs).
//
// Владелец, 2026-09-11: "минуту ждать перед открытой вкладкой не захочется,
// поэтому я бы сделал так: я или Альмира формирует поиск, система начинает
// искать, я могу закрыть спокойно вкладку, когда система найдёт — по
// аналогии с письмами появится уведомление, отправляй его и в колокольчик".
// Раньше веб-поиск (api/supplier-web-search.js) был синхронным HTTP-
// запросом прямо из открытой модалки — один клик держал вкладку 40-115с на
// раунд (см. историю MAX_SEARCHES ниже). Теперь клиент только СТАВИТ
// задание в очередь (INSERT в supplier_web_search_jobs, обычная
// authenticated-запись — RLS уже разрешает, отдельный serverless endpoint
// под это не заводили, Hobby-план и так на пределе 12 функций), а этот
// скрипт (запускается по расписанию — .github/workflows/process-supplier-
// web-search-jobs.yml, раз в 5 минут — и мгновенно через workflow_dispatch
// сразу после постановки в очередь, api/trigger-rebuild.js:
// action='dispatch-supplier-search') реально выполняет поиск и пишет
// результат в ту же строку. Тот же принцип, что и у массовой рассылки писем
// (bulk_send_jobs/process-bulk-send-jobs.mjs).
//
// Логика самого поиска (промт, два раунда, дедуп) — ПРОДУБЛИРОВАНА из
// api/supplier-web-search.js (тот же принцип, что и у process-bulk-send-
// jobs.mjs/sync-citywide-*.mjs: голому .mjs-скрипту нельзя импортировать
// код Vercel serverless-функции напрямую, проще продублировать небольшую
// логику, чем городить общий модуль между api/*.js и обычными .mjs-
// скриптами). Сам HTTP-эндпоинт больше НЕ обрабатывает поиск синхронно —
// оставлен только для action:'recognize-invoice' (не связано с этой темой).
//
// 2026-09-11, живой диагностический прогон (см. комментарий в
// api/supplier-web-search.js): модель сама останавливается на 15-22
// поисках независимо от разрешённого лимита (max_uses) — раздутие
// MAX_SEARCHES 20→30 не помогло само по себе. Вместо попытки уговорить
// модель искать больше за один раз — делаем ВТОРОЙ раунд автоматически
// (доисключая то, что нашёл первый), это и даёт реальное приближение к
// MAX_RESULTS для широких категорий, ценой примерно вдвое большего времени
// на одно задание (владелец подтвердил компромисс явно).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROXYAPI_KEY = process.env.PROXYAPI_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DRY_RUN) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
    process.exit(1);
  }
  if (!PROXYAPI_KEY) {
    console.error('Не задана переменная окружения PROXYAPI_KEY (или запусти с --dry-run)');
    process.exit(1);
  }
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MODEL = 'claude-haiku-4-5-20251001';
// 2026-09-11: было 30 — по данным CLAUDE.md модель и так сама останавливается
// на 15-22 поисках независимо от разрешённого лимита (см. запись про диагностику
// MAX_SEARCHES 20→30 не помогавшую), 30 никогда реально не использовалось —
// снижено до 20 (верхняя граница уже наблюдавшегося саморегулирования модели),
// поведение не меняется, просто убран неиспользуемый запас на теоретический
// худший случай (влияет на цену только если модель когда-нибудь решит искать
// больше 20 раз — сейчас такого не наблюдалось).
const MAX_SEARCHES = 20;
const MAX_RESULTS = 40;
const COUNTRY_SEARCH_HINTS = {
  Беларусь: 'в Беларуси (если в пожеланиях не указан конкретный город — ищи прежде всего в Минске)',
  Россия: 'в России (если в пожеланиях не указан конкретный город — ищи прежде всего в Москве и других крупных городах)',
};
const DEFAULT_COUNTRY = 'Беларусь';

function buildSystemPrompt(country, excludeNames) {
  const hint = COUNTRY_SEARCH_HINTS[country] || COUNTRY_SEARCH_HINTS[DEFAULT_COUNTRY];
  const excludeBlock = excludeNames.length
    ? `\n\nЭТИ КОМПАНИИ УЖЕ НАЙДЕНЫ РАНЕЕ ПО ЭТОМУ ЖЕ ЗАПРОСУ — НЕ ВКЛЮЧАЙ ИХ СНОВА,
ищи ДРУГИХ, ещё не упомянутых поставщиков:
${excludeNames.map((n) => `- ${n}`).join('\n')}`
    : '';
  return `Ты помогаешь найти реальных поставщиков строительных материалов ${hint}
через веб-поиск для девелоперской компании. Если в "Дополнительные пожелания"
указан другой город, регион или страна — ищи именно там, это имеет приоритет
над регионом по умолчанию.
Ищи ОСНОВАТЕЛЬНО и ШИРОКО — используй инструмент web_search до ${MAX_SEARCHES} раз,
разными запросами, чтобы найти МАКСИМУМ реальных компаний-поставщиков —
стремись к ${MAX_RESULTS}, если реально столько существует и находится.
Обязательно комбинируй два вида запросов:
1. Обычные веб-поисковые запросы (как в Google) — конкретные позиции по
   отдельности, синонимы, категории, названия компаний, международные
   каталоги и маркетплейсы.
2. Запросы, нацеленные на источники, которые лучше всего проиндексированы
   именно Яндексом — Яндекс.Маркет, Яндекс.Карты/2ГИС (организации),
   TIU.ru, Deal.by, Prom.by, Avito и подобные региональные агрегаторы.
Не возвращай одну и ту же компанию дважды (даже если нашёл её и в
обычном, и в "яндексовом" запросе) — каждая компания в ответе только один раз.${excludeBlock}

Для каждой найденной компании собери:
- сайт (website) — адрес сайта компании;
- ссылку на позицию (link) — ПРЯМУЮ ссылку на страницу конкретного товара,
  позиции или раздела каталога с искомым материалом на сайте этой компании
  ИЛИ на странице объявления/карточки товара на маркетплейсе/агрегаторе, если
  такая ссылка реально встретилась в результатах поиска. Это НЕ то же самое,
  что website — website может быть главной страницей сайта, а link должен
  вести туда, где реально видно нужный товар, чтобы не пришлось искать его
  на сайте вручную. Если такой конкретной ссылки в поиске не нашлось — оставь
  пустую строку, не подставляй туда просто адрес сайта и не выдумывай урл;
- телефон и/или email, если реально нашёл.
Не выдумывай компании, контакты и ссылки ради количества — бери только то,
что действительно нашёл в поиске, для неизвестного поля оставляй пустую
строку. Лучше меньше, но реальных, чем ровно ${MAX_RESULTS} с придуманными.

После поиска верни ОТВЕТ ЦЕЛИКОМ в виде JSON-массива, без markdown-разметки,
без пояснений до или после, без \`\`\` — строго формат:
[{"name": "...", "website": "...", "link": "...", "phone": "...", "email": "...", "note": "..."}]

"note" — одна короткая фраза по-русски: что продают/чем подходят под запрос.
Если ничего подходящего не нашёл — верни пустой массив [].`;
}

function buildUserQuery(itemsText, sectionTitle, extra, country) {
  const parts = [];
  if (sectionTitle) parts.push(`Раздел: ${sectionTitle}.`);
  parts.push(`Материалы: ${itemsText}.`);
  if (extra) parts.push(`Дополнительные пожелания: ${extra}.`);
  const hint = COUNTRY_SEARCH_HINTS[country] || COUNTRY_SEARCH_HINTS[DEFAULT_COUNTRY];
  parts.push(`Найди поставщиков этих материалов ${hint}, если пожелания не указывают иное.`);
  return parts.join(' ');
}

function extractJsonArray(content) {
  const text = (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Модель не вернула список поставщиков в ожидаемом формате');
  }
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Модель вернула не массив');
  return parsed;
}

function dedupKey(r) {
  const site = (r.website || '').trim().toLowerCase();
  if (site) {
    return site
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
      .split(/[/?#]/)[0];
  }
  return (r.name || '').trim().toLowerCase();
}

function dedupeResults(list) {
  const seen = new Set();
  const result = [];
  for (const r of list) {
    const key = dedupKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

function sanitizeResults(raw, excludeKeys) {
  const cleaned = raw
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      website: typeof r.website === 'string' ? r.website.trim() : '',
      link: typeof r.link === 'string' ? r.link.trim() : '',
      phone: typeof r.phone === 'string' ? r.phone.trim() : '',
      email: typeof r.email === 'string' ? r.email.trim() : '',
      note: typeof r.note === 'string' ? r.note.trim() : '',
    }));
  const deduped = dedupeResults(cleaned);
  const filtered = excludeKeys && excludeKeys.size ? deduped.filter((r) => !excludeKeys.has(dedupKey(r))) : deduped;
  return filtered.slice(0, MAX_RESULTS);
}

async function fetchWebSearchResults(country, itemsText, sectionTitle, extra, excludeNames) {
  const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': PROXYAPI_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 10000,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, allowed_callers: ['direct'] }],
      system: buildSystemPrompt(country, excludeNames),
      messages: [{ role: 'user', content: buildUserQuery(itemsText, sectionTitle, extra, country) }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 402) {
      throw new Error('Недостаточно средств на балансе ProxyAPI — пополните счёт в личном кабинете ProxyAPI.');
    }
    throw new Error(`Ошибка веб-поиска (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  // 2026-09-11: владелец пожаловался на дороговизну одного запроса (340 ₽
  // за задание с 39 результатами) — раньше это никак не логировалось, любая
  // диагностика стоимости была бы гаданием. web_search берёт $10 за 1000
  // поисков ПЛЮС обычную цену токенов за контент результатов, а этот контент
  // (по документации Anthropic) пересылается и тарифицируется заново на
  // каждом внутреннем раунде поиска в пределах одного вызова — раздел
  // "Server tools"/"Web search tool" явно говорит, что весь server-side
  // agentic loop идёт ВНУТРИ одного HTTP-запроса, без доступа разработчика
  // к промежуточным ходам, поэтому явный cache_control тут не расставить —
  // кэшировать нечего, кроме статичной части system-промпта между раундом 1
  // и раундом 2 (эффект небольшой на фоне растущего контекста самого поиска).
  // Теперь usage/число поисков логируется в консоль (виден в логах GitHub
  // Actions через get_job_logs) — при следующей жалобе на цену будут точные
  // цифры, а не оценка по документации.
  const usage = data.usage || {};
  const searchCount = usage.server_tool_use?.web_search_requests ?? '?';
  console.log(
    `    usage: input=${usage.input_tokens ?? '?'} output=${usage.output_tokens ?? '?'} ` +
      `cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0} ` +
      `web_search_requests=${searchCount}`
  );
  return extractJsonArray(data.content);
}

async function runSearchRounds(job) {
  const excludeList = Array.isArray(job.exclude_companies) ? job.exclude_companies : [];
  const excludeKeys = new Set(excludeList.map((r) => dedupKey(r)));
  const excludeNames = excludeList.map((r) => r.name || r.website).filter(Boolean);
  const country = job.country && COUNTRY_SEARCH_HINTS[job.country] ? job.country : DEFAULT_COUNTRY;

  const round1Raw = await fetchWebSearchResults(country, job.items_text, job.section_title, job.extra, excludeNames);
  const round1 = sanitizeResults(round1Raw, excludeKeys);

  let combined = round1;
  if (round1.length < MAX_RESULTS) {
    const round2ExcludeNames = [...excludeNames, ...round1.map((r) => r.name || r.website).filter(Boolean)];
    const round2Raw = await fetchWebSearchResults(country, job.items_text, job.section_title, job.extra, round2ExcludeNames);
    combined = sanitizeResults([...round1, ...round2Raw], excludeKeys);
  }
  return combined;
}

async function updateJob(id, patch) {
  if (DRY_RUN) return;
  const { error } = await supabase.from('supplier_web_search_jobs').update(patch).eq('id', id);
  if (error) console.error(`  → не удалось обновить задание ${id}:`, error.message);
}

async function processJob(job) {
  const label = `${job.section_title || '(без раздела)'} — ${job.items_text.slice(0, 60)}`;
  console.log(`Обрабатываю задание ${job.id} (${label})...`);
  await updateJob(job.id, { status: 'processing' });
  try {
    const results = await runSearchRounds(job);
    await updateJob(job.id, { status: 'done', results, completed_at: new Date().toISOString() });
    console.log(`  → готово, найдено ${results.length} компаний`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось выполнить веб-поиск поставщиков';
    console.error(`  → ошибка: ${message}`);
    await updateJob(job.id, { status: 'error', error: message, completed_at: new Date().toISOString() });
  }
}

async function main() {
  if (DRY_RUN) {
    console.log('--dry-run: обрабатываю одно фиктивное задание без чтения из базы и без записи результата.');
    await processJob({
      id: 'dry-run',
      items_text: 'керамогранит',
      section_title: 'Фасад',
      extra: '',
      country: 'Беларусь',
      exclude_companies: [],
    });
    return;
  }
  const { data: jobs, error } = await supabase
    .from('supplier_web_search_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Не удалось прочитать очередь:', error.message);
    process.exit(1);
  }
  if (!jobs || jobs.length === 0) {
    console.log('Очередь пуста.');
    return;
  }
  console.log(`В очереди ${jobs.length} задани${jobs.length === 1 ? 'е' : jobs.length < 5 ? 'я' : 'й'}.`);
  for (const job of jobs) {
    await processJob(job);
  }
}

await main();
