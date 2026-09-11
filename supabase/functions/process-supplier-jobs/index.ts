// Разбор очередей поставщиков БЕЗ GitHub Actions — Supabase Edge Function.
//
// Зачем: 2026-09-11 GitHub перестал выдавать раннеры этому аккаунту (все
// воркфлоу висели в queued, плановые запуски по крону вообще не создавались,
// при зелёном статусе githubstatus.com). Пока это так, обе фоновые очереди —
// веб-поиск поставщиков (supplier_web_search_jobs) и обогащение контактов
// (supplier_enrichment_jobs) — не разбираются вовсе, и в админке висит вечное
// "Ищем поставщиков в сети". Владелец: "давай найдём причину ошибки в гитхабе
// и если там фигня, сделаем поиск в админке альтернативно".
//
// Эта функция делает ту же работу, что scripts/process-supplier-*-jobs.mjs, но
// внутри Supabase: её раз в минуту дёргает pg_cron через pg_net (см. миграцию
// в journal), поэтому от GitHub не зависит ничего. Скрипты в scripts/ НЕ
// удалены — когда GitHub оживёт, оба пути делают одно и то же и не мешают друг
// другу: задание берётся атомарно (UPDATE ... WHERE status='pending'
// RETURNING), поэтому один и тот же поставщик не обработается дважды.
//
// Ограничения рантайма (free-план: ~150с wall-clock на вызов) диктуют размер
// порции: несколько заданий обогащения параллельно ИЛИ один раунд поиска за
// вызов. Поиск из-за этого разбит на раунды: каждый вызов делает один раунд,
// сразу создаёт найденных поставщиков предложениями и ставит их на обогащение,
// а при rounds_done < MAX_ROUNDS возвращает задание в очередь — следующий
// вызов доищет остальных, исключив уже добавленных.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PROXYAPI_KEY = Deno.env.get('PROXYAPI_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const MODEL = 'claude-haiku-4-5-20251001';
// Сколько заданий обогащения берём за один вызов. Задание — это почти
// целиком ожидание сети, поэтому они идут параллельно; ограничение сверху —
// wall-clock рантайма, а не процессор.
const ENRICHMENT_BATCH = 4;
const MAX_FETCHES = 3;
const MAX_SEARCHES = 30;
const MAX_RESULTS = 40;
const MAX_ROUNDS = 2;
const MESSENGER_TYPES = ['Telegram', 'WhatsApp', 'Max'];
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

interface EnrichmentResult {
  orderEmail: string;
  phone: string;
  messengers: { type: string; number: string }[];
  note: string;
  siteAccessible: boolean;
}

const ENRICHMENT_PROMPT = `Ты собираешь контактные данные поставщика для закупщика строительной компании.
Тебе дан сайт компании. Зайди на главную страницу и, если нужно, на страницу
Контакты через инструмент web_fetch (до ${MAX_FETCHES} вызовов). Найди:
1) email для оформления заказов (часто order@/zakaz@/zakupki@/sales@,
   отличается от общего info@; если несколько офисов — бери московский);
2) основной телефон;
3) номера в мессенджерах Telegram/WhatsApp/Max, ЕСЛИ явно указан сам номер.

Верни СТРОГО JSON без markdown и пояснений:
{"orderEmail":"","phone":"","messengers":[{"type":"Telegram","number":""}],"note":"","siteAccessible":true}

"messengers" — массив, type строго одно из "Telegram"/"WhatsApp"/"Max".
"note" — одна короткая фраза по-русски, что нашёл/не нашёл.
"siteAccessible" — false, если сайт не открылся вообще.
Если поле не нашёл — пустая строка/пустой массив, НЕ выдумывай контакты.`;

// Первый ПОЛНЫЙ JSON-объект по глубине скобок: модель иногда возвращает два
// блока подряд, и "от первой { до последней }" склеивало их в невалидный JSON.
function extractJson(content: unknown): Record<string, unknown> {
  const blocks = Array.isArray(content) ? content : [];
  const text = blocks
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('');
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = stripped.indexOf('{');
  if (start === -1) throw new Error('модель не вернула JSON');
  let depth = 0;
  for (let i = start; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) return JSON.parse(stripped.slice(start, i + 1));
    }
  }
  throw new Error('не нашли закрывающую скобку JSON');
}

function extractJsonArray(content: unknown): Record<string, string>[] {
  const blocks = Array.isArray(content) ? content : [];
  // Ответ приходит НЕСКОЛЬКИМИ текстовыми блоками: модель комментирует ход
  // поиска между вызовами web_search, а сам массив пишет последним блоком.
  // Поэтому ищем не "от первой [ до последней ]" по склейке (в комментариях
  // тоже бывают скобки), а последний фрагмент, который реально парсится как
  // массив объектов.
  const texts = blocks
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text as string);
  for (const text of [...texts].reverse()) {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
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
  throw new Error('модель не вернула массив');
}

function sanitizeEnrichment(raw: Record<string, any>): EnrichmentResult {
  const messengers = Array.isArray(raw.messengers)
    ? raw.messengers
        .filter((m: any) => m && MESSENGER_TYPES.includes(m.type) && typeof m.number === 'string' && m.number.trim())
        .map((m: any) => ({ type: m.type, number: m.number.trim() }))
    : [];
  return {
    orderEmail: typeof raw.orderEmail === 'string' ? raw.orderEmail.trim() : '',
    phone: typeof raw.phone === 'string' ? raw.phone.trim() : '',
    messengers,
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    siteAccessible: raw.siteAccessible !== false,
  };
}

async function askProxyApi(body: Record<string, unknown>, retried = false): Promise<unknown> {
  const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': PROXYAPI_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 402) throw new Error('Недостаточно средств на балансе ProxyAPI');
    if (resp.status === 429 && !retried) {
      await new Promise((r) => setTimeout(r, 10000));
      return askProxyApi(body, true);
    }
    throw new Error(`ProxyAPI ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()).content;
}

// ——— Обогащение ————————————————————————————————————————————————————
// Та же цепочка, что в scripts/process-supplier-enrichment-jobs.mjs, но без
// шага "повтор без проверки сертификата": в Deno-рантайме Supabase отключить
// проверку TLS нельзя (это флаг процесса), поэтому сайты с битым сертификатом
// добираются веб-поиском — он и так последний в цепочке.
async function enrichViaWebFetch(name: string, website: string): Promise<EnrichmentResult> {
  const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const content = await askProxyApi({
    model: MODEL,
    max_tokens: 4000,
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: MAX_FETCHES, allowed_callers: ['direct'] }],
    system: ENRICHMENT_PROMPT,
    messages: [{ role: 'user', content: `Сайт поставщика: ${url} (компания «${name}»).` }],
  });
  return sanitizeEnrichment(extractJson(content));
}

function htmlToText(html: string): string {
  const links = [...html.matchAll(/(?:mailto|tel):([^"'\s>]+)/gi)].map((m) => m[0]);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const linksBlock = links.length ? `Ссылки-контакты со страницы: ${[...new Set(links)].join(', ')}\n\n` : '';
  return `${linksBlock}${text}`.slice(0, 15000);
}

async function enrichViaDirectFetch(name: string, website: string): Promise<EnrichmentResult> {
  const base = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const pages: string[] = [];
  for (const path of ['', '/contacts', '/kontakty', '/contact']) {
    if (pages.length >= 2) break;
    try {
      const resp = await fetch(new URL(path, base).toString(), {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) continue;
      const text = htmlToText(await resp.text());
      if (text.length > 200) pages.push(text);
    } catch {
      // страницы может не быть или домен закрыт — пробуем следующую
    }
  }
  if (pages.length === 0) throw new Error('страницы не открылись напрямую');
  const content = await askProxyApi({
    model: MODEL,
    max_tokens: 2000,
    system: `${ENRICHMENT_PROMPT}\n\nВАЖНО: инструментов нет, страницы уже скачаны и приведены к тексту — работай только с присланным, не выдумывай.`,
    messages: [{ role: 'user', content: `Компания «${name}», сайт ${base}. Текст страниц:\n\n${pages.join('\n\n---\n\n')}` }],
  });
  return sanitizeEnrichment(extractJson(content));
}

async function enrichViaSearch(name: string, website: string): Promise<EnrichmentResult> {
  const content = await askProxyApi({
    model: MODEL,
    max_tokens: 3000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] }],
    system: `Ты собираешь контактные данные поставщика. Сайт компании НЕДОСТУПЕН для
прямого просмотра (бот-защита, гео-блокировка, битый сертификат), поэтому ищи
контакты веб-поиском: Яндекс.Карты/2ГИС, каталоги (Rusprofile, Zoon, Tiu, Prom),
объявления. Нужны: email для заказов, основной телефон (московский, если офисов
несколько), номера Telegram/WhatsApp/Max — только если указан сам номер.
Бери только то, что относится именно к ЭТОЙ компании с ЭТИМ сайтом.

Верни СТРОГО JSON без markdown:
{"orderEmail":"","phone":"","messengers":[{"type":"Telegram","number":""}],"note":"","siteAccessible":false}
"note" — одной фразой, откуда взяты контакты.`,
    messages: [{ role: 'user', content: `Компания «${name}», сайт ${website}. Найди её контакты.` }],
  });
  return sanitizeEnrichment(extractJson(content));
}

function merge(base: EnrichmentResult, extra: EnrichmentResult): EnrichmentResult {
  const types = new Set(base.messengers.map((m) => m.type));
  return {
    orderEmail: base.orderEmail || extra.orderEmail,
    phone: base.phone || extra.phone,
    messengers: [...base.messengers, ...extra.messengers.filter((m) => !types.has(m.type))],
    note: [base.note, extra.note].filter(Boolean).join(' '),
    siteAccessible: base.siteAccessible || extra.siteAccessible,
  };
}

const hasContacts = (r: EnrichmentResult) => Boolean(r.orderEmail || r.phone);

async function processEnrichmentJob(job: any): Promise<void> {
  const offer = job.supplier_research_offers;
  if (!offer) {
    await supabase
      .from('supplier_enrichment_jobs')
      .update({ status: 'error', error: 'Предложение удалено', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }
  if (!offer.website_url) {
    await supabase
      .from('supplier_enrichment_jobs')
      .update({ status: 'error', error: 'У поставщика не указан сайт', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }

  let result: EnrichmentResult = { orderEmail: '', phone: '', messengers: [], note: '', siteAccessible: false };
  let source = '';
  const attempts: [string, () => Promise<EnrichmentResult>][] = [
    ['сайт', () => enrichViaWebFetch(offer.name, offer.website_url)],
    ['прямой просмотр сайта', () => enrichViaDirectFetch(offer.name, offer.website_url)],
    ['веб-поиск (сайт напрямую не открылся)', () => enrichViaSearch(offer.name, offer.website_url)],
  ];
  for (const [label, attempt] of attempts) {
    if (hasContacts(result)) break;
    try {
      result = merge(result, await attempt());
      if (hasContacts(result)) source = label;
    } catch (err) {
      console.error(`  ${offer.name}: ${label} не сработал — ${err instanceof Error ? err.message : err}`);
    }
  }
  if (source) result.note = `Источник: ${source}. ${result.note}`.trim();

  // Применяем только в пустые поля — по свежему состоянию строки, чтобы не
  // затереть правку, сделанную человеком, пока шёл сбор.
  const { data: fresh } = await supabase
    .from('supplier_research_offers')
    .select('email, contact, messengers')
    .eq('id', job.offer_id)
    .single();
  if (fresh) {
    const patch: Record<string, unknown> = {};
    if (!fresh.email && result.orderEmail) patch.email = result.orderEmail;
    if (!fresh.contact && result.phone) {
      patch.contact = result.phone;
      patch.contact_method = 'Телефон';
    }
    const existing = Array.isArray(fresh.messengers) ? fresh.messengers : [];
    const existingTypes = new Set(existing.map((m: any) => m.type));
    const added = result.messengers.filter((m) => !existingTypes.has(m.type));
    if (added.length > 0) patch.messengers = [...existing, ...added];
    if (Object.keys(patch).length > 0) {
      await supabase.from('supplier_research_offers').update(patch).eq('id', job.offer_id);
    }
  }

  await supabase
    .from('supplier_enrichment_jobs')
    .update({ status: 'done', result, completed_at: new Date().toISOString() })
    .eq('id', job.id);
}

// ——— Поиск поставщиков ————————————————————————————————————————————
// Регион поиска (колонка country в supplier_web_search_jobs — историческое
// имя, см. комментарий в src/lib/supplierWebSearchApi.ts). Владелец,
// 2026-09-11: "по грильято подтянулось много поставщиков из других городов...
// ставь регион не Россия, а именно Москва" — объекты компании в Москве и
// Подмосковье, поставщик из Новосибирска бесполезен, поэтому у Москвы
// отдельный жёсткий хинт, а не мягкое "прежде всего в Москве".
const REGION_HINTS: Record<string, string> = {
  Беларусь: 'в Беларуси (если город не указан — прежде всего в Минске)',
  Россия: 'в России (если город не указан — прежде всего в Москве и других крупных городах)',
  Москва:
    'в Москве и Московской области. Бери ТОЛЬКО компании, у которых есть офис, склад или шоурум в Москве или Подмосковье. Компании из других городов (Санкт-Петербург, Новосибирск, Екатеринбург, Казань, Пермь, Самара, Нижний Новгород и любые другие) НЕ ПОДХОДЯТ, даже если они возят по всей России. Региональные сайты федеральных сетей (поддомены spb., ekb., perm., nsk., kazan., samara. и подобные) тоже не бери — нужен московский сайт сети',
};

// Города, чьи поставщики не подходят московскому поиску. Модель хинт выше
// местами игнорирует (первая же выдача по грильято принесла полтора десятка
// региональных филиалов), поэтому к промту добавлена ещё и детерминированная
// отсечка по названию и домену — дешевле, чем потом чистить базу руками.
const OTHER_CITY_WORDS = [
  'санкт-петербург', 'петербург', 'спб', 'новосибирск', 'екатеринбург', 'казань', 'пермь',
  'самара', 'нижний новгород', 'челябинск', 'ростов', 'краснодар', 'уфа', 'воронеж',
  'волгоград', 'красноярск', 'омск', 'тюмень', 'саратов', 'барнаул', 'иркутск',
  'владивосток', 'хабаровск', 'ярославль', 'тольятти', 'ижевск', 'ульяновск', 'кемерово',
  'сочи', 'калининград', 'оренбург', 'томск', 'астрахань', 'минск',
];
const OTHER_CITY_SUBDOMAIN =
  /^(spb|piter|nsk|novosib|novosibirsk|ekb|ekaterinburg|perm|kazan|kaz|samara|nn|nnv|nnov|nizhniy-novgorod|ufa|rostov|rnd|krd|krasnodar|chel|chelyabinsk|omsk|tmn|tyumen|vrn|voronezh|krsk|krasnoyarsk|saratov|irk|vlg|volgograd|kld|sochi|tula|tver)\./i;

function looksLikeOtherCity(r: { name?: string; website?: string }): boolean {
  const name = (r.name ?? '').toLowerCase();
  if (OTHER_CITY_WORDS.some((c) => name.includes(c))) return true;
  const host = (r.website ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
  return OTHER_CITY_SUBDOMAIN.test(host);
}

function dedupKey(r: { name?: string; website?: string }): string {
  const site = (r.website ?? '').trim().toLowerCase();
  if (site) return site.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').split(/[/?#]/)[0];
  return (r.name ?? '').trim().toLowerCase();
}

function guessCountry(website: string): string {
  const host = (website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
  if (host.endsWith('.by')) return 'Беларусь';
  if (host.endsWith('.ru')) return 'Россия';
  return '';
}

async function processSearchJob(job: any): Promise<void> {
  const region = REGION_HINTS[job.country] ? job.country : 'Россия';
  const hint = REGION_HINTS[region];

  const { data: existingOffers } = await supabase
    .from('supplier_research_offers')
    .select('name, website_url')
    .eq('request_id', job.request_id);
  const existing = existingOffers ?? [];
  const excludeKeys = new Set(existing.map((o: any) => dedupKey({ name: o.name, website: o.website_url })));
  const excludeNames = [
    ...existing.map((o: any) => o.name),
    ...(Array.isArray(job.exclude_companies) ? job.exclude_companies.map((r: any) => r.name || r.website) : []),
  ].filter(Boolean);

  const excludeBlock = excludeNames.length
    ? `\n\nЭТИ КОМПАНИИ УЖЕ ЕСТЬ — НЕ ВКЛЮЧАЙ ИХ, ищи ДРУГИХ:\n${excludeNames.map((n: string) => `- ${n}`).join('\n')}`
    : '';

  const query = [
    job.section_title ? `Раздел: ${job.section_title}.` : '',
    `Материалы: ${job.items_text}.`,
    job.extra ? `Дополнительные пожелания: ${job.extra}.` : '',
    `Найди поставщиков этих материалов ${hint}.`,
  ]
    .filter(Boolean)
    .join(' ');

  const content = await askProxyApi({
    model: MODEL,
    max_tokens: 10000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, allowed_callers: ['direct'] }],
    system: `Ты помогаешь найти реальных поставщиков строительных материалов ${hint}
через веб-поиск для девелоперской компании. Ищи ОСНОВАТЕЛЬНО: используй
web_search до ${MAX_SEARCHES} раз разными запросами, стремись к ${MAX_RESULTS} компаниям.
Комбинируй обычные поисковые запросы и источники, хорошо проиндексированные
Яндексом (Яндекс.Маркет, Яндекс.Карты/2ГИС, TIU.ru, Deal.by, Prom.by, Avito).${excludeBlock}

Для каждой компании собери: website (адрес сайта), link (ПРЯМАЯ ссылка на
страницу товара или раздела каталога; пустая строка, если не нашёл), phone,
email, note (одна фраза, что продают). Не выдумывай ничего.

Верни ОТВЕТ ЦЕЛИКОМ JSON-массивом, без markdown:
[{"name":"...","website":"...","link":"...","phone":"...","email":"...","note":"..."}]`,
    messages: [{ role: 'user', content: query }],
  });

  const seen = new Set<string>();
  const fresh = extractJsonArray(content)
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      website: (r.website ?? '').trim(),
      link: (r.link ?? '').trim(),
      phone: (r.phone ?? '').trim(),
      email: (r.email ?? '').trim(),
      note: (r.note ?? '').trim(),
    }))
    // Для московского поиска — отсечка по городу в названии/домене (см.
    // looksLikeOtherCity выше): модель регулярно приносит региональные
    // филиалы вопреки хинту.
    .filter((r) => region !== 'Москва' || !looksLikeOtherCity(r))
    .filter((r) => {
      const key = dedupKey(r);
      if (seen.has(key) || excludeKeys.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RESULTS);

  let added = 0;
  if (fresh.length > 0) {
    const { data: created } = await supabase
      .from('supplier_research_offers')
      .insert(
        fresh.map((r) => ({
          request_id: job.request_id,
          name: r.name,
          contact: r.phone,
          contact_method: 'Телефон',
          email: r.email,
          manager_name: '',
          country: guessCountry(r.website),
          website_url: r.website,
          listing_url: r.link,
          messengers: [],
          catalog_model_name: '',
          catalog_model_photo: null,
          price: 0,
          currency: 'USD',
          items: [],
          files: [],
          verified: false,
        })),
      )
      .select('id, website_url');
    added = created?.length ?? 0;
    const enrichable = (created ?? []).filter((o: any) => o.website_url);
    if (enrichable.length > 0) {
      await supabase.from('supplier_enrichment_jobs').insert(enrichable.map((o: any) => ({ offer_id: o.id })));
    }
  }

  const roundsDone = (job.rounds_done ?? 0) + 1;
  const previous = Array.isArray(job.results) ? job.results : [];
  const results = [...previous, ...fresh];
  const addedTotal = (job.added_count ?? 0) + added;

  // Ещё один раунд нужен, только если первый не выбрал лимит: широкие
  // категории так добираются до MAX_RESULTS, узкие завершаются сразу.
  const needMoreRounds = roundsDone < MAX_ROUNDS && fresh.length > 0 && results.length < MAX_RESULTS;
  await supabase
    .from('supplier_web_search_jobs')
    .update({
      status: needMoreRounds ? 'pending' : 'done',
      results,
      added_count: addedTotal,
      rounds_done: roundsDone,
      completed_at: needMoreRounds ? null : new Date().toISOString(),
    })
    .eq('id', job.id);
}

// Атомарный захват задания: помечаем processing только если оно всё ещё
// pending. Так два параллельных вызова (крон + ручной дёрг из админки, или
// GitHub Actions, если он оживёт) не возьмут одно и то же задание дважды.
async function claim(table: string, id: string): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .update({ status: 'processing' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  return (data?.length ?? 0) > 0;
}

Deno.serve(async () => {
  if (!PROXYAPI_KEY) {
    return new Response(JSON.stringify({ error: 'PROXYAPI_KEY не задан в секретах функции' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = { search: 0, enrichment: 0, errors: [] as string[] };

  // Поиск важнее: он порождает новых поставщиков, и именно его ждёт человек с
  // открытой вкладкой. Один раунд за вызов — чтобы уложиться в wall-clock.
  const { data: searchJobs } = await supabase
    .from('supplier_web_search_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  for (const job of searchJobs ?? []) {
    if (!(await claim('supplier_web_search_jobs', job.id))) continue;
    try {
      await processSearchJob(job);
      summary.search++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push(`поиск ${job.id}: ${message}`);
      await supabase
        .from('supplier_web_search_jobs')
        .update({ status: 'error', error: message.slice(0, 400), completed_at: new Date().toISOString() })
        .eq('id', job.id);
    }
  }

  // Обогащение добираем тем, что осталось от лимита вызова: если поиск в этот
  // раз не запускался — берём полную порцию, иначе одно-два задания.
  const enrichmentLimit = summary.search > 0 ? 1 : ENRICHMENT_BATCH;
  const { data: enrichmentJobs } = await supabase
    .from('supplier_enrichment_jobs')
    .select('*, supplier_research_offers(name, website_url)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(enrichmentLimit);

  const claimed = [];
  for (const job of enrichmentJobs ?? []) {
    if (await claim('supplier_enrichment_jobs', job.id)) claimed.push(job);
  }

  const settled = await Promise.allSettled(claimed.map((job) => processEnrichmentJob(job)));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      summary.enrichment++;
    } else {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      summary.errors.push(`обогащение ${claimed[i].id}: ${message}`);
      supabase
        .from('supplier_enrichment_jobs')
        .update({ status: 'error', error: message.slice(0, 400), completed_at: new Date().toISOString() })
        .eq('id', claimed[i].id);
    }
  });

  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
});
