import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Award,
  Banknote,
  Building,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  Info,
  Landmark,
  Layers,
  Leaf,
  MapPin,
  MapPinned,
  MessageSquareQuote,
  Newspaper,
  Palette,
  Phone,
  Ruler,
  ScrollText,
  Snowflake,
  Sparkles,
  Star,
  Store,
  TrainFront,
  Users,
  Wifi,
  Wrench,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import { Badge } from '../components/ui/Badge';
import { PhotoBlock, FactRow, FactTile } from '../components/businessCenters/BusinessCenterVisuals';
import { setBreadcrumbJsonLd, setFaqJsonLd, setNoIndex, clearNoIndex, setBusinessCenterPageMeta } from '../lib/pageMeta';
import { shortName, sortByShortName, mapRatingFromHighlights, streetOfAddress } from '../lib/businessCenterDisplay';
import { nearestMetroStation } from '../lib/metroStations';
import { metroHubDistance, metroHubUrl, streetHubUrl, districtDative } from '../lib/businessCenterHubs';
import type { BusinessCenter, HighlightIconKey, TechnicalParam, TenantOrganization } from '../data/businessCenters';
import { fetchBusinessCenters } from '../lib/businessCentersApi';
import type { BusinessCenterOffer } from '../data/businessCenterOffers';
import { fetchBusinessCenterOffers } from '../lib/businessCenterOffersApi';
import { fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { MIN_RELIABLE_N, type MarketSnapshot } from '../data/marketSnapshots';
import type { BusinessCenter2gisSnapshot, Gis2Schedule, Gis2ScheduleDay } from '../data/businessCenter2gis';
import { fetchBusinessCenter2gisSnapshot } from '../lib/businessCenter2gisApi';

// Отдельная страница одного бизнес-центра (владелец, 2026-09-04: "для SEO
// лучше хаб + отдельная страница на каждый БЦ" — согласился с этим доводом
// и попросил именно так). Визуально — оверлей-«модалка» (та же стилистика,
// что у ImageLightbox.tsx: крестик-закрытие, стрелки влево/вправо по краям
// экрана), но технически обычная полноценная страница со своим URL —
// иначе AI-краулеры/Яндекс без выполнения JS не увидели бы контент, а
// title/canonical/JSON-LD не смогли бы быть уникальными под конкретный БЦ.
// "Закрытие" ведёт не назад в истории браузера, а явно на /minsk/bcminsk —
// так работает предсказуемо и при заходе по прямой ссылке из поиска, когда
// в истории браузера страницы хаба вообще нет.

// Общие источники данных для всего каталога БЦ (владелец, 2026-09-06: "давай
// внизу напишем полный список источников, пусть будут кликабельными") — не
// привязаны к конкретному БЦ (фото/теххарактеристики — prometr.by, метро/
// рейтинг/организации — Яндекс.Карты и 2ГИС, объявления — Kufar и Realt,
// часть резонансных фактов — Onliner), показываются на КАЖДОЙ карточке
// одинаково; официальный сайт самого здания (если найден) — отдельной
// ссылкой следом, он специфичен для конкретного БЦ.
const GENERAL_DATA_SOURCES = [
  { label: 'prometr.by', href: 'https://prometr.by/' },
  { label: 'Kufar', href: 'https://www.kufar.by/' },
  { label: 'Realt.by', href: 'https://realt.by/' },
  { label: 'Onliner', href: 'https://www.onliner.by/' },
  { label: 'Яндекс.Карты', href: 'https://yandex.by/maps/' },
  { label: '2ГИС', href: 'https://2gis.by/' },
] as const;

export function BusinessCenterDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);
  const [offers, setOffers] = useState<BusinessCenterOffer[] | null>(null);
  const [gis2, setGis2] = useState<BusinessCenter2gisSnapshot | null>(null);
  const [officeSnapshots, setOfficeSnapshots] = useState<MarketSnapshot[] | null>(null);

  useEffect(() => {
    fetchBusinessCenters()
      .then(setCenters)
      .catch(() => setCenters([]));
  }, []);

  // Снапшот 2GIS (владелец подключил API в параллельной ветке, 2026-09-06:
  // "давай выведем на страницы вообще всю инфу, которую мы спарсили") —
  // отдельная таблица `business_center_2gis_snapshots`, тот же принцип
  // отдельного запроса по слагу, что и у business_center_offers ниже.
  useEffect(() => {
    if (!slug) return;
    setGis2(null);
    fetchBusinessCenter2gisSnapshot(slug)
      .then(setGis2)
      .catch(() => setGis2(null));
  }, [slug]);

  // Объявления о продаже/аренде из business_center_offers (владелец,
  // 2026-09-05: "хочу спарсить объявления... эту инфу мы будем выводить в
  // полной карточке" — см. scripts/sync-business-center-offers.mjs).
  // Отдельный запрос по слагу, не общий с fetchBusinessCenters — так при
  // переходе на следующий/предыдущий БЦ (тот же компонент, меняется только
  // slug) список объявлений сам перезапрашивается под новый БЦ.
  useEffect(() => {
    if (!slug) return;
    setOffers(null);
    fetchBusinessCenterOffers(slug)
      .then(setOffers)
      .catch(() => setOffers([]));
  }, [slug]);

  // Сравнение со средней по классу/району (ANALYTICSPLAN.md §4.2) — тот же
  // сегмент 'ofisy_bc', что и на каталоге/хабах. Грузится один раз, не по
  // slug — 23 строки на весь город, дешевле держать в памяти, чем
  // перезапрашивать при каждом переходе на следующий/предыдущий БЦ.
  useEffect(() => {
    fetchLatestMarketSnapshots('ofisy_bc')
      .then(setOfficeSnapshots)
      .catch(() => setOfficeSnapshots([]));
  }, []);

  // Порядок для "предыдущий/следующий" — тот же алфавит по короткому имени,
  // что и в боковом меню хаба, чтобы стрелки совпадали с порядком, который
  // пользователь уже видел в списке до перехода сюда.
  const sorted = useMemo(() => sortByShortName(centers ?? []), [centers]);
  const center = useMemo(() => sorted.find((c) => c.slug === slug) ?? null, [sorted, slug]);
  const index = center ? sorted.findIndex((c) => c.slug === center.slug) : -1;
  const prev = index > 0 ? sorted[index - 1] : null;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

  const saleRows = useMemo(() => computeOfferRows(offers ?? [], 'sale'), [offers]);
  const rentRows = useMemo(() => computeOfferRows(offers ?? [], 'rent'), [offers]);

  // Медиана по ЭТОМУ зданию целиком (не разбитая по типу помещения, как
  // saleRows/rentRows выше) — для сравнения со средней по классу/району.
  const buildingRentMedian = useMemo(() => overallMedianPricePerSqm(offers ?? [], 'rent'), [offers]);
  const buildingSaleMedian = useMemo(() => overallMedianPricePerSqm(offers ?? [], 'sale'), [offers]);
  const classSnapshot = useMemo(
    () =>
      center?.businessClass
        ? {
            rent: (officeSnapshots ?? []).find((s) => s.deal === 'rent' && s.sliceType === 'class' && s.sliceKey === center.businessClass),
            sale: (officeSnapshots ?? []).find((s) => s.deal === 'sale' && s.sliceType === 'class' && s.sliceKey === center.businessClass),
          }
        : null,
    [officeSnapshots, center],
  );
  const districtSnapshot = useMemo(
    () =>
      center?.district
        ? {
            rent: (officeSnapshots ?? []).find((s) => s.deal === 'rent' && s.sliceType === 'district' && s.sliceKey === center.district),
            sale: (officeSnapshots ?? []).find((s) => s.deal === 'sale' && s.sliceType === 'district' && s.sliceKey === center.district),
          }
        : null,
    [officeSnapshots, center],
  );

  // Рейтинг с карт вынесен из общего списка "Интересные факты" в бейдж рядом
  // с заголовком (см. комментарий у JSX ниже) — остальные блоки остаются в
  // общем списке как были.
  const ratingHighlight = useMemo(() => center?.highlights.find((h) => h.icon === 'rating') ?? null, [center]);
  const mapRating = useMemo(() => mapRatingFromHighlights(center?.highlights ?? []), [center]);
  // Точное расстояние до метро из 2GIS (владелец подключает в параллельной
  // ветке, 2026-09-06) — по прямой, в метрах. Когда есть — показывается
  // ВМЕСТО center.metro (владелец, 2026-09-06: "дублируется метро... оставь
  // только данные 2GIS"), не вместе с ним — см. JSX ниже.
  const nearestMetro = useMemo(() => nearestMetroStation(center?.nearestMetroStations ?? []), [center]);
  const scheduleLines = useMemo(() => (gis2?.schedule ? formatSchedule(gis2.schedule) : []), [gis2]);
  // "Доступная среда" — единственная группа из gis2.attributeGroups, которую
  // владелец попросил оставить (2026-09-06, вместе с часами работы, при
  // упразднении отдельного блока "Данные 2ГИС") — остальные группы
  // (аренда помещений и т.п.) больше нигде не показываются.
  const accessibilityAttributes = useMemo(() => {
    const group = gis2?.attributeGroups.find((g) => g.name === 'Доступная среда');
    return group && group.attributes.length > 0 ? group.attributes.join(', ') : null;
  }, [gis2]);
  const visibleHighlights = useMemo(() => center?.highlights.filter((h) => h.icon !== 'rating') ?? [], [center]);

  useEffect(() => {
    if (!center) return;
    setBusinessCenterPageMeta(center.slug, center, center.photos[0]);
    setBreadcrumbJsonLd([
      { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
      { name: 'Бизнес-центры Минска', url: 'https://redevelopment.pro/minsk/bcminsk' },
      { name: shortName(center) },
    ]);
  }, [center]);

  // FAQ по зданию (Fable-анализ, приоритет 1: "Какой класс?.. сколько
  // парковочных мест?.. кто собственник?.. какие станции метро рядом?..
  // какие компании арендуют?"). Только вопросы, на которые у ЭТОГО
  // конкретного БЦ реально есть заполненное поле — не выдумываем факт,
  // чтобы набрать вопросов побольше (у многих новых записей из prometr.by,
  // например, `developer`/`parking` пустые — для них соответствующий
  // вопрос просто не появляется).
  const faqItems = useMemo(() => {
    if (!center) return [];
    const name = shortName(center);
    const items: { question: string; answer: string }[] = [];
    if (center.businessClass) {
      items.push({ question: `Какой класс у бизнес-центра «${name}»?`, answer: `«${name}» относится к деловому классу ${center.businessClass}.` });
    }
    if (center.totalArea != null) {
      items.push({
        question: `Какая общая площадь у «${name}»?`,
        answer: `Общая площадь «${name}» — ${center.totalArea.toLocaleString('ru-RU')} м²${center.floors != null ? `, здание насчитывает ${center.floors} этажей` : ''}.`,
      });
    }
    if (center.metro) {
      items.push({ question: `Какое метро рядом с «${name}»?`, answer: `Ближайшая станция метро — ${center.metro.replace(/[«»]/g, '')}.` });
    }
    if (center.developer) {
      items.push({ question: `Кто застройщик «${name}»?`, answer: `Застройщик «${name}» — ${center.developer}.` });
    }
    if (center.parking) {
      items.push({ question: `Есть ли парковка у «${name}»?`, answer: center.parking });
    }
    if (center.tenantOrganizations.length > 0) {
      const sample = center.tenantOrganizations.slice(0, 5).map((o) => o.name);
      items.push({
        question: `Какие компании арендуют помещения в «${name}»?`,
        answer: `Среди организаций в здании: ${sample.join(', ')}${center.tenantOrganizations.length > sample.length ? ' и другие' : ''}.`,
      });
    }
    return items;
  }, [center]);

  useEffect(() => {
    if (!center) return;
    setFaqJsonLd(faqItems);
  }, [center, faqItems]);

  // Слаг не найден (опечатка в ссылке, удалённый БЦ) — soft-404: страница
  // остаётся доступной (200, не редирект), но не индексируется, тот же
  // принцип, что и у ObjectLandingPage для неизвестного /:slug.
  useEffect(() => {
    if (centers === null || center) return;
    setNoIndex();
    return () => clearNoIndex();
  }, [centers, center]);

  if (centers === null) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-bg">
        {/* text-ink: прямо на фоне страницы muted даёт 4,48:1 — ниже порога.
            <main> и здесь — чтобы landmark был в любом состоянии страницы. */}
        <p className="text-sm text-ink">Загрузка…</p>
      </main>
    );
  }

  if (!center) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
        <p className="text-base text-ink">Такой бизнес-центр не найден.</p>
        <Link to="/minsk/bcminsk" className="text-sm font-semibold text-primary-hover hover:underline">
          ← Все бизнес-центры Минска
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-svh bg-bg px-4 py-8 sm:py-14">
      <div className="mx-auto flex max-w-3xl items-center justify-between pb-5">
        <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
          <span className="font-black text-primary-hover">RED</span>EVELOPMENT
        </Link>
        {/* Владелец, 2026-09-06: "крестик плохо подходит, он как будто про
            закрытие, но те, кто придёт на эту страницу из поиска, ещё не
            видел главную страницу" — крестик подразумевает "закрыть уже
            открытое", а для гостя из поисковика это первая страница сайта
            вообще, тут нужна навигация "назад к списку", не закрытие.
            Плюс "должно выглядеть заметнее" — обычная приглушённая текстовая
            ссылка заменена на pill-кнопку (тот же glassPillClass, что и у
            стрелок prev/next ниже на странице). */}
        <Link
          to="/minsk/bcminsk"
          className={cn(
            'flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-ink transition-colors hover:text-primary',
            glassPillClass,
          )}
          style={glassPillShadow}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Все бизнес-центры
        </Link>
      </div>

      {/* Стрелки влево/вправо по краям экрана — тот же паттерн, что и в
          ImageLightbox.tsx. Только от lg — на мобильном места мало, там
          навигация — строка кнопок под карточкой ниже. */}
      {prev && (
        <Link
          to={`/minsk/bcminsk/${prev.slug}`}
          aria-label={`Предыдущий бизнес-центр: ${shortName(prev)}`}
          className={cn(
            'fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink lg:flex',
            glassPillClass,
          )}
          style={glassPillShadow}
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      {next && (
        <Link
          to={`/minsk/bcminsk/${next.slug}`}
          aria-label={`Следующий бизнес-центр: ${shortName(next)}`}
          className={cn(
            'fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink lg:flex',
            glassPillClass,
          )}
          style={glassPillShadow}
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      )}

      {/* <main> — единственный main-landmark страницы (Accessibility). */}
      <main className="mx-auto max-w-3xl">
        <div className={cn('overflow-hidden', glassCardClass)} style={glassCardShadow}>
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <PhotoBlock center={center} variant="detail" />
          </div>

          <div className="flex flex-col gap-4 p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-2xl font-extrabold leading-tight text-ink">{center.name}</h1>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {center.status === 'under_construction' && <Badge tone="warning">Строится</Badge>}
                {/* Рейтинг с Яндекс.Карт/2ГИС — владелец, 2026-09-06 (четвёртый
                    заход): "справа от заголовка рейтинг с яндекс.карт, а из
                    интересных фактов инфу про оценку убирай". Раньше рейтинг
                    был просто одним из блоков "Интересные факты" (свободный
                    markdown-текст вида "Яндекс.Карты: **5,0** из 5 (204
                    оценки...)") — структурного поля под число нет, поэтому
                    парсим ту же строку регуляркой (extractMapRating ниже) —
                    если формат не узнан, бейдж просто не показывается, ничего
                    не выдумываем. */}
                {mapRating && (
                  <Badge tone="neutral" title={ratingHighlight?.text}>
                    <Star className="h-3 w-3 shrink-0 fill-current" />
                    {mapRating.label} · {mapRating.source}
                  </Badge>
                )}
                {/* Рейтинг 2ГИС — отдельный источник от Яндекс.Карт выше,
                    оба честно подписаны, не смешиваются в один бейдж
                    (владелец, 2026-09-06: "выведи всю инфу, которую мы
                    спарсили"). org_review_count может быть null у части
                    записей (реже — только рейтинг без числа оценок). */}
                {gis2?.reviews?.orgRating != null && (
                  <Badge tone="neutral">
                    <Star className="h-3 w-3 shrink-0 fill-current" />
                    {gis2.reviews.orgRating.toLocaleString('ru-RU')} · 2ГИС
                    {gis2.reviews.orgReviewCount != null && ` (${gis2.reviews.orgReviewCount})`}
                  </Badge>
                )}
              </div>
            </div>

            <FactRow icon={MapPin}>
              {center.address}
              {/* Ссылка на хаб улицы (аудит 2026-09-07) — только если у этой
                  улицы реально есть хаб (2+ БЦ, см. STREET_SLUGS). */}
              {streetHubUrl(streetOfAddress(center.address)) && (
                <>
                  {' · '}
                  <Link to={streetHubUrl(streetOfAddress(center.address)) as string} className="font-semibold text-primary-hover hover:underline">
                    все БЦ на этой улице
                  </Link>
                </>
              )}
            </FactRow>
            {/* Метро — одна строка, не две (владелец, 2026-09-06: "дублируется
                метро и расстояние до него, оставь только данные 2GIS и убери
                (2GIS), просто данные"). Когда есть точный геокод из 2GIS —
                показываем только его (по прямой, в метрах, без подписи
                источника в тексте); center.metro остаётся фолбэком для БЦ без
                такого геокода (там пока только минуты пешком из веб-архивов
                Яндекс.Карт, честно как есть, без выдуманных метров). */}
            {nearestMetro ? (
              <FactRow icon={TrainFront}>
                «{nearestMetro.name}» — {nearestMetro.distanceMeters} м по прямой
                {/* Ссылка на хаб станции (аудит 2026-09-07) — только если БЦ
                    реально попадает в радиус хаба, иначе вела бы на список без него. */}
                {metroHubDistance(center, nearestMetro.name) !== null && metroHubUrl(nearestMetro.name) && (
                  <>
                    {' · '}
                    <Link to={metroHubUrl(nearestMetro.name) as string} className="font-semibold text-primary-hover hover:underline">
                      все БЦ у этой станции
                    </Link>
                  </>
                )}
              </FactRow>
            ) : (
              center.metro && <FactRow icon={TrainFront}>{center.metro}</FactRow>
            )}
            {center.developer && <FactRow icon={Building2}>{center.developer}</FactRow>}

            {/* Ровно 4 плитки — класс/площадь/год/этажность (владелец,
                2026-09-06, четвёртый заход: "4 карточки - класс, площадь, год
                сдачи, этажность") — метро/застройщик переехали в обычные
                строки выше, парковка — в отдельный блок ниже (см.
                LabeledTextRow "Парковка"). Класс — обычный текст, как у
                остальных плиток (владелец, 2026-09-06, пятый заход: "дизайн
                Класса отличается от других заголовков, сделай одинаково" —
                раньше был цветной Badge-пилюля вместо текста). */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {center.businessClass && (
                <FactTile icon={Award} value={`Класс ${center.businessClass}`} label="Деловой класс" />
              )}
              {center.totalArea != null && (
                <FactTile icon={Ruler} value={`${center.totalArea.toLocaleString('ru-RU')} м²`} label="Общая площадь" />
              )}
              {center.yearBuilt != null && (
                <FactTile
                  icon={Calendar}
                  value={`${center.yearBuilt} г.`}
                  label={center.status === 'under_construction' ? 'Ожидаемая сдача' : 'Год сдачи'}
                />
              )}
              {center.floors != null && <FactTile icon={Layers} value={center.floors} label="Этажей" />}
            </div>

            {/* Парковка — отдельный блок, не плитка (владелец, 2026-09-06,
                четвёртый заход: "паркинг - отдельный блок") — тот же
                LabeledTextRow, что и в "Условиях для арендаторов" ниже. */}
            <LabeledTextRow icon={Car} label="Парковка" text={center.parking} />

            {/* Часы работы и доступная среда из 2GIS — переехали сюда из
                отдельного блока "Данные 2ГИС" (владелец, 2026-09-06: "блок
                Данные 2GIS не нужен, добавим эту инфу в главный блок... часы
                работы и доступная среда оставляем, аренда помещений убираем,
                подпись про 2ГИС убираем"). Остальные разделы прежнего блока
                (аренда помещений, парковка(2ГИС), прочие attributeGroups) —
                намеренно нигде больше не показываются, не только эти два. */}
            {scheduleLines.length > 0 && (
              <LabeledTextRow icon={Clock} label="Часы работы" text={scheduleLines.join('\n')} />
            )}
            {accessibilityAttributes && (
              <LabeledTextRow icon={CheckCircle2} label="Доступная среда" text={accessibilityAttributes} />
            )}

            {center.website && (
              <a
                href={center.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium text-primary-hover hover:underline"
              >
                <Globe className="h-4 w-4 shrink-0" />
                {center.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* Технические характеристики — прямой парсинг структурных блоков
            .bccharacteristics с карточки здания на prometr.by. Изначально
            (2026-09-06) была одна плоская таблица параметр-значение — владелец
            тем же днём позже: "часть данных типа класса здания дублируется,
            остальное размещено нечитаемо, разбей на смысловые блоки и оформи
            карточками/иконками в нашем стиле". Разложено на 3 смысловых блока
            (TECH_GROUP_META/TECH_PARAM_META ниже) — короткие значения идут
            мини-плитками в сетке, длинные перечисления (инфраструктура/
            провайдеры/кондиционирование/управление) — обычными подписанными
            строками. Пара строк с одинаковыми (по факту) с нашими полями
            карточки данными (класс/метро) СКРЫВАЕТСЯ, только если у ЭТОЙ
            конкретной записи есть свой источник этих данных выше на странице
            (иначе, если наше поле пустое, а у prometr.by значение есть — это
            единственный источник, не прячем). "Общая площадь"/"Этажность" НЕ
            скрываются никогда, несмотря на потенциальное совпадение с нашими
            полями — они специально подписаны "(по данным prometr.by)" именно
            для честной сверки при расхождении (см. комментарий у
            BusinessCenter.technicalParams в data/businessCenters.ts, кейс
            "Стратег-1"/S Union/Призма) — эта атрибуция сохранена отдельной
            подписью под значением, не спрятана. Для многокорпусных комплексов
            (Riviera Plaza, Парк Плаза) — отдельный набор блоков на каждый
            корпус. Параметр с незнакомым label (на случай, если prometr.by
            заведёт новое поле) не теряется — попадает в резервную таблицу
            внизу блока, не гадаем, но и не отбрасываем. */}
        {center.technicalParams.length > 0 && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <ClipboardList className="h-5 w-5 shrink-0 text-primary" />
              Технические характеристики
            </h2>
            <div className="flex flex-col gap-6">
              {center.technicalParams.map((group, i) => {
                const hideMetro = Boolean(nearestMetro || center.metro);
                const hideClass = Boolean(center.businessClass);
                const visibleParams = group.params.filter((p) => {
                  const meta = TECH_PARAM_META[p.label];
                  if (meta?.hideIfDuplicate === 'metro' && hideMetro) return false;
                  if (meta?.hideIfDuplicate === 'businessClass' && hideClass) return false;
                  return true;
                });
                if (visibleParams.length === 0) return null;

                const byGroup: Record<TechGroupKey, TechnicalParam[]> = { general: [], space: [], amenities: [] };
                const unknown: TechnicalParam[] = [];
                for (const p of visibleParams) {
                  const meta = TECH_PARAM_META[p.label];
                  if (meta) byGroup[meta.group].push(p);
                  else unknown.push(p);
                }

                return (
                  <div key={i} className="flex flex-col gap-5">
                    {group.corpusLabel && <p className="text-sm font-bold text-ink">{group.corpusLabel}</p>}

                    {(['general', 'space', 'amenities'] as const).map((groupKey) => {
                      const params = byGroup[groupKey];
                      if (params.length === 0) return null;
                      const { icon: GroupIcon, title } = TECH_GROUP_META[groupKey];

                      return (
                        <div key={groupKey} className="flex flex-col gap-2">
                          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
                            <GroupIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                            {title}
                          </h3>
                          <div className="overflow-hidden rounded-control border border-border">
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                {params.map((p, j) => {
                                  const suffix = ' (по данным prometr.by)';
                                  const hasAttribution = p.label.endsWith(suffix);
                                  const shortLabel = hasAttribution ? p.label.slice(0, -suffix.length) : p.label;
                                  return (
                                    <tr key={j} className="border-b border-border last:border-b-0 odd:bg-surface-muted/40">
                                      <th
                                        scope="row"
                                        className="w-1/2 py-2 pl-3 pr-2 text-left align-top font-medium text-ink-muted sm:w-2/5"
                                      >
                                        {shortLabel}
                                        {hasAttribution && (
                                          <span className="mt-0.5 block text-[10px] font-normal normal-case text-ink-muted">
                                            по данным prometr.by
                                          </span>
                                        )}
                                      </th>
                                      <td className="py-2 pl-2 pr-3 text-ink">{p.value}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}

                    {unknown.length > 0 && (
                      <div className="overflow-hidden rounded-control border border-border">
                        <table className="w-full border-collapse text-sm">
                          <tbody>
                            {unknown.map((p, j) => (
                              <tr key={j} className="border-b border-border last:border-b-0 odd:bg-surface-muted/40">
                                <th
                                  scope="row"
                                  className="w-1/2 py-2 pl-3 pr-2 text-left align-top font-medium text-ink-muted sm:w-2/5"
                                >
                                  {p.label}
                                </th>
                                <td className="py-2 pl-2 pr-3 text-ink">{p.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <a
                      href={group.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-ink-muted hover:text-primary-hover hover:underline"
                    >
                      Источник: prometr.by
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* "Интересные факты" — произвольный набор блоков, разный у каждого
            БЦ (владелец, 2026-09-06, второй заход: "старайся делать
            кастомную страницу под каждый БЦ. Если у БЦ нет наград, не
            делай этот блок вообще. Если есть что-то новое — кастомный
            блок"). Раньше был фиксированный объект (history/tenants/media/
            rating/reviews), теперь — HighlightSection[] (см. комментарий у
            BusinessCenter.highlights в data/businessCenters.ts). icon
            'warning' — единственная особая: выносится наверх акцентным
            жёлтым блоком (как caveat в RentalInfo), а не в общий список.
            Порядок блоков на странице (владелец, 2026-09-06): главный блок
            → Интересные факты → Условия для арендаторов → Объявления с
            Kufar и Realt. */}
        {visibleHighlights.length > 0 && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              Интересные факты
            </h2>

            {visibleHighlights
              .filter((s) => s.icon === 'warning')
              .map((s, i) => (
                <div
                  key={`warning-${i}`}
                  className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {s.label && <p className="text-xs font-semibold uppercase tracking-wide">{s.label}</p>}
                    <p className="mt-0.5 leading-relaxed">{renderRentalText(s.text)}</p>
                  </div>
                </div>
              ))}

            <div className="flex flex-col divide-y divide-border">
              {(() => {
                const plainFacts = visibleHighlights.filter((s) => s.icon !== 'warning');
                // Единственный факт в карточке — свой подписанный заголовок
                // над ним избыточен: и так ясно из заголовка карточки "Интересные
                // факты" (владелец, 2026-09-06: "если интересный факт один, то
                // заголовок лишний").
                const showLabel = plainFacts.length > 1;
                return plainFacts.map((s, i) => (
                  <LabeledTextRow
                    key={i}
                    icon={HIGHLIGHT_ICONS[s.icon]}
                    label={showLabel ? s.label : undefined}
                    text={s.text}
                  />
                ));
              })()}
            </div>
          </div>
        )}

        {/* Организации внутри здания — владелец, 2026-09-06 (третий заход):
            "давай сделаем ещё блок арендаторов внутри БЦ... сгруппировать,
            на первое место ставь места с максимумом отзывов на картах".
            Источник — карусель "Организации внутри" на Яндекс.Картах
            (веб-архив) — она отдаёт только название+категорию на каждую
            организацию, БЕЗ числа отзывов на неё саму (в отличие от
            рейтинга/отзывов всего здания в блоке выше). Настоящей сортировки
            "по числу отзывов" на уровне отдельной организации из этих данных
            не построить — группы отсортированы по размеру (категории с
            большим числом организаций первыми) как ближайший доступный
            прокси, без выдумывания цифр (см. комментарий у
            BusinessCenter.tenantOrganizations в data/businessCenters.ts). */}
        {center.tenantOrganizations.length > 0 && <TenantOrganizationsBlock organizations={center.tenantOrganizations} />}

        {/* Условия для арендаторов с офиц. сайта БЦ (владелец, 2026-09-05,
            на примере "Проспект"/Elite Estate — по нему нет объявлений на
            Kufar/Realt, но на собственном сайте есть условия для
            арендаторов: "пройдись по сайтам БЦ и поищешь такую информацию").
            Собрано веб-поиском (Gemini через ProxyAPI — прямого доступа к
            большинству сайтов БЦ из песочницы нет). Первая версия рисовала
            всё одним абзацем — владелец: "верстка — пиздец, разбей на
            логические блоки, используй форматирование" — теперь отдельная
            подписанная строка на каждый раздел (LabeledTextRow), важная
            оговорка источника (сайт недоступен, "Аден" по факту гостиница
            и т.п.) — акцентным блоком сверху, не затёртая в общем тексте.
            Каждое поле независимо может быть null — рисуем только то, что
            реально нашлось. */}
        {center.rentalInfo && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              Условия для арендаторов
            </h2>

            {center.rentalInfo.caveat && (
              <div className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-relaxed">{center.rentalInfo.caveat}</p>
              </div>
            )}

            <div className="flex flex-col divide-y divide-border">
              <LabeledTextRow icon={ScrollText} label="Условия аренды" text={center.rentalInfo.terms} />
              <LabeledTextRow icon={Banknote} label="Ставки" text={center.rentalInfo.rates} />
              <LabeledTextRow icon={Ruler} label="Площади и типы помещений" text={center.rentalInfo.sizes} />
              <LabeledTextRow icon={Car} label="Парковка" text={center.rentalInfo.parking} />
              <LabeledTextRow icon={Phone} label="Контакты отдела аренды" text={center.rentalInfo.contacts} />
            </div>

            <p className="text-xs text-ink-muted">
              Собрано автоматически по официальному сайту БЦ и открытым источникам — не куратировано вручную, перед
              подписанием договора уточняйте актуальные условия напрямую у арендодателя.
            </p>
          </div>
        )}

        {/* "Интересные факты" — отдельная от условий аренды категория:
            история объекта, известные арендаторы, награды/СМИ, рейтинг и
            отзывы с карт (владелец, 2026-09-06: "подтянуть рейтинг из
            Яндекс.Карт, отзывы, другую инфу... чтобы страница была даже
            понятнее, чем официальный сайт"). history/tenants/media — веб-
            поиск (Gemini+google_search), КАЖДЫЙ факт перепроверен отдельным
            независимым поиском (см. комментарий у BusinessCenterHighlights
            в data/businessCenters.ts — первая попытка дала неподтверждённые
            детали). rating/reviews заполняются владельцем вручную — прямой
            поиск с картами дал похожие на правду, но выдуманные цитаты
            отзывов, публиковать нельзя. */}

        {/* Объявления с Kufar и Realt — было "Рынок в этом здании", владелец
            переименовал (2026-09-06), чтобы сразу было понятно источник
            данных. История правок самой таблицы (разбивка по типу
            помещения, явная строка "нет объявлений" вместо исчезновения
            секции, убранные прямые ссылки на Kufar/Realt) — см. запись
            2026-09-05 в docs/session-journal.md. */}
        {offers !== null && (
          <div className={cn('mt-6 flex flex-col gap-3 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="text-lg font-bold text-ink">Объявления с Kufar и Realt</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="py-2 pr-3 text-left">
                      Тип помещения
                    </th>
                    <th scope="col" className="py-2 px-2 text-right">
                      Объявлений
                    </th>
                    <th scope="col" className="py-2 px-2 text-right">
                      Площадь
                    </th>
                    <th scope="col" className="py-2 pl-2 text-right">
                      Цена за м²
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <OfferDealSection title="Продажа" rows={saleRows} />
                  <OfferDealSection title="Аренда" rows={rentRows} />
                </tbody>
              </table>
            </div>

            {/* Сравнение со средней по классу/району (ANALYTICSPLAN.md
                §4.2) — медиана этого конкретного здания против медиан
                market_snapshots (сегмент ofisy_bc). Только когда у здания
                вообще есть медиана по сделке И хотя бы один из бенчмарков
                (класс/район) набрал порог MIN_RELIABLE_N — иначе сравнение
                с сырыми 2-3 объявлениями было бы не сравнением, а шумом. */}
            <RateComparisonNote
              dealType="rent"
              buildingMedian={buildingRentMedian}
              classLabel={center?.businessClass ? `классу ${center.businessClass}` : null}
              classSnapshot={classSnapshot?.rent}
              districtLabel={center?.district ? `${districtDative(center.district)} району` : null}
              districtSnapshot={districtSnapshot?.rent}
            />
            <RateComparisonNote
              dealType="sale"
              buildingMedian={buildingSaleMedian}
              classLabel={center?.businessClass ? `классу ${center.businessClass}` : null}
              classSnapshot={classSnapshot?.sale}
              districtLabel={center?.district ? `${districtDative(center.district)} району` : null}
              districtSnapshot={districtSnapshot?.sale}
            />
          </div>
        )}

        {faqItems.length > 0 && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="text-lg font-bold text-ink">Частые вопросы</h2>
            <div className="flex flex-col divide-y divide-border">
              {faqItems.map((item) => (
                <div key={item.question} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">{item.question}</p>
                  <p className="text-sm leading-relaxed text-ink-muted">{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Ссылка на Red One с каждой карточки БЦ — аудит поиска 2026-09-07
            («на каждой карточке — блок со ссылкой на Red One»): переходы из
            справочника на /minsk/one — главная метрика всей SEO-линии.
            Текст общий, без цен — цены живут на самом лендинге. */}
        <div className={cn('mt-6 flex flex-col gap-3 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Store className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Нужен небольшой кабинет в собственность?</h2>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">
            В бизнес-центрах офисы в основном сдаются в аренду большими блоками. Если нужен компактный кабинет или
            фиксированное рабочее место в собственность — посмотрите деловой центр Red One в Минск Мире: готовая
            отделка, парковка, онлайн-бронирование без предоплаты.
          </p>
          <Link to="/minsk/one" className="w-fit text-sm font-semibold text-primary-hover hover:underline">
            Смотреть кабинеты в Red One →
          </Link>
        </div>

        <div className={cn('mt-6 flex flex-col gap-3 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Источники</h2>
          <div className="flex flex-wrap gap-2">
            {GENERAL_DATA_SOURCES.map((source) => (
              <a
                key={source.href}
                href={source.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary hover:text-primary',
                )}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {source.label}
              </a>
            ))}
            {center.website && (
              <a
                href={center.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary hover:text-primary"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                Официальный сайт «{shortName(center)}»
              </a>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Данные о здании собраны из открытых источников — не всё относится к каждому конкретному БЦ.
          </p>
        </div>

        {/* Мобильная навигация "следующий/предыдущий" — фиксированные стрелки
            выше скрыты до lg, здесь тот же переход обычной строкой кнопок. */}
        {(prev || next) && (
          <div className="mt-5 flex items-center justify-between gap-3 lg:hidden">
            {prev ? (
              <Link
                to={`/minsk/bcminsk/${prev.slug}`}
                className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                {shortName(prev)}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                to={`/minsk/bcminsk/${next.slug}`}
                className="flex items-center gap-1.5 text-right text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                {shortName(next)}
                <ChevronRight className="h-4 w-4 shrink-0" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Смысловая группировка "Технических характеристик" (см. комментарий в самом
// рендере блока) — один и тот же фиксированный набор из 18 label'ов, которые
// реально встречаются в спарсенных с prometr.by данных (см. журнал docs/session-journal.md,
// запись про технические характеристики от 2026-09-06). style: 'tile' —
// короткое значение (число/пара слов), 'text' — обычно перечисление,
// удобнее строкой. hideIfDuplicate — прячет строку, только если у ЭТОЙ
// записи выше на странице уже есть та же информация из другого поля (см.
// использование в рендере).
type TechGroupKey = 'general' | 'space' | 'amenities';

const TECH_GROUP_META: Record<TechGroupKey, { icon: typeof FileText; title: string }> = {
  general: { icon: Building, title: 'Статус и локация' },
  space: { icon: Ruler, title: 'Площади и планировка' },
  amenities: { icon: Wrench, title: 'Инфраструктура и сервис' },
};

const TECH_PARAM_META: Record<
  string,
  { group: TechGroupKey; icon: typeof FileText; style: 'tile' | 'text'; hideIfDuplicate?: 'metro' | 'businessClass' }
> = {
  'Класс бизнес-центра': { group: 'general', icon: Award, style: 'tile', hideIfDuplicate: 'businessClass' },
  'Административный район': { group: 'general', icon: MapPin, style: 'tile' },
  'Степень готовности': { group: 'general', icon: CheckCircle2, style: 'tile' },
  'Свободные площади': { group: 'general', icon: Ruler, style: 'tile' },
  'Станция метро': { group: 'general', icon: TrainFront, style: 'tile', hideIfDuplicate: 'metro' },
  'Удалённость от метро': { group: 'general', icon: TrainFront, style: 'tile', hideIfDuplicate: 'metro' },
  'Общая площадь (по данным prometr.by)': { group: 'space', icon: Ruler, style: 'tile' },
  'Площадь офисов': { group: 'space', icon: Ruler, style: 'tile' },
  'Площадь типового этажа': { group: 'space', icon: Ruler, style: 'tile' },
  'Высота потолков типового этажа, м': { group: 'space', icon: Layers, style: 'tile' },
  'Тип планировки': { group: 'space', icon: Layers, style: 'tile' },
  'Количество этажей (по данным prometr.by)': { group: 'space', icon: Layers, style: 'tile' },
  'Количество лифтов': { group: 'amenities', icon: ArrowUpDown, style: 'tile' },
  'Обеспеченность парковкой (маш./100 м²)': { group: 'amenities', icon: Car, style: 'tile' },
  'Система кондиционирования': { group: 'amenities', icon: Snowflake, style: 'text' },
  'Управление БЦ': { group: 'amenities', icon: Users, style: 'text' },
  'Внутренняя инфраструктура': { group: 'amenities', icon: Store, style: 'text' },
  'Инфраструктура в шаговой доступности': { group: 'amenities', icon: MapPinned, style: 'text' },
  'Интернет-провайдеры': { group: 'amenities', icon: Wifi, style: 'text' },
};

// Одна строка блока "Условия для арендаторов" — иконка + подпись раздела +
// Иконка на раздел "Интересных фактов" по ключу из HighlightSection.icon —
// 'warning' в общий список не попадает (свой рендер, акцентный блок выше),
// но остаётся в мапе для полноты типа (Record должен покрывать все ключи).
// 'fact' — намеренно НЕ Sparkles (владелец, 2026-09-06: "не допускай повтора
// иконок" — заголовок карточки "Интересные факты" уже использует Sparkles,
// у самого частого по факту icon-ключа 'fact' была та же иконка — дублировалась
// на скриншоте с одним фактом "Позиционирование").
const HIGHLIGHT_ICONS: Record<HighlightIconKey, typeof FileText> = {
  history: Landmark,
  tenants: Building2,
  media: Newspaper,
  rating: Star,
  reviews: MessageSquareQuote,
  design: Palette,
  eco: Leaf,
  warning: AlertTriangle,
  fact: Info,
};

// Достаёт число+источник из свободного текста блока "рейтинг" в
// "Интересных фактах" (напр. "- Яндекс.Карты: **4,8** из 5 (836 оценок,
// 160 отзывов)") — структурного поля под рейтинг нет, весь текст собран
// веб-поиском в свободной markdown-нотации (см. комментарий у
// BusinessCenter.highlights в data/businessCenters.ts). Берётся только
// ПЕРВАЯ строка (у части БЦ рейтинг на два источника, Яндекс.Карты и 2ГИС,
// каждый на своей строке — для компактного бейджа у заголовка достаточно
// одного) и только первое найденное "X,X из 5" — для "Порта" (3 отдельные
// карточки на Яндекс.Картах, по одной на очередь здания) это даёт рейтинг
// первой очереди, не среднее по всем трём, честный, но частичный
// компромисс ради компактности бейджа. Формат не узнан — просто не
// показываем бейдж, не гадаем.
// Расписание из 2GIS (владелец, 2026-09-06) — группирует подряд идущие дни
// с одинаковыми часами в одну строку ("Пн–Пт: 08:00–17:00"), а не по строке
// на каждый день недели — иначе для типового графика 5/2 получилось бы 5
// почти одинаковых строк подряд. День без записи в schedule.days — выходной
// (2GIS просто не включает нерабочие дни в объект, не шлёт их с пустым
// массивом часов).
const SCHEDULE_DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const SCHEDULE_DAY_LABELS: Record<(typeof SCHEDULE_DAY_ORDER)[number], string> = {
  Mon: 'Пн',
  Tue: 'Вт',
  Wed: 'Ср',
  Thu: 'Чт',
  Fri: 'Пт',
  Sat: 'Сб',
  Sun: 'Вс',
};

function formatWorkingHours(day: Gis2ScheduleDay): string {
  return day.workingHours.map((h) => `${h.from}–${h.to}`).join(', ');
}

function formatSchedule(schedule: Gis2Schedule): string[] {
  if (schedule.is24x7) return ['Круглосуточно'];
  const lines: string[] = [];
  let i = 0;
  while (i < SCHEDULE_DAY_ORDER.length) {
    const day = SCHEDULE_DAY_ORDER[i];
    const entry = schedule.days[day];
    const hoursKey = entry ? formatWorkingHours(entry) : null;
    let j = i;
    while (j + 1 < SCHEDULE_DAY_ORDER.length) {
      const nextEntry = schedule.days[SCHEDULE_DAY_ORDER[j + 1]];
      const nextKey = nextEntry ? formatWorkingHours(nextEntry) : null;
      if (nextKey !== hoursKey) break;
      j++;
    }
    const label =
      i === j ? SCHEDULE_DAY_LABELS[day] : `${SCHEDULE_DAY_LABELS[day]}–${SCHEDULE_DAY_LABELS[SCHEDULE_DAY_ORDER[j]]}`;
    lines.push(hoursKey ? `${label}: ${hoursKey}` : `${label}: выходной`);
    i = j + 1;
  }
  return lines;
}

// Сколько категорий показывать сразу — у части БЦ (владелец, 2026-09-06:
// "ограничь список видимых категорий с кнопкой «показать ещё»") реальная
// страница "Организации внутри" на Яндекс.Картах даёт не карусель из
// 6-10 позиций, а полный список зарегистрированных на адрес юрлиц — у
// "Паруса", например, 160+ категорий одним полотном. Первый экран остаётся
// компактным, весь список доступен по клику, без ограничения на бэкенде.
const VISIBLE_TENANT_CATEGORIES = 8;

// "5 категорий"/"2 категории"/"1 категорию" — числительное требует разного
// падежа/числа (тот же принцип, что и pluralOrganizations в DistrictQuarterMap.tsx).
function pluralCategories(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'категорию';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'категории';
  return 'категорий';
}

function TenantOrganizationsBlock({ organizations }: { organizations: TenantOrganization[] }) {
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupTenantOrganizations(organizations), [organizations]);
  const visibleGroups = expanded ? groups : groups.slice(0, VISIBLE_TENANT_CATEGORIES);
  const hiddenCount = groups.length - visibleGroups.length;

  return (
    <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Building2 className="h-5 w-5 shrink-0 text-primary" />
        Организации в здании
      </h2>
      {/* Владелец, 2026-09-06 (третий заход): "предложи более компактный
          способ — плитки занимают слишком много места, а полезной инфы
          немного". Раньше на каждую категорию уходило 2 строки (заголовок
          категории отдельно + отдельный ряд плашек-названий) — теперь
          категория и список названий в одной строке ("Категория (N):
          названия через запятую"), обычным текстом без плашек-фонов —
          при 150+ категориях у "Паруса" разница в высоте блока в разы. */}
      <div className="flex flex-col divide-y divide-border">
        {visibleGroups.map((group) => (
          <p key={group.category} className="py-1.5 text-sm leading-relaxed first:pt-0 last:pb-0">
            <span className="font-semibold text-ink">
              {group.category} <span className="text-ink-muted">({group.items.length})</span>:
            </span>{' '}
            <span className="text-ink-muted">{group.items.join(', ')}</span>
          </p>
        ))}
      </div>
      {groups.length > VISIBLE_TENANT_CATEGORIES && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-sm font-semibold text-primary-hover hover:underline"
        >
          {expanded ? 'Свернуть' : `Показать ещё ${hiddenCount} ${pluralCategories(hiddenCount)}`}
        </button>
      )}
      <p className="text-xs text-ink-muted">
        Информация из Яндекс.Карт — полный список организаций мог измениться.
      </p>
    </div>
  );
}

// Группировка "Организации в здании" по категории — без реального числа
// отзывов на каждую организацию (см. комментарий в JSX выше) сортируем
// группы по размеру (больше организаций одной категории — выше), внутри
// группы — по алфавиту. "Без категории" (пустая строка из формы) — всегда
// последней группой, не мешает содержательным категориям наверху.
function groupTenantOrganizations(orgs: TenantOrganization[]): { category: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const org of orgs) {
    const category = org.category.trim() || 'Без категории';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(org.name);
  }
  return Array.from(groups.entries())
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.localeCompare(b, 'ru')) }))
    .sort((a, b) => {
      if (a.category === 'Без категории') return 1;
      if (b.category === 'Без категории') return -1;
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return a.category.localeCompare(b.category, 'ru');
    });
}

// сам текст, ничего не рендерит, если по этому разделу нашлось не найдено
// (text === null) — не показываем пустые подписи.
function LabeledTextRow({
  icon: Icon,
  label,
  text,
}: {
  icon: typeof FileText;
  label?: string;
  text: string | null;
}) {
  if (!text) return null;
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        {label && <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>}
        <div className={cn('text-sm leading-relaxed text-ink-muted', label && 'mt-1')}>{renderRentalText(text)}</div>
      </div>
    </div>
  );
}

// Мини-разметка внутри полей "Условия для арендаторов" (владелец, 2026-09-06:
// "делай еще сильнее дробить... в таком формате: * Пункт 1... важные цифры
// выделяй жирным") — сознательно не полноценный markdown-парсер (незачем
// тянуть библиотеку ради двух приёмов), просто: строки, начинающиеся с "- "
// или "* ", группируются в маркированный список, остальные строки — обычные
// абзацы; **текст** внутри любой строки — жирным. Текст полей набирается в
// админке (BusinessCentersAdminTab.tsx) в этой же нотации.
function renderRentalText(text: string): ReactNode {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let bulletBuffer: string[] = [];
  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-4 marker:text-ink-muted">
        {bulletBuffer.map((item, i) => (
          <li key={i}>{renderBold(item)}</li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('* ')) {
      bulletBuffer.push(line.slice(2));
    } else {
      flushBullets();
      blocks.push(
        <p key={blocks.length} className={blocks.length > 0 ? 'mt-2' : undefined}>
          {renderBold(line)}
        </p>,
      );
    }
  }
  flushBullets();
  return <>{blocks}</>;
}

function renderBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

// Одна строка таблицы — либо реальная разбивка по типу помещения (для
// сделки, где объявления есть), либо единственная строка-заглушка "нет
// объявлений" (propertyType: null), когда по этой сделке сейчас пусто —
// владелец: "Продажа" должна быть видна явной строкой, а не пропадать.
interface OfferRow {
  propertyType: string | null;
  count: number;
  minSize: number;
  maxSize: number;
  minPrice: number;
  medianPrice: number;
  maxPrice: number;
}

function computeOfferRows(offers: BusinessCenterOffer[], dealType: BusinessCenterOffer['dealType']): OfferRow[] {
  const filtered = offers.filter((o) => o.dealType === dealType);
  if (filtered.length === 0) {
    return [{ propertyType: null, count: 0, minSize: 0, maxSize: 0, minPrice: 0, medianPrice: 0, maxPrice: 0 }];
  }

  const groups = new Map<string, BusinessCenterOffer[]>();
  for (const o of filtered) {
    const key = o.propertyType ?? 'Без категории';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  return Array.from(groups.entries())
    .map(([propertyType, group]) => {
      const sizes = group.map((o) => o.size);
      const prices = [...group.map((o) => o.pricePerSqm)].sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const medianPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      return {
        propertyType,
        count: group.length,
        minSize: Math.min(...sizes),
        maxSize: Math.max(...sizes),
        minPrice: Math.min(...prices),
        medianPrice,
        maxPrice: Math.max(...prices),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('ru-RU')}`;
}

// Медиана цены за м² по ВСЕМ объявлениям здания одного типа сделки, без
// разбивки по типу помещения (та живёт в computeOfferRows выше) — нужна
// только для сравнения со средней по классу/району из market_snapshots.
function overallMedianPricePerSqm(offers: BusinessCenterOffer[], dealType: BusinessCenterOffer['dealType']): number | null {
  const prices = offers.filter((o) => o.dealType === dealType).map((o) => o.pricePerSqm);
  if (prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatRatePerSqm(n: number, dealType: 'rent' | 'sale'): string {
  const rounded = dealType === 'rent' ? Math.round(n * 10) / 10 : Math.round(n);
  return `$${rounded.toLocaleString('ru-RU')}${dealType === 'rent' ? '/м²/мес' : '/м²'}`;
}

function compareLabel(diffPct: number): string {
  if (Math.abs(diffPct) < 5) return 'на уровне';
  return diffPct > 0 ? `выше на ${Math.round(diffPct)}%` : `ниже на ${Math.round(Math.abs(diffPct))}%`;
}

function RateComparisonNote({
  dealType,
  buildingMedian,
  classLabel,
  classSnapshot,
  districtLabel,
  districtSnapshot,
}: {
  dealType: 'rent' | 'sale';
  buildingMedian: number | null;
  classLabel: string | null;
  classSnapshot: MarketSnapshot | undefined;
  districtLabel: string | null;
  districtSnapshot: MarketSnapshot | undefined;
}) {
  if (buildingMedian == null) return null;

  const parts: ReactNode[] = [];
  if (classLabel && classSnapshot?.median != null && classSnapshot.n >= MIN_RELIABLE_N) {
    const diff = ((buildingMedian - classSnapshot.median) / classSnapshot.median) * 100;
    parts.push(
      <span key="class">
        {compareLabel(diff)} медианы по {classLabel} ({formatRatePerSqm(classSnapshot.median, dealType)})
      </span>,
    );
  }
  if (districtLabel && districtSnapshot?.median != null && districtSnapshot.n >= MIN_RELIABLE_N) {
    const diff = ((buildingMedian - districtSnapshot.median) / districtSnapshot.median) * 100;
    parts.push(
      <span key="district">
        {compareLabel(diff)} медианы по {districtLabel} ({formatRatePerSqm(districtSnapshot.median, dealType)})
      </span>,
    );
  }
  if (parts.length === 0) return null;

  return (
    <p className="text-xs text-ink-muted">
      {dealType === 'rent' ? 'Аренда' : 'Продажа'} в этом здании — {formatRatePerSqm(buildingMedian, dealType)}, это{' '}
      {parts.reduce<ReactNode[]>((acc, part, i) => (i === 0 ? [part] : [...acc, ' и ', part]), [])}.
    </p>
  );
}

// Заголовок сделки (Продажа/Аренда) — не отдельная колонка (чтобы не
// повторять текст на каждой строке разбивки), а строка-разделитель на всю
// ширину таблицы, за ней сразу строки по типу помещения.
function OfferDealSection({ title, rows }: { title: string; rows: OfferRow[] }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pt-4 pb-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">
          {title}
        </td>
      </tr>
      {rows.map((row) =>
        row.propertyType === null ? (
          <tr key="empty">
            <td colSpan={4} className="py-3 text-ink-muted">
              Нет активных объявлений
            </td>
          </tr>
        ) : (
          <tr key={row.propertyType}>
            <td className="py-3 pr-3 font-medium text-ink">{row.propertyType}</td>
            <td className="py-3 px-2 text-right tabular-nums text-ink-muted">{row.count}</td>
            <td className="whitespace-nowrap py-3 px-2 text-right tabular-nums text-ink-muted">
              {row.minSize === row.maxSize
                ? `${row.minSize.toLocaleString('ru-RU')} м²`
                : `${row.minSize.toLocaleString('ru-RU')}–${row.maxSize.toLocaleString('ru-RU')} м²`}
            </td>
            <td className="whitespace-nowrap py-3 pl-2 text-right tabular-nums font-semibold text-ink">
              {row.minPrice === row.maxPrice
                ? `${formatUsd(row.minPrice)}/м²`
                : `${formatUsd(row.minPrice)}–${formatUsd(row.maxPrice)}/м² (медиана ${formatUsd(row.medianPrice)})`}
            </td>
          </tr>
        ),
      )}
    </>
  );
}
