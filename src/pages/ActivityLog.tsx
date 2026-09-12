import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { fetchActivityLog } from '../lib/activityLogApi';
import { activityActionLabel } from '../data/activityLog';
import type { ActivityLogEntry } from '../data/activityLog';

// Страница не в меню и не в data/pages.ts — доступ только через
// RequireSuperAdmin (см. App.tsx), не через обычный список pages профиля:
// Степан и Светлана видят "все обычные разделы" (pages:'all'), но это не
// должно включать сюда, поэтому гейт отдельный (см. комментарий в
// data/accessProfiles.ts). Дальше страница просто группирует сырые записи
// activity_log по календарному дню (в часовом поясе браузера) и сотруднику.

function localDayKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

interface DayGroup {
  dayKey: string;
  total: number;
  byProfile: { profileName: string; count: number }[];
}

export function ActivityLog() {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchActivityLog()
      .then(setEntries)
      .catch(() => setError('Не удалось загрузить лог.'));
  }, []);

  const todayKey = useMemo(() => localDayKey(new Date().toISOString()), []);

  const days: DayGroup[] = useMemo(() => {
    if (!entries) return [];
    const byDay = new Map<string, Map<string, number>>();
    for (const e of entries) {
      const dayKey = localDayKey(e.createdAt);
      if (!byDay.has(dayKey)) byDay.set(dayKey, new Map());
      const byProfile = byDay.get(dayKey)!;
      byProfile.set(e.profileName, (byProfile.get(e.profileName) ?? 0) + 1);
    }
    return [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dayKey, byProfile]) => ({
        dayKey,
        total: [...byProfile.values()].reduce((sum, n) => sum + n, 0),
        byProfile: [...byProfile.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([profileName, count]) => ({ profileName, count })),
      }));
  }, [entries]);

  const todayTotal = days.find((d) => d.dayKey === todayKey)?.total ?? 0;

  // Виды действий, реально встречающиеся в логе — подпись под счётчиком за
  // сегодня. Список растёт сам (ACTIVITY_ACTION_LABELS в data/activityLog.ts),
  // страницу под каждое новое действие переписывать не нужно.
  const actionsSeen = useMemo(() => {
    if (!entries) return [];
    return [...new Set(entries.map((e) => e.action))];
  }, [entries]);

  return (
    <>
      <PageHeader title="Активность сотрудников" />

      {error && <p className="text-sm text-danger">{error}</p>}

      {entries === null && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      )}

      {entries !== null && (
        <div className="flex flex-col gap-4">
          <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
            <p className="text-sm text-ink-muted">Сегодня, {formatDayLabel(todayKey)}</p>
            {/* Раньше было "карточек проверено" — с появлением действий вроде
                запуска веб-поиска поставщиков (2026-09-12) это перестало быть
                правдой: строка лога ≠ проверенная карточка. */}
            <p className="text-2xl font-semibold text-ink">{todayTotal} действий залогировано</p>
            {actionsSeen.length > 0 && (
              <p className="text-xs text-ink-faint">
                Отслеживается: {actionsSeen.map(activityActionLabel).join(', ')}
              </p>
            )}
          </div>

          {days.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-faint">Пока ничего не залогировано.</p>
          )}

          <div className="flex flex-col gap-3">
            {days.map((day) => (
              <div key={day.dayKey} className={cn('flex flex-col gap-2 p-4', glassCardClass)} style={glassCardShadow}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{formatDayLabel(day.dayKey)}</p>
                  <p className="text-sm text-ink-muted">{day.total} всего</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {day.byProfile.map(({ profileName, count }) => (
                    <span
                      key={profileName}
                      className="whitespace-nowrap rounded-full bg-surface-muted px-3 py-1 text-sm text-ink-muted"
                    >
                      <span className="font-medium text-ink">{profileName}</span> — {count}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
