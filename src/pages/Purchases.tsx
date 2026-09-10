import { useEffect, useMemo, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Send, Mail, Paperclip } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Textarea } from '../components/ui/Textarea';
import { AddableSelect } from '../components/ui/AddableSelect';
import { Select } from '../components/ui/Select';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { Modal } from '../components/ui/Modal';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { currencySymbols } from '../data/transactions';
import type { Currency } from '../data/transactions';
import {
  purchaseStatuses,
  purchaseItemTotal,
  purchaseTotal,
  purchaseEmailAddress,
  PURCHASE_CURRENCIES,
  type Purchase,
  type PurchaseItem,
} from '../data/purchases';
import { fetchPurchases, insertPurchase, updatePurchase, deletePurchase, type PurchaseInput } from '../lib/purchasesApi';
import type { PurchaseEmail } from '../data/purchaseEmails';
import { fetchPurchaseEmails, sendPurchaseEmail } from '../lib/purchaseEmailsApi';
import { fetchContractors, insertContractor } from '../lib/contractorsApi';
import type { Contractor } from '../data/contractors';
import { fetchEstimates } from '../lib/estimatesApi';
import type { Estimate, EstimateMaterial } from '../data/estimates';
import { fetchObjects } from '../lib/objectsApi';
import type { RealtyObject } from '../data/objects';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

const emptyForm = {
  title: '',
  status: purchaseStatuses[0] as string,
  contractorId: '' as string,
  estimateId: '' as string,
  sectionId: '' as string,
  sectionTitle: '',
  items: [] as PurchaseItem[],
  currency: 'BYN' as Currency,
};

function purchaseToForm(p: Purchase) {
  return {
    title: p.title,
    status: p.status,
    contractorId: p.contractorId ?? '',
    estimateId: p.estimateId ?? '',
    sectionId: p.sectionId ?? '',
    sectionTitle: p.sectionTitle,
    items: p.items,
    currency: p.currency,
  };
}

// Черновик новой закупки, приходящий из победившего предложения в
// Ресерче поставщиков ("Создать закупку" — см. Suppliers.tsx) — тот же
// набор полей, что и у формы, просто с известными исходными значениями.
export interface PurchaseDraft {
  title: string;
  contractorId: string | null;
  estimateId: string | null;
  sectionId: string | null;
  sectionTitle: string;
  items: PurchaseItem[];
  currency: Currency;
}

// embedded=true — рендер внутри страницы "Закупки" (см. Suppliers.tsx,
// вкладка "Закупки"), без собственного PageHeader.
// initialDraft — открыть форму добавления сразу заполненной этим черновиком
// (переход "Создать закупку" из Ресерча); onDraftConsumed сообщает
// родителю, что черновик подхвачен и можно его забыть (иначе форма
// переоткрывалась бы заново на каждый ре-рендер).
export function Purchases({
  embedded = false,
  initialDraft = null,
  onDraftConsumed,
}: {
  embedded?: boolean;
  initialDraft?: PurchaseDraft | null;
  onDraftConsumed?: () => void;
} = {}) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [objects, setObjects] = useState<RealtyObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [manualItemName, setManualItemName] = useState('');

  // Быстрое добавление нового поставщика прямо из формы закупки —
  // владелец: "подрядчик добавляется на одной странице, а потом надо идти
  // в закупки, это уже со старта неудобно". Минимальная карточка (имя +
  // email — этого достаточно, чтобы сразу отправить письмо), полную можно
  // дозаполнить потом на вкладке "Каталог".
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddEmail, setQuickAddEmail] = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPurchases(), fetchContractors(), fetchEstimates(), fetchObjects()])
      .then(([p, c, e, o]) => {
        setPurchases(p);
        setContractors(c);
        setEstimates(e);
        setObjects(o);
      })
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить закупки')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!initialDraft) return;
    setEditingId(null);
    setForm({
      title: initialDraft.title,
      status: purchaseStatuses[0] as string,
      contractorId: initialDraft.contractorId ?? '',
      estimateId: initialDraft.estimateId ?? '',
      sectionId: initialDraft.sectionId ?? '',
      sectionTitle: initialDraft.sectionTitle,
      items: initialDraft.items,
      currency: initialDraft.currency,
    });
    setFormError(null);
    setManualItemName('');
    setModalOpen(true);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  // Тот же список, что и вкладка "Каталог" на странице Suppliers.tsx —
  // отдельный справочник поставщиков заводить не стали, contractors без
  // teamTier уже и есть поставщики.
  const supplierContractors = useMemo(() => contractors.filter((c) => !c.teamTier), [contractors]);
  const contractorById = useMemo(() => new Map(contractors.map((c) => [c.id, c])), [contractors]);

  function objectLabel(objectId: string): string {
    const o = objects.find((x) => x.id === objectId);
    return o ? o.name || o.address : 'Объект без названия';
  }

  const estimateOptions = useMemo(
    () =>
      estimates.map((e) => ({
        id: e.id,
        label: `Смета — ${e.objectId ? objectLabel(e.objectId) : e.title || 'без объекта'}`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [estimates, objects],
  );

  const selectedEstimate = estimates.find((e) => e.id === form.estimateId) ?? null;
  const selectedSection = selectedEstimate?.sections.find((s) => s.id === form.sectionId) ?? null;

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setManualItemName('');
    setModalOpen(true);
  }

  function openQuickAddSupplier() {
    setQuickAddName('');
    setQuickAddEmail('');
    setQuickAddError(null);
    setQuickAddOpen(true);
  }

  async function handleQuickAddSupplier() {
    if (!quickAddName.trim() || quickAddSaving) return;
    setQuickAddSaving(true);
    setQuickAddError(null);
    try {
      const created = await insertContractor({
        name: quickAddName.trim(),
        specialty: '',
        contact: quickAddEmail.trim(),
        contactMethod: quickAddEmail.trim() ? 'Email' : '',
        phone: '',
        email: quickAddEmail.trim(),
        notes: '',
        paymentTerms: '',
        teamTier: '',
        responsibilityZone: '',
        photoPath: '',
        birthday: '',
        resumePath: '',
        resumeFileName: '',
      });
      setContractors((prev) => [...prev, created]);
      setForm((f) => ({ ...f, contractorId: created.id }));
      setQuickAddOpen(false);
    } catch (err) {
      setQuickAddError(errorMessage(err, 'Не удалось добавить поставщика'));
    } finally {
      setQuickAddSaving(false);
    }
  }

  function openEdit(p: Purchase) {
    setEditingId(p.id);
    setForm(purchaseToForm(p));
    setFormError(null);
    setManualItemName('');
    setModalOpen(true);
  }

  function addMaterialToItems(m: EstimateMaterial) {
    if (form.items.some((i) => i.sourceMaterialId === m.id)) return;
    const item: PurchaseItem = {
      id: crypto.randomUUID(),
      sourceMaterialId: m.id,
      name: m.name,
      unit: m.unit,
      quantity: m.quantity,
      price: null,
      note: m.note,
    };
    setForm((f) => ({ ...f, items: [...f.items, item] }));
  }

  function addManualItem() {
    if (!manualItemName.trim()) return;
    const item: PurchaseItem = {
      id: crypto.randomUUID(),
      sourceMaterialId: null,
      name: manualItemName.trim(),
      unit: '',
      quantity: null,
      price: null,
      note: '',
    };
    setForm((f) => ({ ...f, items: [...f.items, item] }));
    setManualItemName('');
  }

  function updateItem(id: string, patch: Partial<PurchaseItem>) {
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }

  function removeItem(id: string) {
    setForm((f) => ({ ...f, items: f.items.filter((i) => i.id !== id) }));
  }

  async function handleSave() {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    const input: PurchaseInput = {
      title: form.title.trim(),
      status: form.status,
      contractorId: form.contractorId || null,
      estimateId: form.estimateId || null,
      sectionId: form.sectionId || null,
      sectionTitle: form.sectionTitle,
      items: form.items,
      currency: form.currency,
    };
    try {
      const saved = editingId ? await updatePurchase(editingId, input) : await insertPurchase(input);
      setPurchases((prev) => (editingId ? prev.map((p) => (p.id === saved.id ? saved : p)) : [saved, ...prev]));
      setModalOpen(false);
    } catch (err) {
      setFormError(errorMessage(err, 'Не удалось сохранить закупку'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(p: Purchase) {
    if (!window.confirm(`Удалить закупку «${p.title}»?`)) return;
    setDeletingId(p.id);
    try {
      await deletePurchase(p.id);
      setPurchases((prev) => prev.filter((x) => x.id !== p.id));
      if (detailId === p.id) setDetailId(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Не удалось удалить закупку'));
    } finally {
      setDeletingId(null);
    }
  }

  const detailPurchase = detailId ? (purchases.find((p) => p.id === detailId) ?? null) : null;

  const addButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={openAdd}>
      Добавить закупку
    </Button>
  );

  return (
    <>
      {embedded ? (
        <div className="mb-2 flex justify-end">{addButton}</div>
      ) : (
        <PageHeader title="Закупки" action={addButton} />
      )}

      <div className="flex flex-col gap-4">
        {loading && (
          <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем закупки...
          </Card>
        )}
        {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}
        {!loading && !loadError && purchases.length === 0 && (
          <Card className="py-10 text-center text-sm text-ink-muted">Закупок пока нет</Card>
        )}

        {!loading &&
          !loadError &&
          purchases.map((p) => {
            const supplier = p.contractorId ? contractorById.get(p.contractorId) : null;
            const total = purchaseTotal(p);
            return (
              <div
                key={p.id}
                onClick={() => setDetailId(p.id)}
                className={cn('flex cursor-pointer flex-col gap-2 p-4 transition-colors hover:border-primary/40', glassCardClass)}
                style={glassCardShadow}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{p.title}</span>
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-muted">{p.status}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(p);
                      }}
                      aria-label="Редактировать закупку"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:border-primary hover:text-primary"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p);
                      }}
                      disabled={deletingId === p.id}
                      aria-label="Удалить закупку"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
                  <span>{supplier ? supplier.name : 'Поставщик не выбран'}</span>
                  {p.sectionTitle && <span>· {p.sectionTitle}</span>}
                  {total > 0 && (
                    <span className="font-semibold text-ink">
                      {formatMoney(total)} {currencySymbols[p.currency]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? 'Закупка' : 'Новая закупка'}>
        <div className="flex flex-col gap-4">
          {formError && <p className="text-sm text-danger">{formError}</p>}

          <Input label="Название" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />

          <AddableSelect
            label="Статус"
            options={[...new Set([...purchaseStatuses, form.status])]}
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            addLabel="+ Добавить статус"
            newPlaceholder="Название статуса"
          />

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Select
                label="Поставщик"
                placeholder="Не выбран"
                options={supplierContractors.map((c) => c.name)}
                value={supplierContractors.find((c) => c.id === form.contractorId)?.name ?? ''}
                onChange={(name) => {
                  const c = supplierContractors.find((x) => x.name === name);
                  setForm((f) => ({ ...f, contractorId: c?.id ?? '' }));
                }}
              />
            </div>
            <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={openQuickAddSupplier}>
              Новый
            </Button>
          </div>

          <Select
            label="Смета"
            placeholder="Не выбрана"
            options={estimateOptions.map((o) => o.label)}
            value={estimateOptions.find((o) => o.id === form.estimateId)?.label ?? ''}
            onChange={(label) => {
              const o = estimateOptions.find((x) => x.label === label);
              setForm((f) => ({ ...f, estimateId: o?.id ?? '', sectionId: '', sectionTitle: '' }));
            }}
          />

          {selectedEstimate && (
            <Select
              label="Раздел сметы"
              placeholder="Не выбран"
              options={selectedEstimate.sections.map((s) => s.title)}
              value={selectedSection?.title ?? ''}
              onChange={(title) => {
                const s = selectedEstimate.sections.find((x) => x.title === title);
                setForm((f) => ({ ...f, sectionId: s?.id ?? '', sectionTitle: s?.title ?? '' }));
              }}
            />
          )}

          {selectedSection && selectedSection.materials.length > 0 && (
            <div className="flex flex-col gap-2 rounded-control bg-surface-muted p-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Материалы раздела «{selectedSection.title}»
              </span>
              <div className="flex flex-col gap-1.5">
                {selectedSection.materials.map((m) => {
                  const added = form.items.some((i) => i.sourceMaterialId === m.id);
                  return (
                    <div key={m.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ink">
                        {m.name}
                        {m.unit && <span className="text-ink-faint"> · {m.quantity ?? '—'} {m.unit}</span>}
                      </span>
                      <Button type="button" variant="secondary" disabled={added} onClick={() => addMaterialToItems(m)}>
                        {added ? 'Добавлено' : 'Добавить'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <ToggleGroup
            label="Валюта"
            options={[...PURCHASE_CURRENCIES]}
            value={form.currency}
            onChange={(v) => setForm((f) => ({ ...f, currency: v as Currency }))}
          />

          <div className="flex flex-col gap-2">
            <span className="text-sm text-ink-muted">Позиции закупки</span>
            {form.items.length > 0 && (
              <div className="overflow-x-auto rounded-control border border-border">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-surface-muted text-left text-xs font-medium uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2">Название</th>
                      <th className="px-3 py-2 text-right">Кол-во</th>
                      <th className="px-3 py-2 text-right">Цена</th>
                      <th className="px-3 py-2 text-right">Сумма</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item) => (
                      <tr key={item.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 text-ink">
                          {item.name}
                          {item.unit && <span className="text-ink-faint"> ({item.unit})</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            value={item.quantity ?? ''}
                            onChange={(e) => updateItem(item.id, { quantity: e.target.value === '' ? null : Number(e.target.value) })}
                            className="w-20 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            value={item.price ?? ''}
                            onChange={(e) => updateItem(item.id, { price: e.target.value === '' ? null : Number(e.target.value) })}
                            className="w-24 rounded-control border border-border bg-surface px-2 py-1 text-right text-sm outline-none focus:border-primary"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-ink">
                          {formatMoney(purchaseItemTotal(item))} {currencySymbols[form.currency]}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            aria-label="Удалить позицию"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end px-3 py-2 text-sm font-semibold text-ink">
                  Итого: {formatMoney(purchaseTotal({ items: form.items }))} {currencySymbols[form.currency]}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                placeholder="Добавить позицию вручную"
                value={manualItemName}
                onChange={(e) => setManualItemName(e.target.value)}
              />
              <Button type="button" variant="secondary" onClick={addManualItem} disabled={!manualItemName.trim()}>
                Добавить
              </Button>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={handleSave} disabled={!form.title.trim() || saving}>
              {saving ? 'Сохраняем...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={quickAddOpen} onClose={() => setQuickAddOpen(false)} title="Новый поставщик">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-faint">
            Минимум для старта — имя и email, чтобы сразу отправить письмо. Остальное можно дозаполнить на вкладке «Каталог».
          </p>
          <Input label="Название" placeholder="Компания или имя" value={quickAddName} onChange={(e) => setQuickAddName(e.target.value)} required autoFocus />
          <Input label="Email" placeholder="mail@example.com" type="email" value={quickAddEmail} onChange={(e) => setQuickAddEmail(e.target.value)} />
          {quickAddError && <p className="text-sm text-danger">{quickAddError}</p>}
          <div className="mt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setQuickAddOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={handleQuickAddSupplier} disabled={!quickAddName.trim() || quickAddSaving}>
              {quickAddSaving ? 'Добавляем...' : 'Добавить'}
            </Button>
          </div>
        </div>
      </Modal>

      {detailPurchase && (
        <PurchaseDetailModal
          purchase={detailPurchase}
          supplier={detailPurchase.contractorId ? (contractorById.get(detailPurchase.contractorId) ?? null) : null}
          onClose={() => setDetailId(null)}
        />
      )}
    </>
  );
}

function PurchaseDetailModal({
  purchase,
  supplier,
  onClose,
}: {
  purchase: Purchase;
  supplier: Contractor | null;
  onClose: () => void;
}) {
  const [emails, setEmails] = useState<PurchaseEmail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState(`Закупка: ${purchase.title}`);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    fetchPurchaseEmails(purchase.id)
      .then(setEmails)
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить переписку')));
  }, [purchase.id]);

  async function handleSend() {
    if (!supplier?.email || !body.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const email = await sendPurchaseEmail({ purchaseId: purchase.id, toAddress: supplier.email, subject, body });
      setEmails((prev) => [...(prev ?? []), email]);
      setBody('');
    } catch (err) {
      setSendError(errorMessage(err, 'Не удалось отправить письмо'));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={purchase.title}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm text-ink-muted">
          <span>Поставщик: {supplier ? `${supplier.name}${supplier.email ? ` · ${supplier.email}` : ''}` : 'не выбран'}</span>
          <span>Адрес для переписки: {purchaseEmailAddress(purchase.shortCode)}</span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold text-ink">Переписка</span>
          {emails === null && !loadError && (
            <div className="flex items-center gap-2 text-sm text-ink-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка...
            </div>
          )}
          {loadError && <p className="text-sm text-danger">{loadError}</p>}
          {emails && emails.length === 0 && <p className="text-sm text-ink-faint">Писем пока нет.</p>}
          {emails && emails.length > 0 && (
            <div className="flex flex-col gap-2">
              {emails.map((e) => (
                <div
                  key={e.id}
                  className={cn(
                    'flex flex-col gap-1 rounded-control p-3 text-sm',
                    e.direction === 'out' ? 'ml-6 bg-primary-soft' : 'mr-6 bg-surface-muted',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {e.direction === 'out' ? 'Отправлено' : 'Получено'}
                    </span>
                    <span>{new Date(e.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                  {e.subject && <div className="font-semibold text-ink">{e.subject}</div>}
                  <div className="whitespace-pre-wrap text-ink">{e.body}</div>
                  {e.files.length > 0 && (
                    <div className="mt-1 flex flex-col gap-1">
                      {e.files.map((f, i) => (
                        <a
                          key={i}
                          href={f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-control border border-border bg-surface px-2.5 py-1.5 text-xs text-primary-hover hover:underline"
                        >
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                          <span className="min-w-0 flex-1 truncate">{f.fileName}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!supplier?.email ? (
          <p className="text-sm text-ink-faint">У поставщика не указан email — добавьте его в карточке подрядчика, чтобы писать отсюда.</p>
        ) : (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Input label="Тема" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea label="Сообщение" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
            {sendError && <p className="text-sm text-danger">{sendError}</p>}
            <Button
              type="button"
              icon={<Send className="h-4 w-4" />}
              className="w-fit self-end"
              onClick={handleSend}
              disabled={!body.trim() || sending}
            >
              {sending ? 'Отправляем...' : 'Отправить'}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
