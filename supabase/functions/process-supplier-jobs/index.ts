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

// Все ПОЛНЫЕ JSON-объекты текста по глубине скобок, в порядке появления.
function balancedObjects(text: string): string[] {
  const found: string[] = [];
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          found.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return found;
}

// Итоговый объект — ПОСЛЕДНИЙ разобравшийся, а не первый: с веб-поиском
// модель комментирует ход поиска между вызовами инструмента, и в комментарии
// попадаются фигурные скобки и куски шаблона ответа. Разбор "первого объекта
// из склейки блоков" на этом ломался молча: 2026-09-11 по odissey2000.ru
// веб-поиск нашёл zavod@, а задание завершилось пустым результатом. Та же
// правка уже была сделана для массивов (extractJsonArray ниже).
function extractJson(content: unknown): Record<string, unknown> {
  const texts = (Array.isArray(content) ? content : [])
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text as string);
  let fallback: Record<string, unknown> | null = null;
  for (const text of [...texts].reverse()) {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    for (const candidate of balancedObjects(stripped).reverse()) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        continue; // комментарий модели, а не ответ — пробуем предыдущий
      }
      if (parsed && typeof parsed === 'object') {
        if ('orderEmail' in parsed || 'phone' in parsed) return parsed;
        fallback ??= parsed;
      }
    }
  }
  if (fallback) return fallback;
  throw new Error('модель не вернула JSON');
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

// Ссылки на страницу контактов прямо из разметки главной. Перебор готовых
// путей (/contacts, /kontakty, ...) промахивается на сайтах с нетиповым
// адресом: у odissey2000.ru контакты лежат на /kontakty-odissey, и email
// автосбором не находился вовсе (2026-09-11).
const CONTACT_LINK_RE = /href\s*=\s*["']([^"'\s>]*(?:kontakt|contact|o-kompanii|about)[^"'\s>]*)["']/gi;

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null; // страницы может не быть, домен закрыт или отдаёт битый TLS
  }
}

async function enrichViaDirectFetch(name: string, website: string): Promise<EnrichmentResult> {
  const base = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  const pages: string[] = [];
  const candidates: string[] = [];
  const home = await fetchPageHtml(base);
  if (home) {
    const text = htmlToText(home);
    if (text.length > 200) pages.push(text);
    for (const m of home.matchAll(CONTACT_LINK_RE)) {
      try {
        candidates.push(new URL(m[1], base).toString());
      } catch {
        // мусорный href вроде "javascript:void(0)" — пропускаем
      }
    }
  }
  for (const path of ['/contacts', '/kontakty', '/contact']) {
    candidates.push(new URL(path, base).toString());
  }
  const seen = new Set<string>([base]);
  for (const url of candidates) {
    if (pages.length >= 3) break;
    if (seen.has(url)) continue;
    seen.add(url);
    const html = await fetchPageHtml(url);
    if (!html) continue;
    const text = htmlToText(html);
    if (text.length > 200) pages.push(text);
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
    system: `Ты собираешь контактные данные поставщика веб-поиском: страница
контактов на сайте компании, Яндекс.Карты/2ГИС, каталоги (Rusprofile, Zoon,
Tiu, Prom), объявления. Нужны: email для заказов, основной телефон (московский,
если офисов несколько), номера Telegram/WhatsApp/Max — только если указан сам
номер. Бери только то, что относится именно к ЭТОЙ компании.

Верни СТРОГО JSON без markdown:
{"orderEmail":"","phone":"","messengers":[{"type":"Telegram","number":""}],"note":"","siteAccessible":false}
"note" — одной фразой, откуда взяты контакты.`,
    messages: [
      {
        role: 'user',
        content: website
          ? `Компания «${name}», сайт ${website}. Найди её контакты.`
          : `Компания «${name}», сайт неизвестен. Найди её контакты и сайт.`,
      },
    ],
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

// Шаг цепочки пропускаем, только когда собрано И то, И другое. Раньше здесь
// было "email ИЛИ телефон", и сайт, отдавший один телефон, закрывал поиск
// почты совсем: по termokit.ru на сайте был только телефон, а opt@termokit.ru
// лежал в выдаче — но веб-поиск уже не запускался (2026-09-11).
const isComplete = (r: EnrichmentResult) => Boolean(r.orderEmail && r.phone);

// Один запрос "жив ли адрес". Тело не читаем: нужен только статус и то,
// разрешилось ли вообще имя домена.
async function probeUrl(url: string): Promise<{ status: number | null; dnsFailed: boolean }> {
  for (const method of ['HEAD', 'GET'] as const) {
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
      const message = String(err).toLowerCase();
      const dnsFailed =
        message.includes('dns') || message.includes('lookup') || message.includes('name not resolved');
      return { status: null, dnsFailed };
    }
  }
  return { status: null, dnsFailed: false };
}

// Домен снят с делегирования (DNS не резолвится) — компании больше нет, а
// каталоги 2ГИС/Яндекс/OrgPage годами держат её карточку с "рабочей" почтой.
// Именно так в базу попал m-delivery.ru с sales@ (2026-09-11). Бот-защита и
// 403/503 мёртвым сайтом НЕ считаются: там контакты добираются веб-поиском.
async function siteIsDead(website: string): Promise<boolean> {
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
async function listingIsMissing(link: string): Promise<boolean> {
  const { status } = await probeUrl(/^https?:\/\//i.test(link) ? link : `https://${link}`);
  return status === 404 || status === 410;
}

async function processEnrichmentJob(job: any): Promise<void> {
  const offer = job.supplier_research_offers;
  if (!offer) {
    await supabase
      .from('supplier_enrichment_jobs')
      .update({ status: 'error', error: 'Предложение удалено', completed_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }
  let result: EnrichmentResult = { orderEmail: '', phone: '', messengers: [], note: '', siteAccessible: false };
  const sources: string[] = [];
  // Причины падений раньше уходили только в console.error, и снаружи упавший
  // шаг было не отличить от "ничего не нашлось" — теперь они пишутся в
  // задание, по ним и разбираем жалобы закупщицы.
  const stepErrors: string[] = [];
  // Поставщика без сайта раньше помечали ошибкой и не обогащали вовсе —
  // карточка с одним названием так и висела пустой (кейс «Артикера»,
  // 2026-09-11). Контакты по названию ищет тот же веб-поиск.
  const attempts: [string, () => Promise<EnrichmentResult>][] = offer.website_url
    ? [
        ['сайт', () => enrichViaWebFetch(offer.name, offer.website_url)],
        ['прямой просмотр сайта', () => enrichViaDirectFetch(offer.name, offer.website_url)],
        ['веб-поиск', () => enrichViaSearch(offer.name, offer.website_url)],
      ]
    : [['веб-поиск по названию', () => enrichViaSearch(offer.name, '')]];
  for (const [label, attempt] of attempts) {
    if (isComplete(result)) break;
    try {
      const before = result;
      result = merge(result, await attempt());
      if (result.orderEmail !== before.orderEmail || result.phone !== before.phone) sources.push(label);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stepErrors.push(`${label}: ${message}`);
      console.error(`  ${offer.name}: ${label} не сработал — ${message}`);
    }
  }
  if (sources.length > 0) result.note = `Источник: ${sources.join(', ')}. ${result.note}`.trim();
  // Откуда контакты — в карточку: почта из каталога при недоступном сайте
  // может быть годами не актуальной, и закупщица должна видеть разницу.
  const fromSite = sources.some((s) => !s.startsWith('веб-поиск'));
  const fromCatalogs = sources.some((s) => s.startsWith('веб-поиск'));
  const contactSource = [fromSite ? 'сайт' : '', fromCatalogs ? 'каталоги' : ''].filter(Boolean).join(' + ');

  // Применяем только в пустые поля — по свежему состоянию строки, чтобы не
  // затереть правку, сделанную человеком, пока шёл сбор.
  const { data: fresh } = await supabase
    .from('supplier_research_offers')
    .select('email, contact, messengers, contact_source')
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
    if (contactSource && !fresh.contact_source) patch.contact_source = contactSource;
    if (Object.keys(patch).length > 0) {
      await supabase.from('supplier_research_offers').update(patch).eq('id', job.offer_id);
    }
  }

  await supabase
    .from('supplier_enrichment_jobs')
    .update({
      status: 'done',
      result,
      error: stepErrors.join('; ') || null,
      completed_at: new Date().toISOString(),
    })
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

// Карточки универсальных поставщиков — чтобы исключить их из результатов
// поиска по профильной категории. Для самой категории "Универсальные
// поставщики" исключать нечего (её собственные карточки уже в existing).
const UNIVERSAL_SUPPLIERS_TITLE = 'Универсальные поставщики';

async function fetchUniversalOffers(requestId: string): Promise<{ name: string; website_url: string }[]> {
  const { data: universalRequests } = await supabase
    .from('supplier_research_requests')
    .select('id')
    .ilike('title', UNIVERSAL_SUPPLIERS_TITLE);
  const universalId = universalRequests?.[0]?.id;
  if (!universalId || universalId === requestId) return [];
  const { data } = await supabase.from('supplier_research_offers').select('name, website_url').eq('request_id', universalId);
  return data ?? [];
}

async function processSearchJob(job: any): Promise<void> {
  const region = REGION_HINTS[job.country] ? job.country : 'Россия';
  const hint = REGION_HINTS[region];

  const { data: existingOffers } = await supabase
    .from('supplier_research_offers')
    .select('name, website_url')
    .eq('request_id', job.request_id);
  // Владелец, 2026-09-12: универсальный поставщик (Лемана Про, Петрович,
  // Сатурн) живёт одной карточкой в категории "Универсальные поставщики" и
  // в профильных категориях его быть не должно (см. блок "Универсальные
  // поставщики" в src/data/supplierResearch.ts). Поиск об этом правиле
  // обязан знать: иначе он раз за разом находит те же федеральные сети и
  // молча заводит их дубликаты в каждой новой категории — без всякого
  // уведомления, потому что добавляет их сюда не человек.
  const universal = await fetchUniversalOffers(job.request_id);
  const existing = [...(existingOffers ?? []), ...universal];
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
  const candidates = extractJsonArray(content)
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
    // Карточка, в которой нет ни сайта, ни телефона, ни почты, закупщице
    // бесполезна: писать некуда, дособрать не из чего (кейс «Артикера»,
    // 2026-09-11 — в списке висело одно название).
    .filter((r) => r.website || r.phone || r.email)
    .slice(0, MAX_RESULTS);

  // Проверяем найденное, прежде чем сохранять: мёртвый домен — компании нет,
  // такую запись не заводим вовсе ("неактивные сайты надо удалять из списка
  // ещё на этапе поиска", владелец 2026-09-11); битую ссылку на позицию
  // просто не сохраняем. Проверки идут параллельно — это сеть, не процессор.
  const fresh = (
    await Promise.all(
      candidates.map(async (r) => {
        if (r.website && (await siteIsDead(r.website))) return null;
        const link = r.link && (await listingIsMissing(r.link)) ? '' : r.link;
        return { ...r, link };
      }),
    )
  ).filter((r): r is (typeof candidates)[number] => r !== null);

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
    // Обогащаем всех, включая записи без сайта: контакты ищутся и по названию.
    if (added > 0) {
      await supabase
        .from('supplier_enrichment_jobs')
        .insert((created ?? []).map((o: any) => ({ offer_id: o.id })));
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

// ——— Снимки сайтов (supplier_site_snapshots) ———————————————————————————
// Что поставляет компания — по разделам её каталога. Владелец, 2026-09-12:
// "каждый поставщик поставляет только свой спектр товара... парсинг
// категорий поставки... не через проксиапи, он дорого обходится". Поэтому
// здесь модели НЕТ вовсе: функция только скачивает главную, разделы каталога
// и sitemap.xml и складывает список разделов в таблицу. Раскладывает их по
// товарным группам уже сессия Claude Code (в рамках подписки), см.
// scripts/supply-categories/README.md и миграцию
// supabase/migrations/20260912-supplier-site-snapshots.sql.
//
// Порция — SNAPSHOT_BATCH доменов за вызов, параллельно с обогащением (оба
// шага — ожидание сети). 259 доменов первичной очереди разбираются примерно
// за час; новые домены ставит в очередь триггер в базе.
const SNAPSHOT_BATCH = 5;
const SNAPSHOT_MAX_SECTIONS = 250;
const SNAPSHOT_MAX_SITEMAP = 150;
// Общий бюджет времени на один сайт: главная + до 2 страниц каталога +
// sitemap (+ до 2 вложенных). Дальше не ходим — wall-clock вызова общий с
// обогащением.
const SNAPSHOT_TIME_BUDGET_MS = 55000;

interface SiteSection {
  title: string;
  url: string;
}

interface SiteSnapshot {
  pageTitle: string;
  metaDescription: string;
  homeText: string;
  sections: SiteSection[];
  pagesFetched: number;
}

// Сегмент пути, по которому раздел опознаётся как каталожный (Bitrix
// /catalog/, WooCommerce /product-category/, OpenCart /category/, InSales
// /collection/, самописные /tovary/, /produkciya/ ...).
const CATALOG_SEGMENT_RE =
  /^(catalog|katalog|category|categories|categor(y|ies)|product-category|products?|produkt(y|siya|ciya)?|produkc(iya|ija)?|productions?|tovar(y|s)?|shop|magazin|collections?|assortiment|assortment|razdel(y)?|nomenklatura|goods|materialy|materials|oborudovanie|equipment|katalog-tovarov|catalogue)$/i;
// Разделы, которые для номенклатуры не значат ничего: контакты, новости,
// доставка, корзина, вакансии и прочая обвязка сайта.
const NOISE_PATH_RE =
  /(kontakt|contact|about|o-kompanii|o-nas|company|news|novost|blog|stati|articles?|deliver|dostavk|oplat|payment|login|auth|signin|register|registr|cart|basket|korzin|search|poisk|privacy|policy|politik|personal|vakans|vacanc|career|otzyv|review|faq|help|garant|warranty|rekvizit|sitemap|feedback|partner|dealer|diler|cabinet|account|compare|wishlist|favorite|akci|aktsi|sale|discount|skidk|press|video|foto|gallery|galere|portfolio|proekt|project|certif|sertif|licen|document|dokument|sotrudnich|cooperation|return|vozvrat|terms|agreement|soglashen|cookie|calc|kalkul|schema-proezda|map$|karta$|brand|brend|manufacturer|proizvoditel|wp-|\.php$|\/tag\/|\/tags\/|\/page\/|\/rss)/i;
const FILE_EXT_RE = /\.(pdf|jpe?g|png|gif|webp|svg|xlsx?|docx?|zip|rar|mp4|avi|css|js|xml|txt)$/i;

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

// Путь без завершающего слэша и .html, в нижнем регистре — ключ дедупликации
// (одна и та же категория с главной, из каталога и из sitemap).
function pathKey(url: URL): string {
  return url.pathname
    .replace(/\/+$/, '')
    .replace(/\.html?$/i, '')
    .toLowerCase();
}

function pathDepth(url: URL): number {
  return url.pathname.split('/').filter(Boolean).length;
}

function isCatalogPath(url: URL): boolean {
  return url.pathname.split('/').filter(Boolean).some((seg) => CATALOG_SEGMENT_RE.test(seg));
}

function isUsableSection(url: URL, host: string): boolean {
  if (normalizeHost(url.hostname) !== host) return false;
  if (url.search || url.hash) return false;
  const depth = pathDepth(url);
  if (depth === 0 || depth > 3) return false;
  const path = url.pathname.toLowerCase();
  if (FILE_EXT_RE.test(path)) return false;
  if (NOISE_PATH_RE.test(path)) return false;
  return true;
}

function cleanTitle(raw: string): string {
  const text = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 2 || text.length > 70) return '';
  if (/^[\d\s+()\-–—.,]+$/.test(text)) return ''; // телефон/число
  if (/@/.test(text)) return '';
  return text;
}

// Название раздела из слага sitemap: /catalog/keramogranit-30x60/ →
// "keramogranit 30x60". Классификатору хватает — транслит он читает.
function titleFromSlug(url: URL): string {
  const seg = url.pathname.split('/').filter(Boolean).pop() ?? '';
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    // битая кодировка — оставляем как есть
  }
  return cleanTitle(decoded.replace(/\.html?$/i, '').replace(/[-_+]+/g, ' '));
}

function extractLinks(html: string, base: URL, host: string): SiteSection[] {
  const out: SiteSection[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1];
    const hrefMatch = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (!isUsableSection(url, host)) continue;
    // Текст ссылки; если внутри только картинка — title/aria-label.
    let title = cleanTitle(m[2]);
    if (!title) {
      const alt = /(?:title|aria-label)\s*=\s*["']([^"']+)["']/i.exec(attrs) ?? /alt\s*=\s*["']([^"']+)["']/i.exec(m[2]);
      title = alt ? cleanTitle(alt[1]) : '';
    }
    if (!title) continue;
    url.hash = '';
    out.push({ title, url: url.toString() });
  }
  return out;
}

function extractMeta(html: string, name: string): string {
  const re = new RegExp(`<meta\\s+[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0] ?? '';
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
  return cleanTitle(content) || content.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// Русские сайты часто отдают windows-1251, а resp.text() всегда разбирает как
// UTF-8 — заголовок и разделы превращаются в «?????» (2026-09-12: так пришёл
// снимок bard.su, классификатор по нему не понял ничего). Кодировку берём из
// заголовка Content-Type, а если её там нет — из <meta charset> в начале
// самого документа, разбирая байты дважды.
function decodeBytes(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const decode = (label: string) => {
    try {
      return new TextDecoder(label, { fatal: false }).decode(bytes);
    } catch {
      return null; // рантайм не знает такой кодировки
    }
  };
  if (fromHeader && !/utf-?8/i.test(fromHeader)) {
    const decoded = decode(fromHeader);
    if (decoded) return decoded;
  }
  const utf8 = decode('utf-8') ?? '';
  if (fromHeader) return utf8;
  const fromMeta =
    /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(utf8.slice(0, 2000))?.[1] ??
    /<\?xml[^>]+encoding\s*=\s*["']([\w-]+)/i.exec(utf8.slice(0, 200))?.[1];
  if (fromMeta && !/utf-?8/i.test(fromMeta)) {
    const decoded = decode(fromMeta);
    if (decoded) return decoded;
  }
  return utf8;
}

async function fetchSnapshotPage(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9', Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const type = resp.headers.get('content-type') ?? '';
    if (type && !/html|xml|text/i.test(type)) return null;
    return decodeBytes(new Uint8Array(await resp.arrayBuffer()), type);
  } catch {
    return null;
  }
}

function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
}

async function buildSiteSnapshot(host: string, websiteUrl: string): Promise<SiteSnapshot> {
  const startedAt = Date.now();
  const withinBudget = () => Date.now() - startedAt < SNAPSHOT_TIME_BUDGET_MS;

  // Главная: сначала как записано в карточке, потом https://host, потом
  // http://host — сайты с битым TLS так хоть как-то читаются.
  const candidates = new Set<string>();
  if (/^https?:\/\//i.test(websiteUrl)) candidates.add(websiteUrl.trim());
  candidates.add(`https://${host}/`);
  candidates.add(`http://${host}/`);
  let home: string | null = null;
  let base: URL | null = null;
  for (const url of candidates) {
    home = await fetchSnapshotPage(url, 12000);
    if (home) {
      base = new URL(url);
      break;
    }
  }
  if (!home || !base) throw new Error('сайт не открылся напрямую');

  let pagesFetched = 1;
  const byPath = new Map<string, SiteSection>();
  const add = (section: SiteSection) => {
    const key = pathKey(new URL(section.url));
    if (!byPath.has(key)) byPath.set(key, section);
  };
  extractLinks(home, base, host).forEach(add);

  // Корень каталога: ссылка глубины 1 с каталожным сегментом — на ней
  // обычно полный список разделов, которого нет в шапке. Если с главной
  // такой ссылки не нашлось, пробуем типовые адреса.
  const roots = [...byPath.values()]
    .map((s) => new URL(s.url))
    .filter((u) => pathDepth(u) === 1 && isCatalogPath(u))
    .map((u) => u.toString());
  if (roots.length === 0) {
    for (const path of ['/catalog/', '/katalog/', '/products/', '/shop/', '/product-category/']) {
      roots.push(new URL(path, base).toString());
    }
  }
  let rootsFetched = 0;
  for (const rootUrl of roots) {
    if (rootsFetched >= 2 || !withinBudget()) break;
    const html = await fetchSnapshotPage(rootUrl, 10000);
    if (!html) continue;
    rootsFetched++;
    pagesFetched++;
    extractLinks(html, new URL(rootUrl), host).forEach(add);
  }

  // sitemap.xml — единственный источник для сайтов, где меню рисует скрипт.
  // Из индекса берём до двух вложенных карт, предпочитая каталожные.
  if (withinBudget()) {
    const xml = await fetchSnapshotPage(new URL('/sitemap.xml', base).toString(), 10000);
    if (xml) {
      pagesFetched++;
      let locs = sitemapLocs(xml);
      if (/<sitemapindex/i.test(xml)) {
        const children = locs
          .filter((u) => !/image|video|news|blog|post|article|tag|author/i.test(u))
          .sort((a, b) => Number(/catalog|categor|product|collection/i.test(b)) - Number(/catalog|categor|product|collection/i.test(a)))
          .slice(0, 2);
        locs = [];
        for (const child of children) {
          if (!withinBudget()) break;
          const childXml = await fetchSnapshotPage(child, 10000);
          if (!childXml) continue;
          pagesFetched++;
          locs.push(...sitemapLocs(childXml));
        }
      }
      const parsed: URL[] = [];
      for (const loc of locs) {
        try {
          const u = new URL(loc);
          if (isUsableSection(u, host)) parsed.push(u);
        } catch {
          // мусор в <loc>
        }
      }
      // Если на сайте вообще есть каталожные пути — берём только их (иначе
      // sitemap приносит все статьи и служебные страницы); если нет —
      // разделы верхних двух уровней.
      const hasCatalog = parsed.some(isCatalogPath) || [...byPath.values()].some((s) => isCatalogPath(new URL(s.url)));
      parsed
        .filter((u) => (hasCatalog ? isCatalogPath(u) : pathDepth(u) <= 2))
        .sort((a, b) => pathDepth(a) - pathDepth(b) || a.pathname.localeCompare(b.pathname))
        .slice(0, SNAPSHOT_MAX_SITEMAP)
        .forEach((u) => {
          const title = titleFromSlug(u);
          if (title) add({ title, url: u.toString() });
        });
    }
  }

  const sections = [...byPath.values()].slice(0, SNAPSHOT_MAX_SECTIONS);
  const pageTitle = cleanTitle(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home)?.[1] ?? '') ||
    (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(home)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    pageTitle,
    metaDescription: extractMeta(home, 'description') || extractMeta(home, 'og:description'),
    homeText: htmlToText(home).slice(0, 3000),
    sections,
    pagesFetched,
  };
}

async function processSnapshot(row: { host: string; website_url: string }): Promise<void> {
  const snapshot = await buildSiteSnapshot(row.host, row.website_url);
  await supabase
    .from('supplier_site_snapshots')
    .update({
      status: 'done',
      page_title: snapshot.pageTitle,
      meta_description: snapshot.metaDescription,
      home_text: snapshot.homeText,
      sections: snapshot.sections,
      pages_fetched: snapshot.pagesFetched,
      error: null,
      fetched_at: new Date().toISOString(),
    })
    .eq('host', row.host);
}

async function processSnapshotQueue(summary: { snapshots: number; errors: string[] }): Promise<void> {
  // Если вызов умер посреди снимка (лимит wall-clock рантайма), строка
  // осталась бы в processing навсегда и домен выпал бы из очереди молча.
  // Возвращаем такие в pending: снимок идемпотентен, повтор безопасен.
  await supabase
    .from('supplier_site_snapshots')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('claimed_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const { data: rows } = await supabase
    .from('supplier_site_snapshots')
    .select('host, website_url')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(SNAPSHOT_BATCH);
  const claimed: { host: string; website_url: string }[] = [];
  for (const row of rows ?? []) {
    const { data } = await supabase
      .from('supplier_site_snapshots')
      .update({ status: 'processing', claimed_at: new Date().toISOString() })
      .eq('host', row.host)
      .eq('status', 'pending')
      .select('host');
    if ((data?.length ?? 0) > 0) claimed.push(row);
  }
  const settled = await Promise.allSettled(claimed.map((row) => processSnapshot(row)));
  for (const [i, r] of settled.entries()) {
    if (r.status === 'fulfilled') {
      summary.snapshots++;
      continue;
    }
    const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
    summary.errors.push(`снимок ${claimed[i].host}: ${message}`);
    await supabase
      .from('supplier_site_snapshots')
      .update({ status: 'error', error: message.slice(0, 400), fetched_at: new Date().toISOString() })
      .eq('host', claimed[i].host);
  }
}

Deno.serve(async () => {
  if (!PROXYAPI_KEY) {
    return new Response(JSON.stringify({ error: 'PROXYAPI_KEY не задан в секретах функции' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const summary = { search: 0, enrichment: 0, snapshots: 0, errors: [] as string[] };

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

  // Снимки сайтов идут параллельно с обогащением: и то и другое — ожидание
  // сети, а не процессор. Когда в этот вызов шёл поиск, снимки пропускаем —
  // wall-clock уже потрачен.
  const [settled] = await Promise.all([
    Promise.allSettled(claimed.map((job) => processEnrichmentJob(job))),
    summary.search > 0 ? Promise.resolve() : processSnapshotQueue(summary),
  ]);
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
