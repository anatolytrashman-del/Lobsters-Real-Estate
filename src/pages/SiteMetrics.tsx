import { useEffect, useMemo, useState } from 'react';
import { Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import {
  fetchMetrikaDailyStats,
  fetchMetrikaTrafficSources,
  fetchMetrikaTopPages,
  fetchMetrikaGoalCompletions,
} from '../lib/metrikaStatsApi';
import type { MetrikaDailyStat, MetrikaTrafficSource, MetrikaTopPage, MetrikaGoalCompletion } from '../data/metrikaStats';

// Показатели посещаемости сайта из Яндекс.Метрики (счётчик 111858495) —
// не отчёт по staff-активности (это отдельная /admin/metrics, RequireSuperAdmin,
// не путать), а посещаемость публичной части платформы: гид района, каталог
// БЦ, лендинги объектов и т.д. Данные читаются уже готовыми из 4 таблиц
// Supabase, заполняемых раз в сутки scripts/sync-yandex-metrika.mjs — сам
// OAuth-токен на этой странице не фигурирует нигде.
//
// "Визиты по дням"/"Достижение целей" — настоящий тренд, можно выбрать
// период (7/30/90 дней), считается из уже загруженных daily/goal рядов на
// клиенте. "Источники трафика"/"Топ страниц" — НЕ разбиты по дням (см.
// комментарий в самом скрипте синка, WINDOW_DAYS=90) — это один снимок за
// последние 90 дней, полностью перезаписываемый каждым синком, выбор
// периода на них не влияет (явно подписано в интерфейсе, не скрыто).

type PeriodDays = 7 | 30 | 90;
const PERIOD_LABELS: Record<PeriodDays, string> = { 7: '7 дней', 30: '30 дней', 90: '90 дней' };
const PERIOD_OPTIONS = Object.values(PERIOD_LABELS);
const LABEL_TO_DAYS = Object.fromEntries(
  Object.entries(PERIOD_LABELS).map(([days, label]) => [label, Number(days) as PeriodDays]),
) as Record<string, PeriodDays>;

function formatDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} мин ${s} с` : `${s} с`;
}

function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return '—';
  return `${value.toFixed(digits)}%`;
}

function sum(values: (number | null)[]): number {
  return values.reduce<number>((acc, v) => acc + (v ?? 0), 0);
}

function average(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return sum(present) / present.length;
}

interface ChangeBadgeProps {
  current: number;
  previous: number;
  // Для отказов/времени на сайте рост — не обязательно "хорошо" (зелёный),
  // это не бинарная метрика вроде визитов — оставляем нейтральным цветом,
  // просто показываем направление и величину.
  neutral?: boolean;
}

function ChangeBadge({ current, previous, neutral }: ChangeBadgeProps) {
  if (previous === 0) return null;
  const diff = ((current - previous) / previous) * 100;
  if (Math.abs(diff) < 0.5) {
    return (
      <Badge tone="neutral">
        <Minus className="h-3 w-3" />
        без изменений
      </Badge>
    );
  }
  const up = diff > 0;
  const tone = neutral ? 'neutral' : up ? 'success' : 'danger';
  return (
    <Badge tone={tone}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}
      {diff.toFixed(0)}%
    </Badge>
  );
}

interface KpiTileProps {
  label: string;
  value: string;
  change?: { current: number; previous: number; neutral?: boolean };
}

function KpiTile({ label, value, change }: KpiTileProps) {
  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-3xl font-semibold text-ink">{value}</p>
      {change && <ChangeBadge {...change} />}
    </Card>
  );
}

interface SparkbarsProps {
  data: { date: string; value: number }[];
}

// Один ряд тонких столбиков (магнитуда одной серии — свой акцентный цвет,
// легенда не нужна, заголовок карточки уже называет серию). Подсказка —
// нативный title, без отдельного компонента тултипа: страница внутренняя,
// не публичная витрина.
function Sparkbars({ data }: SparkbarsProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    // Высота столбика — % от ВЫСОТЫ этого флекс-контейнера (h-24, задана
    // явно): если обернуть столбик ещё одним div без своей высоты, процент
    // не от чего считать (родитель — auto) и столбик схлопывается в 0 —
    // столбик обязан быть САМИМ флекс-элементом, не вложенным в обёртку.
    <div className="flex h-24 items-end gap-px">
      {data.map((d) => (
        <div
          key={d.date}
          className="flex-1 rounded-t bg-primary/70 transition-colors hover:bg-primary"
          style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
          title={`${formatDateShort(d.date)}: ${d.value.toLocaleString('ru-RU')}`}
        />
      ))}
    </div>
  );
}

interface TrendCardProps {
  title: string;
  data: MetrikaDailyStat[];
  valueOf: (d: MetrikaDailyStat) => number;
}

function TrendCard({ title, data, valueOf }: TrendCardProps) {
  const bars = data.map((d) => ({ date: d.date, value: valueOf(d) }));
  const first = data[0]?.date;
  const last = data[data.length - 1]?.date;
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <Sparkbars data={bars} />
      {first && last && (
        <div className="flex justify-between text-xs text-ink-muted">
          <span>{formatDateShort(first)}</span>
          <span>{formatDateShort(last)}</span>
        </div>
      )}
    </Card>
  );
}

export function SiteMetrics() {
  const [dailyStats, setDailyStats] = useState<MetrikaDailyStat[] | null>(null);
  const [trafficSources, setTrafficSources] = useState<MetrikaTrafficSource[] | null>(null);
  const [topPages, setTopPages] = useState<MetrikaTopPage[] | null>(null);
  const [goalCompletions, setGoalCompletions] = useState<MetrikaGoalCompletion[] | null>(null);
  const [error, setError] = useState('');
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);

  useEffect(() => {
    Promise.all([
      fetchMetrikaDailyStats(),
      fetchMetrikaTrafficSources(),
      fetchMetrikaTopPages(),
      fetchMetrikaGoalCompletions(),
    ])
      .then(([daily, traffic, pages, goals]) => {
        setDailyStats(daily);
        setTrafficSources(traffic);
        setTopPages(pages);
        setGoalCompletions(goals);
      })
      .catch(() => setError('Не удалось загрузить показатели.'));
  }, []);

  const loading = dailyStats === null || trafficSources === null || topPages === null || goalCompletions === null;

  const currentPeriod = useMemo(() => (dailyStats ?? []).slice(-periodDays), [dailyStats, periodDays]);
  const previousPeriod = useMemo(
    () => (dailyStats ?? []).slice(-periodDays * 2, -periodDays),
    [dailyStats, periodDays],
  );

  const currentGoals = useMemo(() => (goalCompletions ?? []).slice(-periodDays), [goalCompletions, periodDays]);
  const previousGoals = useMemo(
    () => (goalCompletions ?? []).slice(-periodDays * 2, -periodDays),
    [goalCompletions, periodDays],
  );

  const maxUpdatedAt = useMemo(() => {
    const dates = (trafficSources ?? []).map((s) => s.updatedAt);
    if (dates.length === 0) return null;
    return dates.reduce((a, b) => (a > b ? a : b));
  }, [trafficSources]);

  const maxTrafficVisits = Math.max(1, ...(trafficSources ?? []).map((s) => s.visits));
  const maxTopPageviews = Math.max(1, ...(topPages ?? []).map((p) => p.pageviews));
  const totalTrafficVisits = sum((trafficSources ?? []).map((s) => s.visits));

  return (
    <>
      <PageHeader title="Показатели" />

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      )}

      {!loading && dailyStats!.length === 0 && (
        <Card className="text-sm text-ink-muted">
          Данные ещё не собраны — первый синк со статистикой Яндекс.Метрики придёт по расписанию (раз в сутки) либо
          после ручного запуска воркфлоу «Sync Yandex Metrika stats» на GitHub Actions.
        </Card>
      )}

      {!loading && dailyStats!.length > 0 && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              label="Период"
              options={PERIOD_OPTIONS}
              value={PERIOD_LABELS[periodDays]}
              onChange={(label) => setPeriodDays(LABEL_TO_DAYS[label])}
            />
            {maxUpdatedAt && (
              <p className="text-xs text-ink-muted">
                Обновлено: {new Date(maxUpdatedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiTile
              label="Визиты"
              value={sum(currentPeriod.map((d) => d.visits)).toLocaleString('ru-RU')}
              change={{ current: sum(currentPeriod.map((d) => d.visits)), previous: sum(previousPeriod.map((d) => d.visits)) }}
            />
            <KpiTile
              label="Посетители"
              value={sum(currentPeriod.map((d) => d.users)).toLocaleString('ru-RU')}
              change={{ current: sum(currentPeriod.map((d) => d.users)), previous: sum(previousPeriod.map((d) => d.users)) }}
            />
            <KpiTile
              label="Просмотры страниц"
              value={sum(currentPeriod.map((d) => d.pageviews)).toLocaleString('ru-RU')}
              change={{
                current: sum(currentPeriod.map((d) => d.pageviews)),
                previous: sum(previousPeriod.map((d) => d.pageviews)),
              }}
            />
            <KpiTile
              label="Отказы"
              value={formatPercent(average(currentPeriod.map((d) => d.bounceRate)))}
              change={
                previousPeriod.length > 0
                  ? {
                      current: average(currentPeriod.map((d) => d.bounceRate)) ?? 0,
                      previous: average(previousPeriod.map((d) => d.bounceRate)) ?? 0,
                      neutral: true,
                    }
                  : undefined
              }
            />
            <KpiTile
              label="Глубина просмотра"
              value={(average(currentPeriod.map((d) => d.pageDepth)) ?? 0).toFixed(1)}
              change={
                previousPeriod.length > 0
                  ? {
                      current: average(currentPeriod.map((d) => d.pageDepth)) ?? 0,
                      previous: average(previousPeriod.map((d) => d.pageDepth)) ?? 0,
                      neutral: true,
                    }
                  : undefined
              }
            />
            <KpiTile
              label="Время на сайте"
              value={formatDuration(average(currentPeriod.map((d) => d.avgDurationSeconds)))}
              change={
                previousPeriod.length > 0
                  ? {
                      current: average(currentPeriod.map((d) => d.avgDurationSeconds)) ?? 0,
                      previous: average(previousPeriod.map((d) => d.avgDurationSeconds)) ?? 0,
                      neutral: true,
                    }
                  : undefined
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <TrendCard title="Визиты по дням" data={currentPeriod} valueOf={(d) => d.visits} />
            <TrendCard title="Посетители по дням" data={currentPeriod} valueOf={(d) => d.users} />
            <TrendCard title="Просмотры по дням" data={currentPeriod} valueOf={(d) => d.pageviews} />
          </div>

          {currentGoals.length > 0 && (
            <Card className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Достижение целей — бронирование кабинета</h3>
                <div className="flex items-center gap-3 text-sm text-ink-muted">
                  <span>
                    <strong className="text-ink">{sum(currentGoals.map((g) => g.reaches)).toLocaleString('ru-RU')}</strong> достижений
                  </span>
                  {previousGoals.length > 0 && (
                    <ChangeBadge
                      current={sum(currentGoals.map((g) => g.reaches))}
                      previous={sum(previousGoals.map((g) => g.reaches))}
                    />
                  )}
                </div>
              </div>
              <Sparkbars data={currentGoals.map((g) => ({ date: g.date, value: g.reaches }))} />
            </Card>
          )}
          {currentGoals.length === 0 && (
            <Card className="text-sm text-ink-muted">
              Цель «бронирование кабинета» пока не найдена в данных — либо ещё не было ни одной брони за выбранный
              период, либо цель ещё не завершила первый синк.
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Источники трафика</h3>
                <p className="text-xs text-ink-muted">
                  За последние {(trafficSources?.[0]?.windowDays ?? 90)} дней — не зависит от выбранного периода выше.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {(trafficSources ?? []).map((s) => (
                  <div key={s.source} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink">{s.source}</span>
                      <span className="text-ink-muted">
                        {s.visits.toLocaleString('ru-RU')}
                        {totalTrafficVisits > 0 && (
                          <span className="ml-1 text-xs">({((s.visits / totalTrafficVisits) * 100).toFixed(0)}%)</span>
                        )}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(s.visits / maxTrafficVisits) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
                {(trafficSources ?? []).length === 0 && (
                  <p className="text-sm text-ink-muted">Пока нет данных по источникам.</p>
                )}
              </div>
            </Card>

            <Card className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">Топ страниц</h3>
                <p className="text-xs text-ink-muted">
                  За последние {(topPages?.[0]?.windowDays ?? 90)} дней — не зависит от выбранного периода выше.
                </p>
              </div>
              <div className="flex flex-col divide-y divide-border">
                {(topPages ?? []).map((p) => (
                  <div key={p.path} className="relative flex items-center justify-between gap-3 py-2 text-sm">
                    <div
                      className="absolute inset-y-0 left-0 -z-10 rounded bg-primary/10"
                      style={{ width: `${(p.pageviews / maxTopPageviews) * 100}%` }}
                    />
                    <span className="truncate text-ink" title={p.path}>
                      {p.path}
                    </span>
                    <span className="shrink-0 font-medium text-ink">{p.pageviews.toLocaleString('ru-RU')}</span>
                  </div>
                ))}
                {(topPages ?? []).length === 0 && <p className="text-sm text-ink-muted">Пока нет данных по страницам.</p>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
