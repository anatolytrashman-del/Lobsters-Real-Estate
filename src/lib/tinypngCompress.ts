// Фоновая (best-effort, не блокирует форму) команда серверу пересжать
// только что загруженную картинку через TinyPNG — см. api/tinypng-compress.js.
// Специально НЕ await'ится вызывающим кодом: файл в Storage уже загружен
// успешно, сжатие — оптимизация поверх, не должна тормозить/ронять UI.
// Работает и без входа (публичные страницы вроде /estimate/:token тоже
// грузят картинки) — эндпоинт не требует авторизации, поэтому обычный
// fetch, не authFetch.
export function queueImageCompression(bucket: string, path: string): void {
  fetch('/api/tinypng-compress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path }),
  }).catch(() => {
    // Сжатие не критично — оригинал уже загружен и работает как есть.
  });
}
