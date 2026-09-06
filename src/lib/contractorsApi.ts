import { supabase } from './supabase';
import { withRetry, UPLOAD_TIMEOUT_MS } from './withRetry';
import { extractTelegramHandle } from './telegramHandle';
import { fetchTelegramAvatarBlob } from './telegramAvatarApi';
import { queueImageCompression } from './tinypngCompress';
import { isBirthdayToday, type Contractor, type ContractorRow } from '../data/contractors';

const CONTRACTOR_PHOTOS_BUCKET = 'contractor-photos';
const CONTRACTOR_RESUMES_BUCKET = 'contractor-resumes';
// Час — тот же TTL, что и у lead-photos (см. leadsApi.ts).
const PHOTO_URL_TTL_SECONDS = 60 * 60;
const RESUME_URL_TTL_SECONDS = 60 * 60;

function fromRow(row: ContractorRow): Contractor {
  return {
    id: row.id,
    name: row.name,
    specialty: row.specialty,
    contact: row.contact,
    contactMethod: row.contact_method ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    paymentTerms: row.payment_terms ?? '',
    teamTier: row.team_tier ?? '',
    responsibilityZone: row.responsibility_zone ?? '',
    photoPath: row.photo_path ?? '',
    birthday: row.birth_date ?? '',
    resumePath: row.resume_path ?? '',
    resumeFileName: row.resume_file_name ?? '',
    createdAt: row.created_at,
  };
}

export function fetchContractors(): Promise<Contractor[]> {
  return withRetry(async () => {
    const { data, error } = await supabase.from('contractors').select('*').order('name', { ascending: true });
    if (error) throw error;
    return (data as ContractorRow[]).map(fromRow);
  });
}

// Для бейджика в сайдбаре (см. Sidebar.tsx) — весь список подрядчиков и так
// небольшой, отдельный SQL-запрос "только у кого сегодня ДР" не нужен,
// сравнение месяца/дня дешевле сделать на клиенте после обычного fetchContractors.
export async function fetchContractorsWithBirthdayToday(): Promise<Contractor[]> {
  const all = await fetchContractors();
  return all.filter((c) => isBirthdayToday(c.birthday));
}

export function insertContractor(input: Omit<Contractor, 'id' | 'createdAt'>): Promise<Contractor> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('contractors')
      .insert({
        name: input.name,
        specialty: input.specialty,
        contact: input.contact,
        contact_method: input.contactMethod || null,
        phone: input.phone || null,
        email: input.email || null,
        notes: input.notes || null,
        payment_terms: input.paymentTerms || null,
        team_tier: input.teamTier || null,
        responsibility_zone: input.responsibilityZone || null,
        photo_path: input.photoPath || null,
        birth_date: input.birthday || null,
        resume_path: input.resumePath || null,
        resume_file_name: input.resumeFileName || null,
      })
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as ContractorRow);
  });
}

export function updateContractor(id: string, input: Omit<Contractor, 'id' | 'createdAt'>): Promise<Contractor> {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from('contractors')
      .update({
        name: input.name,
        specialty: input.specialty,
        contact: input.contact,
        contact_method: input.contactMethod || null,
        phone: input.phone || null,
        email: input.email || null,
        notes: input.notes || null,
        payment_terms: input.paymentTerms || null,
        team_tier: input.teamTier || null,
        responsibility_zone: input.responsibilityZone || null,
        photo_path: input.photoPath || null,
        birth_date: input.birthday || null,
        resume_path: input.resumePath || null,
        resume_file_name: input.resumeFileName || null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return fromRow(data as ContractorRow);
  });
}

export function deleteContractor(id: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from('contractors').delete().eq('id', id);
    if (error) throw error;
  });
}

// Фото подрядчика — тот же паттерн, что и у лидов (закрытый бакет, путь а не
// URL в базе, подписанная ссылка на каждый показ). См. подробный комментарий
// у uploadLeadPhoto/createLeadPhotoUrl/deleteLeadPhoto в leadsApi.ts.
export function uploadContractorPhoto(file: File): Promise<string> {
  return withRetry(
    async () => {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(CONTRACTOR_PHOTOS_BUCKET).upload(path, file);
      if (error) throw error;
      queueImageCompression(CONTRACTOR_PHOTOS_BUCKET, path);
      return path;
    },
    1000,
    UPLOAD_TIMEOUT_MS,
  );
}

export async function createContractorPhotoUrl(path: string): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(CONTRACTOR_PHOTOS_BUCKET)
      .createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function deleteContractorPhoto(path: string): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(CONTRACTOR_PHOTOS_BUCKET).remove([path]);
  } catch {
    // намеренно молча
  }
}

// Резюме — тот же паттерн, что и фото (закрытый бакет, путь а не URL,
// подписанная ссылка на каждый показ), только свой бакет и без ограничения
// на тип файла (accept для инпута — на стороне формы, см. Contractors.tsx).
export function uploadContractorResume(file: File): Promise<string> {
  return withRetry(
    async () => {
      const ext = file.name.split('.').pop() ?? 'pdf';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(CONTRACTOR_RESUMES_BUCKET).upload(path, file);
      if (error) throw error;
      return path;
    },
    1000,
    UPLOAD_TIMEOUT_MS,
  );
}

export async function createContractorResumeUrl(path: string): Promise<string | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(CONTRACTOR_RESUMES_BUCKET)
      .createSignedUrl(path, RESUME_URL_TTL_SECONDS);
    if (error) throw error;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function deleteContractorResume(path: string): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from(CONTRACTOR_RESUMES_BUCKET).remove([path]);
  } catch {
    // намеренно молча
  }
}

// Автоподтягивание аватара из Telegram — по аналогии с tryAutoFillTelegramAvatar
// у лидов (leadsApi.ts), но только для команды/part-time: это узкий,
// заведомо доверенный список из нескольких человек, а не весь список
// подрядчиков — незачем дёргать t.me для каждого случайного электрика.
export async function tryAutoFillTelegramAvatarForContractor(contractor: Contractor): Promise<Contractor | null> {
  if (!contractor.teamTier || contractor.photoPath || contractor.contactMethod !== 'Telegram') return null;
  const handle = extractTelegramHandle(contractor.contact);
  if (!handle) return null;

  const blob = await fetchTelegramAvatarBlob(handle);
  if (!blob) return null;

  try {
    const file = new File([blob], `${handle}.jpg`, { type: blob.type || 'image/jpeg' });
    const photoPath = await uploadContractorPhoto(file);
    return await updateContractor(contractor.id, {
      name: contractor.name,
      specialty: contractor.specialty,
      contact: contractor.contact,
      contactMethod: contractor.contactMethod,
      phone: contractor.phone,
      email: contractor.email,
      notes: contractor.notes,
      paymentTerms: contractor.paymentTerms,
      teamTier: contractor.teamTier,
      responsibilityZone: contractor.responsibilityZone,
      photoPath,
      birthday: contractor.birthday,
      resumePath: contractor.resumePath,
      resumeFileName: contractor.resumeFileName,
    });
  } catch {
    return null;
  }
}
