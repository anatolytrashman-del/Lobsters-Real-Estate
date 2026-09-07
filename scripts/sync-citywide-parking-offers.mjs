// Раз в месяц собирает с Kufar объявления продажи/аренды МАШИНОМЕСТ (не
// гаражей-боксов) по всему Минску и сохраняет в public.citywide_offers —
// сегмент 'mashinomesta' (ANALYTICSPLAN.md §1.1, очередь 3).
//
// Отличается от остальных citywide-сегментов (розница/склады) принципиально:
// цена машиноместа — за ОБЪЕКТ целиком, не за м² (сам план так и говорит:
// "цена за объект"). Поэтому пишем в новую колонку `price_total`, а не в
// `price_per_sqm` (та теперь nullable — намеренно оставляем NULL для этого
// сегмента, а не 0: 0 читался бы как "бесплатно", реальная ложь, см. общий
// принцип проекта "числовые 'нет данных' ловушки" в CLAUDE.md).
//
// Категория — НЕ "Коммерческая" (в отличие от розницы/складов), а
// отдельный верхний раздел Kufar "Гаражи и стоянки" (URL /l/minsk/{deal}/
// garazh, найден просмотром структуры сайта, не выдуман) с фильтром
// garage_type=1 (url-параметр gtp=1) — отсекает гаражи-боксы (gtp=5/10),
// оставляя только машиноместа.
//
// Realt.by СОЗНАТЕЛЬНО не подключён — у их аналогичной категории
// (realt.by/{deal}/garage/minsk/...) нет поля, отличающего машиноместо от
// гаража-бокса (проверено на живом объекте — просто общая категория без
// подтипа), риск смешать два разных товара в одной медиане выше, чем
// польза от дополнительного источника. Однобокая выборка (только Kufar) —
// честное ограничение, не скрыто.
//
// Тип парковки — готовое структурное поле Kufar garage_parking_type
// ("Подземная"/"Наземная"/"Многоуровневая"/"На крыше"/"Открытая").

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

const SEGMENT = 'mashinomesta';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const PAGE_SIZE = 30;
const MAX_PAGES = 30;

// Цена за объект целиком — границы другие, чем у цены за м² в остальных
// скриптах. Живые данные: продажа $2 000–$60 000, аренда $10–$300/мес.
const PRICE_BOUNDS = {
  sale: { min: 300, max: 100000 },
  rent: { min: 5, max: 500 },
};

function isPlausiblePrice(dealType, priceTotal) {
  const b = PRICE_BOUNDS[dealType];
  return priceTotal >= b.min && priceTotal <= b.max;
}

const PARKING_TYPE_LABELS = {
  1: 'На крыше',
  5: 'Подземная',
  10: 'Наземная',
  15: 'Многоуровневая',
  20: 'Открытая',
};

function getAdParam(ad, code) {
  return (ad.ad_parameters || []).find((p) => p.p === code) ?? null;
}
function getAccountParam(ad, code) {
  return (ad.account_parameters || []).find((p) => p.p === code) ?? null;
}

async function fetchKufarPage(dealSlug, cursor) {
  const url = new URL(`https://re.kufar.by/l/minsk/${dealSlug}/garazh`);
  url.searchParams.set('size', String(PAGE_SIZE));
  url.searchParams.set('gtp', '1'); // "Машиноместо"
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
  for (let page = 0; page < MAX_PAGES && all.length < total; page++) {
    const result = await fetchKufarPage(dealSlug, cursor);
    total = result.total;
    if (result.ads.length === 0) break;
    all.push(...result.ads);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return all;
}

function extractOffers(ads, dealType, excluded) {
  const offers = [];
  for (const ad of ads) {
    const address = getAccountParam(ad, 'address')?.v ?? null;

    // ad.calculator — цена ЦЕЛИКОМ за объект, в ЦЕНТАХ (тот же баг, что
    // уже пойман в sync-citywide-retail-offers.mjs, тут проверено заново
    // на живых данных машиномест отдельно, не предполагалось "раз уже
    // знаем — не проверять").
    const usdCalc = (ad.calculator || []).find((c) => c.currency === 'USD');
    const priceTotal = usdCalc ? Number(usdCalc.price) / 100 : null;
    if (priceTotal == null || !Number.isFinite(priceTotal)) continue;

    const adLink = `https://re.kufar.by/vi/${ad.ad_id}`;
    if (!isPlausiblePrice(dealType, priceTotal)) {
      excluded.push({ dealType, priceTotal, adLink });
      continue;
    }

    const district = getAdParam(ad, 'area')?.vl || null;
    const parkingCode = getAdParam(ad, 'garage_parking_type')?.v;
    const parkingType = parkingCode != null ? PARKING_TYPE_LABELS[Number(parkingCode)] ?? null : null;

    offers.push({
      source: 'Kufar',
      ad_id: String(ad.ad_id),
      deal_type: dealType,
      property_type: 'Машиноместа',
      building_type: parkingType,
      size: null,
      price_per_sqm: null,
      price_total: priceTotal,
      floor: null,
      district,
      address,
      ad_link: adLink,
    });
  }
  return offers;
}

async function main() {
  const excluded = [];
  const offers = [];

  for (const dealSlug of ['snyat', 'kupit']) {
    const dealType = dealSlug === 'snyat' ? 'rent' : 'sale';
    console.log(`Kufar: тяну «Машиноместа» по всему Минску (${dealSlug})...`);
    const ads = await fetchAllKufar(dealSlug);
    const extracted = extractOffers(ads, dealType, excluded);
    console.log(`Kufar (${dealSlug}): получено ${ads.length}, из них годных — ${extracted.length}`);
    offers.push(...extracted);
  }

  if (excluded.length > 0) {
    console.log(`Отфильтровано ${excluded.length} объявлений с неправдоподобной ценой за объект:`);
    console.table(excluded);
  }

  if (offers.length === 0) {
    console.log('Машиномест не нашлось, в базу нечего писать.');
    return;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(offers));
    return;
  }

  console.log(`Итого ${offers.length} объявлений.`);

  if (DRY_RUN) {
    console.log('--dry-run: запись в Supabase пропущена.');
    return;
  }

  const now = new Date().toISOString();
  const payload = offers.map((o) => ({ ...o, segment: SEGMENT, updated_at: now }));

  const { error: upsertError } = await supabase
    .from('citywide_offers')
    .upsert(payload, { onConflict: 'segment,source,ad_id' });
  if (upsertError) throw upsertError;

  const idsThisRun = offers.map((o) => o.ad_id);
  const { error: deleteError } = await supabase
    .from('citywide_offers')
    .delete()
    .eq('segment', SEGMENT)
    .eq('source', 'Kufar')
    .not('ad_id', 'in', `(${idsThisRun.length ? idsThisRun.map((id) => `"${id}"`).join(',') : '""'})`);
  if (deleteError) throw deleteError;

  console.log(`Сохранено ${payload.length} объявлений в citywide_offers (сегмент ${SEGMENT}).`);
}

main().catch((err) => {
  console.error('Синхронизация не удалась:', err);
  process.exit(1);
});
