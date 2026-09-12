import type { Estimate, EstimateMaterial } from '../data/estimates';
import type { MaterialLedger } from '../data/materialLedgers';
import type { LedgerOverridableField, PurchaseItem } from '../data/purchases';

// Ведомость материалов следует за сметой, а не живёт своим снимком.
//
// Владелец, 2026-09-12: "внёс изменения в ведомость материалов по
// керамограниту, а когда создаю новое письмо, как будто прикрепляется
// ведомость без изменений. При любом изменении ведомость должна обновляться и
// к новым письмам должна прикладываться новая ведомость". Реальная причина
// (сверено с прод-базой в тот же день): MaterialLedger.items — снимок строк
// сметы, снятый в момент сборки ведомости, и правка самой сметы его не
// трогала. У ведомости "Керамогранит" в базе лежали примечания БЕЗ ссылок на
// lemanapro, добавленных владельцем в смету позже, — .xlsx собирался ровно из
// этого снимка.
//
// Решение то же, что и у мастер-ведомости (см. lib/masterLedger.ts): НИЧЕГО
// не синхронизируем и не храним повторно — позиции зеркалятся из живых
// estimates на каждом рендере, то есть "обновление" и есть обычный пересчёт.
// Переписывать строки material_ledgers фоном не нужно (и опасно — писать в
// базу на рендер); стоит владельцу нажать "Сохранить" в модалке — уже
// синхронизированные позиции запишутся сами.
//
// Что НЕ перетирается: поля, которые владелец/закупщица осознанно поправили
// руками прямо в ведомости (PurchaseItem.ledgerOverrides, ставится в
// MaterialLedgerModal при правке объёма/параметров). Это нужно ровно потому,
// что в проде такие правки есть: у ведомости "Краска интерьерная" объёмы и
// примечание отличались от сметы ("(в 2 слоя)" вместо внутренней пометки
// "Нужна покраска в 2 слоя, нужно учесть в объеме"). У ведомостей, сохранённых
// ДО 2026-09-12, метки нет вовсе — они подтягивают смету целиком, что и просил
// владелец; дальше решает он сам, правкой в модалке.
//
// Позиции без sourceMaterialId (заведённые вручную "Добавить позицию") и
// позиции, чьего материала в смете больше нет, остаются как есть: тихо
// удалять строку из уже собранной ведомости хуже, чем показать её прежней.

export function estimateMaterialsById(estimates: Estimate[]): Map<string, EstimateMaterial> {
  const map = new Map<string, EstimateMaterial>();
  for (const estimate of estimates) {
    for (const section of estimate.sections) {
      for (const material of section.materials) map.set(material.id, material);
    }
  }
  return map;
}

export function isLedgerFieldOverridden(item: PurchaseItem, field: LedgerOverridableField): boolean {
  return item.ledgerOverrides?.includes(field) ?? false;
}

// Пометить поле как правленное руками. Только для позиций, привязанных к
// смете: у ручных позиций источника нет, синхронизировать их не с чем, и
// лишняя метка в базе только путала бы.
export function markLedgerFieldOverridden(item: PurchaseItem, field: LedgerOverridableField): PurchaseItem {
  if (!item.sourceMaterialId || isLedgerFieldOverridden(item, field)) return item;
  return { ...item, ledgerOverrides: [...(item.ledgerOverrides ?? []), field] };
}

// Вернуть позицию к данным сметы — снимает все метки, после чего позиция
// снова следует за сметой на каждом пересчёте.
export function restoreLedgerItemFromSource(item: PurchaseItem, source: PurchaseItem | EstimateMaterial): PurchaseItem {
  const { ledgerOverrides: _dropped, ...rest } = item;
  return { ...rest, name: source.name, unit: source.unit, quantity: source.quantity, note: source.note };
}

// Позиции одной ведомости, зеркалированные из сметы. Возвращает ТОТ ЖЕ массив,
// если ничего не поменялось — чтобы useMemo-потребители (и мастер-ведомость,
// которая собирается из этих же объектов) не пересоздавались на каждом рендере.
export function syncLedgerItems(items: PurchaseItem[], materialsById: Map<string, EstimateMaterial>): PurchaseItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (!item.sourceMaterialId) return item;
    const source = materialsById.get(item.sourceMaterialId);
    if (!source) return item;
    const synced: PurchaseItem = {
      ...item,
      name: source.name,
      unit: source.unit,
      quantity: isLedgerFieldOverridden(item, 'quantity') ? item.quantity : source.quantity,
      note: isLedgerFieldOverridden(item, 'note') ? item.note : source.note,
    };
    if (
      synced.name === item.name &&
      synced.unit === item.unit &&
      synced.quantity === item.quantity &&
      synced.note === item.note
    ) {
      return item;
    }
    changed = true;
    return synced;
  });
  return changed ? next : items;
}

// Весь список ведомостей, зеркалированный из смет. Пока сметы не загрузились,
// карта пуста — тогда ни у одной позиции источник не найдётся и список
// вернётся прежним (не "обнулится"), это ожидаемое поведение первого рендера.
export function syncLedgersWithEstimates(ledgers: MaterialLedger[], estimates: Estimate[]): MaterialLedger[] {
  const materialsById = estimateMaterialsById(estimates);
  let changed = false;
  const next = ledgers.map((ledger) => {
    const items = syncLedgerItems(ledger.items, materialsById);
    if (items === ledger.items) return ledger;
    changed = true;
    return { ...ledger, items };
  });
  return changed ? next : ledgers;
}
