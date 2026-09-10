import { useEffect, useRef, useState, type ElementType } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { glassCardClass, glassCardShadow } from '../../lib/glass';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { BuildingPlanCanvas, BuildingPlanLegend, BuildingPlanTabs } from './BuildingPlanCanvas';
import { AvailableUnitsTable } from './AvailableUnitsTable';
import { AgreementSigningFlow } from './AgreementSigningFlow';
import {
  zoneStatusBadgeClass,
  zoneTypeLabels,
  zoneDownPayment,
  zonePrice,
  workstationsRemaining,
  WORKSTATION_PRICE,
  PRICE_PER_METER,
  type BuildingPlan,
  type BuildingPlanZone,
} from '../../data/buildingPlans';
import type { RealtyObject } from '../../data/objects';
import { NEW_BOOKING_LEAD_STATUS } from '../../data/leads';
import { insertPublicLead } from '../../lib/leadsApi';
import { updateZone } from '../../lib/buildingPlansApi';
import { insertWorkstationSeatLead } from '../../lib/workstationSeatLeadsApi';
import { reachGoal } from '../../lib/metrika';
import { vkPixelGoal } from '../../lib/vkPixel';
import { cn } from '../../lib/cn';

// Тот же id используется в BookingTermsCard.tsx (PLAN_AND_UNITS_ANCHOR_ID) —
// его кнопка "Выбрать кабинет" скроллит сюда. Строка продублирована вместо
// импорта, чтобы не тянуть связь между соседними компонентами страницы.
const PLAN_AND_UNITS_ANCHOR_ID = 'plan-and-units';

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString('ru-RU')}`;
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

const emptyBookingForm = { name: '', contact: '', comment: '' };

// Доп. опция при бронировании кабинета — не атрибут зоны (в отличие от
// zoneFeatures вроде "Есть мокрая точка"), а платная доработка, которую
// клиент выбирает сам в момент брони. Фиксированная цена, поэтому не
// заводили отдельную колонку в building_plan_zones — просто дописывается
// в комментарий лида, чтобы менеджер увидел выбор при обработке заявки.
const WET_POINT_ADDON_LABEL = 'Мокрая точка в кабинете';
const WET_POINT_ADDON_PRICE = 500;

interface PublicPlanAndUnitsProps {
  object: RealtyObject;
  plans: BuildingPlan[];
  zones: BuildingPlanZone[];
  // Бронь сразу переводит зону в "Забронировано" и привязывает нового лида
  // (та же связка zone.leadId/status, что менеджер иначе ставит вручную из
  // ZoneDetailModal в админке) — родитель обновляет свой массив zones, чтобы
  // план и таблица тут же отразили изменение без перезагрузки страницы.
  onZoneUpdated: (zone: BuildingPlanZone) => void;
  // См. src/lib/glass.ts. Включено на продающей странице /:slug; на
  // легаси-странице /plan/:token остаётся выключенным (старый плоский стиль).
  glass?: boolean;
  // На продающей странице владелец решил убрать саму возможность смотреть
  // планировку — остаётся только список кабинетов (без кнопки "Показать на
  // плане" и без переключателя план/список, переключать не на что). Страница
  // /plan/:token — про то, чтобы прислать клиенту именно план, там не передаём.
  hidePlanView?: boolean;
}

// Планировка + таблица доступных кабинетов — общий блок для всех публичных
// поверхностей объекта (/plan/:token и продающая страница /:slug), чтобы
// подсветка, переключение этажей, кнопка "Посмотреть на плане" и
// бронирование кабинета вели себя одинаково и не расходились между копиями.
export function PublicPlanAndUnits({ object, plans, zones, onZoneUpdated, glass, hidePlanView }: PublicPlanAndUnitsProps) {
  const PlanWrapper: ElementType = glass ? 'div' : Card;
  const [activePlanId, setActivePlanId] = useState<string | null>(object.buildingPlanIds[0] ?? null);
  // План и список кабинетов теперь вкладки одного блока — "Список" в
  // trailing-слоте BuildingPlanTabs переключает viewMode отдельно от
  // activePlanId (какой план показывать, когда viewMode === 'plan').
  // При hidePlanView переключать не на что — сразу и всегда список.
  const [viewMode, setViewMode] = useState<'plan' | 'list'>(hidePlanView ? 'list' : 'plan');
  const [selectedZone, setSelectedZone] = useState<BuildingPlanZone | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [pinnedZoneId, setPinnedZoneId] = useState<string | null>(null);
  const planCardRef = useRef<HTMLDivElement>(null);
  // Переключение viewMode 'list' → 'plan' меняет высоту блока (таблица со
  // строками vs план+легенда) — если скроллить в том же обработчике, что и
  // ставит viewMode, scrollIntoView меряет ещё старую, дореактовую разметку
  // и промахивается. Поэтому сам скролл — отдельный эффект, срабатывающий
  // уже после того, как React перерисовал DOM под новый viewMode.
  const [pendingLocate, setPendingLocate] = useState(0);

  useEffect(() => {
    if (pendingLocate === 0) return;
    planCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pendingLocate]);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState(emptyBookingForm);
  const [wetPointAddon, setWetPointAddon] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingDone, setBookingDone] = useState(false);
  const [bookedLeadId, setBookedLeadId] = useState<string | null>(null);
  // "Забронировано!" показываем только после реального подписания
  // соглашения, а не сразу после отправки формы — иначе клиент решает, что
  // процесс уже завершён, хотя подпись ещё не поставлена.
  const [agreementSigned, setAgreementSigned] = useState(false);

  function resetBookingState(nextOpen: boolean) {
    setBookingOpen(nextOpen);
    setBookingForm(emptyBookingForm);
    setWetPointAddon(false);
    setBookingError(null);
    setBookingDone(false);
    setBookedLeadId(null);
    setAgreementSigned(false);
  }

  const objectPlans = object.buildingPlanIds
    .map((planId) => plans.find((p) => p.id === planId))
    .filter((p): p is BuildingPlan => !!p);
  const plan = objectPlans.find((p) => p.id === activePlanId) ?? null;
  const isRoom = selectedZone?.zoneType === 'room';
  const isWorkstation = selectedZone?.workstationCount != null;
  const workstationsLeft = selectedZone ? workstationsRemaining(selectedZone) : 0;
  // Клиенту статус "Продано" не показываем отдельно от "Забронировано" —
  // для него оба означают одно и то же: кабинет недоступен. Разница нужна
  // только админу (см. ZoneDetailModal, где этот же zone.status показан как есть).
  const displayStatus = selectedZone && selectedZone.status === 'Продано' ? 'Забронировано' : selectedZone?.status;
  const highlightZoneId = selectedZone?.id ?? pinnedZoneId ?? hoveredZoneId;
  // Этаж и площадь раньше были отдельными строками в карточке — теперь часть
  // заголовка модалки ("Кабинет 4 - 1 этаж - 19.4 м²"), чтобы не дублировать
  // их ниже в списке параметров.
  const zoneModalTitleText = (() => {
    if (!selectedZone) return '';
    const base = `${zoneTypeLabels[selectedZone.zoneType]} ${selectedZone.label}`.trim();
    if (!isRoom) return base;
    const parts = [base, plan?.name];
    if (!isWorkstation && selectedZone.area != null) parts.push(`${selectedZone.area} м²`);
    return parts.filter(Boolean).join(' - ');
  })();

  // Бейдж статуса — раньше отдельной строкой под заголовком модалки, теперь
  // рядом с ним в одной строке (см. zoneModalTitle ниже).
  const zoneStatusBadge =
    selectedZone && isRoom ? (
      isWorkstation ? (
        <span
          className={cn(
            'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
            workstationsLeft > 0 ? 'bg-success-bg text-success' : 'bg-danger/15 text-danger',
          )}
        >
          {workstationsLeft > 0 ? `Свободно ${workstationsLeft} из ${selectedZone.workstationCount}` : 'Все места заняты'}
        </span>
      ) : (
        displayStatus && (
          <span
            className={cn(
              'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
              zoneStatusBadgeClass[displayStatus],
            )}
          >
            {displayStatus === 'Свободно' ? 'Свободен' : displayStatus}
          </span>
        )
      )
    ) : null;

  const zoneModalTitle = selectedZone ? (
    <span className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 break-words">{zoneModalTitleText}</span>
      {zoneStatusBadge}
    </span>
  ) : (
    ''
  );

  function handleZoneSelect(zone: BuildingPlanZone) {
    if (zone.buildingPlanId !== activePlanId) setActivePlanId(zone.buildingPlanId);
    setSelectedZone(zone);
    resetBookingState(false);
  }

  // Кнопка "Забронировать" прямо в таблице доступных кабинетов — то же
  // самое, что открыть карточку кабинета и нажать "Забронировать" внутри,
  // но в один клик: сразу открывает модалку с формой брони, а не с кнопкой.
  function handleBookClick(zone: BuildingPlanZone) {
    if (zone.buildingPlanId !== activePlanId) setActivePlanId(zone.buildingPlanId);
    setSelectedZone(zone);
    resetBookingState(true);
  }

  function handleLocateOnPlan(zone: BuildingPlanZone) {
    if (zone.buildingPlanId !== activePlanId) setActivePlanId(zone.buildingPlanId);
    setViewMode('plan');
    setPinnedZoneId(zone.id);
    setPendingLocate((n) => n + 1);
  }

  async function handleBookingSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedZone || !bookingForm.name.trim() || !bookingForm.contact.trim() || bookingSubmitting) return;
    const bookingWorkstation = selectedZone.workstationCount != null;
    if (bookingWorkstation && workstationsRemaining(selectedZone) <= 0) return;
    setBookingSubmitting(true);
    setBookingError(null);
    try {
      const requirement = [
        bookingForm.comment.trim(),
        !bookingWorkstation && wetPointAddon
          ? `Доп. опция: ${WET_POINT_ADDON_LABEL} (+${formatMoney(WET_POINT_ADDON_PRICE)})`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const leadId = await insertPublicLead({
        name: bookingForm.name.trim(),
        source: 'Сайт',
        businessType: '',
        area: bookingWorkstation ? 'Фиксированное рабочее место' : selectedZone.area != null ? `${selectedZone.area} м²` : '',
        requirement,
        contact: bookingForm.contact.trim(),
        contactMethod: '',
        phone: '',
        clientType: '',
        status: NEW_BOOKING_LEAD_STATUS,
        isWarm: true,
        objectId: object.id,
        photoPath: '',
        lastContactedAt: '',
        nextContactAt: '',
      });
      // Рабочие места продаются по одному внутри одной зоны — вместо
      // whole-zone брони (status+leadId) увеличиваем счётчик проданных мест
      // и переводим зону в "Продано" только когда закончились все места.
      const updatedZone = bookingWorkstation
        ? await updateZone(selectedZone.id, {
            workstationsSold: selectedZone.workstationsSold + 1,
            status: selectedZone.workstationsSold + 1 >= (selectedZone.workstationCount as number) ? 'Продано' : 'Свободно',
          })
        : await updateZone(selectedZone.id, { status: 'Забронировано', leadId });
      // Привязка конкретного лида к конкретному месту — отдельная таблица,
      // потому что у одной зоны может быть до workstationCount разных лидов
      // (в отличие от обычного кабинета, где zone.leadId — один на всех).
      // Если эта запись не создастся (например, забыли RLS-политику на
      // insert) — откатываем инкремент зоны, иначе останется "фантомное"
      // занятое место без лида, который его на самом деле занял.
      if (bookingWorkstation) {
        try {
          await insertWorkstationSeatLead({ zoneId: selectedZone.id, leadId });
        } catch (seatErr) {
          await updateZone(selectedZone.id, {
            workstationsSold: selectedZone.workstationsSold,
            status: selectedZone.status,
          });
          throw seatErr;
        }
      }
      setSelectedZone(updatedZone);
      onZoneUpdated(updatedZone);
      setBookedLeadId(leadId);
      setBookingDone(true);
      // Цель "Бронь кабинета" в Метрике (JS-событие, не смена URL — форма
      // не уходит на отдельную страницу) — идентификатор совпадает с
      // "url" у цели типа action, заведённой через Management API.
      reachGoal('booking_submitted');
      // Та же конверсия — в VK-пиксель, для аудиторий/конверсий VK Рекламы.
      vkPixelGoal('booking_submitted');
    } catch (err) {
      setBookingError(errorMessage(err, 'Не удалось отправить заявку'));
    } finally {
      setBookingSubmitting(false);
    }
  }

  return (
    <>
      <div ref={planCardRef} id={PLAN_AND_UNITS_ANCHOR_ID}>
        <PlanWrapper
          className={cn('flex flex-col gap-3 p-5', glass && glassCardClass)}
          style={glass ? glassCardShadow : undefined}
        >
          <div className="font-bold text-ink">Кабинеты</div>

          {objectPlans.length === 0 ? (
            <p className="text-sm text-ink-muted">Планировка для этого объекта пока не добавлена.</p>
          ) : hidePlanView ? (
            <AvailableUnitsTable
              plans={objectPlans}
              zones={zones}
              highlightedZoneId={highlightZoneId}
              onRowClick={handleZoneSelect}
              onRowHover={(zone) => setHoveredZoneId(zone?.id ?? null)}
              onBookClick={handleBookClick}
              glass={glass}
              bare
            />
          ) : (
            <>
              <BuildingPlanTabs
                plans={objectPlans}
                activePlanId={viewMode === 'plan' ? activePlanId : null}
                onSelect={(id) => {
                  setActivePlanId(id);
                  setViewMode('plan');
                }}
                trailing={
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={cn(
                      'shrink-0 whitespace-nowrap rounded-t-control border border-b-0 px-4 py-2 text-sm font-medium transition-colors',
                      viewMode === 'list'
                        ? 'border-border bg-surface text-ink'
                        : 'border-transparent bg-surface-muted text-ink-muted hover:text-ink',
                    )}
                  >
                    Список
                  </button>
                }
              />
              {viewMode === 'plan' && plan && (
                <>
                  <BuildingPlanCanvas
                    plan={plan}
                    zones={zones}
                    onZoneClick={handleZoneSelect}
                    highlightZoneId={highlightZoneId}
                    hideSoldStatus
                    zoomable
                  />
                  <BuildingPlanLegend hideSoldStatus />
                </>
              )}
              {viewMode === 'list' && (
                <AvailableUnitsTable
                  plans={objectPlans}
                  zones={zones}
                  highlightedZoneId={highlightZoneId}
                  onRowClick={handleZoneSelect}
                  onRowHover={(zone) => setHoveredZoneId(zone?.id ?? null)}
                  onLocateClick={handleLocateOnPlan}
                  onBookClick={handleBookClick}
                  glass={glass}
                  bare
                />
              )}
            </>
          )}
        </PlanWrapper>
      </div>

      <Modal
        open={!!selectedZone}
        onClose={() => setSelectedZone(null)}
        title={zoneModalTitle}
      >
        {selectedZone && (
          <div className="flex flex-col gap-3">
            {isRoom && (
              <>
                {isWorkstation ? (
                  <div className="flex flex-col divide-y divide-border rounded-control bg-surface-muted px-3 text-sm">
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-ink-muted">Формат</span>
                      <span className="font-medium text-ink">Фиксированное рабочее место</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-ink-muted">Свободно мест</span>
                      <span className="font-medium text-ink">
                        {workstationsLeft} из {selectedZone.workstationCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-ink-muted">Цена за место</span>
                      <span className="font-medium text-ink">{formatMoney(WORKSTATION_PRICE)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-border rounded-control bg-surface-muted px-3 text-sm">
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-ink-muted">Отдельный вход</span>
                      <span className="font-medium text-ink">
                        {selectedZone.features.includes('Отдельный вход') ? 'Есть' : 'Нет'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 py-2">
                      <span className="text-ink-muted">Количество окон</span>
                      <span className="font-medium text-ink">{selectedZone.windowCount ?? '—'}</span>
                    </div>
                    {selectedZone.area != null && (
                      <>
                        <div className="flex items-center justify-between gap-3 py-2">
                          <span className="text-ink-muted">Стоимость за метр</span>
                          <span className="font-medium text-ink">{formatMoney(PRICE_PER_METER)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-2">
                          <span className="text-ink-muted">Общая стоимость</span>
                          <span className="font-medium text-ink">
                            {formatMoney(zonePrice(selectedZone.area, selectedZone.features))}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-2">
                          <span className="text-ink-muted">Первый взнос</span>
                          <span className="font-medium text-ink">
                            {formatMoney(zoneDownPayment(selectedZone.area, selectedZone.features))}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* "Отдельный вход" уже отдельной строкой в сетке выше — здесь
                    он был бы дублем. */}
                {selectedZone.features.filter((f) => f !== 'Отдельный вход').length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedZone.features
                      .filter((f) => f !== 'Отдельный вход')
                      .map((f) => (
                        <span key={f} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-ink">
                          {f}
                        </span>
                      ))}
                  </div>
                )}

                {((isWorkstation ? workstationsLeft > 0 : selectedZone.status === 'Свободно') || bookingDone) && (
                  <div className="flex flex-col gap-3 border-t border-border pt-3">
                    {bookingDone && bookedLeadId ? (
                      <div className="flex flex-col gap-3">
                        {agreementSigned ? (
                          <p className="text-sm font-medium text-success">
                            Забронировано! Мы скоро свяжемся с вами для подтверждения.
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-ink">
                            Осталось подписать соглашение о намерениях, чтобы завершить бронь.
                          </p>
                        )}
                        <AgreementSigningFlow
                          leadId={bookedLeadId}
                          objectId={object.id}
                          zoneId={selectedZone.id}
                          zoneArea={selectedZone.area ?? 0}
                          zoneFloorLabel={plan?.name ?? ''}
                          zoneLabel={selectedZone.label}
                          isWorkstation={isWorkstation}
                          onSigned={() => setAgreementSigned(true)}
                        />
                      </div>
                    ) : bookingOpen ? (
                      <form onSubmit={handleBookingSubmit} className="flex flex-col gap-3">
                        <Input
                          label="Имя"
                          placeholder="Как к вам обращаться"
                          value={bookingForm.name}
                          onChange={(e) => setBookingForm((f) => ({ ...f, name: e.target.value }))}
                          required
                          autoFocus
                        />
                        <Input
                          label="Телефон или Telegram"
                          placeholder="+375 29 ..."
                          value={bookingForm.contact}
                          onChange={(e) => setBookingForm((f) => ({ ...f, contact: e.target.value }))}
                          required
                        />
                        {!isWorkstation && selectedZone.features.includes('Можно сделать мокрую точку') && (
                          <div className="flex flex-col gap-1.5">
                            <label className="flex items-start gap-2 text-sm text-ink">
                              <input
                                type="checkbox"
                                checked={wetPointAddon}
                                onChange={(e) => setWetPointAddon(e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong text-primary focus:ring-primary"
                              />
                              <span>
                                {WET_POINT_ADDON_LABEL}{' '}
                                <span className="text-ink-muted">(+{formatMoney(WET_POINT_ADDON_PRICE)})</span>
                              </span>
                            </label>
                            {wetPointAddon && selectedZone.area != null && (
                              <p className="pl-6 text-xs text-ink-muted">
                                Итого с допоплатой:{' '}
                                {formatMoney(zonePrice(selectedZone.area, selectedZone.features) + WET_POINT_ADDON_PRICE)}
                              </p>
                            )}
                          </div>
                        )}
                        <Textarea
                          label="Комментарий (необязательно)"
                          rows={2}
                          value={bookingForm.comment}
                          onChange={(e) => setBookingForm((f) => ({ ...f, comment: e.target.value }))}
                        />
                        {bookingError && <p className="text-sm text-danger">{bookingError}</p>}
                        {bookingSubmitting && (
                          <p className="flex items-center gap-2 text-sm text-ink-muted">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Идёт бронирование, подождите...
                          </p>
                        )}
                        <Button type="submit" disabled={bookingSubmitting} className="w-fit">
                          {bookingSubmitting ? 'Отправляем...' : 'Далее — подписать соглашение'}
                        </Button>
                      </form>
                    ) : (
                      <Button type="button" onClick={() => setBookingOpen(true)} className="w-fit mx-auto">
                        Забронировать
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
