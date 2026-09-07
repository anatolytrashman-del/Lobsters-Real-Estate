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
import { fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { MIN_RELIABLE_N, type MarketSnapshot } from '../data/marketSnapshots';

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

// Цена за объект целиком (usd_total), не за м² — округление до целого
// доллара что для аренды (в месяц), что для продажи.
function formatMoney(n: number, deal: 'rent' | 'sale'): string {
  const rounded = Math.round(n);
  return `$${rounded.toLocaleString('ru-RU')}${deal === 'rent' ? '/мес' : ''}`;
}

interface ParkingAnalyticsPageProps {
  deal: 'rent' | 'sale';
}

export function ParkingAnalyticsPage({ deal }: ParkingAnalyticsPageProps) {
  const [snapshots, setSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLatestMarketSnapshots('mashinomesta')
      .then((rows) => {
        if (!cancelled) setSnapshots(rows.filter((r) => r.deal === deal));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deal]);

  const city = useMemo(() => snapshots?.find((s) => s.sliceType === 'city'), [snapshots]);
  const periodInLabel = city ? formatPeriodIn(city.period) : null;
  const periodLabel = city ? formatPeriod(city.period) : null;
  const byDistrict = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'district').sort((a, b) => b.n - a.n),
    [snapshots],
  );
  const byParkingType = useMemo(
    () => (snapshots ?? []).filter((s) => s.sliceType === 'building_type').sort((a, b) => b.n - a.n),
    [snapshots],
  );

  const title = deal === 'rent' ? 'Аренда машиномест в Минске' : 'Цены на машиноместа в Минске';
  const fullTitle = periodLabel ? `${title} — ${periodLabel}` : title;
  const description =
    deal === 'rent'
      ? 'Медианная стоимость аренды машиноместа в Минске по районам и типу парковки — по объявлениям Kufar.'
      : 'Медианная цена машиноместа в Минске по районам и типу парковки — по объявлениям Kufar.';
  const url = `https://redevelopment.pro/minsk/analytics/mashinomesta/${deal === 'rent' ? 'arenda' : 'prodazha'}`;

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
      measurementTechnique: 'Медиана и перцентили цены за машиноместо целиком по активным объявлениям Kufar, срез по месяцу',
    });
    const faq: { question: string; answer: string }[] = [];
    if (city && city.n >= MIN_RELIABLE_N && city.median != null) {
      faq.push({
        question:
          deal === 'rent'
            ? `Сколько стоит аренда машиноместа в Минске в ${periodInLabel}?`
            : `Сколько стоит машиноместо в Минске в ${periodInLabel}?`,
        answer: `По медиане объявлений Kufar за ${periodLabel} — ${formatMoney(city.median, deal)} (по ${city.n} объявлениям).`,
      });
    }
    const podzemnaya = byParkingType.find((s) => s.sliceKey === 'Подземная');
    if (podzemnaya && podzemnaya.n >= MIN_RELIABLE_N && podzemnaya.median != null) {
      faq.push({
        question:
          deal === 'rent' ? 'Сколько стоит аренда подземного машиноместа?' : 'Сколько стоит подземное машиноместо?',
        answer: `Медиана по объявлениям подземных паркингов — ${formatMoney(podzemnaya.median, deal)} (${podzemnaya.n} объявлений за ${periodLabel}).`,
      });
    }
    faq.push({
      question: 'Чем машиноместо отличается от гаража в этих цифрах?',
      answer:
        'Здесь учтены только машиноместа (категория Kufar «Гаражи и стоянки», фильтр по типу «Машиноместо») — гаражи-боксы намеренно исключены, это другой товар с другой ценой.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Из активных объявлений Kufar по всему Минску. Realt.by не подключён — на этой площадке нет поля, которое отличало бы машиноместо от гаража-бокса, риск смешать два разных товара выше пользы от второго источника. Подробности — на странице методики.',
    });
    setFaqJsonLd(faq);
  }, [snapshots, city, byParkingType, deal, fullTitle, description, url, periodLabel, periodInLabel, title]);

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
            / Машиноместа и паркинги / {deal === 'rent' ? 'Аренда' : 'Продажа'}
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

        {byParkingType.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">По типу парковки</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Тип парковки</th>
                    <th className="px-3 py-2">Медиана</th>
                    <th className="px-3 py-2">Объявлений</th>
                  </tr>
                </thead>
                <tbody>
                  {byParkingType.map((row) => {
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

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Это медиана и 25–75-й перцентили цены за <strong>машиноместо целиком</strong> (не за м²) по активным
            объявлениям аренды{deal === 'sale' ? ' и продажи' : ''} по всему Минску — категория Kufar «Гаражи и
            стоянки» с фильтром по типу «Машиноместо» (гаражи-боксы исключены). Данные собираются раз в месяц, это{' '}
            <strong>ставка предложения</strong>, не подтверждённая цена сделки. Срез публикуется только при не менее{' '}
            {MIN_RELIABLE_N} объявлениях — меньшая выборка помечена как ориентировочная или скрыта вовсе.
          </p>
          <p className="text-sm leading-relaxed text-ink-muted">
            Источник только один — Kufar. Realt.by сознательно не подключён: на их аналогичной категории нет поля,
            которое отличало бы машиноместо от гаража-бокса, а смешивать два разных товара в одной медиане мы не
            стали.
          </p>
          <p className="text-sm text-ink-muted">
            Подробная методика — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            . Источник: Kufar (re.kufar.by).
          </p>
        </section>
      </main>
    </div>
  );
}
