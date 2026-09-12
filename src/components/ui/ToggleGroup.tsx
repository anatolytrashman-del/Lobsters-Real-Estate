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
      {/* Скроллящаяся обёртка вынесена ИЗ самой пилюли намеренно. max-w-full +
          overflow-x-auto — страховка на случай, когда вариантов много или
          подписи длинные (напр. "Обработка" с 5 вариантами на 375px, UX-
          аудит): пилюля не вылезает за экран, а скроллится внутри себя,
          сохраняя форму, вместо переноса на новую строку (который сломал бы
          визуальный вид единой "таблетки"). Но overflow-x-auto режет и по
          вертикали тоже (второй оси нельзя оставить visible), поэтому пока
          скролл висел на самой пилюле, бейдж непрочитанных — он по задумке
          торчит за края кнопки (-top-1.5/-right-1.5) — срезался её границей
          (владелец, 2026-09-11: "счётчик всё равно обрезается"). Теперь
          скролл на внешнем блоке, а pt-2/pr-2 дают бейджу место внутри
          области прокрутки; -mt-2/-mr-2 гасят эти паддинги в раскладке, так
          что пилюля стоит ровно там же, где стояла.
          2026-09-12, сборка релизной очереди: два параллельных диалога чинили
          этот баг по отдельности — в oodobu приехал вариант с pt/pr + -mt и
          z-10 у бейджа, в ветке sharp-hawking-f1n70s — вариант с -mr (правый
          край обрезался тоже), но без z-10. Взято и то, и другое. */}
      <div className="-mr-2 -mt-2 max-w-full overflow-x-auto pr-2 pt-2">
        <div className="flex w-fit gap-1 rounded-full border border-border bg-surface-muted p-1">
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
                {/* z-10 — чтобы бейдж рисовался поверх фона соседней кнопки
                    справа (она идёт следом в DOM и иначе перекрывала бы его). */}
                {badgeCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
