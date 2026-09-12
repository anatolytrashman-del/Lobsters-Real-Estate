-- Очередь повторной отправки ОДИНОЧНЫХ писем (владелец, 2026-09-12: в этот
-- день упёрлись в дневной лимит Resend на бесплатном тарифе — 108 исходящих
-- при лимите 100). Массовая рассылка это переживает без потерь (у неё своя
-- очередь bulk_send_jobs), а одиночный ответ из вкладки "Письма" уходил
-- синхронно: api/purchase-send-email.js → Resend → и запись в переписке
-- создавалась ТОЛЬКО после успешного ответа Resend. Отказ Resend = письмо
-- нигде не сохранено, текст жил лишь в открытом окне композера.
--
-- ВАЖНО: эта миграция ещё НЕ применена к проду (владелец попросил не
-- выкатывать до обновления тарифа). Применять вместе с деплоем Edge Function
-- process-outgoing-emails и фронта — по отдельности смысла не имеет.

-- 1. Статус отправки у самой записи письма. default 'sent' — все уже
--    существующие строки и все три пути отправки, которые про очередь не
--    знают (массовая рассылка, scripts/*.mjs, входящие письма), продолжают
--    писать строки без этого поля и считаются отправленными, как и раньше.
alter table supplier_offer_emails
  add column if not exists send_status text not null default 'sent',
  add column if not exists send_error text;

alter table purchase_emails
  add column if not exists send_status text not null default 'sent',
  add column if not exists send_error text;

-- 2. Сама очередь. Строка письма в переписке создаётся СРАЗУ (со статусом
--    'queued'), здесь лежит только то, что нужно для повторной попытки.
create table if not exists outgoing_email_jobs (
  id uuid primary key default gen_random_uuid(),
  -- В какой таблице лежит письмо: переписка Ресерча или переписка закупки
  -- (см. api/purchase-send-email.js — один эндпоинт на оба случая).
  email_table text not null check (email_table in ('supplier_offer_emails', 'purchase_emails')),
  email_id uuid not null,
  from_address text not null,
  to_address text not null,
  subject text not null default '',
  body text not null default '',
  -- [{ fileName, contentType, url, contentBase64, contentKey }] — url для
  -- файлов, которые успели лечь в Storage (воркер скачает оттуда), сырой
  -- contentBase64 как запасной путь, если заливка в Storage не удалась
  -- (иначе вложение было бы потеряно). contentKey — только у ведомостей
  -- материалов, по нему воркер шлёт копию владельцу (material_ledger_copies).
  attachments jsonb not null default '[]'::jsonb,
  -- Тот же Idempotency-Key, с которым письмо уже уходило в Resend в первой
  -- (неудачной) попытке: если сеть оборвалась ПОСЛЕ того, как Resend принял
  -- письмо, повтор с тем же ключом не создаст второе письмо.
  idempotency_key text,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'error')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Выборка "что пора отправлять" в воркере.
create index if not exists outgoing_email_jobs_due_idx
  on outgoing_email_jobs (status, next_attempt_at);

-- Одно письмо — одно задание (страховка от повторной постановки той же
-- записи в очередь при ретрае запроса с фронта).
create unique index if not exists outgoing_email_jobs_email_idx
  on outgoing_email_jobs (email_table, email_id);

-- Таблица только серверная (api/*.js и Edge Function ходят сервисным ключом,
-- в обход RLS). Политик нет — значит анонимному/залогиненному клиенту
-- недоступна вовсе; фронт статус видит по send_status самой записи письма.
alter table outgoing_email_jobs enable row level security;

notify pgrst, 'reload schema';

-- ===========================================================================
-- ВТОРОЙ ШАГ — ТОЛЬКО ПОСЛЕ ДЕПЛОЯ ФУНКЦИИ process-outgoing-emails.
-- Крон, дёргающий воркер раз в минуту, — один в один как у двух уже
-- работающих очередей (см. cron.job: process-supplier-jobs,
-- process-bulk-send-jobs). Если выполнить это раньше деплоя функции, крон
-- будет каждую минуту стучаться в несуществующий эндпоинт.
-- ===========================================================================
-- select cron.schedule(
--   'process-outgoing-emails',
--   '* * * * *',
--   $cron$
--   select net.http_post(
--     url := 'https://iohcdylttyuhwovztrbk.supabase.co/functions/v1/process-outgoing-emails',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_service_role_key')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 5000
--   );
--   $cron$
-- );
