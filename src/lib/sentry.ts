// P1.3 аудита безопасности — мониторинг ошибок на проде (раньше падения
// узнавали только от сотрудников/владельца, см. CLAUDE.md "Журнал сессий").
// DSN не секрет (тот же принцип, что у Supabase anon key в lib/supabase.ts) —
// он и так виден в клиентском бандле у любого посетителя, безопасно зашить
// с фолбэком по умолчанию. Только error monitoring — без Session Replay/
// Tracing/Metrics, они жгут отдельные, куда более скромные бесплатные лимиты
// и не нужны для самой задачи "увидеть падение на проде".
//
// Динамический import() вместо статического — @sentry/react добавлял ~85 КБ
// gzip прямо в главный чанк (тот, что грузит КАЖДАЯ страница, включая
// продающие лендинги — над их скоростью в проекте отдельная большая работа,
// см. PAGESPEED_PLAN.md). Так пакет уезжает в свой чанк и не блокирует
// первую отрисовку — на реальном проде он всё равно подгрузится сразу, но
// в фоне, не в критическом пути.
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ??
  'https://3c66c6ac9f5e6b7d96a198c498664481@o4512063206785024.ingest.de.sentry.io/4512063242895440';

// Только реальный прод (redevelopment.pro) — единственная цель деплоя (см.
// CLAUDE.md "Деплой"). Без этой проверки локальный `vite preview`/мок-тесты
// (в проекте их много — временные /__test-* роуты, Playwright против
// dev-сервера или preview-сборки) слали бы в Sentry шум от намеренно
// воспроизводимых в тестах ошибок (например, ErrorBoundary тестируется
// реальным throw в рендере).
const PROD_HOSTNAME = 'redevelopment.pro';

function isProdHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === PROD_HOSTNAME;
}

let sentryModulePromise: Promise<typeof import('@sentry/react')> | null = null;

function loadSentry(): Promise<typeof import('@sentry/react')> | null {
  if (!isProdHost()) return null;
  if (!sentryModulePromise) {
    sentryModulePromise = import('@sentry/react').then((mod) => {
      mod.init({ dsn: SENTRY_DSN, environment: 'production' });
      return mod;
    });
  }
  return sentryModulePromise;
}

export function initSentry() {
  loadSentry();
}

export function captureException(error: unknown, extra?: Record<string, unknown>) {
  const pending = loadSentry();
  if (!pending) return;
  pending.then((mod) => mod.captureException(error, extra ? { extra } : undefined));
}
