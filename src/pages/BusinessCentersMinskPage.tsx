import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight,
  Award,
  BadgeCheck,
  Building2,
  Calendar,
  Camera,
  HardHat,
  Layers,
  MapPin,
  Menu,
  Ruler,
  TrainFront,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import { Badge } from '../components/ui/Badge';
import { HeroImageSlider } from '../components/objects/HeroImageSlider';
import { ObjectMapWidget } from '../components/objects/ObjectMapWidget';
import { PhotoBlock, FactRow, FactTile } from '../components/businessCenters/BusinessCenterVisuals';
import {
  setArticleJsonLd,
  setBreadcrumbJsonLd,
  setFaqJsonLd,
  setGenericPageMeta,
  setNoIndex,
  clearNoIndex,
} from '../lib/pageMeta';
import { businessClassTone, shortAddress, shortMetro, shortName } from '../lib/businessCenterDisplay';
import {
  CLASS_SLUG_TO_VALUE,
  DISTRICT_SLUG_TO_NAME,
  MICRODISTRICT_SLUG_TO_NAME,
  classDistrictHubUrl,
  classHubUrl,
  districtHubUrl,
  districtPrepositional,
  microdistrictHubUrl,
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
// Обновлено 2026-09-06 — владелец перезалил карту с координатами ВСЕХ 143 БЦ
// (см. журнал CLAUDE.md, запись про CSV для Конструктора) — новый id карты.
const MAP_EMBED_URL =
  'https://yandex.ru/map-widget/v1/?um=constructor:2faf8b114a74f188414091fd2e5e0f17d2fcde9f125ebbee51c25197b78c7736&source=constructorLink';

// Только дата последнего пересмотра фактов/добавления БЦ — держать в одном
// месте, тот же принцип, что и DATE_MODIFIED в DistrictGuidePage.tsx.
const DATE_MODIFIED = '2026-09-06';

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
  const { classSlug, districtSlug, microdistrictSlug } = useParams<{
    classSlug?: string;
    districtSlug?: string;
    microdistrictSlug?: string;
  }>();
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);
  // Боковое меню на мобильном скрыто за плавающей кнопкой (владелец, 2026-09-04:
  // "сделай конструктивно как на странице Минск Мира, чтобы оно с мобилки
  // скрывалось") — тот же паттерн шторки, что и SECTION_NAV в DistrictGuidePage.tsx.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const classFilter = classSlug ? (CLASS_SLUG_TO_VALUE[classSlug] ?? null) : null;
  const districtFilter = districtSlug ? (DISTRICT_SLUG_TO_NAME[districtSlug] ?? null) : null;
  // Микрорайон — отдельная, НЕ комбинируемая с классом/районом ось (владелец,
  // 2026-09-07: "Бизнес-центры Уручье" и т.п.) — своя ветка роутинга
  // (App.tsx), поэтому classSlug/districtSlug на этом маршруте всегда пусты.
  const microdistrictFilter = microdistrictSlug ? (MICRODISTRICT_SLUG_TO_NAME[microdistrictSlug] ?? null) : null;
  // Невалидный slug в /class/:classSlug или /raion/:districtSlug — не
  // существующий класс/район, не просто "пусто" (тот же принцип soft-404,
  // что и у неизвестного :slug на BusinessCenterDetailPage.tsx).
  const badClassSlug = Boolean(classSlug) && classFilter === null;
  const badDistrictSlug = Boolean(districtSlug) && districtFilter === null;
  const badMicrodistrictSlug = Boolean(microdistrictSlug) && microdistrictFilter === null;
  // Пересечение класс×район без единого БЦ (владелец, 2026-09-06: "делай
  // структуру урлов [дерево пересечений]") — тот же soft-404, что и у
  // невалидного slug: сам план (`BCMINSK_SEO_PLAN.md`) явно предупреждал не
  // генерировать хаб для комбинации без единого БЦ (риск тонкого
  // контента). `centers !== null` — не 404-им во время самой загрузки.
  const comboEmpty =
    classFilter !== null &&
    districtFilter !== null &&
    centers !== null &&
    !centers.some((c) => c.businessClass === classFilter && c.district === districtFilter);
  const notFound = badClassSlug || badDistrictSlug || badMicrodistrictSlug || comboEmpty;

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
    const hubTitle =
      classFilter && districtFilter
        ? `Бизнес-центры класса ${classFilter} в ${districtPrepositional(districtFilter)} районе Минска`
        : classFilter
          ? `Бизнес-центры класса ${classFilter} в Минске`
          : districtFilter
            ? `Бизнес-центры Минска: ${districtFilter} район`
            : microdistrictFilter
              ? `Бизнес-центры ${microdistrictFilter}`
              : TITLE;
    const hubDescription =
      classFilter && districtFilter
        ? `Бизнес-центры класса ${classFilter} в ${districtPrepositional(districtFilter)} районе Минска: адреса, площадь, этажность, метро.`
        : classFilter
          ? `Список бизнес-центров класса ${classFilter} в Минске: адреса, площадь, этажность, метро.`
          : districtFilter
            ? `Бизнес-центры в ${districtPrepositional(districtFilter)} районе Минска: адреса, деловой класс, площадь, метро.`
            : microdistrictFilter
              ? `Бизнес-центры в микрорайоне ${microdistrictFilter} (Минск): адреса, деловой класс, площадь, метро.`
              : DESCRIPTION;
    const hubUrl =
      classFilter && districtFilter
        ? `https://redevelopment.pro${classDistrictHubUrl(classFilter, districtFilter) ?? ''}`
        : classFilter
          ? `https://redevelopment.pro${classHubUrl(classFilter)}`
          : districtFilter
            ? `https://redevelopment.pro${districtHubUrl(districtFilter) ?? ''}`
            : microdistrictFilter
              ? `https://redevelopment.pro${microdistrictHubUrl(microdistrictFilter) ?? ''}`
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
      classFilter && districtFilter
        ? [
            { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
            { name: 'Бизнес-центры Минска', url: PAGE_URL },
            { name: `Класс ${classFilter}`, url: `https://redevelopment.pro${classHubUrl(classFilter)}` },
            { name: `${districtFilter} район` },
          ]
        : classFilter || districtFilter || microdistrictFilter
          ? [
              { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
              { name: 'Бизнес-центры Минска', url: PAGE_URL },
              { name: classFilter ? `Класс ${classFilter}` : ((districtFilter ?? microdistrictFilter) as string) },
            ]
          : [
              { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
              { name: 'Бизнес-центры Минска' },
            ],
    );
  }, [classFilter, districtFilter, microdistrictFilter, notFound]);

  // Districts/классы для сайдбара — считаются НЕ от всего `centers`, а от
  // среза по ДРУГОЙ активной оси (владелец, 2026-09-06: "структура урлов
  // [пересечений]") — на хабе класса список районов должен показывать
  // только районы, где у ЭТОГО класса реально есть БЦ (иначе ссылка на
  // пересечение вела бы на пустой soft-404), и наоборот. Без активного
  // фильтра по другой оси — обычный полный список, как было.
  const centersForDistrictList = useMemo(
    () => (classFilter ? (centers ?? []).filter((c) => c.businessClass === classFilter) : (centers ?? [])),
    [centers, classFilter],
  );
  const centersForClassList = useMemo(
    () => (districtFilter ? (centers ?? []).filter((c) => c.district === districtFilter) : (centers ?? [])),
    [centers, districtFilter],
  );

  const availableClasses = useMemo(
    () => Array.from(new Set(centersForClassList.map((c) => c.businessClass).filter((v): v is NonNullable<typeof v> => !!v))).sort(),
    [centersForClassList],
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
    const all = Array.from(new Set(centersForDistrictList.map((c) => c.district).filter((v): v is string => !!v)));
    const inCity = all.filter((d) => d !== OUT_OF_TOWN_DISTRICT).sort((a, b) => a.localeCompare(b, 'ru'));
    const outOfCity = all.filter((d) => d === OUT_OF_TOWN_DISTRICT);
    return [...inCity, ...outOfCity];
  }, [centersForDistrictList]);
  const districtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of centersForDistrictList) if (c.district) counts[c.district] = (counts[c.district] ?? 0) + 1;
    return counts;
  }, [centersForDistrictList]);

  // Микрорайоны — независимая ось (не пересекается с классом/районом, см.
  // комментарий у microdistrictFilter), поэтому считается от ВСЕХ centers,
  // не от среза по другой оси. Список ограничен теми, для кого есть слаг
  // (MICRODISTRICT_SLUGS — только районы с хотя бы 1 БЦ на момент матчинга,
  // см. businessCenterHubs.ts) — сортировка по числу БЦ, не по алфавиту:
  // это открывающий список, не устоявшийся набор из 9 админ-районов.
  const microdistricts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of centers ?? []) if (c.microdistrict) counts[c.microdistrict] = (counts[c.microdistrict] ?? 0) + 1;
    return Object.entries(counts)
      .filter(([name]) => microdistrictHubUrl(name) !== null)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  }, [centers]);

  const visibleCenters = useMemo(
    () =>
      (centers ?? []).filter(
        (c) =>
          (classFilter === null || c.businessClass === classFilter) &&
          (districtFilter === null || c.district === districtFilter) &&
          (microdistrictFilter === null || c.microdistrict === microdistrictFilter),
      ),
    [centers, classFilter, districtFilter, microdistrictFilter],
  );

  // Боковой список — те же фильтры, что и у самой сетки карточек ниже: список
  // всегда отражает то, что реально видно на странице, ссылки не ведут "в
  // никуда" на скрытую фильтром карточку.
  const sortedForNav = useMemo(
    () => [...visibleCenters].sort((a, b) => shortName(a).localeCompare(shortName(b), 'ru')),
    [visibleCenters],
  );

  // Сводка по рынку (Fable-анализ, 2026-09-06, приоритет 1: "закрывает
  // обещание аналитика... 5-8 цифр в плитках, считаются из базы"). Честно
  // — только то, что реально можно посчитать по данным: средний год
  // постройки НЕ включён (известен лишь у 21 из 145 записей — bad-faith
  // "средняя" по 15% выборки выдавала бы её за общую), ставки НЕ включены
  // (структурных данных по ставкам на уровне каталога нет вовсе, только у
  // отдельных БЦ в "Объявления с Kufar и Realt"). Считается от
  // `visibleCenters`, не от всего `centers` — на хаб-странице класса/района
  // сводка автоматически становится сводкой по этому классу/району, не по
  // всему городу.
  const marketStats = useMemo(() => {
    const withArea = visibleCenters.filter((c) => c.totalArea != null);
    const totalArea = withArea.reduce((sum, c) => sum + (c.totalArea ?? 0), 0);
    const withMetro = visibleCenters.filter((c) => c.metro);
    const nearMetro = withMetro.filter((c) => /пешком|шагов/i.test(c.metro ?? ''));
    const underConstruction = visibleCenters.filter((c) => c.status === 'under_construction').length;
    const byClass: Record<string, number> = {};
    for (const c of visibleCenters) if (c.businessClass) byClass[c.businessClass] = (byClass[c.businessClass] ?? 0) + 1;
    return { total: visibleCenters.length, totalArea, withAreaCount: withArea.length, nearMetro: nearMetro.length, withMetroCount: withMetro.length, underConstruction, byClass };
  }, [visibleCenters]);

  // FAQ (Fable-анализ, приоритет 1: "5-8 вопросов, ответы короткие, с
  // цифрами из базы" + FAQPage-разметка). Только вопросы, на которые честно
  // есть ответ из реальных данных — "сколько стоит аренда офиса класса A"
  // из исходного списка Fable НЕ включён (структурных данных по ставкам на
  // уровне каталога нет, см. комментарий у marketStats выше). Скоуп — тот
  // же отфильтрованный `visibleCenters`/`marketStats`, что и у сводки: на
  // хаб-странице класса/района FAQ отвечает про этот класс/район, не про
  // весь город. "Самый большой" — определённый максимум по `totalArea`
  // среди visibleCenters, не выдумка.
  const scopeLabel =
    classFilter && districtFilter
      ? `класса ${classFilter} в ${districtPrepositional(districtFilter)} районе`
      : classFilter
        ? `класса ${classFilter}`
        : districtFilter
          ? `в ${districtPrepositional(districtFilter)} районе`
          : microdistrictFilter
            ? `в ${microdistrictFilter}`
            : 'в Минске';
  const biggest = useMemo(
    () => visibleCenters.filter((c) => c.totalArea != null).sort((a, b) => (b.totalArea ?? 0) - (a.totalArea ?? 0))[0] ?? null,
    [visibleCenters],
  );
  const underConstructionNames = useMemo(
    () => visibleCenters.filter((c) => c.status === 'under_construction').map((c) => shortName(c)),
    [visibleCenters],
  );
  // SEO-текст с H2/H3 (Fable-анализ, приоритет 1 каталога — "500-900 слов:
  // классификация A/B+/B/C, география, что строится, на что смотреть при
  // выборе, из чего складывается ставка"). Общее отраслевое знание, не
  // факты про конкретные здания — низкий риск ошибки (см. BCMINSK_SEO_PLAN.md).
  // Показывается только на общем каталоге, не на хаб-страницах класса/района
  // — там уже свой узкий H1/intro, а этот текст ровно про то, как устроен
  // рынок В ЦЕЛОМ (классификация, география по городу), повторять его на
  // каждом хабе было бы избыточно. География по классам — не выдумка, а
  // реально посчитанный из данных "самый частый район" для каждого класса.
  const classDistrictBreakdown = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const c of centers ?? []) {
      if (!c.businessClass || !c.district) continue;
      map[c.businessClass] ??= {};
      map[c.businessClass][c.district] = (map[c.businessClass][c.district] ?? 0) + 1;
    }
    const result: Record<string, string> = {};
    for (const cls of Object.keys(map)) {
      const top = Object.entries(map[cls]).sort((a, b) => b[1] - a[1])[0];
      if (top) result[cls] = top[0];
    }
    return result;
  }, [centers]);

  const topDistrictsByCount = useMemo(
    () => Object.entries(districtCounts).sort((a, b) => b[1] - a[1]).slice(0, 3),
    [districtCounts],
  );

  const showCatalogSeoText = !classFilter && !districtFilter && !microdistrictFilter && centers !== null && centers.length > 0;

  const faqItems = useMemo(() => {
    const items: { question: string; answer: string }[] = [];
    if (marketStats.total > 0) {
      items.push({
        question: `Сколько бизнес-центров ${scopeLabel} есть в каталоге?`,
        answer: `В каталоге redevelopment.pro сейчас ${marketStats.total} бизнес-центров ${scopeLabel === 'в Минске' ? 'Минска' : scopeLabel}.`,
      });
    }
    if (biggest) {
      items.push({
        question: `Какой самый большой бизнес-центр ${scopeLabel}?`,
        answer: `По площади в каталоге лидирует ${shortName(biggest)} — ${biggest.totalArea?.toLocaleString('ru-RU')} м².`,
      });
    }
    items.push({
      question: `Какие бизнес-центры ${scopeLabel} сейчас строятся?`,
      answer:
        underConstructionNames.length > 0
          ? `Строятся: ${underConstructionNames.join(', ')}.`
          : `Среди бизнес-центров ${scopeLabel} в каталоге сейчас нет строящихся объектов.`,
    });
    items.push({
      question: 'Чем класс A отличается от B+, B и C?',
      answer:
        'Класс A — самый высокий уровень: качественная инженерия (климат-контроль, резервное питание), развитая инфраструктура, вместительная парковка и расположение в деловых зонах. Класс B+ и B — хорошее качество отделки и инженерии, но менее престижное расположение или меньшая парковка. Класс C — более простая отделка и инженерные системы, обычно ниже ставки аренды.',
    });
    return items;
  }, [marketStats.total, scopeLabel, biggest, underConstructionNames]);

  useEffect(() => {
    if (notFound) return;
    setFaqJsonLd(faqItems);
  }, [faqItems, notFound]);

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
  const heroH1 =
    classFilter && districtFilter
      ? `Бизнес-центры класса ${classFilter} в ${districtPrepositional(districtFilter)} районе Минска`
      : classFilter
        ? `Бизнес-центры класса ${classFilter} в Минске`
        : districtFilter
          ? `Бизнес-центры Минска: ${districtFilter} район`
          : microdistrictFilter
            ? `Бизнес-центры ${microdistrictFilter}`
            : PAGE_H1;
  const heroIntro =
    classFilter && districtFilter
      ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров делового класса ${classFilter} в ${districtPrepositional(districtFilter)} районе Минска — адреса, площадь, этажность, метро.`
      : classFilter
        ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров делового класса ${classFilter} в Минске — адреса, площадь, этажность, метро.`
        : districtFilter
          ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров в ${districtPrepositional(districtFilter)} районе Минска — сравнивайте по классу, площади и расположению.`
          : microdistrictFilter
            ? `${centers ? `${visibleCenters.length} ` : ''}бизнес-центров в микрорайоне ${microdistrictFilter} (Минск) — адреса, деловой класс, площадь, метро.`
          : INTRO_TEXT;

  // Содержимое бокового меню — общий JSX для десктопной sticky-колонки и
  // мобильной шторки (владелец: "боковое меню... как на странице Минск
  // Мира, чтобы оно с мобилки скрывалось"), см. рендер обоих ниже.
  const filterContent = (
    <>
      <span className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Район</span>
      {/* "Все районы" сбрасывает только район, класс (если выбран) сохраняется
          — владелец, 2026-09-06: пересечение класс×район, оси комбинируются,
          не сбрасывают друг друга при переключении. */}
      <Link
        to={classFilter ? classHubUrl(classFilter) : '/minsk/bcminsk'}
        onClick={() => setMobileNavOpen(false)}
        className={cn(
          'rounded-control px-2 py-1.5 text-left transition-colors hover:text-primary',
          districtFilter === null ? 'bg-primary/10 font-bold text-primary' : 'font-medium text-ink',
        )}
      >
        Все районы
      </Link>
      {districts.map((d) => {
        const url = classFilter ? classDistrictHubUrl(classFilter, d) : districtHubUrl(d);
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

      {microdistricts.length > 0 && (
        <>
          <div className="my-2 border-t border-border" />
          <span className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Микрорайон
          </span>
          {/* Отдельная, не пересекающаяся с классом/районом ось (владелец,
              2026-09-07: "Бизнес-центры Уручье" — как люди сами говорят, не
              административный район) — переход сюда уводит с текущего
              хаба класса/района на отдельный маршрут. */}
          {microdistricts.map(([name, count]) => {
            const url = microdistrictHubUrl(name);
            if (!url) return null;
            return (
              <Link
                key={name}
                to={url}
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:text-primary',
                  microdistrictFilter === name ? 'bg-primary/10 font-bold text-primary' : 'font-medium text-ink',
                )}
              >
                <span>{name}</span>
                <span className="text-xs text-ink-faint">{count}</span>
              </Link>
            );
          })}
        </>
      )}

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
              to={districtFilter ? (districtHubUrl(districtFilter) ?? '/minsk/bcminsk') : '/minsk/bcminsk'}
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
                to={districtFilter ? (classDistrictHubUrl(cls, districtFilter) ?? classHubUrl(cls)) : classHubUrl(cls)}
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

            {centers !== null && marketStats.total > 0 && (
              <div className={cn('flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
                <h2 className="text-lg font-bold text-ink">Рынок в цифрах</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <FactTile icon={Building2} value={marketStats.total} label="Всего бизнес-центров" />
                  {marketStats.withAreaCount > 0 && (
                    <FactTile
                      icon={Ruler}
                      value={`${Math.round(marketStats.totalArea).toLocaleString('ru-RU')} м²`}
                      label={`Суммарная площадь (по ${marketStats.withAreaCount} из ${marketStats.total})`}
                    />
                  )}
                  {marketStats.underConstruction > 0 && (
                    <FactTile icon={HardHat} value={marketStats.underConstruction} label="Строится" />
                  )}
                  {marketStats.withMetroCount > 0 && (
                    <FactTile
                      icon={TrainFront}
                      value={`${marketStats.nearMetro} из ${marketStats.withMetroCount}`}
                      label="В шаговой доступности от метро"
                    />
                  )}
                  {/* Разбивка по классам — только когда сама сводка не по
                      одному классу (на хаб-странице класса это было бы
                      избыточно: все плитки, кроме одной, показали бы 0). */}
                  {!classFilter &&
                    (['A', 'B+', 'B', 'C'] as const).map(
                      (cls) =>
                        marketStats.byClass[cls] > 0 && (
                          <FactTile key={cls} icon={Award} value={marketStats.byClass[cls]} label={`Класса ${cls}`} />
                        ),
                    )}
                </div>
              </div>
            )}

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

            {showCatalogSeoText && (
              <div className={cn('flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
                <h2 className="text-lg font-bold text-ink">Как устроен рынок бизнес-центров в Минске</h2>
                <div className="flex flex-col gap-4 text-sm leading-relaxed text-ink-muted">
                  <p>
                    В каталоге собрано {marketStats.total} бизнес-центров Минска — от небольших
                    офисных зданий на несколько кабинетов до многокорпусных комплексов на
                    десятки тысяч квадратных метров. Ниже — как устроена классификация, где
                    физически сосредоточены объекты разного уровня и на что стоит смотреть,
                    выбирая офис в аренду или для покупки.
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-bold text-ink">Классы A, B+, B и C</h3>
                    <p>
                      Деловой класс бизнес-центра — это не маркетинговая метка, а сложившаяся на
                      рынке коммерческой недвижимости система координат по качеству здания и
                      уровню сервиса. <strong>Класс A</strong> — самый высокий уровень: современная
                      инженерия (климат-контроль, резервное электропитание, скоростные лифты),
                      профессиональная управляющая компания, достаточная парковка и, как правило,
                      расположение в деловых зонах города. <strong>Класс B+</strong> обычно уступает
                      классу A по расположению или инженерным системам, но сопоставим по качеству
                      отделки и управлению зданием. <strong>Класс B</strong> — крепкий средний
                      сегмент: хорошая для повседневной работы отделка и инженерия, но без
                      премиальных опций класса A. <strong>Класс C</strong> — более простые здания,
                      часто реконструированные под офисы из другого назначения, с базовой отделкой
                      и минимальным набором сервисов; ставки аренды здесь обычно ниже, чем в
                      других классах. Единой обязательной сертификации классов в Беларуси нет —
                      застройщики и управляющие компании присваивают класс сами, ориентируясь на
                      международную практику (стандарты вроде BOMA/Euromoney), поэтому у объектов
                      одного и того же формального класса от разных застройщиков сервис может
                      заметно отличаться.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-bold text-ink">География: где сосредоточены бизнес-центры</h3>
                    <p>
                      {topDistrictsByCount.length > 0 && (
                        <>
                          Больше всего бизнес-центров в каталоге приходится на{' '}
                          {topDistrictsByCount
                            .map(([d, n]) => `${d} район (${n})`)
                            .join(', ')}
                          .{' '}
                        </>
                      )}
                      {Object.keys(classDistrictBreakdown).length > 0 && (
                        <>
                          По деловым классам распределение неравномерно:{' '}
                          {Object.entries(classDistrictBreakdown)
                            .map(([cls, district]) => `класс ${cls} чаще всего встречается в ${district} районе`)
                            .join(', ')}
                          . Как правило, здания более высокого класса тяготеют к центральным и
                          деловым районам города — там выше спрос со стороны крупных арендаторов и
                          проще с транспортной доступностью, а более простые по классу объекты
                          распределены по городу шире, в том числе в спальных и промышленных
                          районах.
                        </>
                      )}
                    </p>
                  </div>

                  {underConstructionNames.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-sm font-bold text-ink">Что сейчас строится</h3>
                      <p>
                        Сейчас в каталоге {underConstructionNames.length}{' '}
                        {underConstructionNames.length === 1 ? 'строящийся объект' : 'строящихся объекта'}:{' '}
                        {underConstructionNames.join(', ')}. Раздел обновляется по мере появления
                        новых данных о ходе строительства и сроках сдачи.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-bold text-ink">На что смотреть при выборе офиса</h3>
                    <p>
                      Кроме класса и площади, на комфорт работы в здании и итоговую стоимость
                      аренды влияет ряд менее очевидных параметров: транспортная доступность
                      (расстояние до метро и наличие парковки — как для сотрудников, так и для
                      посетителей), тип планировки (открытая планировка гибче под рост команды,
                      кабинетная — привычнее для части бизнесов), состав инфраструктуры в самом
                      здании и рядом с ним (кафе, банки, аптеки), качество управления зданием
                      (скорость реакции на заявки, чистота, охрана) и состав соседей — в одном
                      бизнес-центре с вами могут работать десятки других компаний, что важно и для
                      деловых контактов, и для общей атмосферы. Отдельно стоит уточнять условия
                      договора аренды: минимальный срок, порядок индексации ставки и то, что
                      входит в эксплуатационные платежи помимо самой аренды.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <h3 className="text-sm font-bold text-ink">Из чего складывается ставка аренды</h3>
                    <p>
                      Итоговая ставка за квадратный метр обычно состоит из нескольких компонентов:
                      базовой арендной платы (зависит в первую очередь от класса здания и
                      расположения), эксплуатационных платежей (обслуживание инженерных систем,
                      уборка, охрана общих зон — часто выставляются отдельной строкой), коммунальных
                      платежей по факту потребления и, при необходимости отделки помещения под
                      арендатора, отдельного бюджета на ремонт. Ставки в разных бизнес-центрах
                      одного класса могут заметно различаться в зависимости от расположения,
                      возраста здания и текущей заполняемости — актуальные предложения по
                      конкретным зданиям смотрите в карточках объектов, в разделе «Объявления с
                      Kufar и Realt».
                    </p>
                  </div>
                </div>
              </div>
            )}

            {faqItems.length > 0 && (
              <div className={cn('flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
