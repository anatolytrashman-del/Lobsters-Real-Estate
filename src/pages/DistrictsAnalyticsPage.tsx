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
  setOrganizationJsonLd,
} from '../lib/pageMeta';
import { districtHubUrl } from '../lib/businessCenterHubs';
import { fetchLatestMarketSnapshots } from '../lib/marketSnapshotsApi';
import { MIN_RELIABLE_N, type MarketSnapshot } from '../data/marketSnapshots';

const TITLE = 'Где дороже и дешевле: районы Минска по аренде недвижимости';
const DESCRIPTION =
  'Сравнение медианной ставки аренды офисов, торговых помещений и складов по административным районам Минска.';
const URL = 'https://redevelopment.pro/minsk/analytics/rajony';

const SEGMENTS: { key: string; label: string }[] = [
  { key: 'ofisy_bc', label: 'Офисы в БЦ' },
  { key: 'torgovye', label: 'Торговые помещения' },
  { key: 'sklady', label: 'Склады' },
];

function formatMoney(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `$${rounded.toLocaleString('ru-RU')}`;
}

export function DistrictsAnalyticsPage() {
  const [bySegment, setBySegment] = useState<Record<string, MarketSnapshot[]> | null>(null);

  useEffect(() => {
    Promise.all(SEGMENTS.map((s) => fetchLatestMarketSnapshots(s.key)))
      .then((results) => {
        const map: Record<string, MarketSnapshot[]> = {};
        SEGMENTS.forEach((s, i) => {
          map[s.key] = results[i].filter((r) => r.sliceType === 'district' && r.deal === 'rent');
        });
        setBySegment(map);
      })
      .catch(() => setBySegment({}));
  }, []);

  const districts = useMemo(() => {
    if (!bySegment) return [];
    const names = new Set<string>();
    for (const rows of Object.values(bySegment)) {
      for (const r of rows) names.add(r.sliceKey);
    }
    return [...names].sort();
  }, [bySegment]);

  const rowFor = (district: string, segment: string) => bySegment?.[segment]?.find((r) => r.sliceKey === district);

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: URL, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка', url: 'https://redevelopment.pro/minsk/analytics' },
      { name: 'Районы' },
    ]);
    const now = new Date().toISOString().slice(0, 10);
    setArticleJsonLd({ headline: TITLE, description: DESCRIPTION, url: URL, datePublished: '2026-09-07', dateModified: now });
    setDatasetJsonLd({
      name: TITLE,
      description: DESCRIPTION,
      url: URL,
      datePublished: '2026-09-07',
      dateModified: now,
      measurementTechnique: 'Медиана цены аренды за м² по активным объявлениям Kufar и Realt, срез по административному району',
    });
    if (districts.length > 0) {
      const officeRows = (bySegment?.ofisy_bc ?? []).filter((r) => r.n >= MIN_RELIABLE_N && r.median != null);
      const cheapest = [...officeRows].sort((a, b) => (a.median ?? 0) - (b.median ?? 0))[0];
      const priciest = [...officeRows].sort((a, b) => (b.median ?? 0) - (a.median ?? 0))[0];
      const faq: { question: string; answer: string }[] = [];
      if (cheapest && priciest) {
        faq.push({
          question: 'В каком районе Минска дешевле всего снять офис?',
          answer: `По нашим данным — ${cheapest.sliceKey} район, медиана ${formatMoney(cheapest.median as number)}/м²/мес. Дороже всего — ${priciest.sliceKey} район, ${formatMoney(priciest.median as number)}/м²/мес.`,
        });
      }
      faq.push({
        question: 'Есть ли разбивка по станциям метро, а не только по районам?',
        answer:
          'Пока нет для этой сводной страницы — у объявлений с Kufar и Realt.by нет структурного поля со станцией метро. Ближайшую к конкретному зданию станцию можно посмотреть в каталоге бизнес-центров — там расстояние считается по координатам самого здания.',
      });
      faq.push({
        question: 'Откуда берутся данные?',
        answer:
          'Из активных объявлений аренды на Kufar и Realt.by, по трём сегментам: офисы в бизнес-центрах, торговые помещения, склады. Подробности — на странице методики.',
      });
      setFaqJsonLd(faq);
    }
  }, [districts, bySegment]);

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
            / Районы
          </span>
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Где дороже и дешевле: районы Минска</h1>
          <p className="max-w-2xl text-sm text-ink-muted">
            Медианная ставка аренды за м²/мес по административным районам — офисы в бизнес-центрах, торговые
            помещения, склады. Данные о продаже и о разбивке по станциям метро — на страницах отдельных сегментов.
          </p>
        </div>

        {bySegment === null && <p className="text-sm text-ink-muted">Загрузка…</p>}
        {bySegment !== null && districts.length === 0 && <p className="text-sm text-ink-muted">Данные пока не собраны.</p>}

        {districts.length > 0 && (
          <div className={cn('overflow-x-auto p-2', glassCardClass)} style={glassCardShadow}>
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                  <th className="px-3 py-2">Район</th>
                  {SEGMENTS.map((s) => (
                    <th key={s.key} className="px-3 py-2 text-right">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {districts.map((district) => {
                  const hubUrl = districtHubUrl(district);
                  return (
                    <tr key={district} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-ink">
                        {hubUrl ? (
                          <Link to={hubUrl} className="text-primary-hover hover:underline">
                            {district}
                          </Link>
                        ) : (
                          district
                        )}
                      </td>
                      {SEGMENTS.map((s) => {
                        const row = rowFor(district, s.key);
                        const reliable = row && row.n >= MIN_RELIABLE_N && row.median != null;
                        return (
                          <td key={s.key} className="px-3 py-2 text-right tabular-nums">
                            {row && row.median != null ? (
                              reliable ? (
                                <span className="text-ink">
                                  {formatMoney(row.median)}/м²/мес <span className="text-ink-faint">({row.n})</span>
                                </span>
                              ) : (
                                <span className="text-ink-faint">{formatMoney(row.median)}/м²/мес (ориент.)</span>
                              )
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <section className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Что это за цифры</h2>
          <p className="text-sm leading-relaxed text-ink-muted">
            Медиана ставки аренды за м²/мес по каждому административному району Минска, по трём сегментам разом.
            Число в скобках — сколько объявлений легло в основу медианы; при менее чем {MIN_RELIABLE_N} объявлениях
            цифра помечена «ориентировочно». Разбивки по неформальным микрорайонам (Уручье, Каменная Горка и т.п.)
            или по станциям метро здесь нет — у объявлений с площадок нет таких структурных полей для сегментов
            торговли и складов; для офисов в бизнес-центрах такая разбивка есть в{' '}
            <Link to="/minsk/bcminsk" className="text-primary-hover hover:underline">
              каталоге бизнес-центров
            </Link>{' '}
            — там расстояние до метро и микрорайон считаются по координатам конкретного здания.
          </p>
          <p className="text-sm text-ink-muted">
            Машиномест в этой таблице нет — там цена считается за объект целиком, не за м², смешивать с остальными
            тремя колонками в одних единицах было бы некорректно; сводка по районам для них — на{' '}
            <Link to="/minsk/analytics/mashinomesta/arenda" className="text-primary-hover hover:underline">
              собственной странице
            </Link>
            .
          </p>
          <p className="text-sm text-ink-muted">
            Цены на продажу и подробности по каждому сегменту — на страницах{' '}
            <Link to="/minsk/analytics/ofisy/arenda" className="text-primary-hover hover:underline">
              офисов
            </Link>
            ,{' '}
            <Link to="/minsk/analytics/torgovye/arenda" className="text-primary-hover hover:underline">
              торговых помещений
            </Link>{' '}
            и{' '}
            <Link to="/minsk/analytics/sklady/arenda" className="text-primary-hover hover:underline">
              складов
            </Link>
            . Методика — на{' '}
            <Link to="/minsk/analytics/metodika" className="text-primary-hover hover:underline">
              отдельной странице
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
