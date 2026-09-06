import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { glassCardClass, glassCardShadow } from '../../lib/glass';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Select } from '../ui/Select';
import { AddableSelect } from '../ui/AddableSelect';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import {
  fetchBusinessCenters,
  insertBusinessCenter,
  updateBusinessCenter,
  deleteBusinessCenter,
} from '../../lib/businessCentersApi';
import { uploadObjectDocument } from '../../lib/objectsApi';
import { BUSINESS_CENTER_CLASSES } from '../../data/businessCenters';
import type { BusinessCenter, HighlightIconKey, HighlightSection, RentalInfo, TenantOrganization } from '../../data/businessCenters';
import type { DocumentFile } from '../../data/contractorDocuments';

// Подписи выбора иконки в форме — порядок совпадает с частотой использования
// на практике (история/арендаторы/СМИ чаще всего, 'warning'/'fact' — реже).
const HIGHLIGHT_ICON_LABELS: Record<HighlightIconKey, string> = {
  history: 'История объекта',
  tenants: 'Арендаторы',
  media: 'Награды / СМИ',
  rating: 'Рейтинг на картах',
  reviews: 'Отзывы',
  design: 'Архитектура / дизайн',
  eco: 'Экология',
  warning: 'Важная оговорка',
  fact: 'Другой факт',
};
const HIGHLIGHT_ICON_KEYS = Object.keys(HIGHLIGHT_ICON_LABELS) as HighlightIconKey[];

// Вкладка "Бизнес-центры" на /admin/market-offers — админка для публичной
// страницы /minsk/bcminsk (владелец, 2026-09-04: "пусть это будет админка
// этой страницы... будем упорядочивать инфу там"). Данные — таблица
// Supabase business_centers (RLS: anon select, authenticated — полный
// CRUD), та же связка data/businessCenters.ts + lib/businessCentersApi.ts,
// что читает и сама публичная страница.
const CLASS_SELECT_OPTIONS = ['Не указан', ...BUSINESS_CENTER_CLASSES];

const STATUS_LABEL: Record<BusinessCenter['status'], string> = {
  built: 'Построен',
  under_construction: 'Строится',
};

interface FormState {
  slug: string;
  name: string;
  address: string;
  district: string;
  businessClass: string; // 'Не указан' | 'A' | 'B+' | 'B' | 'C'
  totalArea: string;
  yearBuilt: string;
  floors: string;
  developer: string;
  metro: string;
  parking: string;
  website: string;
  description: string;
  rentalCaveat: string;
  rentalTerms: string;
  rentalRates: string;
  rentalSizes: string;
  rentalParking: string;
  rentalContacts: string;
  highlights: HighlightSection[]; // "Интересные факты" — произвольный набор блоков
  tenantOrganizations: TenantOrganization[]; // организации внутри здания
  tenantOrganizationsBulk: string; // черновик для вставки списком (не сохраняется как есть)
  mapSnapshotFiles: DocumentFile[]; // уже загруженные
  pendingMapSnapshotFiles: File[]; // выбраны, но ещё не загружены (грузятся при сохранении)
  photos: string; // по одному пути на строку
  status: BusinessCenter['status'];
  sortOrder: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  name: '',
  address: '',
  district: '',
  businessClass: 'Не указан',
  totalArea: '',
  yearBuilt: '',
  floors: '',
  developer: '',
  metro: '',
  parking: '',
  website: '',
  description: '',
  rentalCaveat: '',
  rentalTerms: '',
  rentalRates: '',
  rentalSizes: '',
  rentalParking: '',
  rentalContacts: '',
  highlights: [],
  tenantOrganizations: [],
  tenantOrganizationsBulk: '',
  mapSnapshotFiles: [],
  pendingMapSnapshotFiles: [],
  photos: '',
  status: 'built',
  sortOrder: '0',
};

function centerToForm(c: BusinessCenter): FormState {
  return {
    slug: c.slug,
    name: c.name,
    address: c.address,
    district: c.district ?? '',
    businessClass: c.businessClass ?? 'Не указан',
    totalArea: c.totalArea != null ? String(c.totalArea) : '',
    yearBuilt: c.yearBuilt != null ? String(c.yearBuilt) : '',
    floors: c.floors != null ? String(c.floors) : '',
    developer: c.developer ?? '',
    metro: c.metro ?? '',
    parking: c.parking ?? '',
    website: c.website ?? '',
    description: c.description ?? '',
    rentalCaveat: c.rentalInfo?.caveat ?? '',
    rentalTerms: c.rentalInfo?.terms ?? '',
    rentalRates: c.rentalInfo?.rates ?? '',
    rentalSizes: c.rentalInfo?.sizes ?? '',
    rentalParking: c.rentalInfo?.parking ?? '',
    rentalContacts: c.rentalInfo?.contacts ?? '',
    highlights: c.highlights,
    tenantOrganizations: c.tenantOrganizations,
    tenantOrganizationsBulk: '',
    mapSnapshotFiles: c.mapSnapshotFiles,
    pendingMapSnapshotFiles: [],
    photos: c.photos.join('\n'),
    status: c.status,
    sortOrder: String(c.sortOrder),
  };
}

function numOrNull(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// Пустая форма → null целиком (не объект из одних null) — карточка "Условия
// для арендаторов" на публичной странице не рендерится вовсе, когда искать
// было нечего (сайта нет и т.п.), а не показывает пустой заголовок.
function buildRentalInfo(form: FormState): RentalInfo | null {
  const caveat = form.rentalCaveat.trim() || null;
  const terms = form.rentalTerms.trim() || null;
  const rates = form.rentalRates.trim() || null;
  const sizes = form.rentalSizes.trim() || null;
  const parking = form.rentalParking.trim() || null;
  const contacts = form.rentalContacts.trim() || null;
  if (!caveat && !terms && !rates && !sizes && !parking && !contacts) return null;
  return { caveat, terms, rates, sizes, parking, contacts };
}

// Блоки с пустым текстом/подписью не сохраняем — та же логика, что раньше
// была у buildRentalInfo/buildHighlights (не хранить полупустые записи).
function buildHighlights(form: FormState): HighlightSection[] {
  return form.highlights
    .map((s) => ({ ...s, label: s.label.trim(), text: s.text.trim() }))
    .filter((s) => s.label && s.text);
}

function buildTenantOrganizations(form: FormState): TenantOrganization[] {
  return form.tenantOrganizations
    .map((o) => ({ name: o.name.trim(), category: o.category.trim() }))
    .filter((o) => o.name);
}

// Разбор вставки списком — по одной организации на строку, категория и
// название через "—"/"-"/":" (то, что реально получается копипастом из
// разобранного веб-архива, где категория идёт из aria-label ссылки, см.
// scripts/... в CLAUDE.md журнале). Без разделителя — вся строка это
// название, категория пустая (можно дозаполнить руками).
function parseTenantOrganizationsBulk(text: string): TenantOrganization[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*[—\-:]\s*(.+)$/);
      if (match) return { category: match[1].trim(), name: match[2].trim() };
      return { category: '', name: line };
    });
}

function errorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

export function BusinessCentersAdminTab() {
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);
  const [error, setError] = useState('');
  // Отдельная от списочной error — та рисуется НАД таблицей, а таблица
  // скрыта под модалкой, пока форма открыта (см. Modal ниже), поэтому
  // ошибка сохранения молча пропадала из вида: владелец жал "Сохранить" и
  // не видел вообще ничего, даже если сохранение реально падало (см. журнал
  // 2026-09-05 про не загружающиеся .webarchive — этот баг и вскрыл).
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState<BusinessCenter | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    fetchBusinessCenters()
      .then(setCenters)
      .catch(() => setError('Не удалось загрузить список — попробуйте обновить страницу.'));
  }

  const districtOptions = useMemo(
    () => Array.from(new Set((centers ?? []).map((c) => c.district).filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b, 'ru')),
    [centers],
  );

  function openEdit(c: BusinessCenter) {
    setEditing(c);
    setForm(centerToForm(c));
    setFormError('');
  }

  function openNew() {
    setEditing('new');
    setForm({ ...EMPTY_FORM, sortOrder: String((centers?.length ?? 0)) });
    setFormError('');
  }

  function closeEdit() {
    setEditing(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.slug.trim()) return;
    setSaving(true);
    setFormError('');
    try {
      let uploadedSnapshots: DocumentFile[] = [];
      try {
        uploadedSnapshots = await Promise.all(form.pendingMapSnapshotFiles.map(uploadObjectDocument));
      } catch (err) {
        // Владелец, 2026-09-05: ".webarchive не загружается, жду и ничего
        // не происходит" — реальная причина в 9 из 10 случаев это лимит
        // Supabase Storage на 50 МБ на файл (общий на весь проект, поднять
        // его без платного тарифа нельзя — проверено напрямую через
        // Management API, PATCH .../config/storage отвечает "upgrade the
        // project to a paid plan"). Полный .webarchive страницы Яндекс.Карт
        // с фото/тайлами легко превышает это — сообщаем причину явно, а не
        // просто "не удалось сохранить".
        throw new Error(
          `Не удалось загрузить файл «${form.pendingMapSnapshotFiles[0]?.name ?? ''}»: ${errorMessage(err, 'ошибка загрузки')}. ` +
            'Если файл больше 50 МБ — это лимит Supabase Storage на текущем тарифе (поднять нельзя без перехода на платный тариф). ' +
            'Попробуйте сохранить страницу компактнее (например, «Сохранить как → Веб-страница, только HTML» вместо полного Web Archive/mhtml).',
        );
      }
      const payload = {
        slug: form.slug.trim(),
        name: form.name.trim(),
        address: form.address.trim(),
        district: form.district.trim() || null,
        businessClass: (form.businessClass === 'Не указан' ? null : form.businessClass) as BusinessCenter['businessClass'],
        totalArea: numOrNull(form.totalArea),
        yearBuilt: numOrNull(form.yearBuilt),
        floors: numOrNull(form.floors),
        developer: form.developer.trim() || null,
        metro: form.metro.trim() || null,
        parking: form.parking.trim() || null,
        website: form.website.trim() || null,
        description: form.description.trim() || null,
        rentalInfo: buildRentalInfo(form),
        highlights: buildHighlights(form),
        tenantOrganizations: buildTenantOrganizations(form),
        mapSnapshotFiles: [...form.mapSnapshotFiles, ...uploadedSnapshots],
        photos: form.photos
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        status: form.status,
        sortOrder: numOrNull(form.sortOrder) ?? 0,
      };
      if (editing === 'new') {
        await insertBusinessCenter(payload);
      } else if (editing) {
        await updateBusinessCenter(editing.id, payload);
      }
      closeEdit();
      load();
    } catch (err) {
      // Реальный текст ошибки (в т.ч. сообщение про лимит файла из блока
      // выше) — не общая заглушка про slug: та маскировала настоящую
      // причину. setFormError, не setError — этот текст должен быть виден
      // ВНУТРИ ещё открытой модалки (см. комментарий у formError выше).
      setFormError(errorMessage(err, 'Не удалось сохранить — проверьте поля (slug должен быть уникальным) и попробуйте ещё раз.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c: BusinessCenter) {
    if (!confirm(`Удалить «${c.name}»? Это уберёт карточку с публичной страницы.`)) return;
    setDeletingId(c.id);
    try {
      await deleteBusinessCenter(c.id);
      load();
    } catch {
      setError('Не удалось удалить.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Список объектов на публичной странице{' '}
          <a href="/minsk/bcminsk" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            /minsk/bcminsk
          </a>
          {centers && <> · {centers.length} объектов</>}
        </p>
        <Button type="button" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
          Добавить БЦ
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {centers === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      ) : (
        <div className={cn('overflow-x-auto', glassCardClass)} style={glassCardShadow}>
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-3">Название</th>
                <th className="px-4 py-3">Район</th>
                <th className="px-4 py-3">Класс</th>
                <th className="px-4 py-3">Площадь</th>
                <th className="px-4 py-3">Год</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Порядок</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(centers ?? []).map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="max-w-[240px] px-4 py-3 font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.district ?? '—'}</td>
                  <td className="px-4 py-3">
                    {c.businessClass ? <Badge tone="primary">Класс {c.businessClass}</Badge> : <Badge>Не указан</Badge>}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{c.totalArea != null ? `${c.totalArea.toLocaleString('ru-RU')} м²` : '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.yearBuilt ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-muted">{STATUS_LABEL[c.status]}</td>
                  <td className="px-4 py-3 text-ink-muted">{c.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-surface-muted hover:text-ink"
                        aria-label="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.id}
                        className="flex h-8 w-8 items-center justify-center rounded-control text-ink-muted hover:bg-danger-bg hover:text-danger disabled:opacity-50"
                        aria-label="Удалить"
                      >
                        {deletingId === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {centers && centers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-sm text-ink-faint">
                    Пока пусто — добавьте первый бизнес-центр.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={editing !== null} onClose={closeEdit} title={editing === 'new' ? 'Новый бизнес-центр' : 'Редактировать БЦ'}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Название" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input
              label="Slug (для URL/путей фото)"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              placeholder="titul"
              required
            />
          </div>

          <Input label="Адрес" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <AddableSelect
              label="Район"
              options={districtOptions}
              value={form.district}
              onChange={(v) => setForm({ ...form, district: v })}
              placeholder="Выберите район"
              newPlaceholder="Название района"
            />
            <Select
              label="Класс"
              options={CLASS_SELECT_OPTIONS}
              value={form.businessClass || 'Не указан'}
              onChange={(v) => setForm({ ...form, businessClass: v })}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Площадь, м²"
              type="number"
              value={form.totalArea}
              onChange={(e) => setForm({ ...form, totalArea: e.target.value })}
            />
            <Input
              label="Год постройки/сдачи"
              type="number"
              value={form.yearBuilt}
              onChange={(e) => setForm({ ...form, yearBuilt: e.target.value })}
            />
            <Input label="Этажей" type="number" value={form.floors} onChange={(e) => setForm({ ...form, floors: e.target.value })} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Статус"
              options={[STATUS_LABEL.built, STATUS_LABEL.under_construction]}
              value={STATUS_LABEL[form.status]}
              onChange={(v) =>
                setForm({ ...form, status: v === STATUS_LABEL.under_construction ? 'under_construction' : 'built' })
              }
            />
            <Input
              label="Порядок на странице"
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              helperText="Меньше число — выше в списке"
            />
          </div>

          <Input label="Застройщик / УК" value={form.developer} onChange={(e) => setForm({ ...form, developer: e.target.value })} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Метро" value={form.metro} onChange={(e) => setForm({ ...form, metro: e.target.value })} />
            <Input label="Парковка" value={form.parking} onChange={(e) => setForm({ ...form, parking: e.target.value })} />
          </div>

          <Input label="Сайт" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" />

          <Textarea
            label="Описание"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={4}
          />

          <div className="flex flex-col gap-3 rounded-control border border-border p-4">
            <div>
              <p className="text-sm font-semibold text-ink">Условия для арендаторов (с офиц. сайта БЦ)</p>
              <p className="text-xs text-ink-faint">
                Каждый пункт — с новой строки, начиная с «- » (список), важные цифры — в **двух звёздочках** (жирным).
                Строка без «- » в начале — обычный абзац.
              </p>
            </div>
            <Textarea
              label="Важная оговорка (если есть)"
              value={form.rentalCaveat}
              onChange={(e) => setForm({ ...form, rentalCaveat: e.target.value })}
              rows={2}
              placeholder="Напр.: сайт недоступен, данные устарели, это не БЦ, а гостиница..."
            />
            <Textarea
              label="Условия аренды"
              value={form.rentalTerms}
              onChange={(e) => setForm({ ...form, rentalTerms: e.target.value })}
              rows={4}
              placeholder={'- Минимальный срок договора — **1 год**\n- Коммунальные платежи включены в ставку'}
            />
            <Textarea
              label="Ставки"
              value={form.rentalRates}
              onChange={(e) => setForm({ ...form, rentalRates: e.target.value })}
              rows={2}
              placeholder="- От **26 BYN/м²**"
            />
            <Textarea
              label="Площади и типы помещений"
              value={form.rentalSizes}
              onChange={(e) => setForm({ ...form, rentalSizes: e.target.value })}
              rows={3}
            />
            <Textarea
              label="Парковка"
              value={form.rentalParking}
              onChange={(e) => setForm({ ...form, rentalParking: e.target.value })}
              rows={2}
            />
            <Textarea
              label="Контакты отдела аренды"
              value={form.rentalContacts}
              onChange={(e) => setForm({ ...form, rentalContacts: e.target.value })}
              rows={2}
            />
          </div>

          <div className="flex flex-col gap-3 rounded-control border border-border p-4">
            <div>
              <p className="text-sm font-semibold text-ink">Интересные факты</p>
              <p className="text-xs text-ink-faint">
                Произвольный набор блоков — добавляйте только то, что реально нашлось (нет наград — не добавляйте
                блок вовсе), для нетипичного факта берите тип «Другой факт» и пишите свою подпись. Та же нотация в
                тексте: «- » для буллетов, **жирным** — ключевые цифры/названия. Рейтинг/отзывы с карт — только
                вручную (скриншот/копия из своего браузера), автопоиск для них ненадёжен.
              </p>
            </div>
            {form.highlights.map((section, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-control border border-border bg-surface-muted p-3">
                <div className="flex items-center gap-2">
                  <Select
                    options={HIGHLIGHT_ICON_KEYS.map((k) => HIGHLIGHT_ICON_LABELS[k])}
                    value={HIGHLIGHT_ICON_LABELS[section.icon]}
                    onChange={(label) => {
                      const icon = HIGHLIGHT_ICON_KEYS.find((k) => HIGHLIGHT_ICON_LABELS[k] === label) ?? 'fact';
                      setForm((f) => ({
                        ...f,
                        highlights: f.highlights.map((s, idx) => (idx === i ? { ...s, icon } : s)),
                      }));
                    }}
                    triggerClassName="w-56"
                  />
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, highlights: f.highlights.filter((_, idx) => idx !== i) }))}
                    aria-label="Убрать блок"
                    className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-faint hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  label="Подпись раздела"
                  value={section.label}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      highlights: f.highlights.map((s, idx) => (idx === i ? { ...s, label: e.target.value } : s)),
                    }))
                  }
                  placeholder="Напр.: История объекта"
                />
                <Textarea
                  label="Текст"
                  value={section.text}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      highlights: f.highlights.map((s, idx) => (idx === i ? { ...s, text: e.target.value } : s)),
                    }))
                  }
                  rows={3}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                setForm((f) => ({ ...f, highlights: [...f.highlights, { icon: 'fact', label: '', text: '' }] }))
              }
            >
              Добавить блок
            </Button>
          </div>

          <div className="flex flex-col gap-3 rounded-control border border-border p-4">
            <div>
              <p className="text-sm font-semibold text-ink">Организации внутри здания</p>
              <p className="text-xs text-ink-faint">
                Из карусели "Организации внутри" на Яндекс.Картах (веб-архив). На публичной странице
                группируются по категории автоматически — вводить готовым списком не нужно, порядок не важен.
                Категория — из подписи ссылки на карте (напр. «Банк», «IT-компания»), можно оставить пустой.
              </p>
            </div>
            {form.tenantOrganizations.length > 0 && (
              <div className="flex flex-col gap-2">
                {form.tenantOrganizations.map((org, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-40 shrink-0">
                      <Input
                        value={org.category}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            tenantOrganizations: f.tenantOrganizations.map((o, idx) => (idx === i ? { ...o, category: e.target.value } : o)),
                          }))
                        }
                        placeholder="Категория"
                      />
                    </div>
                    <div className="flex-1">
                      <Input
                        value={org.name}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            tenantOrganizations: f.tenantOrganizations.map((o, idx) => (idx === i ? { ...o, name: e.target.value } : o)),
                          }))
                        }
                        placeholder="Название организации"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, tenantOrganizations: f.tenantOrganizations.filter((_, idx) => idx !== i) }))}
                      aria-label="Убрать организацию"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-ink-faint hover:bg-danger-bg hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setForm((f) => ({ ...f, tenantOrganizations: [...f.tenantOrganizations, { category: '', name: '' }] }))}
            >
              Добавить организацию
            </Button>
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <Textarea
                label="Или вставить списком (по одной на строку: «Категория — Название»)"
                value={form.tenantOrganizationsBulk}
                onChange={(e) => setForm((f) => ({ ...f, tenantOrganizationsBulk: e.target.value }))}
                rows={3}
                placeholder={'Банк — Сбер Банк\nIT-компания — Vadarod'}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    tenantOrganizations: [...f.tenantOrganizations, ...parseTenantOrganizationsBulk(f.tenantOrganizationsBulk)],
                    tenantOrganizationsBulk: '',
                  }))
                }
                disabled={!form.tenantOrganizationsBulk.trim()}
              >
                Добавить из списка
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">Файлы для ресерча (Яндекс.Карты, 2ГИС и т.п.)</p>
            <p className="text-xs text-ink-faint">
              Сохранённая страница организации (в Safari — «Сохранить как» → Web Archive, в Chrome — «Сохранить
              страницу» → .html/.mhtml). Файл не разбирается автоматически — просто хранится здесь, чтобы можно
              было выгрузить и разобрать данные (рейтинг/отзывы) вручную в следующий раз.
            </p>
            {form.mapSnapshotFiles.map((file, i) => (
              <div key={file.url} className="flex items-center gap-2 rounded-control border border-border px-3 py-2 text-sm text-ink">
                <a href={file.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-primary hover:underline">
                  {file.fileName}
                </a>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, mapSnapshotFiles: f.mapSnapshotFiles.filter((_, idx) => idx !== i) }))}
                  aria-label="Убрать файл"
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.pendingMapSnapshotFiles.map((file, i) => (
              <div key={`pending-${i}`} className="flex items-center gap-2 rounded-control border border-dashed border-border px-3 py-2 text-sm text-ink-muted">
                <span className="min-w-0 flex-1 truncate">{file.name} (загрузится при сохранении)</span>
                <button
                  type="button"
                  onClick={() =>
                    setForm((f) => ({ ...f, pendingMapSnapshotFiles: f.pendingMapSnapshotFiles.filter((_, idx) => idx !== i) }))
                  }
                  aria-label="Убрать файл"
                  className="flex h-6 w-6 shrink-0 items-center justify-center text-ink-faint hover:text-danger"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded-control border border-dashed border-border px-4 py-2.5 text-sm text-ink-muted hover:border-border-strong">
              <Upload className="h-4 w-4" />
              Добавить файл
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (picked.length) setForm((f) => ({ ...f, pendingMapSnapshotFiles: [...f.pendingMapSnapshotFiles, ...picked] }));
                }}
              />
            </label>
          </div>

          <Textarea
            label="Фото (по одному пути на строку)"
            value={form.photos}
            onChange={(e) => setForm({ ...form, photos: e.target.value })}
            rows={2}
            placeholder={`/images/business-centers/${form.slug || 'slug'}.jpg`}
          />

          {formError && <p className="text-sm text-danger">{formError}</p>}

          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={closeEdit}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
