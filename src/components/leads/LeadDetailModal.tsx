import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { LeadAvatar } from './LeadAvatar';
import { ContactValue } from '../ui/ContactValue';
import { cn } from '../../lib/cn';
import type { Lead } from '../../data/leads';
import type { LeadNote } from '../../data/leadNotes';
import type { RealtyObject } from '../../data/objects';
import { fetchLeadNotes, insertLeadNote, deleteLeadNote } from '../../lib/leadNotesApi';
import { tryAutoFillTelegramAvatar } from '../../lib/leadsApi';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Строка «поле — значение». Пустое значение показываем прочерком, а не прячем:
// в карточке важнее видеть, что данных нет, чем компактность.
function Field({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === '' || children == null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="break-words text-sm text-ink">{empty ? '—' : children}</span>
    </div>
  );
}

interface LeadDetailModalProps {
  lead: Lead | null;
  object: RealtyObject | undefined;
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
  // Заметка двигает дату последнего контакта, автоподтягивание аватара
  // меняет photoPath — оба случая сообщают странице обновлённого лида целиком,
  // чтобы список обновился без перезагрузки.
  onLeadUpdated: (lead: Lead) => void;
  deleting: boolean;
}

export function LeadDetailModal({
  lead,
  object,
  onClose,
  onEdit,
  onDelete,
  onLeadUpdated,
  deleting,
}: LeadDetailModalProps) {
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const leadId = lead?.id ?? '';

  useEffect(() => {
    if (!leadId) return;
    // Тот же приём, что и в LeadAvatar: пока грузятся заметки, карточку могли
    // закрыть и открыть на другом лиде — чужой ответ в стейт не пускаем.
    let active = true;
    setNotes([]);
    setNotesError(null);
    setDraft('');
    setNotesLoading(true);
    fetchLeadNotes(leadId)
      .then((loaded) => {
        if (active) setNotes(loaded);
      })
      .catch((err) => {
        if (active) setNotesError(errorMessage(err, 'Не удалось загрузить историю'));
      })
      .finally(() => {
        if (active) setNotesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [leadId]);

  // Пробуем подтянуть аватар из Telegram при открытии карточки — покрывает
  // и старых лидов без фото (заведённых до этой фичи), и новых, если фон-фетч
  // после сохранения формы (см. Leads.tsx) почему-то не сработал. Внутри уже
  // есть проверка на contactMethod/photoPath — просто вызываем на каждое
  // открытие, лишний раз не сходит, если фото уже есть.
  useEffect(() => {
    if (!lead) return;
    let active = true;
    tryAutoFillTelegramAvatar(lead).then((updated) => {
      if (active && updated) onLeadUpdated(updated);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  if (!lead) return null;

  async function handleAddNote() {
    const body = draft.trim();
    if (!body || saving || !lead) return;
    setSaving(true);
    setNotesError(null);
    try {
      const { note, lastContactedAt } = await insertLeadNote(lead.id, body);
      setNotes((prev) => [note, ...prev]);
      setDraft('');
      onLeadUpdated({ ...lead, lastContactedAt });
    } catch (err) {
      setNotesError(errorMessage(err, 'Не удалось сохранить заметку'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteNote(note: LeadNote) {
    if (!window.confirm('Удалить заметку?')) return;
    const prev = notes;
    setNotes((current) => current.filter((n) => n.id !== note.id));
    try {
      await deleteLeadNote(note.id);
    } catch (err) {
      setNotes(prev);
      setNotesError(errorMessage(err, 'Не удалось удалить заметку'));
    }
  }

  return (
    <Modal open onClose={onClose} title="Карточка лида">
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <LeadAvatar name={lead.name} photoPath={lead.photoPath} size="lg" />
          <div className="flex min-w-0 flex-col gap-2">
            <span className="break-words text-lg font-bold text-ink">{lead.name}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-semibold',
                  lead.isWarm ? 'bg-warning/15 text-warning' : 'bg-surface-muted text-ink-muted',
                )}
              >
                {lead.isWarm ? 'Важный' : 'Интересант'}
              </span>
              {lead.status && (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  {lead.status}
                </span>
              )}
              {lead.clientType && (
                <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-ink-muted">
                  {lead.clientType}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Способ связи">{lead.contactMethod}</Field>
          <Field label="Контакт">
            <ContactValue contact={lead.contact} contactMethod={lead.contactMethod} />
          </Field>
          <Field label="Телефон">
            {lead.phone ? (
              <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="text-primary-hover hover:underline">
                {lead.phone}
              </a>
            ) : null}
          </Field>
          <Field label="Источник">{lead.source}</Field>
          <Field label="Сфера деятельности">{lead.businessType}</Field>
          <Field label="Нужная площадь">{lead.area}</Field>
          <Field label="Требования">{lead.requirement}</Field>
          <Field label="Объект">
            {object ? (
              <Link
                to={`/admin/objects/${object.landingSlug || object.id}`}
                className="inline-flex items-center gap-1 text-primary-hover hover:underline"
              >
                {object.address}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </Field>
          <Field label="Последний контакт">{formatDate(lead.lastContactedAt)}</Field>
          <Field label="Следующий контакт">{formatDate(lead.nextContactAt)}</Field>
          <Field label="Лид создан">{formatDate(lead.createdAt)}</Field>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <span className="text-sm font-semibold text-ink">История общения</span>

          <Textarea
            rows={3}
            placeholder="О чём говорили, о чём договорились..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            className="w-fit"
            disabled={!draft.trim() || saving}
            onClick={handleAddNote}
          >
            {saving ? 'Сохраняем...' : 'Добавить заметку'}
          </Button>

          {notesError && <p className="text-sm text-danger">{notesError}</p>}

          {notesLoading && (
            <div className="flex items-center gap-2 py-2 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем историю...
            </div>
          )}

          {!notesLoading && notes.length === 0 && (
            <p className="py-1 text-sm text-ink-faint">Записей пока нет — добавь первую после разговора.</p>
          )}

          {notes.map((note) => (
            <div key={note.id} className="flex items-start justify-between gap-3 rounded-control bg-surface-muted p-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-xs text-ink-faint">{formatDateTime(note.createdAt)}</span>
                <span className="whitespace-pre-wrap break-words text-sm text-ink">{note.body}</span>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteNote(note)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                aria-label="Удалить заметку"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            icon={<Trash2 className="h-4 w-4" />}
            disabled={deleting}
            onClick={() => onDelete(lead)}
          >
            Удалить
          </Button>
          <Button type="button" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(lead)}>
            Редактировать
          </Button>
        </div>
      </div>
    </Modal>
  );
}
