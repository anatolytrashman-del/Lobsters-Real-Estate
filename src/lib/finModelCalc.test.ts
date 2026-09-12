import { describe, expect, it } from 'vitest';
import {
  annuityPayment,
  rateForLoanMonth,
  leasingMonthlyPayment,
  leasingByn,
  rentInMonth,
  rentTaxableInMonth,
  buildLeasingCashFlow,
  saleAmountByn,
  saleNetByn,
  calculateFinModel,
} from './finModelCalc';
import type { FinLeasing, FinModel, FinRent, FinSale } from '../data/finModels';

function leasing(overrides: Partial<FinLeasing> = {}): FinLeasing {
  return {
    contractSum: null,
    downPayment: null,
    amortizationMonths: null,
    ratePctYear1: null,
    ratePctYear2: null,
    ratePctFromYear3: null,
    interestOnlyMonths: null,
    currency: 'BYN',
    exchangeRate: null,
    startMonth: 1,
    originationFeePct: null,
    deductible: true,
    ...overrides,
  };
}

function rent(overrides: Partial<FinRent> = {}): FinRent {
  return {
    areaPreMeters: null,
    pricePreMeter: null,
    renovationStartMonth: null,
    renovationMonths: null,
    areaPostMeters: null,
    pricePostMeter: null,
    workstationCount: null,
    workstationPrice: null,
    vacancyPct: null,
    annualGrowthPct: null,
    stabilizationMonths: null,
    vatIncluded: false,
    vatPct: null,
    ...overrides,
  };
}

function sale(overrides: Partial<FinSale> = {}): FinSale {
  return {
    id: 's1',
    label: '',
    saleDate: '',
    areaMeters: null,
    pricePerMeterUsd: null,
    exchangeRate: null,
    applyToLeasing: false,
    transactionCost: null,
    ...overrides,
  };
}

function finModel(overrides: Partial<FinModel> = {}): FinModel {
  return {
    id: 'm1',
    objectId: 'o1',
    name: 'Тест',
    params: {
      startDate: '2026-01',
      horizonMonths: 12,
      taxRevenuePct: 16,
      taxProfitPct: 20,
      revenueLimitByn: 500_000,
      expenseInflationPct: null,
    },
    leasing: leasing(),
    rent: rent(),
    amortization: { monthlyAmount: null, startMonth: 1, termMonths: null },
    capexReserve: { pct: null, deductible: false },
    sales: [],
    categories: [],
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('annuityPayment', () => {
  it('нулевая ставка — равные доли на весь срок', () => {
    expect(annuityPayment(1200, 12, 0)).toBeCloseTo(100, 6);
  });

  it('стандартная формула аннуитета при ненулевой ставке', () => {
    const payment = annuityPayment(100_000, 12, 0.01);
    // Проверка через сумму всех платежей > основного долга (есть проценты)
    expect(payment * 12).toBeGreaterThan(100_000);
    expect(payment).toBeCloseTo(8884.878, 2);
  });

  it('нулевой/отрицательный остаток или срок — платёж 0', () => {
    expect(annuityPayment(0, 12, 0.01)).toBe(0);
    expect(annuityPayment(1000, 0, 0.01)).toBe(0);
    expect(annuityPayment(-100, 12, 0.01)).toBe(0);
  });
});

describe('rateForLoanMonth', () => {
  it('первый год — ratePctYear1', () => {
    const l = leasing({ ratePctYear1: 10, ratePctYear2: 8, ratePctFromYear3: 6 });
    expect(rateForLoanMonth(l, 0)).toBe(10);
    expect(rateForLoanMonth(l, 11)).toBe(10);
  });

  it('второй год — ratePctYear2, третий+ — ratePctFromYear3', () => {
    const l = leasing({ ratePctYear1: 10, ratePctYear2: 8, ratePctFromYear3: 6 });
    expect(rateForLoanMonth(l, 12)).toBe(8);
    expect(rateForLoanMonth(l, 23)).toBe(8);
    expect(rateForLoanMonth(l, 24)).toBe(6);
    expect(rateForLoanMonth(l, 100)).toBe(6);
  });

  it('незаполненный ярус берёт ставку предыдущего — один ratePctYear1 равносилен единой ставке', () => {
    const l = leasing({ ratePctYear1: 12, ratePctYear2: null, ratePctFromYear3: null });
    expect(rateForLoanMonth(l, 0)).toBe(12);
    expect(rateForLoanMonth(l, 15)).toBe(12);
    expect(rateForLoanMonth(l, 30)).toBe(12);
  });
});

describe('leasingByn', () => {
  it('BYN-договор — курс всегда 1', () => {
    expect(leasingByn(leasing({ currency: 'BYN', exchangeRate: 5 }))).toBe(1);
  });

  it('валютный договор без заполненного курса — 0, не молчаливый 1:1', () => {
    expect(leasingByn(leasing({ currency: 'USD', exchangeRate: null }))).toBe(0);
  });

  it('валютный договор с курсом — сам курс', () => {
    expect(leasingByn(leasing({ currency: 'USD', exchangeRate: 3.2 }))).toBe(3.2);
  });
});

describe('leasingMonthlyPayment', () => {
  it('без суммы/срока — null (лизинга по сути нет)', () => {
    expect(leasingMonthlyPayment(leasing())).toBeNull();
  });

  it('с льготным периодом — платёж только проценты на остаток', () => {
    const l = leasing({
      contractSum: 100_000,
      downPayment: 0,
      amortizationMonths: 12,
      ratePctYear1: 12,
      interestOnlyMonths: 3,
      currency: 'BYN',
    });
    const payment = leasingMonthlyPayment(l)!;
    expect(payment).toBeCloseTo(100_000 * (0.12 / 12), 6);
  });
});

describe('rentInMonth', () => {
  it('до реновации — площадь × цена, без даты реновации остаётся так весь горизонт', () => {
    const r = rent({ areaPreMeters: 100, pricePreMeter: 20 });
    expect(rentInMonth(r, 1)).toBe(2000);
    expect(rentInMonth(r, 60)).toBe(2000);
  });

  it('простой на реновацию — доход 0 весь период простоя', () => {
    const r = rent({ areaPreMeters: 100, pricePreMeter: 20, renovationStartMonth: 5, renovationMonths: 3 });
    expect(rentInMonth(r, 4)).toBe(2000); // ещё до реновации
    expect(rentInMonth(r, 5)).toBe(0);
    expect(rentInMonth(r, 7)).toBe(0);
  });

  it('после реновации — новая цена за м² + рабочие места, без плавного выхода мгновенно на 100%', () => {
    const r = rent({
      areaPreMeters: 100,
      pricePreMeter: 20,
      renovationStartMonth: 5,
      renovationMonths: 2,
      areaPostMeters: 100,
      pricePostMeter: 30,
      workstationCount: 10,
      workstationPrice: 50,
    });
    // Простой месяцы 5-6, с 7-го — новая аренда: 100*30 + 10*50 = 3500
    expect(rentInMonth(r, 7)).toBeCloseTo(3500, 6);
  });

  it('стабилизация — линейный выход на полную занятость после простоя', () => {
    const r = rent({
      renovationStartMonth: 1,
      renovationMonths: 0,
      areaPostMeters: 100,
      pricePostMeter: 10, // gross = 1000
      stabilizationMonths: 4,
    });
    // downtime=0, начало сразу с месяца 1: monthsSincePostStart = i - 1 + 1 = i
    expect(rentInMonth(r, 1)).toBeCloseTo(1000 * (1 / 4), 6);
    expect(rentInMonth(r, 2)).toBeCloseTo(1000 * (2 / 4), 6);
    expect(rentInMonth(r, 4)).toBeCloseTo(1000, 6); // вышли на 100%
    expect(rentInMonth(r, 10)).toBeCloseTo(1000, 6); // и остаёмся
  });

  it('вакансия снижает доход на процент, годовой рост увеличивает', () => {
    const r = rent({ areaPreMeters: 100, pricePreMeter: 10, vacancyPct: 20 }); // gross=1000
    expect(rentInMonth(r, 1)).toBeCloseTo(800, 6);

    const growing = rent({ areaPreMeters: 100, pricePreMeter: 10, annualGrowthPct: 10 });
    expect(rentInMonth(growing, 1)).toBeCloseTo(1000, 6);
    expect(rentInMonth(growing, 13)).toBeCloseTo(1100, 6); // прошёл 1 полный год
  });
});

describe('rentTaxableInMonth', () => {
  it('без НДС — совпадает с кассовым доходом', () => {
    const r = rent({ areaPreMeters: 100, pricePreMeter: 10, vatIncluded: false });
    expect(rentTaxableInMonth(r, 1)).toBe(rentInMonth(r, 1));
  });

  it('с НДС — налоговая база меньше кассы на сумму НДС', () => {
    const r = rent({ areaPreMeters: 100, pricePreMeter: 10, vatIncluded: true, vatPct: 20 }); // gross=1000
    expect(rentInMonth(r, 1)).toBe(1000); // касса — полная сумма
    expect(rentTaxableInMonth(r, 1)).toBeCloseTo(1000 / 1.2, 6); // без НДС
  });
});

describe('saleAmountByn / saleNetByn', () => {
  it('сумма продажи — площадь × цена за м² × курс', () => {
    const s = sale({ areaMeters: 100, pricePerMeterUsd: 1000, exchangeRate: 3.2 });
    expect(saleAmountByn(s)).toBeCloseTo(320_000, 6);
  });

  it('без курса — 0, не молчаливый 1:1', () => {
    expect(saleAmountByn(sale({ areaMeters: 100, pricePerMeterUsd: 1000, exchangeRate: null }))).toBe(0);
  });

  it('net вычитает расходы на сделку, но не уходит в минус', () => {
    const s = sale({ areaMeters: 100, pricePerMeterUsd: 1000, exchangeRate: 3.2, transactionCost: 300_000 });
    expect(saleNetByn(s)).toBeCloseTo(20_000, 6);
    const bigCost = sale({ areaMeters: 100, pricePerMeterUsd: 1000, exchangeRate: 3.2, transactionCost: 1_000_000 });
    expect(saleNetByn(bigCost)).toBe(0);
  });
});

describe('buildLeasingCashFlow', () => {
  it('без суммы/срока — нулевой поток на весь горизонт', () => {
    const { cashFlow } = buildLeasingCashFlow(leasing(), [], { year: 2026, month: 1 }, 12);
    expect(cashFlow).toEqual(new Array(12).fill(0));
  });

  it('аванс и комиссия за оформление попадают в месяц 1', () => {
    const l = leasing({ contractSum: 100_000, downPayment: 20_000, originationFeePct: 2, currency: 'BYN' });
    const { cashFlow } = buildLeasingCashFlow(l, [], { year: 2026, month: 1 }, 1);
    // downPayment 20000 + 2% от 100000 = 2000 -> итого 22000 в месяце 1
    expect(cashFlow[0]).toBeCloseTo(22_000, 6);
  });

  it('досрочное погашение продажей уменьшает остаток долга — платёж следующих месяцев снижается', () => {
    const l = leasing({
      contractSum: 100_000,
      downPayment: 0,
      amortizationMonths: 12,
      ratePctYear1: 12,
      currency: 'BYN',
      startMonth: 1,
    });
    const withoutSale = buildLeasingCashFlow(l, [], { year: 2026, month: 1 }, 12);
    const bigSale = sale({
      saleDate: '2026-03',
      areaMeters: 100,
      pricePerMeterUsd: 1000,
      exchangeRate: 1, // -> 100 000 BYN, покрывает почти весь остаток
      applyToLeasing: true,
    });
    const withSale = buildLeasingCashFlow(l, [bigSale], { year: 2026, month: 1 }, 12);
    // После погашения (месяц 3) оставшиеся платежи должны быть меньше, чем без погашения
    expect(withSale.cashFlow[6]).toBeLessThan(withoutSale.cashFlow[6]);
  });
});

describe('calculateFinModel — сквозные сценарии', () => {
  it('пустая модель — все итоги нулевые, без исключений', () => {
    const result = calculateFinModel(finModel());
    expect(result.totalIncome).toBe(0);
    expect(result.totalExpense).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.months).toHaveLength(12);
    expect(result.breakEvenMonth).toBeNull();
  });

  it('стабильная аренда без расходов — накопленный итог растёт каждый месяц, net = income', () => {
    const model = finModel({
      rent: rent({ areaPreMeters: 100, pricePreMeter: 20 }), // 2000/мес
    });
    const result = calculateFinModel(model);
    // Налог "от оборота" 16% с дохода (нет вычитаемых расходов, поэтому
    // режим "от прибыли" эквивалентен налогу с полного дохода — совпадает
    // с "от оборота" при 20% > 16%, выбирается более дешёвый — оборотный).
    expect(result.totalRentIncome).toBeCloseTo(2000 * 12, 6);
    expect(result.months[0].net).toBeGreaterThan(0);
    expect(result.months.every((m) => m.cumulative > 0)).toBe(true);
    expect(result.breakEvenMonth).toBeNull(); // никогда не был в минусе — не считается "выходом в плюс"
  });

  it('выбирает более дешёвый налоговый режим на каждый год отдельно', () => {
    // Доход 10000/мес, вычитаемый расход 9000/мес — от прибыли: 20%*1000=200,
    // от оборота: 16%*10000=1600 -> должен выбраться "от прибыли".
    const model = finModel({
      params: {
        startDate: '2026-01',
        horizonMonths: 1,
        taxRevenuePct: 16,
        taxProfitPct: 20,
        revenueLimitByn: 500_000,
        expenseInflationPct: null,
      },
      categories: [
        {
          id: 'inc',
          title: 'Доход',
          kind: 'income',
          entries: [
            {
              id: 'e1',
              label: 'Доход',
              amount: 10_000,
              schedule: { type: 'monthly', fromMonth: 1, toMonth: null },
              deductible: false,
              reimbursable: false,
              vatIncluded: false,
              vatPct: null,
            },
          ],
        },
        {
          id: 'exp',
          title: 'Расход',
          kind: 'expense',
          entries: [
            {
              id: 'e2',
              label: 'Расход',
              amount: 9_000,
              schedule: { type: 'monthly', fromMonth: 1, toMonth: null },
              deductible: true,
              reimbursable: false,
              vatIncluded: false,
              vatPct: null,
            },
          ],
        },
      ],
    });
    const result = calculateFinModel(model);
    expect(result.years[0].taxRegime).toBe('profit');
    expect(result.years[0].tax).toBeCloseTo(200, 6);
  });

  it('точка выхода в плюс — только после реального ухода в минус', () => {
    // Первый месяц — крупный разовый расход (минус), дальше стабильный доход отбивает его.
    const model = finModel({
      params: {
        startDate: '2026-01',
        horizonMonths: 6,
        taxRevenuePct: 0,
        taxProfitPct: 0,
        revenueLimitByn: 500_000,
        expenseInflationPct: null,
      },
      rent: rent({ areaPreMeters: 100, pricePreMeter: 100 }), // 10000/мес
      categories: [
        {
          id: 'exp',
          title: 'Разовый расход',
          kind: 'expense',
          entries: [
            {
              id: 'e1',
              label: 'Стартовые вложения',
              amount: 15_000,
              schedule: { type: 'once', fromMonth: 1, toMonth: null },
              deductible: false,
              reimbursable: false,
              vatIncluded: false,
              vatPct: null,
            },
          ],
        },
      ],
    });
    const result = calculateFinModel(model);
    expect(result.months[0].cumulative).toBeLessThan(0); // ушли в минус
    expect(result.breakEvenMonth).not.toBeNull();
    expect(result.breakEvenMonth!.cumulative).toBeGreaterThanOrEqual(0);
  });

  it('амортизация принудительно занулена (механизм на паузе) — не влияет на расчёт', () => {
    const model = finModel({ amortization: { monthlyAmount: 1000, startMonth: 1, termMonths: null } });
    const result = calculateFinModel(model);
    expect(result.totalAmortization).toBe(0);
    expect(result.months.every((m) => m.amortization === 0)).toBe(true);
  });

  it('валютный лизинг без курса помечает leasingRateMissing, но не роняет расчёт', () => {
    const model = finModel({
      leasing: leasing({ contractSum: 100_000, amortizationMonths: 12, ratePctYear1: 10, currency: 'USD', exchangeRate: null }),
    });
    const result = calculateFinModel(model);
    expect(result.leasingRateMissing).toBe(true);
    expect(result.months.every((m) => m.leasing === 0)).toBe(true);
  });
});
