// Общий хелпер для api/*.js: дотягивает тело и вложения входящего письма
// Resend Inbound и заливает вложения в бакет object-documents (тот же
// публичный бакет, что уже используется для счетов/КП в сметах — не заводим
// отдельный ради одного нового источника файлов). Используется
// purchase-email-webhook.js для обоих направлений переписки (закупки и
// Ресерч поставщиков) — единая логика, не дублировать.
//
// ВАЖНО, проверено 2026-09-03 через документацию Resend (сама песочница не
// достаёт resend.com напрямую, только через поиск) — вебхук email.received
// содержит ТОЛЬКО метаданные (email_id/from/to/subject/attachments-список
// без содержимого), НИ тела письма, НИ ссылок на файлы вложений в нём нет:
//   "Webhooks do not include the email body, headers, or attachments, only
//   their metadata. You must call the Received emails API or the
//   Attachments API to retrieve them."
// Поэтому оба хелпера ниже делают дополнительный GET-запрос к api.resend.com
// с RESEND_API_KEY (тот же ключ, что уже используется для отправки в
// purchase-send-email.js — новый секрет не нужен):
//   GET /emails/receiving/{emailId}              → { text, html, headers, ... }
//   GET /emails/receiving/{emailId}/attachments   → [{ id, filename,
//                                                       content_type,
//                                                       download_url (1ч),
//                                                       ... }]
// Раньше (до этой правки) код ошибочно ждал text/html и вложения прямо в
// самом теле вебхука — при первом реальном письме тело сохранялось бы
// пустой строкой. Реальный REST-ответ Resend не оборачивает ресурс в
// {data:...} (в отличие от JS SDK) — сверено с тем, как уже читается ответ
// отправки в purchase-send-email.js (`resendJson?.id`, не `resendJson.data.id`).
// Само по себе поле "attachments" в payload вебхука по-прежнему разбирается
// защитно (несколько вероятных названий полей), но за download_url теперь
// всегда идём отдельным запросом, а не ищем его в вебхуке.

import { randomUUID } from 'node:crypto';
import { estimatePdfPageCount } from './_invoiceRecognition.js';

const ATTACHMENTS_BUCKET = 'object-documents';
const RESEND_API_BASE = 'https://api.resend.com';

// 2026-09-03, живой прогон: реальное письмо сохранилось с ПУСТЫМ телом и
// без вложений, несмотря на этот фикс (см. журнал CLAUDE.md) — то ли
// data.email_id не то поле, что реально приходит в вебхуке, то ли у
// RESEND_API_KEY нет прав на Receiving API (если ключ создавался как
// "Sending access", а не "Full access" — Resend различает эти уровни).
// Пока причина не подтверждена диагностикой — emailId пробуется НЕСКОЛЬКИМИ
// кандидатами полей (email_id/id), не одним, и КАЖДАЯ попытка (успех и
// сбой) логируется целиком через console.error, чтобы в Vercel Runtime
// Logs было видно точную причину при следующем реальном письме.

// 2026-09-10, реальный баг: письмо от СПК "Д-Строй" (через Yandex Mail —
// та же ситуация будет у любого клиента, публикующего html-only письмо без
// text-части) сохранилось с сырой HTML-разметкой ("<div><div
// style=\"background:white;font-family:...\">") прямо в теле — лента
// переписки рендерит body через whitespace-pre-wrap (см.
// SupplierCorrespondenceTab.tsx), то есть как обычный текст, не как HTML,
// поэтому теги показывались буквально, а не форматировали письмо.
// Причина — старый fetchReceivedEmailBody брал text ИЛИ (если text пуст)
// html как есть, без какой-либо очистки. htmlToPlainText — грубый, но
// достаточный конвертер: превращает разрывы блоков (</div>/</p>/<br>/...) в
// переносы строк ДО вырезания остальных тегов (тот же порядок, что и в
// api/_docxText.js для .docx-таблиц — иначе всё схлопнется в один абзац без
// разделителей), затем декодирует именованные/числовые HTML-сущности и
// схлопывает лишние пустые строки.
function htmlToPlainText(html) {
  let text = String(html || '');
  text = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(div|p|tr|li|h[1-6]|table)>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

// Тело письма (text предпочтительнее html — если text пуст, html
// прогоняется через htmlToPlainText, не подставляется сырой разметкой, см.
// комментарий выше). candidateIds — несколько возможных id письма из
// вебхука, пробуются по очереди, пока один не сработает.
export async function fetchReceivedEmailBody(candidateIds) {
  const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : [candidateIds]).filter(Boolean))];
  if (ids.length === 0) {
    console.error('fetchReceivedEmailBody: нет ни одного кандидата id из вебхука');
    return '';
  }
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY не задан — не могу получить тело письма', ids);
    return '';
  }
  for (const emailId of ids) {
    try {
      const resp = await fetch(`${RESEND_API_BASE}/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!resp.ok) {
        console.error('Не удалось получить тело письма (id-кандидат):', emailId, resp.status, await resp.text());
        continue;
      }
      const json = await resp.json();
      console.error('Тело письма получено, сырой ответ (id-кандидат ' + emailId + '):', JSON.stringify(json).slice(0, 1000));
      // Часть путей Resend отдаёт ресурс сразу, часть (в JS SDK) — обёрнутым в
      // data — поддерживаем оба на всякий случай, не падаем, если формат чуть
      // отличается от задокументированного.
      const email = json?.text != null || json?.html != null ? json : (json?.data ?? json);
      if (typeof email?.text === 'string' && email.text.trim()) return email.text;
      if (typeof email?.html === 'string' && email.html.trim()) return htmlToPlainText(email.html);
      return '';
    } catch (err) {
      console.error('Ошибка при получении тела письма (id-кандидат):', emailId, err);
    }
  }
  return '';
}

async function fetchAttachmentsWithDownloadUrls(candidateIds) {
  const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : [candidateIds]).filter(Boolean))];
  if (ids.length === 0 || !process.env.RESEND_API_KEY) return [];
  for (const emailId of ids) {
    try {
      const resp = await fetch(`${RESEND_API_BASE}/emails/receiving/${emailId}/attachments`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!resp.ok) {
        console.error('Не удалось получить список вложений письма (id-кандидат):', emailId, resp.status, await resp.text());
        continue;
      }
      const json = await resp.json();
      const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
      console.error('Список вложений получен (id-кандидат ' + emailId + '):', list.length, 'шт.');
      return list;
    } catch (err) {
      console.error('Ошибка при получении списка вложений письма (id-кандидат):', emailId, err);
    }
  }
  return [];
}

function sanitizeFileName(name) {
  const trimmed = String(name || '').trim();
  const cleaned = trimmed.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 200);
  return cleaned || 'attachment';
}

// 2026-09-03, живой прогон: реальное вложение ("Счет № ФМ-194329 от
// 02.09.2026 МАТРЕШКА ООО (2).pdf") падало на загрузке в Storage с
// "InvalidKey" — путь строился как <uuid>-<имя файла>, а кириллица/
// пробелы/"№"/скобки прямо в URL-пути Supabase Storage не принимает.
// sanitizeFileName снимал только горстку символов (/\?%*:|"<>), но не это.
// Правильный фикс — тот же принцип, что уже используется на клиенте
// (uploadSupplierFile в supplierResearchApi.ts и другие загрузки в
// проекте): в САМ ключ объекта идёт только uuid+расширение, человекочитаемое
// имя остаётся только в поле fileName (то, что видит пользователь и что
// уходит в заголовок скачивания) — так путь никогда не зависит от того, что
// прислал отправитель письма.
function fileExtension(fileName) {
  const match = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  return match ? match[1].toLowerCase() : 'bin';
}

// Экспортирована — переиспользуется purchase-send-email.js для вложений
// ИСХОДЯЩИХ писем (владелец, 2026-09-03: ведомости материалов, генерируются
// на клиенте и прикладываются к письму) тем же путём, что и вложения
// входящих: тот же бакет, та же схема имени объекта (uuid+расширение,
// человекочитаемое имя — только в fileName).
export async function uploadAttachment(bytes, contentType, fileName) {
  const path = `purchase-email-attachments/${randomUUID()}.${fileExtension(fileName)}`;
  const resp = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${ATTACHMENTS_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Не удалось загрузить вложение: ${text}`);
  }
  return {
    url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${ATTACHMENTS_BUCKET}/${path}`,
    fileName: sanitizeFileName(fileName),
  };
}

// data — уже развёрнутый payload.data события Resend (см. вызывающий код).
// Возвращает DocumentFile[] (см. src/data/contractorDocuments.ts) — то, что
// напрямую кладётся в files письма. Никогда не бросает — сбой одного
// вложения не должен ронять сохранение всего письма.
//
// data.attachments в самом вебхуке — только метаданные (id/filename/
// content_type/content_disposition/content_id), без download_url — он
// приходит ТОЛЬКО из отдельного списочного запроса (см.
// fetchAttachmentsWithDownloadUrls выше), сопоставляем по id.
export async function extractEmailAttachments(data) {
  const rawList = data.attachments ?? data.attachment ?? [];
  if (!Array.isArray(rawList) || rawList.length === 0) {
    console.error('extractEmailAttachments: data.attachments/data.attachment пуст или отсутствует в вебхуке');
    return [];
  }

  const candidateIds = [data.email_id, data.id].filter(Boolean);
  const withUrls = await fetchAttachmentsWithDownloadUrls(candidateIds);
  const urlById = new Map(withUrls.filter((a) => a && a.id).map((a) => [a.id, a.download_url]));

  const files = [];
  for (const raw of rawList) {
    try {
      const fileName = raw.filename ?? raw.file_name ?? raw.name ?? 'attachment';
      const contentType = raw.content_type ?? raw.contentType ?? raw.type ?? 'application/octet-stream';

      // Свои поля вебхука проверяем тоже (inline content/прямой url) — на
      // случай, если формат когда-нибудь изменится и Resend начнёт класть их
      // прямо в вебхук, самый частый путь всё равно download_url по id.
      let bytes = null;
      const inlineContent = raw.content ?? raw.content_base64 ?? raw.base64 ?? null;
      if (typeof inlineContent === 'string' && inlineContent) {
        bytes = Buffer.from(inlineContent, 'base64');
      } else {
        const downloadUrl = urlById.get(raw.id) ?? raw.url ?? raw.download_url ?? raw.content_url ?? null;
        if (typeof downloadUrl === 'string' && downloadUrl) {
          const fileResp = await fetch(downloadUrl);
          if (fileResp.ok) {
            bytes = Buffer.from(await fileResp.arrayBuffer());
          }
        }
      }

      if (!bytes || bytes.length === 0) {
        console.error('Вложение письма пропущено — не найдено содержимое (ни content, ни download_url):', JSON.stringify(raw).slice(0, 300));
        continue;
      }

      const uploaded = await uploadAttachment(bytes, contentType, fileName);
      // pageCount — только для решения "стоит ли пытаться автораспознать
      // счёт" (см. api/_invoiceRecognition.js), не часть DocumentFile —
      // вызывающий код (purchase-email-webhook.js) сам решает, класть ли
      // это поле в files (там оно не нужно) или использовать отдельно.
      const ext = uploaded.fileName.split('.').pop()?.toLowerCase();
      const pageCount = ext === 'pdf' ? estimatePdfPageCount(bytes) : 1;
      files.push({ ...uploaded, pageCount });
    } catch (err) {
      console.error('Не удалось обработать вложение письма:', err);
    }
  }
  return files;
}
