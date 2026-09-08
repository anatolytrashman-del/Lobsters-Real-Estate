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

const EXTERNAL_UNIT_SUFFIX: Record<string, string> = {
  thousand_sqm: ' тыс. м²',
};

function formatExternalMoney(m: ExternalMetric): string {
  const rounded = Math.round(m.value * 10) / 10;
  if (m.unit === 'usd_per_sqm_year') return `$${rounded.toLocaleString('ru-RU')}/м²/год`;
  return `${rounded.toLocaleString('ru-RU')}${EXTERNAL_UNIT_SUFFIX[m.unit] ?? ` ${m.unit}`}`;
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

interface WarehouseAnalyticsPageProps {
  deal: 'rent' | 'sale';
}

export function WarehouseAnalyticsPage({ deal }: WarehouseAnalyticsPageProps) {
  const [snapshots, setSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [error, setError] = useState(false);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetric[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('sklady')
      .then((rows) => {
        if (!cancelled) setSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    fetchExternalMetrics('sklady')
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

  // «Твоя столица» через prometr.by (годовой отчёт 2025, не тот же
  // ежемесячный мониторинг, что у офисов) — ставки только по аренде
  // (deal='rent' в базе), сток/прогноз ввода — не привязаны к сделке.
  const rateAMin = externalMetrics.find((m) => m.metric === 'class_a_rate_usd_min' && m.deal === 'rent');
  const rateAMax = externalMetrics.find((m) => m.metric === 'class_a_rate_usd_max' && m.deal === 'rent');
  const rateB = externalMetrics.find((m) => m.metric === 'class_b_rate_usd' && m.deal === 'rent');
  const totalStock = externalMetrics.find((m) => m.metric === 'total_stock');
  const newSupplyForecast = externalMetrics.find((m) => m.metric === 'new_supply_forecast_2026');
  const showMarketWide = (deal === 'rent' && Boolean(rateAMin || rateAMax || rateB)) || Boolean(totalStock) || Boolean(newSupplyForecast);

  const city = useMemo(() => snapshots?.find((s) => s.sliceType === 'city'), [snapshots]);
  const periodInLabel = city ? formatPeriodIn(city.period) : null;
  const periodLabel = city ? formatPeriod(city.period) : null;
  const byDistrict = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [snapshots],
  );

  const title = deal === 'rent' ? 'Ставки аренды складов в Минске' : 'Цены на склады в Минске';
  const fullTitle = periodLabel ? `${title} — ${periodLabel}` : title;
  const description =
    deal === 'rent'
      ? 'Медианная ставка аренды складских помещений в Минске по районам — по объявлениям Kufar и Realt.'
      : 'Медианная цена продажи складских помещений в Минске по районам — по объявлениям Kufar и Realt.';
  const url = `https://redevelopment.pro/minsk/analytics/sklady/${deal === 'rent' ? 'arenda' : 'prodazha'}`;

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
    const faq: { question: string; answer: string }[] = [];
    if (city && city.n >= MIN_RELIABLE_N && city.median != null) {
      faq.push({
        question:
          deal === 'rent' ? `Сколько стоит аренда склада в Минске в ${periodInLabel}?` : `Сколько стоит склад в Минске в ${periodInLabel}?`,
        answer: `По медиане объявлений Kufar и Realt за ${periodLabel} — ${formatMoney(city.median, deal)} (по ${city.n} объявлениям).`,
      });
    }
    faq.push({
      question: 'Есть ли разбивка по классу склада (A/B/C) и направлению?',
      answer:
        'Пока нет — ни Kufar, ни Realt.by не публикуют класс склада, высоту потолков или направление шоссе как отдельные структурные поля объявления, а угадывать их по тексту описания мы не стали. Здесь только медиана по городу и по административному району.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Из активных объявлений Kufar и Realt.by по всему Минску, категория «Склады». Подробности — на странице методики.',
    });
    setFaqJsonLd(faq);
  }, [snapshots, city, deal, fullTitle, description, url, periodLabel, periodInLabel, title]);

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
            / Склады / {deal === 'rent' ? 'Аренда' : 'Продажа'}
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

        {showMarketWide && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Рынок в целом</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {deal === 'rent' && rateAMin && rateAMax && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Ставка класс A ({rateAMin.period}, Твоя столица)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">
                    ${rateAMin.value}–{rateAMax.value}/м²/год
                  </span>
                </div>
              )}
              {deal === 'rent' && rateB && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Ставка класс B ({rateB.period}, Твоя столица)
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalMoney(rateB)}</span>
                </div>
              )}
              {totalStock && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Сток региона ({totalStock.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalMoney(totalStock)}</span>
                </div>
              )}
              {newSupplyForecast && (
                <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
                  <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Прогноз ввода ({newSupplyForecast.period})
                  </span>
                  <span className="text-2xl font-extrabold text-ink">{formatExternalMoney(newSupplyForecast)}</span>
                </div>
              )}
            </div>
            <p className="text-xs text-ink-faint">
              По данным {SOURCE_LABELS['tvoya-stolitsa']}
              {totalStock?.url && (
                <>
                  {' '}
                  (
                  <a href={totalStock.url} target="_blank" rel="noreferrer" className="text-primary-hover hover:underline">
                    отчёт
                  </a>
                  )
                </>
              )}
              , годовой отчёт за 2025 — методология аналитика, не наш срез по объявлениям. Сток и прогноз ввода — по
              Минскому <strong>региону</strong> (сам город плюс ~25 км от МКАД), это шире, чем наша выборка только по
              Минску. Ставки — средневзвешенные запрашиваемые, на конец 2025, только аренда.
            </p>
          </section>
        )}

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Это медиана и 25–75-й перцентили цены за м² по активным объявлениям аренды{deal === 'sale' ? ' и продажи' : ''}{' '}
            складских помещений по всему Минску — категория «Склады» на Kufar и Realt.by. Данные собираются раз в
            месяц, это <strong>ставка предложения</strong>, не подтверждённая цена сделки. Срез публикуется только
            при не менее {MIN_RELIABLE_N} объявлениях — меньшая выборка помечена как ориентировочная или скрыта
            вовсе.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            Здесь <strong>нет</strong> деления по классу склада (A/B/C), высоте потолков или направлению шоссе — ни
            Kufar, ни Realt.by не дают этих данных как отдельные структурные поля объявления, а строить их из
            текста описания мы не стали, чтобы не выдавать догадку за факт. Объявления Kufar и Realt.by сверены на
            дубли (по адресу, площади, этажу и типу сделки) перед подсчётом.
          </p>
          <p className="text-sm text-ink-muted">
            Подробная методика — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            . Источники: Kufar (re.kufar.by), Realt.by
            {externalMetrics.length > 0 && ', Твоя столица (через prometr.by)'}.
          </p>
        </section>
      </main>
    </div>
  );
}
