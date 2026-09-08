import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { fetchExternalMetrics, fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { MIN_RELIABLE_N, SOURCE_LABELS, type ExternalMetric, type MarketSnapshot } from '../data/marketSnapshots';

const UNIT_SUFFIX: Record<string, string> = {
  percent: '%',
  thousand_sqm: ' тыс. м²',
};

function formatExternalValue(m: ExternalMetric): string {
  const rounded = Math.round(m.value * 10) / 10;
  return `${rounded.toLocaleString('ru-RU')}${UNIT_SUFFIX[m.unit] ?? ` ${m.unit}`}`;
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

interface RetailAnalyticsPageProps {
  deal: 'rent' | 'sale';
}

export function RetailAnalyticsPage({ deal }: RetailAnalyticsPageProps) {
  const [snapshots, setSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [error, setError] = useState(false);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetric[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('torgovye')
      .then((rows) => {
        if (!cancelled) setSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    fetchExternalMetrics('torgovye')
      .then((rows) => {
        if (!cancelled) setExternalMetrics(rows);
      })
      .catch(() => {
        /* внешний бенчмарк — необязательный дополнительный блок */
      });
    return () => {
      cancelled = true;
    };
  }, [deal]);

  // «Результативная недвижимость» (belretail.by, 2026-09-08) — первый
  // внешний бенчмарк для торговых помещений вообще (раньше подходящего
  // источника не было, см. методику). Только вакантность и прогноз ввода —
  // конкретных цифр по ставкам источник не приводит (честно, не выдумано).
  const rnVacancy = externalMetrics.find((m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'vacancy_rate');
  const rnNewSupply = externalMetrics.find(
    (m) => m.source === 'rezultativnaya-nedvizhimost' && m.metric === 'new_supply_forecast_2026',
  );

  const city = useMemo(() => snapshots?.find((s) => s.sliceType === 'city'), [snapshots]);
  const periodInLabel = city ? formatPeriodIn(city.period) : null;
  const periodLabel = city ? formatPeriod(city.period) : null;
  const byDistrict = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [snapshots],
  );
  const byBuildingType = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'building_type').sort((a, b) => b.n - a.n),
    [snapshots],
  );

  const title = deal === 'rent' ? 'Ставки аренды торговых помещений в Минске' : 'Цены на торговые помещения в Минске';
  const fullTitle = periodLabel ? `${title} — ${periodLabel}` : title;
  const description =
    deal === 'rent'
      ? 'Медианная ставка аренды торговых помещений и ПСН в Минске по районам и типу здания — по объявлениям Kufar и Realt.'
      : 'Медианная цена продажи торговых помещений и ПСН в Минске по районам и типу здания — по объявлениям Kufar и Realt.';
  const url = `https://redevelopment.pro/minsk/analytics/torgovye/${deal === 'rent' ? 'arenda' : 'prodazha'}`;

  // Вынесено из useEffect в useMemo — раньше собиралось только для JSON-LD,
  // теперь тот же массив ещё и рендерится видимым блоком «Частые вопросы».
  const faqItems = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    const faq: { question: string; answer: string }[] = [];
    if (city && city.n >= MIN_RELIABLE_N && city.median != null) {
      faq.push({
        question:
          deal === 'rent'
            ? `Сколько стоит аренда торгового помещения в Минске в ${periodInLabel}?`
            : `Сколько стоит торговое помещение в Минске в ${periodInLabel}?`,
        answer: `По медиане объявлений Kufar и Realt за ${periodLabel} — ${formatMoney(city.median, deal)} (по ${city.n} объявлениям).`,
      });
    }
    const zhk = byBuildingType.find((s) => s.sliceKey === 'Жилой дом');
    if (zhk && zhk.n >= MIN_RELIABLE_N && zhk.median != null) {
      faq.push({
        question:
          deal === 'rent'
            ? 'Сколько стоит аренда помещения на первом этаже жилого дома?'
            : 'Сколько стоит помещение на первом этаже жилого дома?',
        answer: `Медиана по объявлениям в жилых домах — ${formatMoney(zhk.median, deal)} (${zhk.n} объявлений за ${periodLabel}).`,
      });
    }
    faq.push({
      question: 'Чем торговое помещение отличается от ПСН в этих цифрах?',
      answer:
        'Здесь учтены объявления в категории «Магазины, торговые помещения» на Kufar и Realt.by. Отдельного среза для помещений свободного назначения пока нет — площадки сами относят их к разным категориям не всегда последовательно.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Из активных объявлений Kufar и Realt.by по всему Минску, без привязки к конкретному ТЦ или ЖК — такого справочника у нас пока нет. Подробности — на странице методики.',
    });
    return faq;
  }, [snapshots, city, byBuildingType, deal, periodLabel, periodInLabel]);

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
    setArticleJsonLd({ headline: fullTitle, description, url, datePublished: '2026-09-07', dateModified: modified });
    setDatasetJsonLd({
      name: fullTitle,
      description,
      url,
      datePublished: '2026-09-07',
      dateModified: modified,
      measurementTechnique: 'Медиана и перцентили цены за м² по активным объявлениям Kufar и Realt, срез по месяцу',
    });
    setFaqJsonLd(faqItems);
  }, [snapshots, city, faqItems, fullTitle, description, url, title]);

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
            / Торговые помещения / {deal === 'rent' ? 'Аренда' : 'Продажа'}
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
          {periodLabel && <p className="text-sm text-ink-muted">Обновлено: {periodLabel}</p>}
        </div>

        {!error && snapshots === null && <p className="text-sm text-ink-muted">Загрузка…</p>}

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

        {byBuildingType.length > 0 && (
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
                  {byBuildingType.map((row) => {
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
              Тип здания известен не для всех объявлений — у Kufar это структурное поле, у Realt его нет вовсе
              (объявления без этого поля просто не попадают ни в одну из строк таблицы, но учтены в общей медиане
              по городу выше).
            </p>
          </section>
        )}

        {byDistrict.length > 0 && (
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
                  {byDistrict.map((row) => {
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

        {(rnVacancy || rnNewSupply) && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Рынок в целом</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rnVacancy && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Вакантность крупноформатной торговли ({rnVacancy.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnVacancy)}</span>
                </div>
              )}
              {rnNewSupply && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Прогноз ввода новых площадей ({rnNewSupply.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalValue(rnNewSupply)}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-faint">
              По данным {SOURCE_LABELS['rezultativnaya-nedvizhimost']}
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
              , крупноформатные торговые объекты Минска (ТЦ/ТРЦ), не весь рынок ПСН и стрит-ритейла из среза выше.
              Конкретных цифр по ставкам аренды источник не публикует.
            </p>
          </section>
        )}

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Это медиана и 25–75-й перцентили цены за м² по активным объявлениям аренды{deal === 'sale' ? ' и продажи' : ''}{' '}
            торговых помещений по всему Минску — категория «Магазины, торговые помещения» на Kufar и Realt.by, без
            привязки к конкретному ТЦ или жилому комплексу (такого справочника у нас пока нет — район и тип здания
            берём из собственных полей площадок). Данные собираются раз в месяц, это{' '}
            <strong>ставка предложения</strong>, не подтверждённая цена сделки. Срез публикуется только при не менее{' '}
            {MIN_RELIABLE_N} объявлениях — меньшая выборка помечена как ориентировочная или скрыта вовсе.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            Объявления Kufar и Realt.by сверены на дубли (по адресу, площади, этажу и типу сделки) перед подсчётом —
            один и тот же объект, выставленный на обеих площадках, учитывается один раз.
          </p>
          <p className="text-sm text-ink-muted">
            Подробная методика — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            . Источники: Kufar (re.kufar.by), Realt.by
            {externalMetrics.length > 0 && ', Результативная недвижимость (belretail.by)'}.
          </p>
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
      </main>
    </div>
  );
}
