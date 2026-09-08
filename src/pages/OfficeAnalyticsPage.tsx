import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, TrendingUp } from 'lucide-react';
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
import { MIN_RELIABLE_N, SOURCE_LABELS, type ExternalMetric, type MarketSnapshot } from '../data/marketSnapshots';

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
  const [snapshots, setSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [error, setError] = useState(false);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetric[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('ofisy_bc')
      .then((rows) => {
        if (!cancelled) setSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    fetchExternalMetrics('ofisy_bc')
      .then((rows) => {
        if (!cancelled) setExternalMetrics(rows);
      })
      .catch(() => {
        /* внешние бенчмарки — необязательный дополнительный блок, страница
           остаётся полезной и без него, поэтому ошибку не показываем */
      });
    return () => {
      cancelled = true;
    };
  }, [deal]);

  const city = useMemo(() => snapshots?.find((s) => s.sliceType === 'city'), [snapshots]);
  const periodInLabel = city ? formatPeriodIn(city.period) : null;
  const byClass = useMemo(
    () =>
      (snapshots ?? [])
        .filter((s) => s.sliceType === 'class')
        .sort((a, b) => CLASS_ORDER.indexOf(a.sliceKey) - CLASS_ORDER.indexOf(b.sliceKey)),
    [snapshots],
  );
  const byDistrict = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [snapshots],
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

  const title =
    deal === 'rent' ? 'Ставки аренды офисов в бизнес-центрах Минска' : 'Цены на офисы в бизнес-центрах Минска';
  const periodLabel = city ? formatPeriod(city.period) : null;
  const fullTitle = periodLabel ? `${title} — ${periodLabel}` : title;
  const description =
    deal === 'rent'
      ? 'Медианная ставка аренды офисов в бизнес-центрах Минска по классам A/B+/B/C и районам — по объявлениям Kufar и Realt.'
      : 'Медианная цена продажи офисов в бизнес-центрах Минска по классам A/B+/B/C и районам — по объявлениям Kufar и Realt.';
  const url = `https://redevelopment.pro/minsk/analytics/ofisy/${deal === 'rent' ? 'arenda' : 'prodazha'}`;

  useEffect(() => {
    if (!snapshots) return;
    if (snapshots.length === 0) {
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
    const modified = city ? `${city.period}` : new Date().toISOString().slice(0, 10);
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
    const faq: { question: string; answer: string }[] = [];
    if (city && city.n >= MIN_RELIABLE_N && city.median != null) {
      faq.push({
        question:
          deal === 'rent'
            ? `Сколько стоит аренда офиса в бизнес-центре Минска в ${periodInLabel}?`
            : `Сколько стоит офис в бизнес-центре Минска в ${periodInLabel}?`,
        answer: `По медиане объявлений Kufar и Realt за ${periodLabel} — ${formatMoney(city.median, deal)} (по ${city.n} объявлениям, без разбивки по классу).`,
      });
    }
    const classA = byClass.find((s) => s.sliceKey === 'A');
    if (classA && classA.n >= MIN_RELIABLE_N && classA.median != null) {
      faq.push({
        question: deal === 'rent' ? 'Сколько стоит аренда офиса класса A?' : 'Сколько стоит офис класса A?',
        answer: `Медиана по классу A — ${formatMoney(classA.median, deal)} (${classA.n} объявлений за ${periodLabel}).`,
      });
    }
    faq.push({
      question: 'Чем ставка предложения отличается от ставки сделки?',
      answer:
        'Мы считаем медиану по действующим объявлениям (ставка предложения) — это то, что просят собственники сейчас, а не то, за сколько реально сдаются/продаются помещения. По оценке «Твоей столицы», ставка сделки обычно ниже ставки предложения примерно на 10%.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Из активных объявлений Kufar и Realt.by, привязанных к конкретным бизнес-центрам из нашего каталога. Подробности — на странице методики.',
    });
    setFaqJsonLd(faq);
  }, [snapshots, city, byClass, deal, fullTitle, description, url, periodLabel, periodInLabel, title]);

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
            / Офисы в бизнес-центрах / {deal === 'rent' ? 'Аренда' : 'Продажа'}
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
          {periodLabel && <p className="text-sm text-ink-muted">Обновлено: {periodLabel}</p>}
        </div>

        {error && (
          <div className={cn('p-6 text-ink-muted', glassCardClass)} style={glassCardShadow}>
            Не удалось загрузить данные. Попробуйте обновить страницу.
          </div>
        )}

        {!error && snapshots && snapshots.length === 0 && (
          <div className={cn('p-6 text-ink-muted', glassCardClass)} style={glassCardShadow}>
            Снимок за этот месяц ещё не построен — данные появятся после ближайшего автоматического сбора.
          </div>
        )}

        {city && (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Медиана по городу</span>
              <span className="text-2xl font-extrabold text-ink">
                {city.median != null ? formatMoney(city.median, deal) : '—'}
              </span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Учтено объявлений</span>
              <span className="text-2xl font-extrabold text-ink">{city.n}</span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Разброс (25–75%)</span>
              <span className="text-2xl font-extrabold text-ink">
                {city.p25 != null && city.p75 != null ? `${formatMoney(city.p25, deal)} – ${formatMoney(city.p75, deal)}` : '—'}
              </span>
            </div>
          </section>
        )}

        {byClass.length > 0 && (
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
                  {byClass.map((row) => {
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

        {byDistrict.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По районам</h2>
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
                  {byDistrict.map((row) => {
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

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Это медиана и 25–75-й перцентили цены за м² по активным объявлениям аренды{deal === 'sale' ? ' и продажи' : ''}{' '}
            офисных помещений внутри зданий из нашего{' '}
            <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
              каталога бизнес-центров Минска
            </Link>{' '}
            (сейчас 143 здания). Данные собираются с Kufar и Realt.by и обновляются раз в месяц — это{' '}
            <strong>ставка предложения</strong>, то, что собственники просят прямо сейчас, а не подтверждённая цена
            сделки. Срез по классу или району публикуется только при не менее {MIN_RELIABLE_N} объявлениях —
            меньшая выборка помечена как ориентировочная или скрыта вовсе, чтобы не выдавать случайный разброс
            нескольких объявлений за рыночную цену.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            За пределами каталога бизнес-центров в Минске сдаётся и продаётся заметно больше офисов — во
            встроенных помещениях жилых домов, административных зданиях, бывших НИИ. Эта часть рынка пока не
            попадает в срезы ниже: у неё нет единого справочника зданий, к которому можно привязать объявления.
            Планируем добавить такой срез отдельно.
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
