import { cn } from '../../lib/cn';

interface ToggleGroupProps {
  label?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  // Необязательный счётчик поверх конкретных пунктов (например,
  // непрочитанные письма на вкладке "Email") — владелец, 2026-09-03:
  // "пусть уведомление горит внутри чекбокса", раньше был отдельным
  // бейджем рядом с ToggleGroup целиком, что визуально выглядело
  // оторванным от конкретного пункта. Значение 0/отсутствие ключа — бейдж
  // не рисуется.
  badges?: Record<string, number>;
}

export function ToggleGroup({ label, options, value, onChange, badges }: ToggleGroupProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <span className="text-sm text-ink-muted">{label}</span>}
      {/* w-fit — сжимается до содержимого, если помещается; max-w-full +
          overflow-x-auto — страховка на случай, когда вариантов много или
          подписи длинные (напр. "Обработка" с 5 вариантами на 375px, UX-
          аудит) — тогда пилюля не вылезает за экран, а скроллится внутри
          себя, сохраняя форму, вместо переноса на новую строку (который
          сломал бы визуальный вид единой "таблетки"). */}
      <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface-muted p-1">
        {options.map((option) => {
          const badgeCount = badges?.[option] ?? 0;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onChange(option)}
              className={cn(
                'relative shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors',
                value === option ? 'bg-surface text-primary shadow-card' : 'text-ink-muted',
              )}
            >
              {option}
              {badgeCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
