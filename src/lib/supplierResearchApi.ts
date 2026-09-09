import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import { queueImageCompression } from './tinypngCompress';
import type {
  SupplierRequest,
  SupplierRequestRow,
  SupplierRequestGroup,
  SupplierOffer,
  SupplierOfferRow,
  ResearchContactMethod,
} from '../data/supplierResearch';
import type { DocumentFile } from '../data/contractorDocuments';
import type { Currency } from '../data/transactions';
import type { PurchaseItem } from '../data/purchases';

function requestFromRow(row: SupplierRequestRow): SupplierRequest {
  return {
    id: row.id,
    title: row.title,
    group: (row.category_group as SupplierRequestGroup) || 'materials',
    estimateId: row.estimate_id,
    sectionId: row.section_id,
    sectionTitle: row.section_title ?? '',
    items: row.items ?? [],
    legalEntityId: row.legal_entity_id ?? null,
    createdAt: row.created_at,
  };
}

function offerFromRow(row: SupplierOfferRow): SupplierOffer {
  return {
    id: row.id,
    requestId: row.request_id,
    name: row.name,
    contact: row.contact,
    contactMethod: row.contact_method as ResearchContactMethod,
    email: row.email ?? '',
    managerName: row.manager_name ?? '',
    country: row.country ?? '',
    websiteUrl: row.website_url,
    catalogModelName: row.catalog_model_name,
    catalogModelPhoto: row.catalog_model_photo,
    price: row.price,
    currency: row.currency as Currency,
    items: row.items ?? [],
    files: row.files ?? [],
    shortCode: row.short_code,
    verified: row.verified,
    createdAt: row.created_at,
  };
}

export function fetchSupplierRequests(): Promise<SupplierRequest[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('supplier_research_requests').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data as SupplierRequestRow[]).map(requestFromRow);
  });
}

export interface SupplierRequestInput {
  title: string;
  group: SupplierRequestGroup;
  estimateId: string | null;
  sectionId: string | null;
  sectionTitle: string;
  items: PurchaseItem[];
  legalEntityId: string | null;
}

export function insertSupplierRequest(input: SupplierRequestInput): Promise<SupplierRequest> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_research_requests')
      .insert({
        title: input.title,
        category_group: input.group,
        estimate_id: input.estimateId,
        section_id: input.sectionId,
        section_title: input.sectionTitle,
        items: input.items,
        legal_entity_id: input.legalEntityId,
      })
      .select()
      .single();
    if (error) throw error;
    return requestFromRow(data as SupplierRequestRow);
  });
}

export function updateSupplierRequest(id: string, input: SupplierRequestInput): Promise<SupplierRequest> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_research_requests')
      .update({
        title: input.title,
        category_group: input.group,
        estimate_id: input.estimateId,
        section_id: input.sectionId,
        section_title: input.sectionTitle,
        items: input.items,
        legal_entity_id: input.legalEntityId,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return requestFromRow(data as SupplierRequestRow);
  });
}

// Каскад на request_id (см. миграцию) сам чистит предложения этого запроса.
export function deleteSupplierRequest(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('supplier_research_requests').delete().eq('id', id);
    if (error) throw error;
  });
}

// Все предложения сразу, группировка по requestId на клиенте — тот же
// принцип, что и у fetchResearchOffers (contractorResearchApi.ts).
export function fetchSupplierOffers(): Promise<SupplierOffer[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('supplier_research_offers').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data as SupplierOfferRow[]).map(offerFromRow);
  });
}

export function insertSupplierOffer(input: Omit<SupplierOffer, 'id' | 'createdAt' | 'shortCode'>): Promise<SupplierOffer> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_research_offers')
      .insert({
        request_id: input.requestId,
        name: input.name,
        contact: input.contact,
        contact_method: input.contactMethod,
        email: input.email,
        manager_name: input.managerName,
        country: input.country,
        website_url: input.websiteUrl,
        catalog_model_name: input.catalogModelName,
        catalog_model_photo: input.catalogModelPhoto,
        price: input.price,
        currency: input.currency,
        items: input.items,
        files: input.files,
        verified: input.verified,
      })
      .select()
      .single();
    if (error) throw error;
    return offerFromRow(data as SupplierOfferRow);
  });
}

export function updateSupplierOffer(id: string, input: Omit<SupplierOffer, 'id' | 'createdAt' | 'shortCode'>): Promise<SupplierOffer> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('supplier_research_offers')
      .update({
        request_id: input.requestId,
        name: input.name,
        contact: input.contact,
        contact_method: input.contactMethod,
        email: input.email,
        manager_name: input.managerName,
        country: input.country,
        website_url: input.websiteUrl,
        catalog_model_name: input.catalogModelName,
        catalog_model_photo: input.catalogModelPhoto,
        price: input.price,
        currency: input.currency,
        items: input.items,
        files: input.files,
        verified: input.verified,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return offerFromRow(data as SupplierOfferRow);
  });
}

export function deleteSupplierOffer(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('supplier_research_offers').delete().eq('id', id);
    if (error) throw error;
  });
}

// Файлы (модель в каталоге — фото, область для прикреплённых файлов) —
// тот же бакет и приём, что и у uploadObjectDocument (объекты, юрлица,
// "Авангард" и т.п.): один общий публичный бакет под произвольные файлы
// админки, заводить отдельный под поставщиков незачем.
export function uploadSupplierFile(file: File): Promise<DocumentFile> {
  return withRetry(
    async () => {
      const ext = file.name.split('.').pop() ?? 'bin';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('object-documents').upload(path, file);
      if (error) throw error;
      queueImageCompression('object-documents', path);
      const { data } = supabase.storage.from('object-documents').getPublicUrl(path);
      return { url: data.publicUrl, fileName: file.name };
    },
    1500,
    UPLOAD_TIMEOUT_MS,
    3,
  );
}
