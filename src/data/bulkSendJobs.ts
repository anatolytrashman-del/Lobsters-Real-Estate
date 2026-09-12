import type { LedgerAttachment } from '../lib/materialLedgerXlsx';

// Владелец, 2026-09-09: "можем сделать отправку фоновым процессом, чтобы
// вкладку можно было закрыть?" — раньше BulkSendModal сам гонял цикл
// отправки с паузами 25-35с прямо в браузере (см. журнал docs/session-journal.md), закрыл
// вкладку — рассылка обрывается. Теперь клиент только СТАВИТ задание в
// очередь (эта таблица + bulk_send_job_items), а реально письма шлёт
// scripts/process-bulk-send-jobs.mjs — воркфлоу
// .github/workflows/process-bulk-send-jobs.yml, с тем же темпом между
// письмами, что и раньше, просто на стороне GitHub Actions, не в открытой
// вкладке. Плановый крон (раз в 5 минут) на практике сам не срабатывает
// (см. журнал) — insertBulkSendJob (bulkSendJobsApi.ts) сразу после
// постановки в очередь дополнительно дёргает workflow_dispatch напрямую
// через api/trigger-rebuild.js, крон остаётся только подстраховкой.
export interface BulkSendJob {
  id: string;
  requestId: string;
  legalEntityId: string | null;
  subject: string;
  body: string;
  attachment: LedgerAttachment;
  status: 'queued' | 'done';
  // Кто поставил рассылку (владелец, 2026-09-12 — учёт работы с письмами по
  // сотрудникам). Обработчик очереди переносит это имя в каждое созданное им
  // письмо (sent_by_name в supplier_offer_emails): сами письма отправляет
  // фоновая функция, никакого "вошедшего пользователя" в тот момент уже нет.
  createdByProfileId: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface BulkSendJobRow {
  id: string;
  request_id: string;
  legal_entity_id: string | null;
  subject: string;
  body: string;
  attachment: LedgerAttachment;
  status: string;
  created_by_profile_id: string | null;
  created_by_name: string | null;
  created_at: string;
}
