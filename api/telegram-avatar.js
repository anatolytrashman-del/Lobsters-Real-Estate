// Vercel serverless function: проксирует публичную превью-страницу
// t.me/<handle> и достаёт из неё og:image — единственный способ получить
// аватар произвольного пользователя Telegram по юзернейму без официального
// API (Bot API отдаёт фото только тем ботам, кому пользователь сам написал,
// по чужому юзернейму так фото не получить в принципе).
//
// Неофициальный приём: Telegram может поменять разметку страницы, а если у
// пользователя скрыта приватность фото — вместо селфи вернётся сгенерированный
// Telegram-ом кружок с буквой, не более информативный, чем наша заглушка с
// инициалами.
//
// Здесь только скачивание и проксирование картинки — сохранение в бакет и
// привязка к лиду делает клиент через уже существующий uploadLeadPhoto
// (см. src/lib/leadsApi.ts, tryAutoFillTelegramAvatar).

import { requireStaffAuth } from './_auth.js';

const HANDLE_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const FETCH_TIMEOUT_MS = 8000;
// P2.4 аудита безопасности: og:image из чужого HTML — без этих двух защит
// функция была бы прокси на скачивание произвольного URL/произвольного
// объёма по чужому og:image (t.me теоретически может отдать ссылку на что
// угодно, если разметка вдруг подменится или Telegram сам когда-то станет
// отдавать сторонние превью). Домены — реальные, откуда t.me отдаёт фото
// профиля (cdn*.telegram-cdn.org) и сам t.me (когда отдаёт заглушку с
// инициалами напрямую).
const ALLOWED_IMAGE_HOSTS = [/^t\.me$/i, /^cdn\d*\.telegram-cdn\.org$/i];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // аватары — десятки-сотни КБ, щедрый запас
// t.me отдаёт HTML-превью независимо от User-Agent, но браузерный UA снижает
// риск попасть под отдельные лимиты/блокировки для очевидно не-браузерных
// запросов.
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Атрибуты meta-тега у Telegram идут в фиксированном порядке
// (property потом content), но на случай изменений сначала находим весь
// тег, потом content внутри него — устойчивее к порядку атрибутов.
function extractOgImage(html) {
  const tagMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
  if (!tagMatch) return null;
  const contentMatch = tagMatch[0].match(/content=["']([^"']+)["']/i);
  return contentMatch ? contentMatch[1] : null;
}

function isAllowedImageHost(urlString) {
  try {
    const { hostname } = new URL(urlString);
    return ALLOWED_IMAGE_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

// Читаем поток вручную (не resp.arrayBuffer() целиком), чтобы оборвать
// скачивание сразу по превышению лимита, не полагаясь на Content-Length —
// его может не быть в ответе или он может быть занижен относительно
// реального тела.
async function fetchImageWithLimit(url, maxBytes, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return { ok: false, status: resp.status };

    const declaredLength = Number(resp.headers.get('content-length'));
    if (declaredLength > maxBytes) return { ok: false, tooLarge: true };

    const reader = resp.body?.getReader();
    if (!reader) {
      // Фолбэк для окружений без поддержки потокового чтения тела ответа.
      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.byteLength > maxBytes) return { ok: false, tooLarge: true };
      return { ok: true, buffer, contentType: resp.headers.get('content-type') };
    }

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
    return { ok: true, buffer: Buffer.concat(chunks), contentType: resp.headers.get('content-type') };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;

  const handle = typeof req.query.handle === 'string' ? req.query.handle : '';
  if (!HANDLE_RE.test(handle)) {
    res.status(400).json({ error: 'Некорректный юзернейм' });
    return;
  }

  try {
    const pageResp = await fetchWithTimeout(`https://t.me/${handle}`, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
    });
    if (!pageResp.ok) {
      res.status(404).json({ error: 'Профиль не найден' });
      return;
    }
    const html = await pageResp.text();
    const imageUrl = extractOgImage(html);
    if (!imageUrl) {
      res.status(404).json({ error: 'Фото не найдено' });
      return;
    }
    if (!isAllowedImageHost(imageUrl)) {
      console.error('[telegram-avatar] og:image с неожиданного домена:', imageUrl);
      res.status(502).json({ error: 'Неожиданный источник изображения' });
      return;
    }

    const imageResult = await fetchImageWithLimit(imageUrl, MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS);
    if (!imageResult.ok) {
      if (imageResult.tooLarge) {
        res.status(502).json({ error: 'Изображение слишком большое' });
        return;
      }
      res.status(404).json({ error: 'Не удалось скачать фото' });
      return;
    }

    res.setHeader('Content-Type', imageResult.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(imageResult.buffer);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Не удалось получить фото' });
  }
}
