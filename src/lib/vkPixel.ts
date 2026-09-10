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

// VK-аудитории (панель "События на сайте" в VK Рекламе) строятся по
// именованным событиям, а не по условию "URL содержит", как цели в
// Метрике — там просто список того, что реально прилетело с пикселя.
// Поэтому под каждую нужную аудиторию явно шлём свой reachGoal с той
// страницы, которая должна в неё попасть (тот же набор путей, что и у
// целей "Смотрел аналитику"/"Смотрел лендинг Red One" в Метрике).
export function vkPageGoalForPath(pathname: string): string | null {
  if (pathname.startsWith('/minsk/analytics') || pathname.startsWith('/minsk/bcminsk')) {
    return 'viewed_analytics';
  }
  if (pathname.startsWith('/minsk/one')) {
    return 'viewed_red_one';
  }
  return null;
}
