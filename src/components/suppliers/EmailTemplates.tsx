import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import type { EmailTemplate } from '../../data/emailTemplates';
import type { SupplierRequest } from '../../data/supplierResearch';
import { insertEmailTemplate, updateEmailTemplate, deleteEmailTemplate } from '../../lib/emailTemplatesApi';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

// Плейсхолдеры письма для поставщиков — EMAIL_CORRESPONDENCE_PLAN.md,
// этап 3, поддерживаются lib/emailTemplates.ts (renderEmailTemplate).
const PLACEHOLDER_HINT = 'Доступны: {компания}, {запрос}, {материалы}, {контакт}';

interface TemplateFormState {
  name: string;
  subject: string;
  body: string;
  requestId: string;
}

const NO_REQUEST = 'Общий (для любого запроса)';

function emptyForm(): TemplateFormState {
  return { name: '', subject: '', body: '', requestId: '' };
}

function templateToForm(t: EmailTemplate): TemplateFormState {
  return { name: t.name, subject: t.subject, body: t.body, requestId: t.requestId ?? '' };
}

// Форма создания/редактирования одного шаблона — используется и из общей
// модалки управления шаблонами (список ниже), и как "Сохранить как
// шаблон" прямо из формы письма (EmailThread) с предзаполненными темой и
// текстом (initialSubject/initialBody), см. Suppliers.tsx.
function TemplateFormModal({
  open,
  template,
  requests,
  initialSubject,
  initialBody,
  initialRequestId,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: EmailTemplate | null;
  requests: SupplierRequest[];
  initialSubject?: string;
  initialBody?: string;
  // Владелец, 2026-09-09: "+" рядом с выбором шаблона в BulkSendModal —
  // новый шаблон сразу привязывается к текущей категории, не нужно
  // выбирать её заново в этой же форме. Только для создания (template
  // === null), у уже существующего шаблона запрос берётся из него самого.
  initialRequestId?: string;
  onClose: () => void;
  onSaved: (t: EmailTemplate) => void;
}) {
  const [form, setForm] = useState<TemplateFormState>(() =>
    template
      ? templateToForm(template)
      : { ...emptyForm(), subject: initialSubject ?? '', body: initialBody ?? '', requestId: initialRequestId ?? '' },
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Модалка не размонтируется между открытиями (EmailThread держит её
  // всегда отрисованной, переключая только open) — без этого эффекта
  // ленивый useState выше подхватил бы initialSubject/initialBody только
  // один раз, при самом первом рендере родителя, и дальше "Сохранить как
  // шаблон" всегда предлагал бы устаревший текст. Пересобираем форму
  // заново при каждом открытии.
  useEffect(() => {
    if (!open) return;
    setForm(
      template
        ? templateToForm(template)
        : { ...emptyForm(), subject: initialSubject ?? '', body: initialBody ?? '', requestId: initialRequestId ?? '' },
    );
    setSubmitError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const canSubmit = form.name.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      name: form.name.trim(),
      subject: form.subject,
      body: form.body,
      requestId: form.requestId || null,
    };
    try {
      const saved = template ? await updateEmailTemplate(template.id, payload) : await insertEmailTemplate(payload);
      onSaved(saved);
      onClose();
    } catch (err) {
      setSubmitError(errorMessage(err, 'Не удалось сохранить шаблон'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={template ? 'Редактировать шаблон' : 'Новый шаблон'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Название шаблона"
          placeholder="Например, Умные замки — первое письмо"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          autoFocus
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Запрос</span>
          <select
            value={form.requestId}
            onChange={(e) => setForm((f) => ({ ...f, requestId: e.target.value }))}
            className="rounded-control border border-transparent bg-surface-muted px-4 py-2.5 text-sm text-ink outline-none focus:border-primary"
          >
            <option value="">{NO_REQUEST}</option>
            {requests.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        <Input label="Тема" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
        <Textarea label="Текст письма" rows={6} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
        <p className="-mt-2 text-xs text-ink-faint">{PLACEHOLDER_HINT}</p>

        {submitError && <p className="text-sm text-danger">{submitError}</p>}

        <div className="mt-2 flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={!canSubmit || submitting}>
            {submitting ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Полный список шаблонов с добавлением/редактированием/удалением —
// открывается кнопкой "Шаблоны" в шапке вкладки "Переписка".
export function TemplateManagerModal({
  open,
  templates,
  requests,
  onClose,
  onChange,
}: {
  open: boolean;
  templates: EmailTemplate[];
  requests: SupplierRequest[];
  onClose: () => void;
  onChange: (templates: EmailTemplate[]) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!open) return null;

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(t: EmailTemplate) {
    setEditing(t);
    setFormOpen(true);
  }

  function handleSaved(saved: EmailTemplate) {
    onChange(templates.some((t) => t.id === saved.id) ? templates.map((t) => (t.id === saved.id ? saved : t)) : [...templates, saved]);
  }

  async function handleDelete(t: EmailTemplate) {
    if (deletingId) return;
    if (!window.confirm(`Удалить шаблон «${t.name}»?`)) return;
    setDeletingId(t.id);
    setDeleteError(null);
    try {
      await deleteEmailTemplate(t.id);
      onChange(templates.filter((x) => x.id !== t.id));
    } catch (err) {
      setDeleteError(errorMessage(err, 'Не удалось удалить шаблон'));
    } finally {
      setDeletingId(null);
    }
  }

  function requestTitle(requestId: string | null): string {
    if (!requestId) return NO_REQUEST;
    return requests.find((r) => r.id === requestId)?.title ?? NO_REQUEST;
  }

  return (
    <>
      <Modal open onClose={onClose} title="Шаблоны писем">
        <div className="flex flex-col gap-3">
          <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={openAdd}>
            Новый шаблон
          </Button>

          {deleteError && <p className="text-sm text-danger">{deleteError}</p>}

          {templates.length === 0 && <p className="text-sm text-ink-faint">Шаблонов пока нет.</p>}

          <div className="flex flex-col gap-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-3 rounded-control border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{t.name}</div>
                  <div className="text-xs text-ink-faint">{requestTitle(t.requestId)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    aria-label="Редактировать шаблон"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-primary"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(t)}
                    disabled={deletingId === t.id}
                    aria-label="Удалить шаблон"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <TemplateFormModal open={formOpen} template={editing} requests={requests} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
    </>
  );
}

// Экспортируется отдельно — EmailThread открывает эту же форму с
// предзаполненными темой/текстом ("Сохранить как шаблон" под textarea),
// без общего списка вокруг.
export { TemplateFormModal };
