import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid,
  Building2,
  Receipt,
  Users,
  UsersRound,
  ClipboardList,
  Calculator,
  FileStack,
  MessageSquareText,
  Settings,
  ListChecks,
  TrendingUp,
  Landmark,
  Palette,
  Globe,
  ClipboardCheck,
  ShoppingCart,
  BarChart3,
} from 'lucide-react';

// Единый список страниц админки — здесь и маршрут, и ключ доступа (см.
// data/accessProfiles.ts), и то, что рисуется в сайдбаре. Раньше эти же
// данные жили только в Sidebar.tsx как список для меню; вынесено сюда,
// когда понадобилось использовать тот же список ещё и для проверки
// доступа на уровне маршрутов (RequirePage) — держать один источник
// правды проще, чем синхронизировать два похожих списка вручную.
export type PageKey =
  | 'dashboard'
  | 'tasks'
  | 'transactions'
  | 'leads'
  | 'landings'
  | 'siteMetrics'
  | 'marketOffers'
  | 'contractors'
  | 'objects'
  | 'tz'
  | 'estimates'
  | 'purchases'
  | 'finModels'
  | 'financing'
  | 'designProjects'
  | 'documents'
  | 'meetingSummaries'
  | 'settings'
  | 'backlog';

export interface AdminPage {
  key: PageKey;
  to: string;
  label: string;
  icon: LucideIcon;
}

// Все существующие страницы админки (включая скрытые из меню — Дашборд,
// Предложить идею/Бэклог — им всё равно нужен ключ доступа на случай
// прямого перехода по ссылке).
export const ADMIN_PAGES: AdminPage[] = [
  { key: 'dashboard', to: '/admin/dashboard', label: 'Дашборд', icon: LayoutGrid },
  { key: 'tasks', to: '/admin/tasks', label: 'Задачи', icon: ListChecks },
  { key: 'objects', to: '/admin/objects', label: 'Объекты', icon: Building2 },
  { key: 'tz', to: '/admin/tz', label: 'Техзадания', icon: ClipboardList },
  { key: 'estimates', to: '/admin/estimates', label: 'Сметы', icon: Calculator },
  { key: 'finModels', to: '/admin/finmodels', label: 'Финмодели', icon: TrendingUp },
  { key: 'financing', to: '/admin/financing', label: 'Финансирование', icon: Landmark },
  { key: 'designProjects', to: '/admin/design-projects', label: 'Дизайн-проекты', icon: Palette },
  { key: 'leads', to: '/admin/leads', label: 'Лиды', icon: Users },
  { key: 'landings', to: '/admin/landings', label: 'Лендинги', icon: Globe },
  // "Показатели" — посещаемость сайта из Яндекс.Метрики (2026-09-10). Урл и
  // компонент (SiteMetrics/site-metrics) намеренно НЕ /admin/metrics —
  // тот путь уже занят другой, не связанной страницей ("Метрики" Альмиры/
  // Светланы, staff-активность, RequireSuperAdmin, не в меню — см. Metrics.tsx).
  { key: 'siteMetrics', to: '/admin/site-metrics', label: 'Показатели', icon: BarChart3 },
  { key: 'marketOffers', to: '/admin/market-offers', label: 'Аналитика рынка', icon: ClipboardCheck },
  // "Команда" (бывшие "Подрядчики") — отдельный пункт сразу после "Объекты",
  // владелец явно поправил после первой версии (2026-08-29): "это страница
  // Команда, она должна быть в меню после Объектов" — не сливать с
  // Закупками, несмотря на то что обе темы обсуждались в одном заходе.
  // Ключ 'contractors' сохранён как есть (не заводили новый), в профиле
  // Светланы именно он, и на нём же завязан бейдж дней рождения в Sidebar.tsx.
  { key: 'contractors', to: '/admin/contractors', label: 'Команда', icon: UsersRound },
  // "Поставщики" (была "Закупки") — отдельный пункт внутри группы "Стройка".
  // Ключ 'purchases' и адрес /admin/purchases — исторические (страница
  // существовала под этим именем до слияния 2026-08-29), не переименовывали
  // ради лишнего дифа в профилях доступа/RequirePage. Владелец, 2026-09-03:
  // "давай пока вообще уберём Закупки, они только путают... Поставщики -
  // Ведомости материалов - Письма" — сама вкладка "Закупки" внутри страницы
  // убрана (см. комментарий в Suppliers.tsx), поэтому и пункт меню
  // переименован вслед за новым набором вкладок.
  { key: 'purchases', to: '/admin/purchases', label: 'Поставщики', icon: ShoppingCart },
  { key: 'transactions', to: '/admin/transactions', label: 'Транзакции', icon: Receipt },
  { key: 'documents', to: '/admin/documents', label: 'Документы', icon: FileStack },
  { key: 'meetingSummaries', to: '/admin/meeting-summaries', label: 'Саммери встреч', icon: MessageSquareText },
  { key: 'settings', to: '/admin/settings', label: 'Настройки', icon: Settings },
  { key: 'backlog', to: '/admin/backlog', label: 'Предложить идею', icon: ListChecks },
];

// Порядок и состав пунктов в основном меню сайдбара (без "Предложить
// идею" — у него свой пункт снизу, как и раньше).
export const VISIBLE_PAGE_KEYS: PageKey[] = [
  'tasks',
  'objects',
  'contractors',
  'tz',
  'estimates',
  'purchases',
  'finModels',
  'financing',
  'designProjects',
  'landings',
  'siteMetrics',
  'marketOffers',
  'leads',
  'transactions',
  'documents',
  'meetingSummaries',
  'settings',
];

// Раскладка сайдбара поверх VISIBLE_PAGE_KEYS: обычно пункт меню = страница,
// но некоторые пункты хочется сгруппировать под общим подзаголовком (см.
// Sidebar.tsx) — например "Маркетинг" объединяет "Лендинги" и "Лиды", когда
// пунктов в этой теме набирается больше одного. Остальные пункты остаются
// плоским списком, как раньше.
export type SidebarEntry = { type: 'page'; key: PageKey } | { type: 'group'; label: string; keys: PageKey[] };

export const SIDEBAR_LAYOUT: SidebarEntry[] = [
  { type: 'page', key: 'tasks' },
  { type: 'page', key: 'objects' },
  { type: 'page', key: 'contractors' },
  { type: 'group', label: 'Стройка', keys: ['tz', 'estimates', 'purchases', 'designProjects'] },
  { type: 'group', label: 'Финансы', keys: ['finModels', 'financing', 'transactions', 'documents'] },
  { type: 'group', label: 'Маркетинг', keys: ['landings', 'siteMetrics', 'marketOffers', 'leads'] },
  { type: 'page', key: 'meetingSummaries' },
  { type: 'page', key: 'settings' },
];

export function findPage(key: PageKey): AdminPage {
  const page = ADMIN_PAGES.find((p) => p.key === key);
  if (!page) throw new Error(`Unknown page key: ${key}`);
  return page;
}
