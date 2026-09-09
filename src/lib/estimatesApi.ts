import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { estimateStatuses, type Estimate, type EstimateQuestion, type EstimateRow, type EstimateSection } from '../data/estimates';

function fromRow(row: EstimateRow): Estimate {
  return {
    id: row.id,
    objectId: row.object_id,
    title: row.title ?? null,
    // positions/manufacturer/model/price добавили позже body — у строк,
    // сохранённых до этого, их нет в JSONB вообще, а не пустое значение.
    // price (единое поле "Цена, $") — более старая форма, чем priceByn/
    // priceRub/priceUsd: то, что в ней успели сохранить, переносим в USD.
    sections: (row.sections ?? []).map((s) => ({
      ...s,
      deferred: s.deferred ?? false,
      floor: s.floor ?? null,
      lineItems: (s.lineItems ?? []).map((li) => ({
        ...li,
        comments: li.comments ?? [],
        deferred: li.deferred ?? false,
        // Все строки, сохранённые до появления currency (в т.ч. импорт из
        // xlsx подрядчика), считались в BYN — это единственная валюта,
        // которая была раньше.
        currency: li.currency ?? 'BYN',
      })),
      materials: (s.materials ?? []).map((m) => ({ ...m, comments: m.comments ?? [], group: m.group ?? '' })),
      materialListFiles: s.materialListFiles ?? [],
      materialFiles: s.materialFiles ?? [],
      positions: (s.positions ?? []).map((p) => ({
        ...p,
        colors: p.colors ?? [],
        dimensions: (p.dimensions ?? []).map((d) => ({ ...d, windowsArea: d.windowsArea ?? null })),
        products: p.products.map((prod) => {
          const legacyPrice = (prod as unknown as { price?: number | null }).price;
          return {
            ...prod,
            manufacturer: prod.manufacturer ?? '',
            model: prod.model ?? '',
            priceByn: prod.priceByn ?? null,
            priceRub: prod.priceRub ?? null,
            priceUsd: prod.priceUsd ?? legacyPrice ?? null,
          };
        }),
      })),
    })),
    questions: row.questions ?? [],
    status: row.status ?? estimateStatuses[0],
    shareToken: row.share_token,
    floor2Deferred: row.floor2_deferred ?? false,
    createdAt: row.created_at,
  };
}

export function fetchEstimates(): Promise<Estimate[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('estimates').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data as EstimateRow[]).map(fromRow);
  });
}

export function fetchEstimate(id: string): Promise<Estimate> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('estimates').select('*').eq('id', id).single();
    if (error) throw error;
    return fromRow(data as EstimateRow);
  });
}

// Публичная страница /estimate/:token (EstimatePublicPage.tsx) — по
// share_token, не по внутреннему id, тот же паттерн, что fetchBriefByToken.
export function fetchEstimateByToken(token: string): Promise<Estimate> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('estimates').select('*').eq('share_token', token).single();
    if (error) throw error;
    return fromRow(data as EstimateRow);
  });
}

export function insertEstimate(input: {
  objectId: string | null;
  title?: string | null;
  sections: EstimateSection[];
  questions: EstimateQuestion[];
  status: string;
}): Promise<Estimate> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('estimates')
      .insert({
        object_id: input.objectId,
        title: input.title ?? null,
        sections: input.sections,
        questions: input.questions,
        status: input.status,
      })
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as EstimateRow);
  });
}

export function updateEstimate(
  id: string,
  input: { sections: EstimateSection[]; questions: EstimateQuestion[]; status: string; floor2Deferred: boolean },
): Promise<Estimate> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('estimates')
      .update({
        sections: input.sections,
        questions: input.questions,
        status: input.status,
        floor2_deferred: input.floor2Deferred,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as EstimateRow);
  });
}

export function deleteEstimate(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('estimates').delete().eq('id', id);
    if (error) throw error;
  });
}
