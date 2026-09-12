-- Переименование строк категорий закупки под новый каталог поставщиков
-- (docs/supplier-catalog.md, таблица «Старые категории → новые»).
--
-- Код к переименованию НЕ привязан: плитки каталога находят «домашние»
-- карточки и по старым названиям (LEGACY_REQUEST_TITLES в
-- src/data/supplierCatalog.ts), а «Универсальные поставщики» не трогаются
-- вовсе (isUniversalRequest по title). То есть этот файл — чисто для того,
-- чтобы в шапках карточек категорий стояли новые имена. Обратимо: старые
-- названия сохраняются в таблице-бэкапе, откат — одним UPDATE из неё.
--
-- Выполнить через Supabase Management API (см. CLAUDE.md, «SQL-миграции»).

create table if not exists supplier_research_requests_title_backup_20260912 as
  select id, title, now() as saved_at from supplier_research_requests;

update supplier_research_requests r
set title = v.new_title
from (values
  ('Керамогранит',                'Керамогранит и плитка'),
  ('Ceresit',                     'Сухие смеси, грунтовки и гидроизоляция'),
  ('Грильято 100х100',            'Потолки'),
  ('Плинтус',                     'Плинтусы, панели и лепнина'),
  ('Краска интерьерная',          'Краски, обои и декоративные покрытия'),
  ('Сантехническое оборудование', 'Сантехника, отопление и бойлеры'),
  ('Умные замки',                 'СКУД, видеонаблюдение и слаботочка'),
  ('Умные счётчики',              'Трубы, арматура и счётчики'),
  ('Двери алюминиевые',           'Окна и перегородки'),
  ('Двери деревянные',            'Двери')
) as v(old_title, new_title)
where r.title = v.old_title;

-- Откат (если понадобится):
-- update supplier_research_requests r set title = b.title
--   from supplier_research_requests_title_backup_20260912 b where b.id = r.id;
