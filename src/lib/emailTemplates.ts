import type { SupplierOffer, SupplierRequest } from '../data/supplierResearch';

// Тема письма поставщику по умолчанию — одна и та же для единичной отправки
// и для массовой рассылки (владелец, 2026-09-12: "Давай по умолчанию делать
// заголовок «Закупка материалов»"). Раньше вместо неё подставлялось название
// категории запроса — но ведомость в письме почти всегда шире одной позиции
// ("Я рассылал ведомость не только по Alma"), и тема про один материал вводила
// получателя в заблуждение.
export const DEFAULT_MATERIALS_SUBJECT = 'Закупка материалов';

// Подстановка плейсхолдеров в шаблон письма — EMAIL_CORRESPONDENCE_PLAN.md,
// этап 3. Чистая функция без React — подставляет и отдаёт готовый текст,
// дальше это обычный редактируемый черновик (шаблон ничего не "держит").
export interface EmailTemplateContext {
  offer: SupplierOffer;
  request: SupplierRequest;
}

const PLACEHOLDER_RESOLVERS: Record<string, (ctx: EmailTemplateContext) => string> = {
  компания: (ctx) => ctx.offer.name,
  запрос: (ctx) => ctx.request.title,
  материалы: (ctx) => ctx.request.title,
  контакт: (ctx) => ctx.offer.contact,
};

// Неизвестные {…} (опечатка, чужой синтаксис в тексте) оставляем как есть —
// не падаем и не вырезаем молча, чтобы автор шаблона сразу увидел
// неподставленный плейсхолдер в превью и поправил название.
function substitute(text: string, ctx: EmailTemplateContext): string {
  return text.replace(/\{([^{}]*)\}/g, (match, rawKey: string) => {
    const key = rawKey.trim().toLowerCase();
    const resolve = PLACEHOLDER_RESOLVERS[key];
    return resolve ? resolve(ctx) : match;
  });
}

export function renderEmailTemplate(
  template: { subject: string; body: string },
  ctx: EmailTemplateContext,
): { subject: string; body: string } {
  return { subject: substitute(template.subject, ctx), body: substitute(template.body, ctx) };
}
