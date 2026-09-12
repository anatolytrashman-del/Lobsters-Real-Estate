// Фоновая обработка очереди веб-поиска поставщиков (supplier_web_search_jobs).
//
// 2026-09-11 (вторая итерация конвейера): найденные компании больше НЕ ждут
// ручного добавления из модалки результатов — скрипт сам создаёт предложения
// и сам ставит их в очередь обогащения контактов (см.
// createOffersAndQueueEnrichment ниже). Полный путь, как его описал владелец:
// запустили поиск по категории → ИИ нашёл поставщиков → сразу добавил их в
// базу → скрипт обогащения (следующий шаг того же воркфлоу) собрал с их
// сайтов email для заказов/телефон/мессенджеры → поставщик получил статус
// "Готово к верификации" (считается в lib/supplierEnrichmentApi.ts).
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
// 2026-09-11, по реальным логам ProxyAPI (см. docs/session-journal.md):
// второй раунд запускался ВСЕГДА, если после первого меньше 40 — почти на
// каждом задании, даже когда первый раунд уже показал, что рынок узкий.
// Живой пример по "ceresit" (Россия/Москва — широкий рынок по словам
// владельца): раунд 1 сам нашёл 25 поставщиков, раунд 2 — ещё 26 (часть
// повторов), то есть оба раунда реально понадобились, чтобы дотянуть до ~40.
// Резать бюджет второго раунда в ЭТОМ случае означало бы не добрать до 40
// там, где владелец явно просит их гарантированно найти. Но для узких рынков
// (Беларусь, нишевые бренды — сам владелец: "в беларуси мы столько не
// найдем") первый раунд обычно находит намного меньше — если он нашёл совсем
// мало, вторая полноценная попытка (тот же ~97₽) почти наверняка не окупится,
// рынок просто исчерпан. Порог ниже — граница "похоже на узкий рынок, второй
// раунд вряд ли поможет", подобрана с запасом ниже реально наблюдавшихся 25
// у широкого рынка, чтобы не резать охват там, где он нужен.
const MIN_ROUND1_FOR_SECOND_ROUND = 10;

// Регион поиска (колонка country в supplier_web_search_jobs — историческое
// имя, см. src/lib/supplierWebSearchApi.ts). Держать в синхроне с
// supabase/functions/process-supplier-jobs/index.ts — это ручной запасной
// путь той же очереди.
const REGION_SEARCH_HINTS = {
  Беларусь: 'в Беларуси (если в пожеланиях не указан конкретный город — ищи прежде всего в Минске)',
  Россия: 'в России (если в пожеланиях не указан конкретный город — ищи прежде всего в Москве и других крупных городах)',
  Москва:
    'в Москве и Московской области — бери ТОЛЬКО компании, у которых есть офис, склад или шоурум в Москве или Подмосковье. Компании из других городов (Санкт-Петербург, Новосибирск, Екатеринбург, Казань, Пермь, Самара, Нижний Новгород и любые другие) НЕ ПОДХОДЯТ, даже если возят по всей России; региональные сайты федеральных сетей (поддомены spb., ekb., perm., nsk., kazan., samara. и подобные) — тоже, нужен московский сайт сети',
};
const DEFAULT_REGION = 'Беларусь';

// Детерминированная отсечка региональных поставщиков для московского поиска
// (модель хинт выше местами игнорирует) — см. тот же список в
// supabase/functions/process-supplier-jobs/index.ts.
const OTHER_CITY_WORDS = [
  'санкт-петербург', 'петербург', 'спб', 'новосибирск', 'екатеринбург', 'казань', 'пермь',
  'самара', 'нижний новгород', 'челябинск', 'ростов', 'краснодар', 'уфа', 'воронеж',
  'волгоград', 'красноярск', 'омск', 'тюмень', 'саратов', 'барнаул', 'иркутск',
  'владивосток', 'хабаровск', 'ярославль', 'тольятти', 'ижевск', 'ульяновск', 'кемерово',
  'сочи', 'калининград', 'оренбург', 'томск', 'астрахань', 'минск',
];
const OTHER_CITY_SUBDOMAIN =
  /^(spb|piter|nsk|novosib|novosibirsk|ekb|ekaterinburg|perm|kazan|kaz|samara|nn|nnv|nnov|nizhniy-novgorod|ufa|rostov|rnd|krd|krasnodar|chel|chelyabinsk|omsk|tmn|tyumen|vrn|voronezh|krsk|krasnoyarsk|saratov|irk|vlg|volgograd|kld|sochi|tula|tver)\./i;

function looksLikeOtherCity(r) {
  const name = (r.name || '').toLowerCase();
  if (OTHER_CITY_WORDS.some((c) => name.includes(c))) return true;
  const host = (r.website || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  return OTHER_CITY_SUBDOMAIN.test(host);
}

function buildSystemPrompt(region, excludeNames) {
  const hint = REGION_SEARCH_HINTS[region] || REGION_SEARCH_HINTS[DEFAULT_REGION];
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

function buildUserQuery(itemsText, sectionTitle, extra, region) {
  const parts = [];
  if (sectionTitle) parts.push(`Раздел: ${sectionTitle}.`);
  parts.push(`Материалы: ${itemsText}.`);
  if (extra) parts.push(`Дополнительные пожелания: ${extra}.`);
  const hint = REGION_SEARCH_HINTS[region] || REGION_SEARCH_HINTS[DEFAULT_REGION];
  parts.push(`Найди поставщиков этих материалов ${hint}, если пожелания не указывают иное.`);
  return parts.join(' ');
}

function extractJsonArray(content) {
  // Ответ приходит НЕСКОЛЬКИМИ текстовыми блоками (модель комментирует ход
  // поиска между вызовами web_search, массив пишет последним) — берём
  // последний фрагмент, который реально парсится как массив, а не "от первой
  // [ до последней ]" по склейке всех блоков: в комментариях тоже бывают
  // скобки, и склейка тогда не парсится вовсе.
  const texts = (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
  for (const text of [...texts].reverse()) {
    const stripped = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    for (let start = stripped.indexOf('['); start !== -1; start = stripped.indexOf('[', start + 1)) {
      const end = stripped.lastIndexOf(']');
      if (end <= start) break;
      try {
        const parsed = JSON.parse(stripped.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // не тот фрагмент — пробуем следующую открывающую скобку
      }
    }
  }
  throw new Error('Модель не вернула список поставщиков в ожидаемом формате');
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

function sanitizeResults(raw, excludeKeys, region) {
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
  const moscowOnly = region === 'Москва' ? cleaned.filter((r) => !looksLikeOtherCity(r)) : cleaned;
  const deduped = dedupeResults(moscowOnly);
  const filtered = excludeKeys && excludeKeys.size ? deduped.filter((r) => !excludeKeys.has(dedupKey(r))) : deduped;
  return filtered.slice(0, MAX_RESULTS);
}

async function fetchWebSearchResults(region, itemsText, sectionTitle, extra, excludeNames) {
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
      system: buildSystemPrompt(region, excludeNames),
      messages: [{ role: 'user', content: buildUserQuery(itemsText, sectionTitle, extra, region) }],
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
  const region = job.country && REGION_SEARCH_HINTS[job.country] ? job.country : DEFAULT_REGION;

  const round1Raw = await fetchWebSearchResults(region, job.items_text, job.section_title, job.extra, excludeNames);
  const round1 = sanitizeResults(round1Raw, excludeKeys, region);
  console.log(`    раунд 1: найдено ${round1.length} поставщиков`);

  let combined = round1;
  if (round1.length >= MAX_RESULTS) {
    console.log('    второй раунд не нужен — уже набрали лимит');
  } else if (round1.length < MIN_ROUND1_FOR_SECOND_ROUND) {
    console.log(
      `    второй раунд пропущен — раунд 1 нашёл всего ${round1.length} ` +
        `(< ${MIN_ROUND1_FOR_SECOND_ROUND}), похоже на узкий рынок, вторая полная попытка вряд ли окупится`
    );
  } else {
    const round2ExcludeNames = [...excludeNames, ...round1.map((r) => r.name || r.website).filter(Boolean)];
    const round2Raw = await fetchWebSearchResults(region, job.items_text, job.section_title, job.extra, round2ExcludeNames);
    combined = sanitizeResults([...round1, ...round2Raw], excludeKeys, region);
    console.log(`    раунд 2: итого после объединения и дедупа — ${combined.length} поставщиков`);
  }
  return combined;
}

async function updateJob(id, patch) {
  if (DRY_RUN) return;
  const { error } = await supabase.from('supplier_web_search_jobs').update(patch).eq('id', id);
  if (error) console.error(`  → не удалось обновить задание ${id}:`, error.message);
}

// Та же грубая эвристика, что и guessCountryFromWebsite в
// src/data/supplierResearch.ts (продублирована по той же причине, что и
// остальная логика этого скрипта — голому .mjs нельзя импортировать код
// фронта). Пустая строка — не определили, поле останется пустым.
function guessCountryFromWebsite(websiteUrl) {
  const trimmed = (websiteUrl || '').trim();
  if (!trimmed) return '';
  const host = trimmed
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  if (host.endsWith('.by')) return 'Беларусь';
  if (host.endsWith('.ru')) return 'Россия';
  return '';
}

// Владелец, 2026-09-11: "мне не нужна кнопка обогащения. Хочу так: запустили
// поиск по категории → ИИ нашёл поставщиков → сразу добавил их в базу (без
// текущего ручного добавления) → скрипт обогащения сразу берёт их в работу
// → когда вся инфа собрана, поставщик получает статус «Готово к
// верификации»". Раньше найденное складывалось только в results задания, а
// предложения создавал человек руками из модалки результатов
// (addWebSearchResults в Suppliers.tsx, удалён вместе с самой модалкой) —
// теперь это делает сам скрипт, сразу после поиска.
//
// Дубли: модели и так передаётся список уже известных компаний
// (exclude_companies), но полагаться только на это нельзя — здесь ещё и
// прямая проверка по уже существующим предложениям этой же категории
// (тот же dedupKey: нормализованный домен, а при его отсутствии имя).
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

// Один запрос "жив ли адрес": нужен только статус и то, разрешилось ли имя
// домена. Бот-защита (403/503) мёртвым сайтом НЕ считается — там контакты
// добираются веб-поиском.
async function probeUrl(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const resp = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        signal: AbortSignal.timeout(10000),
      });
      try {
        await resp.body?.cancel();
      } catch {
        // тело уже закрыто — неважно
      }
      if (resp.status === 405 && method === 'HEAD') continue; // сайт не умеет HEAD
      return { status: resp.status, dnsFailed: false };
    } catch (err) {
      const message = `${err?.cause?.code ?? ''} ${err}`.toLowerCase();
      const dnsFailed =
        message.includes('enotfound') || message.includes('eai_again') || message.includes('dns');
      return { status: null, dnsFailed };
    }
  }
  return { status: null, dnsFailed: false };
}

// Домен снят с делегирования — каталоги (2ГИС, Яндекс, OrgPage) годами держат
// карточку закрывшейся компании с "рабочей" почтой (m-delivery.ru, 2026-09-11).
async function siteIsDead(website) {
  const host = website.replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (!host || !host.includes('.')) return true;
  const first = await probeUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  if (!first.dnsFailed) return false;
  // A-запись бывает только у www — проверяем и её, прежде чем хоронить домен.
  const second = await probeUrl(`https://${host.startsWith('www.') ? host : `www.${host}`}`);
  return second.dnsFailed;
}

// Ссылку на позицию модель нередко конструирует по виду каталога, и она ведёт
// в 404 (emarty.ru/catalog/tile/brands/4-Alma-Ceramica, 2026-09-11). Пустая
// ссылка честнее битой: закупщик откроет сайт и найдёт позицию сам.
async function listingIsMissing(link) {
  const { status } = await probeUrl(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  return status === 404 || status === 410;
}

async function createOffersAndQueueEnrichment(job, results) {
  if (DRY_RUN || results.length === 0) return 0;

  const { data: existing, error: existingError } = await supabase
    .from('supplier_research_offers')
    .select('name, website_url')
    .eq('request_id', job.request_id);
  if (existingError) {
    console.error('  → не удалось прочитать уже существующие предложения:', existingError.message);
    return 0;
  }
  const existingKeys = new Set((existing ?? []).map((o) => dedupKey({ name: o.name, website: o.website_url })));
  const candidates = results
    .filter((r) => !existingKeys.has(dedupKey(r)))
    // Карточка без сайта, телефона и почты закупщице бесполезна: писать
    // некуда, дособирать не из чего (кейс «Артикера», 2026-09-11).
    .filter((r) => r.website || r.phone || r.email);
  if (candidates.length === 0) return 0;

  // Мёртвый домен — компании больше нет, такую запись не заводим вовсе
  // ("неактивные сайты надо удалять из списка ещё на этапе поиска",
  // владелец 2026-09-11); битую ссылку на позицию просто не сохраняем.
  const fresh = (
    await Promise.all(
      candidates.map(async (r) => {
        if (r.website && (await siteIsDead(r.website))) return null;
        const link = r.link && (await listingIsMissing(r.link)) ? '' : r.link;
        return { ...r, link };
      }),
    )
  ).filter(Boolean);
  if (fresh.length === 0) return 0;

  const { data: created, error: insertError } = await supabase
    .from('supplier_research_offers')
    .insert(
      fresh.map((r) => ({
        request_id: job.request_id,
        name: r.name,
        contact: r.phone,
        contact_method: 'Телефон',
        email: r.email,
        manager_name: '',
        country: guessCountryFromWebsite(r.website),
        website_url: r.website,
        listing_url: r.link,
        messengers: [],
        catalog_model_name: '',
        catalog_model_photo: null,
        price: 0,
        currency: 'USD',
        items: [],
        files: [],
        // Автодобавленный поставщик всегда не верифицирован — человек
        // проверяет его уже после того, как обогащение соберёт контакты
        // (статус "Готово к верификации", см. lib/supplierEnrichmentApi.ts).
        verified: false,
      })),
    )
    .select('id, website_url');
  if (insertError) {
    console.error('  → не удалось добавить предложения:', insertError.message);
    return 0;
  }

  // Обогащаем всех, включая записи без сайта: контакты ищутся и по названию.
  if ((created ?? []).length > 0) {
    const { error: jobsError } = await supabase
      .from('supplier_enrichment_jobs')
      .insert((created ?? []).map((o) => ({ offer_id: o.id })));
    if (jobsError) console.error('  → не удалось поставить обогащение в очередь:', jobsError.message);
  }
  console.log(`  → добавлено предложений: ${created?.length ?? 0}, все поставлены в очередь на обогащение`);
  return created?.length ?? 0;
}

async function processJob(job) {
  const label = `${job.section_title || '(без раздела)'} — ${job.items_text.slice(0, 60)}`;
  console.log(`Обрабатываю задание ${job.id} (${label})...`);
  await updateJob(job.id, { status: 'processing' });
  try {
    const results = await runSearchRounds(job);
    const addedCount = await createOffersAndQueueEnrichment(job, results);
    await updateJob(job.id, {
      status: 'done',
      results,
      added_count: addedCount,
      completed_at: new Date().toISOString(),
    });
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
