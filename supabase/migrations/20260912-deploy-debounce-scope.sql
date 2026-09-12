-- 2026-09-12 — частичный полный режим пререндера (scripts/prerender.mjs).
-- Сохранение объекта в админке запускало полный рендер всех ~286 публичных
-- страниц (~6 минут), хотя от данных объектов зависят только их лендинги.
-- api/trigger-rebuild.js теперь пишет сюда, ЧТО поменялось:
--   objects          — только лендинги объектов рендерятся заново, остальное
--                      копируется с прода;
--   business_centers — полный рендер (карточки и хабы БЦ — большинство сайта);
--   null / 'all'     — полный рендер (старый код без scope тоже сюда).
-- Колонка nullable — совместима со старым кодом на проде до публикации.
-- Применена через Supabase Management API 2026-09-12.
alter table deploy_debounce add column if not exists scope text;
comment on column deploy_debounce.scope is
  'что именно поменялось в данных: objects | business_centers | null=всё (scripts/prerender.mjs решает, какие страницы рендерить заново)';
notify pgrst, 'reload schema';
