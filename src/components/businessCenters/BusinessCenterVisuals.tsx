import type { ReactNode } from 'react';
import { Camera, HardHat } from 'lucide-react';
import type { BusinessCenter } from '../../data/businessCenters';

// Общие мелкие визуальные блоки БЦ — используются и на хабе
// (BusinessCentersMinskPage.tsx, компактная карточка), и на отдельной
// странице конкретного БЦ (BusinessCenterDetailPage.tsx, крупное фото) —
// вынесены сюда, чтобы не дублировать (тот же принцип, что и у
// lib/businessCenterDisplay.ts рядом).
export function PhotoBlock({ center }: { center: BusinessCenter }) {
  if (center.photos.length > 0) {
    return <img src={center.photos[0]} alt={center.name} className="h-full w-full object-cover" loading="lazy" />;
  }
  // Фото ещё нет — владелец добавит сам (см. комментарий в data-файле).
  // Тот же визуальный приём, что у карточки "ещё не построен" в Залогах
  // (Objects.tsx) — заливка градиентом вместо пустого места; для строящихся
  // объектов бейдж говорит про стройку, а не про "фото скоро появятся".
  if (center.status === 'under_construction') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-muted to-border">
        <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink shadow-sm">
          <HardHat className="h-3.5 w-3.5 shrink-0" />
          {center.yearBuilt ? `Строится · сдача в ${center.yearBuilt} г.` : 'Строится'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-muted to-border">
      <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink-muted shadow-sm">
        <Camera className="h-3.5 w-3.5 shrink-0" />
        Фото скоро
      </span>
    </div>
  );
}

export function FactRow({ icon: Icon, children }: { icon: typeof Camera; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-ink-muted">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
      <span>{children}</span>
    </div>
  );
}

// Плитка факта — тот же визуальный язык, что и у "Ключевых цифр" на гиде
// района Минск Мир (DistrictGuidePage.tsx: круглая иконка + крупное значение
// + подпись, белая карточка на фоне glass-карточки). Владелец, 2026-09-06:
// "переработай блок фактов в плиточки, можно разного размера... пример бери
// с минск мира". Два режима контента:
// - "stat" (по умолчанию) — крупное жирное значение + мелкая серая подпись,
//   для коротких числовых фактов (площадь/год/этажи/метро после разбивки).
// - "text" — обычный текст без крупного значения, для факта, который не
//   раскладывается на "число + подпись" (парковка, застройщик) — те же
//   карточка/иконка, просто без искусственного разделения на две строки.
// span — растягивает плитку на несколько колонок сетки (владелец,
// 2026-09-06, второй заход, увидев паркинг на пол-ширины: "растяни на 3
// карточки" — на сетке grid-cols-2 sm:grid-cols-4 это col-span-2 на мобиле
// (там и так вся ширина — 2 колонки) и sm:col-span-3 от sm и выше).
const SPAN_CLASSES: Record<number, string> = {
  2: 'col-span-2',
  3: 'col-span-2 sm:col-span-3',
  4: 'col-span-2 sm:col-span-4',
};

export function FactTile({
  icon: Icon,
  value,
  label,
  text,
  span,
}: {
  icon: typeof Camera;
  value?: ReactNode;
  label?: ReactNode;
  text?: ReactNode;
  span?: 2 | 3 | 4;
}) {
  return (
    <div
      className={
        'flex flex-col gap-2 rounded-control border border-border/60 bg-white p-4 shadow-card' +
        (span ? ` ${SPAN_CLASSES[span]}` : '')
      }
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink">
        <Icon className="h-4 w-4" />
      </span>
      {text ? (
        <p className="text-sm font-semibold leading-snug text-ink">{text}</p>
      ) : (
        <>
          <div className="text-lg font-extrabold leading-tight text-ink">{value}</div>
          {label && <p className="text-xs leading-snug text-ink-muted">{label}</p>}
        </>
      )}
    </div>
  );
}
