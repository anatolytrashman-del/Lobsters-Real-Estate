// Повторная попытка динамического импорта чанка при сбое (сетевой блип,
// временная недоступность CDN, transient ошибка сразу после деплоя, пока
// у пользователя в браузере ещё старая карта чанков) — держать в голове,
// где именно это нужнее всего: компоненты, чей lazy()-импорт триггерится
// НЕ навигацией (там пользователь и так видит спиннер до перехода), а
// скроллом (useInView) уже на открытой странице — там неудачный import()
// кидает настоящую JS-ошибку в середине уже читаемой страницы, а не просто
// pending-промис, который умел бы поймать Suspense. Без ErrorBoundary такая
// ошибка сносит всё дерево React целиком (см. src/components/ErrorBoundary.tsx) —
// lazyRetry не устраняет саму возможность сбоя, но даёт импорту один
// дополнительный шанс, прежде чем ошибка реально долетит до React.
export function lazyRetry<T>(factory: () => Promise<T>, retries = 1, delayMs = 700): Promise<T> {
  return factory().catch((error: unknown) => {
    if (retries <= 0) throw error;
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(() => lazyRetry(factory, retries - 1, delayMs));
  });
}
