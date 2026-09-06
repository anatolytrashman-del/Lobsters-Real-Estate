import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import { compressImageIfNeeded } from './imageCompress';
import { queueImageCompression } from './tinypngCompress';
import type { DesignProject, DesignProjectRow } from '../data/designProjects';

function fromRow(row: DesignProjectRow): DesignProject {
  return {
    id: row.id,
    name: row.name,
    notes: row.notes ?? '',
    photoUrls: row.photo_urls ?? [],
    createdAt: row.created_at,
  };
}

export function fetchDesignProjects(): Promise<DesignProject[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('design_projects').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return (data as DesignProjectRow[]).map(fromRow);
  });
}

export function fetchDesignProject(id: string): Promise<DesignProject> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('design_projects').select('*').eq('id', id).single();
    if (error) throw error;
    return fromRow(data as DesignProjectRow);
  });
}

export function insertDesignProject(input: { name: string }): Promise<DesignProject> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('design_projects')
      .insert({ name: input.name, notes: '', photo_urls: [] })
      .select()
      .single();
    if (error) throw error;
    return fromRow(data as DesignProjectRow);
  });
}

export function updateDesignProject(
  id: string,
  input: Partial<Pick<DesignProject, 'name' | 'notes' | 'photoUrls'>>,
): Promise<DesignProject> {
  return withRetry(async () => {
    const payload: Partial<DesignProjectRow> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.notes !== undefined) payload.notes = input.notes;
    if (input.photoUrls !== undefined) payload.photo_urls = input.photoUrls;
    const { data, error } = await supabase.from('design_projects').update(payload).eq('id', id).select().single();
    if (error) throw error;
    return fromRow(data as DesignProjectRow);
  });
}

export function deleteDesignProject(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('design_projects').delete().eq('id', id);
    if (error) throw error;
  });
}

export async function uploadDesignProjectPhoto(file: File): Promise<string> {
  const toUpload = await compressImageIfNeeded(file);
  return withRetry(
    async () => {
      const ext = toUpload.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('design-project-photos').upload(path, toUpload);
      if (error) throw error;
      queueImageCompression('design-project-photos', path);
      const { data } = supabase.storage.from('design-project-photos').getPublicUrl(path);
      return data.publicUrl;
    },
    1500,
    UPLOAD_TIMEOUT_MS,
    3,
  );
}
