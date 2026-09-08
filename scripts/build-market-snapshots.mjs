// Собирает business_center_offers (объявления о продаже/аренде помещений
// внутри конкретных БЦ, см. sync-business-center-offers.mjs) в месячные
// агрегаты — public.market_snapshots — для раздела аналитики рынка
// (ANALYTICSPLAN.md, спринт 1). Один снимок = (период, сегмент, сделка,
// срез, ключ среза) → n/медиана/p25/p75, без перезаписи истории (снимки
// за прошлые месяцы не трогаются, только upsert по текущему периоду).
//
// Два сегмента с реальными данными:
// - 'ofisy_bc' (офисы в бизнес-центрах, city-wide) — из
//   business_center_offers, привязка к business_centers.business_class/
//   district; срезы city/class/district. Дедупликации Kufar↔Realt тут НЕТ —
//   у business_center_offers нет ни ручного review-флоу (см. комментарий в
//   sync-business-center-offers.mjs), ни общего dedup-ключа между
//   источниками — известное ограничение, отражено в /minsk/analytics/metodika.
// - 'torgovye' (торговые помещения, city-wide) — из citywide_offers
//   (см. sync-citywide-retail-offers.mjs), срезы city/district/building_type
//   (building_type — не у всех строк заполнен, см. её же комментарий про
//   разницу Kufar/Realt). Дедупликация Kufar↔Realt тут ЕСТЬ, но уже сделана
//   в самом sync-скрипте на этапе сбора, не здесь.
// - 'sklady' (склады, city-wide) — из citywide_offers (см.
//   sync-citywide-warehouse-offers.mjs), срезы city/district ТОЛЬКО — без
//   building_type: у складов оно почти всегда пусто (358 из 474 на первом
//   реальном прогоне) и, когда заполнено, малоинформативно для складов
//   конкретно (то же общее поле commercial_building, что и у розницы, не
//   специализированное под складской класс/направление — тех данных у
//   источников нет вовсе, см. комментарий в самом sync-скрипте).
// - 'mashinomesta' (машиноместа, city-wide, только Kufar — см.
//   sync-citywide-parking-offers.mjs) — ЦЕНА ЗА ОБЪЕКТ ЦЕЛИКОМ, не за м²:
//   агрегируется по полю price_total (не price_per_sqm), unit снимков —
//   'usd_total'. Срезы city/district/building_type (последнее — тип
//   парковки: Подземная/Многоуровневая/Наземная/Открытая/На крыше).
// Остальные сегменты плана (офисы вне БЦ/первичка/ГАБ) не собираются — для
// них нет ни скрапа, ни таблицы (ANALYTICSPLAN.md §3.1 п.2).
//
// Перед агрегацией внутри каждого среза — фильтр price_per_sqm>0 и обрезка
// по 5–95 перцентилю (ANALYTICSPLAN.md §3.1 п.4), но только при n≥8 — на
// совсем маленьких выборках обрезка перцентилями съедает и так скудные
// данные, смысла в ней нет.

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

const MIN_N_FOR_TRIM = 8;

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = p * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const frac = idx - lo;
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * frac;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  let trimmed = sorted;
  if (sorted.length >= MIN_N_FOR_TRIM) {
    const lo = percentile(sorted, 0.05);
    const hi = percentile(sorted, 0.95);
    trimmed = sorted.filter((v) => v >= lo && v <= hi);
    if (trimmed.length === 0) trimmed = sorted;
  }
  return {
    n: trimmed.length,
    median: round2(percentile(trimmed, 0.5)),
    p25: round2(percentile(trimmed, 0.25)),
    p75: round2(percentile(trimmed, 0.75)),
  };
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function firstOfMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// Общая агрегация: rows — объекты с deal_type + числовым полем-значением
// (по умолчанию price_per_sqm, но для машиномест — price_total, см.
// сегмент 'mashinomesta' ниже: там цена за объект целиком, не за м², своя
// единица 'usd_total' записывается в новую колонку market_snapshots.unit)
// + произвольным набором доп. полей для среза (extraSlices описывает,
// какие поля и в какой slice_type превращать). Всегда добавляет срез city
// ('all').
function buildSnapshotsForSegment(rows, segment, period, extraSlices, options = {}) {
  const valueField = options.valueField ?? 'price_per_sqm';
  const unit = options.unit ?? 'usd_per_sqm';
  const snapshots = [];
  for (const deal of ['rent', 'sale']) {
    const dealRows = rows.filter((r) => r.deal_type === deal && r[valueField] != null && Number(r[valueField]) > 0);
    if (dealRows.length === 0) continue;

    const citySummary = summarize(dealRows.map((r) => Number(r[valueField])));
    snapshots.push({ period, segment, deal, slice_type: 'city', slice_key: 'all', currency: 'USD', unit, ...citySummary });

    for (const { sliceType, field } of extraSlices) {
      const grouped = new Map();
      for (const r of dealRows) {
        const key = r[field];
        if (!key) continue;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(Number(r[valueField]));
      }
      for (const [key, values] of grouped) {
        snapshots.push({ period, segment, deal, slice_type: sliceType, slice_key: key, currency: 'USD', unit, ...summarize(values) });
      }
    }
  }
  return snapshots;
}

async function main() {
  const period = firstOfMonth();
  const snapshots = [];

  // --- Сегмент 'ofisy_bc' ---
  const { data: centers, error: centersError } = await supabase
    .from('business_centers')
    .select('slug,business_class,district');
  if (centersError) throw centersError;

  const { data: bcOffers, error: bcOffersError } = await supabase
    .from('business_center_offers')
    .select('business_center_slug,deal_type,price_per_sqm,property_type');
  if (bcOffersError) throw bcOffersError;

  // Сегмент называется "офисы в бизнес-центрах" — но само здание может
  // сдавать/продавать не только офисные помещения (магазин на первом
  // этаже, сфера услуг, кладовая и т.п.). Раньше в медиану шли ВСЕ строки
  // business_center_offers без разбора property_type — на реальном срезе
  // (2026-09-08, 618 объявлений по 70 зданиям) это оказалось не мелочью:
  // 183 из 618 (30%) не "Офисы" — искажали медиану заметно. Фильтруем
  // только здесь, для расчёта СНИМКА офисного сегмента; сама таблица
  // business_center_offers не трогается — "Объявления с Kufar и Realt" на
  // карточке конкретного БЦ по-прежнему показывает все помещения здания,
  // не только офисные, там фильтр по типу не нужен.
  const officeOnlyOffers = bcOffers.filter((o) => o.property_type === 'Офисы');
  const centerBySlug = new Map(centers.map((c) => [c.slug, c]));
  const officeRows = officeOnlyOffers.map((o) => ({
    deal_type: o.deal_type,
    price_per_sqm: o.price_per_sqm,
    class: centerBySlug.get(o.business_center_slug)?.business_class ?? null,
    district: centerBySlug.get(o.business_center_slug)?.district ?? null,
  }));
  console.log(
    `Загружено ${centers.length} БЦ, ${bcOffers.length} объявлений в БЦ (${officeOnlyOffers.length} из них — офисы, остальные отфильтрованы из снимка сегмента).`,
  );
  snapshots.push(
    ...buildSnapshotsForSegment(officeRows, 'ofisy_bc', period, [
      { sliceType: 'class', field: 'class' },
      { sliceType: 'district', field: 'district' },
    ]),
  );

  // --- Сегменты из citywide_offers ('torgovye', 'sklady') ---
  // PostgREST по умолчанию отдаёт не больше 1000 строк за запрос —
  // citywide_offers уже больше (проверено вживую: без пагинации
  // "Загружено 1000" при реальных 1817 для 'torgovye'), поэтому листаем
  // .range() до конца.
  async function fetchCitywideOffers(segment) {
    const rows = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('citywide_offers')
        .select('deal_type,price_per_sqm,price_total,district,building_type')
        .eq('segment', segment)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  const retailOffers = await fetchCitywideOffers('torgovye');
  console.log(`Загружено ${retailOffers.length} объявлений торговых помещений (citywide_offers).`);
  if (retailOffers.length > 0) {
    snapshots.push(
      ...buildSnapshotsForSegment(retailOffers, 'torgovye', period, [
        { sliceType: 'district', field: 'district' },
        { sliceType: 'building_type', field: 'building_type' },
      ]),
    );
  }

  // 'ofisy' — city-wide офисы (sync-citywide-office-offers.mjs), НЕ то же
  // самое, что 'ofisy_bc' выше (тот — только объявления внутри 143 БЦ из
  // нашего каталога). Оба сегмента сосуществуют: этот даёт непредвзятую
  // картину по всему рынку офисов Минска, 'ofisy_bc' — более узкий и
  // глубокий срез именно по каталогизированным бизнес-центрам.
  const officeCitywideOffers = await fetchCitywideOffers('ofisy');
  console.log(`Загружено ${officeCitywideOffers.length} объявлений офисов по всему городу (citywide_offers).`);
  if (officeCitywideOffers.length > 0) {
    snapshots.push(
      ...buildSnapshotsForSegment(officeCitywideOffers, 'ofisy', period, [
        { sliceType: 'district', field: 'district' },
        { sliceType: 'building_type', field: 'building_type' },
      ]),
    );
  }

  const warehouseOffers = await fetchCitywideOffers('sklady');
  console.log(`Загружено ${warehouseOffers.length} объявлений складов (citywide_offers).`);
  if (warehouseOffers.length > 0) {
    snapshots.push(...buildSnapshotsForSegment(warehouseOffers, 'sklady', period, [{ sliceType: 'district', field: 'district' }]));
  }

  // Машиноместа — цена за объект целиком (price_total), не за м²
  // (price_per_sqm у этого сегмента всегда NULL, см. sync-citywide-parking-
  // offers.mjs). building_type тут хранит тип парковки (Подземная/
  // Многоуровневая/...) — распределение живое, не вырожденное, как у
  // складов, поэтому срез оставлен.
  const parkingOffers = await fetchCitywideOffers('mashinomesta');
  console.log(`Загружено ${parkingOffers.length} объявлений машиномест (citywide_offers).`);
  if (parkingOffers.length > 0) {
    snapshots.push(
      ...buildSnapshotsForSegment(
        parkingOffers,
        'mashinomesta',
        period,
        [
          { sliceType: 'district', field: 'district' },
          { sliceType: 'building_type', field: 'building_type' },
        ],
        { valueField: 'price_total', unit: 'usd_total' },
      ),
    );
  }

  console.log(`Посчитано ${snapshots.length} срезов за ${period}.`);

  if (JSON_OUT) {
    console.log(JSON.stringify(snapshots));
  }

  if (DRY_RUN) {
    console.log('--dry-run: запись в Supabase пропущена.');
    return;
  }

  const { error: upsertError } = await supabase
    .from('market_snapshots')
    .upsert(snapshots, { onConflict: 'period,segment,deal,slice_type,slice_key' });
  if (upsertError) throw upsertError;

  console.log(`Сохранено ${snapshots.length} снимков в market_snapshots.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
