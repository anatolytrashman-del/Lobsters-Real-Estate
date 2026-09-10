import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { RequirePage } from './components/layout/RequirePage';
import { RequireSuperAdmin } from './components/layout/RequireSuperAdmin';
import { useParams } from 'react-router-dom';
import { PublicBuildingPlan } from './pages/PublicBuildingPlan';
import { ObjectLandingPage } from './pages/ObjectLandingPage';
import { DistrictGuidePage } from './pages/DistrictGuidePage';
import { MinskMirTopicPage } from './pages/MinskMirTopicPage';
import { BusinessCentersMinskPage } from './pages/BusinessCentersMinskPage';
import { BusinessCentersRankingPage } from './pages/BusinessCentersRankingPage';
import { BusinessCenterDetailPage } from './pages/BusinessCenterDetailPage';
import { MinskHub } from './pages/MinskHub';
import { MarketAnalyticsHub } from './pages/MarketAnalyticsHub';
import { OfficeAnalyticsPage } from './pages/OfficeAnalyticsPage';
import { RetailAnalyticsPage } from './pages/RetailAnalyticsPage';
import { WarehouseAnalyticsPage } from './pages/WarehouseAnalyticsPage';
import { ParkingAnalyticsPage } from './pages/ParkingAnalyticsPage';
import { MinskMirAnalyticsPage } from './pages/MinskMirAnalyticsPage';
import { DistrictsAnalyticsPage } from './pages/DistrictsAnalyticsPage';
import { AnalyticsMethodologyPage } from './pages/AnalyticsMethodologyPage';
import { BriefPublicPage } from './pages/BriefPublicPage';
import { MeetingSummaryPublicPage } from './pages/MeetingSummaryPublicPage';
import { NotFound } from './pages/NotFound';
import { metrikaHit } from './lib/metrika';

// Вся админка (CRM с десятком разделов — финмодели, сметы, документы и т.д.)
// нужна только за PasswordGate на /admin/*, но раньше грузилась тем же JS-
// бандлом, что и продающая страница объекта — посетитель лендинга скачивал
// весь код CRM, даже никогда его не открыв. lazy() выносит каждую админ-
// страницу в свой чанк, догружаемый при переходе в /admin — публичные
// страницы (лендинг объекта и три токенизированные, см. Routes ниже) этого
// веса больше не тащат.
//
// PAGESPEED_PLAN.md, Э7 — публичные страницы ОДИН РАЗ переводились на
// lazy() (та же схема, что у админки) и были отменены: реальный прогон
// PageSpeed на проде показал, что это УХУДШИЛО LCP/FCP/SI (например LCP
// 4,4с → 5,7с), хотя главный чанк формально стал вдвое легче. Причина —
// приложение не делает настоящую SSR-гидратацию (`main.tsx`: `createRoot`,
// не `hydrateRoot`), пререндер-снапшот (Э0) — это просто статический HTML
// для первой краски и краулеров, а не разметка, которую React подхватывает
// без пересборки. Как только грузится JS, React рендерит дерево заново с
// нуля поверх этого HTML — при обычном (не-lazy) компоненте страницы это
// происходит за один кадр и незаметно (итоговый DOM совпадает с уже
// показанным), а если КОРНЕВОЙ компонент страницы — lazy(), React обязан
// сначала показать Suspense fallback (спиннер), СТИРАЯ уже видимый
// пререндеренный контент, и только после догрузки чанка отрисовать
// страницу заново — это и есть реальный лишний "Element render delay"
// (в отчёте вырос с ~100мс до ~1870мс), который целиком съедает выигрыш
// от пререндера. lazy() безопасен для админ-страниц (там нет пререндер-
// снапшота, стирать нечего) и для второстепенных публичных путей без
// собственного пререндера (BusinessUploadPublicPage/EstimatePublicPage
// ниже — токен-страницы для одного исполнителя, не для посетителей с
// поиска) — но не для страниц, ради которых и делался Э0.
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
// комментарий. lazy(), а не статический импорт как у остальных публичных
// страниц выше: она тянет за собой разбор .webarchive/bplist, этот код не
// должен попадать в основной бандл продающих лендингов ради одной
// рабочей ссылки для одного исполнителя.
const BusinessUploadPublicPage = lazy(() =>
  import('./pages/BusinessUploadPublicPage').then((m) => ({ default: m.BusinessUploadPublicPage })),
);

// Публичная ссылка на построчную смету для строителя (Артём и т.п.) — тот
// же принцип, что и у BusinessUploadPublicPage выше: lazy(), а не статический
// импорт, потому что тянет за собой EstimateLineItemsTable/FormModal/
// CommentsModal (иначе те же компоненты дублировались бы в основной бандл
// продающих лендингов, хотя уже есть в чанке /admin/estimates).
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
// init.
function useMetrikaSpaHits() {
  const location = useLocation();
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    metrikaHit(location.pathname + location.search);
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

// Фолбэк на время догрузки чанка админки (см. lazy() выше) — только для
// /admin/*, публичные страницы импортированы статически и его не видят.
function AdminChunkFallback() {
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
          готовый к появлению других городов рядом без
          переезда уже проиндексированных ссылок под /minsk. Импортированы
          статически (не lazy) — это ровно те страницы, ради которых существует
          бандл-сплиттинг выше: им нельзя добавлять лишний сетевой перелёт на
          догрузку чанка. */}
      <Route path="/" element={<Navigate to="/minsk" replace />} />
      <Route path="/minsk" element={<MinskHub />} />
      {/* Аналитика рынка (ANALYTICSPLAN.md) — бенчмарк-страницы с постоянным
          URL, месяц меняется в тексте, не в адресе. Регистрируются раньше
          "/minsk/:slug" (лендинг объекта) ниже, чтобы не конфликтовать. */}
      <Route path="/minsk/analytics" element={<MarketAnalyticsHub />} />
      <Route path="/minsk/analytics/metodika" element={<AnalyticsMethodologyPage />} />
      <Route path="/minsk/analytics/ofisy/arenda" element={<OfficeAnalyticsPage deal="rent" />} />
      <Route path="/minsk/analytics/ofisy/prodazha" element={<OfficeAnalyticsPage deal="sale" />} />
      <Route path="/minsk/analytics/torgovye/arenda" element={<RetailAnalyticsPage deal="rent" />} />
      <Route path="/minsk/analytics/torgovye/prodazha" element={<RetailAnalyticsPage deal="sale" />} />
      <Route path="/minsk/analytics/sklady/arenda" element={<WarehouseAnalyticsPage deal="rent" />} />
      <Route path="/minsk/analytics/sklady/prodazha" element={<WarehouseAnalyticsPage deal="sale" />} />
      <Route path="/minsk/analytics/mashinomesta/arenda" element={<ParkingAnalyticsPage deal="rent" />} />
      <Route path="/minsk/analytics/mashinomesta/prodazha" element={<ParkingAnalyticsPage deal="sale" />} />
      <Route path="/minsk/analytics/minsk-mir" element={<MinskMirAnalyticsPage />} />
      <Route path="/minsk/analytics/rajony" element={<DistrictsAnalyticsPage />} />
      <Route path="/minsk/minsk-mir" element={<DistrictGuidePage />} />
      <Route path="/minsk/minsk-mir/:topic" element={<MinskMirTopicPage />} />
      <Route path="/minsk/bcminsk" element={<BusinessCentersMinskPage />} />
      {/* Хаб-страницы по классу/району (Fable-анализ, 2026-09-06) — тот же
          компонент, фильтр читается из useParams(), см. комментарий там же.
          Регистрируются ДО ":slug", чтобы не конфликтовать с ним. */}
      {/* Ось «строящиеся» (аудит поиска 2026-09-07) — тот же компонент с пропом. */}
      <Route path="/minsk/bcminsk/stroyashchiesya" element={<BusinessCentersMinskPage underConstruction />} />
      {/* Рейтинг «Лучшие бизнес-центры Минска» (аудит 2026-09-07) — отдельный компонент, не хаб-фильтр. */}
      <Route path="/minsk/bcminsk/reyting" element={<BusinessCentersRankingPage />} />
      <Route path="/minsk/bcminsk/class/:classSlug" element={<BusinessCentersMinskPage />} />
      <Route path="/minsk/bcminsk/raion/:districtSlug" element={<BusinessCentersMinskPage />} />
      {/* Пересечение класс×район (владелец, 2026-09-06: "структура урлов...
          точечные страницы будут хорошо приняты поиском") — тот же
          компонент, оба параметра сразу, регистрируется ПОСЛЕ одноосевых
          хабов (react-router не заботит порядок непересекающихся паттернов,
          но так рядом с ними явно видно, что это третий, более узкий
          вариант того же роута), тоже ДО ":slug". */}
      <Route path="/minsk/bcminsk/class/:classSlug/raion/:districtSlug" element={<BusinessCentersMinskPage />} />
      {/* Хаб по неформальному микрорайону ("Уручье", "Малиновка" — владелец,
          2026-09-07) — отдельная, не пересекающаяся с классом/районом ось,
          не комбинируется с ними (см. комментарий у MICRODISTRICT_SLUGS). */}
      <Route path="/minsk/bcminsk/microrayon/:microdistrictSlug" element={<BusinessCentersMinskPage />} />
      {/* Хаб по станции метро (аудит 2026-09-07) — независимая ось, см. METRO_STATION_SLUGS. */}
      <Route path="/minsk/bcminsk/metro/:metroSlug" element={<BusinessCentersMinskPage />} />
      {/* Хаб по улице (аудит 2026-09-07) — независимая ось, см. STREET_SLUGS. */}
      <Route path="/minsk/bcminsk/ulitsa/:streetSlug" element={<BusinessCentersMinskPage />} />
      <Route path="/minsk/bcminsk/:slug" element={<BusinessCenterDetailPage />} />
      <Route path="/plan/:token" element={<PublicBuildingPlan />} />
      <Route path="/tz/:token" element={<BriefPublicPage />} />
      <Route path="/summary/:token" element={<MeetingSummaryPublicPage />} />
      <Route
        path="/business-upload"
        element={
          <Suspense fallback={<AdminChunkFallback />}>
            <BusinessUploadPublicPage />
          </Suspense>
        }
      />
      <Route
        path="/estimate/:token"
        element={
          <Suspense fallback={<AdminChunkFallback />}>
            <EstimatePublicPage />
          </Suspense>
        }
      />
      <Route path="/minsk/:slug" element={<ObjectLandingPage />} />
      {/* Старые адреса без /minsk — см. LegacySlugRedirect выше. */}
      <Route path="/rayon-minsk-mir" element={<Navigate to="/minsk/minsk-mir" replace />} />
      <Route path="/:legacySlug" element={<LegacySlugRedirect />} />

      {/* Админка теперь живёт под /admin, а не на голом домене — корень
          зарезервирован под продающие страницы объектов. */}
      <Route
        path="/admin"
        element={
          <Suspense fallback={<AdminChunkFallback />}>
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
