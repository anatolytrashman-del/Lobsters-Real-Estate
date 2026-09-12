import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, BookOpen, Building2, Lock, Store } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setGenericPageMeta, setOrganizationJsonLd } from '../lib/pageMeta';
import { DISTRICTS, DISTRICTS_WITH_GUIDE } from '../data/districts';

// Хаб раздела "Минск" (SEO_PLAN.md, урл-структура /minsk/...) — только
// гиды по районам, под общим city-scoped префиксом. Корень сайта (/)
// сознательно НЕ стал этой страницей: по плану Э2-4 в SEO_PLAN.md он
// зарезервирован под будущую отдельную страницу платформы (другая
// аудитория, другая гео-настройка), а /minsk — city-scoped раздел, готовый
// к появлению других городов рядом (redevelopment.pro/<город>/...) без
// переезда текущих ссылок.
// Владелец (2026-08-25) убрал отсюда секцию "Комплексы" (список объектов
// компании — Red One и т.п.) и "Аналитика рынка" (ссылка на удалённый
// /minsk/analytics) — хаб теперь только про гиды по районам, сам объект
// по-прежнему доступен напрямую по своей ссылке (/minsk/one), просто не
// перечисляется здесь.
// Аудит поиска 2026-09-07 вернул сюда две ссылки — на каталог БЦ и на Red
// One: с /minsk не было ни одной входящей ссылки ни на /minsk/bcminsk, ни на
// /minsk/one, каталог и все карточки БЦ оказались «островом» и не попали в
// индекс ни Google, ни Яндекса. Это не прежняя секция «Комплексы» (список
// всех объектов), а ровно две ссылки — каталог как справочник и Red One как
// единственная продающая страница.
// ANALYTICSPLAN.md (2026-09-07) вернул раздел "Аналитика рынка" — на этот
// раз не как ссылку на удалённую страницу, а на новый /minsk/analytics
// (бенчмарк-страницы по ставкам аренды/продажи офисов из market_snapshots,
// см. scripts/build-market-snapshots.mjs) — прямое поручение владельца по
// новому плану, не отмена решения от 2026-08-25 задним числом.
const TITLE = 'Коммерческая недвижимость в Минске — Redevelopment';
const DESCRIPTION = 'Гиды по районам Минска для арендаторов и собственников коммерческой недвижимости.';
const PAGE_URL = 'https://redevelopment.pro/minsk';

export function MinskHub() {
  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: PAGE_URL });
    setOrganizationJsonLd(true);
  }, []);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 sm:px-8">
          <span className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </span>
        </div>
      </div>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12 sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Коммерческая недвижимость в Минске</h1>
          <p className="max-w-2xl text-ink">Гиды по районам для арендаторов и собственников коммерческой недвижимости.</p>
        </div>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Справочники и объекты</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/minsk/bcminsk"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Building2 className="h-4 w-4 shrink-0 text-ink-faint" />
                  Бизнес-центры Минска
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">Каталог: класс, площадь, метро, арендаторы, объявления</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/one"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <Store className="h-4 w-4 shrink-0 text-ink-faint" />
                  Деловой центр Red One
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">Кабинеты и рабочие места в собственность в Минск Мире</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
            <Link
              to="/minsk/analytics"
              className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2.5 font-medium text-ink">
                  <BarChart3 className="h-4 w-4 shrink-0 text-ink-faint" />
                  Аналитика рынка
                </span>
                <span className="pl-6.5 text-xs text-ink-muted">Ставки аренды и цены продажи офисов по классам и районам</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-bold text-ink">Гиды по районам</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DISTRICTS.map((d) => {
              const available = DISTRICTS_WITH_GUIDE.includes(d.slug);
              return available ? (
                <Link
                  key={d.slug}
                  to={`/minsk/${d.slug}`}
                  className={cn('flex items-center justify-between gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
                  style={glassCardShadow}
                >
                  <span className="flex items-center gap-2.5 font-medium text-ink">
                    <BookOpen className="h-4 w-4 shrink-0 text-ink-faint" />
                    {d.name}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                </Link>
              ) : (
                <div
                  key={d.slug}
                  className="flex items-center justify-between gap-2 rounded-control border border-border p-4 text-ink-faint"
                >
                  <span className="flex items-center gap-2.5 font-medium">
                    <BookOpen className="h-4 w-4 shrink-0" />
                    {d.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <Lock className="h-3.5 w-3.5" />
                    скоро
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
