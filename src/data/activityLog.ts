// Лог действий сотрудников — задел на будущее ("начнём со Светланы, а
// конкретно со сбора количества верифицированных карточек за день", запрос
// владельца). Строка — одно действие одного профиля в один момент времени;
// страница /admin/activity-log (видна только владельцу, см.
// RequireSuperAdmin) агрегирует их в разбивку по дням/сотрудникам прямо из
// сырых записей — тот же принцип, что и у остальной аналитики в проекте
// (см. DistrictGuidePage/MarketOffersReview): не хранить готовый агрегат,
// считать его на лету, чтобы ничего не рассинхронизировалось.
export interface ActivityLogEntry {
  id: number;
  profileId: string | null;
  profileName: string;
  action: string;
  createdAt: string;
}

export interface ActivityLogRow {
  id: number;
  profile_id: string | null;
  profile_name: string;
  action: string;
  created_at: string;
}

// Известные типы действий — просто для человеческих подписей на странице
// лога, само поле action в базе свободный text (см. logActivity в
// lib/activityLogApi.ts), чтобы добавлять новые виды действий не требовало
// миграции.
export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  market_offer_verified: 'Верификация объявления (аналитика рынка)',
  supplier_offer_verified: 'Верификация поставщика (Ресерч)',
  supplier_offer_added_manually: 'Добавление поставщика вручную (Ресерч)',
  supplier_invoice_confirmed: 'Подтверждение счёта/КП из письма (Ресерч → Письма)',
};

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTION_LABELS[action] ?? action;
}
