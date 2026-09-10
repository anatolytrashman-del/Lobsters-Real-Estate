import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { defaultEstimateSections, estimateStatuses, type Estimate } from '../data/estimates';
import type { RealtyObject } from '../data/objects';
import { fetchEstimates, insertEstimate, deleteEstimate } from '../lib/estimatesApi';
import { fetchObjects } from '../lib/objectsApi';
import { badgeColor } from '../lib/badgeColor';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function objectLabel(o: RealtyObject): string {
  return o.name ? `${o.name} — ${o.address}` : o.address;
}

// Владелец, 2026-09-09: "Смета Зелёный" — смета внутри платформы без
// привязки к объекту. Пункт списка объектов, а не отдельный чекбокс — не
// плодит лишний элемент управления в компактной форме из одного поля.
const NO_OBJECT_OPTION = 'Без привязки к объекту';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function Estimates() {
  const navigate = useNavigate();
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [objects, setObjects] = useState<RealtyObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [pickedLabel, setPickedLabel] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchEstimates(), fetchObjects()])
      .then(([e, o]) => {
        setEstimates(e);
        setObjects(o);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить сметы')))
      .finally(() => setLoading(false));
  }, []);

  function objectFor(estimate: Estimate): RealtyObject | undefined {
    return estimate.objectId ? objects.find((o) => o.id === estimate.objectId) : undefined;
  }

  // Без объекта показываем title (владелец задаёт при создании), с объектом
  // — как и раньше, название/адрес самого объекта (или "Объект удалён", если
  // ссылка на объект осталась, а сам объект больше не существует).
  function estimateDisplayLabel(e: Estimate): string {
    if (!e.objectId) return e.title || 'Смета без названия';
    const obj = objectFor(e);
    return obj ? objectLabel(obj) : 'Объект удалён';
  }

  function openCreateModal() {
    setPickedLabel('');
    setTitleDraft('');
    setCreateError(null);
    setOpen(true);
  }

  async function handleCreate() {
    if (creating || !pickedLabel) return;
    const noObject = pickedLabel === NO_OBJECT_OPTION;
    const picked = noObject ? null : objects.find((o) => objectLabel(o) === pickedLabel);
    if (!noObject && !picked) return;
    if (noObject && !titleDraft.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await insertEstimate({
        objectId: noObject ? null : picked!.id,
        title: noObject ? titleDraft.trim() : null,
        sections: defaultEstimateSections(),
        questions: [],
        status: estimateStatuses[0],
      });
      setEstimates((prev) => [created, ...prev]);
      setOpen(false);
      navigate(`/admin/estimates/${created.id}`);
    } catch (err) {
      setCreateError(errorMessage(err, 'Не удалось создать смету'));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e: Estimate) {
    if (deletingId) return;
    if (!window.confirm(`Удалить смету «${estimateDisplayLabel(e)}»?`)) return;
    setDeletingId(e.id);
    setActionError(null);
    try {
      await deleteEstimate(e.id);
      setEstimates((prev) => prev.filter((x) => x.id !== e.id));
    } catch (err) {
      setActionError(errorMessage(err, 'Не удалось удалить смету'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Сметы"
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={openCreateModal}>
            Добавить смету
          </Button>
        }
      />

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      <div className="flex flex-col gap-3">
        {estimates.map((e) => {
          return (
            <div
              key={e.id}
              onClick={() => navigate(`/admin/estimates/${e.id}`)}
              className={cn(
                'flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between',
                glassCardClass,
              )}
              style={glassCardShadow}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-ink">{estimateDisplayLabel(e)}</span>
                  <Badge style={{ backgroundColor: badgeColor(e.status).bg, color: badgeColor(e.status).text }}>
                    {e.status}
                  </Badge>
                </div>
                <span className="text-sm text-ink-muted">
                  {e.sections.length} {e.sections.length === 1 ? 'раздел' : 'раздела'} · создана {formatDate(e.createdAt)}
                </span>
              </div>
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleDelete(e);
                }}
                disabled={deletingId === e.id}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                aria-label="Удалить смету"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}

        {loading && (
          <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем сметы...
          </Card>
        )}
        {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}
        {!loading && !loadError && estimates.length === 0 && (
          <Card className="py-10 text-center text-sm text-ink-muted">Смет пока нет</Card>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Новая смета">
        <div className="flex flex-col gap-4">
          <Select
            label="Объект"
            placeholder="Выберите объект"
            options={[NO_OBJECT_OPTION, ...objects.map(objectLabel)]}
            value={pickedLabel}
            onChange={setPickedLabel}
          />
          {pickedLabel === NO_OBJECT_OPTION && (
            <Input
              label="Название сметы"
              placeholder="Например, Смета Зелёный"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              autoFocus
            />
          )}
          {createError && <p className="text-sm text-danger">{createError}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={!pickedLabel || (pickedLabel === NO_OBJECT_OPTION && !titleDraft.trim()) || creating}
            >
              {creating ? 'Создаём...' : 'Создать'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
