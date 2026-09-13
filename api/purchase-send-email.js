// Vercel serverless function: отправка письма поставщику — из карточки
// закупки (Purchases.tsx → lib/purchaseEmailsApi.ts → sendPurchaseEmail)
// ИЛИ из предложения в Ресерче поставщиков (Suppliers.tsx →
// lib/supplierOfferEmailsApi.ts → sendSupplierOfferEmail). Несмотря на имя
// файла (осталось от первой версии), обрабатывает оба случая — так же, как
// purchase-email-webhook.js уже объединяет приём входящих писем для обоих:
// на Hobby-плане Vercel лимит 12 serverless-функций на деплой, отдельный
// файл под каждую пару send/receive быстро упёрся бы в потолок (реальный
// инцидент 2026-08-29 — деплой упал с "No more than 12 Serverless
// Functions", после чего два файла отправки объединили в этот один).
//
// Письмо уходит через Resend с адреса-плюс-закупки/предложения
// (purchaseEmailAddress/supplierOfferEmailAddress) — благодаря этому ответ
// прилетает на этот же адрес и матчится по id в локальной части, без
// отдельного ящика на каждую сущность. Запись создаётся здесь же сервисным
// ключом (таблицы закрыты RLS от anon — отправка письма не операция
// анонимного клиента, ключ Resend не должен быть на фронте).
//
// Если Resend отказал ВРЕМЕННО (владелец, 2026-09-12: закончился дневной
// лимит бесплатного тарифа — 108 исходящих при лимите 100), письмо больше не
// пропадает: запись в переписке создаётся всё равно, со статусом
// send_status='queued', а дослать её берётся Edge Function
// process-outgoing-emails (крон раз в минуту). До этой правки запись
// создавалась ТОЛЬКО после успешного ответа Resend — отказ означал, что
// письмо не сохранено нигде, а текст жил лишь в открытом окне композера.
//
// Только для сотрудников (P0.3 аудита безопасности) — requireStaffAuth,
// как и у остальных приватных api/*.js; клиент вызывает через authFetch.

import { randomUUID } from 'node:crypto';
import { requireStaffAuth } from './_auth.js';
import { uploadAttachment } from './_attachments.js';

const RESEND_FROM_NAME = 'Анатолий Трэшмен';

// Копия письма с ведомостью материалов владельцу (владелец, 2026-09-11:
// "при каждой отправке уникальной ведомости копия письма с ведомостью
// уходила на ящик"). Ключевое слово — УНИКАЛЬНОЙ: одна копия на содержимое
// ведомости, а не на каждое письмо (массовая рассылка шлёт одну и ту же
// ведомость десяткам поставщиков — копий должно быть ноль-или-одна).
// Дедупликация общая для всех трёх путей отправки (этот эндпоинт,
// supabase/functions/process-bulk-send-jobs, scripts/process-bulk-send-jobs.mjs)
// и живёт в таблице material_ledger_copies: content_key — первичный ключ,
// вставка с resolution=ignore-duplicates работает как атомарный захват,
// поэтому одновременные отправки не дадут двух копий.
//
// Копия уходит с "нейтрального" zakupki@ (без +short_code): адрес-плюс
// матчится вебхуком на конкретную переписку, и ответ владельца на копию
// упал бы в ленту к поставщику чужим письмом.
const LEDGER_COPY_TO = process.env.LEDGER_COPY_TO || 'anatoly.trashman@gmail.com';
const LEDGER_COPY_FROM = process.env.LEDGER_COPY_FROM || `${RESEND_FROM_NAME} <zakupki@redevelopment.pro>`;

// Технический адрес переписки строится из короткого кода (short_code,
// 5 hex-символов, генерируется в БД), не из полного UUID — владелец,
// 2026-09-03: адрес с UUID был "очень длинный". short_code читается той же
// строкой, что и id, поэтому нужен отдельный запрос на его получение перед
// отправкой (сама запись создаётся раньше, в момент добавления закупки/
// предложения, — здесь только шлём письмо). Один и тот же префикс zakupki+
// для обоих направлений переписки (владелец, 2026-09-03: "давай заменим
// адрес на zakupki") — таблицу на приёме определяет не префикс, а то, где
// реально нашёлся short_code (см. purchase-email-webhook.js).
function emailAddress(shortCode) {
  return `zakupki+${shortCode}@redevelopment.pro`;
}

async function fetchShortCode(table, id) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}&select=short_code`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0]?.short_code ?? null;
}

// Кто отправляет письмо — берём по реально вошедшему пользователю (id из
// проверенного токена, см. requireStaffAuth), а не по имени, присланному
// клиентом: иначе метрику "писем отправлено" по сотрудникам можно было бы
// подделать обычным POST'ом. Best-effort — если профиль почему-то не нашёлся,
// письмо всё равно уходит, просто без автора (владелец, 2026-09-12).
async function fetchAuthorProfile(userId) {
  try {
    const resp = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/access_profiles?select=id,display_name&user_id=eq.${userId}&limit=1`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

async function insertEmailRow(table, payload) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    // send_status/send_error появились вместе с очередью (2026-09-12). Если
    // этот код выкатили раньше миграции — или PostgREST ещё не перечитал
    // схему после ALTER TABLE (штатная ловушка проекта, см. CLAUDE.md про
    // "Could not find the 'x' column ... in the schema cache") — письмо не
    // должно пропадать из-за двух необязательных полей: повторяем вставку
    // без них. Строка тогда выглядит обычным отправленным письмом, как до
    // появления очереди.
    if (/send_status|send_error/.test(text) && ('send_status' in payload || 'send_error' in payload)) {
      const { send_status: _ignoredStatus, send_error: _ignoredError, ...rest } = payload;
      return await insertEmailRow(table, rest);
    }
    throw new Error(`Не удалось сохранить письмо: ${text}`);
  }
  const rows = await resp.json();
  return rows[0];
}

// Атомарный захват права отправить копию: true — ведомость с таким
// содержимым уходит впервые, false — копия уже была. Ошибки сюда не
// поднимаются как фатальные (см. вызов) — копия не должна ронять отправку
// письма поставщику.
async function claimLedgerCopy(contentKey, ledgerName, context) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/material_ledger_copies`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation,resolution=ignore-duplicates',
    },
    body: JSON.stringify({ content_key: contentKey, ledger_name: ledgerName, context }),
  });
  if (!resp.ok) throw new Error(`Не удалось отметить копию ведомости: ${await resp.text()}`);
  const rows = await resp.json();
  return Array.isArray(rows) && rows.length > 0;
}

// Захват снимается, если копию так и не удалось отправить — иначе ведомость
// считалась бы отправленной и копия не ушла бы уже никогда.
async function releaseLedgerCopy(contentKey) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/material_ledger_copies?content_key=eq.${encodeURIComponent(contentKey)}`, {
    method: 'DELETE',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

function ledgerCopyBody({ ledgerFileName, context, subject, body }) {
  const sentAt = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
  return [
    'Копия исходящего письма с ведомостью материалов.',
    '',
    `Ведомость: ${ledgerFileName}`,
    `Кому: ${context}`,
    `Отправлено: ${sentAt}`,
    `Тема: ${subject}`,
    '',
    '— — — текст письма — — —',
    '',
    body,
  ].join('\n');
}

async function sendLedgerCopy({ attachment, context, subject, body }) {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: LEDGER_COPY_FROM,
      to: [LEDGER_COPY_TO],
      subject: `[Копия] ${subject}`,
      html: emailHtml(ledgerCopyBody({ ledgerFileName: attachment.fileName, context, subject, body })),
      attachments: [{ filename: attachment.fileName, content: attachment.contentBase64 }],
    }),
  });
  if (!resp.ok) throw new Error(`Не удалось отправить копию ведомости: ${(await resp.text()).slice(0, 300)}`);
}

// Отправка в Resend одним местом — и первая попытка отсюда, и повтор из
// очереди (supabase/functions/process-outgoing-emails) шлют одинаковое тело.
// Idempotency-Key: если связь оборвалась ПОСЛЕ того, как Resend принял
// письмо, повтор с тем же ключом вернёт то же письмо, а не отправит второе
// (ключ живёт у Resend 24 часа; на планах, где заголовок не поддерживается,
// он просто игнорируется — хуже не делает).
async function sendViaResend({ idempotencyKey, from, to, subject, body, attachments }) {
  let resp;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: emailHtml(body),
        ...(attachments.length > 0 ? { attachments } : {}),
      }),
    });
  } catch (err) {
    // Сеть/таймаут: дошло письмо или нет — неизвестно. resendStatus не
    // проставляем, и isRetryableSendFailure ниже считает такой сбой
    // повторяемым (от задвоения страхует Idempotency-Key).
    throw new Error(`Не удалось отправить письмо: ${err instanceof Error ? err.message : err}`);
  }
  if (!resp.ok) {
    const text = await resp.text();
    const err = new Error(`Не удалось отправить письмо: ${text}`);
    err.resendStatus = resp.status;
    err.resendBody = text;
    throw err;
  }
  return await resp.json();
}

// Временный отказ Resend (письмо имеет смысл дослать позже) или постоянный
// (дальше пробовать бессмысленно, пользователю нужно показать ошибку сразу)?
// Владелец, 2026-09-12: в этот день закончился дневной лимит бесплатного
// тарифа (108 исходящих при лимите 100) — Resend отвечает на такое 429, и
// раньше это означало просто потерянное письмо: запись в переписке
// создавалась только после успешного ответа, текст оставался лишь в открытом
// окне композера. 5xx — сбой на стороне Resend, тоже повторяем. Всё
// остальное (422 на кривой адрес, 403 на отозванный ключ) — постоянное.
function isRetryableSendFailure(err) {
  const status = err?.resendStatus;
  if (status === undefined || status === null) return true;
  if (status === 429 || status >= 500) return true;
  return /quota|rate.?limit|too many|exceed/i.test(String(err?.resendBody ?? ''));
}

// Задание на повторную отправку. Разбирает его Edge Function
// process-outgoing-emails (pg_cron раз в минуту) — там же, где живут очереди
// массовой рассылки и веб-поиска, не в GitHub Actions (см. CLAUDE.md).
async function queueOutgoingEmail(job) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/outgoing_email_jobs`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(job),
  });
  if (!resp.ok) throw new Error(`Не удалось поставить письмо в очередь: ${(await resp.text()).slice(0, 300)}`);
}

async function deleteEmailRow(table, id) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
}

async function updateEmailRow(table, id, patch) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
}

function emailHtml(body) {
  const escaped = String(body)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#14151a;white-space:pre-wrap;">${escaped}</div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireStaffAuth(req, res);
  if (!user) return;

  const { purchaseId, offerId, orderId, toAddress, subject, body, attachments } = req.body ?? {};

  if ((!purchaseId && !offerId) || !toAddress || !body) {
    res.status(400).json({ error: 'Заполните все поля' });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: 'Не настроен RESEND_API_KEY на сервере' });
    return;
  }

  // Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" — если письмо
  // идёт по дополнительной заявке (orderId), адрес отправителя строится из
  // её собственного short_code (своя ветка, свой ответ прилетит именно
  // сюда), не из short_code офера. offer_id в самой записи письма всё равно
  // проставляется — общий счётчик непрочитанных по поставщику считает по
  // нему независимо от конкретной заявки (см. data/supplierOfferEmails.ts).
  const shortCode = purchaseId
    ? await fetchShortCode('purchases', purchaseId)
    : orderId
      ? await fetchShortCode('supplier_orders', orderId)
      : await fetchShortCode('supplier_research_offers', offerId);
  if (!shortCode) {
    res.status(404).json({ error: 'Не найдена закупка, предложение или заявка' });
    return;
  }

  const fromAddress = emailAddress(shortCode);
  const table = purchaseId ? 'purchase_emails' : 'supplier_offer_emails';
  const defaultSubject = purchaseId ? 'Закупка' : 'Запрос цены';

  try {
    // Владелец, 2026-09-03: "прикрепление ведомостей материалов к письму" —
    // клиент генерирует .xlsx сам (lib/materialLedgerXlsx.ts) и шлёт сюда уже
    // готовым base64, здесь только два дела с ним: (1) отдать те же байты
    // Resend, чтобы поставщик реально получил файл вложением, (2) залить
    // в Storage тем же хелпером, что и вложения ВХОДЯЩИХ писем
    // (uploadAttachment из _attachments.js), чтобы файл был виден в самой
    // ленте переписки (files), а не только долетел до почтового ящика.
    // Сбой заливки одного вложения не должен ронять уже готовое к отправке
    // письмо — best-effort, как и у входящих.
    const resendAttachments = [];
    const storedFiles = [];
    // Те же вложения в форме, понятной воркеру очереди — на случай, если
    // письмо сейчас не уйдёт: ссылка на файл в Storage (воркер скачает его
    // оттуда, а не тащит байты через базу), а если заливка не удалась —
    // сами байты, иначе вложение потерялось бы вместе с попыткой отправки.
    const queuedAttachments = [];
    for (const a of Array.isArray(attachments) ? attachments : []) {
      if (!a?.contentBase64 || !a?.fileName) continue;
      resendAttachments.push({ filename: a.fileName, content: a.contentBase64 });
      let uploaded = null;
      try {
        const bytes = Buffer.from(a.contentBase64, 'base64');
        uploaded = await uploadAttachment(bytes, a.contentType, a.fileName);
        storedFiles.push(uploaded);
      } catch (err) {
        console.error('Не удалось сохранить вложение исходящего письма в Storage:', err);
      }
      queuedAttachments.push({
        fileName: a.fileName,
        contentType: a.contentType ?? null,
        contentKey: a.contentKey ?? null,
        url: uploaded?.url ?? null,
        contentBase64: uploaded ? null : a.contentBase64,
      });
    }

    // Ключ идемпотентности переживает эту попытку: он же уйдёт с повтором из
    // очереди, поэтому письмо, принятое Resend перед обрывом связи, не
    // задвоится.
    const idempotencyKey = randomUUID();
    let resendJson = null;
    // Непустое значение = Resend отказал ВРЕМЕННО, письмо уходит в очередь.
    let deferred = null;
    try {
      resendJson = await sendViaResend({
        idempotencyKey,
        from: `${RESEND_FROM_NAME} <${fromAddress}>`,
        to: toAddress,
        subject: subject || defaultSubject,
        body,
        attachments: resendAttachments,
      });
    } catch (err) {
      // Постоянная ошибка — как и раньше: 500 наверх, записи в переписке нет,
      // пользователь видит причину и текст остаётся в композере.
      if (!isRetryableSendFailure(err)) throw err;
      deferred = err;
    }

    // sent_by_* есть только у supplier_offer_emails (переписка Ресерча) —
    // в purchase_emails таких колонок нет, туда поля не подмешиваем.
    const author = purchaseId ? null : await fetchAuthorProfile(user.id);

    const row = await insertEmailRow(table, {
      ...(purchaseId
        ? { purchase_id: purchaseId }
        : {
            offer_id: offerId,
            order_id: orderId ?? null,
            sent_by_profile_id: author?.id ?? null,
            sent_by_name: author?.display_name ?? null,
          }),
      direction: 'out',
      from_address: fromAddress,
      to_address: toAddress,
      subject: subject || '',
      body,
      files: storedFiles,
      resend_message_id: resendJson?.id ?? null,
      send_status: deferred ? 'queued' : 'sent',
      send_error: deferred ? String(deferred.message).slice(0, 400) : null,
    });

    if (deferred) {
      // Сначала убеждаемся, что запись ДЕЙСТВИТЕЛЬНО легла со статусом
      // "в очереди". Если колонок статуса в базе ещё нет (эндпоинт выкатили
      // раньше миграции — см. откат в insertEmailRow), строка выглядела бы
      // обычным отправленным письмом, хотя оно не ушло: это хуже прежнего
      // поведения, поэтому возвращаемся ровно к нему — записи нет, ошибка
      // пользователю, текст остаётся в композере.
      if (row?.send_status !== 'queued') {
        await deleteEmailRow(table, row.id);
        res.status(500).json({ error: deferred.message });
        return;
      }
      // Письмо уже видно в ленте переписки с пометкой "В очереди" — осталось
      // положить задание, по которому его дошлёт воркер. Если не удалось
      // даже это (очередь недоступна) — не оставляем запись вечно висеть в
      // "В очереди": помечаем несостоявшейся и показываем ошибку, как раньше.
      try {
        await queueOutgoingEmail({
          email_table: table,
          email_id: row.id,
          from_address: fromAddress,
          to_address: toAddress,
          subject: subject || defaultSubject,
          body,
          attachments: queuedAttachments,
          idempotency_key: idempotencyKey,
          last_error: String(deferred.message).slice(0, 400),
        });
      } catch (queueErr) {
        console.error('Письмо не удалось поставить в очередь:', queueErr);
        await updateEmailRow(table, row.id, {
          send_status: 'failed',
          send_error: String(deferred.message).slice(0, 400),
        });
        res.status(500).json({ error: deferred.message });
        return;
      }
      // Копия ведомости владельцу уйдёт вместе с самим письмом — из воркера,
      // после реальной отправки (см. process-outgoing-emails): иначе копия
      // "письмо отправлено" ушла бы раньше письма, а при окончательном сбое
      // и вовсе без него.
      res.status(200).json({ email: row, queued: true });
      return;
    }

    // Копия владельцу — строго после успешной отправки самого письма и
    // только по вложениям-ведомостям (contentKey есть только у них, см.
    // lib/materialLedgerXlsx.ts). Best-effort: письмо поставщику уже ушло и
    // записано, сбой копии не должен показывать пользователю ошибку.
    for (const a of Array.isArray(attachments) ? attachments : []) {
      if (!a?.contentKey || !a?.contentBase64) continue;
      let claimed = false;
      try {
        claimed = await claimLedgerCopy(a.contentKey, a.fileName ?? '', `письмо на ${toAddress}`);
        if (!claimed) continue;
        await sendLedgerCopy({
          attachment: a,
          context: `письмо на ${toAddress}`,
          subject: subject || defaultSubject,
          body,
        });
      } catch (err) {
        console.error('Копия ведомости владельцу не ушла:', err);
        if (claimed) await releaseLedgerCopy(a.contentKey).catch(() => {});
      }
    }

    res.status(200).json({ email: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось отправить письмо' });
  }
}
