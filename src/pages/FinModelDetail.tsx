import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, Plus, X, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import {
  LEASING_CURRENCY_SYMBOLS,
  type FinCapexReserve,
  type FinCategory,
  type FinEntry,
  type FinModel,
  type FinRent,
  type FinSale,
  type FinSchedule,
  type LeasingCurrency,
} from '../data/finModels';
import type { RealtyObject } from '../data/objects';
import { fetchFinModel, updateFinModel } from '../lib/finModelsApi';
import { fetchObject } from '../lib/objectsApi';
import { calculateFinModel, saleAmountByn, saleNetByn } from '../lib/finModelCalc';
import { Byn, formatNum } from '../lib/finModelFormat';
import { cn } from '../lib/cn';

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

// '' <-> null для числовых полей: пустая строка в инпуте = "не заполнено",
// не ноль (см. "числовые ловушки" в CLAUDE.md).
function numOrNull(v: string): number | null {
  return v === '' ? null : Number(v);
}

// Сроки кредита/лизинга хранятся в месяцах (весь остальной расчёт —
// помесячная сетка), но на глаз удобнее прикидывать в годах — поле только
// в интерфейсе, конвертация туда-обратно при отображении/вводе.
function monthsToYearsStr(months: number | null | undefined): string {
  return months == null ? '' : String(months / 12);
}
function yearsStrToMonths(v: string): number | null {
  if (v === '') return null;
  const years = Number(v);
  return Number.isFinite(years) ? Math.round(years * 12) : null;
}

const SCHEDULE_LABELS: Record<FinSchedule['type'], string> = {
  monthly: 'Ежемесячно',
  once: 'Разово',
  yearly: 'Ежегодно',
};

// Страница = загрузка/сохранение, вся вёрстка и правки — в FinModelEditor
// (он же используется мок-тестами без базы).
export function FinModelDetail() {
  const { id } = useParams();
  const [model, setModel] = useState<FinModel | null>(null);
  const [object, setObject] = useState<RealtyObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Снимок последнего сохранённого состояния — для индикатора "есть
  // несохранённые правки" (сравнение по JSON, модель небольшая).
  const savedRef = useRef<string>('');

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    fetchFinModel(id)
      .then((m) => {
        setModel(m);
        savedRef.current = JSON.stringify(m);
        return fetchObject(m.objectId).then(setObject).catch(() => {});
      })
      .catch((err) => setLoadError(errorMessage(err, 'Не удалось загрузить финмодель')))
      .finally(() => setLoading(false));
  }, [id]);

  const dirty = model != null && JSON.stringify(model) !== savedRef.current;

  async function handleSave() {
    if (!model || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateFinModel(model.id, {
        name: model.name.trim() || 'Без названия',
        params: model.params,
        leasing: model.leasing,
        rent: model.rent,
        amortization: model.amortization,
        capexReserve: model.capexReserve,
        sales: model.sales,
        categories: model.categories,
      });
      setModel(updated);
      savedRef.current = JSON.stringify(updated);
    } catch (err) {
      setSaveError(errorMessage(err, 'Не удалось сохранить финмодель'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Финмодель"
        action={
          <Button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            {saving ? 'Сохраняем...' : dirty ? 'Сохранить' : 'Сохранено'}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/admin/finmodels" className="inline-flex w-fit items-center gap-2 text-sm font-medium text-ink hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          Все финмодели
        </Link>
        {id && (
          <Link
            to={`/admin/finmodels/${id}/report`}
            className="inline-flex w-fit items-center gap-2 text-sm font-medium text-primary-hover hover:underline"
          >
            Открыть финмодель (P&L)
            <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {saveError && <p className="text-sm text-danger">{saveError}</p>}

      {loading && (
        <Card className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаем финмодель...
        </Card>
      )}
      {!loading && loadError && <Card className="py-10 text-center text-sm text-danger">{loadError}</Card>}

      {!loading && !loadError && model && <FinModelEditor model={model} object={object} onChange={setModel} />}
    </>
  );
}

export function FinModelEditor({
  model,
  object,
  onChange,
}: {
  model: FinModel;
  object: RealtyObject | null;
  onChange: (m: FinModel) => void;
}) {
  const result = useMemo(() => calculateFinModel(model), [model]);

  function patchModel(patch: Partial<FinModel>) {
    onChange({ ...model, ...patch });
  }

  function patchCategory(categoryId: string, patch: Partial<FinCategory>) {
    onChange({ ...model, categories: model.categories.map((c) => (c.id === categoryId ? { ...c, ...patch } : c)) });
  }

  function addCategory(kind: FinCategory['kind']) {
    onChange({
      ...model,
      categories: [
        ...model.categories,
        {
          id: crypto.randomUUID(),
          title: kind === 'income' ? 'Новая категория доходов' : 'Новая категория расходов',
          kind,
          entries: [],
        },
      ],
    });
  }

  function removeCategory(categoryId: string) {
    if (!window.confirm('Удалить категорию со всеми статьями?')) return;
    onChange({ ...model, categories: model.categories.filter((c) => c.id !== categoryId) });
  }

  function addEntry(categoryId: string) {
    onChange({
      ...model,
      categories: model.categories.map((c) =>
        c.id === categoryId
          ? {
              ...c,
              entries: [
                ...c.entries,
                {
                  id: crypto.randomUUID(),
                  label: '',
                  amount: null,
                  schedule: { type: 'monthly', fromMonth: 1, toMonth: null },
                  deductible: c.kind === 'expense',
                  reimbursable: false,
                  vatIncluded: false,
                  vatPct: null,
                },
              ],
            }
          : c,
      ),
    });
  }

  function patchEntry(categoryId: string, entryId: string, patch: Partial<FinEntry>) {
    onChange({
      ...model,
      categories: model.categories.map((c) =>
        c.id === categoryId ? { ...c, entries: c.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)) } : c,
      ),
    });
  }

  function removeEntry(categoryId: string, entryId: string) {
    onChange({
      ...model,
      categories: model.categories.map((c) =>
        c.id === categoryId ? { ...c, entries: c.entries.filter((e) => e.id !== entryId) } : c,
      ),
    });
  }

  const incomeCategories = model.categories.filter((c) => c.kind === 'income');
  const expenseCategories = model.categories.filter((c) => c.kind === 'expense');

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs uppercase tracking-wide text-ink-faint">Объект</span>
          <span className="text-sm font-semibold text-ink">
            {object ? (object.name ? `${object.name} — ${object.address}` : object.address) : '...'}
          </span>
        </div>
        <Input label="Название сценария" value={model.name} onChange={(e) => patchModel({ name: e.target.value })} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="Старт (месяц 1)"
            type="month"
            value={model.params.startDate}
            onChange={(e) => patchModel({ params: { ...model.params, startDate: e.target.value } })}
          />
          <Input
            label="Горизонт, мес."
            type="number"
            value={model.params.horizonMonths}
            onChange={(e) => patchModel({ params: { ...model.params, horizonMonths: Number(e.target.value) || 60 } })}
          />
          <Input
            label="Налог от оборота, %"
            type="number"
            value={model.params.taxRevenuePct}
            onChange={(e) => patchModel({ params: { ...model.params, taxRevenuePct: Number(e.target.value) || 0 } })}
          />
          <Input
            label="Подоходный налог от прибыли, %"
            type="number"
            value={model.params.taxProfitPct}
            onChange={(e) => patchModel({ params: { ...model.params, taxProfitPct: Number(e.target.value) || 0 } })}
          />
          <Input
            label="Инфляция расходов, %/год"
            type="number"
            title="Ежегодный рост регулярных статей расходов из категорий (не разовых, не лизинга/амортизации/резерва — у них своя динамика)"
            value={model.params.expenseInflationPct ?? ''}
            onChange={(e) => patchModel({ params: { ...model.params, expenseInflationPct: numOrNull(e.target.value) } })}
          />
        </div>
        <p className="text-xs text-ink-faint">
          Все суммы в BYN. Налог на каждый год считается в обоих режимах, в итог идёт меньший. Лимит выручки ИП —{' '}
          <Byn value={model.params.revenueLimitByn} /> в календарный год, превышение подсвечивается на странице финмодели.
        </p>
      </Card>

      <LeasingCard model={model} result={result} patchModel={patchModel} />

      <div className="flex flex-col gap-3">
        <div className="text-lg font-bold text-ink">Доходы</div>
        <RentCard model={model} patchModel={patchModel} />
        <SalesCard model={model} patchModel={patchModel} />
        {incomeCategories.map((c) => (
          <CategoryCard
            key={c.id}
            category={c}
            onPatchCategory={(patch) => patchCategory(c.id, patch)}
            onRemoveCategory={() => removeCategory(c.id)}
            onAddEntry={() => addEntry(c.id)}
            onPatchEntry={(entryId, patch) => patchEntry(c.id, entryId, patch)}
            onRemoveEntry={(entryId) => removeEntry(c.id, entryId)}
          />
        ))}
        <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={() => addCategory('income')}>
          Добавить категорию
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="text-lg font-bold text-ink">Расходы</div>
        {expenseCategories.map((c) => (
          <Fragment key={c.id}>
            <CategoryCard
              category={c}
              onPatchCategory={(patch) => patchCategory(c.id, patch)}
              onRemoveCategory={() => removeCategory(c.id)}
              onAddEntry={() => addEntry(c.id)}
              onPatchEntry={(entryId, patch) => patchEntry(c.id, entryId, patch)}
              onRemoveEntry={(entryId) => removeEntry(c.id, entryId)}
            />
            {c.title.toLowerCase().includes('эксплуатац') && (
              <>
                <AmortizationOnHoldCard />
                <CapexReserveCard model={model} patchModel={patchModel} result={result} />
              </>
            )}
          </Fragment>
        ))}
        {!expenseCategories.some((c) => c.title.toLowerCase().includes('эксплуатац')) && (
          <>
            <AmortizationOnHoldCard />
            <CapexReserveCard model={model} patchModel={patchModel} result={result} />
          </>
        )}
        <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={() => addCategory('expense')}>
          Добавить категорию
        </Button>
      </div>
    </div>
  );
}

function RentCard({ model, patchModel }: { model: FinModel; patchModel: (patch: Partial<FinModel>) => void }) {
  const rent = model.rent;
  function patchRent(patch: Partial<FinRent>) {
    patchModel({ rent: { ...rent, ...patch } });
  }

  const preMonthly = (rent.pricePreMeter ?? 0) * (rent.areaPreMeters ?? 0);
  const postCabinets = (rent.pricePostMeter ?? 0) * (rent.areaPostMeters ?? 0);
  const postWorkstations = (rent.workstationPrice ?? 0) * (rent.workstationCount ?? 0);
  const downtime = Math.max(0, Math.floor(rent.renovationMonths ?? 0) || 0);
  const postStartMonth = rent.renovationStartMonth != null ? rent.renovationStartMonth + downtime : null;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="text-lg font-bold text-ink">Аренда</div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink">До реновации</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input
            label="Площадь, м²"
            type="number"
            value={rent.areaPreMeters ?? ''}
            onChange={(e) => patchRent({ areaPreMeters: numOrNull(e.target.value) })}
          />
          <Input
            label="Цена за м², Br"
            type="number"
            value={rent.pricePreMeter ?? ''}
            onChange={(e) => patchRent({ pricePreMeter: numOrNull(e.target.value) })}
          />
        </div>
        <span className="text-sm text-ink-muted">
          Аренда сейчас: <span className="font-semibold text-ink">{formatNum(preMonthly)} Br/мес</span>
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-semibold text-ink">Реновация (простой)</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input
            label="Месяц начала простоя"
            type="number"
            title="Номер месяца модели, с которого аренда прекращается на время реновации (1 = месяц старта)"
            value={rent.renovationStartMonth ?? ''}
            onChange={(e) => patchRent({ renovationStartMonth: numOrNull(e.target.value) })}
          />
          <Input
            label="Простой, мес."
            type="number"
            value={rent.renovationMonths ?? ''}
            onChange={(e) => patchRent({ renovationMonths: numOrNull(e.target.value) })}
          />
        </div>
        <span className="text-sm text-ink-muted">
          {rent.renovationStartMonth == null ? (
            'Месяц начала не указан — вся модель считается по цене "до реновации"'
          ) : (
            <>
              Простой: месяцы {rent.renovationStartMonth}–{postStartMonth != null ? postStartMonth - 1 : '?'} (доход 0),
              новая цена — с месяца {postStartMonth}
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-semibold text-ink">После реновации</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input
            label="Площадь, м² (кабинеты)"
            type="number"
            value={rent.areaPostMeters ?? ''}
            onChange={(e) => patchRent({ areaPostMeters: numOrNull(e.target.value) })}
          />
          <Input
            label="Цена за м², Br"
            type="number"
            value={rent.pricePostMeter ?? ''}
            onChange={(e) => patchRent({ pricePostMeter: numOrNull(e.target.value) })}
          />
          <Input
            label="Рабочих мест, шт"
            type="number"
            value={rent.workstationCount ?? ''}
            onChange={(e) => patchRent({ workstationCount: numOrNull(e.target.value) })}
          />
          <Input
            label="Цена за место, Br"
            type="number"
            value={rent.workstationPrice ?? ''}
            onChange={(e) => patchRent({ workstationPrice: numOrNull(e.target.value) })}
          />
        </div>
        <span className="text-sm text-ink-muted">
          Аренда после реновации:{' '}
          <span className="font-semibold text-ink">{formatNum(postCabinets + postWorkstations)} Br/мес</span>{' '}
          (кабинеты {formatNum(postCabinets)} + места {formatNum(postWorkstations)})
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-semibold text-ink">Вакансия, рост, выход на заполняемость</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Input
            label="Вакансия / недосбор, %"
            type="number"
            title="Процент от потенциальной аренды, который никогда не собирается (простой между арендаторами и т.п.)"
            value={rent.vacancyPct ?? ''}
            onChange={(e) => patchRent({ vacancyPct: numOrNull(e.target.value) })}
          />
          <Input
            label="Рост ставки, %/год"
            type="number"
            title="Ежегодная индексация арендной ставки, сложным процентом от даты старта модели"
            value={rent.annualGrowthPct ?? ''}
            onChange={(e) => patchRent({ annualGrowthPct: numOrNull(e.target.value) })}
          />
          <Input
            label="Выход на заполняемость, мес."
            type="number"
            placeholder="скачком"
            title="Сколько месяцев после конца простоя занятость линейно растёт от 0 до 100% вместо мгновенного скачка"
            value={rent.stabilizationMonths ?? ''}
            onChange={(e) => patchRent({ stabilizationMonths: numOrNull(e.target.value) })}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-semibold text-ink">НДС</span>
        <div className="flex flex-wrap items-center gap-3">
          <label
            className={cn(
              'flex items-center gap-1.5 text-sm font-medium',
              rent.vatIncluded ? 'text-primary' : 'text-ink-muted',
            )}
            title="Цена за м² указана с НДС — в кассе остаётся полная сумма, а в налоговую базу ИП идёт сумма без НДС"
          >
            <input
              type="checkbox"
              checked={rent.vatIncluded}
              onChange={(e) => patchRent({ vatIncluded: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Аренда с НДС
          </label>
          {rent.vatIncluded && (
            <div className="w-32">
              <Input
                type="number"
                placeholder="Ставка, %"
                value={rent.vatPct ?? ''}
                onChange={(e) => patchRent({ vatPct: numOrNull(e.target.value) })}
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function SalesCard({ model, patchModel }: { model: FinModel; patchModel: (patch: Partial<FinModel>) => void }) {
  const sales = model.sales;

  function patchSale(id: string, patch: Partial<FinSale>) {
    patchModel({ sales: sales.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  function addSale() {
    patchModel({
      sales: [
        ...sales,
        {
          id: crypto.randomUUID(),
          label: '',
          saleDate: '',
          areaMeters: null,
          pricePerMeterUsd: null,
          exchangeRate: null,
          applyToLeasing: false,
          transactionCost: null,
        },
      ],
    });
  }
  function removeSale(id: string) {
    patchModel({ sales: sales.filter((s) => s.id !== id) });
  }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="text-lg font-bold text-ink">Продажа кабинетов</div>
      <div className="flex flex-col gap-3">
        {sales.map((s) => {
          const amountByn = saleAmountByn(s);
          const netByn = saleNetByn(s);
          const rateMissing = (s.areaMeters ?? 0) > 0 && (s.pricePerMeterUsd ?? 0) > 0 && !(s.exchangeRate ?? 0);
          return (
            <div key={s.id} className="flex flex-col gap-2 rounded-control border border-border p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    placeholder="Название продажи"
                    value={s.label}
                    onChange={(e) => patchSale(s.id, { label: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeSale(s.id)}
                  aria-label="Удалить продажу"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Input
                  label="Дата продажи"
                  type="month"
                  value={s.saleDate}
                  onChange={(e) => patchSale(s.id, { saleDate: e.target.value })}
                />
                <Input
                  label="Площадь, м²"
                  type="number"
                  value={s.areaMeters ?? ''}
                  onChange={(e) => patchSale(s.id, { areaMeters: numOrNull(e.target.value) })}
                />
                <Input
                  label="Цена за м², $"
                  type="number"
                  value={s.pricePerMeterUsd ?? ''}
                  onChange={(e) => patchSale(s.id, { pricePerMeterUsd: numOrNull(e.target.value) })}
                />
                <Input
                  label="Курс BYN за $"
                  type="number"
                  step="0.0001"
                  value={s.exchangeRate ?? ''}
                  onChange={(e) => patchSale(s.id, { exchangeRate: numOrNull(e.target.value) })}
                />
                <Input
                  label="Расходы на сделку, Br"
                  type="number"
                  title="Разовая сумма (не процент) — риелтор, оформление, налоги при продаже. У крупной и мелкой сделки это разные по характеру издержки"
                  value={s.transactionCost ?? ''}
                  onChange={(e) => patchSale(s.id, { transactionCost: numOrNull(e.target.value) })}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    s.applyToLeasing ? 'text-primary' : 'text-ink-muted',
                  )}
                  title="Сумма продажи за вычетом расходов на сделку уходит на досрочное частичное погашение остатка долга по лизингу в месяце продажи — срок лизинга не меняется, платёж на оставшийся срок пересчитывается и становится меньше"
                >
                  <input
                    type="checkbox"
                    checked={s.applyToLeasing}
                    onChange={(e) => patchSale(s.id, { applyToLeasing: e.target.checked })}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  на погашение лизинга
                </label>
                <span className="text-sm text-ink-muted">
                  {amountByn > 0 ? (
                    <>
                      {formatNum(amountByn)} Br
                      {(s.transactionCost ?? 0) > 0 && (
                        <>
                          {' − '}
                          {formatNum(s.transactionCost ?? 0)} Br ={' '}
                          <span className="font-semibold text-ink">{formatNum(netByn)} Br</span>
                        </>
                      )}
                      {!(s.transactionCost ?? 0) && (
                        <>
                          {' = '}
                          <span className="font-semibold text-ink">{formatNum(netByn)} Br</span>
                        </>
                      )}
                    </>
                  ) : rateMissing ? (
                    <span className="font-medium text-warning">укажите курс</span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {sales.length === 0 && <p className="text-sm text-ink-faint">Продаж пока нет</p>}
      </div>
      <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={addSale}>
        Добавить продажу
      </Button>
    </Card>
  );
}

function LeasingCard({
  model,
  result,
  patchModel,
}: {
  model: FinModel;
  result: ReturnType<typeof calculateFinModel>;
  patchModel: (patch: Partial<FinModel>) => void;
}) {
  const sym = LEASING_CURRENCY_SYMBOLS[model.leasing.currency];
  const isByn = model.leasing.currency === 'BYN';
  const payment = result.monthlyLeasingPayment;
  const paymentByn =
    payment != null && !result.leasingRateMissing ? payment * (isByn ? 1 : (model.leasing.exchangeRate ?? 0)) : null;
  const hasPrepayments = model.sales.some((s) => s.applyToLeasing);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="text-lg font-bold text-ink">Лизинг / Кредит</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Input
          label={`Сумма договора, ${sym}`}
          type="number"
          value={model.leasing.contractSum ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, contractSum: numOrNull(e.target.value) } })}
        />
        <Input
          label={`Аванс, ${sym}`}
          type="number"
          value={model.leasing.downPayment ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, downPayment: numOrNull(e.target.value) } })}
        />
        <Input
          label="Срок погашения, лет"
          type="number"
          step="0.5"
          title="Срок, на который считается размер платежа (аннуитет) — раньше назывался «срок амортизации», переименовано, чтобы не путать с налоговой амортизацией ИП (см. блок ниже)"
          value={monthsToYearsStr(model.leasing.amortizationMonths)}
          onChange={(e) =>
            patchModel({ leasing: { ...model.leasing, amortizationMonths: yearsStrToMonths(e.target.value) } })
          }
        />
        <Input
          label="Только проценты, лет"
          type="number"
          step="0.5"
          placeholder="нет льготного периода"
          title="Срок в начале графика, когда платится только процент, тело долга не гасится — считается внутри срока погашения, не сверх него"
          value={monthsToYearsStr(model.leasing.interestOnlyMonths)}
          onChange={(e) =>
            patchModel({ leasing: { ...model.leasing, interestOnlyMonths: yearsStrToMonths(e.target.value) } })
          }
        />
        <Input
          label="Ставка 1-й год, %/год"
          type="number"
          value={model.leasing.ratePctYear1 ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, ratePctYear1: numOrNull(e.target.value) } })}
        />
        <Input
          label="Ставка 2-й год, %/год"
          type="number"
          placeholder="как 1-й год"
          value={model.leasing.ratePctYear2 ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, ratePctYear2: numOrNull(e.target.value) } })}
        />
        <Input
          label="Ставка с 3-го года, %/год"
          type="number"
          placeholder="как 2-й год"
          value={model.leasing.ratePctFromYear3 ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, ratePctFromYear3: numOrNull(e.target.value) } })}
        />
        <Input
          label="Комиссия за оформление, %"
          type="number"
          title="Разовая комиссия за оформление, % от суммы договора — списывается в месяце 1, вместе с авансом"
          value={model.leasing.originationFeePct ?? ''}
          onChange={(e) => patchModel({ leasing: { ...model.leasing, originationFeePct: numOrNull(e.target.value) } })}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-ink-muted">Валюта договора</span>
          <select
            value={model.leasing.currency}
            onChange={(e) => patchModel({ leasing: { ...model.leasing, currency: e.target.value as LeasingCurrency } })}
            className="rounded-control border border-transparent bg-surface-muted px-4 py-3 text-base text-ink outline-none focus:border-primary sm:text-sm"
          >
            <option value="USD">Доллар ($)</option>
            <option value="EUR">Евро (€)</option>
            <option value="BYN">Бел. рубль</option>
          </select>
        </label>
        {!isByn && (
          <Input
            label={`Курс BYN за 1 ${sym}`}
            type="number"
            step="0.0001"
            value={model.leasing.exchangeRate ?? ''}
            onChange={(e) => patchModel({ leasing: { ...model.leasing, exchangeRate: numOrNull(e.target.value) } })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={model.leasing.deductible}
            onChange={(e) => patchModel({ leasing: { ...model.leasing, deductible: e.target.checked } })}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          Зачитывать платежи как расходы ИП
        </label>
        <span className="text-sm text-ink-muted">
          Первый платёж:{' '}
          {payment == null ? (
            <span className="font-semibold text-ink">— заполните сумму и срок</span>
          ) : (
            <span className="font-semibold text-ink">
              {formatNum(payment)} {sym}/мес
              {paymentByn != null && !isByn && (
                <span className="text-ink-muted">
                  {' '}
                  ≈ <Byn value={paymentByn} />
                  /мес
                </span>
              )}
            </span>
          )}
        </span>
      </div>
      {result.leasingRateMissing && (
        <p className="text-sm font-medium text-warning">
          Укажите курс — без него лизинг не попадает в расчёт (пересчитывать {sym} в BYN 1:1 было бы обманом модели).
        </p>
      )}
      {hasPrepayments && (
        <p className="text-xs text-ink-faint">
          Есть продажи "на погашение лизинга" — после каждой из них платёж на оставшийся срок пересчитывается и
          уменьшается (срок не меняется). Актуальные суммы по месяцам — в таблице ниже, колонка "в т.ч. лизинг".
        </p>
      )}
    </Card>
  );
}

// Была редактируемой карточкой (сумма/месяц начала/срок) — временно
// закомментирована и заменена на заглушку-подсказку: сам механизм
// налоговой амортизации ИП под вопросом до уточнения с Татьяной Гаврис,
// а видеть реальные платежи по кредиту/лизингу нужно уже сейчас, без
// влияния неподтверждённой цифры на налоговый расчёт (см. calculateFinModel
// в finModelCalc.ts, где вклад амортизации принудительно зануляется).
// Ранее введённые model.amortization не удалены, просто не показываются
// и не редактируются — вернуть карточку можно из истории git.
function AmortizationOnHoldCard() {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="text-lg font-bold text-ink-faint">Амортизация — на паузе</div>
      <p className="text-sm text-ink-muted">
        Временно не учитывается в расчёте — механизм (что именно и как амортизировать ИП) требует уточнения у
        Татьяны Гаврис (налоговый консультант). Ранее введённые данные не потеряны, просто не влияют на цифры, пока
        не проверим механизм.
      </p>
    </Card>
  );
}

function CapexReserveCard({
  model,
  patchModel,
  result,
}: {
  model: FinModel;
  patchModel: (patch: Partial<FinModel>) => void;
  result: ReturnType<typeof calculateFinModel>;
}) {
  const capexReserve = model.capexReserve;
  function patchCapexReserve(patch: Partial<FinCapexReserve>) {
    patchModel({ capexReserve: { ...capexReserve, ...patch } });
  }
  const currentMonthly = result.months[0]?.capexReserve ?? 0;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="text-lg font-bold text-ink">Резерв на капремонт</div>
      <p className="text-xs text-ink-faint">
        % от арендного дохода месяца, откладывается автоматически на будущий капремонт — реальная касса, в отличие
        от амортизации.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Input
          label="% от аренды"
          type="number"
          value={capexReserve.pct ?? ''}
          onChange={(e) => patchCapexReserve({ pct: numOrNull(e.target.value) })}
        />
        <label
          className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-ink"
          title="Зачитывается как расход ИП — уменьшает налоговую базу в режиме 'от прибыли'"
        >
          <input
            type="checkbox"
            checked={capexReserve.deductible}
            onChange={(e) => patchCapexReserve({ deductible: e.target.checked })}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          расход ИП
        </label>
      </div>
      {(capexReserve.pct ?? 0) > 0 && (
        <span className="text-sm text-ink-muted">
          В месяце 1: <span className="font-semibold text-ink">{formatNum(currentMonthly)} Br</span> — дальше
          меняется вместе с арендой (0 во время простоя на реновацию)
        </span>
      )}
    </Card>
  );
}

// Одна карточка категории (статьи + добавление/удаление) — переиспользуется
// и в Доходах (рядом с Арендой/Продажей), и в Расходах (рядом с
// Амортизацией/Резервом), поэтому вынесена отдельно от общего списка
// категорий: секции "Доходы"/"Расходы" теперь собирают вёрстку сами,
// с калькуляторами вперемешку с категориями.
function CategoryCard({
  category,
  onPatchCategory,
  onRemoveCategory,
  onAddEntry,
  onPatchEntry,
  onRemoveEntry,
}: {
  category: FinCategory;
  onPatchCategory: (patch: Partial<FinCategory>) => void;
  onRemoveCategory: () => void;
  onAddEntry: () => void;
  onPatchEntry: (entryId: string, patch: Partial<FinEntry>) => void;
  onRemoveEntry: (entryId: string) => void;
}) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input value={category.title} onChange={(e) => onPatchCategory({ title: e.target.value })} />
        </div>
        <button
          type="button"
          onClick={onRemoveCategory}
          aria-label="Удалить категорию"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {category.entries.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            kind={category.kind}
            onPatch={(patch) => onPatchEntry(e.id, patch)}
            onRemove={() => onRemoveEntry(e.id)}
          />
        ))}
        {category.entries.length === 0 && <p className="text-sm text-ink-faint">Статей пока нет</p>}
      </div>

      <Button type="button" variant="secondary" icon={<Plus className="h-4 w-4" />} className="w-fit" onClick={onAddEntry}>
        Добавить статью
      </Button>
    </Card>
  );
}

function EntryRow({
  entry,
  kind,
  onPatch,
  onRemove,
}: {
  entry: FinEntry;
  kind: FinCategory['kind'];
  onPatch: (patch: Partial<FinEntry>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-control border border-border p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input placeholder="Название статьи" value={entry.label} onChange={(e) => onPatch({ label: e.target.value })} />
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Удалить статью"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-32 shrink-0">
          <Input
            type="number"
            placeholder="Сумма, Br"
            value={entry.amount ?? ''}
            onChange={(e) => onPatch({ amount: e.target.value === '' ? null : Number(e.target.value) })}
          />
        </div>
        <select
          value={entry.schedule.type}
          onChange={(e) => onPatch({ schedule: { ...entry.schedule, type: e.target.value as FinSchedule['type'] } })}
          className="rounded-control border border-transparent bg-surface-muted px-3 py-3 text-base text-ink outline-none focus:border-primary sm:text-sm"
        >
          {(Object.keys(SCHEDULE_LABELS) as FinSchedule['type'][]).map((t) => (
            <option key={t} value={t}>
              {SCHEDULE_LABELS[t]}
            </option>
          ))}
        </select>
        <div className="w-24 shrink-0">
          <Input
            type="number"
            placeholder="с мес."
            title="Номер месяца модели, с которого действует статья (1 = месяц старта)"
            value={entry.schedule.fromMonth || ''}
            onChange={(e) => onPatch({ schedule: { ...entry.schedule, fromMonth: Number(e.target.value) || 1 } })}
          />
        </div>
        {entry.schedule.type !== 'once' && (
          <div className="w-24 shrink-0">
            <Input
              type="number"
              placeholder="по мес."
              title="Последний месяц действия (пусто — до конца горизонта)"
              value={entry.schedule.toMonth ?? ''}
              onChange={(e) => onPatch({ schedule: { ...entry.schedule, toMonth: e.target.value === '' ? null : Number(e.target.value) } })}
            />
          </div>
        )}
        {kind === 'expense' && (
          <>
            <label
              className="flex items-center gap-1.5 text-xs font-medium text-ink-muted"
              title="Зачитывается как расход ИП — уменьшает налоговую базу в режиме 'от прибыли'"
            >
              <input
                type="checkbox"
                checked={entry.deductible}
                onChange={(e) => onPatch({ deductible: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              расход ИП
            </label>
            <label
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                entry.reimbursable ? 'text-primary' : 'text-ink-muted',
              )}
              title="Перекладывается на арендаторов (компенсация сверх аренды) — сумма остаётся в расходах, но не режет чистую прибыль"
            >
              <input
                type="checkbox"
                checked={entry.reimbursable}
                onChange={(e) => onPatch({ reimbursable: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              на арендаторов
            </label>
            <label
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                entry.vatIncluded ? 'text-primary' : 'text-ink-muted',
              )}
              title="Сумма указана с НДС — в кассе остаётся полная сумма, а в вычитаемый расход ИП идёт сумма без НДС"
            >
              <input
                type="checkbox"
                checked={entry.vatIncluded}
                onChange={(e) => onPatch({ vatIncluded: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              с НДС
            </label>
            {entry.vatIncluded && (
              <div className="w-20 shrink-0">
                <Input
                  type="number"
                  placeholder="Ставка, %"
                  value={entry.vatPct ?? ''}
                  onChange={(e) => onPatch({ vatPct: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

