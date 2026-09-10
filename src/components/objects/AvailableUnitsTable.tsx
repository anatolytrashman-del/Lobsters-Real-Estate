import { useState, type ElementType } from 'react';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import {
  zonePrice,
  zoneTypeLabels,
  workstationsRemaining,
  WORKSTATION_PRICE,
  type BuildingPlan,
  type BuildingPlanZone,
} from '../../data/buildingPlans';
import { cn } from '../../lib/cn';
import { glassCardClass, glassCardShadow } from '../../lib/glass';

const VISIBLE_LIMIT = 5;

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString('ru-RU')}`;
}

// Общая таблица свободных кабинетов — используется и во внутренней карточке
// объекта (после BuildingPlanWidget), и на публичной странице для клиента,
// с одинаковыми фильтрами и расчётом цены (см. zonePrice в data/buildingPlans).
interface AvailableUnitsTableProps {
  plans: BuildingPlan[];
  zones: BuildingPlanZone[];
  highlightedZoneId?: string | null;
  onRowClick: (zone: BuildingPlanZone) => void;
  onRowHover?: (zone: BuildingPlanZone | null) => void;
  // Отдельная кнопка "Посмотреть на плане" — в отличие от onRowClick (который
  // открывает карточку кабинета) только переключает этаж и подсвечивает
  // контур, не закрывая план модалкой. Не передаётся там, где просмотр
  // плана вообще скрыт (лендинг объекта, см. PublicPlanAndUnits) — тогда
  // кнопка и место под неё не рендерятся.
  onLocateClick?: (zone: BuildingPlanZone) => void;
  // Только на публичных страницах — открывает форму брони сразу, без
  // промежуточного клика по кабинету. В админке не передаётся, поэтому
  // кнопка и место под неё там не показываются.
  onBookClick?: (zone: BuildingPlanZone) => void;
  // См. src/lib/glass.ts. Включено на продающей странице /:slug; в админке
  // и на легаси-странице /plan/:token остаётся выключенным.
  glass?: boolean;
  // Внутри объединённого блока "план + список на вкладках" (PublicPlanAndUnits)
  // таблица уже находится в чужой карточке — убирает собственную
  // обёртку/паддинги/заголовок, чтобы не получилась карточка в карточке.
  // В админке (BuildingPlanWidget) не передаётся — там своя отдельная карточка.
  bare?: boolean;
}

export function AvailableUnitsTable({
  plans,
  zones,
  highlightedZoneId,
  onRowClick,
  onRowHover,
  onLocateClick,
  onBookClick,
  glass,
  bare,
}: AvailableUnitsTableProps) {
  const Wrapper: ElementType = bare || glass ? 'div' : Card;
  const [minArea, setMinArea] = useState('');
  const [maxArea, setMaxArea] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [expanded, setExpanded] = useState(false);

  const planNameById = new Map(plans.map((p) => [p.id, p.name]));

  const units = zones
    .filter((z) => z.zoneType === 'room')
    .filter((z) => (z.workstationCount != null ? workstationsRemaining(z) > 0 : z.status === 'Свободно' && z.area != null))
    .map((z) => {
      const isWorkstation = z.workstationCount != null;
      return {
        zone: z,
        isWorkstation,
        area: isWorkstation ? null : (z.area as number),
        price: isWorkstation ? WORKSTATION_PRICE : zonePrice(z.area as number, z.features),
        floor: planNameById.get(z.buildingPlanId) ?? '—',
        remaining: isWorkstation ? workstationsRemaining(z) : null,
        total: isWorkstation ? z.workstationCount : null,
      };
    })
    // Фильтр по площади не имеет смысла для строки с рабочими местами —
    // у неё нет единой площади, поэтому такие строки пропускают фильтр площади.
    .filter((u) => u.isWorkstation || !minArea.trim() || u.area! >= Number(minArea))
    .filter((u) => u.isWorkstation || !maxArea.trim() || u.area! <= Number(maxArea))
    .filter((u) => !minPrice.trim() || u.price >= Number(minPrice))
    .filter((u) => !maxPrice.trim() || u.price <= Number(maxPrice))
    .sort((a, b) => a.price - b.price);

  const visibleUnits = expanded ? units : units.slice(0, VISIBLE_LIMIT);
  const hiddenCount = units.length - visibleUnits.length;

  // Input красит фон общим bg-surface-muted (светло-серый) — на полупрозрачной
  // стеклянной карточке он сливается с фоном, поэтому здесь пробиваем контраст
  // инлайн-стилем: он гарантированно перебивает класс независимо от порядка
  // сборки Tailwind (в отличие от передачи className, где порядок не гарантирован).
  const inputGlassStyle = glass
    ? { backgroundColor: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.7)' }
    : undefined;

  return (
    <Wrapper
      className={cn('flex flex-col gap-4', !bare && 'p-5', glass && !bare && glassCardClass)}
      style={glass && !bare ? glassCardShadow : undefined}
    >
      {!bare && <div className="font-bold text-ink">Доступные кабинеты</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input label="Площадь от, м²" type="number" placeholder="0" value={minArea} onChange={(e) => setMinArea(e.target.value)} style={inputGlassStyle} />
        <Input label="Площадь до, м²" type="number" placeholder="0" value={maxArea} onChange={(e) => setMaxArea(e.target.value)} style={inputGlassStyle} />
        <Input label="Цена от, $" type="number" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} style={inputGlassStyle} />
        <Input label="Цена до, $" type="number" placeholder="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} style={inputGlassStyle} />
      </div>

      {units.length === 0 ? (
        <p className="text-sm text-ink-muted">Нет кабинетов, подходящих под фильтр.</p>
      ) : (
        <>
          {/* От md и шире — таблица-грид с колонками. На узких экранах горизонтальный
              скролл таблицы неудобен, поэтому ниже md те же данные рендерятся как
              стопка карточек (см. блок ниже). С колонкой "Забронировать"
              (onBookClick) минимальная ширина таблицы — 760px, а на 768px
              (типичный планшет-портрет) после отступов страницы остаётся
              меньше — кнопка обрезалась по правому краю карточки (UX-аудит).
              Порог переключения сдвинут до lg (1024px) именно для этого
              случая — без кнопки брони (админка/просмотр плана) 560px и
              так помещаются на md, трогать не нужно. */}
          <div
            className={cn(
              'hidden overflow-x-auto rounded-control border',
              onBookClick ? 'lg:block' : 'md:block',
              glass ? 'border-white/50' : 'border-border',
            )}
          >
            <div
              className={cn(
                'grid min-w-[560px] grid-cols-[120px_100px_110px_120px_1fr] gap-4 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint',
                glass ? 'bg-white/55 backdrop-blur-md' : 'bg-surface-muted',
                onBookClick && 'min-w-[760px]',
              )}
            >
              <span>Кабинет</span>
              <span>Этаж</span>
              <span>Площадь</span>
              <span>Цена</span>
              <span />
            </div>
            {visibleUnits.map((u) => (
              <div
                key={u.zone.id}
                onClick={() => onRowClick(u.zone)}
                onMouseEnter={() => onRowHover?.(u.zone)}
                onMouseLeave={() => onRowHover?.(null)}
                className={cn(
                  'grid w-full min-w-[560px] grid-cols-[120px_100px_110px_120px_1fr] cursor-pointer items-center gap-4 border-t px-4 py-2.5 text-sm',
                  glass ? 'border-white/50 bg-white/30 hover:bg-white/50' : 'border-border hover:bg-surface-muted',
                  onBookClick && 'min-w-[760px]',
                  u.zone.id === highlightedZoneId && 'bg-primary/10',
                )}
              >
                <span className="min-w-0 truncate font-medium text-ink">
                  {u.isWorkstation ? 'Рабочее место' : u.zone.label || zoneTypeLabels[u.zone.zoneType]}
                </span>
                <span className="min-w-0 truncate text-ink-muted">{u.floor}</span>
                <span className="min-w-0 truncate text-ink">
                  {u.isWorkstation ? `Свободно ${u.remaining} мест` : `${u.area} м²`}
                </span>
                <span className="min-w-0 truncate font-medium text-ink">{formatMoney(u.price)}</span>
                <div className="flex shrink-0 items-center justify-end gap-1.5">
                  {onLocateClick && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLocateClick(u.zone);
                      }}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary',
                        glass ? 'border-white/50 bg-white/30 text-ink backdrop-blur-md' : 'border-border text-ink-muted',
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      Посмотреть на плане
                    </button>
                  )}
                  {onBookClick && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBookClick(u.zone);
                      }}
                      className="whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/85"
                    >
                      Забронировать
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Ниже порога таблицы (см. комментарий выше) — карточки вместо строк
              таблицы, без горизонтального скролла. */}
          <div className={cn('flex flex-col gap-2.5', onBookClick ? 'lg:hidden' : 'md:hidden')}>
            {visibleUnits.map((u) => (
              <div
                key={u.zone.id}
                onClick={() => onRowClick(u.zone)}
                className={cn(
                  'flex cursor-pointer flex-col gap-2.5 rounded-control border p-3.5',
                  glass ? 'border-white/80 bg-white/60 hover:bg-white/75' : 'border-border hover:bg-surface-muted',
                  u.zone.id === highlightedZoneId && 'bg-primary/10',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium text-ink">
                    {u.isWorkstation ? 'Рабочее место' : u.zone.label || zoneTypeLabels[u.zone.zoneType]}
                  </span>
                  <span className="shrink-0 font-semibold text-ink">{formatMoney(u.price)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
                  <span>{u.floor}</span>
                  <span>{u.isWorkstation ? `Свободно ${u.remaining} мест` : `${u.area} м²`}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {onLocateClick && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLocateClick(u.zone);
                      }}
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary',
                        glass ? 'border-white/80 bg-white/60 text-ink backdrop-blur-md' : 'border-border text-ink-muted',
                      )}
                    >
                      <MapPin className="h-3.5 w-3.5" />
                      На плане
                    </button>
                  )}
                  {onBookClick && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onBookClick(u.zone);
                      }}
                      className="whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/85"
                    >
                      Забронировать
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {(hiddenCount > 0 || expanded) && units.length > VISIBLE_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary-hover hover:underline"
            >
              {expanded ? (
                <>
                  Свернуть
                  <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  Показать ещё {hiddenCount}
                  <ChevronDown className="h-4 w-4" />
                </>
              )}
            </button>
          )}
        </>
      )}
    </Wrapper>
  );
}
