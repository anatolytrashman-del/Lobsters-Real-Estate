import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Landmark, TrendingUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import {
  setArticleJsonLd,
  setBreadcrumbJsonLd,
  setDatasetJsonLd,
  setFaqJsonLd,
  setGenericPageMeta,
  setNoIndex,
  clearNoIndex,
  setOrganizationJsonLd,
} from '../lib/pageMeta';
import { classHubUrl, districtHubUrl } from '../lib/businessCenterHubs';
import { fetchExternalMetrics, fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { fetchBusinessCenters } from '../lib/businessCentersApi';
import { fetchAllBusinessCenterOffers } from '../lib/businessCenterOffersApi';
import { MIN_RELIABLE_N, SOURCE_LABELS, type ExternalMetric, type MarketSnapshot } from '../data/marketSnapshots';
import type { BusinessCenter } from '../data/businessCenters';
import type { BusinessCenterOffer } from '../data/businessCenterOffers';

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

const MONTH_NAMES_PREPOSITIONAL = [
  'январе',
  'феврале',
  'марте',
  'апреле',
  'мае',
  'июне',
  'июле',
  'августе',
  'сентябре',
  'октябре',
  'ноябре',
  'декабре',
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

function formatPeriodIn(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES_PREPOSITIONAL[(m ?? 1) - 1]} ${y}`;
}

function formatMoney(n: number, deal: 'rent' | 'sale'): string {
  const rounded = deal === 'rent' ? Math.round(n * 10) / 10 : Math.round(n);
  return `$${rounded.toLocaleString('ru-RU')}${deal === 'rent' ? '/м²/мес' : '/м²'}`;
}

const UNIT_SUFFIX: Record<string, string> = {
  byn_per_sqm: ' BYN/м²',
  eur_per_sqm: ' EUR/м²',
  usd_per_sqm: '$/м²',
  percent: '%',
  thousand_sqm: ' тыс. м²',
};

function formatExternalValue(m: ExternalMetric): string {
  const rounded = Math.round(m.value * 10) / 10;
  const formatted = rounded.toLocaleString('ru-RU');
  return m.unit === 'usd_per_sqm' ? `$${formatted}` : `${formatted}${UNIT_SUFFIX[m.unit] ?? ` ${m.unit}`}`;
}

const CLASS_ORDER = ['A', 'B+', 'B', 'C'];

interface OfficeAnalyticsPageProps {
  deal: 'rent' | 'sale';
}

export function OfficeAnalyticsPage({ deal }: OfficeAnalyticsPageProps) {
  // Основные (city-wide) данные — сегмент 'ofisy': ВСЕ офисные объявления
  // Kufar/Realt по Минску, не только внутри каталога бизнес-центров (тот же
  // принцип, что уже даёт торговля/склады/машиноместа). Владелец,
  // 2026-09-08: "для этой страницы надо собирать полную статистику по
  // всему Минску... и делать конкретные объявления уже по бизнес-центру" —
  // раньше вся страница считалась только по 259 объявлениям внутри 143 БЦ
  // (смещённая выборка, офисы вне каталога вообще не попадали в цифры).
  const [cwSnapshots, setCwSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [cwError, setCwError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('ofisy')
      .then((rows) => {
        if (!cancelled) setCwSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        if (!cancelled) setCwError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deal]);

  // Узкий срез — сегмент 'ofisy_bc', только объявления внутри 143 зданий из
  // нашего каталога бизнес-центров. Не заменяет city-wide данные выше, а
  // дополняет их более глубокой детализацией (класс здания, конкретное
  // здание, площадь/этаж/метро) — того, что для произвольного офиса вне
  // каталога взять просто неоткуда (нет единого справочника таких зданий).
  const [bcSnapshots, setBcSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetric[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('ofisy_bc')
      .then((rows) => {
        if (!cancelled) setBcSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        /* узкий срез по БЦ — необязательный дополнительный блок, страница
           остаётся полезной и без него благодаря city-wide данным выше */
      });
    fetchExternalMetrics('ofisy_bc')
      .then((rows) => {
        if (!cancelled) setExternalMetrics(rows);
      })
      .catch(() => {
        /* внешние бенчмарки — необязательный дополнительный блок */
      });
    return () => {
      cancelled = true;
    };
  }, [deal]);

  // Каталог бизнес-центров — не зависит от deal, грузим один раз. Это
  // ДРУГОЙ датасет, чем снимок объявлений выше: справочник зданий сам по
  // себе (сколько их, сколько строится, площадь) не завязан на то, нашлись
  // ли по каждому активные объявления в этом месяце.
  const [centers, setCenters] = useState<BusinessCenter[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchBusinessCenters()
      .then((rows) => {
        if (!cancelled) setCenters(rows);
      })
      .catch(() => {
        /* каталожная сводка — необязательный дополнительный блок */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogStats = useMemo(() => {
    if (centers.length === 0) return null;
    const totalArea = centers.reduce((sum, c) => sum + (c.totalArea ?? 0), 0);
    const byClass = (['A', 'B+', 'B', 'C'] as const).map((cls) => ({
      cls,
      count: centers.filter((c) => c.businessClass === cls).length,
    }));
    const underConstruction = centers.filter((c) => c.status === 'under_construction');
    return { total: centers.length, totalArea, byClass, underConstruction };
  }, [centers]);

  // Сырые объявления внутри каталога БЦ — нужны для срезов, которых нет в
  // market_snapshots (площадь, этаж, метро, конкретное здание, сравнение
  // аренды и продажи). Загружаются один раз, не зависят от deal — оба типа
  // сделки нужны разом для блока "Аренда vs покупка".
  const [offers, setOffers] = useState<BusinessCenterOffer[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchAllBusinessCenterOffers()
      .then((rows) => {
        if (!cancelled) setOffers(rows);
      })
      .catch(() => {
        /* дополнительные срезы — необязательный блок */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Только офисные помещения (не "Сфера услуг"/"Торговые помещения" и
  // т.п. в том же здании) — тот же фильтр, что применяется при построении
  // снимка market_snapshots (см. scripts/build-market-snapshots.mjs).
  const officeOffers = useMemo(() => offers.filter((o) => o.propertyType === 'Офисы'), [offers]);
  const officeOffersForDeal = useMemo(() => officeOffers.filter((o) => o.dealType === deal), [officeOffers, deal]);

  const bySize = useMemo(() => {
    const buckets: { label: string; min: number; max: number }[] = [
      { label: 'до 30 м²', min: 0, max: 30 },
      { label: '30–60 м²', min: 30, max: 60 },
      { label: '60–120 м²', min: 60, max: 120 },
      { label: '120–300 м²', min: 120, max: 300 },
      { label: 'от 300 м²', min: 300, max: Infinity },
    ];
    return buckets
      .map((b) => {
        const prices = officeOffersForDeal.filter((o) => o.size >= b.min && o.size < b.max).map((o) => o.pricePerSqm);
        return { ...b, n: prices.length, median: prices.length > 0 ? median(prices) : null };
      })
      .filter((b) => b.n > 0);
  }, [officeOffersForDeal]);

  const byFloor = useMemo(() => {
    const buckets: { label: string; test: (f: number) => boolean }[] = [
      { label: '1-й этаж', test: (f) => f === 1 },
      { label: '2–5 этаж', test: (f) => f >= 2 && f <= 5 },
      { label: '6-й этаж и выше', test: (f) => f >= 6 },
    ];
    return buckets
      .map((b) => {
        const prices = officeOffersForDeal
          .filter((o) => o.floor != null && b.test(o.floor))
          .map((o) => o.pricePerSqm);
        return { label: b.label, n: prices.length, median: prices.length > 0 ? median(prices) : null };
      })
      .filter((b) => b.n > 0);
  }, [officeOffersForDeal]);

  const nearestMetroBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of centers) {
      const first = c.nearestMetroStations[0];
      if (first) map.set(c.slug, first.name);
    }
    return map;
  }, [centers]);

  const byMetro = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const o of officeOffersForDeal) {
      const stationName = nearestMetroBySlug.get(o.businessCenterSlug);
      if (!stationName) continue;
      if (!grouped.has(stationName)) grouped.set(stationName, []);
      grouped.get(stationName)!.push(o.pricePerSqm);
    }
    return [...grouped.entries()]
      .map(([station, prices]) => ({ station, n: prices.length, median: median(prices) }))
      .filter((row) => row.n >= 8)
      .sort((a, b) => b.n - a.n);
  }, [officeOffersForDeal, nearestMetroBySlug]);

  const centerBySlug = useMemo(() => new Map(centers.map((c) => [c.slug, c])), [centers]);
  const byBuilding = useMemo(() => {
    const grouped = new Map<string, number[]>();
    for (const o of officeOffersForDeal) {
      if (!grouped.has(o.businessCenterSlug)) grouped.set(o.businessCenterSlug, []);
      grouped.get(o.businessCenterSlug)!.push(o.pricePerSqm);
    }
    return [...grouped.entries()]
      .map(([slug, prices]) => ({
        slug,
        name: centerBySlug.get(slug)?.name ?? slug,
        n: prices.length,
        median: median(prices),
      }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
  }, [officeOffersForDeal, centerBySlug]);

  // Аренда vs покупка — грубая оценка окупаемости по классу, не зависит от
  // текущего deal страницы (нужны оба типа сделки разом). "Ориентировочно"
  // всегда — это не настоящая доходность (не учитывает расходы, простой,
  // налоги), просто медиана продажи ÷ (медиана аренды × 12).
  const yieldByClass = useMemo(() => {
    return (['A', 'B+', 'B', 'C'] as const)
      .map((cls) => {
        const rentPrices = officeOffers
          .filter((o) => o.dealType === 'rent' && centerBySlug.get(o.businessCenterSlug)?.businessClass === cls)
          .map((o) => o.pricePerSqm);
        const salePrices = officeOffers
          .filter((o) => o.dealType === 'sale' && centerBySlug.get(o.businessCenterSlug)?.businessClass === cls)
          .map((o) => o.pricePerSqm);
        if (rentPrices.length < 8 || salePrices.length < 8) return null;
        const rentMedian = median(rentPrices);
        const saleMedian = median(salePrices);
        const paybackYears = saleMedian / (rentMedian * 12);
        return { cls, rentN: rentPrices.length, saleN: salePrices.length, rentMedian, saleMedian, paybackYears };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }, [officeOffers, centerBySlug]);

  // --- City-wide (первичные) срезы ---
  const cwCity = useMemo(() => cwSnapshots?.find((s) => s.sliceType === 'city'), [cwSnapshots]);
  const periodInLabel = cwCity ? formatPeriodIn(cwCity.period) : null;
  const periodLabel = cwCity ? formatPeriod(cwCity.period) : null;
  const cwByDistrict = useMemo(
    () => (cwSnapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [cwSnapshots],
  );
  const cwByBuildingType = useMemo(
    () => (cwSnapshots ?? []).filter((s) => s.sliceType === 'building_type').sort((a, b) => b.n - a.n),
    [cwSnapshots],
  );
  const cwReliableDistricts = useMemo(
    () =>
      cwByDistrict
        .filter((r) => r.n >= MIN_RELIABLE_N && r.median != null)
        .sort((a, b) => (b.median as number) - (a.median as number)),
    [cwByDistrict],
  );
  const priciestDistrict = cwReliableDistricts[0] ?? null;
  const cheapestDistrict = cwReliableDistricts.length > 0 ? cwReliableDistricts[cwReliableDistricts.length - 1] : null;

  // --- Узкий срез по каталогу БЦ ---
  const bcCity = useMemo(() => bcSnapshots?.find((s) => s.sliceType === 'city'), [bcSnapshots]);
  const bcByClass = useMemo(
    () =>
      (bcSnapshots ?? [])
        .filter((s) => s.sliceType === 'class')
        .sort((a, b) => CLASS_ORDER.indexOf(a.sliceKey) - CLASS_ORDER.indexOf(b.sliceKey)),
    [bcSnapshots],
  );
  const bcByDistrict = useMemo(
    () => (bcSnapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [bcSnapshots],
  );

  const tvoyaStolitsaByClass = useMemo(
    () =>
      externalMetrics.filter(
        (m) => m.source === 'tvoya-stolitsa' && m.deal === deal && m.metric.startsWith('median_price_per_sqm'),
      ),
    [externalMetrics, deal],
  );
  const marketWide = useMemo(() => externalMetrics.filter((m) => m.deal === null), [externalMetrics]);
  const vacancyOverall = marketWide.find((m) => m.source === 'colliers' && m.metric === 'vacancy_rate' && m.sliceKey === null);
  // Вакантность Colliers по ИХ собственным классам (A/B1/B2 — не то же
  // самое, что наши A/B+/B/C, см. методику) — отдельная мини-таблица, не
  // смешиваем со своим срезом bcByClass ниже.
  const colliersVacancyByClass = useMemo(
    () =>
      marketWide.filter((m) => m.source === 'colliers' && m.metric === 'vacancy_rate' && m.sliceKey != null),
    [marketWide],
  );
  const totalStock = marketWide.find((m) => m.metric === 'total_stock');
  const newSupply = marketWide.find((m) => m.metric === 'new_supply');
  // «Результативная недвижимость» (belretail.by, 2026-09-08) — свежее (H1
  // 2026, не годовой отчёт), но по своей узкой классификации "качественных"
  // БЦ классов B+/B- (НЕ то же самое, что наше A/B+/B/C или Colliers'
  // A/B1/B2) — показываем рядом с Colliers, не вместо, с явной оговоркой.
  const rnVacancy = marketWide.find((m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'vacancy_rate');
  const rnNewSupplyForecast = marketWide.find(
    (m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'new_supply_forecast_2026',
  );
  // rate_b_plus/rate_b_minus — ставки АРЕНДЫ конкретно (deal='rent', не
  // null, как у остальных "рынок в целом" метрик), поэтому не из marketWide
  // — ищем прямо в externalMetrics по текущей странице (deal==='rent').
  const rnRateBPlus = externalMetrics.find(
    (m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'rate_b_plus' && m.deal === 'rent',
  );
  const rnRateBMinus = externalMetrics.find(
    (m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'rate_b_minus' && m.deal === 'rent',
  );
  // Реестр Госкомимущества — уже приходит вместе с остальными external
  // metrics сегмента 'ofisy_bc' (та же fetchExternalMetrics).
  const goskomDeals = marketWide.find((m) => m.source === 'goskomimushchestvo' && m.metric === 'registered_deals');
  const goskomShare = marketWide.find((m) => m.source === 'goskomimushchestvo' && m.metric === 'turnover_share_pct');

  const title = deal === 'rent' ? 'Ставки аренды офисов в Минске' : 'Цены на офисы в Минске';
  const fullTitle = periodLabel ? `${title} — ${periodLabel}` : title;
  const description =
    deal === 'rent'
      ? 'Медианная ставка аренды офисов в Минске по районам и типу здания — по объявлениям Kufar и Realt, плюс детальный разбор по бизнес-центрам.'
      : 'Медианная цена продажи офисов в Минске по районам и типу здания — по объявлениям Kufar и Realt, плюс детальный разбор по бизнес-центрам.';
  const url = `https://redevelopment.pro/minsk/analytics/ofisy/${deal === 'rent' ? 'arenda' : 'prodazha'}`;

  // Вынесено из useEffect в useMemo — раньше собиралось только для JSON-LD,
  // теперь тот же массив ещё и рендерится видимым блоком «Частые вопросы»
  // (см. BusinessCenterDetailPage.tsx — тот же паттерн).
  const faqItems = useMemo(() => {
    if (!cwSnapshots || cwSnapshots.length === 0) return [];
    const faq: { question: string; answer: string }[] = [];
    if (cwCity && cwCity.n >= MIN_RELIABLE_N && cwCity.median != null) {
      faq.push({
        question:
          deal === 'rent'
            ? `Сколько стоит аренда офиса в Минске в ${periodInLabel}?`
            : `Сколько стоит офис в Минске в ${periodInLabel}?`,
        answer: `По медиане объявлений Kufar и Realt за ${periodLabel} — ${formatMoney(cwCity.median, deal)} (по ${cwCity.n} объявлениям по всему городу).`,
      });
    }
    const classA = bcByClass.find((s) => s.sliceKey === 'A');
    if (classA && classA.n >= MIN_RELIABLE_N && classA.median != null) {
      faq.push({
        question: deal === 'rent' ? 'Сколько стоит аренда офиса класса A?' : 'Сколько стоит офис класса A?',
        answer: `Медиана по классу A внутри нашего каталога бизнес-центров — ${formatMoney(classA.median, deal)} (${classA.n} объявлений за ${periodLabel}).`,
      });
    }
    faq.push({
      question: 'Чем класс A отличается от B+, B и C?',
      answer:
        'Класс — это не наша оценка, а деление отраслевых источников (в частности, «Твоей столицы») по качеству здания: инженерия, отделка мест общего пользования, парковка, управляющая компания, репутация арендаторов. Чем выше класс, тем выше ставка — переплата обычно оправдана представительским статусом и качеством инфраструктуры, а не только адресом.',
    });
    faq.push({
      question: 'Чем ставка предложения отличается от ставки сделки?',
      answer:
        'Мы считаем медиану по действующим объявлениям (ставка предложения) — это то, что просят собственники сейчас, а не то, за сколько реально сдаются/продаются помещения. По оценке «Твоей столицы», ставка сделки обычно ниже ставки предложения примерно на 10%.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Из активных объявлений Kufar и Realt.by, категория «Офисы» по всему Минску. Отдельно — более глубокий разбор по 143 зданиям из нашего каталога бизнес-центров. Подробности — на странице методики.',
    });
    return faq;
  }, [cwSnapshots, cwCity, bcByClass, deal, periodLabel, periodInLabel]);

  useEffect(() => {
    if (!cwSnapshots) return;
    if (cwSnapshots.length === 0) {
      setNoIndex();
      return;
    }
    clearNoIndex();
    setGenericPageMeta({ title: fullTitle, description, url, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка', url: 'https://redevelopment.pro/minsk/analytics' },
      { name: title },
    ]);
    const modified = cwCity ? `${cwCity.period}` : new Date().toISOString().slice(0, 10);
    setArticleJsonLd({
      headline: fullTitle,
      description,
      url,
      datePublished: '2026-09-07',
      dateModified: modified,
    });
    setDatasetJsonLd({
      name: fullTitle,
      description,
      url,
      datePublished: '2026-09-07',
      dateModified: modified,
      measurementTechnique: 'Медиана и перцентили цены за м² по активным объявлениям Kufar и Realt, срез по месяцу',
    });
    setFaqJsonLd(faqItems);
  }, [cwSnapshots, cwCity, faqItems, fullTitle, description, url, title]);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 sm:px-8">
          <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </Link>
        </div>
      </div>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            <Link to="/minsk/analytics" className="hover:text-primary-hover">
              Аналитика рынка
            </Link>{' '}
            / Офисы / {deal === 'rent' ? 'Аренда' : 'Продажа'}
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
          {periodLabel && <p className="text-sm text-ink-muted">Обновлено: {periodLabel}</p>}
        </div>

        {!cwError && cwSnapshots === null && <p className="text-sm text-ink-muted">Загрузка…</p>}

        {cwError && (
          <div className={cn('p-6 text-ink-muted', glassCardClass)} style={glassCardShadow}>
            Не удалось загрузить данные. Попробуйте обновить страницу.
          </div>
        )}

        {!cwError && cwSnapshots && cwSnapshots.length === 0 && (
          <div className={cn('p-6 text-ink-muted', glassCardClass)} style={glassCardShadow}>
            Снимок за этот месяц ещё не построен — данные появятся после ближайшего автоматического сбора.
          </div>
        )}

        {cwCity && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Медиана по городу</span>
              <span className="text-2xl font-extrabold text-ink">
                {cwCity.median != null ? formatMoney(cwCity.median, deal) : '—'}
              </span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Учтено объявлений</span>
              <span className="text-2xl font-extrabold text-ink">{cwCity.n}</span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Разброс (25–75%)</span>
              <span className="text-2xl font-extrabold text-ink">
                {cwCity.p25 != null && cwCity.p75 != null ? `${formatMoney(cwCity.p25, deal)} – ${formatMoney(cwCity.p75, deal)}` : '—'}
              </span>
            </div>
          </section>
        )}

        {cwByDistrict.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По районам</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Район</th>
                    <th className="px-3 py-2">Медиана</th>
                    <th className="px-3 py-2">Объявлений</th>
                  </tr>
                </thead>
                <tbody>
                  {cwByDistrict.map((row) => {
                    const reliable = row.n >= MIN_RELIABLE_N && row.median != null;
                    return (
                      <tr key={row.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">{row.sliceKey}</td>
                        <td className="px-3 py-2 text-ink">
                          {reliable ? (
                            formatMoney(row.median as number, deal)
                          ) : (
                            <span className="text-ink-faint">
                              {row.median != null ? `${formatMoney(row.median, deal)} (ориентировочно)` : 'недостаточно данных'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{row.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {cwByBuildingType.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По типу здания</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Тип здания</th>
                    <th className="px-3 py-2">Медиана</th>
                    <th className="px-3 py-2">Объявлений</th>
                  </tr>
                </thead>
                <tbody>
                  {cwByBuildingType.map((row) => {
                    const reliable = row.n >= MIN_RELIABLE_N && row.median != null;
                    return (
                      <tr key={row.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">{row.sliceKey}</td>
                        <td className="px-3 py-2 text-ink">
                          {reliable ? (
                            formatMoney(row.median as number, deal)
                          ) : (
                            <span className="text-ink-faint">
                              {row.median != null ? `${formatMoney(row.median, deal)} (ориентировочно)` : 'недостаточно данных'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{row.n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Тип здания известен не для всех объявлений (структурное поле есть у Kufar, у Realt — эвристика по
              тексту объявления, менее точная; часть объявлений без определённого типа в таблицу не попала, но
              учтена в общей медиане по городу выше).
            </p>
          </section>
        )}

        {(vacancyOverall || totalStock || newSupply || rnVacancy || rnNewSupplyForecast) && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Рынок в целом</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {vacancyOverall && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Вакантность офисов ({vacancyOverall.period}, Colliers)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(vacancyOverall)}</span>
                </div>
              )}
              {rnVacancy && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Вакантность качественных БЦ ({rnVacancy.period}, Результ. недв.)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnVacancy)}</span>
                </div>
              )}
              {totalStock && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Всего офисных площадей ({totalStock.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(totalStock)}</span>
                </div>
              )}
              {newSupply && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Введено новых площадей ({newSupply.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(newSupply)}</span>
                </div>
              )}
              {rnNewSupplyForecast && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Прогноз ввода до конца {rnNewSupplyForecast.period}
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnNewSupplyForecast)}</span>
                </div>
              )}
              {deal === 'rent' && rnRateBPlus && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Ставка B+ ({rnRateBPlus.period}, Результ. недв.)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnRateBPlus)}</span>
                </div>
              )}
              {deal === 'rent' && rnRateBMinus && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Ставка B- ({rnRateBMinus.period}, Результ. недв.)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnRateBMinus)}</span>
                </div>
              )}
            </div>
            {colliersVacancyByClass.length > 0 && (
              <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
                <table className="w-full min-w-[280px] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                      <th className="px-3 py-2">Класс (по Colliers)</th>
                      <th className="px-3 py-2 text-right">Вакантность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {colliersVacancyByClass.map((m) => (
                      <tr key={m.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">Класс {m.sliceKey}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink">{formatExternalValue(m)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-ink-faint">
              Вакантность, сток и новое предложение — по данным {SOURCE_LABELS.colliers ?? 'Colliers International'}
              {vacancyOverall?.url && (
                <>
                  {' '}
                  (
                  <a href={vacancyOverall.url} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">
                    отчёт
                  </a>
                  )
                </>
              )}
              , весь рынок офисов Минска на конец 2025, не только бизнес-центры из нашего каталога. Свежая
              вакантность и ставки B+/B- — по данным {SOURCE_LABELS['rezultativnaya-nedvizhimost']}
              {rnVacancy?.url && (
                <>
                  {' '}
                  (
                  <a href={rnVacancy.url} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">
                    отчёт
                  </a>
                  )
                </>
              )}
              , за 1-е полугодие 2026, только «качественные» БЦ — их деление на B+/B- не совпадает точно с нашим
              A/B+/B/C или классификацией Colliers, сравнивать классы между источниками напрямую нельзя.
            </p>
          </section>
        )}

        {(goskomDeals || goskomShare) && (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Landmark className="h-4 w-4 shrink-0 text-ink-faint" />
              Реестр реальных сделок (Госкомимущество)
            </h2>
            <p className="text-sm text-ink-muted">
              Отдельно от нашей медианы по объявлениям — официальная статистика уже <strong>закрытых</strong> сделок
              купли-продажи офисов в Минске, зарегистрированных Госкомимуществом за 1-е полугодие 2026 года.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {goskomDeals && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Зарегистрировано сделок ({goskomDeals.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{goskomDeals.value}</span>
                </div>
              )}
              {goskomShare && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Доля офисов в обороте рынка ({goskomShare.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{goskomShare.value}%</span>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-faint">
              Это <strong>сделки</strong>, а не наши медианы по активным объявлениям (те — ставка предложения, эти —
              подтверждённая цена продажи). Данные Госкомимущества, перепроверены по двум независимым публикациям
              (Минск-Новости, BelRetail).{' '}
              {goskomDeals?.url && (
                <a href={goskomDeals.url} target="_blank" rel="noopener noreferrer" className="text-primary-hover hover:underline">
                  Источник
                </a>
              )}
              {' · '}
              <Link to="/minsk/analytics" className="text-primary-hover hover:underline">
                Реестр по всем сегментам
              </Link>
            </p>
          </section>
        )}

        {/* ---- Узкий срез: офисы внутри каталога бизнес-центров ---- */}
        <section className="flex flex-col gap-2 border-t border-border pt-8">
          <h2 className="text-xl font-extrabold text-ink">Офисы в бизнес-центрах: подробный разбор</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Отдельный, более глубокий срез — только по 143 зданиям из нашего{' '}
            <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
              каталога бизнес-центров Минска
            </Link>
            . Это подмножество city-wide цифр выше — для него мы знаем класс здания, конкретный адрес и другие
            детали, которых для произвольного офиса вне каталога взять неоткуда.
          </p>
        </section>

        {bcCity && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Медиана по каталогу БЦ</span>
              <span className="text-2xl font-extrabold text-ink">
                {bcCity.median != null ? formatMoney(bcCity.median, deal) : '—'}
              </span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Учтено объявлений</span>
              <span className="text-2xl font-extrabold text-ink">{bcCity.n}</span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Разброс (25–75%)</span>
              <span className="text-2xl font-extrabold text-ink">
                {bcCity.p25 != null && bcCity.p75 != null ? `${formatMoney(bcCity.p25, deal)} – ${formatMoney(bcCity.p75, deal)}` : '—'}
              </span>
            </div>
          </section>
        )}

        {bcByClass.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По классу здания</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Класс</th>
                    <th className="px-3 py-2">Медиана</th>
                    <th className="px-3 py-2">Объявлений</th>
                    {tvoyaStolitsaByClass.length > 0 && <th className="px-3 py-2">По данным Твоей столицы</th>}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bcByClass.map((row) => {
                    const reliable = row.n >= MIN_RELIABLE_N && row.median != null;
                    const external = tvoyaStolitsaByClass.filter((m) => m.sliceKey === row.sliceKey);
                    return (
                      <tr key={row.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">Класс {row.sliceKey}</td>
                        <td className="px-3 py-2 text-ink">
                          {reliable ? (
                            formatMoney(row.median as number, deal)
                          ) : (
                            <span className="text-ink-faint">
                              {row.median != null ? `${formatMoney(row.median, deal)} (ориентировочно)` : 'недостаточно данных'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{row.n}</td>
                        {tvoyaStolitsaByClass.length > 0 && (
                          <td className="px-3 py-2 text-ink-muted">
                            {external.length > 0
                              ? external.map((m) => formatExternalValue(m)).join(' / ')
                              : '—'}
                          </td>
                        )}
                        <td className="px-3 py-2 text-right">
                          <Link
                            to={classHubUrl(row.sliceKey as 'A' | 'B+' | 'B' | 'C')}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary-hover hover:underline"
                          >
                            Смотреть БЦ <ArrowRight className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {tvoyaStolitsaByClass.length > 0 && (
              <p className="text-xs text-ink-faint">
                Наша колонка — медиана по объявлениям Kufar/Realt в долларах США. Колонка «Твоя столица» — в
                собственной валюте источника ({deal === 'rent' ? 'BYN / EUR за м²/мес' : 'USD за м²'}), напрямую с
                нашей медианой не пересчитывается — курсы и методика разные, это ориентир, а не точное сравнение.
              </p>
            )}
          </section>
        )}

        {deal === 'rent' && bcByClass.some((r) => r.n >= MIN_RELIABLE_N && r.median != null) && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Сколько это в реальных деньгах в месяц</h2>
            <p className="text-sm text-ink-muted">
              Медиана за м² — не самая наглядная цифра сама по себе. Вот та же медиана по классу, пересчитанная на
              типовые площади офиса.
            </p>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Класс</th>
                    <th className="px-3 py-2 text-right">20 м²</th>
                    <th className="px-3 py-2 text-right">50 м²</th>
                    <th className="px-3 py-2 text-right">100 м²</th>
                    <th className="px-3 py-2 text-right">200 м²</th>
                  </tr>
                </thead>
                <tbody>
                  {bcByClass
                    .filter((row) => row.n >= MIN_RELIABLE_N && row.median != null)
                    .map((row) => (
                      <tr key={row.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">Класс {row.sliceKey}</td>
                        {[20, 50, 100, 200].map((size) => (
                          <td key={size} className="px-3 py-2 text-right tabular-nums text-ink">
                            ${Math.round((row.median as number) * size).toLocaleString('ru-RU')}
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Без учёта коммунальных платежей и НДС — только сама ставка аренды из медианы выше, умноженная на площадь.
            </p>
          </section>
        )}

        {bcByDistrict.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По районам (только каталог БЦ)</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Район</th>
                    <th className="px-3 py-2">Медиана</th>
                    <th className="px-3 py-2">Объявлений</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bcByDistrict.map((row) => {
                    const reliable = row.n >= MIN_RELIABLE_N && row.median != null;
                    const hubUrl = districtHubUrl(row.sliceKey);
                    return (
                      <tr key={row.sliceKey} className="border-t border-border">
                        <td className="px-3 py-2 font-medium text-ink">{row.sliceKey}</td>
                        <td className="px-3 py-2 text-ink">
                          {reliable ? (
                            formatMoney(row.median as number, deal)
                          ) : (
                            <span className="text-ink-faint">
                              {row.median != null ? `${formatMoney(row.median, deal)} (ориентировочно)` : 'недостаточно данных'}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{row.n}</td>
                        <td className="px-3 py-2 text-right">
                          {hubUrl && (
                            <Link
                              to={hubUrl}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary-hover hover:underline"
                            >
                              Смотреть БЦ <ArrowRight className="h-3 w-3" />
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {catalogStats && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Каталог бизнес-центров в цифрах</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Зданий в каталоге</span>
                <span className="text-xl font-extrabold text-ink">{catalogStats.total}</span>
              </div>
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Суммарная площадь</span>
                <span className="text-xl font-extrabold text-ink">
                  {Math.round(catalogStats.totalArea).toLocaleString('ru-RU')} м²
                </span>
              </div>
              {catalogStats.byClass.map(({ cls, count }) => (
                <div key={cls} className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Класс {cls}</span>
                  <span className="text-xl font-extrabold text-ink">{count}</span>
                </div>
              ))}
            </div>
            {catalogStats.underConstruction.length > 0 && (
              <p className="text-sm text-ink-muted">
                Сейчас строится {catalogStats.underConstruction.length}:{' '}
                {catalogStats.underConstruction.map((c, i) => (
                  <span key={c.slug}>
                    <Link to={`/minsk/bcminsk/${c.slug}`} className="text-primary-hover hover:underline">
                      {c.name}
                    </Link>
                    {i < catalogStats.underConstruction.length - 1 ? ', ' : ''}
                  </span>
                ))}
                .
              </p>
            )}
            <Link
              to="/minsk/bcminsk"
              className="inline-flex w-fit items-center gap-1 text-sm text-primary-hover hover:underline"
            >
              Смотреть весь каталог бизнес-центров
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </section>
        )}

        {(bySize.length > 0 || byFloor.length > 0) && (
          <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {bySize.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-bold text-ink">По площади помещения</h2>
                <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
                  <table className="w-full min-w-[280px] text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                        <th className="px-3 py-2">Площадь</th>
                        <th className="px-3 py-2 text-right">Медиана</th>
                        <th className="px-3 py-2 text-right">Объявлений</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bySize.map((b) => (
                        <tr key={b.label} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-ink">{b.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">
                            {b.median != null ? (
                              <>
                                {formatMoney(b.median, deal)}
                                {b.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {byFloor.length > 0 && (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-bold text-ink">По этажу</h2>
                <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
                  <table className="w-full min-w-[280px] text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                        <th className="px-3 py-2">Этаж</th>
                        <th className="px-3 py-2 text-right">Медиана</th>
                        <th className="px-3 py-2 text-right">Объявлений</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byFloor.map((b) => (
                        <tr key={b.label} className="border-t border-border">
                          <td className="px-3 py-2 font-medium text-ink">{b.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink">
                            {b.median != null ? (
                              <>
                                {formatMoney(b.median, deal)}
                                {b.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{b.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-ink-faint">Этаж известен не для всех объявлений (обычно у Kufar, не у Realt).</p>
              </div>
            )}
          </section>
        )}

        {byMetro.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По станции метро</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[320px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Ближайшая станция</th>
                    <th className="px-3 py-2 text-right">Медиана</th>
                    <th className="px-3 py-2 text-right">Объявлений</th>
                  </tr>
                </thead>
                <tbody>
                  {byMetro.map((row) => (
                    <tr key={row.station} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">«{row.station}»</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {formatMoney(row.median, deal)}
                        {row.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              По зданию, ближайшему к каждой станции (не по фактическому пешеходному времени). Станции с менее чем 8
              объявлениями в подборку не попали.
            </p>
          </section>
        )}

        {byBuilding.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Лидеры по числу объявлений</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Здание</th>
                    <th className="px-3 py-2 text-right">Медиана</th>
                    <th className="px-3 py-2 text-right">Объявлений</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {byBuilding.map((row) => (
                    <tr key={row.slug} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {formatMoney(row.median, deal)}
                        {row.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{row.n}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          to={`/minsk/bcminsk/${row.slug}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary-hover hover:underline"
                        >
                          Карточка БЦ <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {yieldByClass.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Аренда vs покупка: во сколько лет окупается офис</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Класс</th>
                    <th className="px-3 py-2 text-right">Аренда</th>
                    <th className="px-3 py-2 text-right">Продажа</th>
                    <th className="px-3 py-2 text-right">Окупаемость</th>
                  </tr>
                </thead>
                <tbody>
                  {yieldByClass.map((row) => (
                    <tr key={row.cls} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">Класс {row.cls}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{formatMoney(row.rentMedian, 'rent')}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{formatMoney(row.saleMedian, 'sale')}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">~{row.paybackYears.toFixed(1)} лет</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Грубая оценка (медиана продажи ÷ медиана годовой аренды), не настоящая доходность — не учитывает
              простой, налоги, эксплуатационные расходы и разницу в конкретных объектах между выборками аренды и
              продажи.
            </p>
          </section>
        )}

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Верхняя часть страницы — медиана и 25–75-й перцентили цены за м² по активным объявлениям аренды
            {deal === 'sale' ? ' и продажи' : ''} офисных помещений по всему Минску (категория «Офисы» на Kufar и
            Realt.by), без привязки к конкретному зданию. Нижняя часть — тот же принцип, но только для 143 зданий из
            нашего{' '}
            <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
              каталога бизнес-центров Минска
            </Link>{' '}
            — там мы дополнительно знаем класс здания и конкретный адрес. Данные собираются с Kufar и Realt.by и
            обновляются раз в месяц — это <strong>ставка предложения</strong>, то, что собственники просят прямо
            сейчас, а не подтверждённая цена сделки. Срез публикуется только при не менее {MIN_RELIABLE_N}{' '}
            объявлениях — меньшая выборка помечена как ориентировочная или скрыта вовсе, чтобы не выдавать случайный
            разброс нескольких объявлений за рыночную цену.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            Дедупликации между Kufar и Realt.by в узком срезе по каталогу БЦ нет (известное ограничение — там нет
            общего ключа для сопоставления дублей между площадками); в city-wide срезе выше дедупликация есть
            (совпадающие по улице, дому, площади, этажу и типу сделки объявления с обеих площадок считаются один
            раз).
          </p>
          <p className="text-sm text-ink-muted">
            Подробная методика — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            . Источники: Kufar (re.kufar.by), Realt.by
            {externalMetrics.length > 0 && ', Твоя столица (t-s.by), Colliers International, Результативная недвижимость (belretail.by)'}.
          </p>
        </section>

        <section className={cn('flex flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">О рынке офисов в Минске</h2>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">Что влияет на ставку</h3>
            <p className="text-sm leading-relaxed text-ink-muted">
              Класс здания — самый заметный фактор внутри каталога бизнес-центров (см. таблицу выше), но ставка ещё
              зависит от района (см. «По районам»), типа здания (офис в бизнес-центре обычно дороже, чем встройка в
              жилой дом), этажа, площади помещения (мелкая нарезка обычно дороже за м², чем крупные блоки) и
              состояния отделки. Наличие своей парковки и репутация управляющей компании тоже сказываются, но эти
              данные структурно не публикуются площадками — их приходится узнавать напрямую у арендодателя или на{' '}
              <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
                карточке конкретного здания
              </Link>
              .
            </p>
          </div>
          {(priciestDistrict || cheapestDistrict) && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">Где дороже, где доступнее</h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                {priciestDistrict && (
                  <>
                    Дороже всего по нашим данным — {priciestDistrict.sliceKey} район, медиана{' '}
                    {formatMoney(priciestDistrict.median as number, deal)}.{' '}
                  </>
                )}
                {cheapestDistrict && cheapestDistrict.sliceKey !== priciestDistrict?.sliceKey && (
                  <>
                    Доступнее всего — {cheapestDistrict.sliceKey} район, {formatMoney(cheapestDistrict.median as number, deal)}.{' '}
                  </>
                )}
                Разница между районами обычно объясняется не столько удалённостью от центра, сколько тем, какие
                здания там сосредоточены — старые встройки в жилые дома или современные бизнес-центры.
              </p>
            </div>
          )}
          {catalogStats && catalogStats.underConstruction.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">Что сейчас строится</h3>
              <p className="text-sm leading-relaxed text-ink-muted">
                В стройке — {catalogStats.underConstruction.length}{' '}
                {catalogStats.underConstruction.length === 1 ? 'здание' : 'здания'}:{' '}
                {catalogStats.underConstruction.map((c, i) => (
                  <span key={c.slug}>
                    <Link to={`/minsk/bcminsk/${c.slug}`} className="text-primary-hover hover:underline">
                      {c.name}
                    </Link>
                    {i < catalogStats.underConstruction.length - 1 ? ', ' : ''}
                  </span>
                ))}
                . Новое предложение обычно снижает давление на ставки в затронутых районах не сразу — эффект заметен
                через несколько месяцев после сдачи, когда здание начинает реально конкурировать за арендаторов.
                {rnNewSupplyForecast &&
                  ` По оценке «Результативной недвижимости», всего до конца ${rnNewSupplyForecast.period} года на рынок Минска выйдет ещё около ${formatExternalValue(rnNewSupplyForecast)}.`}
              </p>
            </div>
          )}
        </section>

        {faqItems.length > 0 && (
          <section className={cn('flex flex-col gap-4 p-6', glassCardClass)} style={glassCardShadow}>
            <h2 className="text-lg font-bold text-ink">Частые вопросы</h2>
            <div className="flex flex-col divide-y divide-border">
              {faqItems.map((item) => (
                <div key={item.question} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">{item.question}</p>
                  <p className="text-sm leading-relaxed text-ink-muted">{item.answer}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">Смотрите также</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to={`/minsk/analytics/torgovye/${deal === 'rent' ? 'arenda' : 'prodazha'}`}
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="font-medium text-ink">Торговые помещения и ПСН</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to={`/minsk/analytics/sklady/${deal === 'rent' ? 'arenda' : 'prodazha'}`}
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="font-medium text-ink">Склады</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/bcminsk/reyting"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="font-medium text-ink">Рейтинг лучших бизнес-центров Минска</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics/rajony"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="font-medium text-ink">Где дороже и дешевле — сравнение районов по всем сегментам</span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </div>
        </section>

        <section className={cn('flex items-center justify-between gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-bold text-ink">
              <TrendingUp className="h-4 w-4 shrink-0 text-primary-hover" />
              {deal === 'rent' ? 'Кабинет в собственность вместо аренды' : 'Кабинеты 11–40 м² от $12 000'}
            </span>
            <span className="text-sm text-ink-muted">
              {deal === 'rent'
                ? 'Деловой центр Red One в Минск Мире — приватные кабинеты и рабочие места в собственность.'
                : 'Деловой центр Red One в Минск Мире — приватные кабинеты в собственность вместо аренды.'}
            </span>
          </div>
          <Link
            to="/minsk/one"
            className="shrink-0 rounded-control bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
          >
            Смотреть Red One
          </Link>
        </section>
      </main>
    </div>
  );
}
