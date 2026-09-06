import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { RequirePage } from './components/layout/RequirePage';
import { RequireSuperAdmin } from './components/layout/RequireSuperAdmin';
import { useParams } from 'react-router-dom';
import { NotFound } from './pages/NotFound';

// Вся админка (CRM с десятком разделов — финмодели, сметы, документы и т.д.)
// нужна только за PasswordGate на /admin/*, но раньше грузилась тем же JS-
// бандлом, что и продающая страница объекта — посетитель лендинга скачивал
// весь код CRM, даже никогда его не открыв. lazy() выносит каждую админ-
// страницу в свой чанк, догружаемый при переходе в /admin.
//
// PAGESPEED_PLAN.md, Э7 — публичные страницы (лендинг объекта, гид района и
// т.д.) раньше были ЕДИНСТВЕННЫМ, что оставалось статическим импортом:
// комментарий тут прямо говорил "им нельзя добавлять лишний сетевой перелёт
// на догрузку чанка" — это было верно ДО пререндера (Э0). С пререндером
// реальный контент страницы виден в HTML ДО того, как вообще загрузился
// React, поэтому лишний round-trip за JS-чанком уже не блокирует то, что
// видит посетитель/краулер — а вот отсутствие сплиттинга означало, что
// лендинг объекта тянул за собой код каталога БЦ, гида района и всех
// остальных публичных страниц разом (реальный эффект на живом отчёте
// PageSpeed — LCP упирался именно в конкуренцию за throttled-канал между
// hero-картинкой и главным JS-чанком). Теперь публичные страницы лениво
// грузятся так же, как и админские — каждая своим чанком.
const PublicBuildingPlan = lazy(() =>
  import('./pages/PublicBuildingPlan').then((m) => ({ default: m.PublicBuildingPlan })),
);
const ObjectLandingPage = lazy(() =>
  import('./pages/ObjectLandingPage').then((m) => ({ default: m.ObjectLandingPage })),
);
const DistrictGuidePage = lazy(() =>
  import('./pages/DistrictGuidePage').then((m) => ({ default: m.DistrictGuidePage })),
);
const BusinessCentersMinskPage = lazy(() =>
  import('./pages/BusinessCentersMinskPage').then((m) => ({ default: m.BusinessCentersMinskPage })),
);
const BusinessCenterDetailPage = lazy(() =>
  import('./pages/BusinessCenterDetailPage').then((m) => ({ default: m.BusinessCenterDetailPage })),
);
const MinskHub = lazy(() => import('./pages/MinskHub').then((m) => ({ default: m.MinskHub })));
const BriefPublicPage = lazy(() => import('./pages/BriefPublicPage').then((m) => ({ default: m.BriefPublicPage })));
const MeetingSummaryPublicPage = lazy(() =>
  import('./pages/MeetingSummaryPublicPage').then((m) => ({ default: m.MeetingSummaryPublicPage })),
);

const AppLayout = lazy(() => import('./components/layout/AppLayout').then((m) => ({ default: m.AppLayout })));
const PasswordGate = lazy(() => import('./components/layout/PasswordGate').then((m) => ({ default: m.PasswordGate })));
const AdminIndex = lazy(() => import('./pages/AdminIndex').then((m) => ({ default: m.AdminIndex })));
const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const TransactionsReport = lazy(() => import('./pages/TransactionsReport').then((m) => ({ default: m.TransactionsReport })));
const Leads = lazy(() => import('./pages/Leads').then((m) => ({ default: m.Leads })));
const Contractors = lazy(() => import('./pages/Contractors').then((m) => ({ default: m.Contractors })));
// "Поставщики" (была "Закупки" — владелец, 2026-09-03: "уберём Закупки, они
// только путают") — компонент по историческим причинам называется Suppliers,
// см. комментарий в самом файле. Purchases.tsx (embedded, вкладка "Закупки")
// с этой правкой сюда больше не подключается.
const Suppliers = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.Suppliers })));
const Objects = lazy(() => import('./pages/Objects').then((m) => ({ default: m.Objects })));
const ObjectDetail = lazy(() => import('./pages/ObjectDetail').then((m) => ({ default: m.ObjectDetail })));
const Documents = lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })));
const LegalEntityDetail = lazy(() =>
  import('./pages/LegalEntityDetail').then((m) => ({ default: m.LegalEntityDetail })),
);
const Tasks = lazy(() => import('./pages/Tasks').then((m) => ({ default: m.Tasks })));
const Backlog = lazy(() => import('./pages/Backlog').then((m) => ({ default: m.Backlog })));
const Briefs = lazy(() => import('./pages/Briefs').then((m) => ({ default: m.Briefs })));
const Estimates = lazy(() => import('./pages/Estimates').then((m) => ({ default: m.Estimates })));
const EstimateDetail = lazy(() => import('./pages/EstimateDetail').then((m) => ({ default: m.EstimateDetail })));
const FinModels = lazy(() => import('./pages/FinModels').then((m) => ({ default: m.FinModels })));
const FinModelDetail = lazy(() => import('./pages/FinModelDetail').then((m) => ({ default: m.FinModelDetail })));
const FinModelReport = lazy(() => import('./pages/FinModelReport').then((m) => ({ default: m.FinModelReport })));
const Financing = lazy(() => import('./pages/Financing').then((m) => ({ default: m.Financing })));
const DesignProjects = lazy(() => import('./pages/DesignProjects').then((m) => ({ default: m.DesignProjects })));
const Landings = lazy(() => import('./pages/Landings').then((m) => ({ default: m.Landings })));
const MarketOffersReview = lazy(() => import('./pages/MarketOffersReview').then((m) => ({ default: m.MarketOffersReview })));
const ActivityLog = lazy(() => import('./pages/ActivityLog').then((m) => ({ default: m.ActivityLog })));
const Metrics = lazy(() => import('./pages/Metrics').then((m) => ({ default: m.Metrics })));
const DesignProjectView = lazy(() => import('./pages/DesignProjectView').then((m) => ({ default: m.DesignProjectView })));
const DesignProjectDetail = lazy(() => import('./pages/DesignProjectDetail').then((m) => ({ default: m.DesignProjectDetail })));
const MoodboardView = lazy(() => import('./pages/MoodboardView').then((m) => ({ default: m.MoodboardView })));
const MoodboardDetail = lazy(() => import('./pages/MoodboardDetail').then((m) => ({ default: m.MoodboardDetail })));
const MeetingSummaries = lazy(() => import('./pages/MeetingSummaries').then((m) => ({ default: m.MeetingSummaries })));
const MeetingSummaryDetail = lazy(() => import('./pages/MeetingSummaryDetail').then((m) => ({ default: m.MeetingSummaryDetail })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));

// Публичная (без PasswordGate) страница для фрилансера — см. её же
// комментарий. Тянет за собой разбор .webarchive/bplist — свой чанк, не
// общий с остальными публичными страницами.
const BusinessUploadPublicPage = lazy(() =>
  import('./pages/BusinessUploadPublicPage').then((m) => ({ default: m.BusinessUploadPublicPage })),
);

// Публичная ссылка на построчную смету для строителя (Артём и т.п.) — тянет
// за собой EstimateLineItemsTable/FormModal/CommentsModal (те же компоненты,
// что уже есть в чанке /admin/estimates) — свой чанк, не дублируется в чанки
// остальных публичных страниц.
const EstimatePublicPage = lazy(() =>
  import('./pages/EstimatePublicPage').then((m) => ({ default: m.EstimatePublicPage })),
);

// Случайный щипок двумя пальцами (обычный жест при скролле телефоном,
// держа его двумя руками) зумит всю страницу нативным зумом Safari — и этот
// зум остаётся, пока клиент не сведёт пальцы обратно вручную, а верстка
// после него местами едет. viewport-мета (maximum-scale/user-scalable) для
// этого ненадёжен: современный iOS Safari игнорирует user-scalable=no.
// Единственный рабочий способ — как и в зуме планировки (BuildingPlanCanvas) —
// перехватывать многопальцевый touchmove на уровне всего документа. Двойной
// тап (зум планировки) не задет: там всегда одно касание за раз.
// 2026-08-26 (мобильная оптимизация /minsk/minsk-mir) — этот же перехват
// глушил щипок ВНУТРИ виджетов Яндекс.Карт (DistrictMap/DistrictQuarterMap —
// единственные потребители ymaps в приложении), их собственный зум карты
// тоже двупальцевый жест. closest('[data-allow-pinch-zoom]') — явное
// исключение: элемент с этим атрибутом сам управляет своим содержимым
// (карта), глобальная защита от зума СТРАНИЦЫ ему не нужна и мешает.
function usePreventPageZoom() {
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length <= 1) return;
      if ((e.target as Element | null)?.closest('[data-allow-pinch-zoom]')) return;
      e.preventDefault();
    }
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => document.removeEventListener('touchmove', onTouchMove);
  }, []);
}

// Яндекс.Метрика (index.html) сама считает только ПЕРВУЮ загрузку страницы —
// SPA-переходы react-router не порождают новых просмотров, внутренняя
// навигация (в т.ч. конверсионный переход гид района → /minsk/one) была
// невидима в статистике. Штатный для SPA способ от Яндекса — вручную слать
// hit на каждую смену маршрута; первую загрузку пропускаем, её уже засчитал
// init. window.ym может отсутствовать (пререндер с ?prerender=1, блокировщик
// рекламы) — опциональный вызов, без падений.
function useMetrikaSpaHits() {
  const location = useLocation();
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    (window as unknown as { ym?: (id: number, action: string, url: string) => void }).ym?.(
      111858495,
      'hit',
      location.pathname + location.search,
    );
  }, [location.pathname, location.search]);
}

// Старые ссылки без /minsk (индексировались недолго, до переезда на
// city-scoped структуру урлов — см. CLAUDE.md) — /one, /redstorage и любой
// будущий объект по тому же паттерну автоматически редиректятся на новый
// адрес. /rayon-minsk-mir — особый случай (слаг переименован в minsk-mir,
// не просто добавлен префикс), у него свой отдельный редирект ниже.
function LegacySlugRedirect() {
  const { legacySlug } = useParams();
  return <Navigate to={`/minsk/${legacySlug}`} replace />;
}

// Фолбэк на время догрузки чанка страницы (см. lazy() выше) — общий и для
// /admin/*, и для всех публичных страниц (Э7, PAGESPEED_PLAN.md). На
// пререндеренных путях практического значения почти не имеет — реальный
// контент уже виден в статическом HTML, React просто досаживается сверху,
// как только чанк догрузится.
function PageChunkFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
    </div>
  );
}

export default function App() {
  usePreventPageZoom();
  useMetrikaSpaHits();
  return (
    <Routes>
      {/* Публичная часть — без AppLayout и без пароля, для клиентов и рекламы.
          Пока нет отдельного лендинга компании (см. SEO_PLAN.md, Э2-4), корень
          временно ведёт на /minsk — city-scoped раздел (гиды по районам),
          готовый к появлению других городов рядом без переезда уже
          проиндексированных ссылок под /minsk. Все страницы — lazy() (см.
          PAGESPEED_PLAN.md, Э7 и комментарий у объявлений выше) — с
          пререндером (Э0) реальный контент виден в HTML до догрузки чанка,
          так что это больше не тот "лишний сетевой перелёт", которого
          раньше здесь избегали. */}
      <Route path="/" element={<Navigate to="/minsk" replace />} />
      <Route
        path="/minsk"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <MinskHub />
          </Suspense>
        }
      />
      <Route
        path="/minsk/minsk-mir"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <DistrictGuidePage />
          </Suspense>
        }
      />
      <Route
        path="/minsk/bcminsk"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessCentersMinskPage />
          </Suspense>
        }
      />
      {/* Хаб-страницы по классу/району (Fable-анализ, 2026-09-06) — тот же
          компонент, фильтр читается из useParams(), см. комментарий там же.
          Регистрируются ДО ":slug", чтобы не конфликтовать с ним. */}
      <Route
        path="/minsk/bcminsk/class/:classSlug"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessCentersMinskPage />
          </Suspense>
        }
      />
      <Route
        path="/minsk/bcminsk/raion/:districtSlug"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessCentersMinskPage />
          </Suspense>
        }
      />
      {/* Пересечение класс×район (владелец, 2026-09-06: "структура урлов...
          точечные страницы будут хорошо приняты поиском") — тот же
          компонент, оба параметра сразу, регистрируется ПОСЛЕ одноосевых
          хабов (react-router не заботит порядок непересекающихся паттернов,
          но так рядом с ними явно видно, что это третий, более узкий
          вариант того же роута), тоже ДО ":slug". */}
      <Route
        path="/minsk/bcminsk/class/:classSlug/raion/:districtSlug"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessCentersMinskPage />
          </Suspense>
        }
      />
      <Route
        path="/minsk/bcminsk/:slug"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessCenterDetailPage />
          </Suspense>
        }
      />
      <Route
        path="/plan/:token"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <PublicBuildingPlan />
          </Suspense>
        }
      />
      <Route
        path="/tz/:token"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BriefPublicPage />
          </Suspense>
        }
      />
      <Route
        path="/summary/:token"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <MeetingSummaryPublicPage />
          </Suspense>
        }
      />
      <Route
        path="/business-upload"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <BusinessUploadPublicPage />
          </Suspense>
        }
      />
      <Route
        path="/estimate/:token"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <EstimatePublicPage />
          </Suspense>
        }
      />
      <Route
        path="/minsk/:slug"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <ObjectLandingPage />
          </Suspense>
        }
      />
      {/* Старые адреса без /minsk — см. LegacySlugRedirect выше. */}
      <Route path="/rayon-minsk-mir" element={<Navigate to="/minsk/minsk-mir" replace />} />
      <Route path="/:legacySlug" element={<LegacySlugRedirect />} />

      {/* Админка теперь живёт под /admin, а не на голом домене — корень
          зарезервирован под продающие страницы объектов. */}
      <Route
        path="/admin"
        element={
          <Suspense fallback={<PageChunkFallback />}>
            <PasswordGate>
              <AppLayout />
            </PasswordGate>
          </Suspense>
        }
      >
        <Route index element={<AdminIndex />} />
        <Route path="dashboard" element={<RequirePage page="dashboard"><Home /></RequirePage>} />
        <Route path="tasks" element={<RequirePage page="tasks"><Tasks /></RequirePage>} />
        <Route path="transactions" element={<RequirePage page="transactions"><Transactions /></RequirePage>} />
        <Route
          path="transactions/report"
          element={
            <RequirePage page="transactions">
              <TransactionsReport />
            </RequirePage>
          }
        />
        <Route path="leads" element={<RequirePage page="leads"><Leads /></RequirePage>} />
        <Route path="landings" element={<RequirePage page="landings"><Landings /></RequirePage>} />
        <Route
          path="market-offers"
          element={
            <RequirePage page="marketOffers">
              <MarketOffersReview />
            </RequirePage>
          }
        />
        {/* Не в меню, не в data/pages.ts — гейт RequireSuperAdmin строже
            обычного RequirePage, не пропускает даже профили с pages:'all'
            (см. компонент и комментарий в data/accessProfiles.ts). */}
        <Route
          path="activity-log"
          element={
            <RequireSuperAdmin>
              <ActivityLog />
            </RequireSuperAdmin>
          }
        />
        {/* Метрики Альмиры (Ресерч поставщиков) — тот же принцип, что и у
            activity-log выше: не в меню, не в data/pages.ts, доступ только
            по прямому урлу. */}
        <Route
          path="metrics"
          element={
            <RequireSuperAdmin>
              <Metrics />
            </RequireSuperAdmin>
          }
        />
        {/* "Команда" (contractors) и "Закупки" (purchases — Каталог/Ресерч/
            Закупки, компонент Suppliers) — два отдельных пункта меню, не
            один слитый (владелец поправил после первой версии, 2026-08-29:
            "это страница Команда, она должна быть в меню после Объектов /
            Всё остальное — это страница Закупки в стройке"). Старый адрес
            /admin/suppliers и кратковременный /admin/work-and-supplies
            (первая, слитая версия) — редиректы, чтобы не сломать уже
            сохранённые ссылки. */}
        <Route path="contractors" element={<RequirePage page="contractors"><Contractors /></RequirePage>} />
        <Route path="purchases" element={<RequirePage page="purchases"><Suppliers /></RequirePage>} />
        <Route path="suppliers" element={<Navigate to="/admin/purchases" replace />} />
        <Route path="work-and-supplies" element={<Navigate to="/admin/contractors" replace />} />
        <Route path="objects" element={<RequirePage page="objects"><Objects /></RequirePage>} />
        <Route path="objects/:id" element={<RequirePage page="objects"><ObjectDetail /></RequirePage>} />
        <Route path="tz" element={<RequirePage page="tz"><Briefs /></RequirePage>} />
        <Route path="estimates" element={<RequirePage page="estimates"><Estimates /></RequirePage>} />
        <Route path="estimates/:id" element={<RequirePage page="estimates"><EstimateDetail /></RequirePage>} />
        <Route path="finmodels" element={<RequirePage page="finModels"><FinModels /></RequirePage>} />
        <Route path="finmodels/:id" element={<RequirePage page="finModels"><FinModelDetail /></RequirePage>} />
        <Route path="finmodels/:id/report" element={<RequirePage page="finModels"><FinModelReport /></RequirePage>} />
        <Route path="financing" element={<RequirePage page="financing"><Financing /></RequirePage>} />
        <Route path="design-projects" element={<RequirePage page="designProjects"><DesignProjects /></RequirePage>} />
        <Route
          path="design-projects/:id"
          element={
            <RequirePage page="designProjects">
              <DesignProjectView />
            </RequirePage>
          }
        />
        <Route
          path="design-projects/:id/edit"
          element={
            <RequirePage page="designProjects">
              <DesignProjectDetail />
            </RequirePage>
          }
        />
        <Route
          path="design-projects/moodboards/:id"
          element={
            <RequirePage page="designProjects">
              <MoodboardView />
            </RequirePage>
          }
        />
        <Route
          path="design-projects/moodboards/:id/edit"
          element={
            <RequirePage page="designProjects">
              <MoodboardDetail />
            </RequirePage>
          }
        />
        <Route path="documents" element={<RequirePage page="documents"><Documents /></RequirePage>} />
        <Route
          path="documents/legal-entities/:id"
          element={
            <RequirePage page="documents">
              <LegalEntityDetail />
            </RequirePage>
          }
        />
        <Route
          path="meeting-summaries"
          element={
            <RequirePage page="meetingSummaries">
              <MeetingSummaries />
            </RequirePage>
          }
        />
        <Route
          path="meeting-summaries/:id"
          element={
            <RequirePage page="meetingSummaries">
              <MeetingSummaryDetail />
            </RequirePage>
          }
        />
        <Route path="settings" element={<RequirePage page="settings"><Settings /></RequirePage>} />
        <Route path="backlog" element={<RequirePage page="backlog"><Backlog /></RequirePage>} />
      </Route>
      {/* Любой нераспознанный путь (в т.ч. испорченная публичная ссылка) не должен
          проваливаться в CRM — раньше он попадал на Home внутри AppLayout. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
