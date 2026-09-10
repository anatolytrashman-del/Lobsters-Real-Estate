import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid2x2 } from 'lucide-react';
import { loadYmaps } from '../../lib/yandexMaps';
import { DISTRICT_PLACE_CATEGORIES, MAP_HIDDEN_CATEGORY_KEYS } from '../../data/districtPlaces';
import { DISTRICT_QUARTERS } from '../../data/districtQuarters';
import { DISTRICT_BUSINESS_CATEGORIES } from '../../data/districtBusinessCategories';
import { countsByQuarter, quarterIdForAddress } from '../../lib/districtQuarterMatch';
import { CategoryToggle } from './CategoryToggle';

// Псевдо-категория поверх исчерпывающего снепшота (district_business_points →
// data/districtBusinessCategories.ts, тот же датасет, что и у location
// quotient — см. lib/locationQuotient.ts) — владелец: "подтяни вообще все
// организации из домов на эту карту". В отличие от остальных пунктов
// CategoryToggle (старые фрагментарные DISTRICT_PLACE_CATEGORIES, где пины
// заносятся вручную по одной категории), эта считается по факту — сколько
// организаций реально собрано в каждом квартале, независимо от корзины.
const LIVE_ALL_KEY = 'live-all';
const LIVE_ALL_LABEL = 'Все организации';

interface QuarterOrg {
  title: string;
  address: string;
}

// Приводит "николы теслы" к "Николы Теслы" — тот же приём, что и titleCase
// в DistrictBusinessesTab.tsx (не общий хелпер — раньше эта карта и та
// вкладка не пересекались по нуждам форматирования, дублировать проще,
// чем заводить общий модуль ради одной строчки).
function titleCaseStreet(street: string): string {
  return street.replace(/(^|[\s-])([а-яё])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function formatStreetHouse(street: string, house: string): string {
  return `${titleCaseStreet(street)}, ${house}`;
}

// Считаем один раз при загрузке модуля — DISTRICT_BUSINESS_CATEGORIES
// статический импорт, пересчитывать на каждый рендер незачем. Помимо
// счётчика — сразу и список организаций по кварталу (владелец: "мне бы
// при клике полный список: номер, название, адрес" — балун полигона на
// клик должен показывать не просто число, а сами организации).
const LIVE_ALL_COUNTS_BY_QUARTER: Record<string, number> = {};
const LIVE_ALL_ORGS_BY_QUARTER: Record<string, QuarterOrg[]> = {};
for (const entry of DISTRICT_BUSINESS_CATEGORIES) {
  LIVE_ALL_COUNTS_BY_QUARTER[entry.quarterId] = (LIVE_ALL_COUNTS_BY_QUARTER[entry.quarterId] ?? 0) + 1;
  (LIVE_ALL_ORGS_BY_QUARTER[entry.quarterId] ??= []).push({
    title: entry.title,
    address: formatStreetHouse(entry.street, entry.house),
  });
}
for (const orgs of Object.values(LIVE_ALL_ORGS_BY_QUARTER)) {
  orgs.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
}

// Карта конкуренции бизнеса по кварталам — владелец: "плотность ниш по
// конкретным кварталам минск мира, чтобы было похоже на аналитику best
// place... Минск Мир разбит на конкретные кварталы, которые легко
// гуглятся". Границы кварталов — не свои полигоны "на глаз", а построены
// по официальному справочнику застройщика "дом → квартал" (владелец
// прислал файл, 2026-08-25, см. data/districtQuarters.ts) — там же
// объяснение, почему у части точек нет квартала (справочник покрывает не
// все дома района). В отличие от DistrictMap.tsx (точки, много категорий
// разом), тут ровно одна выбранная категория и заливка кварталов по её
// плотности — выбор категории меняет заливку, а не набор меток.

const HEAT_LIGHT = { r: 0xfd, g: 0xe3, b: 0xe5 }; // --color-primary-soft
const HEAT_DARK = { r: 0xe4, g: 0x15, b: 0x2b }; // --color-primary

function heatColor(ratio: number): string {
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(HEAT_LIGHT.r + (HEAT_DARK.r - HEAT_LIGHT.r) * t);
  const g = Math.round(HEAT_LIGHT.g + (HEAT_DARK.g - HEAT_LIGHT.g) * t);
  const b = Math.round(HEAT_LIGHT.b + (HEAT_DARK.b - HEAT_LIGHT.b) * t);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function polygonCentroid(polygon: [number, number][]): [number, number] {
  const lat = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const lon = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  return [lat, lon];
}

// Грубая оценка площади в градусах² — только чтобы выбрать САМЫЙ большой
// под-полигон квартала под единственную подпись-число (у квартала может
// быть несколько отдельных фигур, см. комментарий в data/districtQuarters.ts
// — цифра на карте не должна дублироваться на каждом кусочке).
function polygonArea(polygon: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [lat1, lon1] = polygon[i];
    const [lat2, lon2] = polygon[(i + 1) % polygon.length];
    area += lat1 * lon2 - lat2 * lon1;
  }
  return Math.abs(area / 2);
}

const DEFAULT_CENTER: [number, number] = [53.866, 27.5435];
const DEFAULT_ZOOM = 15;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Балун полигона квартала на клик — владелец: "мне бы при клике полный
// список: номер, название, адрес" (было — просто "N точек категории").
// max-height+overflow — у некоторых кварталов больше сотни организаций
// (Тропические острова — 113), без прокрутки балун растянулся бы на весь
// экран.
function buildOrgListBalloonHtml(orgs: QuarterOrg[]): string {
  const rows = orgs
    .map(
      (org, i) => `
        <tr>
          <td style="padding:2px 6px 2px 0;color:#9a9691;vertical-align:top;">${i + 1}</td>
          <td style="padding:2px 6px 2px 0;font-weight:600;vertical-align:top;">${escapeHtml(org.title)}</td>
          <td style="padding:2px 0;color:#6b6660;vertical-align:top;">${escapeHtml(org.address)}</td>
        </tr>`,
    )
    .join('');
  return `
    <div style="max-height:280px;overflow-y:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// "53 организации", не "53 организаций" — числительное 53 требует
// родительного падежа единственного числа, не множественного.
function pluralOrganizations(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'организация';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'организации';
  return 'организаций';
}

// Все кварталы в DISTRICT_QUARTERS теперь размечены владельцем лично своим
// инструментом (клики по углам на живой карте) — фильтр на "только
// проверенные" (был здесь раньше, см. историю) больше не нужен.
const VISIBLE_QUARTERS = DISTRICT_QUARTERS;

// Паркинги — не бизнес, конкурировать за нишу им не с кем (владелец,
// 2026-09-10: "удали паркинги из конкуренции"). Раньше это скрывалось
// отдельным набором ключей именно здесь, потому что на обычной карте
// района (DistrictMap.tsx) паркинги оставались — но владелец тем же днём
// чуть позже попросил убрать паркинги и оттуда тоже ("убирай паркинги с
// карты района, и обычные, и крытые"), так что теперь оба ключа уже есть
// в общем MAP_HIDDEN_CATEGORY_KEYS и отдельный набор здесь избыточен.
//
// Опции селектора категории — живая псевдо-категория первой (она же
// дефолт), дальше старые фрагментарные категории застройщика как раньше.
const CATEGORY_OPTIONS = [
  { key: LIVE_ALL_KEY, label: LIVE_ALL_LABEL },
  ...DISTRICT_PLACE_CATEGORIES.filter((c) => !MAP_HIDDEN_CATEGORY_KEYS.has(c.key)).map((c) => ({
    key: c.key,
    label: c.label,
  })),
];

// Опции селектора квартала — "Весь район" (дефолт, прежнее поведение карты
// целиком) + каждый квартал отдельно (для фокуса на одном).
const ALL_QUARTERS_KEY = 'all';
const QUARTER_OPTIONS = [
  { key: ALL_QUARTERS_KEY, label: 'Весь район' },
  ...VISIBLE_QUARTERS.map((q) => ({ key: q.id, label: q.label })),
];

// Грубый bounding box квартала (может состоять из нескольких отдельных
// фигур, см. комментарий в data/districtQuarters.ts) — используется, чтобы
// при выборе конкретного квартала подстроить под него зум/центр карты.
function quarterBounds(quarter: (typeof VISIBLE_QUARTERS)[number]): [[number, number], [number, number]] {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const poly of quarter.polygons) {
    for (const [lat, lon] of poly) {
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function DistrictQuarterMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [categoryKey, setCategoryKey] = useState(LIVE_ALL_KEY);
  const [quarterKey, setQuarterKey] = useState(ALL_QUARTERS_KEY);

  const counts = useMemo(
    () => (categoryKey === LIVE_ALL_KEY ? LIVE_ALL_COUNTS_BY_QUARTER : countsByQuarter(categoryKey)),
    [categoryKey],
  );
  const maxCount = useMemo(() => Math.max(1, ...Object.values(counts)), [counts]);
  const matchedTotal = useMemo(() => Object.values(counts).reduce((sum, n) => sum + n, 0), [counts]);
  const categoryTotal =
    categoryKey === LIVE_ALL_KEY ? DISTRICT_BUSINESS_CATEGORIES.length : DISTRICT_PLACE_CATEGORIES.find((c) => c.key === categoryKey)?.places.length ?? 0;
  const categoryLabel = categoryKey === LIVE_ALL_KEY ? LIVE_ALL_LABEL : DISTRICT_PLACE_CATEGORIES.find((c) => c.key === categoryKey)?.label;

  const selectedQuarter = quarterKey === ALL_QUARTERS_KEY ? null : VISIBLE_QUARTERS.find((q) => q.id === quarterKey) ?? null;
  // useMemo — не просто инлайн-тернарник, иначе [selectedQuarter] был бы
  // новым массивом на каждый рендер и ниже effect (deps: quartersToDraw)
  // перерисовывал бы слой карты чаще, чем реально меняется выбор квартала.
  const quartersToDraw = useMemo(() => (selectedQuarter ? [selectedQuarter] : VISIBLE_QUARTERS), [selectedQuarter]);

  useEffect(() => {
    let cancelled = false;
    loadYmaps()
      .then((ymaps) => {
        if (cancelled || !containerRef.current) return;
        const map = new ymaps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          controls: ['zoomControl'],
        });
        mapRef.current = map;
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, []);

  // Перерисовываем заливку кварталов при смене категории или квартала — не
  // пересоздаём саму карту (скрипт API не меняется), только цвет/подписи и
  // набор нарисованных полигонов (весь район или один выбранный квартал).
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map || !window.ymaps) return;
    const ymaps = window.ymaps;

    if (layerRef.current) {
      map.geoObjects.remove(layerRef.current);
    }
    const layer = new ymaps.GeoObjectCollection();
    for (const quarter of quartersToDraw) {
      const count = counts[quarter.id] ?? 0;
      const ratio = count / maxCount;
      const fillColor = heatColor(count > 0 ? Math.max(ratio, 0.12) : 0);

      const orgs: QuarterOrg[] =
        categoryKey === LIVE_ALL_KEY
          ? LIVE_ALL_ORGS_BY_QUARTER[quarter.id] ?? []
          : (DISTRICT_PLACE_CATEGORIES.find((c) => c.key === categoryKey)?.places ?? [])
              .filter((place) => quarterIdForAddress(place.address) === quarter.id)
              .map((place) => ({ title: place.name, address: place.address }))
              .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
      const balloonBody = orgs.length > 0 ? buildOrgListBalloonHtml(orgs) : `0 точек категории «${categoryLabel}»`;

      // Квартал может состоять из нескольких отдельных фигур (см. комментарий
      // в data/districtQuarters.ts) — рисуем каждую тем же цветом, подпись с
      // числом ставим только на самой крупной, чтобы не дублировать цифру.
      let largestIndex = 0;
      let largestArea = -1;
      quarter.polygons.forEach((poly, i) => {
        const area = polygonArea(poly);
        if (area > largestArea) {
          largestArea = area;
          largestIndex = i;
        }
      });

      quarter.polygons.forEach((poly, i) => {
        const polygon = new ymaps.Polygon(
          [poly],
          {
            balloonContentHeader: quarter.label,
            balloonContentBody: balloonBody,
            hintContent: `${quarter.label}: ${count}`,
          },
          {
            fillColor,
            fillOpacity: count > 0 ? 0.75 : 0.35,
            strokeColor: '#ffffff',
            strokeWidth: 2,
            strokeOpacity: 0.9,
          },
        );
        layer.add(polygon);

        if (i === largestIndex) {
          const [lat, lon] = polygonCentroid(poly);
          const label = new ymaps.Placemark(
            [lat, lon],
            { iconContent: String(count) },
            { preset: 'islands#blackStretchyIcon' },
          );
          layer.add(label);
        }
      });
    }
    map.geoObjects.add(layer);
    layerRef.current = layer;
  }, [status, counts, maxCount, categoryKey, categoryLabel, quartersToDraw]);

  // Зум/центр карты подстраивается под выбранный квартал (селектор
  // "Квартал"), отдельно от перерисовки заливки выше — "Весь район"
  // возвращает карту к обзору всего района.
  useEffect(() => {
    const map = mapRef.current;
    if (status !== 'ready' || !map) return;
    if (!selectedQuarter) {
      map.setCenter(DEFAULT_CENTER, DEFAULT_ZOOM);
      return;
    }
    map.setBounds(quarterBounds(selectedQuarter), { checkZoomRange: true, zoomMargin: 40 });
  }, [status, selectedQuarter]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Grid2x2 className="h-5 w-5 shrink-0 text-ink" />
        <h2 className="text-lg font-bold text-ink">Конкуренция бизнеса по кварталам</h2>
      </div>
      <p className="text-sm text-ink-muted">
        Плотность выбранной категории по официальным кварталам застройки Минск Мира — чем темнее квартал, тем выше
        концентрация точек этой категории.
      </p>

      {/* flex-col на мобильном — два селектора рядом не помещались на
          375px, каждый сжимался до нечитаемого. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1">
          {/* text-ink-muted, не text-ink-faint — PAGESPEED_PLAN.md, Э8-1:
              faint на белом даёт 2,77:1, ниже нормы WCAG 4,5:1 для мелкого
              текста (аудит Accessibility PageSpeed это и поймал). */}
          <span className="text-xs font-semibold text-ink-muted">Категория бизнеса</span>
          <CategoryToggle value={categoryKey} options={CATEGORY_OPTIONS} onChange={setCategoryKey} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-muted">Квартал</span>
          <CategoryToggle value={quarterKey} options={QUARTER_OPTIONS} onChange={setQuarterKey} />
        </div>
      </div>

      {/* data-allow-pinch-zoom — см. комментарий в App.tsx (usePreventPageZoom)
          и в DistrictMap.tsx — исключает эту карту из глобальной блокировки
          двупальцевого touchmove, иначе щипок для зума карты не работал. */}
      <div data-allow-pinch-zoom className="relative h-[420px] overflow-hidden rounded-control border border-border">
        {status === 'error' && (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">Не удалось загрузить карту</div>
        )}
        {status === 'loading' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface text-sm text-ink-faint">
            Загрузка карты…
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-ink-muted">Меньше</span>
        <div className="h-2.5 flex-1 rounded-full" style={{ background: `linear-gradient(to right, ${heatColor(0.12)}, ${heatColor(1)})` }} />
        <span className="text-xs font-medium text-ink-muted">Больше</span>
      </div>

      {selectedQuarter ? (
        <p className="text-xs text-ink-muted">
          В квартале «{selectedQuarter.label}» — {counts[selectedQuarter.id] ?? 0}{' '}
          {categoryKey === LIVE_ALL_KEY
            ? pluralOrganizations(counts[selectedQuarter.id] ?? 0)
            : `точек категории «${categoryLabel}»`}
          .
        </p>
      ) : categoryKey === LIVE_ALL_KEY ? null : (
        <p className="text-xs text-ink-muted">
          Учтено {matchedTotal} из {categoryTotal} точек категории «{categoryLabel}» — справочник застройщика
          покрывает не все дома района (например, паркинги и часть коммерческих зданий вне жилых кварталов в него не
          входят).
        </p>
      )}
    </div>
  );
}
