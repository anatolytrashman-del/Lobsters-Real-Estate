import { supabase } from './supabase';
import type { AccessProfile } from '../data/accessProfiles';
import type { PageKey } from '../data/pages';

// Профили теперь живут в Supabase (access_profiles), привязанные к
// настоящему Supabase Auth пользователю — но Sidebar/RequirePage/AdminIndex
// по-прежнему читают текущий профиль синхронно на каждый рендер, без своего
// useEffect/loading. Поэтому PasswordGate после успешного входа грузит
// список профилей один раз и кладёт сюда вместе с id вошедшего auth-
// пользователя — дальше весь модуль работает как раньше, просто источник
// "кто я" — не localStorage, а реальная сессия Supabase Auth.
let cachedProfiles: AccessProfile[] = [];
let currentUserId: string | null = null;

export function setAccessProfilesCache(profiles: AccessProfile[]): void {
  cachedProfiles = profiles;
}

export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

export async function signOutAndClearCache(): Promise<void> {
  await supabase.auth.signOut();
  cachedProfiles = [];
  currentUserId = null;
}

// Фолбэк, если у вошедшего auth-пользователя почему-то нет строки в
// access_profiles (не должно происходить в норме — профиль заводится
// вместе с аккаунтом) — берём первый профиль с полным доступом, а если
// такого вовсе нет — первый по списку, чтобы страница не падала на пустом
// профиле.
export function getCurrentProfile(): AccessProfile {
  const found = cachedProfiles.find((p) => p.userId === currentUserId);
  if (found) return found;
  return cachedProfiles.find((p) => p.pages === 'all') ?? cachedProfiles[0];
}

export function isPageAllowed(profile: AccessProfile, page: PageKey): boolean {
  return profile.pages === 'all' || profile.pages.includes(page);
}

// Отдельная, более строгая проверка для страниц, скрытых даже от профилей
// с pages:'all' (например лог активности сотрудников) — см. isSuperAdmin в
// data/accessProfiles.ts. Использовать вместо isPageAllowed там, где обычное
// "all" не должно давать доступ.
export function isSuperAdminAllowed(profile: AccessProfile): boolean {
  return profile.isSuperAdmin;
}

// Видимость задач: сотрудник видит в разделе «Задачи» только те, где он сам
// стоит в ответственных, владелец (isSuperAdmin) — весь список целиком.
// Сопоставление идёт по displayName профиля против assignees задачи: и там,
// и там лежит одно и то же имя из таблицы people («Светлана», «Татьяна
// Гаврис»...), id человека в задаче не хранится (см. data/tasks.ts). Поэтому
// профиль, у которого displayName разошёлся с именем в people, перестанет
// видеть свои задачи — держать эти две строки одинаковыми (LOGIN_ACCOUNTS /
// access_profiles / people).
export function isTaskVisible(profile: AccessProfile, assignees: string[]): boolean {
  if (profile.isSuperAdmin) return true;
  return assignees.includes(profile.displayName);
}
