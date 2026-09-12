import { badgeColor } from '../lib/badgeColor';

export const currencies = ['RUB', 'USD', 'EUR', 'BYN'] as const;
export type Currency = (typeof currencies)[number];

export const currencySymbols: Record<Currency, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  BYN: 'Br',
};

// Стартовый набор категорий. Список открытый — новые категории можно
// добавлять прямо из формы транзакции (см. Transactions.tsx), поэтому
// тип Category ниже — обычный string, а не фиксированный union.
export const categories = ['Маркетинг', 'IT-инфраструктура', 'Поездки в Минск', 'Консультации'] as const;
export type Category = string;

// Подкатегории — только для расходов, привязаны к конкретной категории
// (не общий список на все категории сразу). Список открытый и per-категория,
// как и сами категории — новые подкатегории добавляются прямо из формы
// (см. Transactions.tsx), это только стартовый набор.
export const subcategoriesByCategory: Record<string, readonly string[]> = {
  'Ремонтные работы': ['Электрика'],
};

// Категории для операций дохода — отдельный (растущий) список, как и
// категории расходов выше; список расходных категорий при этом не меняется.
export const incomeCategories = ['Сдача недвижимости в аренду'] as const;

// Кто может платить/получать деньги в разделе "Транзакции" — раньше было
// четырьмя захардкоженными массивами прямо здесь (splitPayers/soloPayers/
// payers/incomePayers). Теперь берётся из общей таблицы people (см.
// data/people.ts, lib/peopleApi.ts) — у каждого человека там свои флаги
// (isSplitPayer/isSoloPayer/isIncomePayer), Transactions.tsx строит эти
// списки из fetchPeople(). Один и тот же человек может быть сразу и
// соло-должником, и плательщиком дохода — это независимые роли, не
// взаимоисключающий выбор (см. Влад Ждонец в таблице).
export type Payer = string;

// Готовые варианты "Откуда платил". Список открытый, как и категории —
// новые источники добавляются прямо из формы транзакции.
// 2026-09-12: "Альфа" убрана по просьбе владельца — два её платежа (предоплата
// за квартиру в Минске, 12–13.08) переведены миграцией на "Личные деньги",
// так что источник исчез и из базы, а не только из этого пресета.
export const sources = ['Т-Банк', 'Личные деньги'] as const;

export const categoryColor = badgeColor;

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: Currency;
  purpose: string;
  category: Category;
  // Пусто — подкатегория не указана (не для всех категорий она вообще
  // заведена) или транзакция дохода, где подкатегорий нет.
  subcategory: string;
  paidBy: Payer;
  paidFrom: string;
  compensated: boolean;
  // Дата, на которую зафиксирован курс валюты этой транзакции к USD (см.
  // exchangeRatesApi.ts/currencyConvert.ts) — дата СОХРАНЕНИЯ записи, не
  // дата самой транзакции (см. развёрнутый комментарий в Transactions.tsx
  // у места, где эта дата проставляется). Не редактируется из формы.
  rateDate: string;
}

// Форма строки в таблице Supabase (snake_case-колонки) — см. src/lib/transactionsApi.ts
export interface TransactionRow {
  id: string;
  date: string;
  amount: number;
  currency: Currency;
  purpose: string;
  category: string;
  subcategory: string | null;
  paid_by: string;
  paid_from: string;
  compensated: boolean;
  rate_date: string | null;
}
