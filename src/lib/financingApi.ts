import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import { compressImageIfNeeded } from './imageCompress';
import { queueImageCompression } from './tinypngCompress';
import type { FinancingOffer, FinancingOfferRow } from '../data/financing';

// Логотип банка — не приватные данные (в отличие от фото лида/подрядчика),
// поэтому публичный бакет с публичным URL в базе, тот же паттерн, что у
// object-photos (см. uploadObjectImage в objectsApi.ts) — без подписанных
// ссылок и их истечения.
const FINANCING_LOGOS_BUCKET = 'financing-logos';

function fromRow(row: FinancingOfferRow): FinancingOffer {
  return {
    id: row.id,
    logoUrl: row.logo_url ?? '',
    bankName: row.bank_name,
    creditName: row.credit_name ?? '',
    website: row.website ?? '',
    generalEmail: row.general_email ?? '',
    managerName: row.manager_name ?? '',
    managerContact: row.manager_contact ?? '',
    rateOffer: row.rate_offer ?? '',
    maxTerm: row.max_term ?? '',
    bankResponse: row.bank_response ?? '',
    status: row.status,
    createdAt: row.created_at,
  };
}

export function fetchFinancingOffers(): Promise<FinancingOffer[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('financing_offers').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data as FinancingOfferRow[]).map(fromRow);
  });
}

export function insertFinancingOffer(input: Omit<FinancingOffer, 'id' | 'createdAt'>): Promise<FinancingOffer> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('financing_offers')
      .insert({
        logo_url: input.logoUrl || null,
        bank_name: input.bankName,
        credit_name: input.creditName || null,
        website: input.website || null,
        general_email: input.generalEmail || null,
        manager_name: input.managerName || null,
        manager_contact: input.managerContact || null,
        rate_offer: input.rateOffer || null,
        max_term: input.maxTerm || null,
        bank_response: input.bankResponse || null,
        status: input.status,
      })
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as FinancingOfferRow);
  });
}

export function updateFinancingOffer(id: string, input: Omit<FinancingOffer, 'id' | 'createdAt'>): Promise<FinancingOffer> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('financing_offers')
      .update({
        logo_url: input.logoUrl || null,
        bank_name: input.bankName,
        credit_name: input.creditName || null,
        website: input.website || null,
        general_email: input.generalEmail || null,
        manager_name: input.managerName || null,
        manager_contact: input.managerContact || null,
        rate_offer: input.rateOffer || null,
        max_term: input.maxTerm || null,
        bank_response: input.bankResponse || null,
        status: input.status,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as FinancingOfferRow);
  });
}

export function deleteFinancingOffer(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('financing_offers').delete().eq('id', id);
    if (error) throw error;
  });
}

export async function uploadFinancingLogo(file: File): Promise<string> {
  const toUpload = await compressImageIfNeeded(file);
  return withRetry(
    async () => {
      const ext = toUpload.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(FINANCING_LOGOS_BUCKET).upload(path, toUpload);
      if (error) throw error;
      queueImageCompression(FINANCING_LOGOS_BUCKET, path);
      const { data } = supabase.storage.from(FINANCING_LOGOS_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    },
    1500,
    UPLOAD_TIMEOUT_MS,
    3,
  );
}
