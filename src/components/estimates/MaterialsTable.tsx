import { Pencil, Trash2, MessageSquare } from 'lucide-react';
import type { EstimateMaterial } from '../../data/estimates';
import type { Currency } from '../../data/transactions';

// Владелец, 2026-09-03: "давай зашивать лучшие цены на позиции в текущую
// ведомость материалов. Там, где сейчас заметка, вполне может быть лучшая
// цена с выпадающим списком всех цен от прочих поставщиков" — одна
// известная цена от одного поставщика на позицию сметы (sourceMaterialId —
// общий ключ, см. Suppliers.tsx bestPricesByMaterialId); itemName —
// конкретный товар/бренд, который квотировал поставщик (может отличаться
// от названия позиции сметы — "альтернатива"). price — уже ЦЕНА ЗА ЕДИНИЦУ
// ИЗМЕРЕНИЯ этого материала сметы (владелец, 2026-09-04: "краска идёт в
// литрах, а поставщик выставляет банки... надо пересчитывать на литр"), не
// сырая цена со счёта — единица (m.unit строки, для которой рисуется этот
// список) в подписи опции.
export interface MaterialBestPriceOption {
  price: number;
  currency: Currency;
  supplierName: string;
  itemName: string;
}

function formatQty(m: EstimateMaterial): string {
  if (m.quantity == null) return '—';
  return `${m.quantity.toLocaleString('ru-RU')}${m.unit ? ` ${m.unit}` : ''}`;
}

// Группировка списка материалов по EstimateMaterial.group (см. комментарий
// там же) — общий список (group === '') отдельно от именованных групп,
// каждая своей таблицей, в порядке первого появления в списке, а не
// алфавитном (владелец добавляет позиции по ходу работы, порядок появления
// обычно и есть смысловой). Вынесено отдельно от EstimateMaterialsPanel,
// чтобы той же логикой и той же таблицей мог пользоваться и
// EstimateMaterialsLedgerModal (владелец, 2026-09-01: "нужна одна единая
// ведомость материалов... разбитая на разделы, как сейчас, но в одной
// таблице").
export function groupMaterials(materials: EstimateMaterial[]): {
  ungrouped: EstimateMaterial[];
  groups: { name: string; materials: EstimateMaterial[] }[];
} {
  const ungrouped: EstimateMaterial[] = [];
  const groupOrder: string[] = [];
  const byGroup = new Map<string, EstimateMaterial[]>();
  for (const m of materials) {
    if (!m.group) {
      ungrouped.push(m);
      continue;
    }
    if (!byGroup.has(m.group)) {
      byGroup.set(m.group, []);
      groupOrder.push(m.group);
    }
    byGroup.get(m.group)!.push(m);
  }
  return { ungrouped, groups: groupOrder.map((name) => ({ name, materials: byGroup.get(name)! })) };
}

// Одна и та же таблица переиспользуется и для общего списка (group === ''),
// и для каждой отдельной группы — владелец, 2026-08-31: "сделаем
// строительные леса отдельным блоком, по ним будут запрашиваться цены
// отдельно... прям внутри этой таблицы, но сгруппированно и отдельно".
export function MaterialsTable({
  materials,
  onEdit,
  onDelete,
  onOpenComments,
  bestPricesByMaterialId,
}: {
  materials: EstimateMaterial[];
  onEdit: (material: EstimateMaterial) => void;
  onDelete: (material: EstimateMaterial) => void;
  onOpenComments: (material: EstimateMaterial) => void;
  // Необязательный — только вкладка "Ведомость материалов" на Suppliers.tsx
  // передаёт его (там есть доступ к предложениям/заявкам поставщиков).
  // Смета (EstimateMaterialsPanel) и публичная страница сметы
  // (EstimateMaterialsLedgerModal и там, и там) продолжают показывать
  // обычную заметку — цены поставщиков там ни к месту, особенно на
  // публичной странице (её видит строитель, не сотрудник).
  bestPricesByMaterialId?: Map<string, MaterialBestPriceOption[]>;
}) {
  const showPrices = !!bestPricesByMaterialId;
  return (
    <div className="overflow-x-auto rounded-control border border-border">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
            <th className="px-3 py-2">Название</th>
            <th className="px-3 py-2 text-right">Кол-во</th>
            <th className="px-3 py-2">{showPrices ? 'Лучшая цена' : 'Особенности'}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {materials.map((m) => {
            const priceOptions = bestPricesByMaterialId?.get(m.id) ?? [];
            return (
            <tr key={m.id} className="border-t border-border align-top">
              <td className="px-3 py-2 text-ink">{m.name}</td>
              <td className="px-3 py-2 text-right text-ink-muted">{formatQty(m)}</td>
              <td className="max-w-[240px] px-3 py-2 text-ink-muted">
                {showPrices ? (
                  priceOptions.length > 0 ? (
                    <select
                      defaultValue={0}
                      className="w-full max-w-[220px] rounded-control border border-transparent bg-surface-muted px-2 py-1 text-xs text-ink outline-none focus:border-primary"
                    >
                      {priceOptions.map((opt, i) => (
                        <option key={i} value={i}>
                          {opt.price.toLocaleString('ru-RU')} {opt.currency}
                          {m.unit ? `/${m.unit}` : ''} — {opt.supplierName} ({opt.itemName})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>—</span>
                  )
                ) : (
                  <span className="line-clamp-2">{m.note || '—'}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => onOpenComments(m)}
                    aria-label="Комментарии к материалу"
                    className="relative flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {m.comments.length > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-white">
                        {m.comments.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(m)}
                    aria-label="Редактировать материал"
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(m)}
                    aria-label="Удалить материал"
                    className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
