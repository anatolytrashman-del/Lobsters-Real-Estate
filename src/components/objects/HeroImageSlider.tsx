import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

const AUTOPLAY_MS = 5000;
// PAGESPEED_PLAN.md, Э7-4 — пауза между window 'load' и ПЕРВЫМ
// автопереключением: в окно замера PageSpeed (~3-5 с после load, пока не
// стихнут сеть/CPU) попадали и смена кадра, и догрузка второго фото —
// лишний трафик рядом с LCP-картинкой и «визуальное изменение» после
// LCP, которое тянет вниз Speed Index. Посетителю первые секунды на
// странице тем более не нужна карусель — он читает заголовок.
const AUTOPLAY_FIRST_DELAY_MS = 7000;
// За сколько до переключения догружать следующее фото — достаточно, чтобы
// смена кадра не стала моментом его первой загрузки (мигание), и без
// догрузки «на всякий случай» сразу при монтировании.
const PRELOAD_LEAD_MS = 1500;

// Диагональные скосы у двух противоположных углов (верхний правый и нижний
// левый) вместо стандартных скруглений — одна и та же форма используется и
// для самой картинки, и для подложки под ней (см. ниже), чтобы срезы совпадали.
const CLIP_PATH =
  'polygon(0 0, calc(100% - 56px) 0, 100% 56px, 100% 100%, 56px 100%, 0 calc(100% - 56px))';

interface HeroImageSliderProps {
  images: string[];
  alt?: string;
  // По умолчанию альбомный (16:9) — рендеры кабинетов на /one. Гид района
  // передаёт вертикальный aspect-[4/5] под реальные портретные аэрофото —
  // не разводить два похожих компонента ради одной пропорции.
  aspectClassName?: string;
  // PAGESPEED_PLAN.md, Э4-4 — явные width/height на <img> (аудит CLS
  // "Image elements do not have explicit width and height"). Все картинки
  // одного слайдера — одного реального размера (та же серия фото), поэтому
  // одна пара чисел на весь слайдер, не массив на каждую.
  imageWidth?: number;
  imageHeight?: number;
}

// Слайдер рендеров кабинетов на продающей странице объекта — пока нет
// фото самого здания, это основная картинка на главном экране.
export function HeroImageSlider({
  images,
  alt = '',
  aspectClassName = 'aspect-video',
  imageWidth,
  imageHeight,
}: HeroImageSliderProps) {
  const [index, setIndex] = useState(0);
  // PAGESPEED_PLAN.md, Э4-6 — автоплей не должен стартовать таймер сразу
  // при монтировании: на LCP-картинке (первый слайд) он уже конкурирует за
  // сеть/CPU с остальными критическими ресурсами, а переключение на hero-2
  // спустя пару секунд после захода посетителя означало досрочную догрузку
  // второй картинки поверх ещё не осевшей первой. Ждём window 'load' — на
  // сервере пререндера (SSR-снапшот, см. scripts/prerender.mjs) `load`
  // тоже наступит (обычный браузер), просто скриншот снимается раньше по
  // другому сигналу (h1/«Загрузка…»), автоплей на сам снапшот не влияет.
  const [autoplayArmed, setAutoplayArmed] = useState(false);
  useEffect(() => {
    if (document.readyState === 'complete') {
      setAutoplayArmed(true);
      return;
    }
    const onLoad = () => setAutoplayArmed(true);
    window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  // Автоплей: первый переход — через AUTOPLAY_FIRST_DELAY_MS после load,
  // дальше каждые AUTOPLAY_MS. Следующее фото догружается за
  // PRELOAD_LEAD_MS до переключения (не при монтировании — см. константы
  // выше). Ручной клик по стрелкам/точкам сбрасывает цикл: и таймер, и
  // предзагрузка считаются от текущего кадра заново.
  const firstSwitchDoneRef = useRef(false);
  useEffect(() => {
    if (images.length < 2 || !autoplayArmed) return;
    const delay = firstSwitchDoneRef.current ? AUTOPLAY_MS : AUTOPLAY_FIRST_DELAY_MS;
    const preloadTimer = setTimeout(() => {
      const next = new Image();
      next.src = images[(index + 1) % images.length];
    }, Math.max(0, delay - PRELOAD_LEAD_MS));
    const switchTimer = setTimeout(() => {
      firstSwitchDoneRef.current = true;
      setIndex((i) => (i + 1) % images.length);
    }, delay);
    return () => {
      clearTimeout(preloadTimer);
      clearTimeout(switchTimer);
    };
    // index в зависимостях намеренно: смена кадра (авто или вручную)
    // перезапускает отсчёт от нового кадра.
  }, [images, index, autoplayArmed]);

  if (images.length === 0) return null;

  function go(delta: number) {
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  return (
    // min-h-0 обязателен: без него flex-родитель (страница держит секции в
    // flex-col) считает автоматический min-height по контенту — с портретным
    // фото внутри (уже случилось на гиде района, где фото 512×640, а не
    // альбомные рендеры как здесь) это игнорирует aspect-video и раздувает
    // блок под пропорции самой картинки.
    <div className={cn('relative w-full min-h-0', aspectClassName)}>
      {/* Рассеянная тень вместо жёсткой обводки — drop-shadow (в отличие от
          box-shadow/ring) огибает реальный силуэт после clip-path, включая
          диагональные срезы, без отдельного слоя-рамки. */}
      <div
        className="relative h-full w-full overflow-hidden bg-surface-muted"
        style={{
          clipPath: CLIP_PATH,
          filter:
            'drop-shadow(0 16px 32px rgb(0 0 0 / 0.16)) drop-shadow(0 4px 10px rgb(0 0 0 / 0.10))',
        }}
      >
        <img
          src={images[index]}
          alt={alt}
          className="h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          width={imageWidth}
          height={imageHeight}
        />

        {images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Предыдущее фото"
              className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-ink shadow-card hover:bg-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Следующее фото"
              className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-ink shadow-card hover:bg-white"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            {/* Сама точка — 6px, но кликабельная область кнопки 24×24
                (Accessibility «Touch targets do not have sufficient size or
                spacing» в PageSpeed): визуально ничего не изменилось, точка
                лежит внутри прозрачной кнопки. */}
            <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2">
              {images.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Показать фото ${i + 1}`}
                  className="flex h-6 min-w-6 items-center justify-center px-[3px]"
                >
                  <span
                    aria-hidden="true"
                    className={cn('block h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/60')}
                  />
                </button>
              ))}
            </div>
            <div className="absolute bottom-3 right-3 rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-ink shadow-card">
              {index + 1} / {images.length}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
