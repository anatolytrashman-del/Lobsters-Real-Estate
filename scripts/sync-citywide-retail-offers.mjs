// Раз в месяц собирает с Kufar и Realt.by объявления аренды/продажи ТОРГОВЫХ
// помещений и ПСН по ВСЕМУ Минску (не по одному дому/району, как остальные
// sync-*.mjs в этом проекте) и сохраняет в public.citywide_offers —
// сегмент 'torgovye' (ANALYTICSPLAN.md §1.1, очередь 2). Основа для
// market_snapshots этого сегмента (см. build-market-snapshots.mjs).
//
// В отличие от business_center_offers, объекты здесь НЕ привязаны к
// справочнику зданий (такого справочника ТЦ/ЖК у нас нет) — сегмент/тип
// здания/район берутся из структурных полей самих площадок, не из своего
// каталога:
//
// Kufar — city-wide категория "Магазины, торговые помещения" (property_type
// код 2, url-параметр prt=2) без district-фильтра в пути, тот же приём
// Googlebot-SSR, что и у sync-kufar-market-offers.mjs. У Kufar район —
// готовое структурное поле ad_parameters.area ("Фрунзенский" и т.п., то же
// именование, что у business_centers.district — сверено вручную), а тип
// здания — готовое поле commercial_building ("В жилом доме"/"В торговом
// центре"/"В бизнес центре"/"Отдельное здание"/... — полный список см.
// BUILDING_TYPE_LABELS). Цена — из ad.calculator (Kufar сам считает цену за
// м² в 4 валютах на каждое объявление), не из square_meter (тот в валюте
// продавца, см. предупреждение в sync-kufar-market-offers.mjs).
//
// Realt — своего поля "тип здания" на объектах нет, только заголовок/
// описание текстом; классифицируем эвристикой по ключевым словам
// (classifyBuildingTypeFromText) — менее надёжно, чем у Kufar, помечено в
// комментарии у самой функции. Района как отдельного поля на объекте тоже
// нет — обходим тем же приёмом, что и sync-business-center-offers.mjs:
// перебираем все 8 known REALT_DISTRICT_SLUGS по очереди, район уже известен
// из того, какой URL мы запрашивали.
//
// Дедупликация Kufar↔Realt — ЕСТЬ (в отличие от business_center_offers, где
// её сознательно нет, см. её комментарий): один и тот же объект часто
// выставлен на обеих площадках. Ключ — улица+дом+площадь(округл.)+этаж+тип
// сделки, тот же принцип, что у dedupKey в src/data/marketOffers.ts (эту
// небольшую функцию логично было бы не дублировать, но скрипт — голый .mjs
// без TS-загрузчика, см. похожее решение в prerender.mjs). При совпадении
// оставляем более раннее объявление (по created/updated нет единой шкалы
// между площадками — оставляем то, что нашли первым, Kufar перед Realt).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}

const PUBLIC_ANON_KEY = 'sb_publishable_EQwXLOy5TmSPj5tzKjbSeg_xj6SM2Iz';
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ?? PUBLIC_ANON_KEY);

const SEGMENT = 'torgovye';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const REALT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15';
const KUFAR_PAGE_SIZE = 30;
const KUFAR_MAX_PAGES = 60;
const REALT_MAX_PAGES = 20;

const PRICE_BOUNDS = {
  sale: { min: 200, max: 15000 },
  rent: { min: 3, max: 200 },
};

function isPlausiblePrice(dealType, pricePerSqm) {
  const b = PRICE_BOUNDS[dealType];
  return pricePerSqm >= b.min && pricePerSqm <= b.max;
}

// Kufar commercial_building — полный словарь (см. шапку файла).
const BUILDING_TYPE_LABELS = {
  1: 'Бизнес-центр',
  5: 'Торговый центр',
  10: 'Развлекательный центр',
  15: 'Жилой дом',
  20: 'Подземный переход',
  25: 'Частный дом',
  30: 'Отдельно стоящее здание',
  35: 'Прочее',
};

// Эвристика для Realt (нет структурного поля) — по ключевым словам в
// заголовке/описании. Менее надёжно, чем Kufar-поле, поэтому проверяем
// по порядку от специфичного к общему и возвращаем null, если ничего не
// совпало (честно "не определено", не гадаем дальше).
function classifyBuildingTypeFromText(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/торгов(ом|ый|ого)\s+центр|\bтц\b/.test(t)) return 'Торговый центр';
  if (/бизнес[\s-]?центр|\bбц\b/.test(t)) return 'Бизнес-центр';
  if (/жил(ом|ой|ого)\s+дом/.test(t)) return 'Жилой дом';
  if (/отдельно\s+сто/.test(t)) return 'Отдельно стоящее здание';
  return null;
}

function dedupKey(dealType, address, size, floor) {
  if (!address) return null;
  const normalized = address.toLowerCase().replace(/ё/g, 'е').replace(/[.,]/g, ' ');
  const streetMatch = normalized.match(/([а-я-]+)\s+ул(?![а-я])/);
  const houseMatch = normalized.match(/ул\S*\s+(\d+)/);
  if (!streetMatch || !houseMatch) return null;
  const floorKey = floor ?? '?';
  return `${dealType}|${streetMatch[1]}|${houseMatch[1]}|${Math.round(size)}|${floorKey}`;
}

// ---------- Kufar ----------

function getAdParam(ad, code) {
  return (ad.ad_parameters || []).find((p) => p.p === code) ?? null;
}
function getAccountParam(ad, code) {
  return (ad.account_parameters || []).find((p) => p.p === code) ?? null;
}

async function fetchKufarPage(dealSlug, cursor) {
  const url = new URL(`https://re.kufar.by/l/minsk/${dealSlug}/kommercheskaya`);
  url.searchParams.set('size', String(KUFAR_PAGE_SIZE));
  url.searchParams.set('prt', '2'); // "Магазины, торговые помещения"
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, {
    headers: { 'User-Agent': GOOGLEBOT_UA, Accept: 'text/html', 'Accept-Language': 'ru' },
  });
  if (!res.ok) throw new Error(`Kufar (${dealSlug}) вернул ${res.status} для ${url}`);

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error(`Kufar (${dealSlug}): не нашёл __NEXT_DATA__ — вероятно, поменялась вёрстка`);

  const data = JSON.parse(match[1]);
  const listing = data?.props?.initialState?.listing;
  if (!listing) throw new Error(`Kufar (${dealSlug}): не нашёл props.initialState.listing`);

  const nextPage = (listing.pagination || []).find((p) => p.label === 'next');
  return { ads: listing.ads || [], total: listing.total ?? 0, nextCursor: nextPage?.token ?? null };
}

async function fetchAllKufar(dealSlug) {
  const all = [];
  let cursor = null;
  let total = Infinity;
  for (let page = 0; page < KUFAR_MAX_PAGES && all.length < total; page++) {
    const result = await fetchKufarPage(dealSlug, cursor);
    total = result.total;
    if (result.ads.length === 0) break;
    all.push(...result.ads);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return all;
}

function extractKufarOffers(ads, dealType, excluded) {
  const offers = [];
  for (const ad of ads) {
    const address = getAccountParam(ad, 'address')?.v ?? null;
    const size = getAdParam(ad, 'size')?.v ?? null;
    if (size == null) continue;

    // ad.calculator — Kufar сам конвертирует цену объявления в 4 валюты
    // (см. шапку файла); берём готовый USD price_per_meter, не пересчитываем
    // сами из square_meter (та в валюте продавца). ВАЖНО: как и price_usd в
    // sync-kufar-market-offers.mjs, значения здесь в ЦЕНТАХ, не долларах —
    // поймано на живом прогоне: без /100 цена продажи выходила по $200–500
    // тыс. за м² (проверено на конкретных объявлениях curl'ом вручную).
    const usdCalc = (ad.calculator || []).find((c) => c.currency === 'USD');
    const pricePerSqm = usdCalc ? Number(usdCalc.price_per_meter) / 100 : null;
    if (pricePerSqm == null || !Number.isFinite(pricePerSqm)) continue;

    const adLink = `https://re.kufar.by/vi/${ad.ad_id}`;
    if (!isPlausiblePrice(dealType, pricePerSqm)) {
      excluded.push({ source: 'Kufar', dealType, size, pricePerSqm, adLink });
      continue;
    }

    const district = getAdParam(ad, 'area')?.vl || null;
    const buildingCode = getAdParam(ad, 'commercial_building')?.v;
    const buildingType = buildingCode != null ? BUILDING_TYPE_LABELS[Number(buildingCode)] ?? null : null;
    const floor = getAdParam(ad, 'floor')?.v?.[0] ?? null;

    offers.push({
      source: 'Kufar',
      ad_id: String(ad.ad_id),
      deal_type: dealType,
      property_type: 'Торговые помещения',
      building_type: buildingType,
      size,
      price_per_sqm: pricePerSqm,
      floor,
      district,
      address,
      ad_link: adLink,
    });
  }
  return offers;
}

// ---------- Realt ----------

// Те же 8 slug'ов, что и в sync-business-center-offers.mjs
// (REALT_DISTRICT_SLUGS) — сверены вживую, не выдуманы.
const REALT_DISTRICT_SLUGS = {
  Центральный: 'centralnyj-rajon',
  Октябрьский: 'oktjabrskij-rajon',
  Партизанский: 'partizanskij-rajon',
  Первомайский: 'pervomajskij-rajon',
  Советский: 'sovetskij-rajon',
  Фрунзенский: 'frunzenskij-rajon',
  Заводской: 'zavodskoj-rajon',
  Московский: 'moskovskij-rajon',
};

async function fetchRealtPage(dealSlug, districtSlug, page) {
  const url = new URL(`https://realt.by/${dealSlug}/shops/minsk/${districtSlug}/`);
  if (page > 1) url.searchParams.set('page', String(page));

  const res = await fetch(url, {
    headers: { 'User-Agent': REALT_UA, Accept: 'text/html', 'Accept-Language': 'ru' },
  });
  if (res.status === 404) return { objects: [], totalCount: 0 };
  if (!res.ok) throw new Error(`Realt (${dealSlug}/${districtSlug}) вернул ${res.status} для ${url}`);

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error(`Realt (${dealSlug}/${districtSlug}): не нашёл __NEXT_DATA__`);

  const data = JSON.parse(match[1]);
  const pp = data?.props?.pageProps;
  return { objects: pp?.objects || [], totalCount: pp?.totalCount ?? 0 };
}

async function fetchAllRealt(dealSlug, districtSlug) {
  const all = [];
  let totalCount = Infinity;
  for (let page = 1; page <= REALT_MAX_PAGES && all.length < totalCount; page++) {
    const result = await fetchRealtPage(dealSlug, districtSlug, page);
    totalCount = result.totalCount;
    if (result.objects.length === 0) break;
    all.push(...result.objects);
  }
  return all;
}

function extractRealtOffers(objects, dealType, district, excluded) {
  const offers = [];
  for (const o of objects) {
    const size = o.areaTotal ?? o.areaMax ?? o.areaMin ?? null;
    const pricePerSqm = o.priceRatesPerM2?.['840'] ?? null; // '840' = USD
    if (size == null || pricePerSqm == null) continue;

    const adLink = `https://realt.by/${dealType === 'sale' ? 'sale' : 'rent'}-shops/object/${o.code}/`;
    if (!isPlausiblePrice(dealType, pricePerSqm)) {
      excluded.push({ source: 'Realt', dealType, size, pricePerSqm, adLink });
      continue;
    }

    const buildingType = classifyBuildingTypeFromText(`${o.title ?? ''} ${o.headline ?? ''}`);

    offers.push({
      source: 'Realt',
      ad_id: String(o.code),
      deal_type: dealType,
      property_type: 'Торговые помещения',
      building_type: buildingType,
      size,
      price_per_sqm: pricePerSqm,
      floor: o.storey ?? null,
      district,
      address: o.address ?? null,
      ad_link: adLink,
    });
  }
  return offers;
}

// ---------- main ----------

async function main() {
  const excluded = [];
  const kufarOffers = [];
  const realtOffers = [];

  for (const dealSlug of ['snyat', 'kupit']) {
    const dealType = dealSlug === 'snyat' ? 'rent' : 'sale';
    console.log(`Kufar: тяну «Магазины, торговые помещения» по всему Минску (${dealSlug})...`);
    const ads = await fetchAllKufar(dealSlug);
    const extracted = extractKufarOffers(ads, dealType, excluded);
    console.log(`Kufar (${dealSlug}): получено ${ads.length}, из них годных — ${extracted.length}`);
    kufarOffers.push(...extracted);
  }

  for (const [districtName, districtSlug] of Object.entries(REALT_DISTRICT_SLUGS)) {
    for (const dealSlug of ['rent', 'sale']) {
      console.log(`Realt: тяну торговые помещения (${dealSlug}/${districtName})...`);
      const objects = await fetchAllRealt(dealSlug, districtSlug);
      const extracted = extractRealtOffers(objects, dealSlug, districtName, excluded);
      console.log(`Realt (${dealSlug}/${districtName}): получено ${objects.length}, из них годных — ${extracted.length}`);
      realtOffers.push(...extracted);
    }
  }

  // Дедупликация: Kufar считается основным источником при совпадении
  // (собран первым), Realt-дубли отбрасываются.
  const seenKeys = new Set();
  const deduped = [];
  let dupCount = 0;
  for (const o of [...kufarOffers, ...realtOffers]) {
    const key = dedupKey(o.deal_type, o.address, o.size, o.floor);
    if (key && seenKeys.has(key)) {
      dupCount++;
      continue;
    }
    if (key) seenKeys.add(key);
    deduped.push(o);
  }
  console.log(`Дедупликация: ${dupCount} объявлений-дублей (по адресу+площади+этажу+типу сделки) отброшено.`);

  if (excluded.length > 0) {
    console.log(`Отфильтровано ${excluded.length} объявлений с неправдоподобной ценой за м²:`);
    console.table(excluded);
  }

  if (deduped.length === 0) {
    console.log('Торговых помещений не нашлось, в базу нечего писать.');
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(deduped));
    return;
  }

  console.log(`Итого ${deduped.length} объявлений (${kufarOffers.length} Kufar + ${realtOffers.length} Realt − ${dupCount} дублей).`);

  if (DRY_RUN) {
    console.log('--dry-run: запись в Supabase пропущена.');
    return;
  }

  const now = new Date().toISOString();
  const payload = deduped.map((o) => ({ ...o, segment: SEGMENT, updated_at: now }));

  const { error: upsertError } = await supabase
    .from('citywide_offers')
    .upsert(payload, { onConflict: 'segment,source,ad_id' });
  if (upsertError) throw upsertError;

  for (const source of ['Kufar', 'Realt']) {
    const idsThisRun = deduped.filter((o) => o.source === source).map((o) => o.ad_id);
    const { error: deleteError } = await supabase
      .from('citywide_offers')
      .delete()
      .eq('segment', SEGMENT)
      .eq('source', source)
      .not('ad_id', 'in', `(${idsThisRun.length ? idsThisRun.map((id) => `"${id}"`).join(',') : '""'})`);
    if (deleteError) throw deleteError;
  }

  console.log(`Сохранено ${payload.length} объявлений в citywide_offers (сегмент ${SEGMENT}).`);
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
