// Vercel serverless function: расшифровка записи встречи через speech2text.ru
// — асинхронный API (submit → poll → result), не синхронный Whisper.
// Объединяет то, что раньше было двумя отдельными файлами (transcribe-start.js
// + transcribe-poll.js) — Vercel Hobby-план ограничен 12 serverless-функциями
// на деплой (см. журнал docs/session-journal.md, 2026-08-29), а под новую функцию
// сжатия картинок (tinypng-compress.js) понадобился свободный слот.
// Дифференцируются по HTTP-методу — POST start (см. START ниже), GET poll.
//
// POST: клиент грузит аудио ЦЕЛИКОМ в приватный бакет meeting-audio, зовёт
// эту функцию с путём. Функция скачивает файл сервисным ключом, отправляет
// speech2text.ru и сразу удаляет файл из бакета — аудио в системе не
// хранится, дальше обработка идёт на стороне speech2text.ru.
//
// GET: клиент дёргает по таймеру, пока не придёт status:'done'/'error'.
// Результат запрашивается в формате SRT — стандартный, разбирается
// детерминированно без знания проприетарной схемы сегментов/спикеров.
//
// Работает только на Vercel-домене — на статическом хостинге бэкенда нет.

import { SPEECH2TEXT_BASE, speech2TextKeyProblem } from './_speech2text.js';
import { requireStaffAuth } from './_auth.js';

const BUCKET = 'meeting-audio';

async function downloadFromStorage(path) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`Не удалось получить аудиофайл из хранилища (${resp.status})`);
  }
  const contentType = resp.headers.get('content-type') || 'application/octet-stream';
  const buffer = await resp.arrayBuffer();
  return { buffer, contentType };
}

// Best-effort: ошибка удаления не должна ронять уже полученный task id —
// мусорный файл в приватном бакете хуже, чем потерянный результат.
async function deleteFromStorage(path) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
  } catch {
    // осознанно молча
  }
}

async function handleStart(req, res) {
  const { path } = req.body ?? {};
  // Путь строго вида "uploads/<uuid>.<ext>" — защита от чтения чужих путей
  // сервисным ключом (никаких "../", слэшей в id и т.п.).
  if (typeof path !== 'string' || !/^uploads\/[a-zA-Z0-9-]+\.[a-z0-9]+$/.test(path)) {
    res.status(400).json({ error: 'Некорректный путь аудиофайла' });
    return;
  }

  try {
    const { buffer, contentType } = await downloadFromStorage(path);

    const form = new FormData();
    const fileName = path.split('/').pop();
    form.append('file', new Blob([buffer], { type: contentType }), fileName);
    form.append('lang', 'ru');

    const resp = await fetch(`${SPEECH2TEXT_BASE}/api/recognitions/task/file?api-key=${process.env.SPEECH2TEXT_API_KEY}`, {
      method: 'POST',
      body: form,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ошибка отправки в speech2text (${resp.status}): ${text.slice(0, 300)}`);
    }
    const data = await resp.json();
    if (!data.id) {
      throw new Error('speech2text не вернул id задачи');
    }

    await deleteFromStorage(path);
    res.status(200).json({ taskId: data.id });
  } catch (err) {
    // Файл чистим и при ошибке — повторная попытка загрузит его заново.
    await deleteFromStorage(path);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось отправить запись на расшифровку' });
  }
}

// [мм:сс] до часа, [ч:мм:сс] после — как в саммери владельца.
function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function parseSrtCues(srt) {
  const blocks = srt.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const match = lines[timeLineIdx].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->/);
    if (!match) continue;
    const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
    const text = lines.slice(timeLineIdx + 1).join(' ').trim();
    if (text) cues.push({ start, text });
  }
  return cues;
}

// Метки времени вшиваем в текст не на каждую реплику — саммери (формат
// владельца, см. meeting-ai.js) ссылается на таймкоды пунктов, но
// сплошная простыня "[00:01] ... [00:04] ..." на каждую фразу нечитаема.
const TIMESTAMP_EVERY_SECONDS = 45;

function cuesToText(cues) {
  let out = '';
  let lastMark = -Infinity;
  for (const cue of cues) {
    if (cue.start - lastMark >= TIMESTAMP_EVERY_SECONDS) {
      out += `${out ? '\n' : ''}[${formatTimestamp(cue.start)}] `;
      lastMark = cue.start;
    } else {
      out += ' ';
    }
    out += cue.text;
  }
  return out;
}

async function handlePoll(req, res) {
  const taskId = typeof req.query?.taskId === 'string' ? req.query.taskId : '';
  // Реальные id speech2text.ru содержат и подчёркивание, не только дефис
  // (пример: "RfZogu6P6sN2UfoeP-6sSIy_dfnE-335") — более узкая проверка без
  // "_" отбрасывала каждый такой id как "некорректный" (см. журнал docs/session-journal.md).
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    res.status(400).json({ error: 'Некорректный id задачи' });
    return;
  }
  const apiKey = process.env.SPEECH2TEXT_API_KEY;

  try {
    const statusResp = await fetch(`${SPEECH2TEXT_BASE}/api/recognitions/${taskId}?api-key=${apiKey}`);
    if (!statusResp.ok) {
      const text = await statusResp.text();
      throw new Error(`Ошибка проверки статуса (${statusResp.status}): ${text.slice(0, 300)}`);
    }
    const task = await statusResp.json();
    const statusValue = task?.status?.value;
    const description = task?.status?.description;

    // Официальная таблица статусов (из документации speech2text.ru):
    // value       code  описание
    // queued      0/30  задание создано / бот присоединился / ведёт запись
    // (без value) 80    контент получен (промежуточный шаг file-флоу)
    // (без value) 100   распознавание речи — этот и был единственный
    //                   "processing"-статус, реально увиденный вживую
    // paused      102   ПРИОСТАНОВЛЕНО — в аккаунте закончились доступные
    //                   минуты; результата не будет, пока не пополнят —
    //                   не то же самое, что "ещё считает", нельзя опрашивать
    //                   бесконечно как processing
    // done        200   успешно, есть результат
    // done        204   завершено, но речь не обнаружена — result: null
    // error       404/406/407/501/502  разные причины сбоя
    if (statusValue === 'queued' || statusValue === 'processing' || task?.status?.code === 80 || task?.status?.code === 100) {
      res.status(200).json({ status: 'processing' });
      return;
    }
    if (statusValue === 'paused') {
      res.status(200).json({ status: 'error', error: description || 'В аккаунте speech2text.ru закончились доступные минуты распознавания' });
      return;
    }
    if (statusValue === 'error') {
      res.status(200).json({ status: 'error', error: description || 'Не удалось расшифровать запись' });
      return;
    }

    // value === 'done' (или неизвестное будущее значение) — пробуем забрать
    // результат; code 204 ("речь не обнаружена") придёт сюда же и получит
    // понятное сообщение из description, а не свалится в общую ошибку.
    const resultResp = await fetch(`${SPEECH2TEXT_BASE}/api/recognitions/${taskId}/result/srt?api-key=${apiKey}`);
    if (!resultResp.ok) {
      const body = await resultResp.json().catch(() => ({}));
      const message = body.message || description || 'Распознавание не обнаружило речь в записи';
      res.status(200).json({ status: 'error', error: message });
      return;
    }

    const srt = await resultResp.text();
    const cues = parseSrtCues(srt);
    if (cues.length === 0) {
      res.status(200).json({ status: 'error', error: description || 'Распознавание не обнаружило речь в записи' });
      return;
    }

    res.status(200).json({ status: 'done', text: cuesToText(cues) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось проверить статус расшифровки' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;
  const keyProblem = speech2TextKeyProblem();
  if (keyProblem) {
    res.status(500).json({ error: keyProblem });
    return;
  }

  if (req.method === 'POST') {
    await handleStart(req, res);
  } else {
    await handlePoll(req, res);
  }
}
