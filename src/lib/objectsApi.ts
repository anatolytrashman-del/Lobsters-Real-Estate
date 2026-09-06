import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import { compressImageIfNeeded } from './imageCompress';
import { queueImageCompression } from './tinypngCompress';
import { authFetch } from './authFetch';
import type { ContactChannel, RealtyObject, RealtyObjectRow } from '../data/objects';

// Пререндеренный при сборке HTML публичных лендингов (scripts/prerender.mjs,
// SEO_PLAN.md Э2-1) хранит title/meta/цену объекта на момент последней
// сборки — без этого хука они протухали бы до следующего обычного пуша.
// Best-effort, не блокирует сохранение объекта в админке: ошибку/недоступный
// хук просто глотаем, api/trigger-rebuild.js сам логирует детали.
function triggerPublicRebuild() {
  authFetch('/api/trigger-rebuild', { method: 'POST' }).catch(() => {});
}

function fromRow(row: RealtyObjectRow): RealtyObject {
  return {
    id: row.id,
    name: row.name ?? '',
    status: row.status ?? '',
    address: row.address,
    area: row.area,
    startPrice: row.start_price,
    photoUrls: row.photo_urls ?? [],
    floorPlanUrls: row.floor_plan_urls ?? [],
    listingUrl: row.listing_url,
    owner: row.owner,
    ownerContact: row.owner_contact,
    contactName: row.contact_name ?? '',
    contactPosition: row.contact_position ?? '',
    contactChannel: (row.contact_channel as ContactChannel | null) ?? '',
    additionalContacts: row.additional_contacts ?? [],
    notes: row.notes,
    concept: row.concept ?? '',
    demandLinks: row.demand_links ?? [],
    inspectionMediaUrl: row.inspection_media_url ?? '',
    buildingPlanIds: row.building_plan_ids ?? [],
    buildingSpecs: row.building_specs ?? null,
    documents: row.documents ?? {},
    shareToken: row.share_token,
    landingSlug: row.landing_slug ?? '',
    renderImageUrls: row.render_image_urls ?? [],
    intentAgreementFile: row.intent_agreement_file ?? null,
    mapEmbedUrl: row.map_embed_url ?? '',
    priority: row.priority ?? false,
    paused: row.paused ?? false,
  };
}

export function fetchObjects(): Promise<RealtyObject[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('objects').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    // Приоритетные — первыми, внутри каждой группы порядок как из базы
    // (по дате создания, см. .order выше) — Array.sort стабильна.
    return (data as RealtyObjectRow[]).map(fromRow).sort((a, b) => Number(b.priority) - Number(a.priority));
  });
}

export function fetchObject(id: string): Promise<RealtyObject> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('objects').select('*').eq('id', id).single();
    if (error) throw error;
    return fromRow(data as RealtyObjectRow);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Для /admin/objects/:idOrSlug — тот же landingSlug, что и в продающей
// ссылке (/:slug), теперь работает и во внутреннем адресе объекта, чтобы не
// таскать длинный uuid. Определяем колонку по формату значения — сравнение
// id (uuid-колонка) со строкой не в формате uuid упадёт ошибкой на стороне
// Postgres, поэтому не пробуем оба варианта одним запросом.
export function fetchObjectByIdOrSlug(idOrSlug: string): Promise<RealtyObject> {
  return withRetry(async () => {
    const column = UUID_RE.test(idOrSlug) ? 'id' : 'landing_slug';
    const { data, error } = await supabase.from('objects').select('*').eq(column, idOrSlug).single();
    if (error) throw error;
    return fromRow(data as RealtyObjectRow);
  });
}

// Для публичной страницы планировки (/plan/:token) — ищем по непредсказуемому
// share_token, а не по внутреннему id объекта (см. комментарий у RealtyObject.shareToken).
export function fetchObjectByShareToken(token: string): Promise<RealtyObject> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('objects').select('*').eq('share_token', token).single();
    if (error) throw error;
    return fromRow(data as RealtyObjectRow);
  });
}

// Для продающей страницы объекта (/:slug) — ищем по короткому читаемому
// landing_slug, а не по id (см. комментарий у RealtyObject.landingSlug).
export function fetchObjectByLandingSlug(slug: string): Promise<RealtyObject> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('objects').select('*').eq('landing_slug', slug).single();
    if (error) throw error;
    return fromRow(data as RealtyObjectRow);
  });
}

export function insertObject(input: Omit<RealtyObject, 'id' | 'shareToken'>): Promise<RealtyObject> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('objects')
      .insert({
        name: input.name.trim() || null,
        status: input.status || null,
        address: input.address,
        area: input.area,
        start_price: input.startPrice,
        photo_urls: input.photoUrls,
        floor_plan_urls: input.floorPlanUrls,
        listing_url: input.listingUrl,
        owner: input.owner,
        owner_contact: input.ownerContact,
        contact_name: input.contactName || null,
        contact_position: input.contactPosition || null,
        contact_channel: input.contactChannel || null,
        additional_contacts: input.additionalContacts,
        notes: input.notes,
        concept: input.concept,
        demand_links: input.demandLinks,
        inspection_media_url: input.inspectionMediaUrl || null,
        building_plan_ids: input.buildingPlanIds,
        building_specs: input.buildingSpecs,
        documents: input.documents,
        landing_slug: input.landingSlug.trim() || null,
        render_image_urls: input.renderImageUrls,
        intent_agreement_file: input.intentAgreementFile,
        map_embed_url: input.mapEmbedUrl.trim() || null,
        priority: input.priority,
        paused: input.paused,
      })
      .select()
      .single();

    if (error) throw error;
    if (input.landingSlug.trim()) triggerPublicRebuild();
    return fromRow(data as RealtyObjectRow);
  });
}

export function updateObject(id: string, input: Omit<RealtyObject, 'id' | 'shareToken'>): Promise<RealtyObject> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('objects')
      .update({
        name: input.name.trim() || null,
        status: input.status || null,
        address: input.address,
        area: input.area,
        start_price: input.startPrice,
        photo_urls: input.photoUrls,
        floor_plan_urls: input.floorPlanUrls,
        listing_url: input.listingUrl,
        owner: input.owner,
        owner_contact: input.ownerContact,
        contact_name: input.contactName || null,
        contact_position: input.contactPosition || null,
        contact_channel: input.contactChannel || null,
        additional_contacts: input.additionalContacts,
        notes: input.notes,
        concept: input.concept,
        demand_links: input.demandLinks,
        inspection_media_url: input.inspectionMediaUrl || null,
        building_plan_ids: input.buildingPlanIds,
        building_specs: input.buildingSpecs,
        documents: input.documents,
        landing_slug: input.landingSlug.trim() || null,
        render_image_urls: input.renderImageUrls,
        intent_agreement_file: input.intentAgreementFile,
        map_embed_url: input.mapEmbedUrl.trim() || null,
        priority: input.priority,
        paused: input.paused,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (input.landingSlug.trim()) triggerPublicRebuild();
    return fromRow(data as RealtyObjectRow);
  });
}

export async function uploadObjectImage(file: File): Promise<string> {
  const toUpload = await compressImageIfNeeded(file);
  return withRetry(
    async () => {
      const ext = toUpload.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('object-photos').upload(path, toUpload);
      if (error) throw error;
      queueImageCompression('object-photos', path);
      const { data } = supabase.storage.from('object-photos').getPublicUrl(path);
      return data.publicUrl;
    },
    1500,
    UPLOAD_TIMEOUT_MS,
    3,
  );
}

export function uploadObjectDocument(file: File): Promise<{ url: string; fileName: string }> {
  return withRetry(
    async () => {
      const ext = file.name.split('.').pop() ?? 'pdf';
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
