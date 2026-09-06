import { supabase } from './supabase';
import { withRetry } from './withRetry';
import type { BusinessCenter, BusinessCenterRow } from '../data/businessCenters';

function fromRow(row: BusinessCenterRow): BusinessCenter {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    address: row.address,
    district: row.district,
    businessClass: (row.business_class as BusinessCenter['businessClass']) ?? null,
    totalArea: row.total_area,
    yearBuilt: row.year_built,
    floors: row.floors,
    developer: row.developer,
    metro: row.metro,
    parking: row.parking,
    website: row.website,
    description: row.description,
    rentalInfo: row.rental_info,
    highlights: row.highlights ?? [],
    mapSnapshotFiles: row.map_snapshot_files ?? [],
    tenantOrganizations: row.tenant_organizations ?? [],
    technicalParams: row.technical_params ?? [],
    nearestMetroStations: row.nearest_metro_stations ?? [],
    photos: row.photos ?? [],
    status: (row.status as BusinessCenter['status']) ?? 'built',
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function fetchBusinessCenters(): Promise<BusinessCenter[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('business_centers').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data as BusinessCenterRow[]).map(fromRow);
  });
}

type BusinessCenterInput = Omit<BusinessCenter, 'id' | 'createdAt'>;

function toPayload(input: Partial<BusinessCenterInput>) {
  const payload: Record<string, unknown> = {};
  if (input.slug !== undefined) payload.slug = input.slug;
  if (input.name !== undefined) payload.name = input.name;
  if (input.address !== undefined) payload.address = input.address;
  if (input.district !== undefined) payload.district = input.district;
  if (input.businessClass !== undefined) payload.business_class = input.businessClass;
  if (input.totalArea !== undefined) payload.total_area = input.totalArea;
  if (input.yearBuilt !== undefined) payload.year_built = input.yearBuilt;
  if (input.floors !== undefined) payload.floors = input.floors;
  if (input.developer !== undefined) payload.developer = input.developer;
  if (input.metro !== undefined) payload.metro = input.metro;
  if (input.parking !== undefined) payload.parking = input.parking;
  if (input.website !== undefined) payload.website = input.website;
  if (input.description !== undefined) payload.description = input.description;
  if (input.rentalInfo !== undefined) payload.rental_info = input.rentalInfo;
  if (input.highlights !== undefined) payload.highlights = input.highlights;
  if (input.mapSnapshotFiles !== undefined) payload.map_snapshot_files = input.mapSnapshotFiles;
  if (input.tenantOrganizations !== undefined) payload.tenant_organizations = input.tenantOrganizations;
  if (input.technicalParams !== undefined) payload.technical_params = input.technicalParams;
  if (input.nearestMetroStations !== undefined) payload.nearest_metro_stations = input.nearestMetroStations;
  if (input.photos !== undefined) payload.photos = input.photos;
  if (input.status !== undefined) payload.status = input.status;
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder;
  return payload;
}

export function insertBusinessCenter(input: BusinessCenterInput): Promise<BusinessCenter> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('business_centers').insert(toPayload(input)).select().single();
    if (error) throw error;
    return fromRow(data as BusinessCenterRow);
  });
}

export function updateBusinessCenter(id: string, input: Partial<BusinessCenterInput>): Promise<BusinessCenter> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('business_centers').update(toPayload(input)).eq('id', id).select().single();
    if (error) throw error;
    return fromRow(data as BusinessCenterRow);
  });
}

export function deleteBusinessCenter(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('business_centers').delete().eq('id', id);
    if (error) throw error;
  });
}
