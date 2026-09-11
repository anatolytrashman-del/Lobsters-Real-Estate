// Список для экрана входа (PasswordGate) — имя сотрудника → email его
// Supabase Auth аккаунта. Не из базы: после P0.1/P0.2 аудита безопасности
// access_profiles закрыт для anon (там персональные данные), поэтому до
// входа взять список неоткуда, кроме как захардкодить — сам email не
// секрет (это просто логин, письма на него никто не шлёт и не читает,
// см. комментарий в PasswordGate.tsx). Обновлять руками при найме/
// увольнении сотрудника — ровно тогда же, когда заводится/удаляется сам
// Auth-аккаунт (Management API, см. журнал docs/session-journal.md) — эти два шага и
// так делаются вместе, одним заходом, не самостоятельным процессом.
export interface LoginAccount {
  displayName: string;
  email: string;
}

export const LOGIN_ACCOUNTS: LoginAccount[] = [
  { displayName: 'Трэшмен', email: 'trashman@redevelopment.pro' },
  { displayName: 'Светлана', email: 'svetlana.backoffice@redevelopment.pro' },
  { displayName: 'Альмира', email: 'almira.backoffice@redevelopment.pro' },
  { displayName: 'Татьяна Гаврис', email: 'legal@redevelopment.pro' },
];
