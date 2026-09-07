// Дополняет dist/sitemap.xml карточками бизнес-центров (/minsk/bcminsk/<slug>)
// и хабами по станциям метро (/minsk/bcminsk/metro/<slug>, только непустые).
//
// Аудит поиска 2026-09-07: в sitemap были только каталог и хаб-страницы
// фильтров, ни одной карточки БЦ — Google знал 5 URL сайта, Яндекс 2, ни
// одна карточка не в индексе. Список слагов — из той же таблицы
// business_centers, что читает публичная страница (как и в prerender.mjs),
// не хардкожен: каталог растёт, статический файл в public/ отставал бы.
//
// Запускается в `npm run build` сразу после `vite build` (public/sitemap.xml
// уже скопирован в dist/). При сетевой ошибке НЕ валит сборку — sitemap
// остаётся статическим, как раньше (те же URL, что и до этой правки), а в
// лог уходит предупреждение.
//
// lastmod карточек — дата сборки: у business_centers нет updated_at, а сам
// снапшот карточки (prerender.mjs) пересобирается каждый деплой, плюс
// объявления Kufar/Realt внутри карточек обновляются ежемесячным синком.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_EQwXLOy5TmSPj5tzKjbSeg_xj6SM2Iz';
const SITE = 'https://redevelopment.pro';
const SITEMAP_PATH = resolve(process.cwd(), 'dist/sitemap.xml');

async function fetchBusinessCenterSlugs() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/business_centers?select=slug&order=slug.asc`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе business_centers.slug`);
  const rows = await res.json();
  return rows.map((r) => r.slug).filter((slug) => typeof slug === 'string' && /^[a-z0-9-]+$/.test(slug));
}


// Хабы по станциям метро (аудит поиска 2026-09-07) — та же карта slug'ов и
// тот же радиус 1500 м, что в src/lib/businessCenterHubs.ts
// (METRO_STATION_SLUGS / METRO_HUB_MAX_DISTANCE_M — продублировано, скрипт
// без TS-загрузчика). Хаб — только для станций с ≥1 БЦ в радиусе.
const METRO_HUB_MAX_DISTANCE_M = 1500;
const METRO_HUB_SLUG_BY_STATION = {
  Молодёжная: 'molodezhnaya',
  Фрунзенская: 'frunzenskaya',
  'Площадь Франтишка Богушевича': 'ploshchad-bogushevicha',
  'Академия наук': 'akademiya-nauk',
  Пушкинская: 'pushkinskaya',
  'Институт культуры': 'institut-kultury',
  Вокзальная: 'vokzalnaya',
  'Юбилейная площадь': 'yubileynaya-ploshchad',
  'Площадь Победы': 'ploshchad-pobedy',
  Купаловская: 'kupalovskaya',
  'Ковальская Слобода': 'kovalskaya-sloboda',
  Московская: 'moskovskaya',
  'Площадь Якуба Коласа': 'ploshchad-yakuba-kolasa',
  Михалово: 'mihalovo',
  'Площадь Ленина': 'ploshchad-lenina',
  Грушевка: 'grushevka',
  Восток: 'vostok',
  Петровщина: 'petrovshchina',
  Немига: 'nemiga',
  Аэродромная: 'aerodromnaya',
  Уручье: 'uruchye',
  Октябрьская: 'oktyabrskaya',
  'Борисовский тракт': 'borisovskiy-trakt',
  'Каменная горка': 'kamennaya-gorka',
  'Парк Челюскинцев': 'park-chelyuskintsev',
  Спортивная: 'sportivnaya',
  Кунцевщина: 'kuntsevshchina',
  Первомайская: 'pervomayskaya',
  'Тракторный завод': 'traktornyy-zavod',
  Партизанская: 'partizanskaya',
  Пролетарская: 'proletarskaya',
  Малиновка: 'malinovka',
  Автозаводская: 'avtozavodskaya',
  Могилёвская: 'mogilevskaya',
};

async function fetchMetroHubStations() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/business_centers?select=nearest_metro_stations&nearest_metro_stations=not.is.null`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) throw new Error(`Supabase вернул ${res.status} при запросе nearest_metro_stations`);
  const rows = await res.json();
  const slugs = new Set();
  for (const r of rows) {
    for (const s of Array.isArray(r.nearest_metro_stations) ? r.nearest_metro_stations : []) {
      const slug = METRO_HUB_SLUG_BY_STATION[s?.name];
      if (slug && typeof s.distanceMeters === 'number' && s.distanceMeters <= METRO_HUB_MAX_DISTANCE_M) slugs.add(slug);
    }
  }
  return [...slugs];
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  let slugs;
  try {
    slugs = await fetchBusinessCenterSlugs();
  } catch (err) {
    console.warn(`[generate-sitemap] карточки БЦ не добавлены: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const xml = readFileSync(SITEMAP_PATH, 'utf8');
  const existing = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  const today = new Date().toISOString().slice(0, 10);
  let metroSlugs = [];
  try {
    metroSlugs = await fetchMetroHubStations();
  } catch (err) {
    console.warn(`[generate-sitemap] хабы метро не добавлены: ${err instanceof Error ? err.message : err}`);
  }
  const entries = [
    ...metroSlugs.map((slug) => `${SITE}/minsk/bcminsk/metro/${slug}`),
    ...slugs.map((slug) => `${SITE}/minsk/bcminsk/${slug}`),
  ]
    .filter((url) => !existing.has(url))
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXml(url)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`,
    );
  if (entries.length === 0) {
    console.log('[generate-sitemap] новых карточек БЦ нет');
    return;
  }
  const closing = xml.lastIndexOf('</urlset>');
  if (closing === -1) throw new Error('dist/sitemap.xml: не найден закрывающий </urlset>');
  const out = `${xml.slice(0, closing)}${entries.join('\n')}\n</urlset>\n`;
  writeFileSync(SITEMAP_PATH, out);
  console.log(`[generate-sitemap] добавлено URL (хабы метро + карточки БЦ): ${entries.length} (всего <loc>: ${existing.size + entries.length})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
