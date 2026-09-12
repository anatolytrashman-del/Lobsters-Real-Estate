import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, CheckCircle2, Trash2, Flame, Pencil, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Modal } from '../components/ui/Modal';
import type { Task, TaskAssignee } from '../data/tasks';
import type { Person } from '../data/people';
import { badgeColor } from '../lib/badgeColor';
import { cn } from '../lib/cn';
import { fetchTasks, insertTask, updateTask, deleteTask } from '../lib/tasksApi';
import { fetchPeople } from '../lib/peopleApi';
import { getCurrentProfile, isTaskVisible } from '../lib/accessProfile';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatDate(isoDate: string) {
  if (!isoDate) return '—';
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Однодневная задача (по умолчанию — startDate===endDate) показывает одну
// дату, как раньше; многодневная — диапазон. Один год и месяц не повторяем
// у первой даты («24–26 августа 2026»), иначе выписываем обе целиком.
function formatDateRange(startIso: string, endIso: string) {
  if (!startIso) return '—';
  if (!endIso || startIso === endIso) return formatDate(startIso);
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`;
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
}

const emptyForm = {
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  assignees: [] as TaskAssignee[],
  isPriority: false,
};

// Длинное описание задачи (частый случай — вставленное ТЗ на несколько
// абзацев) сворачиваем до первого абзаца, остальное — под спойлер, чтобы
// карточка не растягивала список. Абзац — блок между пустыми строками.
function TaskDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const paragraphs = text.split(/\n\s*\n/);
  const rest = paragraphs.slice(1).join('\n\n');

  if (!rest) {
    return <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{text}</p>;
  }

  return (
    <div className="mt-1 text-sm leading-relaxed text-ink-muted">
      <p className="whitespace-pre-wrap">{paragraphs[0]}</p>
      {expanded && <p className="mt-2 whitespace-pre-wrap">{rest}</p>}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-xs font-semibold text-primary-hover hover:underline"
      >
        {expanded ? 'Свернуть' : 'Показать полностью'}
      </button>
    </div>
  );
}

function AssigneeBadges({ assignees }: { assignees: TaskAssignee[] }) {
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {assignees.map((a) => {
        const colors = badgeColor(a);
        return (
          <span
            key={a}
            className="rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            {a}
          </span>
        );
      })}
    </div>
  );
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIsoDate() {
  return isoDate(new Date());
}

function tomorrowIsoDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

// Понедельник текущей недели — getDay() воскресенье=0, поэтому сдвигаем на
// европейскую неделю (Пн=0 ... Вс=6).
function startOfWeekIsoDate() {
  const d = new Date();
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return isoDate(d);
}

function startOfMonthIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function ActiveTaskCard({
  task,
  onComplete,
  onEdit,
  onDelete,
  deleting,
}: {
  task: Task;
  onComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  deleting: boolean;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {task.isPriority && (
              <span title="Приоритет">
                <Flame className="h-4 w-4 shrink-0 fill-warning text-warning" />
              </span>
            )}
            <div className="font-bold text-ink">{task.title}</div>
          </div>
          {task.description && <TaskDescription text={task.description} />}
        </div>
        <AssigneeBadges assignees={task.assignees} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-muted">{formatDateRange(task.startDate, task.endDate)}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            icon={<CheckCircle2 className="h-4 w-4" />}
            onClick={() => onComplete(task)}
          >
            Пометить выполненной
          </Button>
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label="Редактировать задачу"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(task)}
            disabled={deleting}
            aria-label="Удалить задачу"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </Card>
  );
}

function ArchivedTaskCard({
  task,
  onEdit,
  onDelete,
  deleting,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  deleting: boolean;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5 opacity-80">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {task.isPriority && (
              <span title="Приоритет">
                <Flame className="h-4 w-4 shrink-0 fill-warning text-warning" />
              </span>
            )}
            <div className="font-bold text-ink line-through decoration-ink-faint">{task.title}</div>
          </div>
          {task.description && <TaskDescription text={task.description} />}
        </div>
        <AssigneeBadges assignees={task.assignees} />
      </div>
      <div className="text-sm text-ink-muted">{formatDateRange(task.startDate, task.endDate)}</div>
      <div className="rounded-control bg-surface-muted px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Результат</div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{task.result}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="flex w-fit items-center gap-2 text-sm font-medium text-ink-muted hover:text-primary"
        >
          <Pencil className="h-3.5 w-3.5" />
          Редактировать
        </button>
        <button
          type="button"
          onClick={() => onDelete(task)}
          disabled={deleting}
          className="flex w-fit items-center gap-2 text-sm font-medium text-ink-muted hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Удалить
        </button>
      </div>
    </Card>
  );
}

// Свёрнутая по умолчанию группа — чтобы страница не разрасталась, видимыми
// сразу остаются только "Задачи на сегодня" (не спойлер) и "Задачи на завтра"
// (defaultOpen, см. Tasks ниже), всё остальное открывается по клику.
function Spoiler({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-left text-lg font-bold text-ink"
      >
        <ChevronRight className={cn('h-5 w-5 shrink-0 text-ink-faint transition-transform', open && 'rotate-90')} />
        {title}
        <span className="text-sm font-medium text-ink-faint">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

export function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Список кандидатов в "Ответственные" — из таблицы people (is_task_assignee),
  // не из захардкоженного массива (см. data/tasks.ts). Если задача уже
  // назначена на кого-то, кого убрали из people, его имя всё равно останется
  // видно в самой задаче (просто исчезнет из списка выбора в форме).
  const [taskAssignees, setTaskAssignees] = useState<TaskAssignee[]>([]);

  const [open, setOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [resultDraft, setResultDraft] = useState('');
  const [savingResult, setSavingResult] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks()
      .then(setTasks)
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить задачи')))
      .finally(() => setLoading(false));
    fetchPeople()
      .then((people: Person[]) => setTaskAssignees(people.filter((p) => p.isTaskAssignee).map((p) => p.name)))
      .catch(() => setTaskAssignees([]));
  }, []);

  // Сотрудник видит только задачи, где он сам в ответственных; владелец
  // (isSuperAdmin) — весь список. Фильтр один на всё содержимое страницы,
  // поэтому и активные бакеты, и архив ниже считаются уже от него.
  const profile = getCurrentProfile();
  const visibleTasks = useMemo(
    () => tasks.filter((t) => isTaskVisible(profile, t.assignees)),
    [tasks, profile],
  );

  const activeTasks = useMemo(() => visibleTasks.filter((t) => !t.isDone), [visibleTasks]);
  // Многодневная задача (startDate < endDate) должна быть видна в каждый
  // день, который она захватывает — поэтому бакеты ниже не взаимоисключающие,
  // одна и та же задача может попасть сразу в "сегодня" и "завтра" (и даже
  // в "другие дни", если тянется дальше), а не только в один из них.
  // "Сегодня" условие startDate<=today одно покрывает и текущие (endDate
  // ещё не наступил или наступает сегодня), и просроченные (endDate уже
  // прошёл) задачи — те и другие остаются на виду, не теряются под спойлером.
  const todayTasks = useMemo(() => {
    const today = todayIsoDate();
    return activeTasks.filter((t) => t.startDate <= today);
  }, [activeTasks]);
  const tomorrowTasks = useMemo(() => {
    const tomorrow = tomorrowIsoDate();
    return activeTasks.filter((t) => t.startDate <= tomorrow && t.endDate >= tomorrow);
  }, [activeTasks]);
  const otherTasks = useMemo(() => {
    const tomorrow = tomorrowIsoDate();
    return activeTasks.filter((t) => t.endDate > tomorrow);
  }, [activeTasks]);

  const archivedTasks = useMemo(
    () => [...visibleTasks.filter((t) => t.isDone)].sort((a, b) => b.endDate.localeCompare(a.endDate)),
    [visibleTasks],
  );
  // Бакеты архива считаются по концу задачи (endDate), отдельного поля даты
  // выполнения в Task нет — на практике задача обычно закрывается около
  // своего срока, так что это достаточная оценка "когда сделано".
  const doneToday = useMemo(() => {
    const today = todayIsoDate();
    return archivedTasks.filter((t) => t.endDate === today);
  }, [archivedTasks]);
  const doneThisWeek = useMemo(() => {
    const today = todayIsoDate();
    const weekStart = startOfWeekIsoDate();
    return archivedTasks.filter((t) => t.endDate !== today && t.endDate >= weekStart);
  }, [archivedTasks]);
  const doneThisMonth = useMemo(() => {
    const weekStart = startOfWeekIsoDate();
    const monthStart = startOfMonthIsoDate();
    return archivedTasks.filter((t) => t.endDate < weekStart && t.endDate >= monthStart);
  }, [archivedTasks]);
  const doneOlder = useMemo(() => {
    const monthStart = startOfMonthIsoDate();
    return archivedTasks.filter((t) => t.endDate < monthStart);
  }, [archivedTasks]);

  const canSubmit =
    form.title.trim() && form.startDate && form.endDate && form.endDate >= form.startDate && form.assignees.length > 0;

  function openAddModal() {
    setEditingTask(null);
    setForm(emptyForm);
    setSubmitError(null);
    setOpen(true);
  }

  function openEditModal(task: Task) {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description,
      startDate: task.startDate,
      endDate: task.endDate,
      assignees: task.assignees,
      isPriority: task.isPriority,
    });
    setSubmitError(null);
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (editingTask) {
        const updated = await updateTask(editingTask.id, {
          title: form.title.trim(),
          description: form.description.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          assignees: form.assignees,
          isPriority: form.isPriority,
          isDone: editingTask.isDone,
          result: editingTask.result,
        });
        setTasks((prev) => prev.map((t) => (t.id === editingTask.id ? updated : t)));
      } else {
        const created = await insertTask({
          title: form.title.trim(),
          description: form.description.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          assignees: form.assignees,
          isPriority: form.isPriority,
          isDone: false,
          result: '',
        });
        setTasks((prev) => [...prev, created]);
      }
      setForm(emptyForm);
      setEditingTask(null);
      setOpen(false);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Не удалось сохранить задачу'));
    } finally {
      setSubmitting(false);
    }
  }

  function openCompleteModal(task: Task) {
    setCompletingTask(task);
    setResultDraft('');
    setResultError(null);
  }

  async function submitComplete() {
    if (!completingTask || !resultDraft.trim()) return;
    setSavingResult(true);
    setResultError(null);
    try {
      const { id, ...rest } = completingTask;
      const updated = await updateTask(id, { ...rest, isDone: true, result: resultDraft.trim() });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setCompletingTask(null);
    } catch (err) {
      setResultError(errorMessage(err, 'Не удалось сохранить результат'));
    } finally {
      setSavingResult(false);
    }
  }

  async function handleDelete(task: Task) {
    if (!window.confirm(`Удалить задачу «${task.title}»?`)) return;
    setDeletingId(task.id);
    setDeleteError(null);
    try {
      await deleteTask(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
    } catch (err) {
      setDeleteError(errorMessage(err, 'Не удалось удалить задачу'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Задачи"
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={openAddModal}>
            Добавить задачу
          </Button>
        }
      />

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем задачи...
        </Card>
      )}
      {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}

      {!loading && !loadError && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="text-lg font-bold text-ink">Задачи на сегодня</div>
            {todayTasks.map((task) => (
              <ActiveTaskCard
                key={task.id}
                task={task}
                onComplete={openCompleteModal}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {todayTasks.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">На сегодня задач нет</Card>
            )}
          </div>

          <Spoiler title="Задачи на завтра" count={tomorrowTasks.length} defaultOpen>
            {tomorrowTasks.map((task) => (
              <ActiveTaskCard
                key={task.id}
                task={task}
                onComplete={openCompleteModal}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {tomorrowTasks.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">На завтра задач нет</Card>
            )}
          </Spoiler>

          <Spoiler title="Задачи на другие дни" count={otherTasks.length}>
            {otherTasks.map((task) => (
              <ActiveTaskCard
                key={task.id}
                task={task}
                onComplete={openCompleteModal}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {otherTasks.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">Задач на другие дни нет</Card>
            )}
          </Spoiler>
        </div>
      )}
      {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

      {!loading && archivedTasks.length > 0 && (
        <div className="flex flex-col gap-6">
          <Spoiler title="Сделано за сегодня" count={doneToday.length}>
            {doneToday.map((task) => (
              <ArchivedTaskCard
                key={task.id}
                task={task}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {doneToday.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">Сегодня ничего не выполнено</Card>
            )}
          </Spoiler>

          <Spoiler title="Сделано за эту неделю" count={doneThisWeek.length}>
            {doneThisWeek.map((task) => (
              <ArchivedTaskCard
                key={task.id}
                task={task}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {doneThisWeek.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">На этой неделе ничего не выполнено</Card>
            )}
          </Spoiler>

          <Spoiler title="Сделано за этот месяц" count={doneThisMonth.length}>
            {doneThisMonth.map((task) => (
              <ArchivedTaskCard
                key={task.id}
                task={task}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {doneThisMonth.length === 0 && (
              <Card className="py-10 text-center text-sm text-ink-muted">В этом месяце ничего не выполнено</Card>
            )}
          </Spoiler>

          <Spoiler title="Архив" count={doneOlder.length}>
            {doneOlder.map((task) => (
              <ArchivedTaskCard
                key={task.id}
                task={task}
                onEdit={openEditModal}
                onDelete={handleDelete}
                deleting={deletingId === task.id}
              />
            ))}
            {doneOlder.length === 0 && <Card className="py-10 text-center text-sm text-ink-muted">Архив пуст</Card>}
          </Spoiler>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editingTask ? 'Редактировать задачу' : 'Новая задача'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Заголовок"
            placeholder="Например, Согласовать концепцию с собственником"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
          <Textarea
            label="Описание"
            placeholder="Свободное описание задачи..."
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Дата начала"
              type="date"
              value={form.startDate}
              onChange={(e) => {
                const startDate = e.target.value;
                setForm((f) => ({
                  // Однодневная задача — типичный случай: пока конец не
                  // тронут вручную (пуст или совпадал с прежним началом),
                  // подтягиваем его вслед за началом, чтобы не заставлять
                  // всегда заполнять оба поля.
                  ...f,
                  startDate,
                  endDate: !f.endDate || f.endDate === f.startDate ? startDate : f.endDate,
                }));
              }}
              required
            />
            <Input
              label="Дата конца"
              type="date"
              value={form.endDate}
              min={form.startDate || undefined}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              required
            />
          </div>
          {form.startDate && form.endDate && form.endDate < form.startDate && (
            <p className="text-sm text-danger">Дата конца раньше даты начала</p>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">Ответственные</span>
            <div className="flex flex-wrap gap-2">
              {taskAssignees.map((a) => {
                const selected = form.assignees.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        assignees: selected ? f.assignees.filter((x) => x !== a) : [...f.assignees, a],
                      }))
                    }
                    className={cn(
                      'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                      selected ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface-muted text-ink-muted',
                    )}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
          </div>

          <ToggleGroup
            label="Приоритет"
            options={['Да', 'Нет']}
            value={form.isPriority ? 'Да' : 'Нет'}
            onChange={(v) => setForm((f) => ({ ...f, isPriority: v === 'Да' }))}
          />

          {submitError && <p className="text-sm text-danger">{submitError}</p>}

          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? 'Сохраняем...' : editingTask ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!completingTask} onClose={() => setCompletingTask(null)} title="Результат задачи">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            Задача «{completingTask?.title}» будет перенесена в архив.
          </p>
          <Textarea
            label="Результат задачи"
            placeholder="Что сделано по итогу..."
            value={resultDraft}
            onChange={(e) => setResultDraft(e.target.value)}
            autoFocus
          />
          {resultError && <p className="text-sm text-danger">{resultError}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setCompletingTask(null)}>
              Отмена
            </Button>
            <Button type="button" onClick={submitComplete} disabled={!resultDraft.trim() || savingResult}>
              {savingResult ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
