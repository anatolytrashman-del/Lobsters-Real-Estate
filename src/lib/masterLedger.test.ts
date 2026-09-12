import { describe, expect, it } from 'vitest';
import { buildMasterLedger, buildMasterLedgers, isMasterLedgerId, mergeLedgerItems } from './masterLedger';
import type { MaterialLedger } from '../data/materialLedgers';
import type { PurchaseItem } from '../data/purchases';

function item(partial: Partial<PurchaseItem> & { name: string }): PurchaseItem {
  return {
    id: partial.id ?? crypto.randomUUID(),
    sourceMaterialId: partial.sourceMaterialId ?? null,
    name: partial.name,
    unit: partial.unit ?? 'м²',
    quantity: partial.quantity ?? 10,
    price: null,
    note: partial.note ?? '',
  };
}

function ledger(name: string, items: PurchaseItem[], estimateId: string | null = 'est-1'): MaterialLedger {
  return { id: `led-${name}`, name, items, estimateId, createdAt: `2026-09-0${items.length}` };
}

describe('mergeLedgerItems', () => {
  it('склеивает одну и ту же позицию сметы, попавшую в две ведомости', () => {
    const shared = item({ name: 'Краска', sourceMaterialId: 'mat-1', quantity: 400 });
    const merged = mergeLedgerItems([
      ledger('Окна', [shared, item({ name: 'Стекло', sourceMaterialId: 'mat-2' })]),
      ledger('Универсальные', [{ ...shared, id: 'other-row-id' }]),
    ]);
    expect(merged.map((i) => i.name)).toEqual(['Краска', 'Стекло']);
  });

  it('не сливает одноимённые позиции с разными объёмами и параметрами', () => {
    const merged = mergeLedgerItems([
      ledger('A', [item({ name: 'Краска', sourceMaterialId: 'mat-1', quantity: 400, note: 'подвал' })]),
      ledger('B', [item({ name: 'Краска', sourceMaterialId: 'mat-1', quantity: 720, note: 'первый этаж' })]),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.map((i) => i.quantity)).toEqual([400, 720]);
  });

  it('выдаёт позициям уникальные id (React-ключи, правка перед отправкой)', () => {
    const merged = mergeLedgerItems([
      ledger('A', [item({ id: 'same', name: 'Краска' })]),
      ledger('B', [item({ id: 'same', name: 'Гипсокартон' })]),
    ]);
    expect(new Set(merged.map((i) => i.id)).size).toBe(2);
  });
});

describe('buildMasterLedger', () => {
  it('собирается из двух и более ведомостей и помечается виртуальным id', () => {
    const master = buildMasterLedger(
      [ledger('Окна', [item({ name: 'Стекло' })]), ledger('Пол', [item({ name: 'Плитка' })])],
      'est-1',
      'Red One',
    );
    expect(master).not.toBeNull();
    expect(master!.name).toBe('Мастер-ведомость — Red One');
    expect(master!.estimateId).toBe('est-1');
    expect(isMasterLedgerId(master!.id)).toBe(true);
    expect(master!.items).toHaveLength(2);
  });

  it('не создаётся при одной ведомости — это была бы её копия', () => {
    expect(buildMasterLedger([ledger('Окна', [item({ name: 'Стекло' })])], 'est-1', 'Red One')).toBeNull();
  });

  it('не собирается из других мастер-ведомостей', () => {
    const master = buildMasterLedger(
      [ledger('Окна', [item({ name: 'Стекло' })]), ledger('Пол', [item({ name: 'Плитка' })])],
      'est-1',
      'Red One',
    )!;
    expect(buildMasterLedger([master, ledger('Пол', [item({ name: 'Плитка' })])], 'est-1', 'Red One')).toBeNull();
  });
});

describe('buildMasterLedgers', () => {
  const names: Record<string, string> = { 'est-1': 'Red One', 'est-2': 'Зелёный' };

  it('делает отдельный мастер на каждую смету и на ведомости без сметы', () => {
    const masters = buildMasterLedgers(
      [
        ledger('Окна', [item({ name: 'Стекло' })], 'est-1'),
        ledger('Пол', [item({ name: 'Плитка' })], 'est-1'),
        ledger('Фасад', [item({ name: 'Грильято' })], 'est-2'),
        ledger('Общая 1', [item({ name: 'Саморезы' })], null),
        ledger('Общая 2', [item({ name: 'Клей' })], null),
      ],
      (id) => names[id],
    );
    expect(masters.map((m) => m.name)).toEqual(['Мастер-ведомость — Red One', 'Мастер-ведомость — без сметы']);
    const redOne = masters.find((m) => m.estimateId === 'est-1')!;
    expect(redOne.items.map((i) => i.name)).toEqual(['Стекло', 'Плитка']);
    // Смета "Зелёный" с одной ведомостью мастера не получает, и её позиции
    // не утекают в чужой мастер.
    expect(masters.some((m) => m.items.some((i) => i.name === 'Грильято'))).toBe(false);
  });

  it('переживает ведомость с удалённой/ненайденной сметой', () => {
    const masters = buildMasterLedgers(
      [ledger('A', [item({ name: 'X' })], 'est-gone'), ledger('B', [item({ name: 'Y' })], 'est-gone')],
      () => undefined,
    );
    expect(masters).toHaveLength(1);
    expect(masters[0].name).toBe('Мастер-ведомость — без сметы');
  });
});
