import { useEffect, useMemo, useState } from 'react';
import { X, Save, Trash2, Paperclip } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import type { MaterialLedger } from '../../data/materialLedgers';
import { insertMaterialLedger, updateMaterialLedger, deleteMaterialLedger } from '../../lib/materialLedgersApi';
import type { PurchaseItem } from '../../data/purchases';
import { buildMaterialLedgerXlsx, type LedgerAttachment } from '../../lib/materialLedgerXlsx';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

// Владелец, 2026-09-03: "хочу реализовать функционал прикрепления ведомостей
// материалов к письму... предложи решение с пресетами, чтобы Альмира могла
// один раз создать ведомость под окна и переиспользовать". Готовые
// ведомости (MaterialLedger) не привязаны ни к запросу, ни к поставщику —
// доступны из композера любого письма. requestItems — позиции ТЕКУЩЕГО
// запроса (категории), с которых удобно начать сборку ведомости вручную, не
// обязательный источник (можно собрать полностью с нуля через "Добавить
// позицию вручную"). "Прикрепить" сразу генерирует .xlsx (см.
// lib/materialLedgerXlsx.ts) и отдаёт наружу — сохранение как пресета
// (кнопка "Сохранить как ведомость") намеренно отдельное действие, тот же
// принцип, что и у "Сохранить как шаблон" в EmailThread.
export function MaterialLedgerModal({
  open,
  requestItems,
  allMaterials,
  ledgers,
  onClose,
  onLedgersChange,
  onAttach,
  readyOnly,
  initialLedgerId,
  hideLedgerPicker,
}: {
  open: boolean;
  requestItems: PurchaseItem[];
  // Владелец, 2026-09-03: "у нас же загружена ведомость в платформу, давай
  // делать этот список, буду выбирать из него" — не все категории имеют
  // свои requestItems (например "Универсальные поставщики" — пустая
  // категория), поэтому нужен более общий источник: плоский список ВСЕХ
  // материалов ВСЕХ смет (Suppliers.tsx → allEstimateMaterials). Первая
  // версия фильтровала список текстовым поиском — владелец забраковал
  // ("вводить совсем тупо, хочу видеть весь список и отмечать галочками"),
  // теперь весь список сразу, сгруппированный по объекту/разделу
  // (checklistGroups ниже), с чекбоксом на каждой позиции.
  allMaterials: { item: PurchaseItem; context: string }[];
  ledgers: MaterialLedger[];
  onClose: () => void;
  onLedgersChange: (ledgers: MaterialLedger[]) => void;
  // Владелец, 2026-09-04: "на странице Ведомости материалов делать
  // Шаблоны" — тот же список пресетов, но вне контекста письма (нечего
  // прикреплять) — необязателен, кнопка "Прикрепить" скрыта, когда не
  // передан.
  onAttach?: (attachment: LedgerAttachment) => void;
  // Владелец, 2026-09-09: "в массовой рассылке не нужен полный список
  // материалов, должны отображаться только готовые ведомости" — для
  // bulk-пикера (Suppliers.tsx → bulkLedgerPickerRequest) чек-лист сырых
  // материалов ВСЕХ смет скрыт целиком, доступен только выбор уже
  // сохранённой ведомости. Одиночная переписка (EmailThread) и управление
  // пресетами вне письма — без ограничения, там readOnly не передаётся.
  readyOnly?: boolean;
  // Владелец, 2026-09-09: "непонятно, зачем графа «Готовая ведомость»,
  // когда я добавляю новый шаблон" — вызвано тем, что выбор "какую
  // существующую ведомость открыть" дублировался и внутри модалки (этот
  // селект), и снаружи (список на странице "Ведомости материалов"). Теперь
  // выбор какую ведомость редактировать делается СНАРУЖИ, через
  // initialLedgerId — сам селект внутри модалки в этом случае скрыт, чтобы
  // не путать. Остальные вызовы (EmailThread "Прикрепить ведомость",
  // управление шаблонами на "Письмах") — без этого прогана, там быстрое
  // переключение между уже существующими ведомостями внутри модалки уместно.
  hideLedgerPicker?: boolean;
  // Открыть модалку сразу с предзагруженной конкретной ведомостью (правка
  // из списка на странице), а не с чистой формой создания.
  initialLedgerId?: string;
}) {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [manualName, setManualName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Модалка живёт смонтированной всегда (родитель переключает только open,
  // как и TemplateFormModal) — без сброса по [open] форма подхватила бы
  // состояние только на первом рендере родителя.
  //
  // initialLedgerId (владелец, 2026-09-09) — предзагрузка конкретной
  // ведомости при открытии из списка на странице. Намеренно НЕ в
  // зависимостях эффекта `ledgers` — этот массив меняется сразу после
  // каждого сохранения (onLedgersChange), а initialLedgerId остаётся
  // прежним весь сеанс редактирования; если бы `ledgers` был зависимостью,
  // эффект перезапускался бы после каждого сохранения и для режима
  // "новая ведомость" (initialLedgerId не задан) стирал бы только что
  // введённые название/позиции обратно в пустую форму.
  useEffect(() => {
    if (!open) return;
    const ledger = initialLedgerId ? ledgers.find((l) => l.id === initialLedgerId) : null;
    setSelectedId(ledger?.id ?? '');
    setName(ledger?.name ?? '');
    setItems(ledger?.items ?? []);
    setManualName('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialLedgerId]);

  // Владелец, 2026-09-03, после первой версии с полем поиска: "снова
  // неудобно, мне нужно видеть весь список сразу и отмечать галочками...
  // вот так вот вводить совсем тупо" — весь список сразу, сгруппированный
  // по объекту/разделу сметы (плюс отдельная группа "Текущий запрос", если
  // у категории есть свои items), чекбокс = позиция в ведомости.
  const checklistGroups = useMemo(() => {
    const groups: { label: string; items: PurchaseItem[] }[] = [];
    if (requestItems.length > 0) groups.push({ label: 'Текущий запрос', items: requestItems });
    const byContext = new Map<string, PurchaseItem[]>();
    for (const { item, context } of allMaterials) {
      const arr = byContext.get(context) ?? [];
      arr.push(item);
      byContext.set(context, arr);
    }
    for (const [label, contextItems] of byContext) groups.push({ label, items: contextItems });
    return groups;
  }, [requestItems, allMaterials]);

  if (!open) return null;

  function pickLedger(id: string) {
    setSelectedId(id);
    setError(null);
    if (!id) {
      setName('');
      setItems([]);
      return;
    }
    const ledger = ledgers.find((l) => l.id === id);
    if (!ledger) return;
    setName(ledger.name);
    setItems(ledger.items);
  }

  function toggleMaterial(item: PurchaseItem, checked: boolean) {
    if (checked) {
      if (items.some((i) => i.name === item.name)) return;
      setItems((prev) => [...prev, { ...item, id: crypto.randomUUID() }]);
    } else {
      setItems((prev) => prev.filter((i) => i.name !== item.name));
    }
  }

  function addManualItem() {
    if (!manualName.trim()) return;
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), sourceMaterialId: null, name: manualName.trim(), unit: '', quantity: null, price: null, note: '' },
    ]);
    setManualName('');
  }

  function updateItemQuantity(id: string, quantity: number | null) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, quantity } : i)));
  }

  // Владелец, 2026-09-09: "важно не только объём, но и ряд параметров" —
  // редактируемое поле-примечание прямо в ведомости (попадает в итоговый
  // .xlsx, см. lib/materialLedgerXlsx.ts).
  function updateItemNote(id: string, note: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, note } : i)));
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const canSubmit = name.trim().length > 0 && items.length > 0;

  async function handleSaveLedger() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), items };
      const saved = selectedId ? await updateMaterialLedger(selectedId, payload) : await insertMaterialLedger(payload);
      onLedgersChange(ledgers.some((l) => l.id === saved.id) ? ledgers.map((l) => (l.id === saved.id ? saved : l)) : [...ledgers, saved]);
      setSelectedId(saved.id);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось сохранить ведомость'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLedger() {
    if (!selectedId || deleting) return;
    if (!window.confirm(`Удалить ведомость «${name}»?`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMaterialLedger(selectedId);
      onLedgersChange(ledgers.filter((l) => l.id !== selectedId));
      setSelectedId('');
      setName('');
      setItems([]);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось удалить ведомость'));
    } finally {
      setDeleting(false);
    }
  }

  async function handleAttach() {
    if (!canSubmit || attaching || !onAttach) return;
    setAttaching(true);
    setError(null);
    try {
      const attachment = await buildMaterialLedgerXlsx(name.trim(), items);
      onAttach(attachment);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось сформировать файл ведомости'));
    } finally {
      setAttaching(false);
    }
  }

  const modalTitle = hideLedgerPicker ? (initialLedgerId ? 'Редактирование ведомости' : 'Новая ведомость') : 'Ведомость материалов';

  return (
    <Modal open onClose={onClose} title={modalTitle}>
      <div className="flex flex-col gap-4">
        {!hideLedgerPicker && ledgers.length > 0 && (
          <Select
            label="Готовая ведомость"
            placeholder={readyOnly ? 'Выберите ведомость' : 'Новая ведомость'}
            options={ledgers.map((l) => l.name)}
            value={ledgers.find((l) => l.id === selectedId)?.name ?? ''}
            onChange={(label) => pickLedger(ledgers.find((l) => l.name === label)?.id ?? '')}
          />
        )}

        {readyOnly && ledgers.length === 0 && (
          <p className="text-sm text-ink-faint">
            Готовых ведомостей ещё нет — создайте их во вкладке «Ведомости материалов» → «Шаблоны», тогда они появятся
            здесь для выбора.
          </p>
        )}

        {!readyOnly && (
          <>
            <Input label="Название ведомости" placeholder="Например, Окна" value={name} onChange={(e) => setName(e.target.value)} autoFocus />

            <div className="flex flex-col gap-2">
              <span className="text-sm text-ink-muted">Выберите материалы из смет</span>
              {checklistGroups.length === 0 ? (
                <p className="text-sm text-ink-faint">В сметах пока нет материалов — добавьте позицию вручную ниже.</p>
              ) : (
                <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-control bg-surface-muted p-3">
                  {checklistGroups.map((group) => (
                    <div key={group.label} className="flex flex-col gap-1">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{group.label}</span>
                      {group.items.map((item) => {
                        const checked = items.some((i) => i.name === item.name);
                        return (
                          <label
                            key={item.id}
                            className="flex items-center gap-2.5 rounded-control px-1.5 py-1 text-sm hover:bg-surface"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleMaterial(item, e.target.checked)}
                              className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                            />
                            <span className="min-w-0 truncate text-ink">
                              {item.name}
                              {item.unit && (
                                <span className="text-ink-faint">
                                  {' '}
                                  · {item.quantity ?? '—'} {item.unit}
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          {(!readyOnly || items.length > 0) && <span className="text-sm text-ink-muted">Позиции ведомости</span>}
          {items.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {items.map((item) =>
                readyOnly ? (
                  <div key={item.id} className="flex flex-col gap-1 rounded-control border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-ink">{item.name}</span>
                      <span className="text-ink-faint">
                        {item.quantity ?? '—'} {item.unit}
                      </span>
                    </div>
                    {item.note && <span className="text-xs text-ink-faint">{item.note}</span>}
                  </div>
                ) : (
                  <div key={item.id} className="flex flex-col gap-1.5 rounded-control border border-border px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 text-ink">{item.name}</span>
                      <input
                        type="number"
                        placeholder="Кол-во"
                        value={item.quantity ?? ''}
                        onChange={(e) => updateItemQuantity(item.id, e.target.value === '' ? null : Number(e.target.value))}
                        className="w-20 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                      />
                      {item.unit && <span className="w-12 text-ink-faint">{item.unit}</span>}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        aria-label="Удалить позицию"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Важные параметры — фактура, формат, цвет и т.п."
                      value={item.note}
                      onChange={(e) => updateItemNote(item.id, e.target.value)}
                      className="rounded-control border border-border bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-primary"
                    />
                  </div>
                ),
              )}
            </div>
          )}
          {!readyOnly && (
          <div className="flex gap-2">
            <Input placeholder="Добавить позицию вручную" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <Button type="button" variant="secondary" onClick={addManualItem} disabled={!manualName.trim()}>
              Добавить
            </Button>
          </div>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            {!readyOnly && selectedId && (
              <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={handleDeleteLedger} disabled={deleting}>
                {deleting ? 'Удаляем...' : 'Удалить ведомость'}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {!readyOnly && (
              <Button type="button" variant="secondary" icon={<Save className="h-4 w-4" />} onClick={handleSaveLedger} disabled={!canSubmit || saving}>
                {saving ? 'Сохраняем...' : 'Сохранить как ведомость'}
              </Button>
            )}
            {onAttach && (
              <Button type="button" icon={<Paperclip className="h-4 w-4" />} onClick={handleAttach} disabled={!canSubmit || attaching}>
                {attaching ? 'Формируем файл...' : 'Прикрепить'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
