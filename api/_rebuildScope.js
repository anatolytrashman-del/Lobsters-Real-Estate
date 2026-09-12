// Область изменения данных для пересборки прода (deploy_debounce.scope):
// что именно поменялось в админке, чтобы scripts/prerender.mjs рендерил
// заново только зависимые страницы (см. миграцию
// supabase/migrations/20260912-deploy-debounce-scope.sql).
//
//   objects          — сохранён объект: заново рендерятся только лендинги
//                      объектов (/minsk/<slug>), остальное копируется с прода;
//   business_centers — сохранён бизнес-центр: полный рендер (карточки и хабы
//                      БЦ — это большинство публичных страниц);
//   all              — всё (неизвестный/не переданный scope, старый фронт).
//
// Общее для api/trigger-rebuild.js и его теста; без зависимостей.
const KNOWN_SCOPES = new Set(['objects', 'business_centers']);

/** @param {unknown} raw значение из тела запроса @returns {'objects'|'business_centers'|'all'} */
export function normalizeScope(raw) {
  return typeof raw === 'string' && KNOWN_SCOPES.has(raw) ? raw : 'all';
}

/**
 * Объединение областей двух срабатываний, попавших в одно окно debounce:
 * одинаковые — остаются, разные или неизвестные (null у строки, записанной
 * старым кодом) — «всё». Ошибка всегда в сторону большего рендера.
 * @param {string|null|undefined} a scope уже записанной, ещё не потреблённой строки
 * @param {string} b scope нового срабатывания
 */
export function mergeScope(a, b) {
  const left = normalizeScope(a);
  const right = normalizeScope(b);
  if (left === 'all' || right === 'all') return 'all';
  return left === right ? left : 'all';
}
