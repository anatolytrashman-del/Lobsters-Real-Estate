// Единый счётчик Яндекс.Метрики — id тот же, что вшит в счётчик в index.html.
// window.ym может отсутствовать (пререндер с ?prerender=1, блокировщики
// рекламы, скрипт ещё не успел вставиться в DOM — см. комментарий там же) —
// все вызовы опциональны, без падений.
export const METRIKA_COUNTER_ID = 111858495;

type YmFn = (id: number, action: string, ...args: unknown[]) => void;

function ym(): YmFn | undefined {
  return (window as unknown as { ym?: YmFn }).ym;
}

export function metrikaHit(url: string) {
  ym()?.(METRIKA_COUNTER_ID, 'hit', url);
}

// Идентификатор должен буквально совпадать со значением "url" у цели типа
// "action" (JS-событие), заведённой в самой Метрике через Management API.
export function reachGoal(target: string) {
  ym()?.(METRIKA_COUNTER_ID, 'reachGoal', target);
}
