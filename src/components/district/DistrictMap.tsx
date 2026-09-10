import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, MapPin, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { glassCardShadow } from '../../lib/glass';
import { DISTRICT_PLACE_CATEGORIES, MAP_HIDDEN_CATEGORY_KEYS } from '../../data/districtPlaces';
import { loadYmaps } from '../../lib/yandexMaps';
import { useInView } from '../../lib/useInView';
import { CategoryToggle } from './CategoryToggle';

// Категории вроде 'auto' (см. комментарий у MAP_HIDDEN_CATEGORY_KEYS) есть
// в данных, но не показываются на этой карте как слой/переключатель.
const VISIBLE_CATEGORIES = DISTRICT_PLACE_CATEGORIES.filter((c) => !MAP_HIDDEN_CATEGORY_KEYS.has(c.key));

const CATEGORY_OPTIONS = VISIBLE_CATEGORIES.map((c) => ({ key: c.key, label: c.label }));

// Интерактивная карта района с пинами ОДНОЙ категории за раз — владелец:
// "давай сделаем карту по категориям, как на аналитике спроса. Типо вот
// все кафешки, вот все аптеки... я боюсь, что если загрузим вообще все
// точки — будет по 10 точек на дом". Раньше здесь были чекбоксы,
// включённые все разом по умолчанию (все ~13 категорий одновременно) —
// ровно тот клаттер, от которого владелец отказался, увидев карту вживую.
// Теперь — тот же выпадающий однократный выбор, что и на карте по
// кварталам (DistrictQuarterMap.tsx, "Конкуренция бизнеса по кварталам"),
// общий компонент CategoryToggle. Данные — DISTRICT_PLACE_CATEGORIES
// (data/districtPlaces.ts), пополняется по мере присылки владельцем
// адресов по новым категориям.
//
// Станции метро/остановки общественного транспорта/паркинги как отдельные
// категории (владелец просил их тоже) — НЕ добавлены: координат этих
// объектов в проекте пока нет (паркинги в data/districtPlaces.ts уже есть
// как 2 категории — "Паркинги — крытые"/"Паркинги — подземные", они и
// так в списке ниже; метро и остановки транспорта — отдельный сбор
// данных, которого не было и раньше, не выдумываю координаты).

// Центр района — по факту собранных точек (см. data/districtPlaces.ts,
// чистка от адресов за пределами района 2026-08-25). Раньше карта
// стартовала через bounds (fit по границам всех точек), но у широкого
// контейнера карточки (намного шире, чем выше) Яндекс.Карты подбирают
// zoom по стороне, которая раньше упирается в контейнер — получается
// сильно отдалённый вид по горизонтали, — владелец: "ты слишком сильно
// отдаляешь". Явные center+zoom вместо bounds — контролируем плотность
// вида напрямую, не завися от aspect ratio контейнера.
const DEFAULT_CENTER: [number, number] = [53.866, 27.5435];
const DEFAULT_ZOOM = 15;

// Карта + легенда — самостоятельный блок, использован дважды (компактно
// на странице и крупно в полноэкранной модалке). Каждый экземпляр — своя
// карта Яндекса и свой стейт переключателей (независимые, не синхронизированы
// между компактным и полноэкранным видом — то же самое, что и у Pro-режима
// "Первичного рынка": модалка открывается со своим дефолтным состоянием).
//
// deferUntilVisible — PAGESPEED_PLAN.md, Э2-1: компактная карта (дефолт)
// начинает грузить тяжёлый API Яндекса (689 КиБ, 2+ с CPU) только когда
// пользователь прокруткой приблизился к ней, а не сразу при открытии
// страницы. Карта в полноэкранной модалке (deferUntilVisible=false) —
// пользователь только что сам нажал "Открыть на весь экран", ждать тут
// нечего, грузим сразу.
function DistrictMapCanvas({
  mapHeightClassName,
  deferUntilVisible = true,
}: {
  mapHeightClassName: string;
  deferUntilVisible?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const collectionsRef = useRef<Record<string, any>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [activeKey, setActiveKey] = useState<string>(VISIBLE_CATEGORIES[0]?.key ?? '');
  const [viewportRef, inView] = useInView<HTMLDivElement>();
  const shouldLoad = !deferUntilVisible || inView;

  useEffect(() => {
    if (!shouldLoad) return;
    let cancelled = false;

    loadYmaps()
      .then((ymaps) => {
        if (cancelled || !containerRef.current) return;

        const map = new ymaps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          controls: ['zoomControl', 'fullscreenControl'],
        });
        mapRef.current = map;

        // Все категории заводятся сразу (как раньше), но видима — только
        // выбранная (activeKey), остальные visible:false. Так переключение
        // категории — просто смена флага у уже готовых коллекций, без
        // пересоздания пинов на каждый выбор.
        for (const category of VISIBLE_CATEGORIES) {
          const collection = new ymaps.GeoObjectCollection();
          for (const place of category.places) {
            collection.add(
              new ymaps.Placemark(
                [place.lat, place.lon],
                {
                  balloonContentHeader: place.name,
                  balloonContentBody: `
                    <div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:6px;padding:2px 8px;border-radius:999px;background:${category.color}1a;color:${category.color};font-size:12px;font-weight:600;">
                      <span style="width:6px;height:6px;border-radius:999px;background:${category.color};"></span>
                      ${category.label}
                    </div>
                    <div>${place.address}</div>
                  `,
                  hintContent: place.name,
                },
                { preset: 'islands#dotIcon', iconColor: category.color },
              ),
            );
          }
          collection.options.set('visible', category.key === activeKey);
          map.geoObjects.add(collection);
          collectionsRef.current[category.key] = collection;
        }

        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
      collectionsRef.current = {};
    };
    // activeKey намеренно не в зависимостях — начальная видимость коллекций
    // выставляется один раз при создании карты (см. эффект ниже, который
    // переключает видимость на уже существующих коллекциях без пересоздания).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldLoad]);

  // Смена категории после того, как карта уже создана — просто переключение
  // visible у уже готовых коллекций (без похода в loadYmaps/пересоздания).
  useEffect(() => {
    for (const [key, collection] of Object.entries(collectionsRef.current)) {
      collection.options.set('visible', key === activeKey);
    }
  }, [activeKey, status]);

  const activeCategory = VISIBLE_CATEGORIES.find((c) => c.key === activeKey);

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          {activeCategory ? (
            <>
              <span className="font-semibold text-ink">{activeCategory.label}</span> — {activeCategory.places.length}{' '}
              точек на карте
            </>
          ) : (
            'Выберите категорию'
          )}
        </p>
        <CategoryToggle value={activeKey} options={CATEGORY_OPTIONS} onChange={setActiveKey} />
      </div>
      {/* data-allow-pinch-zoom — App.tsx блокирует двупальцевый touchmove
          document-wide (usePreventPageZoom, защита от случайного зума
          страницы), но это же ломало щипок для зума самой карты. Атрибут —
          явное исключение из этого перехвата, см. комментарий в App.tsx. */}
      <div
        ref={viewportRef}
        data-allow-pinch-zoom
        className={cn('relative overflow-hidden rounded-control border border-border', mapHeightClassName)}
      >
        {status === 'error' && (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            Не удалось загрузить карту
          </div>
        )}
        {status === 'loading' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface text-sm text-ink-faint">
            Загрузка карты…
          </div>
        )}
        <div ref={containerRef} className="h-full w-full" />
      </div>
      <p className="text-xs text-ink-faint">
        Показана одна категория за раз — переключите список выше, чтобы посмотреть другую.
      </p>
    </div>
  );
}

export function DistrictMap() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <MapPin className="h-5 w-5 shrink-0 text-ink" />
          <h2 className="text-lg font-bold text-ink">Карта района</h2>
        </div>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-border"
        >
          <Maximize2 className="h-3.5 w-3.5 shrink-0" />
          Открыть на весь экран
        </button>
      </div>
      <DistrictMapCanvas mapHeightClassName="h-[420px]" />

      {fullscreen &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setFullscreen(false)} />
            <div
              className="relative flex h-full w-full max-w-5xl flex-col gap-3 overflow-hidden rounded-3xl border border-white/80 bg-bg p-4 sm:p-6"
              style={glassCardShadow}
            >
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-extrabold text-ink">Карта района</h2>
                <button
                  type="button"
                  onClick={() => setFullscreen(false)}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
                >
                  <X className="h-4 w-4" />
                  Закрыть
                </button>
              </div>
              <DistrictMapCanvas mapHeightClassName="flex-1" deferUntilVisible={false} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
