import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Award, MapPin, Ruler, Star, TrainFront } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setGenericPageMeta, setArticleJsonLd, setBreadcrumbJsonLd, setFaqJsonLd, setItemListJsonLd } from '../lib/pageMeta';
import { fetchBusinessCenters } from '../lib/businessCentersApi';
import type { BusinessCenter } from '../data/businessCenters';
import { shortName, shortAddress, businessClassTone, mapRatingFromHighlights } from '../lib/businessCenterDisplay';
import { Badge } from '../components/ui/Badge';
import { PhotoBlock } from '../components/businessCenters/BusinessCenterVisuals';
import { nearestMetroStation } from '../lib/metroStations';
import { FaqAccordion } from '../components/ui/FaqAccordion';

// Рейтинг «Лучшие бизнес-центры Минска» (аудит поиска 2026-09-07: подсказка
// Google «Лучшие бизнес-центры Минска» — «рейтинг с методикой и датой»).
// Владелец (2026-09-07, после первой версии на площади): «поменял бы
// концепт этой страницы и поставил в выдачу только БЦ класса А с рейтингом
// выше 4.5» — методика теперь на двух прозрачных условиях, без скрытых
// баллов:
//   1) только деловой класс A — высший ярус классификации;
//   2) рейтинг Яндекс.Карт (тот же источник, что и бейдж на карточке БЦ,
//      см. mapRatingFromHighlights) — не ниже 4,5 из 5.
// Честная оговорка, а не подгонка списка под желаемую длину: рейтинг с
// карт структурно распознан пока не у всех БЦ (18 из 143 по каталогу) — в
// список попадают только те класса A, для кого рейтинг уже есть в базе и
// он ≥4,5; здание без распознанного рейтинга просто не участвует, не
// считается автоматически «не подходящим».
const RATING_THRESHOLD = 4.5;
const DATE_PUBLISHED = '2026-09-07';
const PAGE_URL = 'https://redevelopment.pro/minsk/bcminsk/reyting';
const TITLE = `Лучшие бизнес-центры Минска класса A с рейтингом от ${RATING_THRESHOLD}`;
const DESCRIPTION =
  'Рейтинг бизнес-центров Минска: только класс A с рейтингом на Яндекс.Картах не ниже 4,5 из 5. Открытая методика, дата обновления, ссылки на карточки каждого БЦ.';
const PAGE_H1 = 'Лучшие бизнес-центры Минска';

interface RankedCenter {
  center: BusinessCenter;
  rating: number;
  ratingLabel: string;
}

function buildRanking(centers: BusinessCenter[]): RankedCenter[] {
  return centers
    .filter((c) => c.businessClass === 'A' && c.status !== 'under_construction')
    .map((c) => {
      const rating = mapRatingFromHighlights(c.highlights);
      return rating ? { center: c, rating: rating.value, ratingLabel: rating.label } : null;
    })
    .filter((r): r is RankedCenter => r !== null && r.rating >= RATING_THRESHOLD)
    .sort((a, b) => b.rating - a.rating || (b.center.totalArea ?? 0) - (a.center.totalArea ?? 0));
}

function RankingRow({ ranked, place }: { ranked: RankedCenter; place: number }) {
  const { center, ratingLabel } = ranked;
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
          <span className="flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-ink">
            <Star className="h-3 w-3 shrink-0 fill-current text-primary-hover" />
            {ratingLabel}
          </span>
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
  const classATotal = useMemo(() => (centers ?? []).filter((c) => c.businessClass === 'A' && c.status !== 'under_construction').length, [centers]);

  const faqItems = useMemo(() => {
    if (ranking.length === 0) return [];
    const leader = ranking[0];
    return [
      {
        question: 'По какой методике составлен этот рейтинг?',
        answer: `В рейтинг попадают бизнес-центры только класса A с рейтингом на Яндекс.Картах не ниже ${RATING_THRESHOLD} из 5. Внутри списка — сортировка по рейтингу по убыванию, при равном рейтинге — по общей площади. Субъективных оценок и скрытых весов в методике нет: два прозрачных условия, оба проверяемых.`,
      },
      {
        question: 'Какой бизнес-центр класса A в Минске с самым высоким рейтингом?',
        answer: `${shortName(leader.center)} — ${leader.ratingLabel} из 5 на Яндекс.Картах.`,
      },
      {
        question: 'Сколько бизнес-центров попало в рейтинг?',
        answer: `${ranking.length} из ${classATotal} сданных бизнес-центров класса A в каталоге — у остальных рейтинг на картах либо ниже ${RATING_THRESHOLD}, либо ещё не распознан в базе.`,
      },
      {
        question: 'Почему в рейтинге нет зданий класса B+, B и C?',
        answer:
          'Рейтинг нарочно ограничен высшим классом A — самым качественным по инженерии, отделке и расположению. Все бизнес-центры Минска, включая другие классы, — в полном каталоге на странице «Бизнес-центры Минска».',
      },
    ];
  }, [ranking, classATotal]);

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
    setItemListJsonLd(ranking.map((r) => ({ name: shortName(r.center), url: `https://redevelopment.pro/minsk/bcminsk/${r.center.slug}` })));
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
            Только бизнес-центры класса A с рейтингом на Яндекс.Картах не ниже {RATING_THRESHOLD} из 5. Методика —
            ниже, полностью открытая: два прозрачных условия, никаких скрытых баллов.
          </p>
          <div className="rounded-control border border-border bg-surface px-4 py-3 text-xs text-ink-muted">
            <strong className="text-ink">Методика (обновлено {DATE_PUBLISHED}):</strong> деловой класс A и рейтинг на
            Яндекс.Картах от {RATING_THRESHOLD} из 5 — оба условия обязательны. Рейтинг распознан пока не у всех БЦ
            каталога: здание без него в список не попадает, даже если по факту хорошее — это честный пробел данных,
            не оценка. Полный список класса A — на{' '}
            <Link to="/minsk/bcminsk/class/a" className="font-semibold text-primary-hover hover:underline">
              хабе класса A
            </Link>
            .
          </div>
        </div>

        {centers === null && <p className="text-sm text-ink-muted">Загрузка…</p>}

        {centers !== null && (
          <div className="flex flex-col gap-3">
            {ranking.length === 0 && (
              <p className="p-4 text-sm text-ink-muted">Пока ни один бизнес-центр не набрал рейтинг {RATING_THRESHOLD} и выше в базе.</p>
            )}
            {ranking.map((r, i) => (
              <RankingRow key={r.center.slug} ranked={r} place={i + 1} />
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
