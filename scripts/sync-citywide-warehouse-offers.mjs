// Раз в месяц собирает с Kufar и Realt.by объявления аренды/продажи
// СКЛАДСКИХ помещений по ВСЕМУ Минску и сохраняет в public.citywide_offers —
// сегмент 'sklady' (ANALYTICSPLAN.md §1.1, очередь 2). Прямая копия
// sync-citywide-retail-offers.mjs (см. её же комментарии за полным
// обоснованием приёмов — city-wide Kufar-категория без district-фильтра,
// Realt — перебор по REALT_DISTRICT_SLUGS, дедупликация по dedupKey), тут
// только различия:
//
// - property_type у Kufar код 4 (url-параметр prt=4, "Склады"), у Realt —
//   slug 'warehouses' (тот же, что уже используют CATEGORIES в
//   sync-business-center-offers.mjs).
// - Измерения из плана (класс склада A/B/C, высота потолков, направление/
//   МКАД) — НЕ собираются: проверено вживую (curl по всем полям
//   ad_parameters реальных объявлений Kufar) — таких структурных полей
//   просто нет ни у одной площадки, только commercial_building (то же
//   поле, что и у розницы — тип строения, не про склады специфично) и
//   район. Направление шоссе/МКАД можно было бы парсить эвристикой из
//   адреса (Дзержинское шоссе, Логойский тракт и т.п.), но это отдельная,
//   не сделанная в этом заходе задача — не выдумываем класс/высоту.

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

const SEGMENT = 'sklady';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const REALT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15';
const KUFAR_PAGE_SIZE = 30;
const KUFAR_MAX_PAGES = 60;
const REALT_MAX_PAGES = 20;

// Границы шире, чем у розницы/офисов — складская аренда/продажа за м²
// заметно дешевле, но верхнюю границу оставляем той же (случаются небольшие
// тёплые склады-мастерские, отдельные от промзон, по цене ближе к торговым
// помещениям — не режем их искусственно).
const PRICE_BOUNDS = {
  sale: { min: 100, max: 8000 },
  rent: { min: 1, max: 100 },
};

function isPlausiblePrice(dealType, pricePerSqm) {
  const b = PRICE_BOUNDS[dealType];
  return pricePerSqm >= b.min && pricePerSqm <= b.max;
}

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
  url.searchParams.set('prt', '4'); // "Склады"
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

    // ad.calculator — цена в ЦЕНТАХ, не долларах (см. предупреждение в
    // sync-citywide-retail-offers.mjs, тот же баг был там на живом прогоне).
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
      property_type: 'Склады',
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
  const url = new URL(`https://realt.by/${dealSlug}/warehouses/minsk/${districtSlug}/`);
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
    const pricePerSqm = o.priceRatesPerM2?.['840'] ?? null;
    if (size == null || pricePerSqm == null) continue;

    const adLink = `https://realt.by/${dealType === 'sale' ? 'sale' : 'rent'}-warehouses/object/${o.code}/`;
    if (!isPlausiblePrice(dealType, pricePerSqm)) {
      excluded.push({ source: 'Realt', dealType, size, pricePerSqm, adLink });
      continue;
    }

    offers.push({
      source: 'Realt',
      ad_id: String(o.code),
      deal_type: dealType,
      property_type: 'Склады',
      building_type: null, // Realt не даёт структурного поля, эвристика по тексту тут не заводилась — мало пользы для складов
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
    console.log(`Kufar: тяну «Склады» по всему Минску (${dealSlug})...`);
    const ads = await fetchAllKufar(dealSlug);
    const extracted = extractKufarOffers(ads, dealType, excluded);
    console.log(`Kufar (${dealSlug}): получено ${ads.length}, из них годных — ${extracted.length}`);
    kufarOffers.push(...extracted);
  }

  for (const [districtName, districtSlug] of Object.entries(REALT_DISTRICT_SLUGS)) {
    for (const dealSlug of ['rent', 'sale']) {
      console.log(`Realt: тяну склады (${dealSlug}/${districtName})...`);
      const objects = await fetchAllRealt(dealSlug, districtSlug);
      const extracted = extractRealtOffers(objects, dealSlug, districtName, excluded);
      console.log(`Realt (${dealSlug}/${districtName}): получено ${objects.length}, из них годных — ${extracted.length}`);
      realtOffers.push(...extracted);
    }
  }

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
  console.log(`Дедупликация: ${dupCount} объявлений-дублей отброшено.`);

  if (excluded.length > 0) {
    console.log(`Отфильтровано ${excluded.length} объявлений с неправдоподобной ценой за м²:`);
    console.table(excluded);
  }

  if (deduped.length === 0) {
    console.log('Складов не нашлось, в базу нечего писать.');
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
