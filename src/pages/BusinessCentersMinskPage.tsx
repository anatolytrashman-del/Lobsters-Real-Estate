import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Calendar, Camera, Layers, MapPin, Menu, Ruler, TrainFront, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import { Badge } from '../components/ui/Badge';
import { HeroImageSlider } from '../components/objects/HeroImageSlider';
import { ObjectMapWidget } from '../components/objects/ObjectMapWidget';
import { PhotoBlock, FactRow } from '../components/businessCenters/BusinessCenterVisuals';
import { setArticleJsonLd, setBreadcrumbJsonLd, setGenericPageMeta, setNoIndex, clearNoIndex } from '../lib/pageMeta';
import { businessClassTone, shortAddress, shortMetro, shortName } from '../lib/businessCenterDisplay';
import {
  CLASS_SLUG_TO_VALUE,
  DISTRICT_SLUG_TO_NAME,
  classHubUrl,
  districtHubUrl,
} from '../lib/businessCenterHubs';
import type { BusinessCenter } from '../data/businessCenters';
import { fetchBusinessCenters } from '../lib/businessCentersApi';

// Справочная SEO-страница по бизнес-центрам Минска (владелец, 2026-09-04) —
// см. комментарий в data/businessCenters.ts про источник списка и принцип
// "не выдумываем факты, чего нет — то не показываем". По структуре и
// визуальному языку — младшая сестра DistrictGuidePage.tsx (тот же
// glassCard/шапка с логотипом, тот же hero с HeroImageSlider), владелец
// прямо попросил "структуру первого блока и бокового меню" оттуда же.
//
// TITLE/DESCRIPTION — meta-теги (title/og/canonical), не то же самое, что
// видимые PAGE_H1/INTRO_TEXT ниже (тот же принцип разведения, что и в
// DistrictGuidePage.tsx — см. комментарий там от 2026-08-24 про путаницу
// "описание страницы" = INTRO_TEXT, а не meta-DESCRIPTION).
const TITLE = 'Бизнес-центры Минска — список, адреса, класс, площадь';
const DESCRIPTION =
  'Справочник бизнес-центров Минска: адреса, деловой класс, площадь, год постройки, застройщик и управляющая компания.';
const PAGE_URL = 'https://redevelopment.pro/minsk/bcminsk';
const OG_IMAGE = 'https://redevelopment.pro/og-image.png';

// Заголовок и подзаголовок hero — первая версия составлена Gemini (через
// ProxyAPI), владелец переписал вручную (2026-09-04), затем ещё раз попросил
// переформулировать: "не нравится слово «всех» и «помогаем»" — выбрал из
// трёх предложенных вариантов ("А").
const PAGE_H1 = 'Бизнес-центры Минска: аналитика для аренды и покупки офиса';
const INTRO_TEXT =
  'Сравнивайте бизнес-центры Минска по классу, площади и расположению — для инвестиций, аренды или покупки офиса.';

// Фото hero — владелец подбирает сам ("фотки я сейчас поищу сам"), пополняется
// по мере присылки. HeroImageSlider (см. DistrictGuidePage.tsx/
// ObjectLandingPage.tsx) при пустом массиве не рендерит ничего — плейсхолдер
// ниже занимает его место, пока список пуст.
const HERO_IMAGES: string[] = ['/images/business-centers-hero/hero-1.jpg'];

// Карта всех БЦ из списка (владелец, 2026-09-04) — тот же принцип, что и у
// карты объекта в ObjectMapWidget.tsx: ссылка не из JS API/координат, а
// готовая embed-ссылка из Яндекс.Карт Конструктора (constructor.yandex.ru),
// куда владелец загрузил CSV/XLSX с координатами всех БЦ (см. журнал
// CLAUDE.md — там же про формат этого файла). Владелец прислал два варианта
// встраивания — <script src="api-maps.yandex.ru/services/constructor/...">
// и страницу yandex.ru/maps/?um=constructor:<id> — ни один не подходит как
// src iframe (тот же нюанс, что уже задокументирован в ObjectMapWidget.tsx
// и в CLAUDE.md про карту объекта): нужен именно map-widget/v1 с тем же id.
const MAP_EMBED_URL =
  'https://yandex.ru/map-widget/v1/?um=constructor:40aec344a3d242ccc8c9562de875da3b03e8a49f93d956273f82830664696b1a&source=constructorLink';

// Только дата последнего пересмотра фактов/добавления БЦ — держать в одном
// месте, тот же принцип, что и DATE_MODIFIED в DistrictGuidePage.tsx.
const DATE_MODIFIED = '2026-09-04';

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

// Тот же принцип, что и в DistrictGuidePage.tsx — не фейковая дата, а честный
// месяц пересмотра, считается от текущей даты на каждый рендер.
const UPDATED_BADGE_LABEL = (() => {
  const now = new Date();
  return `Обновлено: ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
})();

// Значение district вне обычных городских районов (сейчас — только "Аден" в
// индустриальном парке "Великий камень", см. data/businessCenters.ts) —
// владелец: "переименуй За городом в Великий камень, и поставь вниз" — в
// фильтре и списке всегда последним, не по алфавиту вместе с районами.
const OUT_OF_TOWN_DISTRICT = 'Великий камень';

// Компактная карточка на хабе, подробности — на отдельной странице
// /minsk/bcminsk/:slug. Владелец, посмотрев на карточку с сеткой фактов
// 2х3: "давай менять карточку на список полей друг под другом" — ровно 5
// строго определённых строк (адрес без "г. Минск"/района — shortAddress() в
// lib/businessCenterDisplay.ts, площадь, срок сдачи, этажность, метро
// пешком), остальное (застройщик/парковка/описание) убрано с карточки
// целиком — "прячь в подробно", видно только на отдельной странице БЦ.
// Кнопка-пилюля "Подробнее →" — из прошлого захода (владелец: "неочевидно,
// что на них надо нажимать"), не убиралась.
function BusinessCenterCard({ center }: { center: BusinessCenter }) {
  return (
    <Link
      to={`/minsk/bcminsk/${center.slug}`}
      className={cn('group flex flex-col overflow-hidden transition-transform hover:-translate-y-0.5', glassCardClass)}
      style={glassCardShadow}
    >
      <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden">
        <PhotoBlock center={center} />
        <div className="absolute right-2 top-2 flex flex-wrap justify-end gap-1.5">
          {center.status === 'under_construction' && <Badge tone="warning">Строится</Badge>}
          {center.businessClass && (
            <Badge tone={businessClassTone[center.businessClass]}>Класс {center.businessClass}</Badge>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <h2 className="text-base font-bold leading-snug text-ink">{center.name}</h2>

        <div className="flex flex-col gap-1.5">
          <FactRow icon={MapPin}>{shortAddress(center.address)}</FactRow>
          {center.totalArea != null && <FactRow icon={Ruler}>Площадь: {center.totalArea.toLocaleString('ru-RU')} м²</FactRow>}
          {center.yearBuilt != null && <FactRow icon={Calendar}>Срок сдачи: {center.yearBuilt} г.</FactRow>}
          {center.floors != null && <FactRow icon={Layers}>Этажность: {center.floors}</FactRow>}
          {center.metro && <FactRow icon={TrainFront}>Метро: {shortMetro(center.metro)}</FactRow>}
        </div>

        <div className="mt-auto flex justify-end pt-1">
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition-colors group-hover:bg-primary group-hover:text-white">
            Подробнее
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </span>
        </div>
      </div>
    </Link>
  );
}

// Хаб-страницы по классу/району (Fable-анализ, 2026-09-06 — "нужны страницы
// вида /minsk/bcminsk/class-a/, /minsk/bcminsk/centralny/... каждая со
// своим H1... блок ссылок на них — на каталоге и в карточках"). Один и тот
// же компонент обслуживает три роута — общий каталог `/minsk/bcminsk`,
// `/minsk/bcminsk/class/:classSlug` и `/minsk/bcminsk/raion/:districtSlug`
// (см. App.tsx) — фильтр больше не локальный useState, а производный от
// URL через useParams(): пункты бокового меню стали обычными <Link>, сама
// навигация и есть применение фильтра (клиентский роутинг, без перезагрузки
// страницы — так же мгновенно, как раньше onClick+setState, но URL теперь
// настоящий, индексируемый, с уникальным title/H1/canonical). Сознательное
// упрощение: класс и район не комбинируются в одном URL (как и в примерах
// самого документа) — выбор одной оси сбрасывает другую.
export function BusinessCentersMinskPage() {
  const { classSlug, districtSlug } = useParams<{ classSlug?: string; districtSlug?: string }>();
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);
  // Боковое меню на мобильном скрыто за плавающей кнопкой (владелец, 2026-09-04:
  // "сделай конструктивно как на странице Минск Мира, чтобы оно с мобилки
  // скрывалось") — тот же паттерн шторки, что и SECTION_NAV в DistrictGuidePage.tsx.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const classFilter = classSlug ? (CLASS_SLUG_TO_VALUE[classSlug] ?? null) : null;
  const districtFilter = districtSlug ? (DISTRICT_SLUG_TO_NAME[districtSlug] ?? null) : null;
  // Невалидный slug в /class/:classSlug или /raion/:districtSlug — не
  // существующий класс/район, не просто "пусто" (тот же принцип soft-404,
  // что и у неизвестного :slug на BusinessCenterDetailPage.tsx).
  const badClassSlug = Boolean(classSlug) && classFilter === null;
  const badDistrictSlug = Boolean(districtSlug) && districtFilter === null;
  const notFound = badClassSlug || badDistrictSlug;

  useEffect(() => {
    fetchBusinessCenters()
      .then(setCenters)
      .catch(() => setCenters([]));
  }, []);

  useEffect(() => {
    if (notFound) {
      setNoIndex();
      return () => clearNoIndex();
    }
    const hubTitle = classFilter
      ? `Бизнес-центры класса ${classFilter} в Минске`
      : districtFilter
        ? `Бизнес-центры Минска: ${districtFilter} район`
        : TITLE;
    const hubDescription = classFilter
      ? `Список бизнес-центров класса ${classFilter} в Минске: адреса, площадь, этажность, метро.`
      : districtFilter
        ? `Бизнес-центры в ${districtFilter} районе Минска: адреса, деловой класс, площадь, метро.`
        : DESCRIPTION;
    const hubUrl = classFilter
      ? `https://redevelopment.pro${classHubUrl(classFilter)}`
      : districtFilter
        ? `https://redevelopment.pro${districtHubUrl(districtFilter) ?? ''}`
        : PAGE_URL;

    setGenericPageMeta({ title: hubTitle, description: hubDescription, url: hubUrl, image: OG_IMAGE, ogType: 'article' });
    setArticleJsonLd({
      headline: hubTitle,
      description: hubDescription,
      url: hubUrl,
      datePublished: '2026-09-04',
      dateModified: DATE_MODIFIED,
      image: OG_IMAGE,
    });
    setBreadcrumbJsonLd(
      classFilter || districtFilter
        ? [
            { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
            { name: 'Бизнес-центры Минска', url: PAGE_URL },
            { name: classFilter ? `Класс ${classFilter}` : (districtFilter as string) },
          ]
        : [
            { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
            { name: 'Бизнес-центры Минска' },
          ],
    );
  }, [classFilter, districtFilter, notFound]);

  const availableClasses = useMemo(
    () =>
      Array.from(new Set((centers ?? []).map((c) => c.businessClass).filter((v): v is NonNullable<typeof v> => !!v))).sort(),
    [centers],
  );
  // "Все" + N классов: до 3 пилюль — один ряд, от 4 — два ряда поровну
  // (см. комментарий у самой сетки ниже).
  const classPillCols = useMemo(() => {
    const total = availableClasses.length + 1;
    return total <= 3 ? total : Math.ceil(total / 2);
  }, [availableClasses]);

  // Районы — только те, что реально встречаются в данных (не хардкожен полный
  // список всех 9 районов Минска — растёт из AddableSelect в админке, см.
  // BusinessCentersAdminTab.tsx). "Великий камень" — для объектов вне
  // Минска (сейчас только "Аден", в индустриальном парке), владелец: "внизу
  // списка, не по алфавиту вместе с городскими районами".
  const districts = useMemo(() => {
    const all = Array.from(new Set((centers ?? []).map((c) => c.district).filter((v): v is string => !!v)));
    const inCity = all.filter((d) => d !== OUT_OF_TOWN_DISTRICT).sort((a, b) => a.localeCompare(b, 'ru'));
    const outOfCity = all.filter((d) => d === OUT_OF_TOWN_DISTRICT);
    return [...inCity, ...outOfCity];
  }, [centers]);
  const districtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of centers ?? []) if (c.district) counts[c.district] = (counts[c.district] ?? 0) + 1;
    return counts;
  }, [centers]);

  const visibleCenters = useMemo(
    () =>
      (centers ?? []).filter(
        (c) => (classFilter === null || c.businessClass === classFilter) && (districtFilter === null || c.district === districtFilter),
      ),
    [centers, classFilter, districtFilter],
  );

  // Боковой список — те же фильтры, что и у самой сетки карточек ниже: список
  // всегда отражает то, что реально видно на странице, ссылки не ведут "в
  // никуда" на скрытую фильтром карточку.
  const sortedForNav = useMemo(
    () => [...visibleCenters].sort((a, b) => shortName(a).localeCompare(shortName(b), 'ru')),
    [visibleCenters],
  );

  if (notFound) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
        <p className="text-base text-ink-muted">Такой раздел каталога не найден.</p>
        <Link to="/minsk/bcminsk" className="text-sm font-semibold text-primary hover:underline">
          ← Все бизнес-центры Минска
        </Link>
      </div>
    );
  }

  // Заголовок/подзаголовок hero — на общем каталоге статичные PAGE_H1/
  // INTRO_TEXT, на хаб-подстранице класса/района — уникальные под конкретный
  // фильтр (то же значение, что уже посчитано для meta-тегов выше).
  const heroH1 = classFilter
    ? `Бизнес-центры класса ${classFilter} в Минске`
    : districtFilter
      ? `Бизнес-центры Минска: ${districtFilter} район`
      : PAGE_H1;
  const heroIntro = classFilter
    ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров делового класса ${classFilter} в Минске — адреса, площадь, этажность, метро.`
    : districtFilter
      ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров в ${districtFilter} районе Минска — сравнивайте по классу, площади и расположению.`
      : INTRO_TEXT;

  // Содержимое бокового меню — общий JSX для десктопной sticky-колонки и
  // мобильной шторки (владелец: "боковое меню... как на странице Минск
  // Мира, чтобы оно с мобилки скрывалось"), см. рендер обоих ниже.
  const filterContent = (
    <>
      <span className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Район</span>
      <Link
        to="/minsk/bcminsk"
        onClick={() => setMobileNavOpen(false)}
        className={cn(
          'rounded-control px-2 py-1.5 text-left transition-colors hover:text-primary',
          districtFilter === null ? 'bg-primary/10 font-bold text-primary' : 'font-medium text-ink',
        )}
      >
        Все районы
      </Link>
      {districts.map((d) => {
        const url = districtHubUrl(d);
        if (!url) return null;
        return (
          <Link
            key={d}
            to={url}
            onClick={() => setMobileNavOpen(false)}
            className={cn(
              'flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:text-primary',
              districtFilter === d ? 'bg-primary/10 font-bold text-primary' : 'font-medium text-ink',
            )}
          >
            <span>{d}</span>
            <span className="text-xs text-ink-faint">{districtCounts[d]}</span>
          </Link>
        );
      })}

      {availableClasses.length > 0 && (
        <>
          <div className="my-2 border-t border-border" />

          <span className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Класс</span>
          {/* Компактные пилюли с одной буквой класса (владелец: "выбор класса
              слишком большой по размеру, хватит букв, А/В"). Раньше —
              flex-wrap, который на "Все"+4 класса ломался некрасиво (4+1
              вместо ровного ряда) — владелец: "тупо выглядит, либо вмещай в
              одну строку, либо разноси на две равными долями". Сетка с
              равными колонками вместо wrap: до 3 пилюль — все в один ряд, от
              4 и больше — два ряда поровну (ceil(n/2) колонок), не "остаток
              одной пилюлей снизу". */}
          <div
            className="grid gap-1.5 px-2 pb-1"
            style={{
              gridTemplateColumns: `repeat(${classPillCols}, minmax(0, 1fr))`,
            }}
          >
            <Link
              to="/minsk/bcminsk"
              onClick={() => setMobileNavOpen(false)}
              className={cn(
                'rounded-full px-2 py-1 text-center text-xs font-semibold transition-colors',
                classFilter === null ? 'bg-primary text-white' : 'bg-surface-muted text-ink-muted hover:text-ink',
              )}
            >
              Все
            </Link>
            {availableClasses.map((cls) => (
              <Link
                key={cls}
                to={classHubUrl(cls)}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'rounded-full px-2 py-1 text-center text-xs font-semibold transition-colors',
                  classFilter === cls ? 'bg-primary text-white' : 'bg-surface-muted text-ink-muted hover:text-ink',
                )}
              >
                {cls}
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="my-2 border-t border-border" />

      <span className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Бизнес-центры
      </span>
      {sortedForNav.length === 0 ? (
        <span className="px-2 py-1.5 text-xs text-ink-faint">Нет объектов в этом районе</span>
      ) : (
        sortedForNav.map((c) => (
          <Link
            key={c.slug}
            to={`/minsk/bcminsk/${c.slug}`}
            onClick={() => setMobileNavOpen(false)}
            className="rounded-control px-2 py-1.5 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            {shortName(c)}
          </Link>
        ))
      )}
    </>
  );

  return (
    <div className="min-h-svh bg-bg">
      {/* Шапка sticky — владелец: "нравится, как на /minsk/minsk-mir логотип
          остаётся при скролле, сделай 1 в 1". У DistrictGuidePage.tsx для
          этого исторически сложный fixed+JS-измеренный трюк (см. комментарий
          там же — нужен был из-за старого overflow-x:hidden на body/#root,
          ломавшего position:sticky); с тех пор это заменили на overflow-x:
          clip (см. index.css), sticky работает нормально сайтвайд (тот же
          подход уже и в Sidebar.tsx, и в боковом фильтре этой страницы ниже)
          — простого `sticky top-0` на саму шапку достаточно для того же
          визуального эффекта, без дублирования логотипа отдельным узлом. */}
      <div className="sticky top-0 z-30 border-b border-border bg-bg/90 py-5 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary">RED</span>EVELOPMENT
          </Link>
        </div>
      </div>

      {/* Плавающая кнопка + шторка ниже lg — тот же паттерн, что и
          "Содержание гайда" в DistrictGuidePage.tsx. От lg и шире — обычная
          sticky-колонка слева (аналог Sidebar.tsx: lg:sticky работает
          благодаря overflow-x: clip на body/#root, см. index.css). */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className={cn(
          'fixed bottom-4 right-4 z-30 flex items-center gap-2 px-4 py-3 text-sm font-semibold text-ink lg:hidden',
          glassPillClass,
        )}
        style={glassPillShadow}
      >
        <Menu className="h-4 w-4 shrink-0" />
        Фильтры
      </button>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-svh w-72 max-w-[85vw] flex-col gap-1 overflow-y-auto border-r border-white/50 bg-white/70 px-5 py-6 backdrop-blur-xl backdrop-saturate-150 transition-transform duration-200 ease-out lg:hidden',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Фильтры</span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Закрыть меню"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {filterContent}
      </aside>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
        <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-10">
          <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-fit lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
            <div className={cn('flex flex-col gap-1 p-3 text-sm', glassCardClass)} style={glassCardShadow}>
              {filterContent}
            </div>
          </aside>

          <div className="flex flex-col gap-10">
            <div
              className={cn('grid grid-cols-1 gap-6 p-6 sm:grid-cols-[3fr_2fr] sm:items-center sm:p-8', glassCardClass)}
              style={glassCardShadow}
            >
              <div className="flex flex-col gap-3">
                <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-3xl">{heroH1}</h1>
                <p className="text-base text-ink-muted">{heroIntro}</p>
                <span className="flex w-fit items-center gap-1.5 rounded-full border border-success/30 bg-success-bg px-3 py-1 text-xs font-semibold text-success">
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                  {UPDATED_BADGE_LABEL}
                </span>
              </div>
              <div className="mx-auto w-full max-w-xs sm:max-w-none">
                {HERO_IMAGES.length > 0 ? (
                  <HeroImageSlider images={HERO_IMAGES} alt="Бизнес-центры Минска" aspectClassName="aspect-[4/5]" />
                ) : (
                  <div className="flex aspect-[4/5] w-full items-center justify-center rounded-3xl bg-gradient-to-br from-surface-muted to-border">
                    <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink-muted shadow-sm">
                      <Camera className="h-3.5 w-3.5 shrink-0" />
                      Фото скоро
                    </span>
                  </div>
                )}
              </div>
            </div>

            <ObjectMapWidget address="Бизнес-центры Минска" mapEmbedUrl={MAP_EMBED_URL} aspectClassName="aspect-[21/9]" />

            {centers === null ? (
              <p className="text-sm text-ink-faint">Загрузка…</p>
            ) : visibleCenters.length === 0 ? (
              <p className="text-sm text-ink-faint">Нет бизнес-центров по выбранным фильтрам.</p>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {visibleCenters.map((c) => (
                  <BusinessCenterCard key={c.slug} center={c} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
