// IndexNow (bing.com/indexnow) — один общий протокол мгновенного
// уведомления поисковиков об URL сайта, участники: Bing, Яндекс, Naver,
// Seznam. Вместо ожидания органического обхода краулером, при каждой
// продовой сборке отправляем полный список URL из готового
// dist/sitemap.xml одним batch-запросом — все участники протокола узнают
// о страницах почти сразу.
//
// Ключ подтверждения владения — статический файл public/<key>.txt (копия
// content = сам ключ), Vite копирует public/ в корень dist как есть, так
// что https://redevelopment.pro/<key>.txt доступен без отдельного кода на
// сервере. Проверка владения — тот факт, что engine может скачать файл по
// этому пути и увидеть внутри тот же ключ, что в теле запроса.
//
// Запускается в `npm run build` сразу после generate-sitemap.mjs (нужен
// уже дополненный dist/sitemap.xml — карточки БЦ/хабы метро/улиц). Как и
// у generate-sitemap.mjs — сетевая ошибка НЕ валит сборку, только
// предупреждение в лог.
//
// Только на реальных сборках Vercel (process.env.VERCEL) — локальные/
// дев-прогоны в песочнице не должны спамить внешний API одним и тем же
// списком URL при каждой отладочной сборке.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = 'redevelopment.pro';
const SITE = `https://${HOST}`;
const INDEXNOW_KEY = '8749bf38ccefd4070d1d1cbb901a168f';
const SITEMAP_PATH = resolve(process.cwd(), 'dist/sitemap.xml');

async function main() {
  if (!process.env.VERCEL) {
    console.log('[notify-indexnow] не Vercel-сборка — пропускаем (нет смысла пинговать при локальной/тестовой сборке)');
    return;
  }
  let xml;
  try {
    xml = readFileSync(SITEMAP_PATH, 'utf8');
  } catch (err) {
    console.warn(`[notify-indexnow] не удалось прочитать ${SITEMAP_PATH}: ${err instanceof Error ? err.message : err}`);
    return;
  }
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (urlList.length === 0) {
    console.log('[notify-indexnow] sitemap пуст — нечего отправлять');
    return;
  }
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // IndexNow отвечает 200 (принято) или 202 (принято, ключ ещё не проверен
    // по всем участникам) — оба означают "успешно отправлено".
    if (res.ok || res.status === 202) {
      console.log(`[notify-indexnow] отправлено ${urlList.length} URL, статус ${res.status}`);
    } else {
      const body = await res.text().catch(() => '');
      console.warn(`[notify-indexnow] IndexNow вернул ${res.status}: ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.warn(`[notify-indexnow] сетевая ошибка: ${err instanceof Error ? err.message : err}`);
  }
}

main().catch((err) => {
  console.error(err);
  // Не роняем сборку — тот же принцип, что и у generate-sitemap.mjs.
  process.exitCode = 0;
});
