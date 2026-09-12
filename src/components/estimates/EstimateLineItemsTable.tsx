import { Pencil, Trash2, Plus, MessageSquare, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import {
  lineItemMaterialTotal,
  lineItemTotal,
  lineItemWorkTotal,
  sectionLineItemsTotals,
  type EstimateLineItem,
  type EstimateSection,
} from '../../data/estimates';
import { currencySymbols } from '../../data/transactions';
import type { ExchangeRate } from '../../data/exchangeRates';

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

// Итоги раздела/сметы всегда в BYN (сумма разновалютных строк, см.
// sectionLineItemsTotals) — переводить в USD в одну сторону через usdByn.
// Экспортирован — тем же способом считает общий итог по смете EstimateDetail.tsx.
export function formatUsd(valueByn: number, rate: ExchangeRate | null): string | null {
  if (!rate || !rate.usdByn) return null;
  return `$${Math.round(valueByn / rate.usdByn).toLocaleString('ru-RU')}`;
}

export function formatQty(item: EstimateLineItem): string {
  if (item.quantity == null) return '—';
  return `${item.quantity.toLocaleString('ru-RU')}${item.unit ? ` ${item.unit}` : ''}`;
}

// Исходные зоны/названия разделов — буквально КАПСОМ из xlsx подрядчика (см.
// комментарий у EstimateLineItem.zone) — так и хранится, для сверки с
// оригиналом. Для показа приводим к обычному виду: "НАРУЖНАЯ ОТДЕЛКА ФАСАДА"
// → "Наружная отделка фасада". Только отображение, сохранённое значение не
// трогает. Экспортирован — тем же способом форматируют заголовок раздела
// EstimateDetail.tsx/EstimatePublicPage.tsx (раньше применялось только к
// зоне строки, не к самому заголовку раздела — тот и оставался капсом).
export function formatZone(zone: string): string {
  const trimmed = zone.trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

interface EstimateLineItemsTableProps {
  section: EstimateSection;
  rate: ExchangeRate | null;
  onAdd: () => void;
  onEdit: (item: EstimateLineItem) => void;
  onDelete: (item: EstimateLineItem) => void;
  onOpenComments: (item: EstimateLineItem) => void;
  onToggleDeferred: (item: EstimateLineItem) => void;
}

// Построчная (количественная) смета внутри раздела — таблица вида работ с
// объёмом и ценой работ/материалов, отдельно от positions/body выше (см.
// комментарий у EstimateLineItem в data/estimates.ts). Горизонтальный скролл
// вместо переверстки в карточки на мобильном — это внутренняя админ-
// страница, не публичная, а таблица с числами плохо читается карточками.
// Итог — под таблицей, не над ней (владелец: удобнее читать после строк,
// а не гадать, к чему цифра сверху относится, ещё не увидев ни одной строки).
export function EstimateLineItemsTable({
  section,
  rate,
  onAdd,
  onEdit,
  onDelete,
  onOpenComments,
  onToggleDeferred,
}: EstimateLineItemsTableProps) {
  const totals = sectionLineItemsTotals(section, rate);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">Построчная смета</span>

      {section.lineItems.length > 0 && (
        <div className="overflow-x-auto rounded-control border border-border">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2">Вид работ</th>
                <th className="px-3 py-2 text-right">Кол-во</th>
                <th className="px-3 py-2 text-right">Работы</th>
                <th className="px-3 py-2 text-right">Материалы</th>
                <th className="px-3 py-2 text-right">Итого</th>
                <th className="px-3 py-2 text-center">Позже</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {section.lineItems.map((item) => {
                const symbol = currencySymbols[item.currency];
                const isLater = section.deferred || item.deferred;
                return (
                  <tr key={item.id} className={cn('border-t border-border align-top', isLater && 'bg-surface-muted/60')}>
                    <td className={cn('px-3 py-2 text-ink', isLater && 'text-ink-muted')}>
                      {item.workType}
                      {item.note && <div className="text-xs text-ink-faint">{item.note}</div>}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">{formatQty(item)}</td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {formatMoney(lineItemWorkTotal(item))} {symbol}
                    </td>
                    <td className="px-3 py-2 text-right text-ink-muted">
                      {formatMoney(lineItemMaterialTotal(item))} {symbol}
                    </td>
                    <td className={cn('px-3 py-2 text-right font-semibold', isLater ? 'text-ink-muted' : 'text-ink')}>
                      {formatMoney(lineItemTotal(item))} {symbol}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleDeferred(item)}
                        disabled={section.deferred}
                        aria-label="Можно сделать позже"
                        title={section.deferred ? 'Весь раздел уже отмечен «можно позже»' : undefined}
                        className={cn(
                          'mx-auto flex h-5 w-5 items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-50',
                          item.deferred || section.deferred
                            ? 'border-primary bg-primary text-white'
                            : 'border-border text-transparent',
                        )}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onOpenComments(item)}
                          aria-label="Комментарии к строке"
                          className="relative flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                        >
                          <MessageSquare className="h-3 w-3" />
                          {item.comments.length > 0 && (
                            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold text-white">
                              {item.comments.length}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          aria-label="Редактировать строку"
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item)}
                          aria-label="Удалить строку"
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
      )}

      {section.lineItems.length > 0 && (
        <div className="flex flex-col items-end gap-1 text-sm">
          <span className="font-semibold text-ink">
            Сейчас: {formatMoney(totals.now.total)} Br
            {formatUsd(totals.now.total, rate) && <span className="text-ink-muted"> · {formatUsd(totals.now.total, rate)}</span>}
            <span className="ml-1.5 font-normal text-ink-faint">
              (работы {formatMoney(totals.now.work)} + материалы {formatMoney(totals.now.material)})
            </span>
          </span>
          {totals.later.total > 0 && (
            <span className="text-ink-muted">
              Можно позже: {formatMoney(totals.later.total)} Br
              {formatUsd(totals.later.total, rate) && <span> · {formatUsd(totals.later.total, rate)}</span>}
            </span>
          )}
        </div>
      )}

      <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={onAdd}>
        Добавить строку
      </Button>
    </div>
  );
}
