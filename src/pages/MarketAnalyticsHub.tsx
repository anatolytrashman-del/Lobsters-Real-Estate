import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, Building2, Lock, Store } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setBreadcrumbJsonLd, setGenericPageMeta, setOrganizationJsonLd } from '../lib/pageMeta';
import { fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import type { MarketSnapshot } from '../data/marketSnapshots';

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

// Другие сегменты плана (ANALYTICSPLAN.md §1.1/§4.1) — пока без собственного
// скрапа и без привязки объявлений к типу здания, поэтому здесь только
// заглушки "скоро", не тонкие пустые страницы.
const UPCOMING_SEGMENTS = ['Первичный рынок', 'Готовый арендный бизнес', 'Машиноместа и паркинги'];

export function MarketAnalyticsHub() {
  const [officeSnapshots, setOfficeSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [retailSnapshots, setRetailSnapshots] = useState<MarketSnapshot[] | null>(null);
  const [warehouseSnapshots, setWarehouseSnapshots] = useState<MarketSnapshot[] | null>(null);

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
  const period =
    cityRent?.period ??
    citySale?.period ??
    retailCityRent?.period ??
    retailCitySale?.period ??
    warehouseCityRent?.period ??
    warehouseCitySale?.period ??
    null;

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: PAGE_URL, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка' },
    ]);
  }, []);

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

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Офисы в бизнес-центрах</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/minsk/analytics/ofisy/arenda"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Building2 className="h-4 w-4 shrink-0 text-ink-faint" />
                  Ставки аренды
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {cityRent?.median != null ? `Медиана: ${formatMoney(cityRent.median, 'rent')}` : 'По классам и районам'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics/ofisy/prodazha"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Building2 className="h-4 w-4 shrink-0 text-ink-faint" />
                  Цены продажи
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {citySale?.median != null ? `Медиана: ${formatMoney(citySale.median, 'sale')}` : 'По классам и районам'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Торговые помещения и ПСН</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/minsk/analytics/torgovye/arenda"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Store className="h-4 w-4 shrink-0 text-ink-faint" />
                  Ставки аренды
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {retailCityRent?.median != null ? `Медиана: ${formatMoney(retailCityRent.median, 'rent')}` : 'По районам и типу здания'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics/torgovye/prodazha"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Store className="h-4 w-4 shrink-0 text-ink-faint" />
                  Цены продажи
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {retailCitySale?.median != null ? `Медиана: ${formatMoney(retailCitySale.median, 'sale')}` : 'По районам и типу здания'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Склады</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/minsk/analytics/sklady/arenda"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Boxes className="h-4 w-4 shrink-0 text-ink-faint" />
                  Ставки аренды
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {warehouseCityRent?.median != null ? `Медиана: ${formatMoney(warehouseCityRent.median, 'rent')}` : 'По районам'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics/sklady/prodazha"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Boxes className="h-4 w-4 shrink-0 text-ink-faint" />
                  Цены продажи
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">
                  {warehouseCitySale?.median != null ? `Медиана: ${formatMoney(warehouseCitySale.median, 'sale')}` : 'По районам'}
                </span>
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
