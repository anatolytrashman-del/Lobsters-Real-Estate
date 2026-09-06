import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BedDouble,
  Briefcase,
  Bus,
  Building2,
  Car,
  Check,
  ChevronDown,
  Cigarette,
  CircleHelp,
  CircleParking,
  Clock,
  Coffee,
  CreditCard,
  Dumbbell,
  ExternalLink,
  Flower2,
  Globe,
  Grid2x2,
  HardHat,
  Landmark,
  LayoutGrid,
  Layers,
  MapPin,
  Menu,
  Package,
  Phone,
  Pill,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Stethoscope,
  Store,
  TrainFront,
  TramFront,
  TrendingUp,
  TriangleAlert,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import { setGenericPageMeta, setArticleJsonLd, setFaqJsonLd, setBreadcrumbJsonLd } from '../lib/pageMeta';
import { HeroImageSlider } from '../components/objects/HeroImageSlider';
import { FaqAccordion } from '../components/ui/FaqAccordion';
import type { FaqItem } from '../components/ui/FaqAccordion';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { fetchPublicMarketOffers } from '../lib/marketOffersApi';
import { AREA_BUCKET_ORDER, areaBucket, MARKET_PROPERTY_TYPES, netSize, netPricePerSqm } from '../data/marketOffers';
import type { MarketOffer } from '../data/marketOffers';
import { fetchPrimaryMarketOffers } from '../lib/primaryMarketOffersApi';
import { buildPrimaryMarketPivot } from '../data/primaryMarketOffers';
import type { PrimaryMarketOffer } from '../data/primaryMarketOffers';
import { fetchTodayRateOrLatestCached } from '../lib/exchangeRatesApi';
import { convertToEur, convertFromEur } from '../lib/currencyConvert';
import { currencySymbols } from '../data/transactions';
import type { Currency } from '../data/transactions';
import type { ExchangeRate } from '../data/exchangeRates';
import { PrimaryMarketProModal } from '../components/district/PrimaryMarketProModal';
import { useInView } from '../lib/useInView';
// lazy() — обе карты тянут за собой отдельные снепшоты данных
// (data/districtPlaces.ts ~60 КБ у DistrictMap, data/districtBusinessCategories.ts
// 883 точки ~80 КБ у DistrictQuarterMap для индекса концентрации по нишам).
// Обычный статический импорт зашил бы этот вес в главный чанк лендинга для
// КАЖДОГО посетителя, даже если он не долистает до карт — тот же принцип, по
// которому в App.tsx лениво грузится вся админка (см. комментарий там).
// PAGESPEED_PLAN.md, Э2-3 — рендер обоих компонентов ниже (не только сам
// chunk-импорт) дополнительно гейтится useInView, см. quarterMapInView/
// districtMapInView.
const DistrictQuarterMap = lazy(() =>
  import('../components/district/DistrictQuarterMap').then((m) => ({ default: m.DistrictQuarterMap })),
);
const DistrictMap = lazy(() =>
  import('../components/district/DistrictMap').then((m) => ({ default: m.DistrictMap })),
);

// Переехала с /rayon-minsk-mir на /minsk/minsk-mir (см. CLAUDE.md, урл-
// структура /minsk/...) — старый адрес редиректит сюда (App.tsx).
const PAGE_URL = 'https://redevelopment.pro/minsk/minsk-mir';
// TITLE — для <title>/og/canonical, не трогаем: уже подобран под целевые
// запросы, длиннее рискует обрезаться в поисковой выдаче. PAGE_H1 — то, что
// реально видит посетитель на странице, может быть многословнее и точнее
// по позиционированию ("гайд и аналитика" — владелец так решил после того,
// как страница обросла блоками с реальными цифрами по каждой категории
// арендаторов, это уже не просто описание района).
const TITLE = 'Офисы и коммерческие помещения в районе Минск Мир';
const PAGE_H1 = 'Коммерческая недвижимость Минск Мира: гайд и аналитика';
const DESCRIPTION =
  'Коммерческая недвижимость в районе Минск Мир: готовая аудитория, транспорт, банки и МФЦ, медицина, форматы помещений под любой бизнес. Гид для арендаторов и собственников.';
const INTRO_TEXT = 'Экспертный разбор коммерческой недвижимости в Минск Мире для инвесторов, собственников и арендаторов.';
// Только для dateModified в Article JSON-LD ниже (не для видимого бейджа
// "Обновлено: ..." в hero — тот с 2026-09-03 считается отдельно от текущей
// даты, см. UPDATED_BADGE_LABEL). Обновлять вручную при каждом квартальном
// пересмотре текста (см. SEO_PLAN.md, Э3-1) И при крупных содержательных
// дополнениях страницы (как 2026-08-25: расширение FAQ до 28 вопросов,
// карта кварталов, тексты видов недвижимости) — это сигнал поисковику про
// реальные правки контента, не про то, что данные освежились сами.
const DATE_MODIFIED = '2026-09-03';
// Собственное превью для соцсетей/мессенджеров (og:image) — кадр из
// hero-фото района (public/images/district/og-minsk-mir.jpg, 1200×630 —
// рекомендованный Google/OG размер, полоса скайлайна из hero-2, апскейл
// LANCZOS с 512px исходника) вместо общей заглушки Red One, которая
// не имеет отношения к контентной странице района.
const OG_IMAGE = 'https://redevelopment.pro/images/district/og-minsk-mir.jpg';


// 6 аэрофото района от владельца (ссылки на ibb.co) — скачаны и
// самостоятельно захостены в public/images/district/ (тот же принцип,
// что и с логотипом метро — не зависеть от внешнего хостинга для
// критичной для LCP картинки). У всех фото водяной знак «@PROMIR_BY» —
// владелец подтвердил, что публикация с сохранённым водяным знаком
// нормальна (это открытая публикация автора, не тайком скопированная).
// HeroImageSlider — тот же компонент, что и слайдер рендеров на /one
// (components/objects/HeroImageSlider.tsx), просто переиспользован.
// PAGESPEED_PLAN.md, Э4-3 — переупакованы в WebP (q80), те же кадры/
// разрешение (512×640), −15…20% байт каждая. Оригинальные .jpg оставлены
// на диске (og:image и подобное используют отдельный файл, эти конкретные
// шесть больше нигде не подключены, но по WebP-водяному-знаку-и-т.п. риск
// был минимальный — на всякий случай не удалялись).
const HERO_IMAGES = [
  '/images/district/hero-1.webp',
  '/images/district/hero-2.webp',
  '/images/district/hero-3.webp',
  '/images/district/hero-4.webp',
  '/images/district/hero-5.webp',
  '/images/district/hero-6.webp',
];

// Источник фактов: Википедия, статья "Минск Мир" (ru.wikipedia.org,
// прислана владельцем 2026-08-22) + веб-поиск (Avia Mall, инфраструктура)
// + Wordstat-выгрузка владельца (спрос на коммерческую инфраструктуру,
// расклассифицирована и очищена от шума — см. журнал SEO_PLAN.md) +
// текст согласован с владельцем и написан через Gemini (см. журнал плана,
// интеграция ProxyAPI) по брифу, собранному на этих данных.

// Второй заход на структуру страницы (2026-08-22) — первая версия была
// нейтральным гидом "про район", вторая переосмыслена под аудиторию
// предпринимателей/собственников коммерции: не "район для жизни", а
// "готовая бизнес-среда". Сроки застройки (2015-2027) и историю сознательно
// убрали — фокус на настоящем, не на прошлом (решение владельца).
// Расширено с 4 до 8 карточек (владелец, август 2026: "Ключевые цифры" —
// отдельный блок с заголовком сразу после hero, перед "Застройщиком района").
// Новые 4 — частично на основе уже посчитанного в этой же сессии (плотность
// населения, см. `DISTRICT_DENSITY_PER_HECTARE`/`densityVsAvgRatioLabel`
// ниже — источник тот же, цитата из статьи Onliner), частично из уже
// собранной фактуры про застройщика (масштаб проекта, см. блок
// "Застройщик района" ниже — 320 га / ~30 тысяч квартир, t-s.by/naviny.by/
// Википедия). Значения — литералы, как и у исходных 4 плиток, не завязаны
// на переменные, объявленные ниже по файлу (statTiles используется раньше).
// Плитка "маршрутов" (2026-08-25, владелец: "инфа соответствует
// действительности? пересчитай с учётом маршруток") — пересчитана вручную
// от фактических списков ниже по файлу (busRoutes.length=14 +
// trolleyRoutes.length=8 + minibusRoutes.length=8 = 30); старое значение 14
// осталось от версии блока "Транспорт" ДО того, как владелец расширил
// списки автобусов/троллейбусов и добавил маршрутки. При правке списков
// транспорта — пересчитывать и эту плитку, и districtFaq ниже вручную,
// то же самое сознательное решение не завязывать литералы на переменные.
const statTiles: { icon: LucideIcon; value: string; label: string }[] = [
  { icon: Users, value: '~80 000', label: 'жителей района Минск Мир' },
  { icon: Building2, value: '427 чел/га', label: 'плотность населения — в 7,5 раза выше среднего по Минску' },
  { icon: Briefcase, value: '25–45', label: 'лет — ядро жителей района: семьи, IT-специалисты' },
  { icon: TrainFront, value: '2', label: 'станции метро на территории' },
  { icon: Bus, value: '30', label: 'маршрутов автобусов, троллейбусов и маршруток' },
  { icon: ShoppingBag, value: '138 200 м²', label: 'площадь Avia Mall — крупнейший ТЦ Минска' },
  { icon: Layers, value: '320 га', label: 'заявленный масштаб застройки района' },
  { icon: BedDouble, value: '~30 000', label: 'квартир по заявленному проекту застройки' },
];

// Блок застройщика — владелец знал имя (Dana Holdings), но не располагал
// фактурой, попросил найти самостоятельно. Собрано веб-поиском, каждый
// факт минимум из одного независимого источника (t-s.by, naviny.by,
// Википедия "Минск Мир"): международная группа компаний, головной офис в
// Швейцарии, работает в Беларуси с 2006 года; основатели — сербские
// братья Богoлюб и Драгомир Карич. Земля под Минск Мир (территория
// бывшего аэропорта Минск-1, 300+ га) получена указом Президента от
// 22.09.2014 без аукциона юрлицом ИООО «Дана Астра» — та самая компания,
// что и упомянута в контактах владельца. Заявленный масштаб проекта на
// момент старта — 320 га, ~30 тыс. квартир, ~$3,5 млрд инвестиций (это
// план 2014 года, не факт текущей стройки — фраза ниже это отражает).
// Другие проекты компании в Минске — Vogue, «Маяк Минска», ЖК «Рахманинов»,
// ЖК «Вивальди». Логотип прислан владельцем (ibb.co), скачан и обработан
// локально (Pillow: побелевший фон JPEG превращён в альфа-канал через
// классический трюк "alpha = 255 − min(R,G,B)" с де-премультипликацией
// цвета) — не смог найти логотип с уже прозрачным фоном официально,
// пришлось вырезать вручную, как и просил владелец.
// PAGESPEED_PLAN.md, Э4-1 — пересохранён в WebP под фактический размер
// показа (h-9 ≈ 36px, 2× под Retina — 420×126, было 585×176 PNG).
const DEVELOPER_LOGO_URL = '/images/district/dana-holdings-logo.webp';
// Тот же файл, что и MINSK_MIR_LOGO_URL в ObjectLandingPage.tsx (страница
// Red One) — владелец попросил показать его рядом с логотипом застройщика
// и тут же (см. комментарий там про перезаливку с ibb.co в собственное
// хранилище — сделано заодно с этой правкой). WebP 108×126 (Э4-1, как и у
// остальных логотипов этой страницы) — ObjectLandingPage.tsx использует тот
// же путь.
const MINSK_MIR_LOGO_URL = '/images/district/minsk-mir-logo.webp';
const DEVELOPER_LINKS = [
  { label: 'minskworld.by', url: 'https://minskworld.by' },
  { label: 'bir.by', url: 'https://bir.by' },
];
const DEVELOPER_CONTACTS = {
  phone: '7675',
  phoneHref: 'tel:7675',
  address: 'Отдел продаж: ул. П. Мстиславца, 9, «Дана Центр», 1 этаж',
  hours: 'Будни: 8:30–20:30. Выходные: 9:00–20:00',
};

// Управляющая компания района (эксплуатация, а не застройка — отдельная
// карточка от Dana Holdings выше). Факты и логотип — от владельца
// (логотип прислан готовым PNG с уже прозрачным фоном, ibb.co — не
// понадобилось вырезать фон вручную, как у остальных двух). Описание —
// текст от владельца, написанный через Gemini по переданному промту
// (см. журнал CLAUDE.md) — так же, как и остальные Gemini-тексты на
// этой странице, менять только по просьбе владельца. Второй телефон
// (115) — короткий номер, работает только с мобильных трёх операторов
// (владелец: "115 (A1, MTC, Life)"), это отражено в подписи, не в самом
// номере (tel:115 одинаково валиден для всех).
// PAGESPEED_PLAN.md, Э4-1 — WebP, 170×168 (было 200×198 PNG, отображается
// h-12 ≈ 48px, 2× под Retina).
const MANAGEMENT_COMPANY_LOGO_URL = '/images/district/happy-planet-logo.webp';
const MANAGEMENT_COMPANY_DESCRIPTION =
  'Управляющая компания «Happy Planet» отвечает за эксплуатацию и управление недвижимостью в районе «Минск Мир». Организация обслуживает сданные объекты Dana Holdings, а её бэк-офис для работы с собственниками и арендаторами находится в границах района.';
const MANAGEMENT_COMPANY = {
  name: 'Happy Planet',
  site: { label: 'dpm.by', url: 'https://dpm.by' },
  phones: [
    { label: '7560', href: 'tel:7560' },
    { label: '115 (A1, МТС, life:)', href: 'tel:115' },
  ],
  address: 'г. Минск, ул. Петра Мстиславца, 4, пом. 166',
  hours: 'Зависит от отдела, точное время — на сайте',
};

// Портрет аудитории и медицинская инфраструктура — текст от Gemini по брифу,
// собранному на реальных данных: возрастное ядро и «почти нет пенсионеров» —
// от владельца (личное знание района, как и с паркингами выше); аптеки —
// список из 22 точек, полученный от владельца через сохранённую HTML-страницу
// (webarchive) результатов поиска на Яндекс.Картах (спарсено вручную, у самого
// Яндекс.Карт нет доступного из этой среды способа сделать это автоматически —
// см. журнал SEO_PLAN.md); поликлиника/стоматологии/медцентр/ветклиника —
// веб-поиск, адреса перепроверены. Сеть InLek (5 из 22 точек) — тот самый
// нечитаемый бренд "In塗то" из исходного портрета арендаторов ниже, разгадан
// по совпадению с этим списком.
const audienceHighlights: { label: string; text: string }[] = [
  {
    label: 'Ядро аудитории — 25–45 лет.',
    text: 'Основные жители района: молодые семьи, IT-специалисты, предприниматели и квалифицированные специалисты. Доля людей пенсионного возраста стремится к нулю.',
  },
  {
    label: 'Активная модель потребления.',
    text: 'Жители ориентированы на комфорт, ценят время и тратят деньги внутри района: на готовое питание, сервисы у дома, здоровье, спорт и досуг.',
  },
  {
    label: 'Фокус на детскую и семейную инфраструктуру.',
    text: 'Высокая доля семей с детьми формирует постоянный коммерческий спрос на детские центры, профильные магазины, развивающие студии и семейные кафе.',
  },
];

// "Генераторы ежедневного трафика" (владелец, август 2026) — переписан после
// правки по факту: Avia Mall и Международный финансовый центр физически не
// готовы к работе (Avia Mall уже открыт, но ещё заселяется арендаторами;
// финцентр строится) — первая версия блока ошибочно подавала их как уже
// действующие точки притяжения. Текст — бриф владельца через Gemini (см.
// журнал SEO_PLAN.md), пункт про ТЦ/финцентр явно разделяет "уже" и "скоро".
const trafficHighlights: { label: string; text: string }[] = [
  {
    label: '~80 000 жителей района.',
    text: 'Минск Мир — огромный и плотно заселённый массив. Высотная застройка создаёт высокую концентрацию людей прямо внутри кварталов. Это готовые клиенты для бизнеса у дома.',
  },
  {
    label: 'Туристы и арендаторы.',
    text: 'Район популярен для краткосрочной аренды из-за свежих квартир и близости к центру. Сюда постоянно приезжают туристы и командированные, которые создают дополнительный спрос.',
  },
  {
    label: 'Гости со всего города.',
    text: 'Сюда регулярно приезжают жители других районов Минска — в гости к друзьям или в конкретные местные заведения, магазины и салоны.',
  },
  {
    label: 'Заселение ТЦ и запуск Финансового центра.',
    text: 'Avia Mall уже открыт, но ещё заселяется арендаторами, а Международный финансовый центр пока строится. Это станет дополнительной точкой притяжения и даст району ещё один буст.',
  },
];

// Плотность населения — отдельный блок ("population-density") прямо перед
// "Плотность бизнеса по нишам" (владелец: "пусть он будет отдельным, как
// раз перед блоком плотности бизнеса" — раньше жил внутри карточки
// "Генераторы трафика"). Первая версия (только норматив 290 vs 427) — цитата
// из статьи Onliner, прислана владельцем 2026-08-24 (доступ к самому домену
// realt.onliner.by из этой среды заблокирован прокси, не перепроверить
// самостоятельно): "по регламентам генплана высокоплотной многоквартирной
// застройкой в Минске считается застройка с... плотностью населения в
// пределах 231—290 человек на 1 гектар. В «Минск-Мире» же... плотность
// населения — 427 человек на гектар".
// Вдогонку владелец прислал ещё подборку цифр (AI-обзор с разномастными
// источниками, не прямая цитата одной статьи) — из неё сознательно НЕ взят
// повторный вариант норматива "60–76 человек/га", хотя он там тоже подписан
// как тот же регламент "Минскградо" с теми же 6000–7600 м²/га: это
// арифметически не бьётся с уже проверенной цитатой (231–290) при типичной
// жилой обеспеченности ~26–30 м² на человека — 6000/28≈214, 7600/28≈271,
// то есть верна цитата с 231–290, а "60–76" похоже на ошибку конкретно
// этого ответа. Взяты значения, которые не противоречат друг другу и
// заодно точнее ложатся в тезис "самая плотная застройка Минска" —
// среднегородская плотность (57 чел/га, сходится с независимым расчётом
// из Википедии о населении Минска, см. более ранний WebSearch этой сессии)
// и самые плотные существующие районы города, Фрунзенский и Московский
// (~100 чел/га, со ссылкой на Главное статистическое управление Минска).
// Усадебную/частную застройку владелец явно попросил не включать — тезис
// про многоквартирную плотность, а не про диапазон города целиком.
const DISTRICT_DENSITY_PER_HECTARE = 427;
const MINSK_HIGH_DENSITY_NORM_MAX = 290;
const MINSK_CITY_AVG_DENSITY = 57;
const MINSK_DENSEST_DISTRICTS_DENSITY = 100;

const densityComparisons: { label: string; value: number }[] = [
  { label: 'Минск, в среднем по городу', value: MINSK_CITY_AVG_DENSITY },
  { label: 'Фрунзенский и Московский районы (плотнее всех в городе)', value: MINSK_DENSEST_DISTRICTS_DENSITY },
  { label: 'Норматив «высокоплотная застройка» (максимум)', value: MINSK_HIGH_DENSITY_NORM_MAX },
  { label: 'Минск Мир', value: DISTRICT_DENSITY_PER_HECTARE },
];

const densityVsAvgRatioLabel = (DISTRICT_DENSITY_PER_HECTARE / MINSK_CITY_AVG_DENSITY).toFixed(1).replace('.', ',');
const densityRatioLabel = (DISTRICT_DENSITY_PER_HECTARE / MINSK_HIGH_DENSITY_NORM_MAX).toFixed(1).replace('.', ',');

const pharmacyTotal = 22;

const medicineHighlights: { label: string; text: string }[] = [
  {
    label: 'Государственный якорь.',
    text: '41-я городская поликлиника (ул. Кижеватова, 5а, открыта в январе 2026 года) обеспечивает первичную медицинскую помощь жителям и генерирует стабильный пешеходный трафик.',
  },
  {
    label: 'Высокая плотность фарм-ритейла.',
    text: `В районе работают ${pharmacyTotal} аптеки. Крупнейшая сеть — InLek (5 филиалов), что подтверждает высокий спрос на товары для здоровья в шаговой доступности.`,
  },
];

const medicinePrivateList: { label: string; text: string }[] = [
  {
    label: 'Стоматологии:',
    text: 'ConstantaClinic (просп. Мира, 1), Dentalove (ул. Аэродромная, 30), Healthy Smile (ул. Братская, 4)',
  },
  { label: 'Многопрофильные услуги:', text: 'медцентр «ИдеалМед» (ул. Аэродромная, 26)' },
  { label: 'Ветеринария:', text: 'ветклиника «Главное Хвост» (ул. Казинца, 46А)' },
];

// 2026-08-26 — обновлено по исчерпывающему поквартирному сбору
// (data/districtBusinessCategories.ts, 17 из 20 кварталов) вместо старого
// webarchive-поиска по одной категории "кафе" на весь район. Владелец
// попросил отдельным заходом обновить цифры этого блока новыми данными —
// заменены только категории, где новый сбор дал СТРОГО больше находок
// (кафе/рестораны/спорт/красота/ПВЗ/табак — новый метод ловит составные
// категории Яндекса, которые узкий поиск по одному слову пропускал).
// Аптеки/банки/СТО/цветы новыми цифрами НЕ заменены — там новый сбор
// (пока не все 20 кварталов) дал МЕНЬШЕ, чем старый прицельный поиск по
// всему району, — заменить значило бы понизить точность, не повысить.
const foodServiceTotal = 101;
const foodServiceBreakdown: { label: string; count: number }[] = [
  { label: 'Кафе / кофейни', count: 74 },
  { label: 'Бары', count: 16 },
  { label: 'Фастфуд', count: 15 },
  { label: 'Рестораны', count: 14 },
  { label: 'Кондитерские', count: 8 },
  { label: 'Пекарни', count: 7 },
  { label: 'Пиццерии', count: 3 },
];

const sportTotal = 13;
const sportBreakdown: { label: string; count: number }[] = [
  { label: 'Йога / пилатес / стретчинг', count: 9 },
  { label: 'Тренажёрные залы / фитнес-клубы', count: 6 },
];

// Банки/банкоматы — первый заход (поиск "банкоматы" одним запросом) не
// разделял отделения и банкоматы — категория в выдаче была пустой у
// большинства точек. Владелец обратил внимание, что не понятно, где что,
// и подсказал, что в районе точно есть БНБ-Банк — его не было в первом
// списке. Пересобрано двумя отдельными запросами ("банкоматы" отдельно,
// "отделения банков" отдельно, категория "Банк" у второго подтверждена) —
// 22+11 строк → 30 уникальных точек, 13 разных банков (БНБ-Банк
// оказался в выдаче под полным юрлицом "Белорусский народный банк" — та
// самая пропущенная сеть, отделение и банкомат в Avia Mall). "Три цены"
// (не банк, магазин) попал в выдачу по отделениям как шум — исключён.
// 2026-08-26: сверено с исчерпывающим поквартирным сбором (17 из 20
// кварталов) — там банков нашлось меньше (8 названий, 9 точек), а
// отделение от банкомата не разделить вовсе (Яндекс у большинства точек
// просто пишет категорию "Банк"). Прицельный поиск по всему району
// оказался точнее для этой категории — цифры НЕ заменены.
const bankPointsTotal = 30;
const bankNamesCount = 13;
const bankBranchCount = 9;
const bankMatrix: { label: string; hasBranch: boolean; hasAtm: boolean }[] = [
  { label: 'Paritetbank', hasBranch: true, hasAtm: true },
  { label: 'БНБ-Банк', hasBranch: true, hasAtm: true },
  { label: 'Банк ВТБ', hasBranch: true, hasAtm: true },
  { label: 'БелВЭБ', hasBranch: true, hasAtm: true },
  { label: 'Белагропромбанк', hasBranch: true, hasAtm: true },
  { label: 'Беларусбанк', hasBranch: true, hasAtm: true },
  { label: 'Белгазпромбанк', hasBranch: true, hasAtm: true },
  { label: 'МТБанк', hasBranch: true, hasAtm: true },
  { label: 'Приорбанк', hasBranch: true, hasAtm: true },
  { label: 'Альфа-Банк', hasBranch: false, hasAtm: true },
  { label: 'Банк РРБ', hasBranch: false, hasAtm: true },
  { label: 'Белинвестбанк', hasBranch: false, hasAtm: true },
  { label: 'Сбер Банк', hasBranch: false, hasAtm: true },
];

// СТО/автосервисы — webarchive, поиск "автосервис", 67 строк → 64
// уникальных точки. В отличие от прошлых категорий, здесь важен не общий
// счёт, а география: внутри жилых кварталов Минск Мира профильных точек
// почти нет, зато рядом (ул. Казинца, Брестская, Бородинская, Брилевский
// тупик) — плотный автосервисный кластер: 42 из 64 точек, больше 2/3
// выдачи. Ровно то, что и предполагал владелец — подтверждено данными,
// не просто общее наблюдение.
// 2026-08-25: 6 точек убраны как ошибочно попавшие за пределы района
// (высокие номера дома на Аэродромной, улицы Левкова/Володько/Вирская —
// см. districtPlaces.ts) — было 64. Кластер на Казинца/Брестской/
// Бородинской/Брилевском тупике не затронут, он остаётся кластером.
// 2026-08-26: не сверялось с исчерпывающим поквартирным сбором — тот
// собирается по домам ВНУТРИ района, а весь смысл этой карточки в
// кластере ЗА его пределами (см. выше), сравнивать между собой нечего.
const autoServiceTotal = 58;
const autoServiceClusterCount = 42;
const autoServiceClusterStreets = 'Казинца, Брестской, Бородинской и Брилевском тупике';

// Салоны красоты — webarchive, поиск "салоны красоты", 91 строка → 88
// уникальных мест. Один из самых насыщенных сегментов района — логично
// для портрета аудитории (бьюти-сфера уже отдельная категория в
// tenantProfiles ниже). Показаны только специализации с заметным числом
// точек, у остальных (пирсинг, шугаринг и т.п.) по 1-2 точки — не
// перегружаем блок длинным хвостом.
// 2026-08-25: 14 точек убраны как ошибочно попавшие за пределы района
// (Аэродромная 119, кластер на Левкова/Володько, Брестская — см.
// districtPlaces.ts) — было 88. Брилевская (Семь Образов) изначально тоже
// убиралась, но это ошибка (см. "ИСПРАВЛЕНА ошибка" в districtPlaces.ts) —
// восстановлена, поэтому не 73, а 74.
// 2026-08-26: обновлено исчерпывающим поквартирным сбором (17 из 20
// кварталов, data/districtBusinessCategories.ts) — нашёл заметно больше
// (74 → 123), в т.ч. составные категории вроде "Барбершоп, парикмахерская",
// которые узкий поиск "салоны красоты" не всегда ловил. Лидерство сменилось:
// парикмахерские и барбершопы теперь наравне впереди, ногтевые студии — на
// третьем месте (было наоборот).
const beautyTotal = 123;
const beautyBreakdown: { label: string; count: number }[] = [
  { label: 'Парикмахерские', count: 24 },
  { label: 'Барбершопы', count: 24 },
  { label: 'Ногтевые студии', count: 19 },
  { label: 'Косметология', count: 17 },
  { label: 'Брови и ресницы', count: 10 },
  { label: 'Стилисты', count: 5 },
];

// Магазины продуктов — webarchive, поиск "магазин продуктов", 44 строки,
// все уникальны (категории у выдачи почти всегда пустые — считаем по
// названиям). Отдельно посчитаны специализированные лавки (мясные/
// овощные/фермерские — по ключевым словам в названии), не только сети.
// 2026-08-25: 5 точек убраны как ошибочно попавшие за пределы района
// (Аэродромная 125, ул. Чкалова, Брестская, Кижеватова 32 — см.
// districtPlaces.ts) — было 44. Брилевская (Знічка) изначально тоже
// убиралась, но это ошибка (см. "ИСПРАВЛЕНА ошибка" в districtPlaces.ts) —
// восстановлена, поэтому не 38, а 39.
// 2026-08-26: обновлено исчерпывающим поквартирным сбором (17 из 20
// кварталов) — 39 → 40, но состав по сетям заметно другой: "Семь Пятниц"
// оказалась крупнейшей сетью района (её не было в старом списке вовсе),
// "Соседи Экспресс" — заметно меньше, чем казалось раньше (было 3, по
// новым данным 1). Не сетевые точки с общими названиями вроде "Продукты"
// в разбивку не выносим, только узнаваемые сети и специализированные лавки.
const groceryTotal = 40;
const groceryBreakdown: { label: string; count: number }[] = [
  { label: 'Семь Пятниц', count: 7 },
  { label: 'Копеечка', count: 6 },
  { label: 'Остров', count: 3 },
  { label: 'Евроопт Market', count: 2 },
  { label: 'Знічка', count: 2 },
  { label: 'Специализированные (мясо, фермерское, кулинария)', count: 7 },
];
const groceryMax = Math.max(...groceryBreakdown.map((b) => b.count));

// ПВЗ — webarchive, поиск "пункт выдачи заказов", 46 строк, но владелец
// попросил учитывать только Ozon и Wildberries — в выдачу попали лишние
// организации (Emall.by, Lamoda и другие агрегаторы/магазины с похожей
// категорией, не относящиеся к запросу).
// 2026-08-25: Ozon/Wildberries на Брилевская, 27/31 сначала убирались как
// ошибочно попавшие за пределы района, но это была ошибка (см.
// "ИСПРАВЛЕНА ошибка" в districtPlaces.ts) — восстановлены.
// 2026-08-26: обновлено исчерпывающим поквартирным сбором (17 из 20
// кварталов) — нашлось заметно больше обеих сетей (Ozon 11→22, Wildberries
// 20→34), логично: ПВЗ маркетплейсов часто прячутся внутри других
// магазинов/помещений без отдельной вывески, узкий поиск по категории их
// пропускал чаще, чем поиск по каждому дому напрямую.
const pvzOzonCount = 22;
const pvzWildberriesCount = 34;
const pvzTotal = pvzOzonCount + pvzWildberriesCount;

// Цветочные магазины — webarchive, поиск "цветы", 36 строк, все уникальны.
// 2026-08-25: куст на Брилевская ул. сначала убирался целиком как
// ошибочно попавший за пределы района, но это была ошибка (см.
// "ИСПРАВЛЕНА ошибка" в districtPlaces.ts) — восстановлен, было и снова
// осталось 36.
// 2026-08-26: сверено с исчерпывающим поквартирным сбором (17 из 20
// кварталов) — там 34, чуть меньше старых 36 (объяснимо неполным
// покрытием кварталов, не ошибкой) — цифры НЕ заменены.
const flowerTotal = 36;
const flowerDeliveryCount = 7;

// Табак и вейп-шопы — владелец объединил два отдельных поиска ("табак" и
// "вейп-шоп") в одну категорию и попросил убрать дубли, которые попали в
// обе выдачи (совпадающие по названию+адресу точки — Puff-Lab, ЗаПар,
// Liberty Vape, Изишоп, NovaSens, Vape Lounge, Вейп шоп). 18 + 15 строк →
// 22 уникальные точки.
// 2026-08-26: сверено с исчерпывающим поквартирным сбором (17 из 20
// кварталов) — почти точное совпадение (вейп-шопы — те же 15, табачные —
// 8 вместо 7), обновлено на более свежие цифры.
const tobaccoVapeTotal = 23;
const tobaccoVapeBreakdown: { label: string; count: number }[] = [
  { label: 'Вейп-шопы', count: 15 },
  { label: 'Табачные магазины', count: 8 },
];
const tobaccoVapeMax = Math.max(...tobaccoVapeBreakdown.map((b) => b.count));

// Тепловая карта плотности бизнеса — синтез всех собранных выше чисел по
// категориям, предложено владельцем. Методика (согласована с владельцем
// до вёрстки): считаем только категории, где точки физически внутри
// района (СТО не входит — у него принципиально другая суть, "почти нет
// здесь, зато плотно рядом", свой блок с контрастом уже есть). Три уровня
// по абсолютному числу точек (не проценты, не на душу населения — нет
// достоверной цифры населения района, см. audienceHighlights); границы
// круглые, не строгие терцили, чтобы не резать по живому при близких
// значениях: высокая ≥40, средняя 20–39, низкая <20 (аптеки на 22 и
// табак/вейп на 23 — рядом, оба попадают в среднюю группу).
//
// Цвета прошли три захода: (1) один оттенок красного (ordinal-рамп) —
// владелец: сплошной красный читается как "тревога" везде; (2) статусная
// триада проекта (--color-success/warning/danger из index.css) —
// владелец одобрил зелёный→жёлтый→красный по смыслу, но захотел более
// яркую/насыщенную версию тех же трёх цветов; (3) те же три цвета
// пересчитаны через HSL (насыщенность +25, светлота −8 от пастельного
// черновика, который отдельно показывался на согласование через
// Artifact) — финальная версия. Не токены проекта, отдельные hex, т.к.
// готовая триада success/warning/danger не подошла по яркости, а более
// яркого варианта в дизайн-системе нет. Текст на плитках — везде тёмный
// ink (contrast() из validate_palette.js даёт 7.4–12.9:1 на все три
// цвета, белый текст здесь не нужен).
type DensityTier = 'low' | 'medium' | 'high';

const DENSITY_TIER_STYLE: Record<DensityTier, { bg: string; text: string }> = {
  low: { bg: '#92e7aa', text: '#14151a' },
  medium: { bg: '#fbd47a', text: '#14151a' },
  high: { bg: '#f1887c', text: '#14151a' },
};

const DENSITY_TIER_LABEL: Record<DensityTier, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
};

function densityTier(count: number): DensityTier {
  if (count >= 40) return 'high';
  if (count >= 20) return 'medium';
  return 'low';
}

const densityData: { icon: LucideIcon; label: string; count: number }[] = [
  { icon: Scissors, label: 'Салоны красоты', count: beautyTotal },
  { icon: Coffee, label: 'Общепит', count: foodServiceTotal },
  { icon: ShoppingBasket, label: 'Продукты', count: groceryTotal },
  { icon: Flower2, label: 'Цветы', count: flowerTotal },
  { icon: Package, label: 'ПВЗ', count: pvzTotal },
  { icon: Pill, label: 'Аптеки', count: pharmacyTotal },
  { icon: Cigarette, label: 'Табак / вейп', count: tobaccoVapeTotal },
  { icon: CreditCard, label: 'Банки', count: bankPointsTotal },
  { icon: Dumbbell, label: 'Спорт и фитнес', count: sportTotal },
];

// Строка не показывается, если для текущего типа сделки по ней нет ни
// одного предложения. Сам порядок — MARKET_PROPERTY_TYPES (data/marketOffers.ts),
// общий со страницей верификации /admin/market-offers.
const MARKET_PROPERTY_TYPE_ORDER = MARKET_PROPERTY_TYPES;

interface MarketPivotCell {
  count: number;
  medianPrice: number;
}

interface MarketPivotRow {
  propertyType: string;
  cells: (MarketPivotCell | null)[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Цена помещений с отделкой и без — это принципиально разные рынки (голый
// бетон стоит заметно дешевле готового к въезду), поэтому таблица не
// схлопывает finish_status в общую цифру, а показывает выбранный статус
// отдельно (переключатель ниже). Медиана считается прямо здесь из сырых
// объявлений — не из чужого предпосчитанного агрегата — поэтому правки
// владельца на /admin/market-offers сразу видны и тут.
//
// В таблицу попадают только reviewed=true объявления — сырые данные с
// Kufar/Realt часто путают отделку/тип/площадь (см. комментарии в
// scripts/sync-*-market-offers.mjs), непроверенная строка может исказить
// публичную статистику неправильной ценой. Как только Светлана
// верифицирует объявление на /admin/market-offers, оно на этой же
// перезагрузке страницы появится в сводке — без отдельного шага "включить
// в статистику".
function buildMarketPivot(offers: MarketOffer[], dealType: 'sale' | 'rent', finishStatus: string): MarketPivotRow[] {
  const byType = new Map<string, Map<string, number[]>>();

  for (const offer of offers) {
    if (!offer.reviewed || offer.rejected || offer.dealType !== dealType || offer.finishStatus !== finishStatus) continue;
    if (!byType.has(offer.propertyType)) byType.set(offer.propertyType, new Map());
    const byBucket = byType.get(offer.propertyType)!;
    const bucket = areaBucket(netSize(offer));
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(netPricePerSqm(offer));
  }

  return MARKET_PROPERTY_TYPE_ORDER.filter((type) => byType.has(type)).map((propertyType) => {
    const byBucket = byType.get(propertyType)!;
    const cells = AREA_BUCKET_ORDER.map((bucket) => {
      const prices = byBucket.get(bucket);
      return prices ? { count: prices.length, medianPrice: Math.round(median(prices)) } : null;
    });
    return { propertyType, cells };
  });
}

function countSmallFinishedOffices(offers: MarketOffer[], dealType: 'sale' | 'rent'): number {
  return offers.filter(
    (o) =>
      o.reviewed && !o.rejected && o.dealType === dealType && o.propertyType === 'Офисы' && netSize(o) < 40 && o.finishStatus === 'с отделкой',
  ).length;
}


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

// Видимый бейдж свежести в hero — владелец, 2026-09-03: "сам тег на
// лендинге просто автоматически обновляется каждый месяц на свежий".
// Сознательно НЕ завязан на DATE_MODIFIED (та константа — про реальные
// правки текста страницы, см. комментарий над ней, и уходит в dateModified
// Article JSON-LD, который не должен врать поисковику "обновлено", когда
// контент не менялся). Бейдж — про другое: честная свежесть ДАННЫХ (рынок/
// организации по домам), которые реально обновляются ежемесячно
// автоматическими синками (см. .github/workflows/sync-*-stats.yml,
// sync-district-business-points.yml) + ручной разбор Светланой (см.
// .github/workflows/monthly-svetlana-tasks.yml, 25 число) — поэтому текущий
// месяц в бейдже не фейковый сигнал, а действительно то, когда данные в
// последний раз актуализировались.
const UPDATED_BADGE_LABEL = (() => {
  const now = new Date();
  return `Обновлено: ${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
})();

function formatLatestUpdate(offers: MarketOffer[]): string {
  const latest = offers.reduce((max, o) => (o.updatedAt > max ? o.updatedAt : max), offers[0].updatedAt);
  const date = new Date(latest);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// "Не указано" убрано из переключателя (владелец, 2026-08-25: "убирай
// категорию 'Не указано', у меня всё будет указано") — предполагается,
// что владелец сам доведёт finish_status до одного из двух реальных
// значений у всех объявлений на /admin/market-offers. Если у объявления
// в базе останется что-то третье (пустое/старое "не указано") — оно
// просто не попадёт ни в одну из двух колонок ниже (buildMarketPivot
// фильтрует по точному совпадению marketFinish), не будет отображаться
// как ошибка, а тихо выпадет из сводки, пока владелец его не поправит.
const MARKET_FINISH_OPTIONS = ['С отделкой', 'Без отделки'] as const;

// Порядок валют в переключателях "Первичный"/"Вторичный рынок" — EUR
// по умолчанию первой (владелец), не общий порядок currencies из
// data/transactions.ts (там RUB первым, для админской формы транзакций).
const CURRENCY_OPTIONS: Currency[] = ['BYN', 'EUR', 'USD', 'RUB'];

// Было 4 кнопки в ряд (EUR/USD/BYN/RUB) — при длинном заголовке блока
// переставало помещаться в одну строку (владелец, скриншот). Переделано в
// выпадашку: видна только текущая валюта + стрелка, остальные — по клику
// (клик вне закрывает — тот же приём, что и у mobileNavOpen ниже).
// БЕЛ по умолчанию — не эстетика, а требование владельца ("так по
// закону"): цены на публичной странице должны показываться в белорусских
// рублях, остальные валюты — опция для удобства, не основной вид.
function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (currency: Currency) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-border bg-surface-muted px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-border"
      >
        {value}
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 pt-2">
          <div className="flex w-24 flex-col gap-0.5 rounded-control border border-border bg-surface p-1.5 shadow-card">
            {CURRENCY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={cn(
                  'rounded-control px-3 py-1.5 text-left text-xs font-semibold transition-colors',
                  value === option ? 'bg-surface-muted text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Сумма уже приведена к EUR (см. комментарий у exchangeRate в компоненте) —
// тут только перевод в валюту отображения и форматирование. rate===null
// (курс ещё грузится или bnb.by недоступен) — не считаем это нулём, просто
// "—", тот же принцип, что и у convertToUsd в lib/currencyConvert.ts.
function formatPricePerM2(amountEur: number, currency: Currency, rate: ExchangeRate | null): string {
  const converted = convertFromEur(amountEur, currency, rate);
  if (converted == null) return '—';
  return `${Math.round(converted).toLocaleString('ru-RU')} ${currencySymbols[currency]}`;
}

// Вторичный рынок (Kufar) хранит цену в USD — переводим в EUR тем же
// курсом, что и первичный рынок (владелец: "давай всё сводить к евро"),
// и уже от EUR идём в выбранную валюту через formatPricePerM2 выше — один
// и тот же путь конвертации для обоих блоков.
function formatMedianPriceLabel(amountUsd: number, currency: Currency, rate: ExchangeRate | null, isRent: boolean): string {
  const amountEur = convertToEur(amountUsd, 'USD', rate);
  if (amountEur == null) return '—';
  return `${formatPricePerM2(amountEur, currency, rate)}/м²${isRent ? '/мес' : ''}`;
}
const MARKET_FINISH_TO_DB: Record<(typeof MARKET_FINISH_OPTIONS)[number], string> = {
  'С отделкой': 'с отделкой',
  'Без отделки': 'без отделки',
};

const metroStations = ['Ковальская Слобода', 'Аэродромная'];
// Автобусы/троллейбусы — список дополнен владельцем 2026-08-24 (озвучил
// новые номера, часть повторяла уже внесённые — объединено с прежним
// списком через Set, отсортировано по возрастанию номера; суффиксы вроде
// "47с" сортируются по ведущему числу). Маршрутки и электричка (новые
// категории) — тоже от владельца, тем же заходом.
const busRoutes = ['4', '40', '47с', '53', '56', '65', '73', '84', '93', '100', '102', '107', '124', '172'];
const trolleyRoutes = ['6', '19', '20', '24', '27', '59', '82', '124'];
const minibusRoutes = ['1056ТК', '1064ТК', '1076ТК', '1146ТК', '1211ТК', '1212ТК', '1346ТК', '1547ТК'];

// Рынок машиномест — владелец рассказал про два ценовых сегмента ("дешёвые
// в районе 6-9 тысяч евро — крытые паркинги, дорогие — подземные внутри
// домов"), точные цифры собраны прямым парсингом bir.by (2026-08-24):
// AJAX-эндпоинт страницы поиска (POST bir.by/ajax/get-search-objects-car/,
// найден в инлайновом <script> на самой странице) отдаёт все объявления
// одним запросом вместо ручного пролистывания по 15 — снят полный срез
// объявлений на продажу машиномест в Минск Мире, 2769 позиций. Разбиение
// на два кластера — не произвольное, а по факту данных: цены группируются
// строго до 9900 € и от 13000 € без единого объявления между ними, то есть
// граница видна в самих данных, не выдумана.
// Цены из этого блока убраны (владелец: "будут в другом блоке") — остались
// только количество мест/паркингов/домов и площадь.
// Количество паркингов/домов — из уникальных названий "Паркинг X.Y" в
// данных: у крытых "13.1 1с"/"13.1 2с" — два подъезда ОДНОГО здания (общий
// адрес ул. Л. Щемелёва, 11 в сырых данных), считаются одним паркингом →
// 3 паркинга (1.6, 13.1, 21.1). У подземных таких сдвоенных кодов нет —
// 11 разных кодов = 11 домов; адрес известен только для 4 из них
// (16.38/16.39/28.4/28.8, все — разные улицы, что и подтверждает: это
// разные дома, не секции одного) — для остальных 7 (11.1–11.5, 24.2.6,
// 24.2.7) bir.by не публикует адрес нигде, даже на карточке объекта.
// Сырые данные (2769 строк CSV) отправлены владельцу отдельно, в
// репозитории не хранятся — здесь только агрегаты и список названий/
// адресов паркингов для спойлера.
const parkingSegments: {
  icon: LucideIcon;
  title: string;
  count: string;
  buildingsLabel: string;
  areaRange: string;
}[] = [
  {
    icon: Car,
    title: 'Крытые наземные паркинги',
    count: '1 658',
    buildingsLabel: '3 паркинга',
    areaRange: '12,3–19,6 м²',
  },
  {
    icon: CircleParking,
    title: 'Подземные паркинги в домах',
    count: '1 111',
    buildingsLabel: '11 домов',
    areaRange: '12,0–17,6 м²',
  },
];

const parkingAddresses: { category: string; house: string; address: string | null }[] = [
  { category: 'Крытые', house: 'Паркинг 1.6', address: 'ул. Германовская, 7' },
  { category: 'Крытые', house: 'Паркинг 13.1', address: 'ул. Леонида Щемелёва, 11' },
  { category: 'Крытые', house: 'Паркинг 21.1', address: null },
  { category: 'Подземные', house: 'Паркинг 11.1', address: null },
  { category: 'Подземные', house: 'Паркинг 11.2', address: null },
  { category: 'Подземные', house: 'Паркинг 11.3', address: null },
  { category: 'Подземные', house: 'Паркинг 11.4', address: null },
  { category: 'Подземные', house: 'Паркинг 11.5', address: null },
  { category: 'Подземные', house: 'Паркинг 16.38', address: 'ул. Жореса Алфёрова, 22' },
  { category: 'Подземные', house: 'Паркинг 16.39', address: 'ул. Михаила Савицкого, 24' },
  { category: 'Подземные', house: 'Паркинг 24.2.6', address: null },
  { category: 'Подземные', house: 'Паркинг 24.2.7', address: null },
  { category: 'Подземные', house: 'Паркинг 28.4', address: 'ул. Михаила Савицкого, 23' },
  { category: 'Подземные', house: 'Паркинг 28.8', address: 'ул. Игоря Лученка, 16' },
];

// "Виды коммерческой недвижимости в Минск Мире" (владелец, август 2026) —
// список типов задан явно, тексты написаны мной по брифу владельца (тот же
// принцип "черновик от меня → правки владельца", что и у остальных
// "Gemini"-текстов на этой странице — застройщик, УК). Цифры по
// машиноместам не трогать, они проверены (см. секцию "Паркинги" ниже,
// id="parking", подробный источник — bir.by, 2769 объявлений).
// Отдельно от MARKET_PROPERTY_TYPES (data/marketOffers.ts, Офисы/Торговые
// помещения/Кладовые) — та тройка про сырые объявления с Kufar/Realt для
// сводной таблицы цен, здесь же более широкий описательный список,
// включающий форматы, которых в парсинге нет вовсе (бизнес-апартаменты,
// машиноместа, площади в Avia Mall и МФЦ).
//
// 2026-08-26 (третий заход по этому блоку) — владелец увидел вживую сетку
// 2×4 одинаковых бордеровых карточек: "он огромный, там много всего надо
// читать, может вообще его убрать?". Сравнил с отдельным блоком "Бизнес-
// апартаменты" ниже по странице ("когда выделены в отдельный блок,
// воспринимаются намного легче, чем когда они как карточка") и предложил
// сделать этот раздел похожим на уже существующий "Аналитика по сферам
// бизнеса" (тот же файл, id="business-analytics") — общий glassCard +
// `divide-y divide-border` вместо сетки отдельных бордеровых карточек,
// но с переменной "шириной" пункта: "бизнес-апартаменты заслуживают много
// текста, а парковкам столько не нужно, можно уместить два блока в одной
// строке — плиточная вёрстка". Реализовано именно так — см. рендер ниже:
// раздел "Бизнес-апартаменты" (раньше отдельная секция id="business-
// apartments" со своим пунктом в SECTION_NAV) СЛИТ сюда как одна из строк
// (полноширинная, с полным блоком плюсов/минусов) — до этого он и так
// был искусственно разделён на короткий тизер-карточку здесь + отдельный
// H2-раздел ниже, что и создавало ощущение "то мелкая карточка, то что-то
// подробное отдельно". id="business-apartments" сохранён на самой строке
// (не привязан к SECTION_NAV) — на случай внешних ссылок на этот якорь.
// Машиноместа (2 вида) и Avia Mall/МФЦ (2 крупных объекта) — тематически
// парные и по объёму короткие, сведены в строки по 2 колонки; Торговые/
// Офисные/Кладовые — полноширинные строки, текста на них хватает под всю
// ширину без пустот.
interface DistrictPropertyType {
  icon: LucideIcon;
  title: string;
  // ReactNode, не string — карточке "Офисные помещения" нужна внутренняя
  // ссылка на /minsk/one прямо в тексте (аудит 2026-08-26: упоминание
  // "деловой центр Red One" было голым текстом — упущенный внутренний линк
  // из самого релевантного контекста страницы).
  description: ReactNode;
}

// Общий рендер строки "иконка + h3 + текст" — используется и для
// полноширинных, и для парных (двухколоночных) видов недвижимости; сама
// разбивка на full/paired строки — в JSX ниже, не в этом массиве (вёрстка
// намеренно неоднородная, "плиточная", а не единый .map() по сетке).
function PropertyType({ icon: Icon, title, description }: DistrictPropertyType) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 shrink-0 text-ink" />
        <h3 className="text-base font-bold text-ink">{title}</h3>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
    </div>
  );
}

const PROPERTY_TYPE_TRADE: DistrictPropertyType = {
  icon: Store,
  title: 'Торговые помещения',
  description:
    'Помещения на первых этажах жилых домов и в стрит-ритейле района — с отдельным входом и витриной на пешеходный поток. Именно они сейчас заняты магазинами, аптеками, салонами красоты и общепитом, которые формируют плотную коммерческую инфраструктуру Минск Мира.',
};

const PROPERTY_TYPE_OFFICE: DistrictPropertyType = {
  icon: Briefcase,
  title: 'Офисные помещения',
  description: (
    <>
      Классические офисные площади под кабинеты, представительства и небольшие команды. В районе особенно не
      хватает готовых компактных офисов с отделкой — этот дефицит закрывает{' '}
      <Link to="/minsk/one" className="font-semibold text-primary hover:underline">
        деловой центр Red One
      </Link>{' '}
      по соседству.
    </>
  ),
};

const PROPERTY_TYPE_STORAGE: DistrictPropertyType = {
  icon: Archive,
  title: 'Кладовые',
  description:
    'Отдельные складские помещения при жилых домах — под хранение личных вещей или небольшой товарный запас для локального бизнеса: интернет-магазина, мастерской, пункта выдачи заказов.',
};

const PROPERTY_TYPE_PARKING_COVERED: DistrictPropertyType = {
  icon: Car,
  title: 'Машиноместа на паркингах',
  description: 'Крытые наземные паркинги — 3 паркинга, 1 658 мест в продаже. Самый доступный формат, 60% предложения.',
};

const PROPERTY_TYPE_PARKING_UNDERGROUND: DistrictPropertyType = {
  icon: CircleParking,
  title: 'Подземные машиноместа',
  description: 'Внутри 11 жилых домов — 1 111 мест в продаже, 40% предложения. Дороже наземных за счёт расположения.',
};

const PROPERTY_TYPE_AVIA_MALL: DistrictPropertyType = {
  icon: ShoppingBag,
  title: 'Помещения в ТЦ Avia Mall',
  description:
    'Торговые площади в крупнейшем торговом центре Минска (138 200 м²) — Avia Mall уже открыт и работает, но продолжает заселяться арендаторами, часть площадей ещё доступна.',
};

const PROPERTY_TYPE_MFC: DistrictPropertyType = {
  icon: Landmark,
  title: 'Офисы в Минском международном финансовом центре',
  description:
    'Будущие офисные площади в Международном финансовом центре — сам центр пока строится и не введён в эксплуатацию, но после запуска станет ещё одной точкой притяжения бизнеса в районе.',
};

// FAQ — расширен владельцем (2026-08-25) в полноценный сеошный блок,
// закрывающий вопросы по каждой секции страницы (см. SECTION_NAV) —
// владелец сознательно снял ограничение по объёму ("не ограничивать
// себя, писать полноценный сеошный текст под все возможные вопросы"),
// цель блока — не читатель, а поисковые алгоритмы и структурированные
// данные (см. setFaqJsonLd ниже). Каждый факт в ответах — не выдумка, а
// то, что уже подтверждено и живёт выше по файлу (statTiles,
// audienceHighlights, medicineHighlights, foodServiceBreakdown и т.д.) —
// FAQ не вводит новых цифр, только пересобирает уже проверенные в формат
// вопрос-ответ. Темы "согласование вывесок" и "готовность объектов"
// по-прежнему исключены — по ним нет проверенных фактов. Живые/меняющиеся
// цифры (медианные цены рынка, число офисов до 40 м² в дефиците и т.п.)
// в ответах сознательно не дублируются как точные значения — они уже
// есть в соответствующих таблицах выше и обновляются отдельно от этого
// статического блока, чтобы FAQ не расходился с реальными данными при
// следующем синке.
const districtFaq: FaqItem[] = [
  {
    question: 'Что такое район Минск Мир и чем он интересен для бизнеса?',
    answer:
      'Минск Мир — крупнейший девелоперский проект Минска, построенный на месте бывшего аэропорта Минск-1: заявленный масштаб застройки — 320 га и порядка 30 тысяч квартир. Для бизнеса это не спальный район в чистом виде, а плотная городская среда с почти 80 тысячами жителей, двумя станциями метро, крупнейшим торговым центром Минска Avia Mall и растущим числом коммерческих форматов — от кабинетов и офисов до торговых помещений и кладовых. Высокая плотность населения и молодая платёжеспособная аудитория делают район одной из самых быстрорастущих точек коммерческого спроса в городе.',
  },
  {
    question: 'Кто застройщик Минск Мира?',
    answer:
      'Застройщик — Dana Holdings, международная группа компаний со штаб-квартирой в Швейцарии, работающая на белорусском рынке с 2006 года. Земля под проект (территория бывшего аэропорта Минск-1) получена указом Президента от 22 сентября 2014 года, юридическое лицо — ИООО «Дана Астра». Помимо Минск Мира, у Dana Holdings в Минске ещё несколько проектов: жилой комплекс «Маяк Минска», Vogue, ЖК «Рахманинов» и ЖК «Вивальди». Отдел продаж застройщика находится по адресу ул. П. Мстиславца, 9, «Дана Центр».',
  },
  {
    question: 'Кто отвечает за эксплуатацию района — какая управляющая компания?',
    answer:
      'Эксплуатацией и управлением недвижимостью в Минск Мире занимается управляющая компания «Happy Planet» (сайт dpm.by) — отдельная организация от застройщика Dana Holdings, обслуживающая уже сданные объекты. Бэк-офис компании для работы с собственниками и арендаторами находится прямо в границах района, по адресу ул. Петра Мстиславца, 4, пом. 166.',
  },
  {
    question: 'Как добраться до коммерческих объектов на общественном транспорте?',
    answer:
      'На территории района — две станции метро Зеленолужской линии, «Ковальская Слобода» и «Аэродромная». Дополнительно район обслуживают 30 маршрутов наземного транспорта: 14 автобусных, 8 троллейбусных и 8 маршрутных такси, связывающих Минск Мир со всеми частями города. Есть и железнодорожное сообщение — электричка до станции Минск-Южный. Такая транспортная доступность даёт бизнесу в районе не только локальный, но и городской поток клиентов.',
  },
  {
    question: 'Как решён вопрос с парковкой для клиентов и сотрудников?',
    answer:
      'В районе два формата организованных машиномест — крытые наземные паркинги и подземные паркинги внутри жилых домов, суммарно несколько тысяч мест на первичном рынке. Бесплатная стихийная парковка во дворах тоже есть, но в резком дефиците — найти свободное место, особенно вечером, непросто. Для бизнеса, ориентированного на клиентов с автомобилем, это значит, что собственный или арендованный паркинг рядом с помещением — заметное конкурентное преимущество, а не опция «на всякий случай».',
  },
  {
    question: 'Можно ли купить машиноместо в Минск Мире и какие варианты есть?',
    answer:
      'Да, в районе продаются машиноместа двух форматов. Крытые наземные паркинги — самый доступный формат, три паркинга общей ёмкостью около 1 658 мест, площадью 12,3–19,6 м². Подземные машиноместа расположены внутри 11 жилых домов, их около 1 111, площадью 12,0–17,6 м² — этот формат дороже наземного за счёт расположения непосредственно под жильём. Актуальные предложения и цены — на первичном рынке застройщика (bir.by) и в разделе «Паркинги» на этой странице.',
  },
  {
    question: 'Сколько детских садов и школ рядом?',
    answer:
      'В районе действуют 3 школы и 4 детских сада, ещё один (пятый) строится. Через дорогу от делового центра Red One расположены ещё 5 детских садов. Такая плотность детской инфраструктуры формирует устойчивый поток родителей утром и вечером — благоприятный фон для семейного бизнеса, детских центров, развивающих студий и профильных магазинов.',
  },
  {
    question: 'Какая медицинская инфраструктура есть в районе?',
    answer:
      'Государственный якорь — 41-я городская поликлиника (ул. Кижеватова, 5а), открытая в январе 2026 года и обеспечивающая первичную медицинскую помощь жителям с постоянным пешеходным трафиком. Рынок частной медицины тоже развит: стоматологии ConstantaClinic (просп. Мира, 1), Dentalove (ул. Аэродромная, 30) и Healthy Smile (ул. Братская, 4), многопрофильный медцентр «ИдеалМед» (ул. Аэродромная, 26) и ветеринарная клиника «Главное Хвост» (ул. Казинца, 46А).',
  },
  {
    question: 'Сколько аптек в Минск Мире?',
    answer:
      'В районе работают 22 аптеки — высокая плотность фарм-ритейла, подтверждающая устойчивый спрос на товары для здоровья в шаговой доступности. Крупнейшая сеть — InLek, у которой 5 из 22 филиалов.',
  },
  {
    question: 'Кто живёт в Минск Мире и какая там покупательская способность?',
    answer:
      'Ядро аудитории района — жители 25–45 лет: молодые семьи, IT-специалисты, предприниматели и квалифицированные специалисты, доля людей пенсионного возраста стремится к нулю. Это активная модель потребления: жители ценят время, ориентированы на комфорт и тратят деньги внутри района — на готовое питание, сервисы у дома, здоровье, спорт и досуг. Высокая доля семей с детьми формирует постоянный спрос на детскую и семейную инфраструктуру — детские центры, профильные магазины, развивающие студии, семейные кафе.',
  },
  {
    question: 'Насколько плотно заселён Минск Мир по сравнению с остальным Минском?',
    answer:
      'Плотность населения в Минск Мире — 427 человек на гектар, это почти в 7,5 раза выше среднегородской плотности Минска (57 чел/га) и почти в полтора раза выше верхней границы норматива «высокоплотной» многоквартирной застройки (231–290 чел/га). Для сравнения, самые плотные из уже сложившихся районов города — Фрунзенский и Московский — держатся на уровне около 100 чел/га. Такая концентрация жителей прямо внутри кварталов означает высокую концентрацию потенциальных клиентов для бизнеса у дома, без необходимости привлекать трафик издалека.',
  },
  {
    question: 'Откуда в район приходит трафик, кроме местных жителей?',
    answer:
      'Кроме почти 80 тысяч постоянных жителей, район генерирует трафик ещё из трёх источников. Свежие квартиры и близость к центру делают Минск Мир популярным для краткосрочной аренды — сюда постоянно приезжают туристы и командированные. Сюда же регулярно приезжают жители других районов Минска — в гости к друзьям или в конкретные местные заведения, магазины и салоны. И третий, растущий источник — заселение Avia Mall арендаторами и будущий запуск Международного финансового центра, который добавит район ещё один поток людей.',
  },
  {
    question: 'Что из крупной торговой инфраструктуры уже работает?',
    answer:
      'Avia Mall — крупнейший торговый центр Минска площадью 138 200 м², якорный арендатор — сеть гипермаркетов Green. Центр уже открыт и работает, но продолжает заселяться арендаторами — часть площадей всё ещё в процессе сдачи.',
  },
  {
    question: 'Работает ли уже Минский международный финансовый центр?',
    answer:
      'Нет, на данный момент Международный финансовый центр в Минск Мире ещё строится и не введён в эксплуатацию. В отличие от Avia Mall, который уже открыт и заселяется арендаторами, финцентр — это точка притяжения будущего периода: его запуск станет дополнительным драйвером трафика и коммерческого спроса в районе.',
  },
  {
    question: 'Какие форматы коммерческой недвижимости продаются и сдаются в Минск Мире?',
    answer:
      'В районе представлен широкий спектр форматов: торговые помещения, бизнес-апартаменты, офисные помещения, кладовые, площади в ТЦ Avia Mall и (в перспективе) офисы в Минском международном финансовом центре. Отдельная и заметная по объёму категория — машиноместа на паркингах, крытых наземных и подземных внутри жилых домов. Первичный рынок (напрямую у застройщика) и вторичный рынок (перепродажа и аренда через объявления) для этих форматов различаются как по цене, так и по доступному предложению.',
  },
  {
    question: 'В чём разница между первичным и вторичным рынком коммерческой недвижимости в Минск Мире?',
    answer:
      'Первичный рынок — это предложения напрямую от застройщика (площадка bir.by): бизнес-апартаменты, торговые помещения, офисы и кладовые, цена указывается за чистый м² без учёта террас. Вторичный рынок — это уже готовые к сделке помещения от собственников, размещённые в открытых объявлениях (например, на Kufar), с готовой или черновой отделкой, на продажу или в аренду. Актуальную сводную статистику по количеству предложений и медианной цене за м² по обоим рынкам, с разбивкой по типу помещения и площади, можно посмотреть в соответствующих разделах этой страницы — данные обновляются регулярно.',
  },
  // Два ценовых вопроса (2026-08-26, аудит: самый частотный коммерческий
  // интент «сколько стоит аренда/купить помещение» не был покрыт FAQ, а
  // слова «аренда»/«купить» не встречались ни в одном заголовке страницы).
  // Конкретные цифры в ответы сознательно НЕ вшиты — они живые и уже есть
  // в таблицах рынков выше, FAQ ссылается на них, а не дублирует (то же
  // решение, что и для остальных «живых» цифр этого блока — см. комментарий
  // в начале districtFaq).
  {
    question: 'Сколько стоит аренда коммерческого помещения в Минск Мире?',
    answer:
      'Ставка аренды зависит от типа помещения, площади и отделки — помещения с готовой отделкой заметно дороже помещений без неё, поэтому смешивать их в одной цифре некорректно. Актуальные медианные ставки аренды за квадратный метр по типам помещений и диапазонам площадей собраны в таблице «Вторичный рынок коммерческой недвижимости» на этой странице: данные считаются по действующим объявлениям и обновляются ежемесячно, с раздельными сводками для помещений с отделкой и без.',
  },
  {
    question: 'Сколько стоит купить коммерческое помещение в Минск Мире?',
    answer:
      'Цена покупки зависит от рынка и формата. На первичном рынке (напрямую от застройщика) продаются бизнес-апартаменты, торговые помещения, офисы и кладовые — минимальные, средние и максимальные цены за квадратный метр по каждой категории собраны в таблице «Первичный рынок» на этой странице. На вторичном рынке ориентир — медианные цены за метр в таблице «Вторичный рынок», отдельно для продажи и аренды, с отделкой и без. Обе сводки обновляются регулярно по живым объявлениям, поэтому отражают текущий рынок, а не устаревшие цифры.',
  },
  {
    question: 'Легко ли найти небольшой офис с отделкой в Минск Мире?',
    answer:
      'Небольших офисов (до 40 м²) с готовой отделкой на вторичном рынке района сейчас крайне мало — и на продажу, и в аренду встречаются буквально единичные предложения на весь Минск Мир. Это устойчивый структурный дефицит формата, а не временная ситуация: район застраивался в первую очередь под жильё и крупные форматы, компактные готовые к въезду кабинеты остаются дефицитом. Именно этот пробел закрывает деловой центр Red One рядом с районом — кабинеты с отделкой под ключ и гибкими условиями аренды.',
  },
  {
    question: 'Насколько высокая конкуренция для общепита — кафе, ресторанов, кофеен?',
    answer:
      'В районе уже работает около 101 заведения общепита — плотное покрытие с явным перекосом в сторону кафе и кофеен (порядка 74 точек), что логично для молодой платёжеспособной аудитории района. Также представлены бары, фастфуд, рестораны, кондитерские, пекарни и пиццерии. Из локальных сетей заметна «Варка» (Varka) — 8 точек. Это одна из самых насыщенных ниш района, но высокая плотность здесь — одновременно и подтверждение устойчивого спроса на общепит у местных жителей.',
  },
  {
    question: 'Какая конкуренция в бьюти-сфере — салоны красоты, ногтевые студии, барбершопы?',
    answer:
      'Бьюти-сфера — один из самых насыщенных сегментов района: 123 салона и студии красоты. Лидируют по числу точек парикмахерские и барбершопы, также широко представлены ногтевые студии, косметология, услуги по бровям и ресницам и стилисты. Высокая плотность отражает и высокий спрос молодой аудитории района на бьюти-услуги в шаговой доступности, и заметную конкуренцию за клиента внутри самой ниши.',
  },
  {
    question: 'Сколько банков и банкоматов в Минск Мире?',
    answer:
      'В районе представлены 13 разных банков — суммарно 30 точек. У 9 банков есть полноценное отделение (Paritetbank, БНБ-Банк, Банк ВТБ, БелВЭБ, Белагропромбанк, Беларусбанк, Белгазпромбанк, МТБанк, Приорбанк), у остальных четырёх (Альфа-Банк, Банк РРБ, Белинвестбанк, Сбер Банк) в районе работает только банкомат. Банковская инфраструктура покрывает район плотно — важный фактор и для жителей, и для бизнеса, которому нужен эквайринг и инкассация рядом.',
  },
  {
    question: 'Достаточно ли в районе продуктовых магазинов?',
    answer:
      'В районе работают 40 продуктовых точек — от крупных сетей до независимых лавок и специализированных магазинов. Заметнее всего представлена «Семь Пятниц» (7 точек), также есть «Копеечка», «Остров», «Евроопт Market», «Знічка» и 7 специализированных точек (мясные, фермерские лавки, кулинария). Это средний уровень плотности — категория не переполнена, как бьюти или общепит, но и без явного дефицита.',
  },
  {
    question: 'Есть ли в районе пункты выдачи заказов Wildberries и Ozon?',
    answer:
      'Да, в районе работают 34 пункта выдачи Wildberries и 22 пункта Ozon — суммарно 56 точек. Такая плотность отражает сильный спрос жителей района на покупки через маркетплейсы и объясняет, почему для этого формата, в отличие от многих других ниш, одной точки хватает на несколько соседних домов.',
  },
  {
    question: 'Где искать автосервис или СТО рядом с Минск Миром?',
    answer:
      'Внутри самого Минск Мира профильных точек автосервиса почти нет — район жилой, а не под авто-бизнес. Зато в непосредственной близости, на улицах Казинца, Брестской, Бородинской и в Брилевском тупике, сложился плотный автосервисный кластер — 42 точки из 58, найденных в окрестностях района: СТО, шиномонтаж, автозапчасти. Иными словами, автосервисы в самом районе не открывают, но клиенты Минск Мира активно пользуются кластером в пешей-транспортной доступности от него.',
  },
  {
    question: 'Много ли цветочных магазинов в районе?',
    answer:
      'В районе работают 36 цветочных точек и флористических студий — заметная плотность для жилого района такого размера. У 7 из них есть доставка букетов день в день, что говорит о зрелости локального рынка: конкуренция здесь идёт не только за витрину, но и за скорость сервиса.',
  },
  {
    question: 'Сколько табачных и вейп-магазинов в Минск Мире?',
    answer:
      'В районе работают 23 точки этого профиля — 15 вейп-шопов и 8 табачных магазинов.',
  },
  {
    question: 'Развита ли спортивная и фитнес-инфраструктура в районе?',
    answer:
      'В районе уже работает 13 залов и студий: 9 студий с акцентом на растяжку и осознанность — йога, пилатес, стретчинг — и 6 классических тренажёрных залов и фитнес-клубов полного цикла. Это самая малочисленная из отслеживаемых категорий бизнеса района, что можно читать и как признак недонасыщенной ниши — спортивная инфраструктура уже востребована жителями, а конкуренция за помещение под неё будет только расти по мере роста населения.',
  },
  {
    question: 'Как узнать, какие ниши бизнеса уже перенасыщены в конкретном квартале Минск Мира?',
    answer:
      'Помимо общерайонной статистики по категориям бизнеса, на этой странице есть карта конкуренции по кварталам — Минск Мир делится на несколько десятков жилых кварталов со своими названиями (например, «Мировые танцы», «Южная Америка», «Эмиратс»), и плотность бизнеса внутри разных кварталов заметно различается. Для кварталов с собранными исчерпывающими данными по каждому дому доступен индекс концентрации по нишам (location quotient) — он показывает, какие категории бизнеса в конкретном квартале переконцентрированы относительно среднего по району, а какие недопредставлены и потенциально свободны для входа. Раздел активно расширяется по мере сбора данных по новым кварталам.',
  },
  {
    question: 'Где находится Red One относительно района?',
    answer:
      'По соседству с Минск Миром — не на его территории, но в непосредственной близости, с быстрым доступом к метро и основным магистралям района. Через дорогу от Red One — 5 детских садов и постоянный поток родителей утром и вечером, а в самом Минск Мире — 3 школы и 4 детских сада (строится 5-й).',
  },
];

// Боковое меню-оглавление (владелец, август 2026) — якоря на все основные
// H2-секции страницы по порядку их появления. id совпадает с якорем в href
// и вешается прямо на обёртку каждой секции (scroll-mt-6 на них — небольшой
// отступ сверху при переходе, чтобы заголовок не упирался в край экрана).
// Показывается только от lg и выше (см. рендер) — на мобильном/планшете
// после узкой колонки контента для него просто нет места сбоку.
// Иконка каждого пункта — та же, что и у заголовка соответствующей секции
// (см. рендер ниже), не своя отдельная: так пункт меню сразу узнаётся на
// самой секции при переходе, а не выглядит как случайно другая картинка.
// У "Частые вопросы"/"Red One" своей иконки в заголовке секции нет (FAQ —
// просто текст, Red One — CTA-блок без иконки), для меню всё равно нужна
// своя — CircleHelp/ArrowRight не заняты нигде на странице.
const SECTION_NAV: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'key-stats', label: 'Ключевые цифры', icon: Sparkles },
  { id: 'developer', label: 'Застройщик', icon: HardHat },
  { id: 'management-company', label: 'Управляющая компания', icon: ShieldCheck },
  { id: 'audience', label: 'Целевая аудитория', icon: Users },
  { id: 'traffic', label: 'Генераторы трафика', icon: Landmark },
  { id: 'population-density', label: 'Плотность населения', icon: Building2 },
  { id: 'business-density', label: 'Плотность бизнеса', icon: Grid2x2 },
  { id: 'quarter-map', label: 'Конкуренция по кварталам', icon: Grid2x2 },
  { id: 'property-types', label: 'Виды недвижимости', icon: Layers },
  { id: 'primary-market', label: 'Первичный рынок', icon: Banknote },
  { id: 'market', label: 'Вторичный рынок', icon: TrendingUp },
  { id: 'business-analytics', label: 'Аналитика по сферам бизнеса', icon: LayoutGrid },
  { id: 'transport', label: 'Транспорт', icon: TrainFront },
  { id: 'parking', label: 'Паркинги', icon: Car },
  { id: 'map', label: 'Карта района', icon: MapPin },
  { id: 'faq', label: 'Частые вопросы', icon: CircleHelp },
  { id: 'red-one', label: 'Red One', icon: ArrowRight },
];

// Гид для предпринимателей и собственников коммерческой недвижимости, не
// продающая страница объекта (SEO_PLAN.md, Э3-1) — по Wordstat «минск мир»
// это на 99%+ спрос на квартиры (см. журнал плана), узкая коммерческая
// часть держится на паре тысяч показов в месяц, а «район минск мир» —
// отдельная, более осмысленная для нас фраза. Обратной ссылки с /one сюда
// нет осознанно — решение владельца не отвлекать с продающей страницы.
export function DistrictGuidePage() {
  const [marketOffers, setMarketOffers] = useState<MarketOffer[] | null>(null);
  const [marketDealType, setMarketDealType] = useState<'Продажа' | 'Аренда'>('Продажа');
  const [marketFinish, setMarketFinish] = useState<(typeof MARKET_FINISH_OPTIONS)[number]>('С отделкой');
  const [primaryMarketOffers, setPrimaryMarketOffers] = useState<PrimaryMarketOffer[] | null>(null);
  const [primaryMarketProKey, setPrimaryMarketProKey] = useState<string | null>(null);

  // Переключатель валют (первичный/вторичный рынок) — владелец: "справа от
  // заголовка просится переключатель EUR/USD/BYN/RUB, курсы с bnb.by".
  // Данные обоих блоков сведены к EUR как общему знаменателю (первичный
  // рынок изначально в EUR; вторичный — в USD с Kufar, конвертируется в EUR
  // тем же курсом, см. convertToEur/convertFromEur в lib/currencyConvert.ts)
  // — переключатель просто меняет валюту ОТОБРАЖЕНИЯ поверх общего EUR-расчёта.
  // Курс — тот же api/exchange-rate.js (bnb.by), что уже используют
  // Транзакции/Ресерч подрядчиков, один запрос на всю страницу.
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [primaryMarketCurrency, setPrimaryMarketCurrency] = useState<Currency>('BYN');
  const [marketCurrency, setMarketCurrency] = useState<Currency>('BYN');

  useEffect(() => {
    fetchTodayRateOrLatestCached()
      .then(setExchangeRate)
      .catch(() => setExchangeRate(null));
  }, []);

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: PAGE_URL, image: OG_IMAGE, ogType: 'article' });
    setArticleJsonLd({
      headline: TITLE,
      description: DESCRIPTION,
      url: PAGE_URL,
      datePublished: '2026-08-22',
      dateModified: DATE_MODIFIED,
      image: OG_IMAGE,
    });
    // После setGenericPageMeta (тот сбрасывает крошки) — порядок важен.
    setBreadcrumbJsonLd([
      { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
      { name: 'Район Минск Мир' },
    ]);
    setFaqJsonLd(districtFaq);
  }, []);

  useEffect(() => {
    // fetchPublicMarketOffers() — не fetchMarketOffers() (`select('*')` на
    // market_offers, только для authenticated-админки, MarketOffersReview.tsx).
    // См. PAGESPEED_PLAN.md, Э5-1/Б2.
    fetchPublicMarketOffers()
      .then(setMarketOffers)
      .catch(() => setMarketOffers([]));
  }, []);

  useEffect(() => {
    fetchPrimaryMarketOffers()
      .then(setPrimaryMarketOffers)
      .catch(() => setPrimaryMarketOffers([]));
  }, []);

  // Плавный переход по якорям бокового меню-оглавления (SECTION_NAV ниже) —
  // scroll-behavior работает только на реальном скролл-контейнере страницы
  // (html), не на произвольном div, поэтому включаем/выключаем классом на
  // документе, а не в CSS этой конкретной страницы.
  useEffect(() => {
    document.documentElement.classList.add('scroll-smooth');
    return () => document.documentElement.classList.remove('scroll-smooth');
  }, []);

  // Меню-оглавление держим на position:fixed, а не sticky: body/#root в
  // index.css намеренно носят overflow-x:hidden (фикс мобильного off-canvas
  // сайдбара, см. комментарий там) — по спецификации CSS это принудительно
  // переводит overflow-y в auto ДАЖЕ если он нигде явно не задан и даже если
  // явно прописать overflow-y:visible поверх (проверено вручную), а это в
  // свою очередь ломает position:sticky для любых потомков на всём сайте.
  // fixed этой проблемы не боится (её ломают только transform/filter у
  // предков, которых тут нет) — но сам не привязан к колонке сетки, поэтому
  // width/left измеряем от реального узла aside и держим в стейте.
  const navAsideRef = useRef<HTMLElement>(null);
  const [navBox, setNavBox] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    function measure() {
      const rect = navAsideRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0) setNavBox({ left: rect.left, width: rect.width });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Меню-оглавление ниже lg — тот же паттерн шторки, что и в админке
  // (components/layout/Sidebar.tsx/AppLayout.tsx): плавающая кнопка вместо
  // постоянно видимой колонки (для неё просто нет места на узком экране),
  // открывает панель поверх контента с затемнением фона.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // PAGESPEED_PLAN.md, Э2-2/Э2-3 — обе карты Яндекса ниже сгиба (689 КиБ +
  // 2+ с CPU на главный поток, см. отчёт PageSpeed) грузятся только когда
  // пользователь прокруткой приблизился к соответствующему блоку, а не сразу
  // при открытии страницы.
  const [quarterMapSectionRef, quarterMapInView] = useInView<HTMLDivElement>();
  const [districtMapSectionRef, districtMapInView] = useInView<HTMLDivElement>();

  // Подсветка текущего раздела в боковом оглавлении при скролле (владелец,
  // со слов друга: "чтобы по мере скрола текущий пункт выделялся жирным").
  // rootMargin сдвигает зону "активности" в верхнюю треть экрана — иначе
  // при обычном IntersectionObserver с threshold секция считалась бы активной
  // только когда видна целиком, а длинные блоки (например "Первичный рынок")
  // никогда не помещаются в экран целиком.
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        setActiveSectionId(topMost.target.id);
      },
      { rootMargin: '-96px 0px -70% 0px', threshold: 0 },
    );
    for (const { id } of SECTION_NAV) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  // Само меню-оглавление тоже скроллится (высокий список разделов не
  // влезает в max-h экрана) — владелец: активный пункт при длинном скролле
  // страницы уходил за пределы видимой части меню, непонятно было, где
  // находишься. scrollIntoView({block:'nearest'}) трогает только ближайший
  // scroll-контейнер (сам nav), не страницу целиком.
  useEffect(() => {
    if (!activeSectionId) return;
    document
      .querySelectorAll(`[data-nav-id="${activeSectionId}"]`)
      .forEach((el) => el.scrollIntoView({ block: 'nearest' }));
  }, [activeSectionId]);

  return (
    <>
      <div className="min-h-svh bg-bg">
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
        Содержание гайда
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Содержание гайда</span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Закрыть меню"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {SECTION_NAV.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            href={`#${id}`}
            data-nav-id={id}
            onClick={() => setMobileNavOpen(false)}
            className={cn(
              'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm transition-colors hover:text-primary',
              activeSectionId === id ? 'bg-primary/10 font-bold text-primary' : 'font-medium text-ink',
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {label}
          </a>
        ))}
      </aside>

      {/* Шапка выровнена по той же сетке, что и основной контент ниже
          (lg:grid-cols-[200px_1fr]) — логотип в ПЕРВОЙ колонке (там же,
          где ниже боковое оглавление), меню — во ВТОРОЙ. У самой
          hero-карточки ниже есть свой внутренний `mx-auto max-w-3xl`
          (центрирует контент внутри широкой колонки) — из-за него
          фактический левый край карточки на 40px правее границы самой
          колонки. Владелец нарисовал на скриншоте линию ровно по этому
          факту­ческому краю карточки, не по границе колонки — обёртка
          меню повторяет тот же `mx-auto max-w-3xl`, чтобы совпасть
          именно с ним, а не с более левой границей колонки. Ниже lg обе
          колонки становятся одним flex-рядом на всю ширину, как и раньше. */}
      {/* Логотип зафиксирован над боковым меню-оглавлением на lg+ (владелец:
          при долгом скролле терялось ощущение "где я" — оригинальный
          логотип в шапке уезжал вверх вместе со страницей). Дублируем его
          отдельным fixed-элементом, привязанным к той же navBox.left, что и
          сам `nav` ниже, а исходный логотип в шапке скрываем на lg+, чтобы
          не было двух логотипов одновременно (тот же приём, что и с пустой
          первой колонкой-заглушкой под fixed-сайдбар в сетке контента ниже).
          text-primary-hover, не text-primary — PAGESPEED_PLAN.md, Э8-2:
          "RED" в 18px (text-lg) недостаточно крупный для послабления WCAG
          "крупный жирный текст" (нужно ≥19px), --color-primary даёт только
          4,12:1 на bg — text-primary-hover 5,13:1. */}
      <Link
        to="/minsk"
        className="fixed top-6 z-40 hidden shrink-0 text-lg font-extrabold tracking-wide text-ink lg:block"
        style={navBox ? { left: navBox.left } : { visibility: 'hidden' }}
      >
        <span className="font-black text-primary-hover">RED</span>EVELOPMENT
      </Link>

      <div className="border-b border-border py-5">
        <div className="mx-auto max-w-6xl px-4 sm:px-8">
          <div className="flex items-center justify-between lg:grid lg:grid-cols-[200px_1fr] lg:items-center lg:gap-10">
            <Link to="/minsk" className="shrink-0 text-lg font-extrabold tracking-wide text-ink lg:invisible">
              <span className="font-black text-primary-hover">RED</span>EVELOPMENT
            </Link>
            <div className="lg:mx-auto lg:w-full lg:max-w-3xl">
              <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted sm:flex">
                <Link to="/minsk/one" className="transition-colors hover:text-ink">
                  Деловой центр Red One
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-8">
        <div className="lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
          <aside ref={navAsideRef} className="hidden lg:block">
            <nav
              className={cn(
                'fixed top-24 flex max-h-[calc(100vh-7rem)] flex-col gap-0.5 overflow-y-auto p-3 text-sm',
                glassCardClass,
              )}
              style={navBox ? { ...glassCardShadow, left: navBox.left, width: navBox.width } : { visibility: 'hidden' }}
            >
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">На странице</p>
              {SECTION_NAV.map(({ id, label, icon: Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  data-nav-id={id}
                  className={cn(
                    'flex items-center gap-2 rounded-control px-2 py-1.5 transition-colors',
                    activeSectionId === id
                      ? 'bg-primary/10 font-bold text-primary'
                      : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {label}
                </a>
              ))}
            </nav>
          </aside>

          <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {/* Единая liquid-glass подложка под заголовком/подзаголовком и фото —
            раньше текст стоял прямо на фоне страницы, а фото было в своей
            отдельной рамке; теперь один блок. Колонки не 50/50
            (sm:grid-cols-2), а 3:2 — заголовку описания больше не тесно,
            фото просто пропорционально сузилось вместе со своей колонкой
            (aspect-[4/5] не трогали). Карточки с цифрами были ненадолго
            убраны с первого экрана в параллельном заходе — владелец в этом
            же диалоге явно попросил вернуть их сюда, отдельным блоком
            "Ключевые цифры" сразу после hero, перед "Застройщиком района"
            (см. statTiles, id="key-stats" ниже). */}
        <div
          className={cn('grid grid-cols-1 gap-6 p-6 sm:grid-cols-[3fr_2fr] sm:items-center sm:p-8', glassCardClass)}
          style={glassCardShadow}
        >
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-3xl">{PAGE_H1}</h1>
            <p className="text-base text-ink-muted">{INTRO_TEXT}</p>
            {/* Пометка свежести — владелец: "чтобы инфа выглядела супер-
                актуальной", спокойный зелёный, не просто блёклый текст.
                BadgeCheck вместо точки/иконки календаря — читается как
                "проверено", не только "когда-то обновлено". text-[#0f6b3d],
                не text-success — PAGESPEED_PLAN.md, Э8-3: токен --color-success
                на --color-success-bg даёт 3,03:1, ниже нормы WCAG 4,5:1 для
                мелкого текста (аудит Accessibility PageSpeed это поймал);
                глобальный токен не трогаем (задевает всё приложение), точечная
                более тёмная версия только здесь — 5,9:1. */}
            <span className="flex w-fit items-center gap-1.5 rounded-full border border-success/30 bg-success-bg px-3 py-1 text-xs font-semibold text-[#0f6b3d]">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
              {UPDATED_BADGE_LABEL}
            </span>
          </div>
          <div className="mx-auto w-full max-w-xs sm:max-w-none">
            <HeroImageSlider
              images={HERO_IMAGES}
              alt="Аэрофото района Минск Мир"
              aspectClassName="aspect-[4/5]"
              imageWidth={512}
              imageHeight={640}
            />
          </div>
        </div>

        <div id="key-stats" className={cn('flex scroll-mt-6 flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Ключевые цифры</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statTiles.map(({ icon: Icon, value, label }) => (
              <div
                key={label}
                className="flex flex-col gap-2 rounded-control border border-border/60 bg-white p-4 shadow-card"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="text-lg font-extrabold text-ink">{value}</div>
                <p className="text-xs leading-snug text-ink-muted">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div id="developer" className={cn('flex scroll-mt-6 flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          {/* Логотипы на одном уровне с заголовком, справа (owner: сначала
              "перенеси логотип застройщика вправо" отдельной строкой, потом
              "логотипы можно располагать выше, на одном уровне с
              заголовком") — Минск Мир тот же файл, что и на лендинге
              Red One (см. MINSK_MIR_LOGO_URL там). Ссылки на сайты — в
              блоке контактов ниже (owner: "ссылку на сайт перенеси вниз,
              где контакты"), вместо отдельных pill-кнопок строка в общем
              стиле телефона/адреса/часов работы (иконка + текст). */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <HardHat className="h-5 w-5 shrink-0 text-ink" />
              <h2 className="text-lg font-bold text-ink">Застройщик района</h2>
            </div>
            <div className="flex items-center gap-4">
              <img src={DEVELOPER_LOGO_URL} alt="Dana Holdings" width={420} height={126} className="h-9 w-auto object-contain" />
              <img src={MINSK_MIR_LOGO_URL} alt="Минск Мир" width={108} height={126} className="h-9 w-auto object-contain" />
            </div>
          </div>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">Dana Holdings</span> — международная группа компаний со штаб-квартирой
            в Швейцарии, на белорусском рынке с 2006 года. В Минске холдингу принадлежат ещё несколько проектов —
            «Маяк Минска», Vogue, «Вивальди», «Рахманинов». Заявленный масштаб Минск Мира — 320 га, около 30 тысяч
            квартир и порядка $3,5 млрд инвестиций.
          </p>
          <div className="flex flex-col gap-1.5 pt-1 text-sm text-ink-muted">
            <a href={DEVELOPER_CONTACTS.phoneHref} className="flex w-fit items-center gap-2 text-ink hover:underline">
              <Phone className="h-4 w-4 shrink-0" />
              {DEVELOPER_CONTACTS.phone}
            </a>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{DEVELOPER_CONTACTS.address}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{DEVELOPER_CONTACTS.hours}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="h-4 w-4 shrink-0" />
              {DEVELOPER_LINKS.map(({ label, url }, i) => (
                <span key={url} className="flex items-center gap-2">
                  {i > 0 && <span className="text-ink-faint">·</span>}
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-ink hover:underline"
                  >
                    {label}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          id="management-company"
          className={cn('flex scroll-mt-6 flex-col gap-4 p-6', glassCardClass)}
          style={glassCardShadow}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-ink" />
              <h2 className="text-lg font-bold text-ink">Управляющая компания</h2>
            </div>
            <img
              src={MANAGEMENT_COMPANY_LOGO_URL}
              alt={MANAGEMENT_COMPANY.name}
              width={170}
              height={168}
              className="h-12 w-auto object-contain"
            />
          </div>
          <p className="text-sm text-ink-muted">{MANAGEMENT_COMPANY_DESCRIPTION}</p>
          <div className="flex flex-col gap-1.5 text-sm text-ink-muted">
            <div className="flex flex-wrap items-center gap-2">
              <Phone className="h-4 w-4 shrink-0" />
              {MANAGEMENT_COMPANY.phones.map((p, i) => (
                <span key={p.href} className="flex items-center gap-2">
                  {i > 0 && <span className="text-ink-faint">·</span>}
                  <a href={p.href} className="text-ink hover:underline">
                    {p.label}
                  </a>
                </span>
              ))}
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{MANAGEMENT_COMPANY.address}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0" />
              <span>{MANAGEMENT_COMPANY.hours}</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 shrink-0" />
              <a
                href={MANAGEMENT_COMPANY.site.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-ink hover:underline"
              >
                {MANAGEMENT_COMPANY.site.label}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          </div>
        </div>

        <div id="audience" className={cn('flex scroll-mt-6 flex-col gap-3 p-6 sm:flex-row sm:gap-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 shrink-0 text-ink" />
              <h2 className="text-lg font-bold text-ink">Целевая аудитория и покупательская способность</h2>
            </div>
            <ul className="flex flex-col gap-2">
              {audienceHighlights.map(({ label, text }) => (
                <li key={label} className="text-sm text-ink-muted">
                  <span className="font-semibold text-ink">{label}</span> {text}
                </li>
              ))}
            </ul>
          </div>
          <img
            src="/images/district/audience-target-audience.svg"
            alt=""
            className="hidden h-auto w-36 shrink-0 self-center sm:block"
          />
        </div>

        <div id="traffic" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Landmark className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Генераторы ежедневного трафика</h2>
          </div>
          <ul className="flex flex-col gap-2">
            {trafficHighlights.map(({ label, text }) => (
              <li key={label} className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{label}</span> {text}
              </li>
            ))}
          </ul>
        </div>

        <div id="population-density" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Плотность населения</h2>
          </div>
          {densityComparisons.map(({ label, value }) => {
            const isDistrict = value === DISTRICT_DENSITY_PER_HECTARE;
            return (
              <div key={label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn('text-sm', isDistrict ? 'font-semibold text-ink' : 'text-ink-muted')}>
                    {label}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{value} чел/га</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={cn('h-full rounded-full', isDistrict ? 'bg-primary' : 'bg-ink/30')}
                    style={{ width: `${Math.round((value / DISTRICT_DENSITY_PER_HECTARE) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          <p className="text-sm text-ink-muted">
            Почти в {densityVsAvgRatioLabel} раза плотнее, чем в среднем по Минску, и почти в {densityRatioLabel} раза
            выше верхней границы норматива «высокоплотной» застройки — высокая концентрация потенциальных клиентов
            прямо внутри жилых кварталов.
          </p>
        </div>

        <div id="business-density" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Grid2x2 className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Плотность бизнеса по нишам</h2>
          </div>
          <p className="text-sm text-ink-muted">Число точек по каждой категории бизнеса в районе.</p>
          <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
            {densityData.map(({ icon: Icon, label, count }) => {
              const tier = DENSITY_TIER_STYLE[densityTier(count)];
              return (
                <div
                  key={label}
                  className="flex flex-col gap-2 rounded-control p-3"
                  style={{ backgroundColor: tier.bg, color: tier.text }}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-80" />
                  <div className="text-2xl font-black leading-none">{count}</div>
                  <p className="text-xs font-medium leading-snug">{label}</p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            {(['low', 'medium', 'high'] as DensityTier[]).map((tier) => (
              <div key={tier} className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: DENSITY_TIER_STYLE[tier].bg }}
                />
                <span className="text-xs text-ink-muted">{DENSITY_TIER_LABEL[tier]}</span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="h-4 w-4 shrink-0 translate-y-0.5 text-warning" />
            <p className="text-sm text-ink-muted">
              Высокая плотность — это не только высокая конкуренция, но и доказательство высокого спроса. Каждую
              нишу стоит оценивать отдельно.
            </p>
          </div>
        </div>

        <div
          id="quarter-map"
          ref={quarterMapSectionRef}
          className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)}
          style={glassCardShadow}
        >
          {quarterMapInView ? (
            <Suspense fallback={<div className="flex h-64 items-center justify-center text-sm text-ink-faint">Загрузка карты…</div>}>
              <DistrictQuarterMap />
            </Suspense>
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-ink-faint">Загрузка карты…</div>
          )}
        </div>

        <div id="property-types" className={cn('flex scroll-mt-6 flex-col', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3 px-6 pt-6">
            <Layers className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Виды коммерческой недвижимости в Минск Мире</h2>
          </div>
          <div className="flex flex-col divide-y divide-border">
            <div className="px-6 py-6">
              <PropertyType {...PROPERTY_TYPE_TRADE} />
            </div>

            {/* Бизнес-апартаменты — раньше отдельная секция id="business-
                apartments" со своим пунктом в SECTION_NAV, слита сюда одной
                строкой (владелец, 2026-08-26: "получится такая плиточная
                вёрстка" — см. большой комментарий над PropertyType/PROPERTY_TYPE_*
                выше). Текст плюсов/минусов и правовая база не менялись,
                только h2→h3 (это теперь подраздел property-types, не
                отдельная H2-секция) и убрана внешняя обёртка glassCard —
                разделитель между строками уже даёт divide-y родителя.
                id="business-apartments" сохранён на случай внешних ссылок
                на этот якорь, просто больше не значится в SECTION_NAV. */}
            <div id="business-apartments" className="flex scroll-mt-6 flex-col gap-3 px-6 py-6">
              <div className="flex items-center gap-3">
                <BedDouble className="h-5 w-5 shrink-0 text-ink" />
                <h3 className="text-base font-bold text-ink">Бизнес-апартаменты</h3>
              </div>
              <p className="text-sm text-ink-muted">
                Юридически нежилой формат с необычным правом: можно прописаться самому (и близким родственникам) и
                одновременно зарегистрировать по этому же адресу бизнес.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2 rounded-control border border-white bg-white/60 p-4 sm:border-white/50 sm:bg-white/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Плюсы</p>
                  <ul className="flex flex-col gap-1.5">
                    {[
                      'Прописка владельца и близких родственников — редкость для нежилого помещения',
                      'Юрлицо можно зарегистрировать по этому же адресу',
                      'На старте продаж стоили значительно дешевле квартир',
                    ].map((text) => (
                      <li key={text} className="flex items-start gap-2 text-sm text-ink-muted">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-1 rounded-control border border-dashed border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Минусы</p>
                  <ul className="flex flex-col gap-1.5">
                    {[
                      'Юридически нежилое помещение, не полноценное жильё',
                      'Нет обычных жилищных льгот и субсидий на ЖКУ',
                      'Коммуналка по тарифу для юрлиц — заметно дороже квартиры',
                    ].map((text) => (
                      <li key={text} className="flex items-start gap-2 text-sm text-ink-muted">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="text-xs text-ink-muted">
                Правовой режим — указ Президента № 456 от 22.09.2014 (тот же, что выделил землю под Минск Мир),
                дополнен указом № 370 от 20.10.2020.
              </p>
            </div>

            <div className="px-6 py-6">
              <PropertyType {...PROPERTY_TYPE_OFFICE} />
            </div>

            <div className="px-6 py-6">
              <PropertyType {...PROPERTY_TYPE_STORAGE} />
            </div>

            <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2">
              <PropertyType {...PROPERTY_TYPE_PARKING_COVERED} />
              <PropertyType {...PROPERTY_TYPE_PARKING_UNDERGROUND} />
            </div>

            <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2">
              <PropertyType {...PROPERTY_TYPE_AVIA_MALL} />
              <PropertyType {...PROPERTY_TYPE_MFC} />
            </div>
          </div>
        </div>

        <div id="primary-market" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          {/* flex-col на мобильном — длинный заголовок + пилюля валюты в
              одну строку не помещались на 375px, заголовок вылезал в 4
              строки, сжатый пилюлей (тот же фикс, что и у заголовка карты
              конкуренции по кварталам выше). */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Banknote className="h-5 w-5 shrink-0 text-ink" />
              <h2 className="text-lg font-bold text-ink">Первичный рынок коммерческой недвижимости</h2>
            </div>
            <CurrencyToggle value={primaryMarketCurrency} onChange={setPrimaryMarketCurrency} />
          </div>
          <p className="text-sm text-ink-muted">
            Предложения от застройщика (bir.by) — бизнес-апартаменты, торговые помещения, офисы и кладовые. Цена — за
            чистый м², без учёта террас.
          </p>

          {primaryMarketOffers === null && <p className="text-sm text-ink-faint">Загрузка…</p>}
          {primaryMarketOffers !== null && primaryMarketOffers.length === 0 && (
            <p className="text-sm text-ink-faint">Данные пока не собраны.</p>
          )}

          {primaryMarketOffers && primaryMarketOffers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                {/* caption/scope — машиночитаемая семантика таблицы для
                    поисковиков (Google читает таблицы для сниппетов);
                    sr-only — визуально ничего не добавляет. */}
                <caption className="sr-only">
                  Первичный рынок коммерческой недвижимости Минск Мира: количество предложений и цены за м² по
                  категориям (данные bir.by)
                </caption>
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <th scope="col" className="py-2 pr-3 text-left">Категория</th>
                    <th scope="col" className="py-2 px-2 text-right font-semibold">Предложений</th>
                    <th scope="col" className="py-2 px-2 text-right font-semibold">Площадь</th>
                    <th scope="col" className="py-2 px-2 text-right font-semibold">Мин, {currencySymbols[primaryMarketCurrency]}/м²</th>
                    <th scope="col" className="py-2 px-2 text-right font-semibold">
                      Средняя, {currencySymbols[primaryMarketCurrency]}/м²
                    </th>
                    <th scope="col" className="py-2 pl-2 text-right font-semibold">Макс, {currencySymbols[primaryMarketCurrency]}/м²</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {buildPrimaryMarketPivot(primaryMarketOffers).map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => setPrimaryMarketProKey(row.key)}
                      className="cursor-pointer hover:bg-surface-muted"
                    >
                      <th scope="row" className="whitespace-nowrap py-2.5 pr-3 text-left font-medium text-ink">{row.label}</th>
                      <td className="py-2.5 px-2 text-right tabular-nums text-ink">{row.count}</td>
                      <td className="whitespace-nowrap py-2.5 px-2 text-right tabular-nums text-ink-muted">
                        {row.areaMin === row.areaMax ? `${row.areaMin}` : `${row.areaMin}–${row.areaMax}`} м²
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums text-ink-muted">
                        {formatPricePerM2(row.priceMinEur, primaryMarketCurrency, exchangeRate)}
                      </td>
                      <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-ink">
                        {formatPricePerM2(row.priceAvgEur, primaryMarketCurrency, exchangeRate)}
                      </td>
                      <td className="py-2.5 pl-2 text-right tabular-nums text-ink-muted">
                        {formatPricePerM2(row.priceMaxEur, primaryMarketCurrency, exchangeRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {primaryMarketOffers && primaryMarketOffers.length > 0 && (
            <button
              type="button"
              onClick={() => setPrimaryMarketProKey(buildPrimaryMarketPivot(primaryMarketOffers)[0]?.key ?? null)}
              className="flex items-center gap-3 rounded-control bg-surface-muted px-5 py-4 text-left transition-colors hover:bg-border"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white">
                <ArrowRight className="h-4 w-4" />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-sm font-bold text-ink">Открыть Pro-аналитику</span>
                <span className="text-xs text-ink-muted">
                  Гистограмма цены, разбивка по домам и сравнение сдано/строится — по каждой категории отдельно
                </span>
              </span>
            </button>
          )}
        </div>

        <div id="market" className={cn('flex scroll-mt-6 flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          {/* flex-col на мобильном — тот же фикс, что и у "Первичного рынка"
              выше (длинный заголовок + пилюля валюты не помещались в одну
              строку на 375px). */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <TrendingUp className="h-5 w-5 shrink-0 text-ink" />
              <h2 className="text-lg font-bold text-ink">Вторичный рынок коммерческой недвижимости</h2>
            </div>
            <CurrencyToggle value={marketCurrency} onChange={setMarketCurrency} />
          </div>
          {marketOffers && marketOffers.length > 0 && (
            <span className="-mt-2 text-xs text-ink-muted">Kufar, Realt · {formatLatestUpdate(marketOffers)}</span>
          )}
          <p className="text-sm text-ink-muted">
            Действующие предложения продажи и аренды коммерческих помещений в Минск Мире — количество и медианная
            цена за м² по типу помещения и площади. Обновляется раз в месяц.
          </p>

          {marketOffers === null && <p className="text-sm text-ink-faint">Загрузка…</p>}
          {marketOffers !== null && marketOffers.length === 0 && (
            <p className="text-sm text-ink-faint">Данные пока не собраны.</p>
          )}

          {marketOffers && marketOffers.length > 0 && (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <ToggleGroup
                  options={['Продажа', 'Аренда']}
                  value={marketDealType}
                  onChange={(value) => setMarketDealType(value as 'Продажа' | 'Аренда')}
                />
                <ToggleGroup
                  label="Отделка"
                  options={[...MARKET_FINISH_OPTIONS]}
                  value={marketFinish}
                  onChange={(value) => setMarketFinish(value as (typeof MARKET_FINISH_OPTIONS)[number])}
                />
              </div>
              <p className="text-xs text-ink-muted">
                Цена с отделкой и без — разные рынки, поэтому не смешиваем их в одной цифре.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <caption className="sr-only">
                    Вторичный рынок коммерческой недвижимости Минск Мира: количество предложений и медианная цена
                    за м² по типу помещения и площади (данные Kufar, Realt)
                  </caption>
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      <th scope="col" className="py-2 pr-3 text-left">Тип помещения</th>
                      {AREA_BUCKET_ORDER.map((bucket) => (
                        <th scope="col" key={bucket} className="py-2 px-2 text-right font-semibold">
                          {bucket}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {buildMarketPivot(
                      marketOffers,
                      marketDealType === 'Продажа' ? 'sale' : 'rent',
                      MARKET_FINISH_TO_DB[marketFinish],
                    ).map((row) => (
                      <tr key={row.propertyType}>
                        <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">{row.propertyType}</th>
                        {row.cells.map((cell, i) => (
                          <td key={i} className="py-2.5 px-2 text-right tabular-nums">
                            {cell ? (
                              <>
                                <div className="font-semibold text-ink">{cell.count}</div>
                                <div className="text-xs text-ink-muted">
                                  {formatMedianPriceLabel(cell.medianPrice, marketCurrency, exchangeRate, marketDealType === 'Аренда')}
                                </div>
                              </>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-muted">Сверху — количество предложений, снизу — медианная цена за м².</p>

              <div className="flex items-start gap-2.5 rounded-control border border-success/30 bg-success-bg px-4 py-3">
                <Sparkles className="h-4 w-4 shrink-0 translate-y-0.5 text-success" />
                <p className="text-sm text-ink">
                  Небольших офисов (до 40 м²) с готовой отделкой в районе почти нет:{' '}
                  {/* text-[#0f6b3d] — тот же контраст-фикс, что и у бейджа
                      "Обновлено" выше (PAGESPEED_PLAN.md, Э8-3). */}
                  <span className="font-semibold text-[#0f6b3d]">
                    {countSmallFinishedOffices(marketOffers, 'sale')} предложение на продажу
                  </span>{' '}
                  и{' '}
                  <span className="font-semibold text-[#0f6b3d]">
                    {countSmallFinishedOffices(marketOffers, 'rent')} в аренду
                  </span>{' '}
                  на весь Минск Мир. Red One закрывает именно этот дефицит —{' '}
                  <Link to="/minsk/one" className="font-semibold underline">
                    кабинеты с отделкой под ключ
                  </Link>
                  .
                </p>
              </div>
            </>
          )}
        </div>

        <div id="business-analytics" className={cn('flex scroll-mt-6 flex-col', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3 px-6 pt-6">
            <LayoutGrid className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Аналитика по сферам бизнеса</h2>
          </div>
          <div className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Stethoscope className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Медицина и здоровье</h3>
          </div>
          <ul className="flex flex-col gap-2">
            {medicineHighlights.map(({ label, text }) => (
              <li key={label} className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">{label}</span> {text}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5 pt-1">
            <p className="text-sm font-semibold text-ink">Частная медицина и специализированный бизнес:</p>
            <ul className="flex flex-col gap-1 pl-4">
              {medicinePrivateList.map(({ label, text }) => (
                <li key={label} className="list-disc text-sm text-ink-muted marker:text-ink-faint">
                  <span className="font-semibold text-ink">{label}</span> {text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Coffee className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Общепит: кафе, рестораны, бары</h3>
          </div>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{foodServiceTotal} заведений общепита</span> в шаговой
            доступности — плотное покрытие с явным перекосом в кафе и кофейни, что логично для портрета аудитории
            района. Локальная сеть Varka («Варка») — 8 точек.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {foodServiceBreakdown.map(({ label, count }) => (
              <span key={label} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink">
                {label} — {count}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Dumbbell className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Спорт и фитнес</h3>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">
            В районе работает <span className="font-semibold text-ink">{sportTotal} залов и студий</span> — от
            классических тренажёрных залов до узкоспециализированных практик. Больше всего,{' '}
            <span className="font-semibold text-ink">{sportBreakdown[0].count}</span>, — студии с акцентом на
            растяжку и осознанность: йога, пилатес, стретчинг; ещё{' '}
            <span className="font-semibold text-ink">{sportBreakdown[1].count}</span> — тренажёрные залы и
            фитнес-клубы полного цикла. Спортивная инфраструктура в шаговой доступности уже сформирована —
            конкуренция за помещение под эту нишу будет только расти.
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Банки и банкоматы</h3>
          </div>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{bankNamesCount} разных банков</span> в районе ({bankPointsTotal}{' '}
            точек) — у {bankBranchCount} есть полноценное отделение, у всех — банкомат.
          </p>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 pt-1 sm:grid-cols-2">
            {bankMatrix.map(({ label, hasBranch, hasAtm }) => (
              <div key={label} className="flex items-center justify-between gap-2 border-b border-border py-1.5">
                <span className="text-sm font-medium text-ink">{label}</span>
                <div className="flex shrink-0 gap-1">
                  {hasBranch && (
                    <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                      <Building2 className="h-2.5 w-2.5 shrink-0" />
                      Отделение
                    </span>
                  )}
                  {hasAtm && (
                    <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-ink-muted">
                      <Banknote className="h-2.5 w-2.5 shrink-0" />
                      Банкомат
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Wrench className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">СТО и автосервисы</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-control border border-dashed border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">В самом районе</p>
              <p className="text-sm text-ink-muted">
                Профильных точек почти нет — Минск Мир жилой, не под авто-бизнес.
              </p>
            </div>
            <div className="flex flex-col gap-1 rounded-control border border-white bg-white/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">По соседству</p>
              <p className="text-sm text-ink-muted">
                <span className="font-semibold text-ink">
                  {autoServiceClusterCount} из {autoServiceTotal} точек
                </span>{' '}
                СТО, шиномонтажа и автозапчастей — на улицах {autoServiceClusterStreets}.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Scissors className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Салоны красоты и бьюти-сфера</h3>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-black leading-none text-primary">{beautyTotal}</span>
            <span className="pb-1 text-sm text-ink-muted">
              салонов и студий — один из самых насыщенных сегментов района
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            Лидируют парикмахерские и барбершопы (по {beautyBreakdown[0].count} каждая); также широко представлены
            ногтевые студии, косметология, брови и ресницы, стилисты.
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <ShoppingBasket className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Магазины продуктов</h3>
          </div>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{groceryTotal} точки</span> — от крупных сетей до независимых
            лавок и специализированных магазинов.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {groceryBreakdown.map(({ label, count }) => (
              <div key={label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-ink-muted">{label}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-ink/70"
                    style={{ width: `${Math.round((count / groceryMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Package className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Пункты выдачи заказов</h3>
          </div>
          <div className="flex items-end gap-3">
            <span className="text-5xl font-black leading-none text-primary">{pvzTotal}</span>
            <span className="pb-1 text-sm text-ink-muted">
              точка Ozon и Wildberries — сильный спрос на маркетплейсы
            </span>
          </div>
          <p className="text-xs text-ink-muted">
            Wildberries — {pvzWildberriesCount}, Ozon — {pvzOzonCount}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Flower2 className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Цветочные магазины и флористы</h3>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">{flowerTotal} цветочных точек</span> и флористических студий
            работают в районе — заметная плотность для жилого квартала такого размера. У{' '}
            <span className="font-semibold text-ink">{flowerDeliveryCount} из них</span> есть доставка букетов день
            в день — признак зрелого локального рынка, где конкуренция идёт не только за витрину, но и за скорость
            сервиса.
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-6">
          <div className="flex items-center gap-3">
            <Cigarette className="h-5 w-5 shrink-0 text-ink" />
            <h3 className="text-base font-bold text-ink">Табак и вейп-шопы</h3>
          </div>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{tobaccoVapeTotal} точки</span> в районе.
          </p>
          <div className="flex flex-col gap-2 pt-1">
            {tobaccoVapeBreakdown.map(({ label, count }) => (
              <div key={label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-ink-muted">{label}</span>
                  <span className="shrink-0 text-xs font-semibold text-ink">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-ink/70"
                    style={{ width: `${Math.round((count / tobaccoVapeMax) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
          </div>
        </div>

        <div id="transport" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <TrainFront className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Транспорт</h2>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold text-ink-muted">
                <img
                  src="/icons/minsk-metro-line3.webp"
                  alt=""
                  width={68}
                  height={32}
                  loading="lazy"
                  className="h-4 w-auto"
                />
                Метро:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {metroStations.map((s) => (
                  <span key={s} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold text-ink-muted">
                <Bus className="h-3.5 w-3.5" />
                Автобусы:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {busRoutes.map((r) => (
                  <span key={r} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold text-ink-muted">
                <TramFront className="h-3.5 w-3.5" />
                Троллейбусы:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {trolleyRoutes.map((r) => (
                  <span key={r} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold text-ink-muted">
                <Car className="h-3.5 w-3.5" />
                Маршрутки:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {minibusRoutes.map((r) => (
                  <span key={r} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink">
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs font-semibold text-ink-muted">
                <TrainFront className="h-3.5 w-3.5" />
                Электричка:
              </span>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink">
                  До станции Минск-Южный
                </span>
              </div>
            </div>
          </div>
        </div>

        <div id="parking" className={cn('flex scroll-mt-6 flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Car className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Паркинги</h2>
          </div>
          <p className="text-sm text-ink-muted">
            В районе два формата машиномест — крытые наземные паркинги и подземные внутри жилых домов. На первичном
            рынке (bir.by) сейчас в продаже 2 769 мест.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {parkingSegments.map(({ icon: Icon, title, count, buildingsLabel, areaRange }) => (
              <div
                key={title}
                className="flex flex-col gap-2 rounded-control border border-white bg-white/60 p-4 sm:border-white/50 sm:bg-white/40"
              >
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center text-ink', glassPillClass)} style={glassPillShadow}>
                  <Icon className="h-4 w-4" />
                </span>
                {/* h3 — тот же принцип, что у карточек видов недвижимости. */}
                <h3 className="text-sm font-bold text-ink">{title}</h3>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-extrabold text-ink">{count}</span>
                  <span className="text-xs text-ink-muted">мест в продаже</span>
                </div>
                <p className="text-xs text-ink-muted">
                  {buildingsLabel} · {areaRange}
                </p>
              </div>
            ))}

            <div className="flex flex-col gap-2 rounded-control border border-white bg-white/60 p-4 sm:border-white/50 sm:bg-white/40">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center text-ink', glassPillClass)} style={glassPillShadow}>
                <Car className="h-4 w-4" />
              </span>
              <h3 className="text-sm font-bold text-ink">Бесплатная стихийная парковка</h3>
              <div className="flex items-start gap-1.5">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <p className="text-xs text-ink-muted">
                  Есть места во дворах, но в резком дефиците — свободное место найти непросто, особенно вечером.
                </p>
              </div>
            </div>
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-ink">Список паркингов и адреса</summary>
            <div className="mt-2 flex flex-col gap-3">
              {(['Крытые', 'Подземные'] as const).map((category) => (
                <div key={category} className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{category}</p>
                  <ul className="flex flex-col gap-1">
                    {parkingAddresses
                      .filter((p) => p.category === category)
                      .map(({ house, address }) => (
                        <li key={house} className="text-sm text-ink-muted">
                          <span className="font-medium text-ink">{house}</span>
                          {' — '}
                          {address ?? <span className="text-ink-faint">адрес не присвоен</span>}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>

          <p className="text-xs text-ink-muted">
            Источник — актуальный срез объявлений bir.by на продажу машиномест в Минск Мире, 2769 позиций (август
            2026).
          </p>
        </div>

        <div
          id="map"
          ref={districtMapSectionRef}
          className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)}
          style={glassCardShadow}
        >
          {districtMapInView ? (
            <Suspense fallback={<div className="flex h-[420px] items-center justify-center text-sm text-ink-faint">Загрузка карты…</div>}>
              <DistrictMap />
            </Suspense>
          ) : (
            <div className="flex h-[420px] items-center justify-center text-sm text-ink-faint">Загрузка карты…</div>
          )}
        </div>

        <FaqAccordion id="faq" title="Частые вопросы о районе" items={districtFaq} />

        <div id="red-one" className={cn('flex scroll-mt-6 flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Red One — готовый центр коммерческой активности</h2>
          <p className="text-sm text-ink-muted">
            Приватные кабинеты и фиксированные рабочие места в собственном здании по соседству с Минск Миром — с
            дизайнерской отделкой, парковкой и онлайн-бронированием без предоплаты. Через дорогу — 5 детских садов
            и постоянный поток родителей утром и вечером, в районе — 3 школы и 4 детских сада (строится 5-й).
          </p>
          <Link to="/minsk/one" className="w-fit text-sm font-semibold text-primary hover:underline">
            Смотреть кабинеты в Red One →
          </Link>
        </div>
          </div>
        </div>
      </div>
      </div>
      {primaryMarketProKey && primaryMarketOffers && (
        <PrimaryMarketProModal
          offers={primaryMarketOffers}
          initialCategoryKey={primaryMarketProKey}
          onClose={() => setPrimaryMarketProKey(null)}
        />
      )}
    </>
  );
}
