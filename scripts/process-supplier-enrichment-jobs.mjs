// Фоновая обработка очереди обогащения контактов поставщиков
// (supplier_enrichment_jobs) — владелец, 2026-09-11: "мы делали связку с
// проксиапи и ИИшка ходила по сайтам бизнес-центров и собирала информацию с
// них — хочу так же для поставщиков: email для заказов, телефон, номера в
// Telegram/WhatsApp/Max". Тот же принцип очереди, что и у
// process-supplier-web-search-jobs.mjs — клиент только СТАВИТ задание
// (INSERT в supplier_enrichment_jobs, привязанное к конкретному offer_id),
// этот скрипт (по расписанию — process-supplier-enrichment-jobs.yml, раз в
// 5 минут — и мгновенно через workflow_dispatch, api/trigger-rebuild.js
// action='dispatch-supplier-enrichment') реально ходит на сайт поставщика и
// пишет найденное прямо в supplier_research_offers.
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

function extractJson(content) {
  const text = (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Модель не вернула JSON в ожидаемом формате');
  }
  return JSON.parse(stripped.slice(start, end + 1));
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
    .select('email, contact, contact_method, messengers')
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

  if (Object.keys(patch).length === 0) return { emailApplied, phoneApplied, messengersAdded };
  const { error: updateError } = await supabase.from('supplier_research_offers').update(patch).eq('id', offerId);
  if (updateError) console.error(`  → не удалось применить обогащение к предложению ${offerId}:`, updateError.message);
  return { emailApplied, phoneApplied, messengersAdded };
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
  if (!offer.website_url) {
    await updateJob(job.id, { status: 'error', error: 'У поставщика не указан сайт', completed_at: new Date().toISOString() });
    console.error('  → у предложения не указан сайт');
    return;
  }

  try {
    const result = await fetchEnrichment(offer.name, offer.website_url);
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
  console.log(`В очереди ${jobs.length} задани${jobs.length === 1 ? 'е' : jobs.length < 5 ? 'я' : 'й'}.`);
  for (const job of jobs) {
    await processJob(job);
  }
}

await main();
