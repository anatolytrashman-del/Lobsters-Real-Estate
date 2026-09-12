import { describe, expect, it } from 'vitest';
import {
  isLedgerFieldOverridden,
  markLedgerFieldOverridden,
  restoreLedgerItemFromSource,
  syncLedgerItems,
  syncLedgersWithEstimates,
} from './ledgerSync';
import type { Estimate, EstimateMaterial } from '../data/estimates';
import type { MaterialLedger } from '../data/materialLedgers';
import type { PurchaseItem } from '../data/purchases';

function material(partial: Partial<EstimateMaterial> & { id: string; name: string }): EstimateMaterial {
  return {
    id: partial.id,
    name: partial.name,
    unit: partial.unit ?? 'м²',
    quantity: partial.quantity ?? 100,
    note: partial.note ?? '',
    comments: [],
    group: '',
  };
}

function item(partial: Partial<PurchaseItem> & { name: string }): PurchaseItem {
  return {
    id: partial.id ?? 'row-1',
    sourceMaterialId: partial.sourceMaterialId ?? null,
    name: partial.name,
    unit: partial.unit ?? 'м²',
    quantity: partial.quantity ?? 100,
    price: null,
    note: partial.note ?? '',
    ...(partial.ledgerOverrides ? { ledgerOverrides: partial.ledgerOverrides } : {}),
  };
}

function estimate(materials: EstimateMaterial[]): Estimate {
  return {
    id: 'est-1',
    objectId: null,
    title: 'Смета',
    sections: [
      {
        id: 'sec-1',
        title: 'Напольные покрытия',
        body: '',
        lineItems: [],
        materials,
        materialListFiles: [],
        materialFiles: [],
        deferred: false,
        floor: null,
      },
    ],
    questions: [],
    status: 'Черновик',
    shareToken: 't',
    floor2Deferred: false,
    createdAt: '2026-09-01',
  } as unknown as Estimate;
}

function ledger(items: PurchaseItem[]): MaterialLedger {
  return { id: 'led-1', name: 'Керамогранит', items, estimateId: 'est-1', createdAt: '2026-09-12' };
}

describe('syncLedgerItems', () => {
  // Ровно тот баг, с которого всё началось: владелец дописал ссылку в
  // примечание материала сметы, а к письму уезжал старый снимок.
  it('подтягивает изменившееся примечание из сметы', () => {
    const byId = new Map([['mat-1', material({ id: 'mat-1', name: 'Керамогранит', note: 'серый / https://lemanapro.ru' })]]);
    const synced = syncLedgerItems([item({ name: 'Керамогранит', sourceMaterialId: 'mat-1', note: 'серый' })], byId);
    expect(synced[0].note).toBe('серый / https://lemanapro.ru');
  });

  it('подтягивает название, единицу и объём', () => {
    const byId = new Map([
      ['mat-1', material({ id: 'mat-1', name: 'Потолок Грильято', unit: 'шт', quantity: 720 })],
    ]);
    const synced = syncLedgerItems(
      [item({ name: 'Потолок Грияльто', sourceMaterialId: 'mat-1', unit: 'м²', quantity: 700 })],
      byId,
    );
    expect(synced[0]).toMatchObject({ name: 'Потолок Грильято', unit: 'шт', quantity: 720 });
  });

  it('не трогает поля, правленные руками, но название и единицу обновляет', () => {
    const byId = new Map([
      ['mat-1', material({ id: 'mat-1', name: 'Краска BINDO 7', unit: 'л', quantity: 2229, note: 'учесть 2 слоя в объёме' })],
    ]);
    const synced = syncLedgerItems(
      [
        item({
          name: 'Краска',
          sourceMaterialId: 'mat-1',
          unit: 'м²',
          quantity: 1868,
          note: '(в 2 слоя)',
          ledgerOverrides: ['quantity', 'note'],
        }),
      ],
      byId,
    );
    expect(synced[0]).toMatchObject({ name: 'Краска BINDO 7', unit: 'л', quantity: 1868, note: '(в 2 слоя)' });
  });

  it('оставляет как есть ручные позиции и позиции, которых больше нет в смете', () => {
    const manual = item({ id: 'a', name: 'Доставка' });
    const orphan = item({ id: 'b', name: 'Снятая позиция', sourceMaterialId: 'mat-404', quantity: 5 });
    const items = [manual, orphan];
    expect(syncLedgerItems(items, new Map())).toBe(items);
  });

  it('возвращает тот же массив, когда синхронизировать нечего', () => {
    const byId = new Map([['mat-1', material({ id: 'mat-1', name: 'Керамогранит', note: 'серый' })]]);
    const items = [item({ name: 'Керамогранит', sourceMaterialId: 'mat-1', note: 'серый' })];
    expect(syncLedgerItems(items, byId)).toBe(items);
  });
});

describe('syncLedgersWithEstimates', () => {
  it('обновляет ведомость из живой сметы', () => {
    const estimates = [estimate([material({ id: 'mat-1', name: 'Керамогранит', quantity: 992, note: 'с ссылкой' })])];
    const [synced] = syncLedgersWithEstimates(
      [ledger([item({ name: 'Керамогранит', sourceMaterialId: 'mat-1', quantity: 900, note: 'без ссылки' })])],
      estimates,
    );
    expect(synced.items[0]).toMatchObject({ quantity: 992, note: 'с ссылкой' });
  });

  it('не подменяет список, пока сметы не загрузились', () => {
    const ledgers = [ledger([item({ name: 'Керамогранит', sourceMaterialId: 'mat-1' })])];
    expect(syncLedgersWithEstimates(ledgers, [])).toBe(ledgers);
  });
});

describe('метки ручной правки', () => {
  it('ставится только позициям, привязанным к смете', () => {
    const linked = markLedgerFieldOverridden(item({ name: 'Краска', sourceMaterialId: 'mat-1' }), 'quantity');
    const manual = markLedgerFieldOverridden(item({ name: 'Доставка' }), 'quantity');
    expect(isLedgerFieldOverridden(linked, 'quantity')).toBe(true);
    expect(isLedgerFieldOverridden(manual, 'quantity')).toBe(false);
    expect(manual.ledgerOverrides).toBeUndefined();
  });

  it('не дублируется при повторной правке того же поля', () => {
    const once = markLedgerFieldOverridden(item({ name: 'Краска', sourceMaterialId: 'mat-1' }), 'note');
    expect(markLedgerFieldOverridden(once, 'note')).toBe(once);
  });

  it('"Вернуть из сметы" снимает метки и возвращает данные сметы', () => {
    const overridden = item({
      name: 'Краска',
      sourceMaterialId: 'mat-1',
      quantity: 1868,
      note: '(в 2 слоя)',
      ledgerOverrides: ['quantity', 'note'],
    });
    const restored = restoreLedgerItemFromSource(
      overridden,
      material({ id: 'mat-1', name: 'Краска BINDO 7', unit: 'л', quantity: 2229, note: 'учесть 2 слоя' }),
    );
    expect(restored.ledgerOverrides).toBeUndefined();
    expect(restored).toMatchObject({ name: 'Краска BINDO 7', unit: 'л', quantity: 2229, note: 'учесть 2 слоя' });
  });
});
