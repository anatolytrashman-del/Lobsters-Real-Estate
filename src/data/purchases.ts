import { RESEARCH_CURRENCIES } from './supplierResearch';
import type { Currency } from './transactions';

export { RESEARCH_CURRENCIES as PURCHASE_CURRENCIES };

// Открытый список статусов закупки, как и везде (leadStatuses/estimateStatuses
// и т.п.) — растёт из формы через AddableSelect, это просто стартовые значения.
export const purchaseStatuses = ['Ждём КП', 'Заказано', 'Оплачено', 'Доставлено'] as const;

// Позиция закупки — СНИМОК конкретного EstimateMaterial на момент создания
// закупки (владелец, 2026-08-27: список материалов "подгружается в смету"),
// не живая ссылка: если материал в смете потом поправят/удалят, уже
// созданная закупка не должна тихо разъехаться с тем, что реально заказали
// у поставщика. sourceMaterialId — id исходного EstimateMaterial, только
// для справки (не используется для пересчёта).
export interface PurchaseItem {
  id: string;
  sourceMaterialId: string | null;
  name: string;
  unit: string;
  quantity: number | null;
  price: number | null;
  note: string;
  // Владелец, 2026-09-04: "краска идёт в литрах, а поставщик выставляет
  // количество банок по Х литров... надо пересчитывать на литр, метр,
  // штуку, а не в целом" — price/quantity/unit выше остаются КАК В СЧЕТЕ
  // (правдиво показывают, что реально прислал поставщик — банки, не литры),
  // а unitPrice — цена за ОДНУ единицу измерения СМЕТНОГО материала (тот же
  // unit, что у EstimateMaterial), с которым сопоставлена эта позиция.
  // Заполняется только вручную при сопоставлении распознанного счёта с
  // позицией сметы (см. SupplierCorrespondenceTab.tsx) — опционально,
  // поэтому не ломает уже существующие места создания PurchaseItem по всему
  // проекту (закупки, ведомости, запросы Ресерча), которым это поле не
  // нужно. Используется только для сравнения "лучшая цена по позиции"
  // (bestPricesByMaterialId в Suppliers.tsx) — раньше туда попадал сырой
  // price со счёта без учёта того, что тара может быть другой.
  unitPrice?: number | null;
  // Позиции ведомости материалов (MaterialLedger.items) — снимок строки
  // сметы, снятый в момент добавления. Владелец, 2026-09-12: "внёс изменения
  // в ведомость материалов по керамограниту, а к новому письму прикрепляется
  // ведомость без изменений... при любом изменении ведомость должна
  // обновляться" — поэтому снимок больше не считается истиной: позиции с
  // sourceMaterialId зеркалятся из живой сметы на каждом рендере (см.
  // lib/ledgerSync.ts), а это поле перечисляет поля, которые пользователь
  // ОСОЗНАННО поправил руками прямо в ведомости (объём под конкретного
  // поставщика, своя формулировка параметров) — только они переживают
  // синхронизацию. Пусто/отсутствует = позиция целиком следует за сметой,
  // так что все ведомости, сохранённые до 2026-09-12, автоматически
  // подтягивают актуальные данные. К закупкам/счетам отношения не имеет.
  ledgerOverrides?: LedgerOverridableField[];
}

// Поля позиции ведомости, которые вообще можно поправить руками (в
// MaterialLedgerModal редактируются только они — название и единица всегда
// берутся из сметы).
export type LedgerOverridableField = 'quantity' | 'note';

export function purchaseItemTotal(item: PurchaseItem): number {
  return (item.quantity ?? 0) * (item.price ?? 0);
}

// Закупка — связывает поставщика (contractors, отфильтрованные так же, как
// вкладка "Каталог" на странице Suppliers.tsx — !teamTier, отдельного
// справочника поставщиков заводить не стали, он уже есть), раздел сметы
// (откуда взят список материалов) и переписку с поставщиком (см.
// data/purchaseEmails.ts). estimateId/sectionId — nullable: закупку можно
// начать до того, как выбрана смета/раздел.
export interface Purchase {
  id: string;
  title: string;
  status: string;
  contractorId: string | null;
  estimateId: string | null;
  sectionId: string | null;
  // Заголовок раздела на момент выбора — на случай переименования/удаления
  // раздела в смете после того, как закупка уже создана (см. EstimateSection —
  // разделы этой сметы уже переименовывались минимум дважды в этой же сессии).
  sectionTitle: string;
  items: PurchaseItem[];
  currency: Currency;
  // Короткий технический код для plus-адреса переписки (см.
  // purchaseEmailAddress ниже) — 5 hex-символов, генерируется в БД (default
  // на колонке short_code, миграция 2026-09-03), уникален.
  shortCode: string;
  createdAt: string;
}

// Форма строки в таблице Supabase (snake_case-колонки) — см. src/lib/purchasesApi.ts
export interface PurchaseRow {
  id: string;
  title: string;
  status: string;
  contractor_id: string | null;
  estimate_id: string | null;
  section_id: string | null;
  section_title: string | null;
  items: PurchaseItem[] | null;
  currency: string;
  short_code: string;
  created_at: string;
}

export function purchaseTotal(purchase: Pick<Purchase, 'items'>): number {
  return purchase.items.reduce((sum, item) => sum + purchaseItemTotal(item), 0);
}

// Email-адрес закупки для переписки с поставщиком — plus-адресация на
// общем ящике снабжения (см. api/purchase-send-email.js/purchase-email-webhook.js):
// все ответы от поставщика приходят на этот же адрес и матчатся на сервере
// по короткому коду закупки в локальной части, отдельного ящика на каждую
// закупку заводить не нужно. Владелец, 2026-09-03: полный UUID в адресе —
// "очень длинный", заменили на короткий уникальный код (shortCode).
export function purchaseEmailAddress(shortCode: string): string {
  return `zakupki+${shortCode}@redevelopment.pro`;
}
