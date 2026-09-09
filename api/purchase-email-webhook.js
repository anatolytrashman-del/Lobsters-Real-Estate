// Vercel serverless function: приём входящих писем через Resend Inbound
// Webhook. Домен/MX/webhook уже настроены владельцем (2026-08-28, см.
// журнал CLAUDE.md) — этот эндпоинт зарегистрирован в кабинете Resend как
// единственный обработчик входящей почты на домене.
//
// Несмотря на название файла (осталось от первой версии — переименовывать
// не стали, чтобы не заставлять владельца ещё раз лезть в кабинет Resend и
// менять зарегистрированный URL), обрабатывает ДВА разных случая по
// префиксу адреса в "to": zakupki+<код>@ — переписка по закупке
// (purchase_emails), research+<код>@ — переписка по предложению в
// Ресерче поставщиков, ещё до того как оно превратилось в закупку
// (supplier_offer_emails). Resend не даёт настроить доставку webhook по
// конкретному адресу получателя — сюда прилетает вообще любое входящее
// письмо на домене, дальше уже сами решаем, что с ним делать.
//
// <код> — короткий short_code (5 hex-символов), не полный id (владелец,
// 2026-09-03: адрес с UUID был "очень длинный") — извлечённый код нужно
// сначала резолвить в реальный id закупки/предложения отдельным запросом
// (resolveIdByShortCode), сам FK-столбец purchase_id/offer_id как хранил,
// так и хранит настоящий UUID.
//
// Resend подписывает вебхуки по протоколу Svix (заголовки svix-id/
// svix-timestamp/svix-signature, HMAC-SHA256 от "id.timestamp.тело" на
// секрете вебхука) — секрет лежит в Vercel env RESEND_WEBHOOK_SECRET.
// Без проверки подписи любой, кто узнает URL эндпоинта, мог бы подкинуть
// поддельное "письмо от поставщика" прямо в переписку любой закупки —
// поэтому bodyParser отключён (нужно именно СЫРОЕ тело запроса байт-в-байт,
// не пересобранный JSON.stringify, иначе подпись не сойдётся) и подпись
// проверяется до разбора payload. Если RESEND_WEBHOOK_SECRET ещё не
// проставлен в Vercel — проверка пропускается с предупреждением в лог,
// чтобы не сломать приём писем ДО того, как секрет добавят.
//
// ВАЖНО (проверено 2026-09-03 по документации Resend, см. подробный
// комментарий в _attachments.js): сам вебхук email.received несёт только
// метаданные письма (from/to/subject/email_id/attachments-список без
// содержимого) — тела ("text"/"html") в нём НЕТ, его нужно дотягивать
// отдельным GET-запросом к api.resend.com (fetchReceivedEmailBody ниже).
// Раньше здесь ошибочно читалось data.text/data.html прямо из вебхука —
// на первом же реальном письме body сохранился бы пустой строкой.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { extractEmailAttachments, fetchReceivedEmailBody } from './_attachments.js';
import { recognizeInvoice, INVOICE_MAX_PAGES } from './_invoiceRecognition.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function verifyResendSignature(rawBody, headers, secret) {
  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.split('_')[1] || '', 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes).update(signedContent).digest();

  return String(svixSignature)
    .split(' ')
    .some((part) => {
      const [version, signature] = part.split(',');
      if (version !== 'v1' || !signature) return false;
      let provided;
      try {
        provided = Buffer.from(signature, 'base64');
      } catch {
        return false;
      }
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    });
}

// Владелец, 2026-09-03: "давай заменим адрес на zakupki" — раньше научный
// (research+) и закупочный (zakupki+) адреса были двумя разными префиксами,
// определяющими, в какую таблицу класть письмо. Теперь ОБА принимаются
// одинаково (regex по обоим сразу), а таблица определяется уже не
// префиксом, а тем, в какой из двух таблиц реально нашёлся short_code (см.
// вызов ниже). research+ оставлен наравне с zakupki+ НЕ для новых писем
// (см. supplierOfferEmailAddress в data/supplierResearch.ts — она теперь
// сама строит zakupki+), а как совместимость с уже отправленным вживую
// письмом (research+4687a@...) — если поставщик или сотрудник ответят в
// том же треде ещё раз, их почтовый клиент подставит именно старый адрес.
function extractShortCode(toAddress) {
  const re = /(?:zakupki|research)\+([0-9a-f]{4,8})@/i;
  const match = String(toAddress || '').match(re);
  return match ? match[1].toLowerCase() : null;
}

async function resolveIdByShortCode(table, shortCode) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/${table}?short_code=eq.${encodeURIComponent(shortCode)}&select=id`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0]?.id ?? null;
}

// Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" — дополнительные
// заявки (supplier_orders) переписываются по своему собственному
// short_code, но письмо всё равно должно лечь и под правильный offer_id
// (карточка поставщика, к которому эта заявка относится) — нужен id ОБОИХ
// сразу, не одного only order.id, как у остальных resolveIdByShortCode.
async function resolveOrderByShortCode(shortCode) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/supplier_orders?short_code=eq.${encodeURIComponent(shortCode)}&select=id,offer_id`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] ? { id: rows[0].id, offerId: rows[0].offer_id } : null;
}

// Заголовок From письма обычно приходит в одном из двух видов —
// "Иван Петров <ivan@company.ru>" или просто "ivan@company.ru" — если
// получится распознать имя, дальше используем его для автозаполнения
// карточки предложения (см. autoFillOfferContact). Не трогает уже
// сложившийся fromAddress (используется как есть в самой записи письма),
// это отдельный best-effort разбор ТОЛЬКО для автозаполнения.
function parseFromHeader(raw) {
  const str = String(raw || '').trim();
  const match = str.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (match) {
    const name = match[1].trim();
    return { name: name || null, address: match[2].trim() };
  }
  return { name: null, address: str };
}

// Владелец, 2026-09-03: "давай в эту карточку подтягивать автоматически
// email из письма и имя менеджера из письма" — только для переписки
// Ресерча (offerId), только на ПЕРВОМ входящем письме по факту (если поля
// уже заполнены — ничем не перезаписываем, это может быть другой человек,
// ответивший позже с того же адреса, или владелец мог поправить вручную).
// Сбой здесь не должен ронять сохранение самого письма — вызывающий код
// оборачивает в try/catch.
async function autoFillOfferContact(offerId, parsedFrom) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/supplier_research_offers?id=eq.${offerId}&select=email,manager_name`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!resp.ok) return;
  const rows = await resp.json();
  const offer = rows[0];
  if (!offer) return;

  const patch = {};
  if (!offer.email && parsedFrom.address) patch.email = parsedFrom.address;
  if (!offer.manager_name && parsedFrom.name) patch.manager_name = parsedFrom.name;
  if (Object.keys(patch).length === 0) return;

  await fetch(`${process.env.SUPABASE_URL}/rest/v1/supplier_research_offers?id=eq.${offerId}`, {
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
    throw new Error(`Не удалось сохранить входящее письмо: ${text}`);
  }
  const rows = await resp.json();
  return rows[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const rawBody = await readRawBody(req);
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    if (!verifyResendSignature(rawBody, req.headers, secret)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
  } else {
    console.warn('RESEND_WEBHOOK_SECRET не настроен — подпись входящего письма не проверяется');
  }

  try {
    const payload = JSON.parse(rawBody || '{}');
    // Resend оборачивает событие в { type, data } — data содержит сами
    // поля письма (to/from/subject/text). Поддерживаем и "плоский" вид на
    // случай отличающегося формата.
    const data = payload.data ?? payload;
    // 2026-09-03: живой прогон сохранил пустое тело и без вложений, хотя
    // отправитель ответил и приложил файл — точная причина ещё не
    // подтверждена (см. комментарий в _attachments.js). Логируем сырой
    // payload целиком, чтобы на следующем реальном письме увидеть в Vercel
    // Runtime Logs, как он выглядит на самом деле.
    console.error('RAW WEBHOOK PAYLOAD:', JSON.stringify(payload).slice(0, 3000));

    const toRaw = data.to;
    const toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw;
    const fromAddress = data.from ?? '';
    const subject = data.subject ?? '';

    const code = extractShortCode(toAddress);

    if (!code) {
      // Письмо не на наш plus-адрес — не наша забота, но и не ошибка
      // самого вебхука (Resend не должен ретраить бесконечно). Заодно не
      // тратим лишний запрос к Resend API на тело письма, которое всё
      // равно никуда не сохраним.
      res.status(200).json({ skipped: true });
      return;
    }

    // Таблицу определяет не префикс адреса (оба принимаются одинаково, см.
    // extractShortCode), а то, в какой из трёх таблиц реально нашёлся
    // short_code — проверяются по очереди, коллизия между ними технически
    // возможна, но при таком масштабе (десятки-сотни записей на компанию,
    // не тысячи) статистически ничтожна, отдельно не защищаемся.
    //
    // Владелец, 2026-09-03: "1 заявка на поставку — одна ветка" —
    // дополнительные заявки (supplier_orders) переписываются по своему
    // короткому коду; письмо в этом случае всё равно кладём под настоящий
    // offer_id (карточка поставщика), плюс order_id конкретной заявки.
    const purchaseId = await resolveIdByShortCode('purchases', code);
    const matchedOffer = purchaseId ? null : await resolveIdByShortCode('supplier_research_offers', code);
    const matchedOrder = purchaseId || matchedOffer ? null : await resolveOrderByShortCode(code);
    const offerId = matchedOffer ?? matchedOrder?.offerId ?? null;
    const orderId = matchedOrder?.id ?? null;

    if (!purchaseId && !offerId) {
      // Код есть в адресе, но не резолвится ни в одну реальную запись —
      // например, письмо на давно удалённую закупку. Логируем на всякий
      // случай, но так же безобидно скипаем, как и совсем чужой адрес.
      console.warn('Не удалось сопоставить short_code с записью:', code);
      res.status(200).json({ skipped: true });
      return;
    }

    // Тело письма — отдельным запросом, см. комментарий в начале файла.
    const body = await fetchReceivedEmailBody([data.email_id, data.id]);
    const attachments = await extractEmailAttachments(data);
    const files = attachments.map(({ url, fileName }) => ({ url, fileName }));

    // Автораспознавание счёта/КП во вложении — только для переписки Ресерча
    // (offerId), не закупок. Владелец, 2026-09-03: "система [должна]
    // понимать, что перед ней счёт, а не каталог на 40 страниц, и
    // распознавала данные сама... Альмира только сверяла и подтверждала".
    // Берём первое вложение, похожее на счёт (PDF/картинка, разумное число
    // страниц) — многостраничные каталоги до модели не долетают вовсе,
    // деньги не тратятся. Сбой распознавания не должен ронять сохранение
    // самого письма — оборачиваем в try/catch, extraction просто остаётся
    // null (Альмира всегда может распознать вручную кнопкой в предпросмотре).
    let extraction = null;
    if (offerId) {
      // Владелец, 2026-09-09: реальный счёт (.docx с разбивкой на позиции)
      // раньше не подходил под этот фильтр вовсе — .docx не имеет
      // "страниц" в том смысле, что PDF (нет байтового способа их
      // посчитать), но и не бывает 40-страничным каталогом в том же
      // смысле — pageCount у него всегда 1 (см. _attachments.js), поэтому
      // порог INVOICE_MAX_PAGES ему не грозит.
      const candidate = attachments.find(
        (a) => /\.(pdf|png|jpe?g|webp|gif|docx)$/i.test(a.fileName) && a.pageCount != null && a.pageCount <= INVOICE_MAX_PAGES,
      );
      if (candidate) {
        try {
          const recognized = await recognizeInvoice(candidate.url, candidate.fileName);
          if (recognized.isInvoice) {
            extraction = {
              status: 'pending',
              ...recognized,
              sourceFile: { url: candidate.url, fileName: candidate.fileName },
              recognizedAt: new Date().toISOString(),
            };
          }
        } catch (err) {
          console.error('Не удалось автораспознать вложение как счёт (не критично, письмо всё равно сохранится):', err);
        }
      }
    }

    const row = purchaseId
      ? await insertEmailRow('purchase_emails', {
          purchase_id: purchaseId,
          direction: 'in',
          from_address: fromAddress,
          to_address: toAddress || '',
          subject,
          body,
          files,
          resend_message_id: data.email_id ?? data.id ?? null,
        })
      : await insertEmailRow('supplier_offer_emails', {
          offer_id: offerId,
          order_id: orderId,
          direction: 'in',
          from_address: fromAddress,
          to_address: toAddress || '',
          subject,
          body,
          files,
          extraction,
          resend_message_id: data.email_id ?? data.id ?? null,
        });

    if (offerId) {
      try {
        await autoFillOfferContact(offerId, parseFromHeader(fromAddress));
      } catch (err) {
        console.error('Не удалось автозаполнить email/имя менеджера у предложения (не критично):', err);
      }
    }

    res.status(200).json({ email: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось обработать письмо' });
  }
}
