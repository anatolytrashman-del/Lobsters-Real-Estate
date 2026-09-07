// Собирает business_center_offers (объявления о продаже/аренде помещений
// внутри конкретных БЦ, см. sync-business-center-offers.mjs) в месячные
// агрегаты — public.market_snapshots — для раздела аналитики рынка
// (ANALYTICSPLAN.md, спринт 1). Один снимок = (период, сегмент, сделка,
// срез, ключ среза) → n/медиана/p25/p75, без перезаписи истории (снимки
// за прошлые месяцы не трогаются, только upsert по текущему периоду).
//
// Сейчас единственный сегмент с реальными данными — 'ofisy_bc' (офисы в
// бизнес-центрах, city-wide, есть привязка к business_centers.business_class/
// district). Остальные сегменты плана (торговля/склады/офисы вне БЦ) не
// собираются — для них нет ни своего скрапа, ни таблицы с привязкой к
// сегменту/типу здания (см. ANALYTICSPLAN.md, раздел 3.1, п.2 «Нормализация» —
// это отдельная, ещё не сделанная задача).
//
// Срезы: city (весь город), class (по business_class — только реально
// встречающиеся значения), district (по district — только реально
// встречающиеся). Перед агрегацией — фильтр price_per_sqm>0 и обрезка по
// 5–95 перцентилю ВНУТРИ среза (ANALYTICSPLAN.md §3.1 п.4), но только при
// n≥8 — на совсем маленьких выборках обрезка перцентилями съедает и так
// скудные данные, смысла в ней нет.
//
// Дедупликация между Kufar/Realt НЕ делается — business_center_offers сам
// по себе не имеет ручного review-флоу (см. комментарий в
// sync-business-center-offers.mjs) и общего dedup-ключа между источниками,
// как у market_offers/MarketOffersReview.tsx. Один и тот же объект,
// выставленный на обеих площадках, может учитываться дважды — известное
// ограничение, отражено в /minsk/analytics/metodika.

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

async function main() {
  const { data: centers, error: centersError } = await supabase
    .from('business_centers')
    .select('slug,business_class,district');
  if (centersError) throw centersError;

  const { data: offers, error: offersError } = await supabase
    .from('business_center_offers')
    .select('business_center_slug,deal_type,price_per_sqm');
  if (offersError) throw offersError;

  const centerBySlug = new Map(centers.map((c) => [c.slug, c]));
  const rows = offers
    .map((o) => ({
      ...o,
      center: centerBySlug.get(o.business_center_slug) ?? null,
    }))
    .filter((o) => o.price_per_sqm != null && Number(o.price_per_sqm) > 0);

  console.log(`Загружено ${centers.length} БЦ, ${offers.length} объявлений (${rows.length} с ценой за м²).`);

  const period = firstOfMonth();
  const snapshots = [];

  for (const deal of ['rent', 'sale']) {
    const dealRows = rows.filter((r) => r.deal_type === deal);
    if (dealRows.length === 0) continue;

    const citySummary = summarize(dealRows.map((r) => Number(r.price_per_sqm)));
    snapshots.push({ period, segment: 'ofisy_bc', deal, slice_type: 'city', slice_key: 'all', currency: 'USD', ...citySummary });

    const byClass = new Map();
    for (const r of dealRows) {
      const cls = r.center?.business_class;
      if (!cls) continue;
      if (!byClass.has(cls)) byClass.set(cls, []);
      byClass.get(cls).push(Number(r.price_per_sqm));
    }
    for (const [cls, values] of byClass) {
      snapshots.push({ period, segment: 'ofisy_bc', deal, slice_type: 'class', slice_key: cls, currency: 'USD', ...summarize(values) });
    }

    const byDistrict = new Map();
    for (const r of dealRows) {
      const district = r.center?.district;
      if (!district) continue;
      if (!byDistrict.has(district)) byDistrict.set(district, []);
      byDistrict.get(district).push(Number(r.price_per_sqm));
    }
    for (const [district, values] of byDistrict) {
      snapshots.push({ period, segment: 'ofisy_bc', deal, slice_type: 'district', slice_key: district, currency: 'USD', ...summarize(values) });
    }
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
