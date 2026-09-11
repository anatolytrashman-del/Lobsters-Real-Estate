import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { cn } from '../../lib/cn';
import { glassPillClass, glassPillShadow } from '../../lib/glass';
import { useMarketOfferDiscussionWatcher } from '../../lib/marketOfferDiscussionWatcher';
import { useSupplierEmailWatcher } from '../../lib/supplierEmailWatcher';
import { useSupplierWebSearchJobWatcher } from '../../lib/supplierWebSearchJobWatcher';
import { useSupplierEnrichmentJobWatcher } from '../../lib/supplierEnrichmentJobWatcher';

// index.html — общий статический файл на все роуты (публичный SPA-фолбэк),
// его <title> заточен под OG-превью продающей страницы (см. index.html).
// Для админки просто подменяем document.title на время жизни этого layout
// и возвращаем как было при уходе — без завязки на конкретный текст
// публичного тайтла, чтобы не дублировать его здесь на будущее.
const ADMIN_TITLE = 'Админка Redevelopment';

export function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Один опрос на всё приложение, не с каждой страницы — см. сами хуки.
  useMarketOfferDiscussionWatcher();
  useSupplierEmailWatcher();
  useSupplierWebSearchJobWatcher();
  useSupplierEnrichmentJobWatcher();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = ADMIN_TITLE;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // Владелец, 2026-09-11: "у Альмиры на ноуте стало видно очень мало
  // элементов, мало поставщиков" — на её окне (~1280x620 CSS-px против
  // ~1440x760 у владельца) админка при том же базовом кегле показывала
  // почти вдвое меньше содержимого. Класс включает плавный масштаб
  // интерфейса по размеру окна (см. html.admin-dense в src/index.css) —
  // вся вёрстка в rem, поэтому кегль html ужимает разом текст, отступы,
  // иконки и ширины колонок. Только на админке: <html> общий на все роуты,
  // поэтому класс снимаем при уходе с /admin/* (публичные лендинги должны
  // остаться со своей типографикой).
  useEffect(() => {
    document.documentElement.classList.add('admin-dense');
    return () => {
      document.documentElement.classList.remove('admin-dense');
    };
  }, []);

  // Переход по ссылке из шторки уже закрывает её (см. Sidebar), но роут
  // может смениться и другим путём (кнопка "назад" браузера) — на всякий
  // случай закрываем шторку при любой смене пути.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    // Владелец, 2026-09-10: "чтобы влезало полностью, вне зависимости от
    // экрана" (композер письма поставщику упирался в нижний край окна) —
    // раньше вся админка скроллилась одним длинным document/body, без
    // единой ограниченной по высоте области. h-svh (было min-h-svh) + свой
    // overflow-y-auto на <main> ниже — теперь именно <main> скроллируемый
    // контейнер, а не документ целиком (то же самое для пользователя на
    // страницах короче экрана — скроллбар просто переехал с окна на main).
    // Sidebar.tsx уже был готов к этому (lg:sticky + h-svh + свой
    // overflow-y-auto) — трогать его не пришлось. Страницы, которым нужна
    // "заполнить всю высоту экрана" вёрстка (см. SupplierCorrespondenceTab),
    // используют flex-1 min-h-0 вниз по дереву от .mx-auto ниже.
    <div className="flex h-svh bg-bg">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Верхняя полоса с гамбургером — только ниже lg, где сайдбар уехал в шторку. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Открыть меню"
            className={cn('flex h-10 w-10 shrink-0 items-center justify-center text-ink', glassPillClass)}
            style={glassPillShadow}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-base font-extrabold tracking-wide text-ink">
            {/* text-primary-hover, не text-primary — тот же фикс, что уже
                применён на гиде района (DistrictGuidePage.tsx) для этого же
                логотипа: базовый красный на этом фоне даёт контраст ниже
                4,5:1 (Accessibility, UX-аудит мобильной шапки админки). */}
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </span>
        </div>
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto flex h-full min-h-0 max-w-[1400px] min-w-0 flex-col gap-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
