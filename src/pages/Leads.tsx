import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Upload, X } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { AddableSelect } from '../components/ui/AddableSelect';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Modal } from '../components/ui/Modal';
import { ContactValue } from '../components/ui/ContactValue';
import { LeadAvatar } from '../components/leads/LeadAvatar';
import { LeadDetailModal } from '../components/leads/LeadDetailModal';
import { LeadBookings, type BookingRow } from '../components/leads/LeadBookings';
import {
  leadSources,
  leadRequirements,
  leadContactMethods,
  leadClientTypes,
  leadStatuses,
  type Lead,
  type LeadSource,
} from '../data/leads';
import type { RealtyObject } from '../data/objects';
import { zoneStatusBadgeClass, zoneTypeLabels, type BuildingPlan, type BuildingPlanZone } from '../data/buildingPlans';
import { cn } from '../lib/cn';
import { todayIsoDate } from '../lib/todayIsoDate';
import {
  fetchLeads,
  insertLead,
  updateLead,
  deleteLead,
  uploadLeadPhoto,
  deleteLeadPhoto,
  tryAutoFillTelegramAvatar,
} from '../lib/leadsApi';
import { markLeadsViewed } from '../lib/leadsSeen';
import { fetchObjects } from '../lib/objectsApi';
import { fetchBookedZones, fetchBuildingPlans, fetchZonesByIds, updateZone } from '../lib/buildingPlansApi';
import { fetchSignedAgreementsForZones, type SignedAgreementSummary } from '../lib/agreementSigningApi';
import {
  fetchWorkstationSeatLeads,
  deleteWorkstationSeatLead,
  type WorkstationSeatLead,
} from '../lib/workstationSeatLeadsApi';

const NO_OBJECT = 'Не привязан';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

const emptyForm = {
  name: '',
  source: leadSources[0] as LeadSource,
  businessType: '',
  area: '',
  requirement: '',
  contact: '',
  contactMethod: '',
  phone: '',
  clientType: '',
  status: '',
  isWarm: false,
  objectId: '',
  photoPath: '',
  lastContactedAt: '',
  nextContactAt: '',
};

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Просрочен ли следующий контакт: дата назначена и она раньше сегодняшней.
// Сравниваем строки YYYY-MM-DD, а не Date — обе в одном формате, и это
// избавляет от разницы часовых поясов при разборе даты без времени.
function isOverdue(nextContactAt: string): boolean {
  return !!nextContactAt && nextContactAt < todayIsoDate();
}

// "Статус" в смысле важности лида — это isWarm, отдельно от status
// (свободный текст вроде "первичный контакт", он теперь только в карточке).
function WarmBadge({ lead, onToggle, disabled }: { lead: Lead; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      disabled={disabled}
      className={cn(
        'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold disabled:opacity-50',
        // bg-warning-bg, не bg-warning/15 — та же пара, что везде в проекте
        // (Badge.tsx/Documents.tsx/MarketOffersReview.tsx), даёт нужный
        // контраст; самодельная 15%-прозрачность давала 2.68:1 (UX-аудит).
        lead.isWarm ? 'bg-warning-bg text-warning' : 'bg-surface-muted text-ink-muted',
      )}
    >
      {lead.isWarm ? 'Важный' : 'Интересант'}
    </button>
  );
}

function leadToForm(l: Lead) {
  return {
    name: l.name,
    source: l.source,
    businessType: l.businessType,
    area: l.area,
    requirement: l.requirement,
    contact: l.contact,
    contactMethod: l.contactMethod,
    phone: l.phone,
    clientType: l.clientType,
    status: l.status,
    isWarm: l.isWarm,
    objectId: l.objectId,
    photoPath: l.photoPath,
    lastContactedAt: l.lastContactedAt,
    nextContactAt: l.nextContactAt,
  };
}

// Полный payload лида для insert/update. Собирался копипастой в трёх местах
// (сохранение формы, переключение "важного", и легко забывался при добавлении
// поля) — из-за чего новое поле могло молча затираться при toggleWarm.
function leadPayload(l: Omit<Lead, 'id' | 'createdAt'>): Omit<Lead, 'id' | 'createdAt'> {
  return {
    name: l.name,
    source: l.source,
    businessType: l.businessType,
    area: l.area,
    requirement: l.requirement,
    contact: l.contact,
    contactMethod: l.contactMethod,
    phone: l.phone,
    clientType: l.clientType,
    status: l.status,
    isWarm: l.isWarm,
    objectId: l.objectId,
    photoPath: l.photoPath,
    lastContactedAt: l.lastContactedAt,
    nextContactAt: l.nextContactAt,
  };
}

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [objects, setObjects] = useState<RealtyObject[]>([]);
  const [plans, setPlans] = useState<BuildingPlan[]>([]);
  const [bookedZones, setBookedZones] = useState<BuildingPlanZone[]>([]);
  const [seatLeads, setSeatLeads] = useState<WorkstationSeatLead[]>([]);
  const [seatZones, setSeatZones] = useState<BuildingPlanZone[]>([]);
  const [signedAgreements, setSignedAgreements] = useState<SignedAgreementSummary[]>([]);
  const [open, setOpen] = useState(false);
  // Карточка лида (просмотр) — промежуточный шаг между списком и формой:
  // клик по строке открывает её, а форма редактирования вызывается уже оттуда.
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const knownRequirements = useMemo(() => {
    const set = new Set<string>(leadRequirements);
    leads.forEach((l) => set.add(l.requirement));
    return [...set];
  }, [leads]);

  const knownContactMethods = useMemo(() => {
    const set = new Set<string>(leadContactMethods);
    leads.forEach((l) => l.contactMethod && set.add(l.contactMethod));
    return [...set];
  }, [leads]);

  const knownClientTypes = useMemo(() => {
    const set = new Set<string>(leadClientTypes);
    leads.forEach((l) => l.clientType && set.add(l.clientType));
    return [...set];
  }, [leads]);

  // Пресет плюс всё, что уже встречается в базе: статус раньше был свободным
  // текстом, и накопленные значения не должны пропасть из выпадающего списка.
  const knownStatuses = useMemo(() => {
    const set = new Set<string>(leadStatuses);
    leads.forEach((l) => l.status && set.add(l.status));
    return [...set];
  }, [leads]);

  const bookedLeadIds = useMemo(
    () => new Set([...bookedZones.map((z) => z.leadId).filter(Boolean), ...seatLeads.map((s) => s.leadId)]),
    [bookedZones, seatLeads],
  );

  // Тёплые лиды всегда наверху, порядок внутри группы (по дате создания) сохраняется.
  // Лиды с бронью кабинета показываются отдельным блоком ниже, а не в общем списке.
  const sortedLeads = useMemo(
    () => [...leads].filter((l) => !bookedLeadIds.has(l.id)).sort((a, b) => Number(b.isWarm) - Number(a.isWarm)),
    [leads, bookedLeadIds],
  );

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);
  const seatZoneById = useMemo(() => new Map(seatZones.map((z) => [z.id, z])), [seatZones]);

  // Строки для брони отдельных рабочих мест — одна на каждого лида, купившего
  // место в зоне с workstationCount (в отличие от bookedZones, где строка на
  // всю зону целиком с единственным лидом).
  const seatBookingRows = useMemo(
    () =>
      seatLeads
        .map((seat) => ({ seat, zone: seatZoneById.get(seat.zoneId), lead: leadById.get(seat.leadId) }))
        .filter((r): r is { seat: WorkstationSeatLead; zone: BuildingPlanZone; lead: Lead } => !!r.zone && !!r.lead),
    [seatLeads, seatZoneById, leadById],
  );

  // Для каждого плана — объект недвижимости, к которому он привязан (план могут
  // привязать только к одному объекту, но привязку хранит объект, а не план).
  const objectByPlanId = useMemo(() => {
    const map = new Map<string, RealtyObject>();
    for (const obj of objects) {
      for (const planId of obj.buildingPlanIds) {
        if (!map.has(planId)) map.set(planId, obj);
      }
    }
    return map;
  }, [objects]);

  useEffect(() => {
    markLeadsViewed();
  }, []);

  useEffect(() => {
    fetchLeads()
      .then(setLeads)
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить лиды')))
      .finally(() => setLoading(false));
    fetchObjects()
      .then(setObjects)
      .catch(() => setObjects([]));
    fetchBuildingPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
    Promise.all([fetchBookedZones(), fetchWorkstationSeatLeads()])
      .then(async ([zones, seats]) => {
        setBookedZones(zones);
        setSeatLeads(seats);
        const seatZoneIds = [...new Set(seats.map((s) => s.zoneId))];
        fetchZonesByIds(seatZoneIds)
          .then(setSeatZones)
          .catch(() => setSeatZones([]));
        const allZoneIds = [...new Set([...zones.map((z) => z.id), ...seatZoneIds])];
        fetchSignedAgreementsForZones(allZoneIds)
          .then(setSignedAgreements)
          .catch(() => setSignedAgreements([]));
      })
      .catch(() => {
        setBookedZones([]);
        setSeatLeads([]);
      });
  }, []);

  // Ключ — зона+лид, а не просто зона: у зоны с рабочими местами может быть
  // несколько подписанных соглашений (по одному на лида).
  const signedAgreementByKey = useMemo(
    () => new Map(signedAgreements.map((a) => [`${a.zoneId}:${a.leadId}`, a])),
    [signedAgreements],
  );

  // Брони зон и брони отдельных рабочих мест приводятся к одной форме, чтобы
  // рисоваться единым кодом (см. LeadBookings). Отличий ровно два: подпись
  // после названия кабинета и бейдж статуса.
  const bookingRows = useMemo<BookingRow[]>(() => {
    const zoneRows = bookedZones.map((zone) => ({
      key: `zone:${zone.id}`,
      lead: leadById.get(zone.leadId),
      unitLabel: zone.label || zoneTypeLabels[zone.zoneType],
      unitSuffix: zone.area != null ? `${zone.area} м²` : '',
      statusLabel: zone.status,
      statusClass: zoneStatusBadgeClass[zone.status],
      object: objectByPlanId.get(zone.buildingPlanId),
      plan: planById.get(zone.buildingPlanId),
      agreement: signedAgreementByKey.get(`${zone.id}:${zone.leadId}`),
    }));

    const seatRows = seatBookingRows.map(({ seat, zone, lead }) => ({
      key: `seat:${seat.id}`,
      lead,
      unitLabel: zone.label || zoneTypeLabels[zone.zoneType],
      unitSuffix: 'место',
      statusLabel: 'Место забронировано',
      statusClass: 'bg-warning/15 text-warning',
      object: objectByPlanId.get(zone.buildingPlanId),
      plan: planById.get(zone.buildingPlanId),
      agreement: signedAgreementByKey.get(`${zone.id}:${lead.id}`),
    }));

    return [...zoneRows, ...seatRows];
  }, [bookedZones, seatBookingRows, leadById, objectByPlanId, planById, signedAgreementByKey]);

  // Лид для карточки берём из общего списка по id, а не копируем в стейт: иначе
  // после сохранения формы или добавления заметки в карточке остались бы старые
  // данные, пока её не закроют и не откроют заново.
  const detailLead = detailId ? (leadById.get(detailId) ?? null) : null;

  const objectOptions = [NO_OBJECT, ...objects.map((o) => o.address)];

  function objectLabel(objectId: string) {
    return objects.find((o) => o.id === objectId)?.address ?? NO_OBJECT;
  }

  const canSubmit = form.name && form.businessType && form.area && form.contact && form.status;

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setSubmitError(null);
    setOpen(true);
  }

  function openEditModal(l: Lead) {
    setEditingId(l.id);
    setForm(leadToForm(l));
    setSubmitError(null);
    // Карточку закрываем: две модалки одновременно перекрывали бы друг друга.
    setDetailId(null);
    setOpen(true);
  }

  // Фото уходит в бакет сразу при выборе файла, а не при сохранении формы:
  // так видно превью и понятно, что загрузка прошла. Если это замена, старый
  // файл удаляем, чтобы бакет не заполнялся мусором.
  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || photoUploading) return;

    setPhotoUploading(true);
    setSubmitError(null);
    const previous = form.photoPath;
    try {
      const path = await uploadLeadPhoto(file);
      setForm((f) => ({ ...f, photoPath: path }));
      if (previous) await deleteLeadPhoto(previous);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Не удалось загрузить фото'));
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handlePhotoRemove() {
    const path = form.photoPath;
    setForm((f) => ({ ...f, photoPath: '' }));
    await deleteLeadPhoto(path);
  }

  // Фоновая попытка подтянуть аватар из Telegram после сохранения лида — не
  // await'ится в handleSubmit: сохранение и закрытие формы не должны ждать
  // стороннего запроса к t.me, который может быть медленным или недоступным.
  // Обновляет список, когда (и если) фото найдётся; молчит, если нет —
  // пользователь при необходимости загрузит фото сам.
  function autoFillTelegramAvatar(lead: Lead) {
    tryAutoFillTelegramAvatar(lead).then((updated) => {
      if (updated) setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    const payload = leadPayload(form);
    try {
      if (editingId) {
        const updated = await updateLead(editingId, payload);
        setLeads((prev) => prev.map((l) => (l.id === editingId ? updated : l)));
        autoFillTelegramAvatar(updated);
      } else {
        const created = await insertLead(payload);
        setLeads((prev) => [created, ...prev]);
        autoFillTelegramAvatar(created);
      }
      setForm(emptyForm);
      setEditingId(null);
      setOpen(false);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Не удалось сохранить лид'));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleWarm(l: Lead) {
    if (togglingId) return;
    setTogglingId(l.id);
    setToggleError(null);
    const next = { ...l, isWarm: !l.isWarm };
    setLeads((prev) => prev.map((x) => (x.id === l.id ? next : x)));
    try {
      const updated = await updateLead(l.id, leadPayload(next));
      setLeads((prev) => prev.map((x) => (x.id === l.id ? updated : x)));
    } catch (err) {
      setLeads((prev) => prev.map((x) => (x.id === l.id ? l : x)));
      setToggleError(errorMessage(err, 'Не удалось изменить статус'));
    } finally {
      setTogglingId(null);
    }
  }

  // Если лид держит бронь кабинета, сначала возвращаем кабинет в "Свободно"
  // (снимаем lead_id), потом удаляем сам лид — иначе кабинет навсегда
  // останется висеть "Забронирован" на удалённого лида.
  async function handleDeleteLead(lead: Lead) {
    if (deletingId) return;
    const zone = bookedZones.find((z) => z.leadId === lead.id);
    const seat = seatLeads.find((s) => s.leadId === lead.id);
    const seatZone = seat ? seatZoneById.get(seat.zoneId) : undefined;
    const confirmed = window.confirm(
      zone
        ? `Удалить лид «${lead.name}»? Бронь кабинета «${zone.label || zoneTypeLabels[zone.zoneType]}» будет снята.`
        : seatZone
          ? `Удалить лид «${lead.name}»? Место в «${seatZone.label || zoneTypeLabels[seatZone.zoneType]}» будет освобождено.`
          : `Удалить лид «${lead.name}»?`,
    );
    if (!confirmed) return;

    setDeletingId(lead.id);
    setToggleError(null);
    try {
      if (zone) {
        await updateZone(zone.id, { status: 'Свободно', leadId: '' });
        setBookedZones((prev) => prev.filter((z) => z.id !== zone.id));
      }
      if (seat && seatZone) {
        const nextSold = Math.max(seatZone.workstationsSold - 1, 0);
        const releasedZone = await updateZone(seatZone.id, { workstationsSold: nextSold, status: 'Свободно' });
        await deleteWorkstationSeatLead(seat.id);
        setSeatLeads((prev) => prev.filter((s) => s.id !== seat.id));
        setSeatZones((prev) => prev.map((z) => (z.id === releasedZone.id ? releasedZone : z)));
      }
      await deleteLead(lead.id);
      // Заметки удаляются каскадом (on delete cascade у lead_notes.lead_id),
      // а файл фото в бакете каскадом не удаляется — убираем вручную.
      await deleteLeadPhoto(lead.photoPath);
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      setDetailId(null);
    } catch (err) {
      setToggleError(errorMessage(err, 'Не удалось удалить лид'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Лиды"
        action={
          <Button icon={<Plus className="h-4 w-4" />} onClick={openAddModal}>
            Добавить лид
          </Button>
        }
      />

      <Card className="flex flex-col gap-4 p-0">
        {/* От md и шире — таблица-грид с горизонтальным скроллом при нехватке места.
            Ниже md та же строка неудобна для узкого экрана, поэтому там вместо неё —
            карточка на лид (см. блок md:hidden сразу за этим). */}
        <div className="hidden overflow-x-auto md:block">
          <div className="grid min-w-[900px] grid-cols-[110px_1fr_130px_1fr_120px_120px_48px] gap-4 px-6 py-3 text-xs font-medium uppercase tracking-wide text-ink-faint">
            <span>Статус</span>
            <span>Имя</span>
            <span>Способ связи</span>
            <span>Ссылка на диалог</span>
            <span>Посл. контакт</span>
            <span>Следующий</span>
            <span />
          </div>
          {sortedLeads.map((l) => (
            <div
              key={l.id}
              onClick={() => setDetailId(l.id)}
              className="grid min-w-[900px] cursor-pointer grid-cols-[110px_1fr_130px_1fr_120px_120px_48px] items-center gap-4 border-t border-border px-6 py-4 text-sm hover:bg-surface-muted/60"
            >
              <WarmBadge lead={l} onToggle={() => toggleWarm(l)} disabled={togglingId === l.id} />
              <span className="flex min-w-0 items-center gap-2.5">
                <LeadAvatar name={l.name} photoPath={l.photoPath} />
                <span className="truncate font-semibold text-ink">{l.name}</span>
              </span>
              <span className="truncate text-ink-muted">{l.contactMethod || '—'}</span>
              <span className="truncate text-ink-muted" onClick={(e) => e.stopPropagation()}>
                <ContactValue contact={l.contact} contactMethod={l.contactMethod} />
              </span>
              <span className="text-ink-muted">{formatDate(l.lastContactedAt)}</span>
              <span className={cn(isOverdue(l.nextContactAt) ? 'font-semibold text-danger' : 'text-ink-muted')}>
                {formatDate(l.nextContactAt)}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteLead(l);
                }}
                disabled={deletingId === l.id}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                aria-label="Удалить лид"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {loading && (
            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем лиды...
            </div>
          )}
          {!loading && loadError && <div className="px-6 py-10 text-center text-sm text-danger">{loadError}</div>}
          {!loading && !loadError && leads.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-ink-muted">Лидов пока нет</div>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4 md:hidden">
          {sortedLeads.map((l) => (
            <div
              key={l.id}
              onClick={() => setDetailId(l.id)}
              className="flex cursor-pointer flex-col gap-2.5 rounded-control border border-border p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <LeadAvatar name={l.name} photoPath={l.photoPath} />
                  <WarmBadge lead={l} onToggle={() => toggleWarm(l)} disabled={togglingId === l.id} />
                  <span className="min-w-0 truncate font-semibold text-ink">{l.name}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteLead(l);
                  }}
                  disabled={deletingId === l.id}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                  aria-label="Удалить лид"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                {l.contactMethod && <span>{l.contactMethod}</span>}
                {l.contact && (
                  <span className="truncate" onClick={(e) => e.stopPropagation()}>
                    <ContactValue contact={l.contact} contactMethod={l.contactMethod} />
                  </span>
                )}
              </div>
              {/* text-ink-muted, не text-ink-faint — это не декоративный
                  элемент, а рабочая информация для сотрудника (когда в
                  последний раз связывались, когда следующий контакт,
                  просрочка подсвечивается красным ниже) — text-ink-faint
                  давал 2.62:1 (UX-аудит), внутри карточки text-ink-muted
                  уже безопасно используется по всему проекту. */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>Посл. контакт: {formatDate(l.lastContactedAt)}</span>
                {l.nextContactAt && (
                  <span className={cn(isOverdue(l.nextContactAt) && 'font-semibold text-danger')}>
                    Следующий: {formatDate(l.nextContactAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем лиды...
            </div>
          )}
          {!loading && loadError && <div className="py-10 text-center text-sm text-danger">{loadError}</div>}
          {!loading && !loadError && leads.length === 0 && (
            <div className="py-10 text-center text-sm text-ink-muted">Лидов пока нет</div>
          )}
        </div>
      </Card>

      {toggleError && <p className="text-sm text-danger">{toggleError}</p>}

      <LeadBookings
        rows={bookingRows}
        onEditLead={openEditModal}
        onDeleteLead={handleDeleteLead}
        deletingId={deletingId}
      />

      <Modal open={open} onClose={() => setOpen(false)} title={editingId ? 'Редактировать лид' : 'Новый лид'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <LeadAvatar name={form.name || '?'} photoPath={form.photoPath} size="lg" />
            <div className="flex flex-col items-start gap-1.5">
              <label
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink hover:border-border-strong',
                  photoUploading && 'pointer-events-none opacity-50',
                )}
              >
                {photoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {photoUploading ? 'Загружаем...' : form.photoPath ? 'Заменить фото' : 'Загрузить фото'}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
              </label>
              {form.photoPath && !photoUploading && (
                <button
                  type="button"
                  onClick={handlePhotoRemove}
                  className="inline-flex items-center gap-1 text-xs text-ink-muted underline underline-offset-2 hover:text-danger"
                >
                  <X className="h-3 w-3" />
                  Удалить фото
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Имя"
              placeholder="Имя контакта"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
            <Select
              label="Источник"
              options={[...leadSources]}
              value={form.source}
              onChange={(v) => setForm((f) => ({ ...f, source: v as LeadSource }))}
            />
          </div>

          <Input
            label="Сфера деятельности"
            placeholder="Например, общепит, ритейл..."
            value={form.businessType}
            onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}
            required
          />

          <Input
            label="Нужная площадь"
            placeholder="Например, 120 м² или 100–150 м²"
            value={form.area}
            onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AddableSelect
              label="Требования"
              placeholder="Не выбрано"
              options={knownRequirements}
              value={form.requirement}
              onChange={(v) => setForm((f) => ({ ...f, requirement: v }))}
              addLabel="+ Добавить требование"
              newPlaceholder="Название требования"
            />
            <AddableSelect
              label="Тип клиента"
              placeholder="Не выбрано"
              options={knownClientTypes}
              value={form.clientType}
              onChange={(v) => setForm((f) => ({ ...f, clientType: v }))}
              addLabel="+ Добавить тип"
              newPlaceholder="Название типа клиента"
            />
          </div>

          <Input
            label="Телефон"
            placeholder="+375 29 ..."
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Контакт или ссылка на диалог"
              placeholder="@username, ссылка на переписку..."
              value={form.contact}
              onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
              required
            />
            <AddableSelect
              label="Способ связи"
              placeholder="Не выбрано"
              options={knownContactMethods}
              value={form.contactMethod}
              onChange={(v) => setForm((f) => ({ ...f, contactMethod: v }))}
              addLabel="+ Добавить способ"
              newPlaceholder="Название способа связи"
            />
          </div>
          <p className="-mt-2 text-xs text-ink-faint">
            Для Telegram укажи способ связи "Telegram" — тогда юзернейм (с @ или без) сам превратится в ссылку,
            открывающую диалог.
          </p>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Дата последнего контакта"
                type="date"
                value={form.lastContactedAt}
                onChange={(e) => setForm((f) => ({ ...f, lastContactedAt: e.target.value }))}
              />
            </div>
            <Button type="button" variant="secondary" onClick={() => setForm((f) => ({ ...f, lastContactedAt: todayIsoDate() }))}>
              Сегодня
            </Button>
          </div>

          <Input
            label="Дата следующего контакта"
            type="date"
            value={form.nextContactAt}
            onChange={(e) => setForm((f) => ({ ...f, nextContactAt: e.target.value }))}
          />
          <p className="-mt-2 text-xs text-ink-faint">
            Когда планируешь связаться в следующий раз. Просроченная дата подсвечивается в списке красным.
          </p>

          {editingId && (
            <p className="text-xs text-ink-faint">
              Лид создан: {formatDate(leads.find((l) => l.id === editingId)?.createdAt ?? '')}
            </p>
          )}

          <AddableSelect
            label="Статус"
            placeholder="Не выбрано"
            options={knownStatuses}
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            addLabel="+ Добавить статус"
            newPlaceholder="Название статуса"
          />

          <Select
            label="Объект недвижимости"
            options={objectOptions}
            value={objectLabel(form.objectId)}
            onChange={(v) => {
              if (v === NO_OBJECT) {
                setForm((f) => ({ ...f, objectId: '' }));
                return;
              }
              const obj = objects.find((o) => o.address === v);
              setForm((f) => ({ ...f, objectId: obj?.id ?? '' }));
            }}
          />

          <ToggleGroup
            label="Тёплый лид"
            options={['Да', 'Нет']}
            value={form.isWarm ? 'Да' : 'Нет'}
            onChange={(v) => setForm((f) => ({ ...f, isWarm: v === 'Да' }))}
          />

          {submitError && <p className="text-sm text-danger">{submitError}</p>}

          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? 'Сохраняем...' : editingId ? 'Сохранить' : 'Добавить'}
            </Button>
          </div>
        </form>
      </Modal>

      <LeadDetailModal
        lead={detailLead}
        object={detailLead ? objects.find((o) => o.id === detailLead.objectId) : undefined}
        onClose={() => setDetailId(null)}
        onEdit={openEditModal}
        onDelete={handleDeleteLead}
        onLeadUpdated={(updated) => setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))}
        deleting={deletingId === detailLead?.id}
      />
    </>
  );
}
