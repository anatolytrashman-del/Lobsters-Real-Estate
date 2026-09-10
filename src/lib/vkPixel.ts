// Top.Mail.Ru (VK Реклама / VK Ретаргетинг) — id тот же, что вшит в
// пиксель в index.html. window._tmr может отсутствовать (пререндер с
// ?prerender=1, блокировщики рекламы, код.js ещё не успел вставиться в
// DOM) — это просто массив-очередь, push в него безопасен всегда.
export const VK_PIXEL_ID = '3793248';

function tmr(): { push: (event: Record<string, unknown>) => void } | undefined {
  return (window as unknown as { _tmr?: { push: (event: Record<string, unknown>) => void } })._tmr;
}

export function vkPixelHit() {
  tmr()?.push({ id: VK_PIXEL_ID, type: 'pageView', start: Date.now() });
}

// Имя цели — только латиница/цифры (правило VK). Совпадает с идентификатором
// цели "Бронь кабинета" в Яндекс.Метрике (metrika.ts) — тот же реальный
// момент, оба счётчика сравнимо считают одну и ту же конверсию.
export function vkPixelGoal(goal: string) {
  tmr()?.push({ id: VK_PIXEL_ID, type: 'reachGoal', goal });
}
