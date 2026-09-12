-- Снимки сайтов поставщиков: что именно поставляет каждая компания.
--
-- Владелец, 2026-09-12: "каждый поставщик поставляет только свой спектр
-- товара... можем ли мы реализовать парсинг категорий поставки существующим
-- поставщикам в базе... не через проксиапи, он дорого обходится".
--
-- Делается в два шага, ИИ участвует только во втором:
--   1. Edge Function process-supplier-jobs сама (без модели, бесплатно)
--      скачивает главную, разделы каталога и sitemap.xml и складывает сюда
--      список разделов (sections) + заголовок/описание/текст главной.
--   2. Сессия Claude Code (в рамках подписки, без ProxyAPI) читает снимки
--      и раскладывает по товарным группам (categories) из справочника
--      src/data/supplyCategories.ts.
--
-- Строка — на ДОМЕН, не на карточку: одна компания живёт в нескольких
-- категориях закупок (278 карточек / 259 доменов), а сайт у неё один.
-- Фронт джойнит по supplierWebsiteHost(offer.websiteUrl) — см. функцию
-- supplier_site_host ниже, она повторяет TS-нормализацию один в один.
--
-- Совместимо со старым кодом: только новая таблица и триггер, ничего не
-- переименовано и не удалено (правило очереди релиза, CLAUDE.md).

create or replace function supplier_site_host(url text) returns text
language sql immutable as $$
  select case when h like '%.%' then h else '' end
  from (
    select lower(
      split_part(split_part(split_part(
        regexp_replace(regexp_replace(coalesce(trim(url), ''), '^https?://', '', 'i'), '^www\.', '', 'i'),
      '/', 1), '?', 1), '#', 1)
    ) as h
  ) s
$$;

create table if not exists supplier_site_snapshots (
  host text primary key,
  website_url text not null,
  -- pending → processing → done | error (тот же жизненный цикл, что у
  -- supplier_enrichment_jobs; захват атомарный, см. claim() в функции).
  status text not null default 'pending',
  page_title text not null default '',
  meta_description text not null default '',
  -- Текст главной без разметки, до ~3000 символов — запас для сайтов, где
  -- меню рисуется скриптом и в HTML разделов нет.
  home_text text not null default '',
  -- [{"title": "Керамогранит", "url": "https://.../catalog/keramogranit/"}, ...]
  -- Сначала ссылки из меню/каталога (с человеческими названиями), потом
  -- адреса из sitemap.xml (название — из слага).
  sections jsonb not null default '[]'::jsonb,
  pages_fetched int not null default 0,
  error text,
  fetched_at timestamptz,
  -- Шаг 2: товарные группы из справочника + короткая заметка классификатора
  -- ("производитель керамогранита, оптовый склад в Москве").
  categories text[] not null default '{}',
  categories_note text not null default '',
  classified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists supplier_site_snapshots_status_idx
  on supplier_site_snapshots (status);

-- Как у остальных таблиц поставщиков: RLS включён, политика для
-- authenticated; Edge Function ходит сервисным ключом в обход RLS.
alter table supplier_site_snapshots enable row level security;
drop policy if exists authenticated_all on supplier_site_snapshots;
create policy authenticated_all on supplier_site_snapshots
  for all to authenticated using (true) with check (true);

-- Новый поставщик (руками или из веб-поиска) сразу встаёт в очередь на
-- снимок — фронт для этого ничего не делает. Уже известный домен не
-- трогаем: снимок один на компанию.
create or replace function queue_supplier_site_snapshot() returns trigger
language plpgsql as $$
declare
  h text := supplier_site_host(new.website_url);
begin
  if h <> '' then
    insert into supplier_site_snapshots (host, website_url)
    values (h, new.website_url)
    on conflict (host) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists supplier_offers_queue_site_snapshot on supplier_research_offers;
create trigger supplier_offers_queue_site_snapshot
  after insert or update of website_url on supplier_research_offers
  for each row execute function queue_supplier_site_snapshot();

-- Первичное заполнение всеми уже известными доменами.
insert into supplier_site_snapshots (host, website_url)
select distinct on (supplier_site_host(website_url))
  supplier_site_host(website_url), website_url
from supplier_research_offers
where supplier_site_host(website_url) <> ''
order by supplier_site_host(website_url), created_at
on conflict (host) do nothing;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Добавлено в тот же день: когда строку взяли в работу. Нужно, чтобы вернуть
-- в очередь снимки, зависшие в processing (вызов функции умер по лимиту
-- wall-clock). Отличать «зависло» от «взяли только что» по created_at нельзя —
-- все 259 строк первичной очереди созданы одной секундой.
alter table supplier_site_snapshots add column if not exists claimed_at timestamptz;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Сколько раз пытались снять сайт. Разбор первых 130 доменов показал, что
-- половина отказов — временные: таймаут медленного хостинга, 429, 503. Такие
-- домены возвращаются в очередь (до 3 попыток), а 401/403/404 остаются
-- ошибкой сразу — повтор их не починит.
alter table supplier_site_snapshots add column if not exists attempts int not null default 0;

notify pgrst, 'reload schema';
