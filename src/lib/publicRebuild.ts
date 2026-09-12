import { authFetch } from './authFetch';

// Что именно поменялось в данных — см. api/_rebuildScope.js и
// supabase/migrations/20260912-deploy-debounce-scope.sql. По этому значению
// scripts/prerender.mjs на следующей сборке решает, рендерить ли заново все
// ~286 публичных страниц (~6 минут) или только зависимые: от объектов зависят
// лишь их лендинги (/minsk/<slug>), остальное копируется с прода (~1 минута).
export type PublicRebuildScope = 'objects' | 'business_centers';

// Пререндеренный при сборке HTML публичных страниц (scripts/prerender.mjs,
// SEO_PLAN.md Э2-1) хранит title/meta/цены на момент последней сборки — без
// этого хука они протухали бы до следующего обычного пуша. Best-effort, не
// блокирует сохранение в админке: ошибку/недоступный хук просто глотаем,
// api/trigger-rebuild.js сам логирует детали и держит 5-минутный debounce.
export function triggerPublicRebuild(scope: PublicRebuildScope): void {
  authFetch('/api/trigger-rebuild', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope }),
  }).catch(() => {});
}
