// Vercel serverless function: дёргает Vercel Deploy Hook, чтобы пересобрать
// прод сразу после сохранения объекта в админке (см. lib/objectsApi.ts) —
// иначе пререндеренный при сборке HTML (scripts/prerender.mjs, SEO_PLAN.md
// Э2-1) хранит старые title/meta/цену объекта до следующего обычного пуша.
// URL хука — секрет (POST на него запускает реальную пересборку прода,
// незачем светить его в клиентском бандле), лежит только в переменных
// окружения Vercel: VERCEL_DEPLOY_HOOK_URL.
//
// Best-effort: если хук не настроен или Vercel недоступен, отвечаем 200 —
// это не должно ронять сохранение объекта в админке, только логируется.
//
// P0.3 аудита безопасности: требует сессию сотрудника (раньше — вообще без
// проверки, любой мог дёргать реальную пересборку прода) + дебаунс — не
// чаще одной пересборки за DEBOUNCE_MS, даже если сохранили несколько
// объектов подряд за одну правку. Отметка времени — в таблице
// deploy_debounce (RLS без единой политики — доступна только service_role,
// как и должно быть для чисто служебной метки).
//
// Владелец, 2026-09-09: "при каждой отправке письма [массовой рассылки] ты
// запускал этот костыль, а после отправки всех писем — останавливал" —
// вместо периодического опроса сессией Claude (не переживает конец сессии,
// не срабатывает мгновенно) настоящий автотриггер: BulkSendModal сразу
// после постановки задания в очередь (insertBulkSendJob) вызывает этот же
// эндпоинт с action:'dispatch-bulk-send' — функция сама дёргает
// workflow_dispatch на process-bulk-send-jobs.yml через GitHub REST API, не
// дожидаясь ни планового крона (тот не срабатывает сам, см. журнал), ни
// ручного вмешательства. Сам воркфлоу разом обрабатывает ВСЕ накопленные
// pending-письма с паузой между ними и завершается сам, когда очередь
// пуста — отдельного "остановить" не требуется, это не постоянный опрос, а
// одноразовый запуск на каждую постановку в очередь. Нужен новый секрет
// GITHUB_ACTIONS_DISPATCH_TOKEN (fine-grained PAT, доступ только к этому
// репозиторию, permission Actions: Read and write) в Vercel env — без него
// (или при сетевой ошибке) просто логируем и отвечаем 200, планового крона
// это не отменяет, только не даёт дополнительного мгновенного триггера.
import { requireStaffAuth } from './_auth.js';

const DEBOUNCE_MS = 5 * 60_000;

const GITHUB_OWNER = 'anatolytrashman-del';
const GITHUB_REPO = 'redevelopment';
const GITHUB_REF = 'claude/redevelopment-platform-prototype-oodobu';

async function dispatchBulkSendWorkflow(res) {
  const token = process.env.GITHUB_ACTIONS_DISPATCH_TOKEN;
  if (!token) {
    console.warn('[trigger-rebuild] GITHUB_ACTIONS_DISPATCH_TOKEN не настроен — воркфлоу рассылки не запущен, ждём планового крона');
    res.status(200).json({ triggered: false, reason: 'no github token configured' });
    return;
  }
  try {
    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/process-bulk-send-jobs.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: GITHUB_REF }),
      },
    );
    if (!ghRes.ok) {
      const text = await ghRes.text();
      console.error('[trigger-rebuild] workflow_dispatch отклонён GitHub:', ghRes.status, text.slice(0, 300));
    }
    res.status(200).json({ triggered: ghRes.ok });
  } catch (err) {
    console.error('[trigger-rebuild] не удалось вызвать workflow_dispatch:', err);
    res.status(200).json({ triggered: false, reason: 'fetch failed' });
  }
}

async function getLastTriggeredAt() {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/deploy_debounce?id=eq.default&select=triggered_at`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0]?.triggered_at ?? null;
}

async function setLastTriggeredAt(iso) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/deploy_debounce`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: 'default', triggered_at: iso }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;

  const { action } = req.body ?? {};
  if (action === 'dispatch-bulk-send') {
    await dispatchBulkSendWorkflow(res);
    return;
  }

  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) {
    console.warn('[trigger-rebuild] VERCEL_DEPLOY_HOOK_URL не настроен — пересборка не запущена');
    res.status(200).json({ triggered: false, reason: 'no deploy hook configured' });
    return;
  }

  const lastTriggeredAt = await getLastTriggeredAt();
  if (lastTriggeredAt && Date.now() - new Date(lastTriggeredAt).getTime() < DEBOUNCE_MS) {
    res.status(200).json({ triggered: false, reason: 'debounced' });
    return;
  }
  // Отметку ставим до самого вызова хука — минимизирует (не гарантирует
  // абсолютно, тут не транзакция) окно, в котором два почти одновременных
  // сохранения объекта обе проскочат проверку выше.
  await setLastTriggeredAt(new Date().toISOString());

  try {
    const hookRes = await fetch(hookUrl, { method: 'POST' });
    res.status(200).json({ triggered: hookRes.ok });
  } catch (err) {
    console.error('[trigger-rebuild] не удалось дёрнуть Deploy Hook:', err);
    res.status(200).json({ triggered: false, reason: 'fetch failed' });
  }
}
