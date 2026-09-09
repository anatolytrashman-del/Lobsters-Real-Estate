import { Fragment, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, Check, ClipboardList } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EstimateLineItemsTable, formatUsd, formatZone } from '../components/estimates/EstimateLineItemsTable';
import { EstimateLineItemFormModal } from '../components/estimates/EstimateLineItemFormModal';
import { EstimateLineItemCommentsModal } from '../components/estimates/EstimateLineItemCommentsModal';
import { EstimateMaterialsPanel } from '../components/estimates/EstimateMaterialsPanel';
import { EstimateMaterialFormModal } from '../components/estimates/EstimateMaterialFormModal';
import { EstimateMaterialCommentsModal } from '../components/estimates/EstimateMaterialCommentsModal';
import { EstimateMaterialsLedgerModal } from '../components/estimates/EstimateMaterialsLedgerModal';
import { cn } from '../lib/cn';
import {
  estimateLineItemsTotals,
  sectionLineItemsTotals,
  type Estimate,
  type EstimateLineItem,
  type EstimateMaterial,
  type EstimateSection,
} from '../data/estimates';
import type { DocumentFile } from '../data/contractorDocuments';
import type { RealtyObject } from '../data/objects';
import type { ExchangeRate } from '../data/exchangeRates';
import { fetchEstimateByToken, updateEstimate } from '../lib/estimatesApi';
import { fetchObject } from '../lib/objectsApi';
import { fetchTodayRateOrLatestCached } from '../lib/exchangeRatesApi';
import { setNoIndex, clearNoIndex } from '../lib/pageMeta';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatBynUsd(value: number, rate: ExchangeRate | null): string {
  const usd = formatUsd(value, rate);
  return usd ? `${formatMoney(value)} Br · ${usd}` : `${formatMoney(value)} Br`;
}

const ESTIMATE_PUBLIC_TITLE = 'Построчная смета';

// Публичная ссылка для строителя (Артём и т.п.) — по shareToken, без пароля
// админки. Показывает и позволяет редактировать построчную смету и список
// материалов/снабжение каждого раздела (EstimateLineItemsTable/
// EstimateMaterialsPanel и их модалки переиспользованы как есть из
// EstimateDetail.tsx, у них нет своей зависимости от PasswordGate/профиля).
// Текст разделов, позиции-ТЗ и открытые вопросы (внутренняя переписка
// команды) сюда сознательно не попадают. Владелец, 2026-08-27: держать эту
// страницу в паритете со страницей внутри админки по всем правкам построчной
// сметы — "Можно сделать позже" на уровне раздела и карточку "Второй этаж"
// сюда тоже перенести (раньше были только в EstimateDetail.tsx).
export function EstimatePublicPage() {
  const { token } = useParams();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [object, setObject] = useState<RealtyObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rate, setRate] = useState<ExchangeRate | null>(null);

  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [lineItemSectionId, setLineItemSectionId] = useState<string | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<EstimateLineItem | null>(null);

  const [commentsSectionId, setCommentsSectionId] = useState<string | null>(null);
  const [commentsLineItem, setCommentsLineItem] = useState<EstimateLineItem | null>(null);

  const [materialModalOpen, setMaterialModalOpen] = useState(false);
  const [materialSectionId, setMaterialSectionId] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<EstimateMaterial | null>(null);

  const [commentsMaterialSectionId, setCommentsMaterialSectionId] = useState<string | null>(null);
  const [commentsMaterial, setCommentsMaterial] = useState<EstimateMaterial | null>(null);

  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Группы материалов ("Строительные леса" и т.п.) — по всей смете, см.
  // тот же комментарий в EstimateDetail.tsx.
  const materialGroupOptions = useMemo(() => {
    const set = new Set<string>();
    (estimate?.sections ?? []).forEach((s) => s.materials.forEach((m) => m.group && set.add(m.group)));
    return [...set];
  }, [estimate]);

  // Заголовок вкладки браузера — по умолчанию общий (ESTIMATE_PUBLIC_TITLE,
  // пока объект ещё не загрузился), затем "Смета реновации <адрес/название
  // объекта>" (владелец, 2026-08-27). Восстановление исходного заголовка
  // страницы — отдельным эффектом с []-зависимостями, чтобы захватить и
  // вернуть именно тот заголовок, что был ДО монтирования этой страницы, а
  // не промежуточное значение с предыдущего рендера этого же эффекта.
  useEffect(() => {
    const previousTitle = document.title;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    document.title = object
      ? `Смета реновации ${object.name || object.address}`
      : estimate?.title
        ? `Смета «${estimate.title}»`
        : ESTIMATE_PUBLIC_TITLE;
  }, [object, estimate]);

  useEffect(() => {
    setNoIndex();
    return () => clearNoIndex();
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    fetchEstimateByToken(token)
      .then((e) => {
        setEstimate(e);
        // Смета без объекта (см. Estimates.tsx) — fetchObject(null) не
        // нашёл бы строку и вернул бы ошибку вместо честного "объекта нет".
        return e.objectId ? fetchObject(e.objectId) : Promise.resolve(null);
      })
      .then(setObject)
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить смету')))
      .finally(() => setLoading(false));
    fetchTodayRateOrLatestCached()
      .then(setRate)
      .catch(() => {});
  }, [token]);

  async function savePatch(sections: Estimate['sections'], floor2Deferred?: boolean) {
    if (!estimate) throw new Error('Смета не загружена');
    const updated = await updateEstimate(estimate.id, {
      sections,
      questions: estimate.questions,
      status: estimate.status,
      floor2Deferred: floor2Deferred ?? estimate.floor2Deferred,
    });
    setEstimate(updated);
    return updated;
  }

  async function toggleFloor2Deferred() {
    if (!estimate) return;
    try {
      await savePatch(estimate.sections, !estimate.floor2Deferred);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось изменить отметку'));
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
    await savePatch(sections);
  }

  async function deleteLineItem(sectionId: string, itemId: string) {
    if (!estimate) return;
    if (!window.confirm('Удалить строку сметы?')) return;
    const sections = estimate.sections.map((s) =>
      s.id === sectionId ? { ...s, lineItems: s.lineItems.filter((li) => li.id !== itemId) } : s,
    );
    try {
      await savePatch(sections);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить строку'));
    }
  }

  function openLineItemComments(sectionId: string, item: EstimateLineItem) {
    setCommentsSectionId(sectionId);
    setCommentsLineItem(item);
  }

  async function saveLineItemComments(updated: EstimateLineItem) {
    if (!estimate || !commentsSectionId) return;
    const sections = estimate.sections.map((s) =>
      s.id === commentsSectionId ? { ...s, lineItems: s.lineItems.map((li) => (li.id === updated.id ? updated : li)) } : s,
    );
    const saved = await savePatch(sections);
    const savedSection = saved.sections.find((s) => s.id === commentsSectionId);
    setCommentsLineItem(savedSection?.lineItems.find((li) => li.id === updated.id) ?? null);
  }

  async function toggleLineItemDeferred(sectionId: string, item: EstimateLineItem) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) =>
      s.id === sectionId
        ? { ...s, lineItems: s.lineItems.map((li) => (li.id === item.id ? { ...li, deferred: !li.deferred } : li)) }
        : s,
    );
    try {
      await savePatch(sections);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось изменить отметку'));
    }
  }

  async function toggleSectionDeferred(sectionId: string) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, deferred: !s.deferred } : s));
    try {
      await savePatch(sections);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось изменить отметку'));
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
    await savePatch(sections);
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
    const saved = await savePatch(sections);
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
      await savePatch(sections);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить материал'));
    }
  }

  async function saveMaterialFiles(sectionId: string, files: DocumentFile[]) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, materialFiles: files } : s));
    await savePatch(sections);
  }

  async function saveMaterialListFiles(sectionId: string, files: DocumentFile[]) {
    if (!estimate) return;
    const sections = estimate.sections.map((s) => (s.id === sectionId ? { ...s, materialListFiles: files } : s));
    await savePatch(sections);
  }

  if (loading || loadError || !estimate) {
    return (
      <div className="min-h-svh bg-bg px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          <div>
            <span className="text-lg font-extrabold tracking-wide text-ink">
              <span className="font-black text-primary">RED</span>EVELOPMENT
            </span>
          </div>
          {loading && (
            <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем смету...
            </Card>
          )}
          {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}
        </div>
      </div>
    );
  }

  const totals = estimateLineItemsTotals(estimate, rate);
  // Сумма только по реальным разделам — БЕЗ 2-го этажа (тот не хранится
  // строками, только оценка-зеркало ниже). "Общая сумма" в карточке "Итого"
  // должна включать и его тоже — владелец, 2026-08-27: "у тебя общая сумма
  // считается без учёта второго этажа".
  const realTotal = totals.now.total + totals.later.total;

  function sectionsSum(sections: Estimate['sections']): number {
    return sections.reduce((sum, s) => {
      const t = sectionLineItemsTotals(s, rate);
      return sum + t.now.total + t.later.total;
    }, 0);
  }

  // Владелец, 2026-08-27: разделы помечены этажом через явное поле
  // EstimateSection.floor, не через текст заголовка ("Кабинеты 1 этаж" →
  // переименовалось в "Первый этаж" в тот же день — regex по названию
  // сломался бы). "Второй этаж" — та же оценка-зеркало, что и раньше:
  // реальных данных по 2-му этажу ещё нет, условно считаем той же суммой,
  // что 1-й этаж.
  const facadeSum = sectionsSum(estimate.sections.filter((s) => s.title.trim() === 'Фасад'));
  const floor1Total = sectionsSum(estimate.sections.filter((s) => s.floor === 1));
  const floor2Estimate = floor1Total;
  const grandTotal = realTotal + floor2Estimate;

  // Порядок блоков (владелец, 2026-08-27): все разделы этажей подряд, карточка
  // "Второй этаж" — после них, и только затем "Организация и логистика" (она
  // не привязана к этажу, идёт последней). "Второй этаж" — не настоящий
  // раздел (нет своих строк/материалов), а расчётная карточка-оценка, поэтому
  // список разделов делим на "до" и "после" по названию, а не храним отдельным
  // индексом — переживёт любой будущий порядок реальных разделов в базе.
  const logisticsSections = estimate.sections.filter((s) => s.title.trim() === 'Организация и логистика');
  const mainSections = estimate.sections.filter((s) => s.title.trim() !== 'Организация и логистика');

  function renderSectionBody(section: EstimateSection) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-bold text-ink">{formatZone(section.title)}</div>
          <button
            type="button"
            onClick={() => toggleSectionDeferred(section.id)}
            className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted"
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
        </div>
        <EstimateLineItemsTable
          section={section}
          rate={rate}
          onAdd={() => openAddLineItem(section.id)}
          onEdit={(item) => openEditLineItem(section.id, item)}
          onDelete={(item) => deleteLineItem(section.id, item.id)}
          onOpenComments={(item) => openLineItemComments(section.id, item)}
          onToggleDeferred={(item) => toggleLineItemDeferred(section.id, item)}
        />
        <div className="border-t border-border pt-4">
          <EstimateMaterialsPanel
            section={section}
            onAdd={() => openAddMaterial(section.id)}
            onEdit={(m) => openEditMaterial(section.id, m)}
            onDelete={(m) => deleteMaterial(section.id, m.id)}
            onOpenComments={(m) => openMaterialComments(section.id, m)}
            onFilesChange={(files) => saveMaterialFiles(section.id, files)}
            onListFilesChange={(files) => saveMaterialListFiles(section.id, files)}
          />
        </div>
      </div>
    );
  }

  function renderSectionCard(section: EstimateSection) {
    return (
      <Card key={section.id} className="p-5">
        {renderSectionBody(section)}
      </Card>
    );
  }

  // Группировка разделов в одну карточку (владелец, 2026-08-27) — санузлы
  // "более самостоятельная карточка... давай перенесём в блок Кабинеты
  // 1 этаж, но не в ту же таблицу, а в отдельную". По EstimateSection.floor,
  // не по тексту заголовка (тот менялся в тот же день — "Кабинеты 1 этаж" →
  // "Первый этаж" — регэксп по названию сломался бы): первый по порядку
  // раздел с floor=N становится "хостом" карточки, все следующие подряд
  // разделы с тем же floor попадают внутрь как отдельные таблицы, вплоть до
  // раздела с другим floor (или без него) или конца списка. У раздела-хоста
  // обычно есть своя построчная смета — она показывается первой, дети идут
  // ниже с разделителем (см. hasSectionContent/renderSectionBody).
  interface SectionGroup {
    header: EstimateSection | null;
    items: EstimateSection[];
  }

  function groupMainSections(list: EstimateSection[]): SectionGroup[] {
    const groups: SectionGroup[] = [];
    let current: SectionGroup = { header: null, items: [] };
    for (const s of list) {
      if (s.floor != null && current.header?.floor === s.floor) {
        current.items.push(s);
      } else {
        if (current.header || current.items.length > 0) groups.push(current);
        current = s.floor != null ? { header: s, items: [] } : { header: null, items: [s] };
      }
    }
    if (current.header || current.items.length > 0) groups.push(current);
    return groups;
  }

  function hasSectionContent(s: EstimateSection): boolean {
    return s.lineItems.length > 0 || s.materials.length > 0 || s.materialFiles.length > 0 || s.materialListFiles.length > 0;
  }

  const sectionGroups = groupMainSections(mainSections);

  return (
    <div className="min-h-svh bg-bg px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div>
          <span className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary">RED</span>EVELOPMENT
          </span>
        </div>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-lg font-bold text-ink">
                {object
                  ? `Смета реновации ${object.name || object.address}`
                  : estimate?.title
                    ? `Смета «${estimate.title}»`
                    : ESTIMATE_PUBLIC_TITLE}
              </span>
              <span className="text-sm text-ink-muted">Можно добавлять, редактировать и удалять строки, оставлять комментарии.</span>
            </div>
            <Button
              type="button"
              variant="secondary"
              icon={<ClipboardList className="h-4 w-4" />}
              onClick={() => setLedgerOpen(true)}
            >
              Ведомость материалов
            </Button>
          </div>
        </Card>

        {sectionGroups.map((group, i) => {
          if (!group.header) {
            return <Fragment key={`ungrouped-${i}`}>{group.items.map(renderSectionCard)}</Fragment>;
          }
          const headerHasContent = hasSectionContent(group.header);
          return (
            <Card key={group.header.id} className="flex flex-col gap-5 p-5">
              {headerHasContent ? (
                renderSectionBody(group.header)
              ) : (
                <div className="text-lg font-bold text-ink">{formatZone(group.header.title)}</div>
              )}
              {group.items.map((section) => (
                <div key={section.id} className="border-t border-border pt-5">
                  {renderSectionBody(section)}
                </div>
              ))}
            </Card>
          );
        })}

        {floor1Total > 0 && (
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold text-ink">Второй этаж</span>
              <button
                type="button"
                onClick={toggleFloor2Deferred}
                className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink-muted"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded border',
                    estimate.floor2Deferred ? 'border-primary bg-primary text-white' : 'border-border text-transparent',
                  )}
                >
                  <Check className="h-3 w-3" />
                </span>
                Можно сделать позже
              </button>
            </div>
            <p className="text-sm text-ink-faint">
              Расчёт есть только по 1-му этажу — 2-й пока условно считаем той же суммой (кабинеты, коридоры и
              санузлы), без фасада и организационных расходов — те не дублируются по этажам.
            </p>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">2-й этаж (оценочно)</div>
              <div className="text-sm font-semibold text-ink">{formatBynUsd(floor2Estimate, rate)}</div>
            </div>
          </Card>
        )}

        {logisticsSections.map(renderSectionCard)}

        {grandTotal > 0 && (
          <Card className="flex flex-col gap-4 p-5">
            <span className="font-bold text-ink">Итого планируемые расходы</span>
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Общая сумма</div>
                <div className="text-base font-semibold text-ink">{formatBynUsd(grandTotal, rate)}</div>
                <div className="text-xs text-ink-faint">По всем разделам сметы, включая отложенные на потом.</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">Фасад</div>
                <div className="text-base font-semibold text-ink">{formatBynUsd(facadeSum, rate)}</div>
                <div className="text-xs text-ink-faint">Наружная отделка — не дублируется по этажам.</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">1-й этаж + санузлы 1-го этажа</div>
                <div className="text-base font-semibold text-ink">{formatBynUsd(floor1Total, rate)}</div>
                <div className="text-xs text-ink-faint">Кабинеты, коридоры и санузлы 1-го этажа.</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">2-й этаж + санузел</div>
                <div className="text-base font-semibold text-ink">{formatBynUsd(floor2Estimate, rate)}</div>
                <div className="text-xs text-ink-faint">Оценочно — пока условно считаем той же суммой, что 1-й этаж.</div>
              </div>
            </div>
          </Card>
        )}
      </div>

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

      <EstimateMaterialsLedgerModal
        open={ledgerOpen}
        sections={estimate.sections}
        onClose={() => setLedgerOpen(false)}
        onEditMaterial={openEditMaterial}
        onDeleteMaterial={(sectionId, m) => deleteMaterial(sectionId, m.id)}
        onOpenComments={openMaterialComments}
        onAddMaterial={openAddMaterial}
      />
    </div>
  );
}
