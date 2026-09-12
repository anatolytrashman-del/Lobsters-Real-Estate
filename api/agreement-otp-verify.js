// Vercel serverless function: второй шаг подписания соглашения о намерениях.
// Проверяет одноразовый код, затем копирует гугл-документ шаблона
// (env INTENT_AGREEMENT_TEMPLATE_ID — id строки в document_templates),
// подставляет данные покупателя/кабинета и видимую отметку о факте
// электронного подписания, экспортирует результат в PDF и сохраняет его
// в Supabase Storage — клиенту и админке нужен самостоятельный файл,
// а не ссылка на гугл-документ.

import {
  batchUpdateDoc,
  copyDoc,
  deleteDoc,
  exportDocAsPdf,
  extractDocId,
  fetchDocumentTemplate,
  getGoogleAccessToken,
} from './_google.js';
import { evaluateOtpVerification } from './_otp.js';

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function formatDateGenitive(date) {
  return `«${date.getDate()}» ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()} г.`;
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

async function fetchSignatureRow(id) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/agreement_signatures?id=eq.${id}&select=*`;
  const resp = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) throw new Error('Не удалось загрузить заявку на подписание');
  const rows = await resp.json();
  return rows[0] ?? null;
}

async function updateSignatureRow(id, patch) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agreement_signatures?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Не удалось обновить заявку на подписание: ${text}`);
  }
  const rows = await resp.json();
  return rows[0];
}

async function uploadPdfToStorage(path, bytes) {
  const resp = await fetch(
    `${process.env.SUPABASE_URL}/storage/v1/object/object-documents/${path}`,
    {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/pdf',
      },
      body: Buffer.from(bytes),
    },
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Не удалось сохранить PDF: ${text}`);
  }
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/object-documents/${path}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { signatureId, code } = req.body ?? {};
  if (!signatureId || !code) {
    res.status(400).json({ error: 'signatureId и code обязательны' });
    return;
  }

  try {
    const row = await fetchSignatureRow(signatureId);
    if (!row) {
      res.status(404).json({ error: 'Заявка на подписание не найдена' });
      return;
    }
    const verification = evaluateOtpVerification(row, code);
    if (verification.outcome === 'already_verified') {
      res.status(200).json({ documentUrl: verification.documentUrl });
      return;
    }
    if (verification.outcome === 'too_many_attempts') {
      res.status(400).json({ error: 'Слишком много попыток. Запросите новый код.' });
      return;
    }
    if (verification.outcome === 'expired') {
      res.status(400).json({ error: 'Код истёк, запросите новый' });
      return;
    }
    if (verification.outcome === 'invalid_code') {
      await updateSignatureRow(row.id, { otp_attempts: row.otp_attempts + 1 });
      res.status(400).json({ error: 'Неверный код' });
      return;
    }

    // Фиксированное рабочее место — отдельный шаблон соглашения (не м²,
    // а формат/место), который владелец заводит сам через админку "Шаблоны",
    // как и обычный INTENT_AGREEMENT_TEMPLATE_ID.
    const templateId = row.is_workstation
      ? process.env.WORKSTATION_AGREEMENT_TEMPLATE_ID
      : process.env.INTENT_AGREEMENT_TEMPLATE_ID;
    const template = await fetchDocumentTemplate(templateId);
    const docId = extractDocId(template.url);
    if (!docId) throw new Error('Не удалось определить ID документа из ссылки шаблона');

    const accessToken = await getGoogleAccessToken();
    const now = new Date();
    const isMale = row.buyer_gender === 'Мужчина';
    const signedAtLabel = now.toLocaleString('ru-RU', { timeZone: 'Europe/Minsk', dateStyle: 'short', timeStyle: 'short' });
    const signatureStamp =
      `Подписано электронно. ${row.buyer_name}, ${signedAtLabel} (Минск). ` +
      `Идентификация подтверждена кодом на email ${maskEmail(row.email)}. ` +
      `IP: ${row.ip ?? '—'}. ID подписания: ${row.id}.`;

    const values = {
      date: formatDateGenitive(now),
      buyer_name: row.buyer_name,
      buyer_gender_title: isMale ? 'Гражданин' : 'Гражданка',
      buyer_gender_suffix: isMale ? 'проживающий' : 'проживающая',
      buyer_citizenship: row.buyer_citizenship || 'РБ',
      buyer_passport: row.buyer_passport,
      buyer_passport_issued: row.buyer_passport_issued,
      buyer_address: row.buyer_address,
      area: row.is_workstation ? 'фиксированное рабочее место' : `${row.zone_area} `,
      room_number: row.is_workstation ? row.zone_label || '—' : row.zone_floor_label || '—',
      signature_stamp: signatureStamp,
    };

    const copy = await copyDoc(docId, `Соглашение о намерениях — ${row.buyer_name} — ${now.toLocaleDateString('ru-RU')}`, accessToken);

    const requests = Object.entries(values).map(([key, text]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: true },
        replaceText: text,
      },
    }));
    await batchUpdateDoc(copy.id, requests, accessToken);

    const pdfBytes = await exportDocAsPdf(copy.id, accessToken);
    const path = `agreements/${row.id}.pdf`;
    const documentUrl = await uploadPdfToStorage(path, pdfBytes);

    // Черновая гугл-копия больше не нужна — итог живёт как PDF в Storage.
    await deleteDoc(copy.id, accessToken);

    await updateSignatureRow(row.id, {
      verified_at: now.toISOString(),
      document_url: documentUrl,
    });

    res.status(200).json({ documentUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось подтвердить подписание' });
  }
}
