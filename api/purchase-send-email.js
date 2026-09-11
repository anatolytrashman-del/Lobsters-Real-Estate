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
// Только для сотрудников (P0.3 аудита безопасности) — requireStaffAuth,
// как и у остальных приватных api/*.js; клиент вызывает через authFetch.

import { requireStaffAuth } from './_auth.js';
import { uploadAttachment } from './_attachments.js';

const RESEND_FROM_NAME = 'Redevelopment Закупки';

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
    for (const a of Array.isArray(attachments) ? attachments : []) {
      if (!a?.contentBase64 || !a?.fileName) continue;
      resendAttachments.push({ filename: a.fileName, content: a.contentBase64 });
      try {
        const bytes = Buffer.from(a.contentBase64, 'base64');
        const uploaded = await uploadAttachment(bytes, a.contentType, a.fileName);
        storedFiles.push(uploaded);
      } catch (err) {
        console.error('Не удалось сохранить вложение исходящего письма в Storage:', err);
      }
    }

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${RESEND_FROM_NAME} <${fromAddress}>`,
        to: [toAddress],
        subject: subject || defaultSubject,
        html: emailHtml(body),
        ...(resendAttachments.length > 0 ? { attachments: resendAttachments } : {}),
      }),
    });

    if (!resendResp.ok) {
      const text = await resendResp.text();
      throw new Error(`Не удалось отправить письмо: ${text}`);
    }
    const resendJson = await resendResp.json();

    const row = await insertEmailRow(table, {
      ...(purchaseId ? { purchase_id: purchaseId } : { offer_id: offerId, order_id: orderId ?? null }),
      direction: 'out',
      from_address: fromAddress,
      to_address: toAddress,
      subject: subject || '',
      body,
      files: storedFiles,
      resend_message_id: resendJson?.id ?? null,
    });

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
