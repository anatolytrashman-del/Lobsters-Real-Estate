import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, FileBarChart, Landmark, Lock } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setBreadcrumbJsonLd, setDatasetJsonLd, setGenericPageMeta, setOrganizationJsonLd } from '../lib/pageMeta';
import { fetchExternalMetricsBySource, fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { MIN_RELIABLE_N, type ExternalMetric, type MarketSnapshot } from '../data/marketSnapshots';

const TITLE = 'Цены на коммерческую недвижимость в Минске — Redevelopment';
const DESCRIPTION =
  'Аналитика рынка коммерческой недвижимости Минска: ставки аренды и цены продажи офисов в бизнес-центрах, торговых помещений и складов по районам, по данным Kufar и Realt.';
const PAGE_URL = 'https://redevelopment.pro/minsk/analytics';

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

function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ${y}`;
}

function formatMoney(n: number, deal: 'rent' | 'sale'): string {
  const rounded = deal === 'rent' ? Math.round(n * 10) / 10 : Math.round(n);
  return `$${rounded.toLocaleString('ru-RU')}${deal === 'rent' ? '/м²/мес' : '/м²'}`;
}

// Машиноместа — цена за объект целиком (usd_total), не за м², своё
// форматирование без "/м²".
function formatParkingMoney(n: number, deal: 'rent' | 'sale'): string {
  return `$${Math.round(n).toLocaleString('ru-RU')}${deal === 'rent' ? '/мес' : ''}`;
}

function formatByUnit(n: number, deal: 'rent' | 'sale', unit: 'sqm' | 'total'): string {
  return unit === 'sqm' ? formatMoney(n, deal) : formatParkingMoney(n, deal);
}

// Другие сегменты плана (ANALYTICSPLAN.md §1.1/§4.1) — пока без собственного
// скрапа и без привязки объявлений к типу здания, поэтому здесь только
// заглушки "скоро", не тонкие пустые страницы.
const UPCOMING_SEGMENTS = ['Первичный рынок', 'Готовый арендный бизнес'];

export function MarketAnalyticsHub() {
  const [officeSnapshots, setOfficeSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [retailSnapshots, setRetailSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [warehouseSnapshots, setWarehouseSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [parkingSnapshots, setParkingSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [goskomMetrics, setGoskomMetrics] = useState<ExternalMetric[] | null>(null);

  useEffect(() => {
    fetchLatestMarketSnapshots('ofisy_bc')
      .then(setOfficeSnapshots)
      .catch(() => setOfficeSnapshots([]));
    fetchLatestMarketSnapshots('torgovye')
      .then(setRetailSnapshots)
      .catch(() => setRetailSnapshots([]));
    fetchLatestMarketSnapshots('sklady')
      .then(setWarehouseSnapshots)
      .catch(() => setWarehouseSnapshots([]));
    fetchLatestMarketSnapshots('mashinomesta')
      .then(setParkingSnapshots)
      .catch(() => setParkingSnapshots([]));
    fetchExternalMetricsBySource('goskomimushchestvo')
      .then(setGoskomMetrics)
      .catch(() => setGoskomMetrics([]));
  }, []);

  const cityRent = useMemo(
    () => officeSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'rent'),
    [officeSnapshots],
  );
  const citySale = useMemo(
    () => officeSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'sale'),
    [officeSnapshots],
  );
  const retailCityRent = useMemo(
    () => retailSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'rent'),
    [retailSnapshots],
  );
  const retailCitySale = useMemo(
    () => retailSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'sale'),
    [retailSnapshots],
  );
  const warehouseCityRent = useMemo(
    () => warehouseSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'rent'),
    [warehouseSnapshots],
  );
  const warehouseCitySale = useMemo(
    () => warehouseSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'sale'),
    [warehouseSnapshots],
  );
  const parkingCityRent = useMemo(
    () => parkingSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'rent'),
    [parkingSnapshots],
  );
  const parkingCitySale = useMemo(
    () => parkingSnapshots?.find((s) => s.sliceType === 'city' && s.deal === 'sale'),
    [parkingSnapshots],
  );
  const period =
    cityRent?.period ??
    citySale?.period ??
    retailCityRent?.period ??
    retailCitySale?.period ??
    warehouseCityRent?.period ??
    warehouseCitySale?.period ??
    parkingCityRent?.period ??
    parkingCitySale?.period ??
    null;

  // Свод по всем 4 сегментам разом (владелец, 2026-09-08: "не даёт ощущение
  // вау, где много полезной инфы" — узкие страницы под конкретный запрос
  // остаются как есть, для SEO это правильно, а хаб становится тем самым
  // "вау"-обзором: реальные цифры сразу на странице, не только ссылки).
  const loaded = officeSnapshots !== null && retailSnapshots !== null && warehouseSnapshots !== null && parkingSnapshots !== null;
  const segmentRows = useMemo(
    () => [
      { key: 'ofisy_bc', label: 'Офисы в бизнес-центрах', url: '/minsk/analytics/ofisy', rent: cityRent, sale: citySale, unit: 'sqm' as const },
      {
        key: 'torgovye',
        label: 'Торговые помещения и ПСН',
        url: '/minsk/analytics/torgovye',
        rent: retailCityRent,
        sale: retailCitySale,
        unit: 'sqm' as const,
      },
      { key: 'sklady', label: 'Склады', url: '/minsk/analytics/sklady', rent: warehouseCityRent, sale: warehouseCitySale, unit: 'sqm' as const },
      {
        key: 'mashinomesta',
        label: 'Машиноместа и паркинги',
        url: '/minsk/analytics/mashinomesta',
        rent: parkingCityRent,
        sale: parkingCitySale,
        unit: 'total' as const,
      },
    ],
    [cityRent, citySale, retailCityRent, retailCitySale, warehouseCityRent, warehouseCitySale, parkingCityRent, parkingCitySale],
  );
  const totalOffers = useMemo(
    () => segmentRows.reduce((sum, row) => sum + (row.rent?.n ?? 0) + (row.sale?.n ?? 0), 0),
    [segmentRows],
  );
  const officeByClass = useMemo(
    () =>
      (['A', 'B+', 'B', 'C'] as const)
        .map((cls) => ({
          cls,
          rent: (officeSnapshots ?? []).find((s) => s.sliceType === 'class' && s.sliceKey === cls && s.deal === 'rent'),
          sale: (officeSnapshots ?? []).find((s) => s.sliceType === 'class' && s.sliceKey === cls && s.deal === 'sale'),
        }))
        .filter((row) => row.rent || row.sale),
    [officeSnapshots],
  );
  const classARent = useMemo(() => officeByClass.find((r) => r.cls === 'A')?.rent, [officeByClass]);

  // Реестр реальных сделок Госкомимущества (владелец, 2026-09-08: "был ещё
  // какой-то гос. реестр, ты говорил, про него ни слова" — НКА/analytics.
  // nca.by оказался заблокирован на уровне nginx даже для серверного
  // web_fetch Anthropic, не только из песочницы; у него бесплатны только
  // отчёты по рынку КВАРТИР, коммерческая недвижимость — платно. Реальные
  // данные вместо этого нашлись у Госкомимущества — официальный реестр
  // ЗАКРЫТЫХ сделок (не наша медиана по объявлениям), перепроверено двумя
  // независимыми источниками, см. journal). goskomMetric — маленький
  // хелпер поиска значения по metric+segment, чтобы не городить .find()
  // в каждом месте разметки.
  const goskomMetric = (segment: string, metric: string) =>
    (goskomMetrics ?? []).find((m) => m.segment === segment && m.metric === metric);
  const goskomUrl = goskomMetrics?.[0]?.url ?? null;

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: PAGE_URL, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка' },
    ]);
    if (!loaded) return;
    const modified = period ?? new Date().toISOString().slice(0, 10);
    setDatasetJsonLd({
      name: TITLE,
      description: DESCRIPTION,
      url: PAGE_URL,
      datePublished: '2026-09-07',
      dateModified: modified,
      measurementTechnique:
        'Медиана и перцентили цены по активным объявлениям Kufar и Realt.by, срез по месяцу, по сегментам рынка коммерческой недвижимости',
    });
  }, [loaded, period]);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 sm:px-8">
          <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </Link>
        </div>
      </div>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Аналитика рынка коммерческой недвижимости Минска</h1>
          <p className="max-w-2xl text-ink-muted">
            Ставки аренды и цены продажи по нашим данным (объявления Kufar и Realt.by), по классам, районам и
            сегментам. Обновляется ежемесячно.
            {period && ` Текущий срез — ${formatPeriod(period)}.`}
          </p>
        </div>

        {!loaded && <p className="text-sm text-ink-muted">Загрузка…</p>}

        {loaded && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Сегментов рынка</span>
              <span className="text-2xl font-extrabold text-ink">{segmentRows.length}</span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Учтено объявлений</span>
              <span className="text-2xl font-extrabold text-ink">{totalOffers.toLocaleString('ru-RU')}</span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Аренда, офис класса A</span>
              <span className="text-2xl font-extrabold text-ink">
                {classARent?.median != null ? formatMoney(classARent.median, 'rent') : '—'}
              </span>
            </div>
            <div className={cn('flex flex-col gap-1 p-5', glassCardClass)} style={glassCardShadow}>
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Текущий срез</span>
              <span className="text-2xl font-extrabold text-ink">{period ? formatPeriod(period) : '—'}</span>
            </div>
          </section>
        )}

        {loaded && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Все сегменты одним взглядом</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Сегмент</th>
                    <th className="px-3 py-2 text-right">Медиана аренды</th>
                    <th className="px-3 py-2 text-right">Медиана продажи</th>
                    <th className="px-3 py-2 text-right">Объявлений</th>
                    <th className="px-3 py-2 text-right">Подробнее</th>
                  </tr>
                </thead>
                <tbody>
                  {segmentRows.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">{row.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {row.rent?.median != null ? (
                          formatByUnit(row.rent.median, 'rent', row.unit)
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {row.sale?.median != null ? (
                          formatByUnit(row.sale.median, 'sale', row.unit)
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                        {(row.rent?.n ?? 0) + (row.sale?.n ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs whitespace-nowrap">
                        <Link to={`${row.url}/arenda`} className="text-primary-hover hover:underline">
                          Аренда
                        </Link>
                        {' · '}
                        <Link to={`${row.url}/prodazha`} className="text-primary-hover hover:underline">
                          Продажа
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Машиноместа — цена за объект целиком, не за м² (в объявлениях площадь не измеряется), поэтому напрямую
              с остальными строками по цифре не сравнить — только по наличию данных.
            </p>
          </section>
        )}

        {goskomMetrics && goskomMetrics.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Landmark className="h-4 w-4 shrink-0 text-ink-faint" />
              Реестр реальных сделок (Госкомимущество)
            </h2>
            <p className="text-sm text-ink-muted">
              Отдельно от наших медиан по объявлениям — официальная статистика уже{' '}
              <strong>закрытых</strong> сделок купли-продажи коммерческой недвижимости Минска, зарегистрированных
              Госкомимуществом за 1-е полугодие 2026 года.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Сделок всего</span>
                <span className="text-xl font-extrabold text-ink">
                  {goskomMetric('vse_segmenty', 'total_registered_deals')?.value ?? '—'}
                </span>
              </div>
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Общий оборот</span>
                <span className="text-xl font-extrabold text-ink">
                  {goskomMetric('vse_segmenty', 'total_turnover')?.value != null
                    ? `$${goskomMetric('vse_segmenty', 'total_turnover')!.value.toLocaleString('ru-RU')} млн`
                    : '—'}
                </span>
              </div>
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Доля офисов в обороте</span>
                <span className="text-xl font-extrabold text-ink">
                  {goskomMetric('ofisy_bc', 'turnover_share_pct')?.value != null
                    ? `${goskomMetric('ofisy_bc', 'turnover_share_pct')!.value}%`
                    : '—'}
                </span>
              </div>
              <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">Рекордная сделка</span>
                <span className="text-xl font-extrabold text-ink">
                  {goskomMetric('sklady', 'record_deal_price')?.value != null
                    ? `${goskomMetric('sklady', 'record_deal_price')!.value.toLocaleString('ru-RU')} млн Br`
                    : '—'}
                </span>
              </div>
            </div>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[360px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Сегмент</th>
                    <th className="px-3 py-2 text-right">Зарегистрировано сделок</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-ink">Офисы</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {goskomMetric('ofisy_bc', 'registered_deals')?.value ?? '—'}
                    </td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-ink">Торговые помещения</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {goskomMetric('torgovye', 'registered_deals')?.value ?? '—'}
                    </td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-ink">Склады и производство</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {goskomMetric('sklady', 'registered_deals')?.value ?? '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint">
              Это <strong>сделки</strong>, а не наши медианы по активным объявлениям (те — ставка предложения, эти —
              подтверждённая цена продажи). Рекордная сделка полугодия — производственное помещение 5,7 тыс. м² на
              ул. Короля. Данные Госкомимущества, перепроверены по двум независимым публикациям (Минск-Новости,
              BelRetail).{' '}
              {goskomUrl && (
                <a href={goskomUrl} target="_blank" rel="noopener noreferrer" className="text-primary-hover hover:underline">
                  Источник
                </a>
              )}
            </p>
          </section>
        )}

        {officeByClass.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-bold text-ink">Офисы в БЦ по классам</h2>
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Класс</th>
                    <th className="px-3 py-2 text-right">Аренда</th>
                    <th className="px-3 py-2 text-right">Продажа</th>
                  </tr>
                </thead>
                <tbody>
                  {officeByClass.map(({ cls, rent, sale }) => (
                    <tr key={cls} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">
                        <span className="flex items-center gap-1.5">
                          <Award className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                          Класс {cls}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {rent?.median != null ? (
                          <>
                            {formatMoney(rent.median, 'rent')}
                            {rent.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">
                        {sale?.median != null ? (
                          <>
                            {formatMoney(sale.median, 'sale')}
                            {sale.n < MIN_RELIABLE_N && <span className="text-ink-faint"> (ориент.)</span>}
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Link
              to="/minsk/analytics/ofisy/arenda"
              className="inline-flex w-fit items-center gap-1 text-sm text-primary-hover hover:underline"
            >
              <FileBarChart className="h-3.5 w-3.5" />
              Полный разбор по офисам — районы, сравнение с «Твоей столицей» и Colliers
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">По району</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/minsk/analytics/minsk-mir"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">Минск Мир: первичный и вторичный рынок</span>
                <span className="text-xs text-ink-muted">Бизнес-апартаменты от застройщика + объявления Kufar и Realt</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics/rajony"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">Где дороже и дешевле</span>
                <span className="text-xs text-ink-muted">Сравнение районов по всем сегментам сразу</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Другие сегменты</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {UPCOMING_SEGMENTS.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between gap-2 rounded-control border border-border p-4 text-ink-faint"
              >
                <span className="font-medium">{name}</span>
                <span className="flex items-center gap-1.5 text-xs">
                  <Lock className="h-3.5 w-3.5" />
                  скоро
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2 text-sm text-ink-muted">
          <p>
            Методика сбора и расчёта — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            . Полный список зданий — в{' '}
            <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
              каталоге бизнес-центров
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
