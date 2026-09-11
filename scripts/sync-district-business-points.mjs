// Раз в месяц (см. .github/workflows/sync-district-business-points.yml)
// собирает список организаций по каждому сданному дому Минск Мира через
// внутренний API Яндекс.Карт — заменяет ручной процесс, когда Светлана
// сама выгружала список организаций по дому и присылала владельцу/в чат
// Claude Code для ручного занесения в код (см. журнал docs/session-journal.md,
// 2026-08-26 — "хочу, чтобы Светлана делала выгрузку... но лучше, если
// платформа будет делать это сама").
//
// Как это работает технически (нашли через HAR-выгрузку из реального
// Chrome владельца — вкладка "Организации внутри" карточки дома на
// yandex.ru/maps):
//   1. GET yandex.ru/maps/api/search?add_type=direct&text=<адрес> — резолвит
//      текст адреса в координаты дома (requestGeoWhere.coordinates).
//   2. GET yandex.ru/maps/api/search?type=biz&business_mode=exact&
//      geowhere=<lat>,<lon>&skip=0/25/50... — список организаций СТРОГО в
//      этой точке (не по радиусу), постранично по 25.
// Оба запроса используют double-submit csrfToken: без токена (или с
// протухшим) Яндекс не отдаёт данные, а просто возвращает {"csrfToken":
// "..."} — нужно повторить запрос с этим же токеном.
//
// Голый HTTP-клиент (даже с полным набором sec-ch-ua/sec-fetch-* заголовков
// из реального запроса) поймал HTTP 400 от анти-бот защиты Яндекса уже на
// третьем запросе подряд — проверено вживую с прода (см. журнал). Поэтому
// запросы идут не через fetch() из Node напрямую, а ЧЕРЕЗ headless Chromium
// (playwright-core + @sparticuz/chromium, та же связка, что уже использует
// scripts/prerender.mjs) — page.evaluate() выполняет fetch() ВНУТРИ реальной
// страницы yandex.ru/maps, поэтому все заголовки (User-Agent, sec-fetch-*,
// Referer, Origin) браузер расставляет сам и они внутренне согласованы, как
// у настоящего пользователя — не нужно ничего подделывать вручную.
//
// YANDEX_MAPS_COOKIE — сессионная кука владельца с yandex.ru (Cookie header
// целиком, скопирован из DevTools). Протухает время от времени (как и
// REALT_COOKIE/AVITO_COOKIE/MEGAPOLIS_COOKIE в этом же проекте) — если синк
// начнёт стабильно возвращать 0 организаций или ошибки авторизации, значит
// куку пора обновить вручную.
//
// Список домов — scripts/data/district-houses.json, сгенерирован ОДИН РАЗ
// из QUARTER_HOUSE_INDEX (src/data/districtQuarters.ts) с исключением
// кварталов, которые на 2026-08-26 ещё не сданы (Австралия и Океания —
// кроме Avia Mall, у которого нет адреса в справочнике, добавить отдельно
// когда появится; Звёздный; Западный; Эверест) — см. NOT_DELIVERED_QUARTERS
// в src/data/districtQuarters.ts (комментарий, не отдельное поле — сдача
// дома меняется редко, ручная правка списка при появлении новых сдач
// проще отдельной колонки в БД). Если появятся новые дома в справочнике
// или сменится статус сдачи — перегенерировать этот файл тем же способом
// (см. журнал docs/session-journal.md, регэксп-парсинг QUARTER_HOUSE_INDEX).

import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const YANDEX_MAPS_COOKIE = process.env.YANDEX_MAPS_COOKIE;
const DRY_RUN = process.argv.includes('--dry-run');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : null;

if (!SUPABASE_SERVICE_ROLE_KEY && !DRY_RUN) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY (или запусти с --dry-run)');
  process.exit(1);
}
if (!YANDEX_MAPS_COOKIE) {
  console.error('Не задана переменная окружения YANDEX_MAPS_COOKIE');
  process.exit(1);
}

const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const HOUSES = JSON.parse(readFileSync(join(__dirname, 'data', 'district-houses.json'), 'utf-8'));

const PAGE_DELAY_MS = 1000; // пауза между страницами одного дома
const HOUSE_DELAY_MS = 3000; // пауза между домами — не долбим Яндекс без остановки

function titleCase(street) {
  return street.replace(/(^|[\s-])([а-яё])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

async function launchBrowser() {
  if (process.env.VERCEL) {
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  if (process.env.GITHUB_ACTIONS) {
    const sparticuzChromium = (await import('@sparticuz/chromium')).default;
    return chromium.launch({
      args: sparticuzChromium.args,
      executablePath: await sparticuzChromium.executablePath(),
      headless: true,
    });
  }
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
}

function parseCookieHeader(raw) {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf('=');
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      return { name, value, domain: '.yandex.ru', path: '/' };
    });
}

// Выполняет GET к внутреннему API Яндекс.Карт ИЗНУТРИ страницы (через
// page.evaluate + fetch) — см. комментарий в шапке файла про причину.
// csrfToken double-submit: первый запрос без токена возвращает свежий,
// повторяем с ним же.
async function yandexSearchGet(page, params) {
  const doFetch = async (csrfToken) => {
    return page.evaluate(
      async ({ params, csrfToken }) => {
        const url = new URL('https://yandex.ru/maps/api/search');
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        if (csrfToken) url.searchParams.set('csrfToken', csrfToken);
        const resp = await fetch(url.toString(), { credentials: 'include' });
        const text = await resp.text();
        return { ok: resp.status, text };
      },
      { params, csrfToken },
    );
  };

  let result = await doFetch(null);
  let json;
  try {
    json = JSON.parse(result.text);
  } catch {
    throw new Error(`не JSON (status ${result.ok}): ${result.text.slice(0, 300)}`);
  }
  if (!json?.data && json?.csrfToken) {
    result = await doFetch(json.csrfToken);
    try {
      json = JSON.parse(result.text);
    } catch {
      throw new Error(`не JSON после csrfToken (status ${result.ok}): ${result.text.slice(0, 300)}`);
    }
  }
  if (!json?.data) throw new Error(`нет data в ответе: ${JSON.stringify(json).slice(0, 300)}`);
  return json.data;
}

async function resolveAddress(page, addressText) {
  const data = await yandexSearchGet(page, {
    ajax: '1',
    add_type: 'direct',
    lang: 'ru_RU',
    results: '25',
    text: addressText,
    origin: 'maps-form',
  });
  const geoWhere = data?.requestGeoWhere;
  if (!geoWhere?.coordinates) throw new Error('нет requestGeoWhere в ответе');
  return geoWhere;
}

async function fetchAllBusinesses(page, lat, lon) {
  const items = [];
  let skip = 0;
  let total = null;
  for (let iter = 0; iter < 12; iter++) {
    const data = await yandexSearchGet(page, {
      ajax: '1',
      type: 'biz',
      business_mode: 'exact',
      business_show_closed: '0',
      lang: 'ru_RU',
      origin: 'maps-toponym-orgs',
      results: '25',
      skip: String(skip),
      text: '',
      geowhere: `${lat},${lon}`,
    });
    if (total === null) total = data?.totalResultCount ?? 0;
    const pageItems = data?.items ?? [];
    items.push(...pageItems);
    skip += pageItems.length;
    if (pageItems.length === 0 || skip >= total) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  return items;
}

async function upsertHouseBusinesses(house, items) {
  const rows = items.map((it) => ({
    external_id: String(it.id),
    title: it.title,
    raw_category: it.categories?.[0]?.name ?? null,
    address: it.address,
    street: house.street,
    house: house.house,
    quarter_id: house.quarterId,
    lat: it.coordinates?.[1] ?? null,
    lon: it.coordinates?.[0] ?? null,
    status: it.status ?? null,
    last_seen_at: new Date().toISOString(),
  }));

  if (DRY_RUN) {
    console.log(`  [dry-run] upsert ${rows.length} строк для ${house.street}, ${house.house}`);
    return;
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('district_business_points').upsert(rows, { onConflict: 'external_id' });
    if (error) throw new Error(`upsert: ${error.message}`);
  }

  // Организации, которые раньше числились по этому дому, но в этот раз не
  // встретились — закрылись/съехали, убираем (не просто "не обновили",
  // иначе список бы только рос).
  const seenIds = rows.map((r) => r.external_id);
  const { error: delError } = await supabase
    .from('district_business_points')
    .delete()
    .eq('street', house.street)
    .eq('house', house.house)
    .not('external_id', 'in', `(${seenIds.length ? seenIds.map((id) => `"${id}"`).join(',') : '""'})`);
  if (delError) throw new Error(`delete stale: ${delError.message}`);
}

async function main() {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  });
  await context.addCookies(parseCookieHeader(YANDEX_MAPS_COOKIE));
  const page = await context.newPage();

  // Обычная навигация на карты — устанавливает нормальный JS-контекст
  // страницы (Referer/Origin для последующих fetch), как у живого визита.
  await page.goto('https://yandex.ru/maps/157/minsk/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const houses = LIMIT ? HOUSES.slice(0, LIMIT) : HOUSES;
  console.log(`Домов к обработке: ${houses.length}${DRY_RUN ? ' (dry-run)' : ''}`);

  let okCount = 0;
  let errCount = 0;
  let totalOrgs = 0;

  for (const [i, house] of houses.entries()) {
    const addressText = `${titleCase(house.street)}, ${house.house}, Минск`;
    try {
      const geoWhere = await resolveAddress(page, addressText);
      const [lon, lat] = geoWhere.coordinates;
      const items = await fetchAllBusinesses(page, lat, lon);
      await upsertHouseBusinesses(house, items);
      totalOrgs += items.length;
      okCount++;
      console.log(`[${i + 1}/${houses.length}] ${addressText} — ${items.length} организаций`);
    } catch (err) {
      errCount++;
      console.error(`[${i + 1}/${houses.length}] ${addressText} — ОШИБКА: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, HOUSE_DELAY_MS));
  }

  await browser.close();

  console.log(`Готово: ${okCount} домов ок, ${errCount} с ошибкой, всего организаций собрано ${totalOrgs}`);
  if (errCount > houses.length / 2) {
    console.error('Больше половины домов упали с ошибкой — похоже, кука протухла или Яндекс заблокировал. Проверить YANDEX_MAPS_COOKIE.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
