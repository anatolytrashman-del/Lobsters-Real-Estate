import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';

export function SearchInput({
  className,
  wrapperClassName,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { wrapperClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-ink-faint focus-within:border-primary', wrapperClassName)}>
      <Search className="h-4 w-4 shrink-0" />
      <input
        className={cn(
          // text-base, не унаследованный text-sm со span — иначе iOS Safari
          // зумит страницу при фокусе (см. комментарий в Input.tsx).
          'w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-faint sm:text-sm',
          className,
        )}
        {...props}
      />
    </span>
  );
}
