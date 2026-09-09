// Раз в месяц (см. .github/workflows/sync-market-offers-stats.yml) собирает с
// Kufar (re.kufar.by — у Kufar недвижимость на отдельном поддомене со своим
// SSR-фронтендом, не общий www.kufar.by) публичные объявления коммерческой
// недвижимости по Минск Миру и сохраняет СЫРЫЕ объявления (не готовый
// агрегат) в public.market_offers — владелец верифицирует/правит статус
// отделки вручную на /admin/market-offers (см. MarketOffersReview.tsx),
// таблица на гиде района считается прямо из этих строк на лету.
//
// Как достаём данные без авторизации и без обхода антибота: re.kufar.by —
// Next.js SPA, для обычных браузеров отдаёт пустой __NEXT_DATA__ с одним
// флагом isSearchBot. Но если представиться поисковым ботом (User-Agent
// Googlebot) — сайт делает полный SSR специально для SEO, и та же самая
// json-структура (props.initialState.listing.ads) приходит с реальными
// объявлениями и их атрибутами (проверено вручную на реальном ответе).
// Это официально поддерживаемый ботами путь (SSR-рендеринг для краулеров),
// а не обход защиты.
//
// Геопривязка к Минск Миру: у Kufar нет отдельного фильтра "микрорайон", у
// district-фильтра (coder_district-28 / slug minsk-oktyabrskij-rajon) —
// это целый Октябрьский район Минска, Минск Мир в нём лишь часть (проверено:
// в одном и том же ответе вперемешку словосочетания вроде "Свердлова" и
// "Кирова" — старый центр города, никак не Минск Мир). Поэтому фильтруем
// сами по названиям улиц самого Минск Мира (см. MINSK_MIR_MARKERS) — они уже
// встречаются в остальном коде гида района (см. src/pages/DistrictGuidePage.tsx:
// П. Мстиславца — адрес застройщика, Кижеватова — поликлиника раздела
// "Медицина"). Список сверен и по координатам объявлений (расстояние до
// центра комплекса ~53.8628,27.5470 — улицы Минск Мира почти все ≤1.4 км,
// улицы вне комплекса — от 2 км).
//
// Состояние отделки — сначала пробуем угадать сами (НЕ по тексту описания —
// ненадёжно, см. историю с банками в CLAUDE.md, а по готовым структурным
// полям Kufar: commercial_repair, иначе тег "С отделкой" в commercial_
// improvements), но большинство объявлений (см. живую проверку — владелец,
// август 2026) этого поля вообще не заполняют — "не указано" доминирует.
// Владелец решил разбирать вручную на /admin/market-offers — там же он может
// поправить и остальные поля (цена/тип/площадь), не только отделку. Поэтому
// при повторном синке (раз в месяц) для строк с reviewed=true ничего не
// перезаписывается — только подтверждается, что объявление ещё активно.

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

const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const PAGE_SIZE = 30;
const MAX_PAGES = 40; // страховка от бесконечного цикла, реальных страниц заметно меньше

// Улицы и топонимы Минск Мира — сверено вручную (адрес застройщика и адреса
// объектов инфраструктуры уже встречаются в src/pages/DistrictGuidePage.tsx)
// и перепроверено по координатам объявлений Kufar (см. комментарий выше).
const MINSK_MIR_MARKERS = [
  'николы теслы',
  'игоря лученка',
  'михаила савицкого',
  'жореса алфёрова',
  'жореса алферова',
  'мстиславца',
  'кижеватова',
  'минск-мир',
  'минск мир',
  'minsk world',
  'тропические острова',
];

const DEAL_TYPES = [
  { slug: 'kupit', dealType: 'sale' },
  { slug: 'snyat', dealType: 'rent' },
];

function isMinskMirAddress(address) {
  if (!address) return false;
  const lower = address.toLowerCase();
  return MINSK_MIR_MARKERS.some((marker) => lower.includes(marker));
}

function getAdParam(ad, code) {
  return (ad.ad_parameters || []).find((p) => p.p === code) ?? null;
}

function getAccountParam(ad, code) {
  return (ad.account_parameters || []).find((p) => p.p === code) ?? null;
}

function classifyFinishStatus(ad) {
  const repair = getAdParam(ad, 'commercial_repair');
  if (repair?.vl) {
    return repair.vl === 'Офисная отделка' ? 'с отделкой' : 'без отделки';
  }
  const improvements = getAdParam(ad, 'commercial_improvements');
  if (Array.isArray(improvements?.vl) && improvements.vl.includes('С отделкой')) {
    return 'с отделкой';
  }
  return 'не указано';
}

// --- Бизнес-апартаменты (МБА) ---
//
// Владелец (2026-09-09): "на вторичке во вторичном рынке не хватает
// апартаментов". В отличие от Офисов/Торговых/Кладовых — это НЕ отдельная
// категория объявлений на Kufar (там просто "Квартиры", 1010, без единого
// структурного поля, отличающего многофункциональный бизнес-апартамент от
// рядовой квартиры на той же улице — проверено вживую по ad_parameters).
// Единственный надёжный способ — точный список известных зданий МБА +
// поиск ПО КОНКРЕТНОМУ АДРЕСУ (тот же приём, что уже отработан для
// бизнес-центров, см. addressMatchesBuilding в sync-business-center-offers.mjs
// — номер дома сравнивается как отдельный токен, не подстрокой).
//
// Список зданий собран из bir.by (официальный портал застройщика — даёт
// внутренний house-код и слаг дома, но НЕ физический адрес для ещё не
// сданных корпусов), сторонних статей (realt.by/myfin.by/blisch.by) и
// прямых уточнений владельца в переписке (2026-09-09). На bir.by ни один
// МБА-дом Минск Мира ещё не в статусе "Сдано" (проверено вживую,
// ajax/get-search-objects-new type=live vid[]=Апартаменты stage[]=Сдано —
// пустой ответ) — все актуальные объявления вторички на эти адреса
// касаются ещё строящихся корпусов (переуступка/бронь), это ожидаемо, не
// баг матчинга.
//
// Квартал "Звёздный" (Орион/Андромеда/Сириус/Вега, плюс Лира с уже
// известным адресом ниже) — у 4 из 5 корпусов номер дома пока не найден ни
// в одном открытом источнике (сам bir.by отдаёт только house-код "24.2.x"
// без адреса). Вместо угадывания — отдельный проход по названию квартала
// прямо в тексте адреса: объявления по ещё не пронумерованным зданиям
// Minsk World на Kufar продавцы подписывают буквально "квартал Звёздный,
// экспериментальный многофункциональный комплекс Минск-Мир" (то же самое
// подтверждено вживую и для квартала "Австралия и Океания" — там при этом
// есть здания С уже известным адресом, отсюда APARTMENT_QUARTER_QUERIES
// как ДОПОЛНИТЕЛЬНЫЙ, не единственный проход поверх APARTMENT_BUILDINGS).
//
// Realt.by сюда сознательно НЕ подключён (в отличие от коммерческой
// недвижимости выше) — у квартир в микрорайоне "Минск-Мир" на Realt тысячи
// объявлений (проверено вживую — 3300+ на продажу одних только квартир), а
// точечного поиска по адресу для Realt не нашли (тот же вывод, что уже
// зафиксирован в sync-business-center-offers.mjs про Realt для БЦ — есть
// внутренний /api/objects/search, но параметры не разгаданы). Перебрать
// весь микрорайон целиком ради дюжины конкретных домов было бы
// непропорционально медленно и спамно для источника — если найдётся
// рабочий способ сузить Realt-поиск, можно будет добавить вторым
// источником так же, как Kufar. Список честно неполный (см. пробелы
// "Звёздного" выше) — Светлана верифицирует то, что нашлось, а не
// исчерпывающий каталог всех МБА района.
const APARTMENT_BUILDINGS = [
  { label: 'Эверест', street: 'николы теслы', house: '33' },
  { label: 'Континенталь', street: 'брилевская', house: '54' },
  { label: 'Каспиан', street: 'игоря лученка', house: '18' },
  { label: 'Медитерраниан', street: 'игоря лученка', house: '22' },
  { label: 'Атлантик', street: 'мира', house: '7' },
  { label: 'Пацифик', street: 'михаила савицкого', house: '29' },
  { label: 'Адриатик', street: 'михаила савицкого', house: '27' },
  // Без известного бренда дома — владелец назвал только адрес.
  { label: 'Жореса Алфёрова, 22', street: 'жореса алфёрова', house: '22' },
  { label: 'Михаила Савицкого, 24', street: 'михаила савицкого', house: '24' },
  { label: 'Лира (квартал Звёздный)', street: 'площадь старый аэропорт', house: '2' },
];

// Дополнительный проход поверх APARTMENT_BUILDINGS — ловит корпуса без
// известного номера дома по названию квартала прямо в тексте адреса (см.
// комментарий выше).
const APARTMENT_QUARTER_QUERIES = ['Звёздный', 'Австралия и Океания'];
const APARTMENT_QUARTER_MARKERS = ['звёздный', 'звездный', 'австралия и океания'];

function normalizeForApartmentMatch(s) {
  return (s || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Тот же приём, что и addressMatchesBuilding в sync-business-center-offers.mjs
// (тот же класс бага там уже пойман — номер дома надо сравнивать как
// отдельный токен, не подстрокой, иначе "2" ложно совпадёт с "22"/"2к1").
// Улица "мира" (Атлантик, просп. Мира, 7) — короткое слово, реальный риск
// ложного совпадения внутри другого слова (например, "Владимира" в имени
// или названии другой улицы) при обычном includes(). Поэтому и улица, и
// номер дома проверяются одинаково — как отдельная фраза с границами
// (сосед — не буква, не цифра), не произвольной подстрокой.
function addressMatchesApartmentBuilding(adAddress, building) {
  if (!adAddress) return false;
  const norm = normalizeForApartmentMatch(adAddress);

  const streetNorm = normalizeForApartmentMatch(building.street);
  const streetEscaped = streetNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const streetRe = new RegExp(`(^|[^a-zа-я])${streetEscaped}([^a-zа-я]|$)`, 'i');
  if (!streetRe.test(norm)) return false;

  const houseNorm = normalizeForApartmentMatch(building.house);
  const houseEscaped = houseNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const houseRe = new RegExp(`(^|[^a-zа-я0-9])${houseEscaped}([^a-zа-я0-9]|$)`, 'i');
  return houseRe.test(norm);
}

function matchesApartmentQuarterMarker(adAddress) {
  if (!adAddress) return false;
  const norm = normalizeForApartmentMatch(adAddress);
  return APARTMENT_QUARTER_MARKERS.some((marker) => norm.includes(normalizeForApartmentMatch(marker)));
}

// flat_repair — отдельное структурное поле у квартир/апартаментов, НЕ то
// же самое, что commercial_repair у коммерческих (классификация выше).
// Полная шкала (проверено вживую по filters.metadata.parameters.refs):
// 1 Косметический / 5 Евро / 10 Дизайнерский — реальная законченная
// отделка → "с отделкой"; 15 Строительная отделка / 20 Без отделки /
// 22 Требуется ремонт / 25 Аварийное состояние — требует работ или голое
// помещение → "без отделки".
const APARTMENT_FINISH_CODES_DONE = new Set(['1', '5', '10']);
function classifyApartmentFinishStatus(ad) {
  const repair = getAdParam(ad, 'flat_repair');
  if (repair?.v == null) return 'не указано';
  return APARTMENT_FINISH_CODES_DONE.has(String(repair.v)) ? 'с отделкой' : 'без отделки';
}

// Живые проверки (владелец, август 2026): в цене за м² попадаются явно
// битые значения — "цена по запросу" без реальной цифры (0 / $0.01 / $0.67
// за м²/мес) и минимум один явный выброс ($29 583/м² на продаже — 72 м² на
// ул. Игоря Лученка 4, при рынке района $1–13 тыс/м²). Границы широкие и
// намеренно НЕ пытаются угадывать "подозрительно круглые" цены (например,
// серия одинаковых $990/$1035 в одном доме на Савицкого 39 — возможно,
// ошибка продавца, а возможно, реальная акция; граница их не трогает) —
// только отсекают то, что математически не может быть ценой. Остальную
// сверку (в т.ч. такие подозрительные случаи) владелец делает сам на
// /admin/market-offers.
const PRICE_BOUNDS = {
  sale: { min: 300, max: 15000 },
  rent: { min: 5, max: 150 },
};

function isPlausiblePrice(dealType, pricePerSqm) {
  const bounds = PRICE_BOUNDS[dealType];
  return pricePerSqm >= bounds.min && pricePerSqm <= bounds.max;
}

// 2026-08-27: Светлана обнаружила, что в очереди верификации 9 из 10 ссылок
// не открываются ("Объявление уже не активно") — расследование (см. журнал
// CLAUDE.md) показало не баг импорта, а то, что синк никогда не проверял,
// пропали ли уже известные необработанные объявления с источника: если
// ad_id не попал в свежий скрейп (продавец снял объявление), строка так и
// оставалась в очереди навечно, реального объявления по ссылке уже не было.
// Разовая чистка сделана вручную; здесь — постоянное решение: на каждом
// синке проверяем реальным HTTP-запросом (не просто "не нашли в свежем
// скрейпе" — это могло быть и попаданием за MAX_PAGES/фильтр цены, а не
// реальным снятием) те необработанные строки, которых нет в этом прогоне —
// и то, что подтверждённо отдаёт 404, помечаем "Не подходит" с пояснением,
// не оставляя мёртвую ссылку в очереди Светланы.
async function checkLinkAlive(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': GOOGLEBOT_UA } });
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
    .eq('source', 'Kufar')
    .eq('reviewed', false)
    .eq('rejected', false)
    .eq('flagged_for_discussion', false)
    .not('ad_id', 'in', `(${adIdsThisRun.length ? adIdsThisRun.map((id) => `"${id}"`).join(',') : '""'})`);
  if (error) throw error;
  if (!candidates || candidates.length === 0) return;

  console.log(`Kufar: ${candidates.length} необработанных строк пропали из свежего скрейпа — проверяю ссылки...`);
  const deadIds = [];
  for (const c of candidates) {
    const alive = await checkLinkAlive(c.ad_link);
    if (alive === false) deadIds.push(c.id);
    await new Promise((r) => setTimeout(r, 300)); // не спамить источник частыми запросами подряд
  }

  if (deadIds.length === 0) {
    console.log('Kufar: подтверждённо мёртвых ссылок не найдено.');
    return;
  }

  const note = `Ссылка недоступна на источнике (проверено автоматически ${new Date().toLocaleDateString('ru-RU')} — HTTP 404 после редиректа)`;
  const { error: updateError } = await supabase
    .from('market_offers')
    .update({ rejected: true, reviewed: true, owner_note: note })
    .in('id', deadIds);
  if (updateError) throw updateError;

  console.log(`Kufar: ${deadIds.length} из ${candidates.length} пропавших строк подтверждённо мертвы — помечены "Не подходит".`);
}

// Сокращённый набор категорий (владелец, август 2026) — полное обоснование
// в комментарии над MARKET_PROPERTY_TYPES (src/data/marketOffers.ts).
// Kufar отдаёт property_type одной строкой из своего словаря на весь
// commercial-раздел разом (в отличие от Realt, где категория — часть URL,
// см. sync-realt-market-offers.mjs) — поэтому переименование/удаление
// категорий делаем тут, уже после получения, а не фильтрацией запроса.
const PROPERTY_TYPE_RENAME = {
  'Магазины, торговые помещения': 'Торговые помещения',
  Склады: 'Кладовые',
};
// "Промышленные помещения"/"Прочая коммерческая" как категории не нужны
// владельцу — новые такие объявления сразу попадают без категории (тот же
// смысл, что и у ручного сброса существующих строк в миграции). "Сфера
// услуг"/"Общепит" НЕ трогаем — эти по-прежнему нужны, Светлана
// перераспределяет их по этажу в Офисы/Торговые при верификации.
const UNCATEGORIZED_SOURCE_TYPES = new Set(['Промышленные помещения', 'Прочая коммерческая']);

function normalizePropertyType(rawType) {
  if (UNCATEGORIZED_SOURCE_TYPES.has(rawType)) return 'Без категории';
  return PROPERTY_TYPE_RENAME[rawType] ?? rawType;
}

async function fetchListingPage(slug, cursor) {
  const url = new URL(`https://re.kufar.by/l/minsk-oktyabrskij-rajon/${slug}/kommercheskaya`);
  url.searchParams.set('size', String(PAGE_SIZE));
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, {
    headers: {
      'User-Agent': GOOGLEBOT_UA,
      Accept: 'text/html',
      'Accept-Language': 'ru',
    },
  });

  if (!res.ok) {
    throw new Error(`Kufar (${slug}) вернул ${res.status} для ${url}`);
  }

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    throw new Error(`Kufar (${slug}): не нашёл __NEXT_DATA__ в ответе — вероятно, поменялась вёрстка`);
  }

  const data = JSON.parse(match[1]);
  const listing = data?.props?.initialState?.listing;
  if (!listing) {
    throw new Error(`Kufar (${slug}): не нашёл props.initialState.listing — вероятно, поменялась структура состояния`);
  }

  const nextPage = (listing.pagination || []).find((p) => p.label === 'next');
  return { ads: listing.ads || [], total: listing.total ?? 0, nextCursor: nextPage?.token ?? null };
}

async function fetchAllListings(slug) {
  const allAds = [];
  let cursor = null;
  let total = Infinity;

  for (let page = 0; page < MAX_PAGES && allAds.length < total; page++) {
    const result = await fetchListingPage(slug, cursor);
    total = result.total;
    if (result.ads.length === 0) break;
    allAds.push(...result.ads);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }

  return allAds;
}

function extractOffers(ads, dealType, excluded) {
  const offers = [];

  for (const ad of ads) {
    const address = getAccountParam(ad, 'address')?.v;
    if (!isMinskMirAddress(address)) continue;

    const propertyType = normalizePropertyType(getAdParam(ad, 'property_type')?.vl || 'Не указано');
    const size = getAdParam(ad, 'size')?.v ?? null;
    // НЕ ad_parameters.square_meter — это "Цена за м²" В ВАЛЮТЕ ПРОДАВЦА
    // (ad.currency: BYR/USD/EUR), не всегда USD (владелец поймал живой
    // случай: Жореса Алфёрова 16 — 35 БЕЛ.РУБ/м², платформа показывала как
    // $35/м², реально ≈$11.7/м² — тот же дубль на Realt честно показывал
    // $12/м²). Kufar сам отдаёт готовую конвертацию в USD на каждом
    // объявлении — price_usd (в центах, не рублях/долларах) — тот же приём,
    // что и в Realt-скрипте (priceRatesPerM2['840']), просто без готового
    // "за м²": делим сами на площадь. price_usd на листинговом эндпоинте
    // приходит СТРОКОЙ ("93897", не 93897 — проверено на живом ответе),
    // поэтому Number(), не typeof-проверка на number.
    const priceUsdCents = ad.price_usd != null ? Number(ad.price_usd) : NaN;
    const pricePerSqm =
      Number.isFinite(priceUsdCents) && size ? Math.round((priceUsdCents / 100 / size) * 100) / 100 : null;
    if (size == null || pricePerSqm == null) continue; // без площади/цены за м² в сводку не берём

    const adLink = `https://re.kufar.by/vi/${ad.ad_id}`;
    if (!isPlausiblePrice(dealType, pricePerSqm)) {
      excluded.push({ dealType, propertyType, size, pricePerSqm, adLink });
      continue;
    }

    // Этаж — доп. сигнал для поиска дублей (data/marketOffers.ts, dedupKey):
    // в одном доме часто много одинаковых по площади кабинетов на РАЗНЫХ
    // этажах — без этажа они ложно считались одним и тем же дублем.
    const floor = getAdParam(ad, 'floor')?.v?.[0] ?? null;

    offers.push({
      source: 'Kufar',
      ad_id: String(ad.ad_id),
      deal_type: dealType,
      property_type: propertyType,
      size,
      price_per_sqm: pricePerSqm,
      finish_status: classifyFinishStatus(ad),
      floor,
      address: address ?? null,
      ad_link: adLink,
    });
  }

  return offers;
}

// --- Бизнес-апартаменты: точечный поиск по адресу/названию квартала ---
// (см. большой комментарий у APARTMENT_BUILDINGS выше). В отличие от
// fetchListingPage/fetchAllListings (перебор ВСЕГО рынка по Минск Миру
// вручную) — используется полнотекстовый query= Kufar (тот же приём, что
// в sync-business-center-offers.mjs), результат всё равно перепроверяется
// addressMatchesApartmentBuilding/matchesApartmentQuarterMarker перед
// сохранением — query у Kufar не точный AND по словам, доверять ему
// напрямую нельзя.
const APARTMENT_PAGE_SIZE = 30;
const APARTMENT_MAX_PAGES = 15; // на одно здание/квартал объявлений заметно меньше, чем на весь рынок квартир

async function fetchApartmentListingPage(dealSlug, query, cursor) {
  const url = new URL(`https://re.kufar.by/l/minsk-oktyabrskij-rajon/${dealSlug}/kvartiru`);
  url.searchParams.set('query', query);
  url.searchParams.set('size', String(APARTMENT_PAGE_SIZE));
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, {
    headers: { 'User-Agent': GOOGLEBOT_UA, Accept: 'text/html', 'Accept-Language': 'ru' },
  });
  if (!res.ok) {
    throw new Error(`Kufar (апартаменты, ${dealSlug}, query="${query}") вернул ${res.status} для ${url}`);
  }

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) {
    throw new Error(`Kufar (апартаменты, ${dealSlug}, query="${query}"): не нашёл __NEXT_DATA__`);
  }

  const data = JSON.parse(match[1]);
  const listing = data?.props?.initialState?.listing;
  if (!listing) {
    throw new Error(`Kufar (апартаменты, ${dealSlug}, query="${query}"): не нашёл listing`);
  }

  const nextPage = (listing.pagination || []).find((p) => p.label === 'next');
  return { ads: listing.ads || [], nextCursor: nextPage?.token ?? null };
}

async function fetchAllApartmentListings(dealSlug, query) {
  const allAds = [];
  let cursor = null;
  for (let page = 0; page < APARTMENT_MAX_PAGES; page++) {
    const result = await fetchApartmentListingPage(dealSlug, query, cursor);
    if (result.ads.length === 0) break;
    allAds.push(...result.ads);
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return allAds;
}

// Собирает одно объявление в payload market_offers (или null, если цена
// неправдоподобная — тогда попадает в excluded, как и у остальных
// категорий). Общая часть между проходом по APARTMENT_BUILDINGS и проходом
// по APARTMENT_QUARTER_QUERIES — сам матчинг адреса у каждого свой,
// извлечение полей объявления — одинаковое.
function buildApartmentOffer(ad, dealType, excluded) {
  const address = getAccountParam(ad, 'address')?.v;
  const size = getAdParam(ad, 'size')?.v ?? null;
  // Тот же приём, что и в extractOffers выше (price_usd — центы, строкой).
  const priceUsdCents = ad.price_usd != null ? Number(ad.price_usd) : NaN;
  const pricePerSqm = Number.isFinite(priceUsdCents) && size ? Math.round((priceUsdCents / 100 / size) * 100) / 100 : null;
  if (size == null || pricePerSqm == null) return null;

  const adLink = `https://re.kufar.by/vi/${ad.ad_id}`;
  if (!isPlausiblePrice(dealType, pricePerSqm)) {
    excluded.push({ dealType, propertyType: 'Бизнес-апартаменты', size, pricePerSqm, adLink });
    return null;
  }

  const floor = getAdParam(ad, 'floor')?.v?.[0] ?? null;
  return {
    source: 'Kufar',
    ad_id: String(ad.ad_id),
    deal_type: dealType,
    property_type: 'Бизнес-апартаменты',
    size,
    price_per_sqm: pricePerSqm,
    finish_status: classifyApartmentFinishStatus(ad),
    floor,
    address: address ?? null,
    ad_link: adLink,
  };
}

async function collectApartmentOffers(excluded) {
  const offers = [];
  const seenAdIds = new Set();

  for (const building of APARTMENT_BUILDINGS) {
    for (const { slug, dealType } of DEAL_TYPES) {
      const query = `${building.street} ${building.house}`;
      console.log(`Kufar (апартаменты «${building.label}», ${slug}): ищу «${query}»...`);
      let ads;
      try {
        ads = await fetchAllApartmentListings(slug, query);
      } catch (err) {
        console.error(err.message);
        continue;
      }
      for (const ad of ads) {
        if (seenAdIds.has(ad.ad_id)) continue;
        const address = getAccountParam(ad, 'address')?.v;
        if (!addressMatchesApartmentBuilding(address, building)) continue;
        const offer = buildApartmentOffer(ad, dealType, excluded);
        if (!offer) continue;
        seenAdIds.add(ad.ad_id);
        offers.push(offer);
      }
      await new Promise((r) => setTimeout(r, 400)); // не спамить источник частыми запросами подряд
    }
  }

  for (const quarterQuery of APARTMENT_QUARTER_QUERIES) {
    for (const { slug, dealType } of DEAL_TYPES) {
      console.log(`Kufar (апартаменты, квартал «${quarterQuery}», ${slug}): ищу...`);
      let ads;
      try {
        ads = await fetchAllApartmentListings(slug, quarterQuery);
      } catch (err) {
        console.error(err.message);
        continue;
      }
      for (const ad of ads) {
        if (seenAdIds.has(ad.ad_id)) continue;
        const address = getAccountParam(ad, 'address')?.v;
        if (!matchesApartmentQuarterMarker(address)) continue;
        const offer = buildApartmentOffer(ad, dealType, excluded);
        if (!offer) continue;
        seenAdIds.add(ad.ad_id);
        offers.push(offer);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  console.log(`Kufar (апартаменты): найдено ${offers.length} объявлений (до дедупликации повторных публикаций).`);
  return dedupApartmentReposts(offers);
}

// Живая проверка (2026-09-09): на строящиеся корпуса МБА одна и та же
// планировка регулярно переопубликовывается под новым ad_id — на реальном
// прогоне у "Николы Теслы, 33" 448 объявлений свелись всего к 121
// уникальной паре (этаж, площадь), а самая частая пара (10 этаж, 48.5 м²)
// встретилась 37 раз почти с ОДНОЙ ценой (2 разных значения на все 37) —
// это не 37 разных квартир одной планировки, а повторные публикации той же
// продающейся ячейки (обычная практика застройщика/агентства для
// поднятия объявления в выдаче на ещё не сданном доме, не баг парсинга).
// Заливать всё как есть — заспамить очередь верификации Светланы тысячей
// почти одинаковых карточек ради дюжины реальных типов планировок.
// Оставляем по ОДНОЙ (самой дешёвой — не гадаем, какая "актуальнее") строке
// на уникальную комбинацию (адрес, тип сделки, этаж, площадь) — если
// действительно продаются РАЗНЫЕ квартиры того же метража на одном этаже,
// они и так неотличимы друг от друга по доступным на Kufar данным (нет
// номера квартиры), не только для этого скрипта.
function dedupApartmentReposts(offers) {
  const byKey = new Map();
  for (const o of offers) {
    const key = `${o.address}|${o.deal_type}|${o.floor}|${o.size.toFixed(1)}`;
    const existing = byKey.get(key);
    if (!existing || o.price_per_sqm < existing.price_per_sqm) {
      byKey.set(key, o);
    }
  }
  const deduped = [...byKey.values()];
  console.log(`Kufar (апартаменты): после дедупликации повторных публикаций — ${deduped.length} строк.`);
  return deduped;
}

async function main() {
  const offers = [];
  const excluded = [];
  for (const { slug, dealType } of DEAL_TYPES) {
    console.log(`Kufar: тяну объявления (${slug})...`);
    const ads = await fetchAllListings(slug);
    console.log(`Kufar (${slug}): получено ${ads.length} объявлений по Октябрьскому району`);

    const extracted = extractOffers(ads, dealType, excluded);
    console.log(`Kufar (${slug}): из них по Минск Миру — ${extracted.length} объявлений`);
    offers.push(...extracted);
  }

  // Сбор апартаментов ОТКЛЮЧЁН (владелец, 2026-09-09) — сразу на следующий
  // день после запуска этого сегмента выяснилось: все 9 известных зданий
  // МБА в Минск Мире на bir.by (официальный портал застройщика) до сих пор
  // в статусе "Строится" — ни одно ещё не сдано (`stage[]=Сдано` для
  // `vid[]=Апартаменты` даёт пустой ответ). Владелец засомневался, что
  // "вторичные" объявления на Kufar на самом деле независимые переуступки
  // от собственников — не исключено, что часть из них агентства просто
  // перевыкладывают тот же пул квартир от застройщика под своим брендом
  // (та же схема, что уже подтверждена для готового арендного бизнеса в
  // других сегментах). Отличить одно от другого по адресу дома нельзя —
  // 684 уже собранные строки удалены из market_offers (все были
  // reviewed=false, ничья ручная работа Светланы не пострадала). Оставить
  // 'Бизнес-апартаменты' в MARKET_PROPERTY_TYPES (data/marketOffers.ts) —
  // не мешает, просто неактивная категория, пригодится, когда здания
  // реально начнут сдаваться и на рынке появится настоящая переуступка.
  // Если решите включать заново — collectApartmentOffers() ниже в этом же
  // файле не удалена, просто раскомментировать строку.
  // offers.push(...(await collectApartmentOffers(excluded)));

  if (excluded.length > 0) {
    console.log(`Kufar: отфильтровано ${excluded.length} объявлений с неправдоподобной ценой за м² (границы: продажа ${PRICE_BOUNDS.sale.min}–${PRICE_BOUNDS.sale.max} $/м², аренда ${PRICE_BOUNDS.rent.min}–${PRICE_BOUNDS.rent.max} $/м²/мес) — стоит бегло свериться по ссылкам:`);
    console.table(excluded);
  }

  if (offers.length === 0) {
    console.log('Kufar: по Минск Миру ничего не нашлось, в базу нечего писать.');
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
  // reviewed=true защищает ВСЮ строку (не только отделку — владелец может
  // поправить и цену, и тип, и площадь, если Kufar отдал их неверно), синк
  // для таких строк только подтверждает, что объявление всё ещё живо.
  const adIds = offers.map((o) => o.ad_id);
  const { data: existing, error: fetchError } = await supabase
    .from('market_offers')
    .select('ad_id, deal_type, property_type, size, price_per_sqm, finish_status, floor, has_terrace, terrace_area, address, reviewed')
    .eq('source', 'Kufar')
    .in('ad_id', adIds);
  if (fetchError) throw fetchError;

  const reviewedByAdId = new Map((existing ?? []).filter((e) => e.reviewed).map((e) => [e.ad_id, e]));

  const now = new Date().toISOString();
  const payload = offers.map((o) => {
    const reviewedRow = reviewedByAdId.get(o.ad_id);
    if (reviewedRow) {
      return { ...o, ...reviewedRow, reviewed: true, updated_at: now };
    }
    return { ...o, reviewed: false, updated_at: now };
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
