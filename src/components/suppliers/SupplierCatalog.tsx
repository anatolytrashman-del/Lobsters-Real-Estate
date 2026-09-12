import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cn } from '../../lib/cn';
import {
  findCatalogCategory,
  SUPPLIER_CATALOG,
  type SupplierCatalogCategory,
  type SupplierCatalogHub,
} from '../../data/supplierCatalog';
import {
  countryFlag,
  isUniversalRequest,
  supplierWebsiteHost,
  UNIVERSAL_SUPPLIERS_TITLE,
  type SupplierOffer,
  type SupplierRequest,
} from '../../data/supplierResearch';
import type { SupplierSiteSnapshot } from '../../data/supplierSiteSnapshots';

// Каталог поставщиков: хабы → категории → компании. Владелец, 2026-09-12:
// «нравится, как организованы визуально категории у ВсеИнструменты, особенно
// большие карточки». Первый экран — большие плитки хабов с числом компаний,
// внутри хаба — плитки категорий, внутри категории — список.
//
// Числа на плитке категории считаются из двух источников (см. комментарий в
// data/supplierCatalog.ts): «домашних N» — карточки в строке категории закупки
// с таким названием; «по сайту +M» — карточки из других профильных категорий,
// у которых по снимку сайта есть хотя бы одна группа плитки; «баз +K» —
// универсальные поставщики с такой группой. Так плитка отвечает не «кого мы
// сюда записали», а «кто это реально возит», и цифра «по сайту» — это те, кому
// уместно написать, если своих мало.

interface CategoryStats {
  category: SupplierCatalogCategory;
  home: SupplierOffer[];
  bySite: SupplierOffer[];
  bases: SupplierOffer[];
}

interface HubStats {
  hub: SupplierCatalogHub;
  categories: CategoryStats[];
  // Уникальные компании по всем плиткам хаба (домашние + по сайту).
  total: number;
}

function offerGroups(o: SupplierOffer, snapshotByHost: Map<string, SupplierSiteSnapshot>): string[] {
  return snapshotByHost.get(supplierWebsiteHost(o.websiteUrl))?.categories ?? [];
}

export function SupplierCatalog({
  offers,
  requests,
  snapshotByHost,
  onOpenDetail,
}: {
  offers: SupplierOffer[];
  requests: SupplierRequest[];
  snapshotByHost: Map<string, SupplierSiteSnapshot>;
  onOpenDetail: (o: SupplierOffer) => void;
}) {
  const [hubName, setHubName] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const requestTitleById = useMemo(() => new Map(requests.map((r) => [r.id, r.title])), [requests]);
  const universalRequest = useMemo(() => requests.find((r) => isUniversalRequest(r)) ?? null, [requests]);
  const universalOffers = useMemo(
    () => (universalRequest ? offers.filter((o) => o.requestId === universalRequest.id) : []),
    [offers, universalRequest],
  );

  const hubs = useMemo<HubStats[]>(() => {
    return SUPPLIER_CATALOG.map((hub) => {
      const seen = new Set<string>();
      const categories = hub.categories.map((category) => {
        const groups = new Set(category.supplyGroups);
        const home: SupplierOffer[] = [];
        const bySite: SupplierOffer[] = [];
        const bases: SupplierOffer[] = [];
        for (const o of offers) {
          const title = requestTitleById.get(o.requestId) ?? '';
          const isUniversal = universalRequest ? o.requestId === universalRequest.id : title.trim().toLowerCase() === UNIVERSAL_SUPPLIERS_TITLE.toLowerCase();
          // «Домашняя» карточка — по новому или старому названию строки (см.
          // LEGACY_REQUEST_TITLES): плитка работает и до переименования строк.
          if (findCatalogCategory(title) === category) {
            home.push(o);
            seen.add(o.id);
            continue;
          }
          const hasGroup = offerGroups(o, snapshotByHost).some((g) => groups.has(g));
          if (!hasGroup) continue;
          if (isUniversal) bases.push(o);
          else {
            bySite.push(o);
            seen.add(o.id);
          }
        }
        const byName = (a: SupplierOffer, b: SupplierOffer) => a.name.localeCompare(b.name, 'ru');
        return { category, home: home.sort(byName), bySite: bySite.sort(byName), bases: bases.sort(byName) };
      });
      return { hub, categories, total: seen.size };
    });
  }, [offers, requestTitleById, snapshotByHost, universalRequest]);

  const currentHub = hubs.find((h) => h.hub.name === hubName) ?? null;
  const currentCategory = currentHub?.categories.find((c) => c.category.name === categoryName) ?? null;
  const isUniversalHub = currentHub?.hub.categories.length === 1 && isUniversalRequest({ title: currentHub.hub.categories[0].name });

  const openHub = (h: HubStats) => {
    setHubName(h.hub.name);
    setGroupFilter(null);
    // У универсальных промежуточного уровня нет — сразу список.
    setCategoryName(h.hub.categories.length === 1 ? h.hub.categories[0].name : null);
  };

  const crumb = (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" className="text-primary-hover hover:underline" onClick={() => { setHubName(null); setCategoryName(null); setGroupFilter(null); }}>
        Каталог
      </button>
      {currentHub && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />
          {currentCategory && !isUniversalHub ? (
            <button type="button" className="text-primary-hover hover:underline" onClick={() => { setCategoryName(null); setGroupFilter(null); }}>
              {currentHub.hub.name}
            </button>
          ) : (
            <span className="text-ink">{currentHub.hub.name}</span>
          )}
        </>
      )}
      {currentCategory && !isUniversalHub && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />
          <span className="text-ink">{currentCategory.category.name}</span>
        </>
      )}
    </div>
  );

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-bold text-ink">Каталог поставщиков</span>
        {crumb}
      </div>

      {/* Уровень 0: хабы */}
      {!currentHub && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hubs.map((h) => {
            const universal = h.hub.categories.length === 1 && isUniversalRequest({ title: h.hub.categories[0].name });
            const count = universal ? universalOffers.length : h.total;
            return (
              <button
                key={h.hub.name}
                type="button"
                onClick={() => openHub(h)}
                className="flex min-h-[132px] flex-col justify-between gap-3 rounded-control border border-border bg-white/50 p-4 text-left transition hover:border-primary hover:bg-white/80"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-ink">{h.hub.name}</span>
                  <span className="line-clamp-2 text-xs text-ink-faint">{h.hub.description}</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums text-ink">{count}</span>
                  <span className="text-xs text-ink-faint">{universal ? 'баз и гипермаркетов' : `${plural(count, 'компания', 'компании', 'компаний')} · ${h.hub.categories.length} ${plural(h.hub.categories.length, 'категория', 'категории', 'категорий')}`}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Уровень 1: категории хаба */}
      {currentHub && !currentCategory && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{currentHub.hub.description}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {currentHub.categories.map((c) => (
              <button
                key={c.category.name}
                type="button"
                onClick={() => { setCategoryName(c.category.name); setGroupFilter(null); }}
                className="flex flex-col gap-3 rounded-control border border-border bg-white/50 p-4 text-left transition hover:border-primary hover:bg-white/80"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="font-semibold text-ink">{c.category.name}</span>
                  <Badge tone="neutral">{c.category.defaultComparisonMode === 'lot' ? 'поставка целиком' : 'по материалам'}</Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.category.supplyGroups.slice(0, 4).map((g) => (
                    <span key={g} className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted">{g}</span>
                  ))}
                  {c.category.supplyGroups.length > 4 && <span className="text-xs text-ink-faint">+{c.category.supplyGroups.length - 4}</span>}
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm tabular-nums">
                  <span className="text-ink"><span className="text-xl font-semibold">{c.home.length}</span> своих</span>
                  <span className="text-ink-muted">по сайту +{c.bySite.length}</span>
                  <span className="text-ink-faint">баз +{c.bases.length}</span>
                  {c.home.length === 0 && c.bySite.length === 0 && <Badge tone="warning">базу набирать</Badge>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Уровень 2: список компаний */}
      {currentCategory && (
        <CategoryView
          stats={currentCategory}
          universal={!!isUniversalHub}
          universalOffers={universalOffers}
          groupFilter={groupFilter}
          onGroupFilter={setGroupFilter}
          requestTitleById={requestTitleById}
          snapshotByHost={snapshotByHost}
          onOpenDetail={onOpenDetail}
        />
      )}
    </Card>
  );
}

function CategoryView({
  stats,
  universal,
  universalOffers,
  groupFilter,
  onGroupFilter,
  requestTitleById,
  snapshotByHost,
  onOpenDetail,
}: {
  stats: CategoryStats;
  universal: boolean;
  universalOffers: SupplierOffer[];
  groupFilter: string | null;
  onGroupFilter: (g: string | null) => void;
  requestTitleById: Map<string, string>;
  snapshotByHost: Map<string, SupplierSiteSnapshot>;
  onOpenDetail: (o: SupplierOffer) => void;
}) {
  const { category } = stats;
  const matchesFilter = (o: SupplierOffer) => !groupFilter || offerGroups(o, snapshotByHost).includes(groupFilter);
  const groupCount = (g: string) =>
    [...stats.home, ...stats.bySite].filter((o) => offerGroups(o, snapshotByHost).includes(g)).length;

  const row = (o: SupplierOffer, showCategory: boolean) => (
    <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-medium text-ink">{o.name}</span>
        <span className="text-xs text-ink-faint">
          {countryFlag(o.country)}
          {showCategory ? ` ${requestTitleById.get(o.requestId) ?? ''}` : ''}
        </span>
      </div>
      <Button type="button" variant="secondary" onClick={() => onOpenDetail(o)}>
        Подробнее
      </Button>
    </div>
  );

  if (universal) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">Базы и гипермаркеты, которые закрывают много групп сразу. В рассылку по категории подключаются отдельно.</p>
        {universalOffers.length === 0 ? <p className="text-sm text-ink-faint">Пока никого.</p> : universalOffers.map((o) => row(o, false))}
      </div>
    );
  }

  const home = stats.home.filter(matchesFilter);
  const bySite = stats.bySite.filter(matchesFilter);
  const bases = stats.bases.filter(matchesFilter);
  const empty = home.length + bySite.length + bases.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">Что сюда входит: {category.includes.join('; ')}.</p>
        {category.supplyGroups.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onGroupFilter(null)}
              className={cn('rounded-full border px-2.5 py-1 text-xs', groupFilter === null ? 'border-primary text-primary' : 'border-border text-ink-muted hover:border-primary')}
            >
              все группы
            </button>
            {category.supplyGroups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onGroupFilter(groupFilter === g ? null : g)}
                className={cn('rounded-full border px-2.5 py-1 text-xs tabular-nums', groupFilter === g ? 'border-primary text-primary' : 'border-border text-ink-muted hover:border-primary')}
              >
                {g} · {groupCount(g)}
              </button>
            ))}
          </div>
        )}
      </div>

      {empty && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-faint">
          <Search className="h-4 w-4" />
          В базе пока никого — эту категорию придётся набирать веб-поиском из карточки категории ниже.
        </div>
      )}

      {home.length > 0 && (
        <Section title={`Свои — заведены в категорию (${home.length})`}>{home.map((o) => row(o, false))}</Section>
      )}
      {bySite.length > 0 && (
        <Section title={`По сайту тоже возят (${bySite.length})`} hint="Заведены в другой категории, но на их сайте есть этот товар — им уместно написать.">
          {bySite.map((o) => row(o, true))}
        </Section>
      )}
      {bases.length > 0 && (
        <Section title={`Базы и гипермаркеты (${bases.length})`} hint="Универсальные поставщики с этим товаром в каталоге.">
          {bases.map((o) => row(o, false))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col">
        <span className="text-sm font-medium text-ink">{title}</span>
        {hint && <span className="text-xs text-ink-faint">{hint}</span>}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
