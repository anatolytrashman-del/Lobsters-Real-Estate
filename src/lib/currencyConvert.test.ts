import { describe, expect, it } from 'vitest';
import { convertToUsd, convertToEur, convertFromEur, convertToByn } from './currencyConvert';
import type { ExchangeRate } from '../data/exchangeRates';

// Курс из реального формата ExchangeRate (usdByn/eurByn/rubByn — BYN за
// единицу валюты, см. комментарии в самом currencyConvert.ts).
const rate: ExchangeRate = { date: '2026-01-01', usdByn: 3.2, eurByn: 3.5, rubByn: 0.035 };

describe('convertToUsd', () => {
  it('USD остаётся как есть, даже без курса', () => {
    expect(convertToUsd(100, 'USD', undefined)).toBe(100);
  });

  it('BYN переводится в USD по курсу доллара', () => {
    expect(convertToUsd(320, 'BYN', rate)).toBeCloseTo(100, 6);
  });

  it('EUR переводится через BYN-мостик', () => {
    // 100 EUR -> 350 BYN -> 350/3.2 USD
    expect(convertToUsd(100, 'EUR', rate)).toBeCloseTo(350 / 3.2, 6);
  });

  it('без курса для не-USD валюты возвращает null, не 0', () => {
    expect(convertToUsd(100, 'BYN', undefined)).toBeNull();
    expect(convertToUsd(100, 'EUR', undefined)).toBeNull();
  });
});

describe('convertToEur', () => {
  it('EUR остаётся как есть', () => {
    expect(convertToEur(100, 'EUR', null)).toBe(100);
  });

  it('USD переводится через BYN-мостик', () => {
    // 100 USD -> 320 BYN -> 320/3.5 EUR
    expect(convertToEur(100, 'USD', rate)).toBeCloseTo(320 / 3.5, 6);
  });

  it('без курса для не-EUR валюты — null', () => {
    expect(convertToEur(100, 'USD', null)).toBeNull();
  });
});

describe('convertFromEur', () => {
  it('в EUR — тождество', () => {
    expect(convertFromEur(100, 'EUR', rate)).toBe(100);
  });

  it('в BYN — просто умножение на курс евро', () => {
    expect(convertFromEur(100, 'BYN', rate)).toBeCloseTo(350, 6);
  });

  it('в USD — через BYN-мостик обратно', () => {
    // 100 EUR -> 350 BYN -> 350/3.2 USD
    expect(convertFromEur(100, 'USD', rate)).toBeCloseTo(350 / 3.2, 6);
  });

  it('без курса — null', () => {
    expect(convertFromEur(100, 'USD', null)).toBeNull();
  });

  it('туда-обратно (EUR -> USD -> EUR) даёт исходную сумму', () => {
    const usd = convertFromEur(100, 'USD', rate)!;
    const backToEur = convertToEur(usd, 'USD', rate)!;
    expect(backToEur).toBeCloseTo(100, 6);
  });
});

describe('convertToByn', () => {
  it('BYN не требует курса вовсе', () => {
    expect(convertToByn(100, 'BYN', null)).toBe(100);
    expect(convertToByn(100, 'BYN', undefined)).toBe(100);
  });

  it('USD/EUR/RUB умножаются на свой курс', () => {
    expect(convertToByn(100, 'USD', rate)).toBeCloseTo(320, 6);
    expect(convertToByn(100, 'EUR', rate)).toBeCloseTo(350, 6);
    expect(convertToByn(100, 'RUB', rate)).toBeCloseTo(3.5, 6);
  });

  it('без курса для не-BYN валюты — null (не 0, не молчаливая потеря суммы)', () => {
    expect(convertToByn(100, 'USD', null)).toBeNull();
    expect(convertToByn(100, 'USD', undefined)).toBeNull();
  });
});
