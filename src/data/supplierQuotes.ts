import type { Currency } from './transactions';
import type { DocumentFile } from './contractorDocuments';
import type { PurchaseItem } from './purchases';

// Владелец, 2026-09-11: "у нас от Грильято мастер один счет или несколько?
// Такое ощущение, что он предлагал альтернативы, но в сравнении цен виден
// только 1 заказ с минимальной ценой. Надо бы показывать все".
//
// До этого несколько счетов от ОДНОГО поставщика в одной ветке переписки
// схлопывались в карточку предложения: applyExtractionToOffer перезаписывал
// offer.price ценой последнего распознанного счёта, а позиции складывал в
// общую кучу (`items: [...offer.items, ...newItems]`) — то есть в карточке
// оказывалась цена одного КП и позиции сразу всех. SupplierOrder для этого
// не подходит: там "1 заявка — одна ветка", своя переписка со своим адресом,
// а тут несколько КП приходят в ОДНОМ треде.
//
// Отсюда отдельная сущность: одно распознанное КП (счёт) = одна строка.
// Карточка предложения продолжает показывать основное КП (см. offer.price),
// а все варианты целиком живут здесь.
export interface SupplierQuote {
  id: string;
  offerId: string;
  // Обычно тема письма со счётом ("Счет на оплату покупателю № 1806 от
  // 10 сентября 2026 г.") — по ней человек узнаёт КП в списке.
  title: string;
  price: number;
  currency: Currency;
  items: PurchaseItem[];
  files: DocumentFile[];
  // Владелец, 2026-09-11: "если указано, что это альтернатива, давай прямо
  // возле поставки выводить уведомление". Реальный случай: ГРИЛЬЯТО-Мастер
  // прислал счёт на 748 190 ₽ со словами "это аналог из стали, бюджетнее
  // вариант" — профиль h30 из оцинковки вместо h40 (у части конкурентов ещё
  // и алюминий). По сумме он выходил самым дешёвым в категории и получал
  // бейдж "лучшая цена", хотя это просто другой товар. Флаг ставит человек:
  // по данным счёта отличить "аналог" от "ровно то, что просили" нельзя.
  isAlternative: boolean;
  // Чем именно отличается от запрошенного ("сталь h30 вместо алюминия h40").
  // Показывается рядом с ценой в сравнении — чтобы разница была видна там,
  // где принимают решение, а не только внутри карточки.
  alternativeNote: string;
  // Письмо, из которого КП распознано (null — если письмо потом удалили или
  // КП завели руками).
  sourceEmailId: string | null;
  createdAt: string;
}

export interface SupplierQuoteRow {
  id: string;
  offer_id: string;
  title: string;
  price: number;
  currency: string;
  items: PurchaseItem[] | null;
  files: DocumentFile[] | null;
  is_alternative: boolean;
  alternative_note: string | null;
  source_email_id: string | null;
  created_at: string;
}

// Сумма КП: у распознанных счетов price приходит итогом из документа, но если
// его не удалось вытащить (бывает — в счёте только построчная разбивка),
// считаем по позициям, иначе КП покажется бесплатным.
export function quoteTotal(quote: SupplierQuote, itemTotal: (item: PurchaseItem) => number): number {
  if (quote.price > 0) return quote.price;
  return quote.items.reduce((sum, item) => sum + itemTotal(item), 0);
}
