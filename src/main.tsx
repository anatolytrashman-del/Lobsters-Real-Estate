import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary, clearCrashReloadFlag } from './components/ErrorBoundary'
import { initSentry } from './lib/sentry'

// P1.3 аудита безопасности — как можно раньше в жизненном цикле приложения,
// до первого рендера (см. src/lib/sentry.ts).
initSentry()

const container = document.getElementById('root')!

// PAGESPEED_PLAN.md, Э7-4 (вторая половина, первая — scripts/
// defer-entry-script.mjs). Публичные страницы приходят пререндер-снапшотом:
// #root уже заполнен готовой разметкой, включая главную картинку. React
// здесь не гидратирует (данные Supabase в снапшоте уже есть, в первом
// клиентском рендере — ещё нет, гидратация всё равно пересобрала бы
// дерево), а честно сносит снапшот и строит DOM заново. Chrome засчитывает
// LCP по уже отрисованной картинке, даже если элемент потом удалили из
// DOM (проверено локально, Chromium 141) — но только если она УСПЕЛА
// отрисоваться до сноса. Поэтому перед монтированием ждём: картинку
// первого экрана (fetchpriority="high" ставит HeroImageSlider) — загрузку
// и декодирование, и ещё два кадра, чтобы снапшот точно ушёл на экран.
// Иначе на быстрой сети первой отрисовкой становилась React-версия, и
// LCP «переезжал» на момент после загрузки и выполнения всего бандла
// (Element render delay ~2 000 мс при уже загруженной картинке — см.
// отчёт PageSpeed от 2026-09-06 в PAGESPEED_PLAN.md).
//
// Все ожидания с таймаутами: битая картинка или фоновая вкладка (rAF не
// тикает, пока вкладку не показали) не должны оставить страницу без JS.
// Пустой шелл (админка, страницы без снапшота) — монтируем сразу.
function waitForPrerenderedPaint(): Promise<void> {
  if (!container.hasChildNodes()) return Promise.resolve()

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const nextFrames = new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })

  const img = container.querySelector<HTMLImageElement>('img[fetchpriority="high"]')
  const imgReady: Promise<void> = img
    ? (img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true })
            img.addEventListener('error', () => resolve(), { once: true })
          })
      ).then(() => img.decode().catch(() => undefined))
    : Promise.resolve()

  return Promise.race([imgReady.then(() => nextFrames), sleep(3500)])
}

waitForPrerenderedPaint().then(() => {
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
  // ErrorBoundary.componentDidCatch перезагружает страницу один раз за
  // сессию вкладки при первом же непойманном крахе (см. комментарий в самом
  // компоненте) — снимаем этот флаг спустя несколько секунд успешной работы,
  // чтобы СЛЕДУЮЩИЙ, отдельный крах (даже позже в той же вкладке) снова
  // получил свою "тихую" попытку, а не сразу экран с кнопкой.
  setTimeout(clearCrashReloadFlag, 5000)
})
