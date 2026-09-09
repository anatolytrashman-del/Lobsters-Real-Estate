import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { MaterialLedger, MaterialLedgerRow } from '../data/materialLedgers';

function fromRow(row: MaterialLedgerRow): MaterialLedger {
  return {
    id: row.id,
    name: row.name,
    items: row.items ?? [],
    estimateId: row.estimate_id ?? null,
    createdAt: row.created_at,
  };
}

export function fetchMaterialLedgers(): Promise<MaterialLedger[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('material_ledgers').select('*').order('name', { ascending: true });
    if (error) throw error;
    return (data as MaterialLedgerRow[]).map(fromRow);
  });
}

export function insertMaterialLedger(input: Omit<MaterialLedger, 'id' | 'createdAt'>): Promise<MaterialLedger> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('material_ledgers')
      .insert({ name: input.name, items: input.items, estimate_id: input.estimateId })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as MaterialLedgerRow);
  });
}

export function updateMaterialLedger(id: string, input: Omit<MaterialLedger, 'id' | 'createdAt'>): Promise<MaterialLedger> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('material_ledgers')
      .update({ name: input.name, items: input.items, estimate_id: input.estimateId })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as MaterialLedgerRow);
  });
}

export function deleteMaterialLedger(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('material_ledgers').delete().eq('id', id);
    if (error) throw error;
  });
}
