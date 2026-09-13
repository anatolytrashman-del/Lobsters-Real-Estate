import { useState, type ElementType } from 'react';
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import {
  zoneTypeLabels,
  workstationsRemaining,
  priceForDeal,
  workstationPriceForDeal,
  type BuildingPlan,
  type BuildingPlanZone,
  type DealMode,
} from '../../data/buildingPlans';
import { cn } from '../../lib/cn';
import { glassCardClass, glassCardShadow } from '../../lib/glass';

const VISIBLE_LIMIT = 5;

// Раньше было "120px_100px_110px_120px_1fr" — колонка "Площадь" (110px) не
// вмещала текст "Свободно N мест" (обрезался троеточием), а последняя
// колонка (1fr) растягивалась на всю оставшуюся ширину карточки, из-за чего
// кнопка "Забронировать"/"Посмотреть на плане" улетала к правому краю,
// оставляя пустой промежуток после "Цена". Теперь первые четыре колонки —
// гибкие (делят свободное место пропорционально, с минимумом под самый
// длинный реалистичный текст), а последняя — auto, по ширине кнопок (см.
// плейсхолдер в шапке ниже, который держит эту ширину синхронной с шапкой).
const UNIT_ROW_GRID_COLS =
  'grid-cols-[minmax(110px,1.2fr)_minmax(70px,0.8fr)_minmax(140px,1.1fr)_minmax(100px,0.9fr)_auto]';

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString('ru-RU')}`;
}

// Аренда — ежемесячный платёж, не разовая цена владения — суффикс к сумме
// (см. тот же приём в ObjectLandingPage.tsx, formatDealMoney).
function formatDealMoney(dealMode: DealMode, value: number) {
  return dealMode === 'rent' ? `${formatMoney(value)}/мес` : formatMoney(value);
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
  // Покупка (по умолчанию) или аренда — переключатель на продающей странице
  // (см. ObjectLandingPage.tsx). Меняет только формулу цены в этой таблице.
  dealMode?: DealMode;
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
  dealMode = 'sale',
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
        price: isWorkstation ? workstationPriceForDeal(dealMode) : priceForDeal(dealMode, z.area as number, z.features),
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
                'grid min-w-[560px] gap-4 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-faint',
                UNIT_ROW_GRID_COLS,
                glass ? 'bg-white/55 backdrop-blur-md' : 'bg-surface-muted',
                onBookClick && 'min-w-[760px]',
              )}
            >
              <span>Кабинет</span>
              <span>Этаж</span>
              <span>Площадь</span>
              <span>Цена</span>
              {/* Невидимый плейсхолдер с теми же кнопками, что и в строках —
                  чтобы последняя колонка (auto-ширина по контенту) совпадала
                  по ширине с колонками строк данных: у каждой строки/шапки
                  своя независимая grid-сетка, и без этого шапка "не знает"
                  сколько места займут реальные кнопки. */}
              <div className="invisible flex shrink-0 items-center justify-end gap-1.5" aria-hidden="true">
                {onLocateClick && (
                  <span className="flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium">
                    <MapPin className="h-3.5 w-3.5" />
                    Посмотреть на плане
                  </span>
                )}
                {onBookClick && (
                  <span className="whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold">Забронировать</span>
                )}
              </div>
            </div>
            {visibleUnits.map((u) => (
              <div
                key={u.zone.id}
                onClick={() => onRowClick(u.zone)}
                onMouseEnter={() => onRowHover?.(u.zone)}
                onMouseLeave={() => onRowHover?.(null)}
                className={cn(
                  'grid w-full min-w-[560px] items-center gap-4 border-t px-4 py-2.5 text-sm',
                  UNIT_ROW_GRID_COLS,
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
                <span className="min-w-0 truncate font-medium text-ink">{formatDealMoney(dealMode, u.price)}</span>
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
                  <span className="shrink-0 font-semibold text-ink">{formatDealMoney(dealMode, u.price)}</span>
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
