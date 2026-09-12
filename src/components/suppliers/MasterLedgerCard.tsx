import { FileText } from 'lucide-react';
import type { MaterialLedger } from '../../data/materialLedgers';

// Строка мастер-ведомости в списке "Готовые ведомости" на вкладке
// "Поставщики" → "Ведомости материалов" (владелец, 2026-09-12: "нужна еще
// одна общая мастер-ведомость... как только в отдельных ведомостях будет
// что-то меняться или их будет становиться больше/меньше, мастер-ведомость
// тоже должна обновляться").
//
// Визуально отделена от обычных ведомостей (рамка/фон primary + бейдж) и
// СОЗНАТЕЛЬНО без кнопок правки и удаления: мастер не хранится, а собирается
// из ведомостей ниже (см. lib/masterLedger.ts) — править в нём нечего,
// удалять тоже (исчезнет сам, когда у сметы останется меньше двух
// ведомостей). Единственное действие — открыть и посмотреть итоговый состав
// перед отправкой поставщику.
export function MasterLedgerCard({
  ledger,
  sourceCount,
  onOpen,
}: {
  ledger: MaterialLedger;
  sourceCount: number;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-control border border-primary/40 bg-primary-soft/40 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-medium text-ink">{ledger.name}</span>
          <span className="shrink-0 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
            обновляется сама
          </span>
        </div>
        <div className="text-xs text-ink-faint">
          {ledger.items.length} {ledger.items.length === 1 ? 'позиция' : 'позиций'} — всё из {sourceCount} ведомостей
          этой сметы, без дублей
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Посмотреть мастер-ведомость"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
      >
        <FileText className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
