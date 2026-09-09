import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Check, Share2, ClipboardList } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AddableSelect } from '../components/ui/AddableSelect';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { EstimateLineItemsTable, formatUsd, formatZone, formatQty } from '../components/estimates/EstimateLineItemsTable';
import { EstimateLineItemFormModal } from '../components/estimates/EstimateLineItemFormModal';
import { EstimateLineItemCommentsModal } from '../components/estimates/EstimateLineItemCommentsModal';
import { EstimateMaterialsPanel } from '../components/estimates/EstimateMaterialsPanel';
import { EstimateMaterialFormModal } from '../components/estimates/EstimateMaterialFormModal';
import { EstimateMaterialCommentsModal } from '../components/estimates/EstimateMaterialCommentsModal';
import { EstimateMaterialsLedgerModal } from '../components/estimates/EstimateMaterialsLedgerModal';
import { cn } from '../lib/cn';
import {
  estimateStatuses,
  estimateLineItemsTotals,
  sectionLineItemsTotals,
  emptySection,
  type Estimate,
  type EstimateLineItem,
  type EstimateMaterial,
  type EstimateSection,
} from '../data/estimates';
import type { DocumentFile } from '../data/contractorDocuments';
import type { RealtyObject } from '../data/objects';
import type { BuildingPlanZone } from '../data/buildingPlans';
import type { ExchangeRate } from '../data/exchangeRates';
import { fetchEstimate, updateEstimate } from '../lib/estimatesApi';
import { fetchObject } from '../lib/objectsApi';
import { fetchTodayRateOrLatestCached } from '../lib/exchangeRatesApi';
import { fetchZonesForPlan } from '../lib/buildingPlansApi';

// Порядок и дефолт — владелец, 2026-09-01: "мне не нужна старая смета,
// которая внутри админки, мне нужна только версия, которая сейчас
// доступна по ссылке строителю... она должна быть и внутри админки, и по
// внешней ссылке" — "Смета" (построчная, то же самое, что видит строитель
// по ссылке) первая и открывается по умолчанию.
//
// Владелец, 2026-09-04: "в смете все вкладки Текст удаляй. Вместо этого
// сделай вкладку Работы и вынеси туда все строки с работами, оставив
// название работы и объём, без материала" — вкладка "Текст" (свободный
// текст раздела + позиции с RAL-цветами/референсами товаров,
// EstimatePosition) убрана целиком, вместе с формой позиций/каталогом
// вставок (EstimatePositionCard/EstimatePositionFormModal/CatalogPickerModal
// и data/estimateCatalog.ts стали полностью неиспользуемыми — удалены).
// "Работы" — простой список из построчной сметы (EstimateLineItem.workType +
// formatQty), без цен и без переопределения источника данных: тот же
// section.lineItems, что и на вкладке "Смета", просто урезанный показ.
const SECTION_TABS = ['Смета', 'Материалы', 'Работы'] as const;
type SectionTab = (typeof SECTION_TABS)[number];

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatArea(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatBynUsd(value: number, rate: ExchangeRate | null): string {
  const usd = formatUsd(value, rate);
  return usd ? `${formatMoney(value)} Br · ${usd}` : `${formatMoney(value)} Br`;
}

export function EstimateDetail() {
  const { id } = useParams();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [object, setObject] = useState<RealtyObject | null>(null);
  const [zones, setZones] = useState<BuildingPlanZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Черновик статуса, а не прямая запись в estimate.status на каждый
  // onChange: AddableSelect в режиме "+ Добавить статус" дёргает onChange
  // на каждое нажатие клавиши — без черновика это был бы сетевой запрос на
  // каждую букву, вперемешку и с реальным риском гонки (поздний ответ на
  // раннюю букву перезатирает финальное значение).
  const [statusDraft, setStatusDraft] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingSection, setSavingSection] = useState(false);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [lineItemSectionId, setLineItemSectionId] = useState<string | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<EstimateLineItem | null>(null);

  // Комментарии к строке — своя модалка (не форма правки чисел), но сама
  // строка комментируется тем же sectionId/itemId, что и правка/удаление,
  // поэтому держим отдельные "какая строка сейчас открыта для комментариев"
  // + "в каком разделе она лежит" (нужно для saveLineItemComments).
  const [commentsSectionId, setCommentsSectionId] = useState<string | null>(null);
  const [commentsLineItem, setCommentsLineItem] = useState<EstimateLineItem | null>(null);

  // Смета/материалы/работы — три вкладки внутри каждого раздела. Не
  // персистится — просто UI-состояние на время сессии, по умолчанию "Смета".
  const [sectionTab, setSectionTab] = useState<Record<string, SectionTab>>({});

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [materialSectionId, setMaterialSectionId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<EstimateMaterial | null>(null);

  // Комментарии к позиции материала — тот же принцип, что и у
  // commentsSectionId/commentsLineItem выше (владелец, 2026-08-31: "нужна
  // опция оставить комментарий возле каждой позиции по материалам").
  const [commentsMaterialSectionId, setCommentsMaterialSectionId] = useState<string | null>(null);
  const [commentsMaterial, setCommentsMaterial] = useState<EstimateMaterial | null>(null);

  // Группы материалов ("Строительные леса" и т.п.) — по всей смете, не
  // только текущему разделу, чтобы то же имя группы предлагалось выбрать
  // из списка (EstimateMaterialFormModal), а не вводилось с нуля каждый раз.
  const materialGroupOptions = useMemo(() => {
    const set = new Set<string>();
    (estimate?.sections ?? []).forEach((s) => s.materials.forEach((m) => m.group && set.add(m.group)));
    return [...set];
  }, [estimate]);

  const [linkCopied, setLinkCopied] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Курс для отображения итога построчной сметы в USD рядом с BYN — только
  // для показа, ни на что не влияет и никуда не сохраняется, поэтому
  // "сегодня или последний закэшированный" вместо fetchTodayRate (тот
  // рассчитан на фиксацию курса в момент сохранения записи, см. Transactions.tsx).
  const [rate, setRate] = useState<ExchangeRate | null>(null);

  useEffect(() => {
    fetchTodayRateOrLatestCached()
      .then(setRate)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    fetchEstimate(id)
      .then((e) => {
        setEstimate(e);
        setStatusDraft(e.status);
        // Смета без привязки к объекту (owner, 2026-09-09: "Смета Зелёный") —
        // fetchObject(null) сходил бы в базу за несуществующей строкой и
        // выдал бы "не удалось загрузить смету" вместо честного "объекта
        // нет вовсе".
        return e.objectId ? fetchObject(e.objectId) : Promise.resolve(null);
      })
      .then((o) => {
        setObject(o);
        if (!o || o.buildingPlanIds.length === 0) return;
        return Promise.all(o.buildingPlanIds.map((planId) => fetchZonesForPlan(planId))).then((lists) =>
          setZones(lists.flat()),
        );
      })
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить смету')))
      .finally(() => setLoading(false));
  }, [id]);

  const roomZones = zones.filter((z) => z.zoneType === 'room');
  const roomCount = roomZones.length;
  const roomArea = roomZones.reduce((sum, z) => sum + (z.area ?? 0), 0);

  async function saveEstimatePatch(patch: Partial<Pick<Estimate, 'sections' | 'questions' | 'status'>>) {
    if (!estimate) throw new Error('Смета не загружена');
    const updated = await updateEstimate(estimate.id, {
      sections: patch.sections ?? estimate.sections,
      questions: patch.questions ?? estimate.questions,
      status: patch.status ?? estimate.status,
      floor2Deferred: estimate.floor2Deferred,
    });
    setEstimate(updated);
    return updated;
  }

  async function handleStatusSave() {
    if (!estimate || !statusDraft.trim() || statusDraft === estimate.status || savingStatus) return;
    setSavingStatus(true);
    setStatusError(null);
    try {
      const updated = await saveEstimatePatch({ status: statusDraft });
      setStatusDraft(updated.status);
    } catch (err) {
      setStatusError(errorMessage(err, 'Не удалось изменить статус'));
    } finally {
      setSavingStatus(false);
    }
  }

  function startEditSection(section: EstimateSection) {
    setEditingSectionId(section.id);
    setTitleDraft(section.title);
    setSectionError(null);
  }

  async function saveSection() {
    if (!estimate || !editingSectionId) return;
    setSavingSection(true);
    setSectionError(null);
    try {
      const sections = estimate.sections.map((s) =>
        s.id === editingSectionId ? { ...s, title: titleDraft.trim() || 'Без названия' } : s,
      );
      await saveEstimatePatch({ sections });
      setEditingSectionId(null);
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось сохранить раздел'));
    } finally {
      setSavingSection(false);
    }
  }

  async function addSection() {
    if (!estimate) return;
    const section: EstimateSection = emptySection('Новый раздел');
    try {
      await saveEstimatePatch({ sections: [...estimate.sections, section] });
      startEditSection(section);
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось добавить раздел'));
    }
  }

  async function deleteSection(sectionId: string) {
    if (!estimate) return;
    if (!window.confirm('Удалить раздел вместе с содержимым?')) return;
    try {
      await saveEstimatePatch({ sections: estimate.sections.filter((s) => s.id !== sectionId) });
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось удалить раздел'));
    }
  }

  function openAddLineItem(sectionId: string) {
    setLineItemSectionId(sectionId);
    setEditingLineItem(null);
    setLineItemModalOpen(true);
  }

  function openEditLineItem(sectionId: string, item: EstimateLineItem) {
    setLineItemSectionId(sectionId);
    setEditingLineItem(item);
    setLineItemModalOpen(true);
  }

  // Та же логика проброса ошибки наверх (в EstimateLineItemFormModal), что и
  // у savePosition — форма не закрывается сама при сбое сети, показывает
  // ошибку внутри себя.
  async function saveLineItem(saved: EstimateLineItem) {
    if (!estimate || !lineItemSectionId) return;
    const sections = estimate.sections.map((s) => {
      if (s.id !== lineItemSectionId) return s;
      const exists = s.lineItems.some((li) => li.id === saved.id);
      return {
        ...s,
        lineItems: exists ? s.lineItems.map((li) => (li.id === saved.id ? saved : li)) : [...s.lineItems, saved],
      };
    });
    await saveEstimatePatch({ sections });
  }

  async function deleteLineItem(sectionId: string, itemId: string) {
    if (!estimate) return;
    if (!window.confirm('Удалить строку сметы?')) return;
    const sections = estimate.sections.map((s) =>
      s.id === sectionId ? { ...s, lineItems: s.lineItems.filter((li) => li.id !== itemId) } : s,
    );
    try {
      await saveEstimatePatch({ sections });
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось удалить строку'));
    }
  }

  function openLineItemComments(sectionId: string, item: EstimateLineItem) {
    setCommentsSectionId(sectionId);
    setCommentsLineItem(item);
  }

  // Комментарии — часть самой строки (см. EstimateLineItem.comments), а не
  // отдельная сущность, поэтому сохраняются тем же PATCH всей секции, что и
  // правка полей строки (saveLineItem выше) — просто без завязки на
  // lineItemSectionId/editingLineItem, у комментариев свой набор состояния.
  async function saveLineItemComments(updated: EstimateLineItem) {
    if (!estimate || !commentsSectionId) return;
    const sections = estimate.sections.map((s) =>
      s.id === commentsSectionId ? { ...s, lineItems: s.lineItems.map((li) => (li.id === updated.id ? updated : li)) } : s,
    );
    const saved = await saveEstimatePatch({ sections });
    const savedSection = saved.sections.find((s) => s.id === commentsSectionId);
    const savedItem = savedSection?.lineItems.find((li) => li.id === updated.id) ?? null;
    setCommentsLineItem(savedItem);
  }

  async function toggleLineItemDeferred(sectionId: string, item: EstimateLineItem) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) =>
      s.id === sectionId
        ? { ...s, lineItems: s.lineItems.map((li) => (li.id === item.id ? { ...li, deferred: !li.deferred } : li)) }
        : s,
    );
    try {
      await saveEstimatePatch({ sections });
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось изменить отметку'));
    }
  }

  async function toggleSectionDeferred(sectionId: string) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, deferred: !s.deferred } : s));
    try {
      await saveEstimatePatch({ sections });
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось изменить отметку'));
    }
  }

  function openAddMaterial(sectionId: string) {
    setMaterialSectionId(sectionId);
    setEditingMaterial(null);
    setMaterialModalOpen(true);
  }

  function openEditMaterial(sectionId: string, material: EstimateMaterial) {
    setMaterialSectionId(sectionId);
    setEditingMaterial(material);
    setMaterialModalOpen(true);
  }

  async function saveMaterial(saved: EstimateMaterial) {
    if (!estimate || !materialSectionId) return;
    const sections = estimate.sections.map((s) => {
      if (s.id !== materialSectionId) return s;
      const exists = s.materials.some((m) => m.id === saved.id);
      return { ...s, materials: exists ? s.materials.map((m) => (m.id === saved.id ? saved : m)) : [...s.materials, saved] };
    });
    await saveEstimatePatch({ sections });
  }

  function openMaterialComments(sectionId: string, material: EstimateMaterial) {
    setCommentsMaterialSectionId(sectionId);
    setCommentsMaterial(material);
  }

  async function saveMaterialComments(updated: EstimateMaterial) {
    if (!estimate || !commentsMaterialSectionId) return;
    const sections = estimate.sections.map((s) =>
      s.id === commentsMaterialSectionId ? { ...s, materials: s.materials.map((m) => (m.id === updated.id ? updated : m)) } : s,
    );
    const saved = await saveEstimatePatch({ sections });
    const savedSection = saved.sections.find((s) => s.id === commentsMaterialSectionId);
    setCommentsMaterial(savedSection?.materials.find((m) => m.id === updated.id) ?? null);
  }

  async function deleteMaterial(sectionId: string, materialId: string) {
    if (!estimate) return;
    if (!window.confirm('Удалить материал?')) return;
    const sections = estimate.sections.map((s) =>
      s.id === sectionId ? { ...s, materials: s.materials.filter((m) => m.id !== materialId) } : s,
    );
    try {
      await saveEstimatePatch({ sections });
    } catch (err) {
      setSectionError(errorMessage(err, 'Не удалось удалить материал'));
    }
  }

  async function saveMaterialFiles(sectionId: string, files: DocumentFile[]) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, materialFiles: files } : s));
    await saveEstimatePatch({ sections });
  }

  async function saveMaterialListFiles(sectionId: string, files: DocumentFile[]) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, materialListFiles: files } : s));
    await saveEstimatePatch({ sections });
  }

  function copyShareLink() {
    if (!estimate) return;
    const url = `${window.location.origin}/estimate/${estimate.shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  }

  const specs = object?.buildingSpecs;
  const lineItemsTotals = estimate
    ? estimateLineItemsTotals(estimate, rate)
    : { now: { work: 0, material: 0, total: 0 }, later: { work: 0, material: 0, total: 0 } };
  const grandTotal = lineItemsTotals.now.total + lineItemsTotals.later.total;

  // "Второй этаж" — карточка-заглушка (владелец: контрагент прислал только
  // 1-й этаж, 2-й пока условно считаем ×2 от "1-й этаж + общие зоны", см.
  // открытый вопрос про 2-й этаж). "Всё, кроме фасада" — раздел с фасадом
  // исключается по названию (фасадные работы делаются на всё здание разом,
  // не дублируются по этажам). Не строка в самой смете (не настоящие
  // данные, не от подрядчика) — отдельная карточка, прибавляется к общему
  // итогу отдельно.
  const floor1Total = estimate
    ? estimate.sections
        .filter((s) => s.title.trim() !== 'Фасад')
        .reduce((sum, s) => {
          const t = sectionLineItemsTotals(s, rate);
          return sum + t.now.total + t.later.total;
        }, 0)
    : 0;
  const floor2Estimate = floor1Total;
  const grandTotalWithFloor2 = grandTotal + floor2Estimate;

  return (
    <>
      <PageHeader
        title={estimate && !estimate.objectId ? `Смета «${estimate.title || 'без названия'}»` : 'Смета'}
        action={
          estimate ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                icon={<ClipboardList className="h-4 w-4" />}
                onClick={() => setLedgerOpen(true)}
              >
                Ведомость материалов
              </Button>
              <Button type="button" variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={copyShareLink}>
                {linkCopied ? 'Ссылка скопирована' : 'Ссылка для строителя'}
              </Button>
            </div>
          ) : undefined
        }
      />

      <Link to="/admin/estimates" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-ink hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        Все сметы
      </Link>

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем смету...
        </Card>
      )}
      {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}

      {!loading && !loadError && estimate && object && (
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-bold text-ink">{object.name || object.address}</div>
                {object.name && <div className="text-sm text-ink-muted">{object.address}</div>}
              </div>
              <div className="flex items-end gap-2">
                <div className="w-48">
                  <AddableSelect
                    label="Статус"
                    options={[...new Set([...estimateStatuses, estimate.status])]}
                    value={statusDraft}
                    onChange={setStatusDraft}
                    addLabel="+ Добавить статус"
                    newPlaceholder="Название статуса"
                  />
                </div>
                {statusDraft.trim() && statusDraft !== estimate.status && (
                  <button
                    type="button"
                    onClick={handleStatusSave}
                    disabled={savingStatus}
                    aria-label="Сохранить статус"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary text-primary disabled:opacity-50"
                  >
                    {savingStatus ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
            {statusError && <p className="text-sm text-danger">{statusError}</p>}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {object.area > 0 && (
                <Stat label="Общая площадь" value={`${formatArea(object.area)} м²`} />
              )}
              {specs?.normativeArea != null && <Stat label="Норм. площадь" value={`${formatArea(specs.normativeArea)} м²`} />}
              {specs?.floorsCount != null && <Stat label="Этажность" value={`${specs.floorsCount} эт.`} />}
              {specs?.walls && <Stat label="Стены" value={specs.walls} />}
              {specs?.roof && <Stat label="Кровля" value={specs.roof} />}
              {specs?.yearBuilt != null && (
                <Stat label="Год постройки" value={specs.yearRenovated ? `${specs.yearBuilt} (рен. ${specs.yearRenovated})` : String(specs.yearBuilt)} />
              )}
              {roomCount > 0 && <Stat label="Кабинетов на планах" value={`${roomCount} шт.`} />}
              {roomArea > 0 && <Stat label="Площадь кабинетов" value={`${formatArea(roomArea)} м² суммарно`} />}
            </div>
            <p className="text-xs text-ink-faint">
              Резерв на скрытые условия существующего здания — закладывать 25–30% сверх итога сметы.
            </p>
          </Card>

          {grandTotal > 0 && (
            <Card className="flex flex-col gap-3 p-5">
              <span className="font-bold text-ink">Итого по построчной смете</span>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <Stat label="Сейчас" value={formatBynUsd(lineItemsTotals.now.total, rate)} />
                {lineItemsTotals.later.total > 0 && (
                  <Stat label="Можно позже" value={formatBynUsd(lineItemsTotals.later.total, rate)} />
                )}
                <Stat label="Итого (сейчас + позже)" value={formatBynUsd(grandTotal, rate)} />
              </div>
            </Card>
          )}

          {floor1Total > 0 && (
            <Card className="flex flex-col gap-3 p-5">
              <span className="font-bold text-ink">Второй этаж</span>
              <p className="text-sm text-ink-faint">
                Подрядчик прислал расчёт только по 1-му этажу — 2-й пока условно считаем той же суммой, что 1-й этаж
                и общие зоны вместе (без фасада — фасадные работы не дублируются по этажам).
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <Stat label="1-й этаж + общие зоны (без фасада)" value={formatBynUsd(floor1Total, rate)} />
                <Stat label="2-й этаж (оценочно, столько же)" value={formatBynUsd(floor2Estimate, rate)} />
                <Stat label="Итого по смете с учётом 2-го этажа" value={formatBynUsd(grandTotalWithFloor2, rate)} />
              </div>
            </Card>
          )}

          {estimate.sections.map((section) => (
            <Card key={section.id} className="flex flex-col gap-3 p-5">
              {editingSectionId === section.id ? (
                <div className="flex flex-col gap-3">
                  <Input label="Название раздела" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} autoFocus />
                  {sectionError && <p className="text-sm text-danger">{sectionError}</p>}
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="secondary" onClick={() => setEditingSectionId(null)}>
                      Отмена
                    </Button>
                    <Button type="button" onClick={saveSection} disabled={savingSection}>
                      {savingSection ? 'Сохраняем...' : 'Сохранить'}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-bold text-ink">{formatZone(section.title)}</div>
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleSectionDeferred(section.id)}
                        className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded border',
                            section.deferred ? 'border-primary bg-primary text-white' : 'border-border text-transparent',
                          )}
                        >
                          <Check className="h-3 w-3" />
                        </span>
                        Можно сделать позже
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEditSection(section)}
                          aria-label="Редактировать раздел"
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSection(section.id)}
                          aria-label="Удалить раздел"
                          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <ToggleGroup
                    options={[...SECTION_TABS]}
                    value={sectionTab[section.id] ?? 'Смета'}
                    onChange={(v) => setSectionTab((prev) => ({ ...prev, [section.id]: v as SectionTab }))}
                  />

                  {/* Владелец, 2026-09-04: "сделай вкладку Работы и вынеси туда
                      все строки с работами, оставив название работы и объём,
                      без материала" — тот же section.lineItems, что и на
                      вкладке "Смета" (formatQty — общий хелпер оттуда), но без
                      цен/зоны/комментариев и без возможности править: это
                      просто быстрый обзор состава работ, редактирование
                      строки остаётся на вкладке "Смета". */}
                  {(sectionTab[section.id] ?? 'Смета') === 'Работы' && (
                    <div className="flex flex-col gap-1.5">
                      {section.lineItems.length === 0 ? (
                        <p className="text-sm text-ink-faint">В разделе пока нет строк работ.</p>
                      ) : (
                        section.lineItems.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-sm">
                            <span className="text-ink">{item.workType}</span>
                            <span className="shrink-0 text-ink-muted">{formatQty(item)}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {(sectionTab[section.id] ?? 'Смета') === 'Смета' && (
                    <EstimateLineItemsTable
                      section={section}
                      rate={rate}
                      onAdd={() => openAddLineItem(section.id)}
                      onEdit={(item) => openEditLineItem(section.id, item)}
                      onDelete={(item) => deleteLineItem(section.id, item.id)}
                      onOpenComments={(item) => openLineItemComments(section.id, item)}
                      onToggleDeferred={(item) => toggleLineItemDeferred(section.id, item)}
                    />
                  )}

                  {(sectionTab[section.id] ?? 'Смета') === 'Материалы' && (
                    <EstimateMaterialsPanel
                      section={section}
                      onAdd={() => openAddMaterial(section.id)}
                      onEdit={(m) => openEditMaterial(section.id, m)}
                      onDelete={(m) => deleteMaterial(section.id, m.id)}
                      onOpenComments={(m) => openMaterialComments(section.id, m)}
                      onFilesChange={(files) => saveMaterialFiles(section.id, files)}
                      onListFilesChange={(files) => saveMaterialListFiles(section.id, files)}
                    />
                  )}
                </>
              )}
            </Card>
          ))}

          <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={addSection}>
            Добавить раздел
          </Button>
        </div>
      )}

      <EstimateLineItemFormModal
        open={lineItemModalOpen}
        item={editingLineItem}
        onClose={() => setLineItemModalOpen(false)}
        onSaved={saveLineItem}
      />

      <EstimateLineItemCommentsModal
        item={commentsLineItem}
        onClose={() => {
          setCommentsSectionId(null);
          setCommentsLineItem(null);
        }}
        onSave={saveLineItemComments}
      />

      <EstimateMaterialFormModal
        open={materialModalOpen}
        material={editingMaterial}
        groupOptions={materialGroupOptions}
        onClose={() => setMaterialModalOpen(false)}
        onSaved={saveMaterial}
      />

      <EstimateMaterialCommentsModal
        material={commentsMaterial}
        onClose={() => {
          setCommentsMaterialSectionId(null);
          setCommentsMaterial(null);
        }}
        onSave={saveMaterialComments}
      />

      {estimate && (
        <EstimateMaterialsLedgerModal
          open={ledgerOpen}
          sections={estimate.sections}
          onClose={() => setLedgerOpen(false)}
          onEditMaterial={openEditMaterial}
          onDeleteMaterial={(sectionId, m) => deleteMaterial(sectionId, m.id)}
          onOpenComments={openMaterialComments}
          onAddMaterial={openAddMaterial}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}
