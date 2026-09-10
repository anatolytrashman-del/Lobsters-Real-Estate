import { describe, expect, it } from 'vitest';
import {
  lineItemWorkTotal,
  lineItemMaterialTotal,
  lineItemTotal,
  sectionLineItemsTotals,
  estimateLineItemsTotals,
  type EstimateLineItem,
  type EstimateSection,
} from './estimates';
import type { ExchangeRate } from './exchangeRates';

const rate: ExchangeRate = { date: '2026-01-01', usdByn: 3.2, eurByn: 3.5, rubByn: 0.035 };

function lineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: 'li1',
    zone: '',
    workType: '',
    unit: '',
    length: null,
    width: null,
    height: null,
    volume: null,
    quantity: 1,
    currency: 'BYN',
    workUnitPrice: 0,
    materialUnitPrice: 0,
    note: '',
    comments: [],
    deferred: false,
    ...overrides,
  };
}

function section(overrides: Partial<EstimateSection> = {}): EstimateSection {
  return {
    id: 's1',
    title: '',
    body: '',
    positions: [],
    lineItems: [],
    materials: [],
    materialListFiles: [],
    materialFiles: [],
    deferred: false,
    floor: null,
    ...overrides,
  };
}

describe('lineItem*Total', () => {
  it('работа и материал считаются по количеству × цену за единицу', () => {
    const item = lineItem({ quantity: 3, workUnitPrice: 100, materialUnitPrice: 50 });
    expect(lineItemWorkTotal(item)).toBe(300);
    expect(lineItemMaterialTotal(item)).toBe(150);
    expect(lineItemTotal(item)).toBe(450);
  });

  it('null-цена/количество считается как 0, не роняет расчёт', () => {
    const item = lineItem({ quantity: null, workUnitPrice: null, materialUnitPrice: 100 });
    expect(lineItemWorkTotal(item)).toBe(0);
    expect(lineItemMaterialTotal(item)).toBe(0);
    expect(lineItemTotal(item)).toBe(0);
  });
});

describe('sectionLineItemsTotals', () => {
  it('разносит строки на "сейчас"/"потом" по собственному deferred строки', () => {
    const section = {
      deferred: false,
      lineItems: [
        lineItem({ id: 'now', currency: 'BYN', quantity: 1, workUnitPrice: 100, deferred: false }),
        lineItem({ id: 'later', currency: 'BYN', quantity: 1, workUnitPrice: 200, deferred: true }),
      ],
    };
    const totals = sectionLineItemsTotals(section, rate);
    expect(totals.now.total).toBe(100);
    expect(totals.later.total).toBe(200);
  });

  it('deferred раздела целиком перекрывает deferred отдельных строк (все уходят в later)', () => {
    const section = {
      deferred: true,
      lineItems: [
        lineItem({ id: 'a', currency: 'BYN', quantity: 1, workUnitPrice: 100, deferred: false }),
        lineItem({ id: 'b', currency: 'BYN', quantity: 1, workUnitPrice: 50, deferred: true }),
      ],
    };
    const totals = sectionLineItemsTotals(section, rate);
    expect(totals.now.total).toBe(0);
    expect(totals.later.total).toBe(150);
  });

  it('строки в разной валюте конвертируются в BYN по общему курсу перед суммированием', () => {
    const section = {
      deferred: false,
      lineItems: [
        lineItem({ id: 'byn', currency: 'BYN', quantity: 1, workUnitPrice: 100 }),
        lineItem({ id: 'usd', currency: 'USD', quantity: 1, workUnitPrice: 100 }), // -> 320 BYN
      ],
    };
    const totals = sectionLineItemsTotals(section, rate);
    expect(totals.now.total).toBeCloseTo(420, 6);
  });

  it('без курса (rate=null) валютные строки считаются за 0, а не роняют расчёт', () => {
    const section = {
      deferred: false,
      lineItems: [
        lineItem({ id: 'byn', currency: 'BYN', quantity: 1, workUnitPrice: 100 }),
        lineItem({ id: 'usd', currency: 'USD', quantity: 1, workUnitPrice: 100 }),
      ],
    };
    const totals = sectionLineItemsTotals(section, null);
    expect(totals.now.total).toBe(100);
  });
});

describe('estimateLineItemsTotals', () => {
  it('суммирует итоги по всем разделам сметы', () => {
    const estimate = {
      sections: [
        section({ lineItems: [lineItem({ quantity: 1, workUnitPrice: 100, currency: 'BYN' })] }),
        section({ lineItems: [lineItem({ quantity: 1, workUnitPrice: 50, currency: 'BYN', deferred: true })] }),
      ],
    };
    const totals = estimateLineItemsTotals(estimate, rate);
    expect(totals.now.total).toBe(100);
    expect(totals.later.total).toBe(50);
  });

  it('смета без разделов — нулевые итоги', () => {
    const totals = estimateLineItemsTotals({ sections: [] }, rate);
    expect(totals.now.total).toBe(0);
    expect(totals.later.total).toBe(0);
  });
});
