import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, MapPin, Ruler, TrainFront } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setGenericPageMeta, setArticleJsonLd, setBreadcrumbJsonLd, setFaqJsonLd, setItemListJsonLd } from '../lib/pageMeta';
import { fetchBusinessCenters } from '../lib/businessCentersApi';
import type { BusinessCenter } from '../data/businessCenters';
import { shortName, shortAddress, businessClassTone } from '../lib/businessCenterDisplay';
import { Badge } from '../components/ui/Badge';
import { PhotoBlock } from '../components/businessCenters/BusinessCenterVisuals';
import { nearestMetroStation } from '../lib/metroStations';
import { FaqAccordion } from '../components/ui/FaqAccordion';

// Рейтинг «Лучшие бизнес-центры Минска» (аудит поиска 2026-09-07: подсказка
// Google «Лучшие бизнес-центры Минска» — «рейтинг с методикой и датой»).
// Методика сознательно простая и полностью прозрачная (никаких скрытых
// весов/баллов) — иначе рейтинг выглядел бы произвольным, а это ровно то,
// от чего предостерегает сам документ аудита:
//   1) только деловой класс A и B+ — два верхних, «премиальных» яруса
//      классификации (методика — в блоке SEO-текста на каталоге,
//      /minsk/bcminsk), только уже сданные здания (строящиеся не сравнить
//      по факту);
//   2) внутри списка — сортировка по общей площади по убыванию: крупный
//      сданный объект — это косвенный, но объективный признак масштаба и
//      устойчивости девелопера, единственная широко доступная метрика
//      (площадь заполнена у 138 из 143 БЦ каталога, в отличие от рейтинга
//      Яндекс.Карт — тот есть лишь у 18).
// Ничего не взвешено «на глаз» — ни отзывов, ни субъективных оценок
// качества, которых у нас физически нет по всем зданиям сразу.
const DATE_PUBLISHED = '2026-09-07';
const PAGE_URL = 'https://redevelopment.pro/minsk/bcminsk/reyting';
const TITLE = 'Лучшие бизнес-центры Минска — рейтинг класса A и B+ по площади';
const DESCRIPTION =
  'Рейтинг бизнес-центров Минска класса A и B+: сданные здания, отсортированные по общей площади. Открытая методика, дата обновления, ссылки на карточки каждого БЦ.';
const PAGE_H1 = 'Лучшие бизнес-центры Минска';
const RANKED_CLASSES: NonNullable<BusinessCenter['businessClass']>[] = ['A', 'B+'];

function buildRanking(centers: BusinessCenter[]): BusinessCenter[] {
  return centers
    .filter((c) => c.businessClass && RANKED_CLASSES.includes(c.businessClass) && c.status !== 'under_construction' && c.totalArea != null)
    .sort((a, b) => (b.totalArea ?? 0) - (a.totalArea ?? 0));
}

function RankingRow({ center, place }: { center: BusinessCenter; place: number }) {
  const nearestMetro = nearestMetroStation(center.nearestMetroStations ?? []);
  return (
    <Link
      to={`/minsk/bcminsk/${center.slug}`}
      className={cn('group flex items-center gap-4 p-4 transition-colors hover:border-primary/40', glassCardClass)}
      style={glassCardShadow}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-base font-extrabold text-ink">
        {place}
      </span>
      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-control">
        <PhotoBlock center={center} variant="card" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-bold leading-snug text-ink">{shortName(center)}</h2>
          {center.businessClass && <Badge tone={businessClassTone[center.businessClass]}>Класс {center.businessClass}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {shortAddress(center.address)}
          </span>
          {center.totalArea != null && (
            <span className="flex items-center gap-1">
              <Ruler className="h-3.5 w-3.5 shrink-0" />
              {center.totalArea.toLocaleString('ru-RU')} м²
            </span>
          )}
          {nearestMetro && (
            <span className="flex items-center gap-1">
              <TrainFront className="h-3.5 w-3.5 shrink-0" />«{nearestMetro.name}»
            </span>
          )}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint transition-colors group-hover:text-primary" />
    </Link>
  );
}

export function BusinessCentersRankingPage() {
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);

  useEffect(() => {
    fetchBusinessCenters()
      .then(setCenters)
      .catch(() => setCenters([]));
  }, []);

  const ranking = useMemo(() => (centers ? buildRanking(centers) : []), [centers]);
  const byClass = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of ranking) if (c.businessClass) counts[c.businessClass] = (counts[c.businessClass] ?? 0) + 1;
    return counts;
  }, [ranking]);

  const faqItems = useMemo(() => {
    if (ranking.length === 0) return [];
    const leader = ranking[0];
    return [
      {
        question: 'По какой методике составлен этот рейтинг?',
        answer:
          'В рейтинг попадают только сданные бизнес-центры класса A и B+ (два верхних яруса деловой классификации). Внутри списка здания отсортированы по общей площади по убыванию — это единственная объективная метрика масштаба, широко доступная по всему каталогу. Субъективных оценок и скрытых весов в методике нет.',
      },
      {
        question: 'Какой бизнес-центр Минска самый большой из класса A и B+?',
        answer: `${shortName(leader)} — ${leader.totalArea?.toLocaleString('ru-RU')} м², класс ${leader.businessClass}.`,
      },
      {
        question: 'Сколько бизнес-центров класса A и B+ в рейтинге?',
        answer: `Всего ${ranking.length}: класс A — ${byClass.A ?? 0}, класс B+ — ${byClass['B+'] ?? 0}.`,
      },
      {
        question: 'Почему в рейтинге нет зданий класса B и C?',
        answer:
          'Рейтинг нарочно ограничен верхними двумя классами — B и C заметно отличаются по качеству инженерии и отделки, сравнивать их в одном списке по площади было бы некорректно. Полный каталог со всеми классами — на странице «Бизнес-центры Минска».',
      },
    ];
  }, [ranking, byClass]);

  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: PAGE_URL, ogType: 'article' });
    setArticleJsonLd({ headline: TITLE, description: DESCRIPTION, url: PAGE_URL, datePublished: DATE_PUBLISHED, dateModified: DATE_PUBLISHED });
    setBreadcrumbJsonLd([
      { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
      { name: 'Бизнес-центры Минска', url: 'https://redevelopment.pro/minsk/bcminsk' },
      { name: 'Рейтинг' },
    ]);
  }, []);

  useEffect(() => {
    if (ranking.length === 0) return;
    setItemListJsonLd(ranking.map((c) => ({ name: shortName(c), url: `https://redevelopment.pro/minsk/bcminsk/${c.slug}` })));
    setFaqJsonLd(faqItems);
  }, [ranking, faqItems]);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 sm:px-8">
          <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted sm:flex">
            <Link to="/minsk/bcminsk" className="whitespace-nowrap transition-colors hover:text-ink">
              Каталог
            </Link>
            <Link to="/minsk/one" className="whitespace-nowrap transition-colors hover:text-ink">
              Red One
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
        <nav aria-label="Хлебные крошки" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <Link to="/minsk" className="hover:text-ink">
            Минск
          </Link>
          <span aria-hidden="true">/</span>
          <Link to="/minsk/bcminsk" className="hover:text-ink">
            Бизнес-центры
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink">Рейтинг</span>
        </nav>

        <div className={cn('flex flex-col gap-3 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
          <div className="flex items-center gap-3">
            <Award className="h-6 w-6 shrink-0 text-primary-hover" />
            <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-3xl">{PAGE_H1}</h1>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">
            Сданные бизнес-центры класса A и B+ — двух верхних ярусов деловой классификации, отсортированные по общей
            площади. Методика — ниже, полностью открытая: никаких скрытых баллов, только два прозрачных критерия.
          </p>
          <div className="rounded-control border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
            <strong className="text-ink">Методика (обновлено {DATE_PUBLISHED}):</strong> в рейтинг попадают только
            сданные БЦ класса A и B+; внутри списка — сортировка по общей площади по убыванию. Строящиеся объекты — в
            отдельном разделе{' '}
            <Link to="/minsk/bcminsk/stroyashchiesya" className="font-semibold text-primary-hover hover:underline">
              «Строящиеся бизнес-центры»
            </Link>
            .
          </div>
        </div>

        {centers === null && <p className="text-sm text-ink-muted">Загрузка…</p>}

        {centers !== null && (
          <div className="flex flex-col gap-3">
            {ranking.map((c, i) => (
              <RankingRow key={c.slug} center={c} place={i + 1} />
            ))}
          </div>
        )}

        <FaqAccordion title="Частые вопросы" items={faqItems} id="faq" />

        <div className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Ещё по бизнес-центрам Минска</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link to="/minsk/bcminsk" className="flex items-center gap-2 font-semibold text-ink hover:text-primary-hover">
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                Полный каталог бизнес-центров Минска
              </Link>
            </li>
            <li>
              <Link to="/minsk/bcminsk/class/a" className="flex items-center gap-2 text-ink hover:text-primary-hover">
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                Все бизнес-центры класса A
              </Link>
            </li>
            <li>
              <Link to="/minsk/bcminsk/stroyashchiesya" className="flex items-center gap-2 text-ink hover:text-primary-hover">
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                Строящиеся бизнес-центры Минска
              </Link>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
