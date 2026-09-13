import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart3, Lightbulb, Lock, LogOut, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { fetchBacklogUnreadCount } from '../../lib/backlogApi';
import { getBacklogLastViewedAt, onBacklogViewed } from '../../lib/backlogSeen';
import { fetchLeadsUnreadCount } from '../../lib/leadsApi';
import { getLeadsLastViewedAt, onLeadsViewed } from '../../lib/leadsSeen';
import { fetchContractorsWithBirthdayToday } from '../../lib/contractorsApi';
import { SIDEBAR_LAYOUT, findPage } from '../../data/pages';
import { getCurrentProfile, isPageAllowed, isSuperAdminAllowed, signOutAndClearCache } from '../../lib/accessProfile';
import { useOnlineVisitorsCount } from '../../lib/onlinePresence';

const backlogPage = findPage('backlog');

// Ниже lg — сайдбар выезжает поверх контента как шторка (fixed + translate),
// а не занимает четверть узкого экрана постоянно. От lg и шире — прежнее
// поведение (sticky-колонка слева, всегда видима, open/onClose не влияют).
interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const profile = getCurrentProfile();
  const [backlogUnread, setBacklogUnread] = useState(0);
  const [leadsUnread, setLeadsUnread] = useState(0);
  const [birthdayNames, setBirthdayNames] = useState<string[]>([]);

  const backlogAllowed = isPageAllowed(profile, 'backlog');
  const leadsAllowed = isPageAllowed(profile, 'leads');
  const contractorsAllowed = isPageAllowed(profile, 'contractors');
  // Владелец, 2026-09-05: "даже если у кого-то включен Полный доступ, эта
  // страница будет только у меня" — 'metrics' сознательно НЕ заведён как
  // обычный PageKey в data/pages.ts: там pages:'all' автоматически даёт
  // доступ к любому ключу, а тут нужно жёсткое "только Трэшмен", независимо
  // от профиля. Поэтому пункт меню не через renderNavItem/isPageAllowed, а
  // отдельной веткой ниже — isSuperAdminAllowed (тот же гейт, что и у самого
  // роута /admin/metrics, см. App.tsx). Для не-суперадмина пункт не просто
  // недоступен, а не рисуется вовсе — чтобы не палить сам факт существования
  // страницы с трекингом чужих действий.
  const metricsAllowed = isSuperAdminAllowed(profile);
  // Индикатор "N онлайн на сайте" — тот же гейт (только Трэшмен), см.
  // комментарий у metricsAllowed. Канал не джойним вовсе для остальных
  // профилей — не только чтобы не палить фичу, но и не открывать лишний
  // сокет там, где он никому не нужен.
  const onlineVisitors = useOnlineVisitorsCount(metricsAllowed);

  // Не считаем непрочитанные бэклог/лиды и дни рождения подрядчиков для
  // профиля, которому эти разделы всё равно недоступны — не только чтобы
  // не показывать лишние бейджики, но и не гонять запросы впустую.
  useEffect(() => {
    if (!backlogAllowed) return;
    function refresh() {
      fetchBacklogUnreadCount(getBacklogLastViewedAt())
        .then(setBacklogUnread)
        .catch(() => {});
    }
    refresh();
    window.addEventListener('focus', refresh);
    const unsubscribe = onBacklogViewed(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [backlogAllowed]);

  useEffect(() => {
    if (!leadsAllowed) return;
    function refresh() {
      fetchLeadsUnreadCount(getLeadsLastViewedAt())
        .then(setLeadsUnread)
        .catch(() => {});
    }
    refresh();
    window.addEventListener('focus', refresh);
    const unsubscribe = onLeadsViewed(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [leadsAllowed]);

  // Без отметки "просмотрено" — в отличие от бэклога/лидов, тут не список,
  // который можно прочитать и закрыть, а факт "сегодня чей-то день рождения",
  // актуальный весь день независимо от того, заходили ли уже в "Подрядчики".
  useEffect(() => {
    if (!contractorsAllowed) return;
    function refresh() {
      fetchContractorsWithBirthdayToday()
        .then((list) => setBirthdayNames(list.map((c) => c.name)))
        .catch(() => {});
    }
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [contractorsAllowed]);

  async function handleLogout() {
    await signOutAndClearCache();
    window.location.href = '/admin';
  }

  // indented — пункт внутри группы с подзаголовком (см. SIDEBAR_LAYOUT):
  // небольшой отступ вправо, иначе сгруппированные и обычные пункты выглядят
  // одинаково и группа "перетекает" в идущие следом плоские пункты без
  // подзаголовка (сам подзаголовок это не спасает — он выше, у следующего
  // плоского пункта после группы своего заголовка нет).
  function renderNavItem({ key, to, label, icon: Icon }: ReturnType<typeof findPage>, indented = false) {
    const allowed = isPageAllowed(profile, key);
    if (!allowed) {
      return (
        <span
          key={to}
          aria-label={`${label} — недоступно для вашего доступа`}
          title="Недоступно для вашего доступа"
          className={cn(
            'flex cursor-not-allowed items-center gap-3 rounded-control py-2.5 text-sm font-medium text-ink-faint/60',
            indented ? 'pl-6 pr-3' : 'px-3',
          )}
        >
          <Icon className="h-5 w-5" />
          {label}
          <Lock className="ml-auto h-3.5 w-3.5 shrink-0" />
        </span>
      );
    }
    return (
      <NavLink
        key={to}
        to={to}
        onClick={onClose}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-3 rounded-control py-2.5 text-sm font-medium transition-colors',
            indented ? 'pl-6 pr-3' : 'px-3',
            isActive ? 'text-primary' : 'text-ink hover:text-primary',
          )
        }
      >
        <Icon className="h-5 w-5" />
        {label}
        {key === 'contractors' && birthdayNames.length > 0 && (
          <span
            className="ml-auto shrink-0 text-base leading-none"
            role="img"
            aria-label={`Сегодня день рождения: ${birthdayNames.join(', ')}`}
            title={`Сегодня день рождения: ${birthdayNames.join(', ')}`}
          >
            🎂
          </span>
        )}
        {key === 'leads' && leadsUnread > 0 && (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">
            {leadsUnread}
          </span>
        )}
      </NavLink>
    );
  }

  return (
    <>
      {/* Подложка-затемнение позади шторки — только когда она открыта и
          только ниже lg (на десктопе сайдбар постоянно виден, подложка не нужна). */}
      {open && <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-svh w-72 max-w-[85vw] shrink-0 flex-col overflow-y-auto border-r border-white/50 bg-white/70 px-5 py-6 backdrop-blur-xl backdrop-saturate-150 transition-transform duration-200 ease-out',
          'lg:sticky lg:top-0 lg:z-0 lg:w-64 lg:max-w-none lg:translate-x-0 lg:bg-white/30',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-col gap-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-lg font-extrabold tracking-wide text-ink">
                <span className="font-black text-primary">RED</span>EVELOPMENT
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-ink-faint">{profile.displayName}</span>
                {metricsAllowed && onlineVisitors !== null && (
                  <span
                    className="flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-faint"
                    title="Сейчас на сайте (маркетинговые страницы)"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                    {onlineVisitors}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть меню"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:text-ink lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav className="flex flex-col gap-1">
            {SIDEBAR_LAYOUT.map((entry) =>
              entry.type === 'group' ? (
                <div key={entry.label} className="flex flex-col gap-1 pt-3 first:pt-0">
                  <span className="px-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{entry.label}</span>
                  {entry.keys.map((key) => renderNavItem(findPage(key), true))}
                </div>
              ) : (
                renderNavItem(findPage(entry.key))
              ),
            )}
            {metricsAllowed && (
              <NavLink
                to="/admin/metrics"
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive ? 'text-primary' : 'text-ink hover:text-primary',
                  )
                }
              >
                <BarChart3 className="h-5 w-5" />
                Метрики
              </NavLink>
            )}
          </nav>
        </div>

        <div className="mt-auto flex flex-col gap-1 border-t border-white/50 pt-4">
          {backlogAllowed ? (
            <NavLink
              to={backlogPage.to}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-ink hover:text-primary',
                )
              }
            >
              <Lightbulb className="h-5 w-5" />
              Предложить идею
              {backlogUnread > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">
                  {backlogUnread}
                </span>
              )}
            </NavLink>
          ) : (
            <span
              title="Недоступно для вашего доступа"
              className="flex cursor-not-allowed items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-ink-faint/60"
            >
              <Lightbulb className="h-5 w-5" />
              Предложить идею
              <Lock className="ml-auto h-3.5 w-3.5 shrink-0" />
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium text-ink-muted hover:text-primary"
          >
            <LogOut className="h-5 w-5" />
            Выйти
          </button>
        </div>
      </aside>
    </>
  );
}
