// Раз в месяц (см. .github/workflows/sync-market-offers-stats.yml) собирает с
// Realt.by публичные объявления коммерческой недвижимости по Минск Миру и
// сохраняет СЫРЫЕ объявления в public.market_offers (source='Realt') — тот
// же принцип, что и у scripts/sync-kufar-market-offers.mjs (см. его же
// комментарии и SEO_PLAN.md за общим контекстом фичи).
//
// Как достаём данные: Realt — Next.js с серверным рендером по умолчанию
// (не только для ботов, как у Kufar) — обычный fetch без спецзаголовков
// отдаёт HTML с готовым __NEXT_DATA__, внутри которого лежит
// props.pageProps.objects — реальные объявления со всеми атрибутами.
//
// Геопривязка к Минск Миру: в отличие от Kufar, у Realt есть свой точный
// микрорайон-фильтр в самом URL (slug minsk-mir-mk-r-n) — проверено
// вручную на реальных адресах (Игоря Лученка, Николы Теслы, Савицкого,
// Жореса Алфёрова и т.д., без примеси старого центра города, которая была
// у Kufar). Поэтому свой список улиц (как в Kufar-скрипте) тут не нужен.
//
// Категории помещений — берём из URL (slug), не из числового поля Realt
// category/objectType (там нет текстовых меток, только коды) — так же,
// как deal_type определяется в Kufar-скрипте по URL, а не по угадыванию.
// Полный список категорий/актуальный набор — см. комментарий у CATEGORIES
// ниже.
//
// Валюта: сырое pricePerM2 объявления — В ВАЛЮТЕ ПРОДАВЦА (priceCurrency:
// 933=BYN/840=USD/978=EUR — ISO 4217), не всегда USD! Проверено вручную:
// часть объявлений на реальном ответе была в EUR. Поэтому цену за м² берём
// ТОЛЬКО из priceRatesPerM2['840'] (Realt сам конвертирует и отдаёт цену в
// каждой валюте под её ISO-кодом) — это гарантированно USD независимо от
// того, в чём указал цену продавец.
//
// Состояние отделки — тоже готовое структурное поле Realt (repairState,
// шкала 0-8: 0 евроремонт .. 8 без отделки, см. живую расшифровку в
// SEO_PLAN.md). 0-3 (евроремонт/отличный/хороший/нормальный) — реальная
// законченная отделка → "с отделкой". 4-8 (удовлетворительный..без
// отделки) — требует работ или совсем голое помещение → "без отделки".
// Это огрубление такое же условное, как для Kufar — исправляется вручную
// на /admin/market-offers, если владелец не согласен с конкретным случаем.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15';
const MAX_PAGES = 20; // страховка от бесконечного цикла

const DEAL_TYPES = [
  { slug: 'sale', dealType: 'sale' },
  { slug: 'rent', dealType: 'rent' },
];

// Сокращённый набор категорий (владелец, август 2026) — полное обоснование
// в комментарии над MARKET_PROPERTY_TYPES (src/data/marketOffers.ts).
// 'production' (Промышленные) и 'storages' (Прочая коммерческая — на деле
// общая категория "Помещения" без уточнения назначения, настоящие склады у
// Realt отдельная категория warehouses) владелец решил вовсе не
// отслеживать — убраны из списка совсем, а не просто переименованы: в
// отличие от Kufar (единый общий фид, см. normalizePropertyType в
// sync-kufar-market-offers.mjs) у Realt категория — часть URL, поэтому
// проще не запрашивать эти два раздела вовсе, чем постфильтровывать ответ.
// 'shops'/'warehouses' — те же категории, что и раньше, просто с новыми
// названиями ("Торговые помещения"/"Кладовые" — см. тот же комментарий в
// data/marketOffers.ts). 'services'/'restorant-cafe' ("Сфера услуг"/
// "Общепит") остаются как есть — эти НУЖНЫ (владелец: "помещения в базе
// нужны, Светлана отсортирует по этажу"), просто раскладку по итоговым
// категориям Офисы/Торговые помещения она делает вручную при верификации.
// slug 'business' (готовый бизнес) и 'garage' (гаражи/машиноместа)
// сознательно не запрашиваем — не тот сегмент (не офисы/торговля/склады,
// которыми оперирует Red One и вся эта фича).
const CATEGORIES = [
  { slug: 'offices', propertyType: 'Офисы' },
  { slug: 'shops', propertyType: 'Торговые помещения' },
  { slug: 'services', propertyType: 'Сфера услуг' },
  { slug: 'warehouses', propertyType: 'Кладовые' },
  { slug: 'restorant-cafe', propertyType: 'Общепит' },
];

// Совпадает с PRICE_BOUNDS в sync-kufar-market-offers.mjs — тот же рынок,
// та же логика: широкие границы, отсекают только математически
// невозможное (цена "по запросу", ушедшая в базу как 0).
const PRICE_BOUNDS = {
  sale: { min: 300, max: 15000 },
  rent: { min: 5, max: 150 },
};

function isPlausiblePrice(dealType, pricePerSqm) {
  const bounds = PRICE_BOUNDS[dealType];
  return pricePerSqm >= bounds.min && pricePerSqm <= bounds.max;
}

// 2026-08-27: см. тот же комментарий в sync-kufar-market-offers.mjs —
// одинаковая проблема и одинаковое решение для обоих источников. Разовая
// чистка (33 мёртвые ссылки, 26 из них — Realt) сделана вручную, здесь —
// постоянная защита на будущее.
async function checkLinkAlive(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT } });
      return res.status !== 404;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null; // сеть не ответила дважды подряд — не судим, пропускаем строку
}

async function pruneDeadOffers(adIdsThisRun) {
  const { data: candidates, error } = await supabase
    .from('market_offers')
    .select('id, ad_id, ad_link')
    .eq('source', 'Realt')
    .eq('reviewed', false)
    .eq('rejected', false)
    .eq('flagged_for_discussion', false)
    .not('ad_id', 'in', `(${adIdsThisRun.length ? adIdsThisRun.map((id) => `"${id}"`).join(',') : '""'})`);
  if (error) throw error;
  if (!candidates || candidates.length === 0) return;

  console.log(`Realt: ${candidates.length} необработанных строк пропали из свежего скрейпа — проверяю ссылки...`);
  const deadIds = [];
  for (const c of candidates) {
    const alive = await checkLinkAlive(c.ad_link);
    if (alive === false) deadIds.push(c.id);
    await new Promise((r) => setTimeout(r, 300)); // не спамить источник частыми запросами подряд
  }

  if (deadIds.length === 0) {
    console.log('Realt: подтверждённо мёртвых ссылок не найдено.');
    return;
  }

  const note = `Ссылка недоступна на источнике (проверено автоматически ${new Date().toLocaleDateString('ru-RU')} — HTTP 404 после редиректа)`;
  const { error: updateError } = await supabase
    .from('market_offers')
    .update({ rejected: true, reviewed: true, owner_note: note })
    .in('id', deadIds);
  if (updateError) throw updateError;

  console.log(`Realt: ${deadIds.length} из ${candidates.length} пропавших строк подтверждённо мертвы — помечены "Не подходит".`);
}

function classifyFinishStatus(repairState) {
  if (repairState == null) return 'не указано';
  if (repairState <= 3) return 'с отделкой';
  return 'без отделки';
}

async function fetchCategoryPage(dealSlug, categorySlug, page) {
  const url = new URL(`https://realt.by/${dealSlug}/${categorySlug}/minsk/minsk-mir-mk-r-n/`);
  if (page > 1) url.searchParams.set('page', String(page));

  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html',
      'Accept-Language': 'ru',
    },
  });

  if (res.status === 404) return { objects: [], totalCount: 0 }; // категории без объявлений в районе отдают 404
  if (!res.ok) {
    throw new Error(`Realt (${dealSlug}/${categorySlug}) вернул ${res.status} для ${url}`);
  }

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    throw new Error(`Realt (${dealSlug}/${categorySlug}): не нашёл __NEXT_DATA__ в ответе — вероятно, поменялась вёрстка`);
  }

  const data = JSON.parse(match[1]);
  const pp = data?.props?.pageProps;
  if (!pp) {
    throw new Error(`Realt (${dealSlug}/${categorySlug}): не нашёл props.pageProps — вероятно, поменялась структура`);
  }

  return { objects: pp.objects || [], totalCount: pp.totalCount ?? 0 };
}

async function fetchAllForCategory(dealSlug, categorySlug) {
  const all = [];
  let totalCount = Infinity;
  for (let page = 1; page <= MAX_PAGES && all.length < totalCount; page++) {
    const result = await fetchCategoryPage(dealSlug, categorySlug, page);
    totalCount = result.totalCount;
    if (result.objects.length === 0) break;
    all.push(...result.objects);
  }
  return all;
}

function extractOffers(objects, dealType, dealSlug, categorySlug, propertyType, excluded) {
  const offers = [];

  for (const o of objects) {
    const size = o.areaTotal ?? o.areaMax ?? o.areaMin ?? null;
    const pricePerSqm = o.priceRatesPerM2?.['840'] ?? null; // '840' = USD (ISO 4217), см. комментарий вверху файла
    if (size == null || pricePerSqm == null) continue;

    const adLink = `https://realt.by/${dealSlug}-${categorySlug}/object/${o.code}/`;
    if (!isPlausiblePrice(dealType, pricePerSqm)) {
      excluded.push({ dealType, propertyType, size, pricePerSqm, adLink });
      continue;
    }

    offers.push({
      source: 'Realt',
      ad_id: String(o.code),
      deal_type: dealType,
      property_type: propertyType,
      size,
      price_per_sqm: pricePerSqm,
      finish_status: classifyFinishStatus(o.repairState),
      // Этаж — доп. сигнал для поиска дублей (data/marketOffers.ts, dedupKey):
      // без него много одинаковых по площади кабинетов в одном доме на
      // разных этажах ложно считались одним и тем же дублем.
      floor: o.storey ?? null,
      address: o.address ?? null,
      ad_link: adLink,
    });
  }

  return offers;
}

async function main() {
  const offers = [];
  const excluded = [];

  for (const { slug: dealSlug, dealType } of DEAL_TYPES) {
    for (const { slug: categorySlug, propertyType } of CATEGORIES) {
      console.log(`Realt: тяну объявления (${dealSlug}/${categorySlug})...`);
      const objects = await fetchAllForCategory(dealSlug, categorySlug);
      const extracted = extractOffers(objects, dealType, dealSlug, categorySlug, propertyType, excluded);
      console.log(`Realt (${dealSlug}/${categorySlug}): получено ${objects.length}, из них годных — ${extracted.length}`);
      offers.push(...extracted);
    }
  }

  if (excluded.length > 0) {
    console.log(`Realt: отфильтровано ${excluded.length} объявлений с неправдоподобной ценой за м²:`);
    console.table(excluded);
  }

  if (offers.length === 0) {
    console.log('Realt: по Минск Миру ничего не нашлось, в базу нечего писать.');
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(offers));
    return;
  }

  console.table(offers);

  if (DRY_RUN) {
    console.log('--dry-run: запись в Supabase пропущена.');
    return;
  }

  // Не затираем то, что владелец разобрал вручную (/admin/market-offers) —
  // тот же принцип, что и в Kufar-скрипте: reviewed=true защищает всю
  // строку, синк для таких строк только подтверждает актуальность.
  const adIds = offers.map((o) => o.ad_id);
  const { data: existing, error: fetchError } = await supabase
    .from('market_offers')
    .select('ad_id, deal_type, property_type, size, price_per_sqm, finish_status, floor, has_terrace, terrace_area, address, reviewed')
    .eq('source', 'Realt')
    .in('ad_id', adIds);
  if (fetchError) throw fetchError;

  const reviewedByAdId = new Map((existing ?? []).filter((e) => e.reviewed).map((e) => [e.ad_id, e]));

  // Реальный баг, пойманный на живом прогоне (2026-09-09) — упавший синк
  // и здесь, и в Kufar-скрипте с ОДНОЙ и той же ошибкой: PostgREST строит
  // один INSERT на весь batch по объединению ключей ВСЕХ объектов массива —
  // если хотя бы у одной строки в этом же вызове upsert() есть has_terrace/
  // terrace_area (у reviewedRow — есть, т.к. они дочитаны из базы), а у
  // остальных (новых, ещё не проверенных) объектов o этих ключей нет вовсе,
  // PostgREST подставляет им NULL, а не DEFAULT false колонки — ломает
  // ВЕСЬ batch на NOT NULL constraint (не только конкретную новую строку).
  // Раньше это не проявлялось, пока в одном синке не оказывались рядом и
  // проверенные, и новые строки — сейчас это уже почти всегда так. Фикс —
  // явно задавать has_terrace/terrace_area у КАЖДОЙ строки, чтобы все
  // объекты массива несли одинаковый набор ключей.
  const now = new Date().toISOString();
  const payload = offers.map((o) => {
    const reviewedRow = reviewedByAdId.get(o.ad_id);
    if (reviewedRow) {
      return { ...o, ...reviewedRow, reviewed: true, updated_at: now };
    }
    return { ...o, has_terrace: false, terrace_area: null, reviewed: false, updated_at: now };
  });

  const { error } = await supabase.from('market_offers').upsert(payload, { onConflict: 'source,ad_id' });
  if (error) throw error;

  console.log(`Сохранено ${payload.length} объявлений в market_offers (${reviewedByAdId.size} проверенных вручную — не тронуты).`);

  await pruneDeadOffers(adIds);
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
