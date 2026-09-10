import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

// Общий выпадающий селектор "одна категория за раз" — изначально был локальным
// в DistrictQuarterMap.tsx, вынесен сюда, чтобы им же мог пользоваться
// DistrictMap.tsx (карта района по пинам): владелец попросил показывать
// пины ОДНОЙ категории за раз вместо всех разом (клутter), тот же принцип
// single-select уже был отработан здесь для заливки кварталов по нише.
export function CategoryToggle({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { key: string; label: string }[];
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((c) => c.key === value);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-border"
      >
        {current?.label ?? 'Категория'}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 pt-2">
          <div className="flex max-h-80 w-56 flex-col gap-0.5 overflow-y-auto rounded-control border border-border bg-surface p-1.5 shadow-card">
            {options.map((category) => (
              <button
                key={category.key}
                type="button"
                onClick={() => {
                  onChange(category.key);
                  setOpen(false);
                }}
                className={cn(
                  'rounded-control px-3 py-1.5 text-left text-xs font-semibold transition-colors',
                  value === category.key ? 'bg-surface-muted text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                {category.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
