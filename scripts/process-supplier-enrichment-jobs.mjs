// Фоновая обработка очереди обогащения контактов поставщиков
// (supplier_enrichment_jobs) — владелец, 2026-09-11: "мы делали связку с
// проксиапи и ИИшка ходила по сайтам бизнес-центров и собирала информацию с
// них — хочу так же для поставщиков: email для заказов, телефон, номера в
// Telegram/WhatsApp/Max". Этот скрипт реально ходит на сайт поставщика и
// пишет найденное прямо в supplier_research_offers.
//
// Кто ставит задания: сам поисковый скрипт (process-supplier-web-search-
// jobs.mjs, createOffersAndQueueEnrichment) сразу после того, как создал
// предложения по результатам поиска — владелец, 2026-09-11: "мне не нужна
// кнопка обогащения. Хочу так: запустили поиск → ИИ нашёл → сразу добавил в
// базу → скрипт обогащения сразу берёт в работу → когда вся инфа собрана,
// поставщик получает статус «Готово к верификации»". Из админки задания не
// ставятся вообще. Запускается двумя путями: тем же прогоном воркфлоу
// поиска (последний шаг process-supplier-web-search-jobs.yml — это и есть
// "сразу берёт в работу") и своим кроном раз в 5 минут как страховкой
// (process-supplier-enrichment-jobs.yml).
//
// В отличие от веб-поиска (инструмент web_search — снипеты), здесь нужен
// РЕАЛЬНЫЙ просмотр конкретного уже известного сайта — используется
// инструмент Anthropic `web_fetch_20250910` через тот же ProxyAPI-прокси
// (`https://api.proxyapi.ru/anthropic/v1/messages`, тот же PROXYAPI_KEY).
// Живой прецедент этого инструмента — проверка сайтов бизнес-центров
// (см. docs/session-journal.md, записи 2026-09-06): `claude-haiku-4-5`
// показал качество на уровне Sonnet 5 за существенно меньшую цену, и сам
// самостоятельно переходил на нужные подстраницы (Контакты и т.п.) — тот же
// подход и модель здесь. Часть сайтов инструмент не может открыть вообще
// (бот-защита конкретного домена, не баг модели/инструмента, подтверждено
// той же проверкой БЦ) — это не ошибка задания, а результат "сайт
// недоступен" (siteAccessible:false), задание всё равно 'done'.
//
// Обогащение заполняет ТОЛЬКО пустые поля предложения (email/contact/
// messengers) — никогда не перезаписывает то, что уже есть (ручной ввод или
// прошлое обогащение), чтобы не затирать вручную проверенные данные молча.
// Мессенджеры мержатся по типу (Telegram/WhatsApp/Max) — новый тип
// добавляется, уже присутствующий не трогается и не дублируется.

import { createClient } from '@supabase/supabase-js';
import https from 'node:https';
import http from 'node:http';

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
const MAX_FETCHES = 3;
// Владелец, 2026-09-11: "а че, не можем параллельно собирать инфу несколькими
// агентами?" — можем: задание почти целиком стоит в ожидании сети (web_fetch
// одного сайта — десятки секунд), процессор при этом простаивает. Пул из
// нескольких воркеров сокращает разбор очереди во столько же раз. Больше не
// ставим намеренно: у ProxyAPI есть лимиты на частоту, а 429 здесь стоит
// дороже, чем лишняя минута ожидания.
const CONCURRENCY = 5;
const MESSENGER_TYPES = ['Telegram', 'WhatsApp', 'Max'];

const SYSTEM_PROMPT = `Ты собираешь контактные данные поставщика для закупщика строительной компании.
Тебе дан сайт компании. Зайди на главную страницу и, если нужно, на страницу
Контакты (обычно /contacts, /kontakty, /about и т.п.) через инструмент
web_fetch (до ${MAX_FETCHES} вызовов). Найди:
1) email для оформления заказов (часто начинается на order@/zakaz@/zakupki@/
   sales@, отличается от общего info@; ищи в шапке сайта или на странице
   Контакты; если указано несколько офисов/городов — бери контакты
   московского офиса);
2) основной телефон;
3) номера в мессенджерах Telegram/WhatsApp/Max, ЕСЛИ они явно указаны на
   сайте (ссылки wa.me/t.me/max.ru или явный текст "WhatsApp"/"Telegram"/
   "Max" рядом с номером) — не выдумывай, если явно не нашёл.

Верни СТРОГО JSON без markdown-разметки, без пояснений до или после, без
\`\`\`, строго формат:
{"orderEmail":"","phone":"","messengers":[{"type":"Telegram","number":""}],"note":"","siteAccessible":true}

"messengers" — массив, type строго одно из "Telegram"/"WhatsApp"/"Max".
"note" — одна короткая фраза по-русски: что реально нашёл/не нашёл, особые
случаи (несколько офисов, сайт не тот и т.п.).
"siteAccessible" — false, если сайт не открылся инструментом вообще
(заблокирован бот-защитой и т.п.) — тогда остальные поля пустые.
Если поле не нашёл — пустая строка/пустой массив, НЕ выдумывай контакты.`;

// 2026-09-11, живой прогон на категории "Краска интерьерная": 2 сайта из 31
// упали с "Unexpected non-whitespace character after JSON" — модель иногда
// возвращает ДВА JSON-блока подряд (например, черновик и финальную версию),
// не один. Наивный "от первой { до последней }" склеивал оба в невалидный
// JSON. Разбираем блоки по отдельности и берём ПОСЛЕДНИЙ разобравшийся
// объект: с веб-поиском модель ещё и комментирует ход поиска между вызовами
// инструмента, и в комментарии попадаются скобки с куском шаблона ответа —
// на "первом объекте склейки" найденная почта терялась молча (odissey2000.ru).
function balancedObjects(text) {
  const found = [];
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

function extractJson(content) {
  const texts = (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text);
  let fallback = null;
  for (const text of [...texts].reverse()) {
    const stripped = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    for (const candidate of balancedObjects(stripped).reverse()) {
      let parsed;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        continue; // комментарий модели, а не ответ
      }
      if (parsed && typeof parsed === 'object') {
        if ('orderEmail' in parsed || 'phone' in parsed) return parsed;
        fallback ??= parsed;
      }
    }
  }
  if (fallback) return fallback;
  throw new Error('Модель не вернула JSON в ожидаемом формате');
}

function sanitizeResult(raw) {
  const messengers = Array.isArray(raw.messengers)
    ? raw.messengers
        .filter((m) => m && MESSENGER_TYPES.includes(m.type) && typeof m.number === 'string' && m.number.trim())
        .map((m) => ({ type: m.type, number: m.number.trim() }))
    : [];
  return {
    orderEmail: typeof raw.orderEmail === 'string' ? raw.orderEmail.trim() : '',
    phone: typeof raw.phone === 'string' ? raw.phone.trim() : '',
    messengers,
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    siteAccessible: raw.siteAccessible !== false,
  };
}

// ——— Запасные пути, когда web_fetch не открыл сайт ————————————————————
// Владелец, 2026-09-11: "осталось много нераспознанных поставщиков, хотя их
// сайты известны. Один сайт не открылся с VPN, только из России, другой — с
// ошибкой SSL-сертификата. Хочу, чтобы распознавание было максимальным".
// Реальные причины по журналу заданий: бот-защита против серверов Anthropic
// (403), гео-блокировка, битый сертификат. Поэтому вместо одной попытки —
// три, по убыванию достоверности источника:
//   1) web_fetch — настоящая страница глазами модели (как было);
//   2) прямой запрос с раннера GitHub Actions — другой IP и обычный
//      браузерный User-Agent, плюс мы сами управляем проверкой сертификата
//      (это и чинит кейс с битым SSL);
//   3) веб-поиск — карточки организации в Яндекс.Картах/2ГИС и каталогах;
//      единственный путь для сайтов, которые физически не открываются
//      извне России.
// Источник, из которого реально взяты контакты, дописывается в note —
// человек при верификации должен видеть, насколько данным можно верить.
const PAGE_FETCH_TIMEOUT_MS = 15000;
const MAX_PAGE_BYTES = 500_000;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const CONTACT_PATHS = ['', '/contacts', '/contacts/', '/kontakty', '/kontakty/', '/contact', '/about'];

function fetchPageOnce(url, { insecure, redirectsLeft = 3 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const req = client.get(
      target,
      {
        headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ru-RU,ru;q=0.9' },
        timeout: PAGE_FETCH_TIMEOUT_MS,
        // Битый/просроченный сертификат — причина, по которой сайт вообще не
        // отдаётся инструменту; на втором заходе читаем его без проверки и
        // ОБЯЗАТЕЛЬНО помечаем это в note (данные с такого сайта — с оговоркой).
        ...(insecure && target.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(fetchPageOnce(new URL(res.headers.location, target).toString(), { insecure, redirectsLeft: redirectsLeft - 1 }));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_PAGE_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// Сначала как положено (с проверкой сертификата), и только если упало именно
// на сертификате — повтор без проверки. Возвращает и сам факт такого повтора.
async function fetchPage(url) {
  try {
    return { html: await fetchPageOnce(url, { insecure: false }), insecure: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const certProblem = /certificate|CERT_|SELF_SIGNED|ALT_NAME|SSL|TLS/i.test(message) || /^(ERR_TLS|UNABLE_TO_VERIFY)/i.test(err?.code ?? '');
    if (!certProblem) throw err;
    return { html: await fetchPageOnce(url, { insecure: true }), insecure: true };
  }
}

// Грубое приведение страницы к тексту: сначала вытаскиваем mailto:/tel: из
// разметки (почта и телефон часто только в href, в видимом тексте их нет —
// иконкой или картинкой), потом снимаем теги.
function htmlToText(html) {
  const links = [...html.matchAll(/(?:mailto|tel):([^"'\s>]+)/gi)].map((m) => m[0]);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const linksBlock = links.length ? `Ссылки-контакты со страницы: ${[...new Set(links)].join(', ')}\n\n` : '';
  return `${linksBlock}${text}`.slice(0, 20000);
}

async function askModel(body, retried = false) {
  const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': PROXYAPI_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 402) throw new Error('Недостаточно средств на балансе ProxyAPI — пополните счёт в личном кабинете ProxyAPI.');
    // Параллельные воркеры (см. CONCURRENCY) могут упереться в лимит частоты —
    // это не ошибка задания, а просьба подождать: один спокойный повтор.
    if (resp.status === 429 && !retried) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return askModel(body, true);
    }
    throw new Error(`Ошибка обогащения (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  return sanitizeResult(extractJson(data.content));
}

// Попытка 2: читаем страницы сами с раннера и отдаём модели уже готовый текст.
// Ссылки на страницу контактов прямо из разметки главной: перебор готовых
// путей промахивается на нетиповых адресах — у odissey2000.ru контакты лежат
// на /kontakty-odissey, и почта не находилась вовсе (2026-09-11).
const CONTACT_LINK_RE = /href\s*=\s*["']([^"'\s>]*(?:kontakt|contact|o-kompanii|about)[^"'\s>]*)["']/gi;

async function fetchFromPagesDirectly(name, websiteUrl) {
  const base = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
  const pages = [];
  const urls = [];
  let insecureUsed = false;
  try {
    const { html, insecure } = await fetchPage(base);
    insecureUsed = insecureUsed || insecure;
    const text = htmlToText(html);
    if (text.length > 200) pages.push(text);
    for (const m of html.matchAll(CONTACT_LINK_RE)) {
      try {
        urls.push(new URL(m[1], base).toString());
      } catch {
        // мусорный href вроде "javascript:void(0)"
      }
    }
  } catch {
    // главная не открылась — остаются типовые пути ниже
  }
  for (const path of CONTACT_PATHS) urls.push(new URL(path, base).toString());
  const seen = new Set([base]);
  for (const url of urls) {
    if (pages.length >= 3) break;
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const { html, insecure } = await fetchPage(url);
      insecureUsed = insecureUsed || insecure;
      const text = htmlToText(html);
      if (text.length > 200) pages.push(text);
    } catch {
      // Страницы может не быть (404) или она недоступна — пробуем следующую.
    }
  }
  if (pages.length === 0) throw new Error('страницы не открылись напрямую');

  const result = await askModel({
    model: MODEL,
    max_tokens: 2000,
    system: `${SYSTEM_PROMPT}\n\nВАЖНО: инструментов нет, страницы уже скачаны и приведены к тексту — работай только с тем, что прислано ниже, ничего не выдумывай.`,
    messages: [
      {
        role: 'user',
        content: `Компания «${name}», сайт ${base}. Текст страниц сайта:\n\n${pages.join('\n\n--- следующая страница ---\n\n')}`,
      },
    ],
  });
  return { result, insecureUsed };
}

// Попытка 3: веб-поиск — для сайтов, которые физически не открываются извне
// (гео-блокировка) или закрыты бот-защитой наглухо.
async function searchContacts(name, websiteUrl) {
  return askModel({
    model: MODEL,
    max_tokens: 3000,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, allowed_callers: ['direct'] }],
    system: `Ты собираешь контактные данные поставщика для закупщика строительной компании.
Сайт компании НЕДОСТУПЕН для прямого просмотра (бот-защита, гео-блокировка или
проблема с сертификатом), поэтому ищи контакты через веб-поиск: карточки
организации в Яндекс.Картах/2ГИС, каталоги (Rusprofile, Zoon, Tiu, Prom),
описания и объявления компании. Найди:
1) email для оформления заказов (order@/zakaz@/zakupki@/sales@; если такого
   нет — общий email компании);
2) основной телефон (если несколько офисов — московский);
3) номера в мессенджерах Telegram/WhatsApp/Max, если явно указан САМ НОМЕР
   (одного упоминания "есть WhatsApp" недостаточно — тогда не добавляй).
Бери только то, что относится именно к ЭТОЙ компании с ЭТИМ сайтом — при
сомнении оставляй пусто, выдумывать нельзя.

Верни СТРОГО JSON без markdown-разметки и пояснений:
{"orderEmail":"","phone":"","messengers":[{"type":"Telegram","number":""}],"note":"","siteAccessible":false}

"messengers" — массив, type строго одно из "Telegram"/"WhatsApp"/"Max".
"note" — одной фразой по-русски, откуда взяты контакты (какой источник).`,
    messages: [
      {
        role: 'user',
        content: websiteUrl
          ? `Компания «${name}», сайт ${websiteUrl}. Найди её контакты.`
          : `Компания «${name}», сайт неизвестен. Найди её контакты и сайт.`,
      },
    ],
  });
}

// Слияние попыток: непустое поле побеждает пустое, уже найденное не
// затирается более поздней (менее достоверной) попыткой.
function mergeResults(base, extra) {
  const messengerTypes = new Set(base.messengers.map((m) => m.type));
  return {
    orderEmail: base.orderEmail || extra.orderEmail,
    phone: base.phone || extra.phone,
    messengers: [...base.messengers, ...extra.messengers.filter((m) => !messengerTypes.has(m.type))],
    note: [base.note, extra.note].filter(Boolean).join(' '),
    siteAccessible: base.siteAccessible || extra.siteAccessible,
  };
}

// Следующий шаг цепочки пропускаем, только когда есть И почта, И телефон.
// Раньше здесь было "или", и сайт, отдавший один телефон, закрывал поиск
// почты совсем (termokit.ru: на сайте телефон, opt@ — только в выдаче).
function isComplete(result) {
  return Boolean(result.orderEmail && result.phone);
}

async function fetchEnrichment(name, websiteUrl) {
  const url = /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`;
  const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': PROXYAPI_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: MAX_FETCHES, allowed_callers: ['direct'] }],
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Сайт поставщика: ${url} (компания «${name}»).` }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 402) {
      throw new Error('Недостаточно средств на балансе ProxyAPI — пополните счёт в личном кабинете ProxyAPI.');
    }
    throw new Error(`Ошибка обогащения (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  return sanitizeResult(extractJson(data.content));
}

async function updateJob(id, patch) {
  if (DRY_RUN) return;
  const { error } = await supabase.from('supplier_enrichment_jobs').update(patch).eq('id', id);
  if (error) console.error(`  → не удалось обновить задание ${id}:`, error.message);
}

// Патчит offer ТОЛЬКО пустыми на момент записи полями — читает свежее
// состояние строки прямо перед записью (не то, что было на старте
// обработки задания), чтобы не затереть правку, внесённую пока шёл фетч.
async function applyToOffer(offerId, result) {
  if (DRY_RUN) return { emailApplied: false, phoneApplied: false, messengersAdded: [] };
  const { data: offer, error: fetchError } = await supabase
    .from('supplier_research_offers')
    .select('email, contact, contact_method, messengers, contact_source')
    .eq('id', offerId)
    .single();
  if (fetchError || !offer) {
    console.error(`  → не удалось прочитать предложение ${offerId} перед применением:`, fetchError?.message);
    return { emailApplied: false, phoneApplied: false, messengersAdded: [] };
  }

  const patch = {};
  let emailApplied = false;
  let phoneApplied = false;
  if (!offer.email && result.orderEmail) {
    patch.email = result.orderEmail;
    emailApplied = true;
  }
  if (!offer.contact && result.phone) {
    patch.contact = result.phone;
    patch.contact_method = 'Телефон';
    phoneApplied = true;
  }
  const existingMessengers = Array.isArray(offer.messengers) ? offer.messengers : [];
  const existingTypes = new Set(existingMessengers.map((m) => m.type));
  const messengersAdded = result.messengers.filter((m) => !existingTypes.has(m.type));
  if (messengersAdded.length > 0) {
    patch.messengers = [...existingMessengers, ...messengersAdded];
  }
  // Откуда контакты — в карточку: почта из каталога при недоступном сайте
  // может быть многолетней давности, закупщица должна видеть разницу.
  if ((emailApplied || phoneApplied) && !offer.contact_source) {
    patch.contact_source = result.siteAccessible ? 'сайт' : 'каталоги';
  }

  if (Object.keys(patch).length === 0) return { emailApplied, phoneApplied, messengersAdded };
  const { error: updateError } = await supabase.from('supplier_research_offers').update(patch).eq('id', offerId);
  if (updateError) console.error(`  → не удалось применить обогащение к предложению ${offerId}:`, updateError.message);
  return { emailApplied, phoneApplied, messengersAdded };
}

// Простой пул: N воркеров разбирают общий список, каждый берёт следующий
// свободный индекс. Без внешних зависимостей — голому .mjs-скрипту их взять
// неоткуда (см. комментарий про дублирование логики в шапке файла).
async function runPool(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function processJob(job) {
  const offer = job.supplier_research_offers;
  const label = offer?.name || job.offer_id;
  console.log(`Обрабатываю задание ${job.id} (${label})...`);
  await updateJob(job.id, { status: 'processing' });

  if (!offer) {
    await updateJob(job.id, { status: 'error', error: 'Предложение удалено', completed_at: new Date().toISOString() });
    console.error('  → предложение не найдено (удалено?)');
    return;
  }
  try {
    // Цепочка попыток (см. комментарий у fetchPage выше): настоящая страница →
    // прямой запрос с раннера → веб-поиск. Следующая попытка идёт только если
    // предыдущая не дала ни email, ни телефона — ради экономии вызовов и
    // потому, что каждая следующая менее достоверна.
    const sources = [];
    let result = { orderEmail: '', phone: '', messengers: [], note: '', siteAccessible: false };

    // Поставщика без сайта раньше помечали ошибкой и не обогащали вовсе —
    // карточка с одним названием так и висела пустой. Контакты по названию
    // ищет тот же веб-поиск.
    if (offer.website_url) {
      try {
        result = mergeResults(result, await fetchEnrichment(offer.name, offer.website_url));
        if (result.orderEmail || result.phone) sources.push('сайт');
      } catch (err) {
        console.error(`  → web_fetch не сработал: ${err instanceof Error ? err.message : err}`);
      }

      if (!isComplete(result)) {
        try {
          const before = result;
          const direct = await fetchFromPagesDirectly(offer.name, offer.website_url);
          result = mergeResults(result, direct.result);
          if (result.orderEmail !== before.orderEmail || result.phone !== before.phone) {
            sources.push(direct.insecureUsed ? 'прямой просмотр сайта (сертификат сайта невалиден)' : 'прямой просмотр сайта');
          }
        } catch (err) {
          console.error(`  → прямой просмотр не сработал: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    if (!isComplete(result)) {
      try {
        const before = result;
        result = mergeResults(result, await searchContacts(offer.name, offer.website_url ?? ''));
        if (result.orderEmail !== before.orderEmail || result.phone !== before.phone) sources.push('веб-поиск');
      } catch (err) {
        console.error(`  → веб-поиск не сработал: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (sources.length > 0) result.note = `Источник: ${sources.join(', ')}. ${result.note}`.trim();
    const applied = await applyToOffer(job.offer_id, result);
    await updateJob(job.id, { status: 'done', result, completed_at: new Date().toISOString() });
    console.log(
      `  → готово (email:${applied.emailApplied ? 'да' : 'нет'}, телефон:${applied.phoneApplied ? 'да' : 'нет'}, мессенджеры:+${applied.messengersAdded.length}, siteAccessible:${result.siteAccessible})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Не удалось выполнить обогащение';
    console.error(`  → ошибка: ${message}`);
    await updateJob(job.id, { status: 'error', error: message, completed_at: new Date().toISOString() });
  }
}

async function main() {
  if (DRY_RUN) {
    console.log('--dry-run: тестовый прогон одного фиктивного задания без чтения из базы и без записи результата.');
    await processJob({
      id: 'dry-run',
      offer_id: 'dry-run',
      supplier_research_offers: { name: 'Краски-Трейд', website_url: 'https://kraski-trade.ru' },
    });
    return;
  }
  const { data: jobs, error } = await supabase
    .from('supplier_enrichment_jobs')
    .select('*, supplier_research_offers(name, website_url)')
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
  console.log(`В очереди ${jobs.length} задани${jobs.length === 1 ? 'е' : jobs.length < 5 ? 'я' : 'й'}, обрабатываю по ${CONCURRENCY} параллельно.`);
  await runPool(jobs, CONCURRENCY, processJob);
}

await main();
