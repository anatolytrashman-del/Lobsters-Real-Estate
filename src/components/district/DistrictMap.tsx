import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Maximize2, MapPin, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { glassCardShadow } from '../../lib/glass';
import { DISTRICT_PLACE_CATEGORIES, MAP_HIDDEN_CATEGORY_KEYS } from '../../data/districtPlaces';
import { loadYmaps } from '../../lib/yandexMaps';
import { useInView } from '../../lib/useInView';

// Категории вроде 'auto' (см. комментарий у MAP_HIDDEN_CATEGORY_KEYS) есть
// в данных, но не показываются на этой карте как слой/переключатель.
const VISIBLE_CATEGORIES = DISTRICT_PLACE_CATEGORIES.filter((c) => !MAP_HIDDEN_CATEGORY_KEYS.has(c.key));

// Интерактивная карта района с переключаемыми по категориям метками —
// владелец: "типо это аптеки, а это барбершопы, и можно что-то выключить,
// а что-то оставить". Заменяет прежний статичный iframe на Конструктор
// карт (тот был просто картинкой без интерактива, а Конструктор к тому же
// не хранит цвет по категориям при импорте — см. журнал CLAUDE.md).
// Данные — DISTRICT_PLACE_CATEGORIES (data/districtPlaces.ts), пополняется
// по мере присылки владельцем адресов по новым категориям.

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
  const [activeKeys, setActiveKeys] = useState<Set<string>>(
    () => new Set(VISIBLE_CATEGORIES.map((c) => c.key)),
  );
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
  }, [shouldLoad]);

  function toggleCategory(key: string) {
    setActiveKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      const collection = collectionsRef.current[key];
      if (collection) collection.options.set('visible', next.has(key));
      return next;
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
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
      <div className="flex flex-wrap gap-1.5">
        {VISIBLE_CATEGORIES.map((category) => {
          const active = activeKeys.has(category.key);
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => toggleCategory(category.key)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-border bg-surface-muted text-ink hover:bg-border'
                  : 'border-border/60 text-ink-faint hover:border-border hover:text-ink-muted'
              }`}
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors"
                style={
                  active
                    ? { backgroundColor: category.color, borderColor: category.color }
                    : { borderColor: '#d8d6d2' }
                }
              >
                {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </span>
              <span className={active ? '' : 'line-through decoration-ink-faint'}>{category.label}</span>
              <span className="text-ink-faint">{category.places.length}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-faint">Нажмите на категорию, чтобы показать или скрыть её метки на карте.</p>
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
