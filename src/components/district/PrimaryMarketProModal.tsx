import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { glassCardShadow } from '../../lib/glass';
import {
  PRIMARY_MARKET_ROW_ORDER,
  median,
  primaryNetAreaM2,
  primaryNetPricePerM2Eur,
} from '../../data/primaryMarketOffers';
import type { PrimaryMarketOffer } from '../../data/primaryMarketOffers';
import { AREA_BUCKET_ORDER, areaBucket } from '../../data/marketOffers';

// Pro-режим блока "Первичный рынок" (владелец, 2026-08-24: "у нас же много
// данных для отображения, давай сделаем таблицу более подробной... может
// даже придумаем Pro режим, типо открыть на весь экран") — drill-down по
// одной категории вместо усреднённой строки таблицы: гистограмма цены за
// м² (показывает, есть ли ценовые кластеры внутри категории — у машиномест
// такой кластер оказался причиной самого деления на крытые/подземные, у
// остальных категорий он тоже может обнаружиться) и разбивка по конкретным
// домам/паркингам (в компактной таблице этого не видно вовсе). Никаких
// новых данных не тянет — агрегирует то, что уже загружено в
// DistrictGuidePage (primaryMarketOffers), просто с фильтром по категории.
const BUCKET_COUNT = 8;

function buildHistogram(prices: number[]): { rangeLabel: string; count: number }[] {
  if (prices.length === 0) return [];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return [{ rangeLabel: `${Math.round(min).toLocaleString('ru-RU')} €`, count: prices.length }];

  const step = (max - min) / BUCKET_COUNT;
  const buckets = Array.from({ length: BUCKET_COUNT }, () => 0);
  for (const p of prices) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.floor((p - min) / step));
    buckets[idx]++;
  }
  return buckets.map((count, i) => {
    const from = Math.round(min + i * step);
    const to = Math.round(min + (i + 1) * step);
    return { rangeLabel: `${from.toLocaleString('ru-RU')}–${to.toLocaleString('ru-RU')} €`, count };
  });
}

interface AreaBucketRow {
  bucket: string;
  count: number;
  priceMin: number;
  priceAvg: number;
  priceMax: number;
}

// Владелец: "в аналитике первички не хватает разделения помещений на
// площади... давай как ты сделал во вторичке" — те же 4 диапазона и та же
// функция бакетинга (AREA_BUCKET_ORDER/areaBucket из data/marketOffers.ts),
// что уже используется в сводной таблице вторичного рынка на гиде района —
// не придумывали новую градацию, переиспользовали существующую. Пустые
// бакеты (для категории просто нет предложений такой площади) не
// показываются — не то же самое, что "0 предложений", это честное
// отсутствие данных для диапазона.
function buildAreaBreakdown(offers: PrimaryMarketOffer[]): AreaBucketRow[] {
  const byBucket = new Map<string, number[]>();
  for (const o of offers) {
    const bucket = areaBucket(primaryNetAreaM2(o));
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(primaryNetPricePerM2Eur(o));
  }
  return AREA_BUCKET_ORDER.filter((bucket) => byBucket.has(bucket)).map((bucket) => {
    const prices = byBucket.get(bucket)!;
    return {
      bucket,
      count: prices.length,
      priceMin: Math.round(Math.min(...prices)),
      priceAvg: Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length),
      priceMax: Math.round(Math.max(...prices)),
    };
  });
}

interface HouseRow {
  house: string;
  count: number;
  priceMin: number;
  priceAvg: number;
  priceMax: number;
}

function buildHouseBreakdown(offers: PrimaryMarketOffer[]): HouseRow[] {
  const byHouse = new Map<string, number[]>();
  for (const o of offers) {
    const key = o.house ?? 'Без названия';
    if (!byHouse.has(key)) byHouse.set(key, []);
    byHouse.get(key)!.push(primaryNetPricePerM2Eur(o));
  }
  return [...byHouse.entries()]
    .map(([house, prices]) => ({
      house,
      count: prices.length,
      priceMin: Math.round(Math.min(...prices)),
      priceAvg: Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length),
      priceMax: Math.round(Math.max(...prices)),
    }))
    .sort((a, b) => b.count - a.count);
}

export function PrimaryMarketProModal({
  offers,
  initialCategoryKey,
  onClose,
}: {
  offers: PrimaryMarketOffer[];
  initialCategoryKey: string;
  onClose: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState(initialCategoryKey);

  // Тот же паттерн, что и у обычной модалки (components/ui/Modal.tsx) —
  // затемнённый фон исходной страницы + закрытие по клику вне окна и по
  // Esc. Раньше окно было на весь экран без подложки и почти неотличимо от
  // перехода на новую страницу — владелец сообщил, что знакомый открыл
  // Pro-аналитику и не понял, как её закрыть.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Предположительно проданные (soldAt задан) объекты сюда не должны
  // попадать вовсе — этот блок про то, что СЕЙЧАС в продаже, тот же принцип,
  // что и у buildPrimaryMarketPivot (data/primaryMarketOffers.ts), только
  // модалка фильтрует сама, не через ту функцию — берёт свои разрезы
  // (гистограмма/по площади/по домам) напрямую из сырых offers.
  const activeOffers = useMemo(() => offers.filter((o) => !o.soldAt), [offers]);

  const availableTabs = useMemo(
    () => PRIMARY_MARKET_ROW_ORDER.filter((row) => activeOffers.some(row.filter)),
    [activeOffers],
  );
  const selected = availableTabs.find((row) => row.key === selectedKey) ?? availableTabs[0];

  const matched = useMemo(() => (selected ? activeOffers.filter(selected.filter) : []), [activeOffers, selected]);
  const prices = useMemo(() => matched.map(primaryNetPricePerM2Eur), [matched]);
  const areas = useMemo(() => matched.map(primaryNetAreaM2), [matched]);
  const histogram = useMemo(() => buildHistogram(prices), [prices]);
  const areaRows = useMemo(() => buildAreaBreakdown(matched), [matched]);
  const houseRows = useMemo(() => buildHouseBreakdown(matched), [matched]);
  const maxBucketCount = Math.max(1, ...histogram.map((b) => b.count));

  // Сравнение сдано/строится — только для апартаментов, только когда есть
  // обе стадии в данных (иначе сравнивать не с чем).
  const stageComparison = useMemo(() => {
    if (!selected?.key.startsWith('apartments-')) return null;
    const sdano = activeOffers.filter((o) => o.category === 'Бизнес-апартаменты' && o.stage === 'Сдано');
    const stroitsya = activeOffers.filter((o) => o.category === 'Бизнес-апартаменты' && o.stage === 'Строится');
    if (sdano.length === 0 || stroitsya.length === 0) return null;
    const sdanoMedian = median(sdano.map(primaryNetPricePerM2Eur));
    const stroitsyaMedian = median(stroitsya.map(primaryNetPricePerM2Eur));
    const diffPct = Math.round(((sdanoMedian - stroitsyaMedian) / stroitsyaMedian) * 100);
    return { sdanoMedian: Math.round(sdanoMedian), stroitsyaMedian: Math.round(stroitsyaMedian), diffPct };
  }, [selected, activeOffers]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/80 bg-bg"
        style={glassCardShadow}
      >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-8">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Первичный рынок · Pro</p>
          <h2 className="truncate text-lg font-extrabold text-ink">{selected?.label ?? '—'}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90"
        >
          <X className="h-4 w-4" />
          Закрыть
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-8">
        {availableTabs.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => setSelectedKey(row.key)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
              row.key === selected?.key ? 'bg-primary text-white' : 'bg-surface-muted text-ink-muted hover:text-ink',
            )}
          >
            {row.label}
          </button>
        ))}
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-8">
        {matched.length === 0 ? (
          <p className="text-sm text-ink-faint">Нет данных по этой категории.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Предложений', value: matched.length.toLocaleString('ru-RU') },
                {
                  label: 'Площадь',
                  value: `${Math.round(Math.min(...areas) * 10) / 10}–${Math.round(Math.max(...areas) * 10) / 10} м²`,
                },
                { label: 'Мин. цена', value: `${Math.round(Math.min(...prices)).toLocaleString('ru-RU')} €/м²` },
                { label: 'Макс. цена', value: `${Math.round(Math.max(...prices)).toLocaleString('ru-RU')} €/м²` },
              ].map((tile) => (
                <div key={tile.label} className="flex flex-col gap-1 rounded-control border border-border p-3">
                  <p className="text-xs text-ink-faint">{tile.label}</p>
                  <p className="text-lg font-extrabold text-ink">{tile.value}</p>
                </div>
              ))}
            </div>

            {stageComparison && (
              <div className="flex flex-col gap-1 rounded-control border border-border bg-surface-muted p-4">
                <p className="text-sm text-ink">
                  Сдано:{' '}
                  <span className="font-semibold text-ink">{stageComparison.sdanoMedian.toLocaleString('ru-RU')} €/м²</span>{' '}
                  (медиана) · Строится:{' '}
                  <span className="font-semibold text-ink">{stageComparison.stroitsyaMedian.toLocaleString('ru-RU')} €/м²</span>{' '}
                  (медиана)
                </p>
                <p className="text-xs text-ink-faint">
                  Сданные дома {stageComparison.diffPct >= 0 ? 'дороже' : 'дешевле'} строящихся на{' '}
                  {Math.abs(stageComparison.diffPct)}%.
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-ink">Распределение цены за м²</h3>
              <div className="flex flex-col gap-1.5">
                {histogram.map((bucket) => (
                  <div key={bucket.rangeLabel} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-right text-xs tabular-nums text-ink-faint sm:w-40">
                      {bucket.rangeLabel}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(bucket.count / maxBucketCount) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-xs font-semibold tabular-nums text-ink">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-ink">По площади</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      <th className="py-2 pr-3 text-left">Площадь</th>
                      <th className="py-2 px-2 text-right font-semibold">Кол-во</th>
                      <th className="py-2 px-2 text-right font-semibold">Мин, €/м²</th>
                      <th className="py-2 px-2 text-right font-semibold">Средняя, €/м²</th>
                      <th className="py-2 pl-2 text-right font-semibold">Макс, €/м²</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {areaRows.map((row) => (
                      <tr key={row.bucket}>
                        <td className="py-2 pr-3 font-medium text-ink">{row.bucket}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-ink">{row.count}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-ink-faint">
                          {row.priceMin.toLocaleString('ru-RU')} €
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold text-ink">
                          {row.priceAvg.toLocaleString('ru-RU')} €
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums text-ink-faint">
                          {row.priceMax.toLocaleString('ru-RU')} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-bold text-ink">По домам</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      <th className="py-2 pr-3 text-left">Дом</th>
                      <th className="py-2 px-2 text-right font-semibold">Кол-во</th>
                      <th className="py-2 px-2 text-right font-semibold">Мин, €/м²</th>
                      <th className="py-2 px-2 text-right font-semibold">Средняя, €/м²</th>
                      <th className="py-2 pl-2 text-right font-semibold">Макс, €/м²</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {houseRows.map((row) => (
                      <tr key={row.house}>
                        <td className="py-2 pr-3 font-medium text-ink">{row.house}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-ink">{row.count}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-ink-faint">
                          {row.priceMin.toLocaleString('ru-RU')} €
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold text-ink">
                          {row.priceAvg.toLocaleString('ru-RU')} €
                        </td>
                        <td className="py-2 pl-2 text-right tabular-nums text-ink-faint">
                          {row.priceMax.toLocaleString('ru-RU')} €
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
      </div>
    </div>,
    document.body,
  );
}
