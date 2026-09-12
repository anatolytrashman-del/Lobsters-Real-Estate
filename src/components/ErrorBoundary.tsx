import { Component, type ReactNode } from 'react';
import { captureException } from '../lib/sentry';

// Владелец, 2026-09-09: "при скролле на 2/3 страницы у меня упало всё
// содержание, страница стала серой... при обновлении случилось то же самое"
// (/minsk/minsk-mir). Реальная причина — не баг конкретно этой страницы, а
// системный пробел: во всём приложении не было НИ ОДНОГО ErrorBoundary,
// поэтому любая непойманная ошибка рендера ГДЕ УГОДНО (например — неудачный
// lazy()-импорт чанка карты, который триггерится скроллом через useInView,
// см. lib/lazyRetry.ts) сносит всё дерево React целиком: #root остаётся
// пустым, и посетитель видит просто фон страницы (у нас это светло-серый
// bg-bg) без единой строчки контента — ровно то, что описал владелец.
// Suspense эту ошибку не ловит — он умеет ждать только ЕЩЁ НЕ решённый
// промис (fallback на время загрузки), а не отловленную ошибку уже
// отклонённого промиса, та распространяется дальше как обычная throw.
//
// Первый пойманный крах — тихая автоматическая перезагрузка страницы (один
// раз за сессию вкладки, sessionStorage-флаг), без пугающего экрана ошибки:
// велика вероятность, что причина — тот самый транзиентный сбой сети/CDN
// при загрузке чанка, а свежая загрузка страницы получает свежий, рабочий
// список чанков. Если ошибка повторилась СРАЗУ ПОСЛЕ этой перезагрузки
// (флаг уже стоит) — значит, дело не в разовой сетевой икоте, дальше
// авто-перезагружать бессмысленно (риск бесконечного цикла) — показываем
// обычный текст с кнопкой вместо второй тихой попытки. main.tsx снимает
// флаг через несколько секунд после успешного старта — следующий,
// отдельный сбой (даже в той же вкладке позже) получит свою тихую попытку.
const RELOAD_ONCE_KEY = 'redevelopment-crash-reload-once';

export function clearCrashReloadFlag() {
  try {
    sessionStorage.removeItem(RELOAD_ONCE_KEY);
  } catch {
    // sessionStorage недоступен (приватный режим Safari и т.п.) — не критично,
    // просто не будет "тихой" повторной попытки при следующем крахе.
  }
}

function hasAlreadyTriedReload(): boolean {
  try {
    return sessionStorage.getItem(RELOAD_ONCE_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] непойманная ошибка рендера:', error, info?.componentStack);
    captureException(error, { componentStack: info?.componentStack });
    if (hasAlreadyTriedReload()) return;
    try {
      sessionStorage.setItem(RELOAD_ONCE_KEY, '1');
    } catch {
      // см. hasAlreadyTriedReload — если sessionStorage недоступен, всё равно
      // перезагружаем один раз (не сможем отличить повтор от первого случая,
      // но лучше одна лишняя перезагрузка, чем оставить пустую страницу).
    }
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // Первый крах — уже запущена тихая перезагрузка (см. componentDidCatch),
    // здесь просто нейтральный спиннер на секунду-две до её выполнения, без
    // пугающего текста об ошибке.
    if (!hasAlreadyTriedReload()) {
      return (
        <div className="flex min-h-svh items-center justify-center bg-bg px-4">
          <div className="flex flex-col items-center gap-2 text-center">
            <span className="text-lg font-extrabold tracking-wide text-ink">
              <span className="font-black text-primary">RED</span>EVELOPMENT
            </span>
            <p className="text-sm text-ink-muted">Загрузка…</p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-svh items-center justify-center bg-bg px-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary">RED</span>EVELOPMENT
          </span>
          <p className="max-w-xs text-sm text-ink-muted">
            Не получилось загрузить страницу. Проверьте подключение к интернету и попробуйте ещё раз.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }
}
