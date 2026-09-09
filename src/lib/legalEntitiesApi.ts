import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import type { LegalEntity, LegalEntityRow } from '../data/legalEntities';

function fromRow(row: LegalEntityRow): LegalEntity {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name ?? '',
    cardFile: row.card_file ?? null,
    isDefault: row.is_default,
    createdAt: row.created_at,
  };
}

export function fetchLegalEntities(): Promise<LegalEntity[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('legal_entities').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data as LegalEntityRow[]).map(fromRow);
  });
}

export function insertLegalEntity(name: string): Promise<LegalEntity> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('legal_entities').insert({ name }).select().single();
    if (error) throw error;
    return fromRow(data as LegalEntityRow);
  });
}

export function updateLegalEntity(
  id: string,
  input: { name: string; shortName: string; cardFile: LegalEntity['cardFile'] },
): Promise<LegalEntity> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('legal_entities')
      .update({ name: input.name, short_name: input.shortName || null, card_file: input.cardFile })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as LegalEntityRow);
  });
}

// Ровно одно юрлицо по умолчанию — не ограничение в БД (проще, чем частичный
// уникальный индекс ради разовой админской операции), а два последовательных
// запроса: сначала снимаем флаг со всех остальных, потом ставим у выбранного.
// Список entities передаётся, чтобы не делать лишний fetch — вызывающий код
// и так уже держит его в стейте.
export async function setLegalEntityDefault(id: string, entities: LegalEntity[]): Promise<LegalEntity[]> {
  const others = entities.filter((e) => e.id !== id && e.isDefault);
  await Promise.all(
    others.map((e) => supabase.from('legal_entities').update({ is_default: false }).eq('id', e.id)),
  );
  const { data, error } = await supabase.from('legal_entities').update({ is_default: true }).eq('id', id).select().single();
  if (error) throw error;
  const updated = fromRow(data as LegalEntityRow);
  return entities.map((e) => (e.id === id ? updated : { ...e, isDefault: e.id === id }));
}

// Тот же бакет/приём, что и у uploadSupplierFile (lib/supplierResearchApi.ts) —
// общий публичный бакет object-documents под произвольные файлы админки.
export function uploadLegalEntityCardFile(file: File): Promise<LegalEntity['cardFile']> {
  return withRetry(
    async () => {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('object-documents').upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from('object-documents').getPublicUrl(path);
      return { url: data.publicUrl, fileName: file.name };
    },
    1500,
    UPLOAD_TIMEOUT_MS,
    3,
  );
}

// Каскад на legal_entity_id (см. миграцию) сам чистит декларации этого юрлица.
// supplier_research_requests.legal_entity_id — ON DELETE SET NULL, категория
// просто вернётся к юрлицу по умолчанию, не сломается.
export function deleteLegalEntity(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('legal_entities').delete().eq('id', id);
    if (error) throw error;
  });
}
