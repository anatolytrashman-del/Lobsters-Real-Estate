// Vercel serverless function: два AI-действия над расшифровкой встречи,
// объединённые в одну функцию по параметру action ('summarize' |
// 'suggest-tasks') — тот же приём, что и у purchase-send-email.js
// (purchaseId ИЛИ offerId). Слияние 2026-08-31: на Hobby-плане Vercel
// лимит 12 serverless-функций на деплой (см. запись в docs/session-journal.md от
// 2026-08-29), а понадобился новый файл api/supplier-web-search.js —
// вместо тринадцатого файла объединены эти два (раньше были отдельными
// api/summarize-meeting.js и api/suggest-tasks.js, логика ниже перенесена
// как есть, без изменений).

import { proxyApiKeyProblem } from './_proxyapi.js';
import { requireStaffAuth } from './_auth.js';

const MODEL = 'gpt-4o';

// gpt-4o, не -mini: часовая встреча со множеством цифр и юридических
// деталей — mini на таком объёме смазывает конкретику, а разница в цене
// на одно саммери — центы на фоне стоимости Whisper-минут.
//
// Формат промта восстановлен из реальных саммери владельца в базе
// (meeting_summaries от 19-20.08.2026, консультации с Татьяной Гаврис,
// которые он сохранял из прошлых чатов) — это его устоявшийся формат,
// не выдуманный. Правки формата — только по просьбе владельца.
const DEFAULT_SUMMARY_PROMPT = `Ты готовишь саммери деловой встречи по расшифровке аудиозаписи. В расшифровке
есть метки времени вида [мм:сс] или [ч:мм:сс] — используй их для таймкодов.
Пиши по-русски, в markdown, строго в следующем формате (это устоявшийся
формат владельца):

# Саммери <тип встречи>: <краткая тема>

**Участники:** кто говорил и в какой роли — из контекста разговора; если имя
не прозвучало, опиши ролью («налоговый консультант», «представитель банка»).
**Длительность:** ~N мин (по меткам времени). Если в записи есть посторонние
куски (случайно записанный чужой разговор, длинная тишина) — отметь это здесь
и не включай их в саммери.
**Задача:** зачем была встреча, что хотели решить.

---

Дальше — пронумерованные тематические блоки (## 1. <Тема> (таймкод–таймкод)),
структура блоков — по реальному ходу разговора, не по фиксированному шаблону.
Внутри блока — подтемы ### и пункты списком.

Правила:
- Каждый содержательный пункт заканчивается таймкодом или диапазоном в
  скобках: (12:34–15:02). Бери их из меток расшифровки.
- Сохраняй всю конкретику: суммы, проценты, сроки, названия, имена, точные
  формулировки условий. Не пиши «обсудили детали» — пиши сами детали.
- Если по ходу встречи остались нерешённые вопросы — отдельный блок
  «## Открытые вопросы» таблицей: | Вопрос | Кто закрывает | Почему важно |.
- Последний блок — «## Следующие шаги»: по каждому участнику отдельно,
  **Имя:** и список его действий с их сроками, если прозвучали.
- Ничего не выдумывай и не додумывай: только то, что есть в расшифровке.
  Если что-то прозвучало неуверенно или спорно — так и помечай.
- Ошибки распознавания в именах/терминах исправляй по контексту разговора,
  если уверен; если не уверен — оставляй как есть.`;

function buildTasksPrompt(assignees, alreadySuggested) {
  return `Ты извлекаешь задачи-поручения из встречи. На входе — либо расшифровка
(в ней есть метки времени [мм:сс]), либо уже готовый блок "Следующие шаги"
из саммери этой встречи (короче, но без меток времени). Верни JSON-объект
вида: {"tasks": [{"title": "...", "description": "...", "assignee": "..." | null}]}

Правила:
- Задача = конкретное действие, о котором на встрече договорились или
  которое кто-то взял на себя. Не выдумывай задач, которых не звучало.
- "title" — короткая формулировка в повелительной форме («Уточнить условия
  кредита в банках»), без имён и дат.
- "description" — контекст: что именно сделать, срок (если прозвучал). Если
  в тексте есть таймкод места в разговоре — укажи его; если меток времени
  во входном тексте нет вообще (блок "Следующие шаги") — не придумывай их.
  1–3 предложения.
- "assignee" — СТРОГО одно значение из списка ответственных ниже, если по
  разговору понятно, кто делает. Если исполнитель не из списка или неясен —
  null (и упомяни в description, кто должен делать по разговору).
- Список допустимых ответственных: ${JSON.stringify(assignees)}.
${alreadySuggested.length > 0 ? `- Эти задачи уже предлагались раньше — НЕ повторяй их и близкие к ним: ${JSON.stringify(alreadySuggested)}.` : ''}
- Если поручений в разговоре нет — верни {"tasks": []}.`;
}

async function callProxyApi(messages, extra) {
  const resp = await fetch('https://api.proxyapi.ru/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PROXYAPI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, messages, ...extra }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Ошибка запроса к модели (${resp.status}): ${text.slice(0, 300)}`);
  }
  return resp.json();
}

async function handleSummarize(req, res) {
  const { transcript } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    res.status(400).json({ error: 'Пустая расшифровка' });
    return;
  }
  try {
    const data = await callProxyApi([
      { role: 'system', content: DEFAULT_SUMMARY_PROMPT },
      { role: 'user', content: `Расшифровка встречи:\n\n${transcript}` },
    ]);
    const summary = data.choices?.[0]?.message?.content ?? '';
    if (!summary.trim()) throw new Error('Модель вернула пустой ответ');
    res.status(200).json({ summary });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось сгенерировать саммери' });
  }
}

async function handleSuggestTasks(req, res) {
  const { transcript, assignees, alreadySuggested } = req.body ?? {};
  if (typeof transcript !== 'string' || !transcript.trim()) {
    res.status(400).json({ error: 'Пустая расшифровка' });
    return;
  }
  const validAssignees = Array.isArray(assignees) ? assignees.filter((a) => typeof a === 'string') : [];
  const priorTitles = Array.isArray(alreadySuggested)
    ? alreadySuggested.filter((t) => typeof t === 'string').slice(0, 50)
    : [];

  try {
    const data = await callProxyApi(
      [
        { role: 'system', content: buildTasksPrompt(validAssignees, priorTitles) },
        { role: 'user', content: `Расшифровка встречи:\n\n${transcript}` },
      ],
      { response_format: { type: 'json_object' } },
    );
    let parsed;
    try {
      parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{}');
    } catch {
      throw new Error('Модель вернула некорректный JSON');
    }

    // Нормализация: чужие поля отбрасываем, ответственного вне списка — в
    // пустой массив (модель иногда игнорирует ограничение списка).
    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .filter((t) => t && typeof t.title === 'string' && t.title.trim())
      .map((t) => ({
        title: t.title.trim(),
        description: typeof t.description === 'string' ? t.description.trim() : '',
        assignees: validAssignees.includes(t.assignee) ? [t.assignee] : [],
      }));

    res.status(200).json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось извлечь задачи' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;
  const keyProblem = proxyApiKeyProblem();
  if (keyProblem) {
    res.status(500).json({ error: keyProblem });
    return;
  }

  const { action } = req.body ?? {};
  if (action === 'suggest-tasks') {
    await handleSuggestTasks(req, res);
  } else if (action === 'summarize') {
    await handleSummarize(req, res);
  } else {
    res.status(400).json({ error: 'Неизвестное действие' });
  }
}
