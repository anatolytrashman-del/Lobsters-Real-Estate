import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import {
  setArticleJsonLd,
  setBreadcrumbJsonLd,
  setDatasetJsonLd,
  setFaqJsonLd,
  setGenericPageMeta,
  setOrganizationJsonLd,
} from '../lib/pageMeta';
import { fetchPublicMarketOffers } from '../lib/marketOffersApi';
import { fetchPrimaryMarketOffers } from '../lib/primaryMarketOffersApi';
import { AREA_BUCKET_ORDER, MARKET_PROPERTY_TYPES, areaBucket, netPricePerSqm, netSize, type MarketOffer } from '../data/marketOffers';
import { buildPrimaryMarketPivot, type PrimaryMarketOffer } from '../data/primaryMarketOffers';

// Сводные таблицы вторичного рынка (buildMarketPivot/countSmallFinishedOffices/
// median) — та же логика, что и в DistrictGuidePage.tsx (её собственный блок
// "Вторичный рынок"), СОЗНАТЕЛЬНО продублирована, не импортирована: этот файл
// активно и часто меняется параллельной SEO-сессией (см. её же комментарии
// про этот же приём для buildMarketPivot), лишний общий импорт — риск
// конфликта при следующей правке того файла. Первичный рынок, наоборот,
// использует общий data/primaryMarketOffers.ts (buildPrimaryMarketPivot) —
// та функция уже вынесена в отдельный модуль, не дублируется нигде.
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
  return MARKET_PROPERTY_TYPES.filter((type) => byType.has(type)).map((propertyType) => {
    const byBucket = byType.get(propertyType)!;
    const cells = AREA_BUCKET_ORDER.map((bucket) => {
      const prices = byBucket.get(bucket);
      return prices ? { count: prices.length, medianPrice: Math.round(median(prices)) } : null;
    });
    return { propertyType, cells };
  });
}

const MARKET_FINISH_OPTIONS = ['С отделкой', 'Без отделки'] as const;
const MARKET_FINISH_TO_DB: Record<(typeof MARKET_FINISH_OPTIONS)[number], string> = {
  'С отделкой': 'с отделкой',
  'Без отделки': 'без отделки',
};

const TITLE = 'Цены на коммерческую недвижимость в Минск Мире — Redevelopment';
const DESCRIPTION =
  'Первичный и вторичный рынок коммерческой недвижимости в Минск Мире: цены на бизнес-апартаменты, торговые и офисные помещения, по данным bir.by, Kufar и Realt.';
const URL = 'https://redevelopment.pro/minsk/analytics/minsk-mir';

export function MinskMirAnalyticsPage() {
  const [marketOffers, setMarketOffers] = useState<MarketOffer[] | null>(null);
  const [primaryOffers, setPrimaryOffers] = useState<PrimaryMarketOffer[] | null>(null);
  const [marketDealType, setMarketDealType] = useState<'Продажа' | 'Аренда'>('Продажа');
  const [marketFinish, setMarketFinish] = useState<(typeof MARKET_FINISH_OPTIONS)[number]>('С отделкой');

  useEffect(() => {
    fetchPublicMarketOffers()
      .then(setMarketOffers)
      .catch(() => setMarketOffers([]));
    fetchPrimaryMarketOffers()
      .then(setPrimaryOffers)
      .catch(() => setPrimaryOffers([]));
  }, []);

  const primaryPivot = useMemo(() => (primaryOffers ? buildPrimaryMarketPivot(primaryOffers) : []), [primaryOffers]);
  const secondaryReviewedCount = useMemo(
    () => (marketOffers ?? []).filter((o) => o.reviewed && !o.rejected).length,
    [marketOffers],
  );

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: URL, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка', url: 'https://redevelopment.pro/minsk/analytics' },
      { name: 'Минск Мир' },
    ]);
    const now = new Date().toISOString().slice(0, 10);
    setArticleJsonLd({ headline: TITLE, description: DESCRIPTION, url: URL, datePublished: '2026-09-07', dateModified: now });
    setDatasetJsonLd({
      name: TITLE,
      description: DESCRIPTION,
      url: URL,
      datePublished: '2026-09-07',
      dateModified: now,
      measurementTechnique: 'Медиана цены за м² по проверенным объявлениям Kufar/Realt (вторичка) и данным застройщика bir.by (первичка)',
    });
    const faq: { question: string; answer: string }[] = [];
    const apartsSdano = primaryPivot.find((r) => r.key === 'apartments-sdano');
    if (apartsSdano) {
      faq.push({
        question: 'Сколько стоят бизнес-апартаменты в Минск Мире в сданных домах?',
        answer: `От застройщика — от ${apartsSdano.priceMinEur.toLocaleString('ru-RU')} до ${apartsSdano.priceMaxEur.toLocaleString('ru-RU')} EUR/м² (в среднем ${apartsSdano.priceAvgEur.toLocaleString('ru-RU')} EUR/м², ${apartsSdano.count} предложений).`,
      });
    }
    faq.push({
      question: 'Чем первичный рынок отличается от вторичного в этих цифрах?',
      answer:
        'Первичный — прямые предложения застройщика Dana Holdings (bir.by), цены в евро. Вторичный — активные объявления собственников и агентств на Kufar и Realt.by, цены в долларах. Валюты не пересчитываются друг в друга — сравнивайте с поправкой на курс.',
    });
    faq.push({
      question: 'Откуда берутся данные?',
      answer:
        'Первичный рынок — с портала застройщика bir.by. Вторичный — с Kufar и Realt.by, каждое объявление проверяется вручную перед тем, как попасть в сводку. Подробный гид по району — на отдельной странице.',
    });
    setFaqJsonLd(faq);
  }, [primaryPivot]);

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
            / Минск Мир
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Цены на коммерческую недвижимость в Минск Мире</h1>
          <p className="max-w-2xl text-sm text-ink-muted">
            Первичный рынок (застройщик, bir.by) и вторичный рынок (объявления собственников, Kufar и Realt.by) в
            одном месте.
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">Первичный рынок — от застройщика</h2>
          {primaryOffers === null && <p className="text-sm text-ink-muted">Загрузка…</p>}
          {primaryOffers !== null && primaryPivot.length === 0 && <p className="text-sm text-ink-muted">Данные пока не собраны.</p>}
          {primaryPivot.length > 0 && (
            <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                    <th className="px-3 py-2">Категория</th>
                    <th className="px-3 py-2">Площадь</th>
                    <th className="px-3 py-2">Цена за м² (EUR)</th>
                    <th className="px-3 py-2">Предложений</th>
                  </tr>
                </thead>
                <tbody>
                  {primaryPivot.map((row) => (
                    <tr key={row.key} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">{row.label}</td>
                      <td className="px-3 py-2 text-ink-muted">
                        {row.areaMin === row.areaMax ? `${row.areaMin} м²` : `${row.areaMin}–${row.areaMax} м²`}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {row.priceMinEur.toLocaleString('ru-RU')}–{row.priceMaxEur.toLocaleString('ru-RU')} (в среднем{' '}
                        {row.priceAvgEur.toLocaleString('ru-RU')})
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={cn('flex flex-col gap-3 p-5', glassCardClass)} style={glassCardShadow}>
          <div className="flex min-w-0 items-center gap-3">
            <TrendingUp className="h-5 w-5 shrink-0 text-ink" />
            <h2 className="text-lg font-bold text-ink">Вторичный рынок — объявления собственников</h2>
          </div>
          <p className="text-sm text-ink-muted">
            Действующие проверенные объявления продажи и аренды на Kufar и Realt.by — количество и медианная цена за
            м² по типу помещения и площади.
            {secondaryReviewedCount > 0 && ` Учтено ${secondaryReviewedCount} проверенных объявлений.`}
          </p>
          {marketOffers === null && <p className="text-sm text-ink-muted">Загрузка…</p>}
          {marketOffers !== null && marketOffers.length === 0 && <p className="text-sm text-ink-muted">Данные пока не собраны.</p>}
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      <th scope="col" className="py-2 pr-3 text-left">
                        Тип помещения
                      </th>
                      {AREA_BUCKET_ORDER.map((bucket) => (
                        <th scope="col" key={bucket} className="py-2 px-2 text-right font-semibold">
                          {bucket}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {buildMarketPivot(marketOffers, marketDealType === 'Продажа' ? 'sale' : 'rent', MARKET_FINISH_TO_DB[marketFinish]).map(
                      (row) => (
                        <tr key={row.propertyType}>
                          <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink">
                            {row.propertyType}
                          </th>
                          {row.cells.map((cell, i) => (
                            <td key={i} className="py-2.5 px-2 text-right tabular-nums">
                              {cell ? (
                                <>
                                  <div className="font-semibold text-ink">{cell.count}</div>
                                  <div className="text-xs text-ink-muted">${cell.medianPrice}/м²</div>
                                </>
                              ) : (
                                <span className="text-ink-faint">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-ink-muted">Сверху — количество предложений, снизу — медианная цена за м² в долларах.</p>
            </>
          )}
        </section>

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Первичный рынок — прямые предложения застройщика (портал bir.by), цены в евро, без пересчёта.
            Вторичный — действующие объявления Kufar и Realt.by, каждое проходит ручную проверку перед публикацией
            в сводке (статус отделки, тип помещения, площадь), цены в долларах. Валюты между собой не
            пересчитываются — это два разных источника с разной методикой, показывать их слитно в одной цифре было
            бы неточно.
          </p>
          <p className="text-sm text-ink-muted">
            Подробный гид по району (застройщик, транспорт, инфраструктура, аналитика по нишам бизнеса) —{' '}
            <Link to="/minsk/minsk-mir" className="text-primary-hover hover:underline">
              на отдельной странице
            </Link>
            . Методика расчёта общих аналитических страниц — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              странице методики
            </Link>
            .
          </p>
        </section>

        <section className={cn('flex items-center justify-between gap-4 p-6', glassCardClass)} style={glassCardShadow}>
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-bold text-ink">
              <TrendingUp className="h-4 w-4 shrink-0 text-primary-hover" />
              Кабинеты 11–40 м² от $12 000
            </span>
            <span className="text-sm text-ink-muted">Деловой центр Red One в Минск Мире — приватные кабинеты в собственность.</span>
          </div>
          <Link to="/minsk/one" className="shrink-0 rounded-control bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover">
            Смотреть Red One
          </Link>
        </section>
      </main>
    </div>
  );
}
