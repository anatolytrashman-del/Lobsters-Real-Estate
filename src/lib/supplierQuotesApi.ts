import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { SupplierQuote, SupplierQuoteRow } from '../data/supplierQuotes';
import type { Currency } from '../data/transactions';
import type { PurchaseItem } from '../data/purchases';

function fromRow(row: SupplierQuoteRow): SupplierQuote {
  return {
    id: row.id,
    offerId: row.offer_id,
    title: row.title,
    price: row.price,
    currency: row.currency as Currency,
    items: row.items ?? [],
    files: row.files ?? [],
    isAlternative: row.is_alternative,
    alternativeNote: row.alternative_note ?? '',
    sourceEmailId: row.source_email_id,
    createdAt: row.created_at,
  };
}

// Все КП сразу, группировка по offerId на клиенте — тот же принцип, что и у
// fetchSupplierOrders.
export function fetchSupplierQuotes(): Promise<SupplierQuote[]> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_offer_quotes')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data as SupplierQuoteRow[]).map(fromRow);
  });
}

export function insertSupplierQuote(input: Omit<SupplierQuote, 'id' | 'createdAt'>): Promise<SupplierQuote> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_offer_quotes')
      .insert({
        offer_id: input.offerId,
        title: input.title,
        price: input.price,
        currency: input.currency,
        items: input.items,
        files: input.files,
        is_alternative: input.isAlternative,
        alternative_note: input.alternativeNote,
        source_email_id: input.sourceEmailId,
      })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as SupplierQuoteRow);
  });
}

export function updateSupplierQuote(id: string, input: Omit<SupplierQuote, 'id' | 'createdAt'>): Promise<SupplierQuote> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_offer_quotes')
      .update({
        offer_id: input.offerId,
        title: input.title,
        price: input.price,
        currency: input.currency,
        items: input.items,
        files: input.files,
        is_alternative: input.isAlternative,
        alternative_note: input.alternativeNote,
        source_email_id: input.sourceEmailId,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as SupplierQuoteRow);
  });
}

// Точечное обновление только позиций КП — нужно для сверки со сметой уже
// ПОСЛЕ автоматической записи счёта (владелец, 2026-09-12: запись в базу
// не должна ждать ручного подтверждения, но сопоставление позиций со
// сметой по-прежнему делает человек). Целиком КП тут не нужен: в переписке
// его объекта нет, а тянуть строку ради перезаписи одного поля — лишний
// запрос и лишний шанс затереть то, что параллельно поправили в карточке.
export function updateSupplierQuoteItems(id: string, items: PurchaseItem[]): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('supplier_offer_quotes').update({ items }).eq('id', id);
    if (error) throw error;
  });
}

export function deleteSupplierQuote(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('supplier_offer_quotes').delete().eq('id', id);
    if (error) throw error;
  });
}
