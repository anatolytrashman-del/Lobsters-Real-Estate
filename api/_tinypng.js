// Общий клиент TinyPNG API (tinify) — используется и Vercel-функцией
// tinypng-compress.js (сжатие сразу после загрузки), и
// scripts/process-image-compression-queue.mjs (месячный докат очереди,
// запускается GitHub Actions, полный интернет-доступ, не только Vercel-домен),
// и scripts/compress-static-images.mjs (разовый прогон по public/images).
// Обычный ESM-файл без Vercel-специфики (только fetch/Buffer/Blob — глобальны
// и в Node 18+/20+, и в раннтайме Vercel-функций) — импортируется относительным
// путём из scripts/*.mjs напрямую, без сборки.
//
// Владелец: лимит бесплатного тарифа — 500 сжатий в месяц (см. docs/session-journal.md).
// TinyPNG сам считает это (заголовок ответа Compression-Count, сквозной на
// весь месяц для ключа) и после превышения отвечает 429 — свой счётчик не
// ведём, полагаемся на их лимит: тот, кто вызывает shrinkBuffer, ловит
// TinifyQuotaExceededError и решает сам (поставить в очередь, остановить
// прогон и т.п.), не пытаясь предсказать момент исчерпания заранее.

export const TINIFY_BASE = 'https://api.tinify.com';

// Форматы, которые реально принимает /shrink — из документации Tinify.
export const TINIFY_SUPPORTED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function tinifyKeyProblem() {
  if (!process.env.TINYPNG_API_KEY) {
    return 'Не задана переменная окружения TINYPNG_API_KEY (ключ TinyPNG)';
  }
  return null;
}

export class TinifyQuotaExceededError extends Error {
  constructor(message) {
    super(message || 'Месячный лимит сжатий TinyPNG исчерпан');
    this.name = 'TinifyQuotaExceededError';
  }
}

function authHeader(apiKey) {
  // Tinify — Basic-авторизация с логином "api" и паролем-ключом, как у
  // самого API (не наш выбор формата).
  return `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`;
}

// Сжимает буфер картинки через Tinify и возвращает сжатые байты + размеры.
// Бросает TinifyQuotaExceededError на 429 (месячный лимит исчерпан) — эта
// ошибка ожидаема и разбирается вызывающим кодом отдельно, не как сбой.
export async function shrinkBuffer(buffer, apiKey = process.env.TINYPNG_API_KEY) {
  const shrinkResp = await fetch(`${TINIFY_BASE}/shrink`, {
    method: 'POST',
    headers: { Authorization: authHeader(apiKey) },
    body: buffer,
  });

  if (shrinkResp.status === 429) {
    throw new TinifyQuotaExceededError();
  }
  if (shrinkResp.status !== 201) {
    const body = await shrinkResp.json().catch(() => ({}));
    throw new Error(body.message || `Tinify отклонил файл (${shrinkResp.status})`);
  }

  const body = await shrinkResp.json();
  const outputUrl = body?.output?.url;
  if (!outputUrl) {
    throw new Error('Tinify не вернул ссылку на сжатый файл');
  }

  const outputResp = await fetch(outputUrl, {
    headers: { Authorization: authHeader(apiKey) },
  });
  if (!outputResp.ok) {
    throw new Error(`Не удалось скачать сжатый файл от Tinify (${outputResp.status})`);
  }
  const compressedBuffer = Buffer.from(await outputResp.arrayBuffer());

  return {
    buffer: compressedBuffer,
    originalSize: body.input?.size ?? buffer.length,
    compressedSize: body.output?.size ?? compressedBuffer.length,
    compressionCount: shrinkResp.headers.get('compression-count'),
  };
}
