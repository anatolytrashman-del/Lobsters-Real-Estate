// Первичный рынок Минск Мира (bir.by, портал застройщика Dana Holdings) —
// владелец попросил построить блок аналитики (2026-08-24): "апарты и
// остальная коммерция" — обычные квартиры (vid=Квартира) сознательно НЕ
// собираем, только бизнес-апартаменты + коммерческие помещения (торговые/
// офисы по этажу) + кладовые + машиноместа. Машиноместа этот скрипт НЕ
// собирает сам (тот же исходный срез уже был спарсен для блока "Паркинги"
// на этой же странице раньше в сессии, per-объявление данные лежали в
// scratchpad, а не в этом скрипте) — в primary_market_offers они
// дозагружены отдельным разовым запуском по сохранённым сырым данным
// (категории 'Машиноместа (крытые)'/'Машиноместа (подземные)', та же
// граница по цене 9900 → 13000 €, что определяет деление в "Паркинги").
// Карточки в "Паркинги" (parkingSegments/parkingAddresses) остаются
// статическими агрегатами count/area — цены там убраны намеренно
// (владелец), сравнение цены за м² теперь только в таблице
// "Первичный рынок".
//
// bir.by рендерит таблицу через AJAX (сама HTML-страница отдаёт пустой
// <tbody>, наполняется JS) — эндпоинт найден в инлайновом <script> каждой
// категорийной страницы: POST bir.by/ajax/get-search-objects-new/
// (type=live — квартиры/апартаменты, type=pantry — кладовые) и
// POST bir.by/ajax/get-search-objects-com/ (type=com — коммерческие).
// Один запрос с большим limit отдаёт весь срез сразу — домен открыт
// напрямую, без обхода защиты (проверено на машиноместах в этой же
// сессии, см. журнал SEO_PLAN.md).
//
// Терраса — только у коммерческих (у квартир/апартаментов/кладовых этот
// столбец в разметке bir.by закомментирован, данных там нет). У
// коммерческих bir.by отдаёт три числа: общая площадь (с террасой),
// "Помещение м²" (чистая) и "Терраса м²" отдельно — сохраняем общую
// площадь + террасу отдельно (тот же паттерн size/hasTerrace/terraceArea,
// что у market_offers для Kufar/Realt, см. src/data/marketOffers.ts),
// чистая площадь и цена за чистый м² считаются на лету в коде читателя,
// не хранятся отдельно. На реальной записи проверено: официальная "Цена
// за м²" bir.by считается по ОБЩЕЙ площади (с террасой) — то же
// искажение, что у Kufar/Realt, только здесь его можно поправить
// автоматически (данные уже структурированы), без ручной верификации в
// админке — владелец подтвердил, что она тут не нужна.
//
// Торговые/офисы — bir.by сам не делит коммерческие по этажу, делим сами
// по полю "Этаж" при записи: 1 этаж = торговые помещения, 2 и выше —
// офисы (владелец).
//
// Сданные дома — не отдельная категория, а статус ("Сдано"/"Строится") у
// тех же апартаментов (владелец: "сданные дома фиксируем и выводим
// отдельно, по ним стоит сравнивать цену с вторичкой") — два отдельных
// запроса с фильтром stage[], статус пишется в колонку `stage`.
//
// Ссылка на объявление сохраняется у каждой строки (owner: "у каждого
// помещения есть своя ссылка, эту ссылку нужно фиксировать") — общая
// практика проекта для внешних источников, не только на случай террас.
//
// Автозапуск и чистка проданных/снятых объектов (2026-09-10, владелец:
// "автоматически парсить рынок первички 1-го числа и обновлять инфу") —
// раньше этот скрипт существовал, но не был подключён ни к одному
// расписанию вовсе (был только .github/workflows/sync-market-offers-stats.yml
// для Kufar/Realt) — первичка не обновлялась автоматически никогда, только
// разовыми ручными прогонами. Теперь — .github/workflows/sync-bir-primary-market.yml,
// 1-го числа месяца.
//
// Проданные/снятые объекты — та же идея, что и pruneDeadOffers в
// sync-kufar-market-offers.mjs/sync-realt-market-offers.mjs (не доверять
// одному "не нашли в свежем скрейпе" — это может быть и сбоем скрейпа, не
// только продажей), но проще: у primary_market_offers нет ручной верификации
// (владелец подтвердил, что она тут не нужна), поэтому подтверждённо
// пропавшие строки не помечаются "не подходит", а удаляются по-настоящему —
// см. pruneStaleOffers ниже. HANDLED_CATEGORIES — категории, которые этот
// скрипт реально собирает; "Машиноместа (крытые/подземные)" сюда НЕ входят —
// та часть primary_market_offers дозагружена отдельным разовым запуском (см.
// комментарий в начале файла) и этим скриптом не обновляется вовсе — если
// не исключить эти категории явно, чистка стёрла бы их целиком при каждом
// прогоне (в свежем скрейпе их никогда и не будет).

import { createClient } from '@supabase/supabase-js';

const HANDLED_CATEGORIES = ['Бизнес-апартаменты', 'Кладовые', 'Торговые помещения', 'Офисы'];

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const JSON_OUT = process.argv.includes('--json');

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BASE = 'https://bir.by/';
const LIMIT = 6000; // страховка — реальных объявлений на порядок меньше (проверено на машиноместах)

// Комплекс фиксированный, не парсится из строки — каждый запрос уже
// отфильтрован по object[]=Minsk World, а сама разметка комплекса в
// разных строках слегка отличается (промо-бейдж/пробелы), не стабильна
// для регулярки.
const COMPLEX_NAME = '«Минск-Мир»';
const ID_RE = /data-loadobject="([a-f0-9-]+)"/;
const HOUSE_RE = /class="tableRowLink housename"[^>]*>([^<]*)<span>([^<]*)<\/span>/;
const PLAIN_CELL_RE = /<td class="table-search__item[^"]*"[^>]*>([^<]*)<\/td>/g;
// Только общая цена — цена за м² не хранится, считается читателем от
// площади (тот же принцип netSize/netPricePerSqm, что у market_offers).
const PRICE_TOTAL_RE = /<p class="costNum">([^<]*)<i[^>]*><\/i><\/p><span class="tprice[^"]*">([^<]*)<\/span>/;
const LINK_RE = /href="(\/object\/[a-f0-9-]+)"/;

function parseNum(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/ /g, ' ').replace(/[^\d.,]/g, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function splitRows(html) {
  return html.split(/(?=<tr[^>]*data-loadobject=)/).filter((r) => r.includes('data-loadobject'));
}

// Разбирает одну строку таблицы в набор сырых полей — общий для всех
// категорий (квартиры/апартаменты и кладовые дают 4 "простых" ячейки
// между домом и ценой — №/этаж/площадь/год; коммерческие дают 6 — №/этаж/
// площадь общая/площадь чистая/терраса/год), маппинг конкретных полей
// решает вызывающий код по количеству ячеек.
function parseRow(rowHtml) {
  const idMatch = rowHtml.match(ID_RE);
  if (!idMatch) return null;
  const houseMatch = rowHtml.match(HOUSE_RE);
  const plainCells = [...rowHtml.matchAll(PLAIN_CELL_RE)].map((m) => m[1].trim());
  const priceTotalMatch = rowHtml.match(PRICE_TOTAL_RE);
  const linkMatch = rowHtml.match(LINK_RE);
  return {
    id: idMatch[1],
    complex: COMPLEX_NAME,
    house: houseMatch ? houseMatch[1].trim() || null : null,
    address: houseMatch ? houseMatch[2].trim() || null : null,
    plainCells,
    priceTotalByn: priceTotalMatch ? parseNum(priceTotalMatch[1]) : null,
    priceTotalEur: priceTotalMatch ? parseNum(priceTotalMatch[2]) : null,
    link: linkMatch ? BASE + linkMatch[1].replace(/^\//, '') : null,
  };
}

async function fetchSearch(endpoint, params) {
  const body = new URLSearchParams({ limit: String(LIMIT), ...params });
  const res = await fetch(BASE + endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body,
  });
  if (!res.ok) throw new Error(`bir.by ${endpoint} → HTTP ${res.status}`);
  const html = await res.text();
  return splitRows(html).map(parseRow).filter(Boolean);
}

// --- Бизнес-апартаменты (vid=Апартаменты), два прохода по stage[] ---
async function fetchApartments() {
  const rows = [];
  for (const stage of ['Сдано', 'Строится']) {
    const parsed = await fetchSearch('ajax/get-search-objects-new/', {
      type: 'live',
      'object[]': 'Minsk World',
      'vid[]': 'Апартаменты',
      'stage[]': stage,
    });
    for (const r of parsed) {
      // plainCells: [№, этаж, площадь, год]
      const [, floor, area, year] = r.plainCells;
      if (r.priceTotalByn == null || area == null) continue;
      rows.push({
        source: 'bir.by',
        external_id: r.id,
        category: 'Бизнес-апартаменты',
        complex: r.complex,
        house: r.house,
        unit_number: r.plainCells[0] ?? null,
        floor: parseNum(floor),
        area_m2: parseNum(area),
        terrace_area_m2: null,
        year_handover: parseNum(year),
        stage,
        price_total_byn: r.priceTotalByn,
        price_total_eur: r.priceTotalEur,
        ad_link: r.link,
      });
    }
  }
  return rows;
}

// --- Кладовые (type=pantry) — та же форма строки, что у апартаментов, без stage ---
async function fetchPantry() {
  const parsed = await fetchSearch('ajax/get-search-objects-new/', {
    type: 'pantry',
    'object[]': 'Minsk World',
  });
  return parsed
    .filter((r) => r.priceTotalByn != null && r.plainCells[1] != null)
    .map((r) => {
      const [unit, , area, year] = r.plainCells;
      return {
        source: 'bir.by',
        external_id: r.id,
        category: 'Кладовые',
        complex: r.complex,
        house: r.house,
        unit_number: unit ?? null,
        floor: null,
        area_m2: parseNum(area),
        terrace_area_m2: null,
        year_handover: parseNum(year),
        stage: null,
        price_total_byn: r.priceTotalByn,
        price_total_eur: r.priceTotalEur,
        ad_link: r.link,
      };
    });
}

// --- Коммерческие (type=com) — 6 простых ячеек (№, этаж, площадь общая,
// площадь чистая, терраса, год); делим на Торговые/Офисы по этажу ---
async function fetchCommercial() {
  const parsed = await fetchSearch('ajax/get-search-objects-com/', {
    type: 'com',
    'object[]': 'Minsk World',
  });
  return parsed
    .filter((r) => r.priceTotalByn != null && r.plainCells[2] != null)
    .map((r) => {
      const [unit, floor, areaTotal, , terrace, year] = r.plainCells;
      const floorNum = parseNum(floor);
      const category = floorNum === 1 ? 'Торговые помещения' : 'Офисы';
      return {
        source: 'bir.by',
        external_id: r.id,
        category,
        complex: r.complex,
        house: r.house,
        unit_number: unit ?? null,
        floor: floorNum,
        area_m2: parseNum(areaTotal),
        terrace_area_m2: parseNum(terrace),
        year_handover: parseNum(year),
        stage: null,
        price_total_byn: r.priceTotalByn,
        price_total_eur: r.priceTotalEur,
        ad_link: r.link,
      };
    });
}

// Тот же приём, что и checkLinkAlive в sync-kufar-market-offers.mjs/
// sync-realt-market-offers.mjs — реальный HTTP-запрос перед тем, как что-то
// удалять, не доверяем одному "пропало из свежего скрейпа". Честная
// оговорка: что именно отдаёт bir.by для проданного/снятого объекта — 404
// или, например, 200 с "объект недоступен" в теле — на живом прогоне до сих
// пор не проверялось (объекты в базе никогда раньше не пропадали настолько
// массово, чтобы поймать такой случай). Если окажется, что это не 404 —
// проверка просто ничего не найдёт и строки останутся висеть (безопасный
// исход, не наоборот) — тогда стоит поправить условие под реальный ответ.
async function checkLinkAlive(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      return res.status !== 404;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return null; // сеть не ответила дважды подряд — не судим, пропускаем строку
}

// Удаляет по-настоящему проданные/снятые объекты (см. большой комментарий в
// начале файла про HANDLED_CATEGORIES). Скоуп — ТОЛЬКО категории, которые
// этот скрипт реально собирает, и ТОЛЬКО те из них, где свежий скрейп дал
// хоть один результат (пустой список для категории — вероятнее сбой
// скрейпа, чем "распродали всё подчистую разом" — в этом случае существующие
// строки этой категории не трогаем вовсе, до следующего прогона).
async function pruneStaleOffers(offers) {
  const freshIdsByCategory = new Map(HANDLED_CATEGORIES.map((c) => [c, new Set()]));
  for (const o of offers) {
    if (freshIdsByCategory.has(o.category)) freshIdsByCategory.get(o.category).add(o.external_id);
  }

  const deadIds = [];
  for (const category of HANDLED_CATEGORIES) {
    const freshIds = freshIdsByCategory.get(category);
    if (freshIds.size === 0) {
      console.log(`bir.by (${category}): свежий скрейп дал 0 объявлений — похоже на сбой, существующие строки не трогаю.`);
      continue;
    }

    const { data: candidates, error } = await supabase
      .from('primary_market_offers')
      .select('id, external_id, ad_link')
      .eq('source', 'bir.by')
      .eq('category', category)
      .not('external_id', 'in', `(${[...freshIds].map((id) => `"${id}"`).join(',')})`);
    if (error) throw error;
    if (!candidates || candidates.length === 0) continue;

    console.log(`bir.by (${category}): ${candidates.length} строк пропало из свежего скрейпа — проверяю ссылки...`);
    for (const c of candidates) {
      const alive = c.ad_link ? await checkLinkAlive(c.ad_link) : null;
      if (alive === false) deadIds.push(c.id);
      await new Promise((r) => setTimeout(r, 300)); // не спамить источник частыми запросами подряд
    }
  }

  if (deadIds.length === 0) {
    console.log('bir.by: подтверждённо проданных/снятых объектов не найдено.');
    return;
  }

  const { error: deleteError } = await supabase.from('primary_market_offers').delete().in('id', deadIds);
  if (deleteError) throw deleteError;
  console.log(`bir.by: ${deadIds.length} проданных/снятых объектов удалено из primary_market_offers.`);
}

async function main() {
  const [apartments, pantry, commercial] = await Promise.all([fetchApartments(), fetchPantry(), fetchCommercial()]);
  const offers = [...apartments, ...pantry, ...commercial];

  const byCategory = offers.reduce((acc, o) => {
    acc[o.category] = (acc[o.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log('bir.by: собрано по категориям —', JSON.stringify(byCategory));

  if (JSON_OUT) {
    console.log(JSON.stringify(offers));
  }

  if (DRY_RUN) {
    console.log('--dry-run: запись в Supabase пропущена.');
    return;
  }

  if (offers.length === 0) {
    console.log('bir.by: ничего не нашлось, в базу нечего писать.');
    return;
  }

  const { error } = await supabase
    .from('primary_market_offers')
    .upsert(offers, { onConflict: 'source,external_id' });
  if (error) throw error;
  console.log(`Сохранено ${offers.length} объявлений в primary_market_offers.`);

  await pruneStaleOffers(offers);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
