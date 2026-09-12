import { Link } from 'react-router-dom';
import { ArrowRight, Download, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { ContactValue } from '../ui/ContactValue';
import { cn } from '../../lib/cn';
import { NEW_BOOKING_LEAD_STATUS, type Lead } from '../../data/leads';
import type { RealtyObject } from '../../data/objects';
import type { BuildingPlan } from '../../data/buildingPlans';
import type { SignedAgreementSummary } from '../../lib/agreementSigningApi';

// Одна строка блока «Брони кабинетов». Бронь целой зоны и бронь отдельного
// рабочего места приходят из разных таблиц и различаются лишь подписью юнита и
// бейджем статуса — поэтому и та, и другая приводятся к этой форме в Leads.tsx,
// а рисуются здесь одним кодом. Раньше это были четыре почти дословные копии
// разметки (десктоп/мобильный × зона/место), примерно 360 строк.
export interface BookingRow {
  key: string;
  lead: Lead | undefined;
  unitLabel: string;
  // Приписка после названия кабинета: площадь для зоны, «место» для рабочего места.
  unitSuffix: string;
  statusLabel: string;
  statusClass: string;
  object: RealtyObject | undefined;
  plan: BuildingPlan | undefined;
  agreement: SignedAgreementSummary | undefined;
}

interface LeadBookingsProps {
  rows: BookingRow[];
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (lead: Lead) => void;
  deletingId: string | null;
}

const GRID = 'grid min-w-[1020px] grid-cols-[1fr_150px_1fr_150px_150px_140px_84px] gap-4';

// Отметка «бронь с сайта ещё не подтверждена менеджером»: уходит сама, как
// только статус лида поменяют в карточке.
function NewBookingMark({ lead }: { lead: Lead | undefined }) {
  if (lead?.status !== NEW_BOOKING_LEAD_STATUS) return null;
  return (
    <span
      title="Новая бронь с сайта — ещё не подтверждена"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

function AgreementLink({ agreement }: { agreement: SignedAgreementSummary | undefined }) {
  if (!agreement) return <span className="text-ink-faint">Не подписано</span>;
  return (
    <a
      href={agreement.documentUrl}
      target="_blank"
      rel="noreferrer"
      className="flex w-fit items-center gap-1.5 text-sm font-medium text-primary-hover hover:underline"
    >
      <Download className="h-3.5 w-3.5" />
      Подписано
    </a>
  );
}

function PlanLink({ object }: { object: RealtyObject | undefined }) {
  if (!object) return null;
  return (
    <Link
      to={`/admin/objects/${object.landingSlug || object.id}`}
      className="flex items-center gap-1 text-sm font-medium text-primary-hover hover:underline"
    >
      На план
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function RowActions({
  lead,
  onEditLead,
  onDeleteLead,
  deletingId,
}: { lead: Lead } & Omit<LeadBookingsProps, 'rows'>) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onEditLead(lead)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
        aria-label="Открыть карточку лида"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onDeleteLead(lead)}
        disabled={deletingId === lead.id}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
        aria-label="Удалить лид"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function LeadBookings({ rows, onEditLead, onDeleteLead, deletingId }: LeadBookingsProps) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-lg font-bold text-ink">Брони кабинетов</div>
      <Card className="flex flex-col gap-4 p-0">
        {/* От md и шире — таблица-грид, ниже — карточки: та же логика, что и в
            основном списке лидов. */}
        <div className="hidden overflow-x-auto md:block">
          <div className={cn(GRID, 'px-6 py-3 text-xs font-medium uppercase tracking-wide text-ink-faint')}>
            <span>Лид</span>
            <span>Кабинет</span>
            <span>Объект</span>
            <span>Статус</span>
            <span>Соглашение</span>
            <span />
            <span />
          </div>
          {rows.map((row) => (
            <div key={row.key} className={cn(GRID, 'items-center border-t border-border px-6 py-4 text-sm')}>
              <div className="min-w-0">
                <div className="truncate font-semibold text-ink">{row.lead?.name ?? '—'}</div>
                <div className="truncate text-xs text-ink-muted">
                  {row.lead && <ContactValue contact={row.lead.contact} contactMethod={row.lead.contactMethod} />}
                </div>
              </div>
              <span className="text-ink">
                {row.unitLabel}
                {row.unitSuffix && <span className="text-ink-muted"> · {row.unitSuffix}</span>}
              </span>
              <div className="min-w-0">
                <div className="truncate text-ink">{row.object?.address ?? '—'}</div>
                {row.plan && <div className="truncate text-xs text-ink-muted">{row.plan.name}</div>}
              </div>
              <span className="flex items-center gap-1.5">
                <span className={cn('w-fit rounded-full px-3 py-1 text-xs font-semibold', row.statusClass)}>
                  {row.statusLabel}
                </span>
                <NewBookingMark lead={row.lead} />
              </span>
              <AgreementLink agreement={row.agreement} />
              <PlanLink object={row.object} />
              {row.lead ? (
                <RowActions
                  lead={row.lead}
                  onEditLead={onEditLead}
                  onDeleteLead={onDeleteLead}
                  deletingId={deletingId}
                />
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 p-4 md:hidden">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-2.5 rounded-control border border-border p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{row.lead?.name ?? '—'}</div>
                  {row.lead?.contact && (
                    <div className="truncate text-xs text-ink-muted">
                      <ContactValue contact={row.lead.contact} contactMethod={row.lead.contactMethod} />
                    </div>
                  )}
                </div>
                {row.lead && (
                  <div className="shrink-0">
                    <RowActions
                      lead={row.lead}
                      onEditLead={onEditLead}
                      onDeleteLead={onDeleteLead}
                      deletingId={deletingId}
                    />
                  </div>
                )}
              </div>
              <div className="text-sm text-ink">
                {row.unitLabel}
                {row.unitSuffix && <span className="text-ink-muted"> · {row.unitSuffix}</span>}
              </div>
              <div className="min-w-0 text-sm">
                <div className="truncate text-ink">{row.object?.address ?? '—'}</div>
                {row.plan && <div className="truncate text-xs text-ink-muted">{row.plan.name}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('w-fit rounded-full px-3 py-1 text-xs font-semibold', row.statusClass)}>
                  {row.statusLabel}
                </span>
                <NewBookingMark lead={row.lead} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                <AgreementLink agreement={row.agreement} />
                <PlanLink object={row.object} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
