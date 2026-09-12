// Vercel serverless function: распознавание счёта/КП, загруженного вручную
// в карточку предложения на вкладке "Ресерч" (Suppliers.tsx) —
// action:'recognize-invoice'. Единственный action, оставшийся в этом файле.
//
// 2026-09-11: веб-поиск поставщиков (второй, исходный смысл имени этого
// файла) переехал на асинхронную очередь — см. supplier_web_search_jobs +
// scripts/process-supplier-web-search-jobs.mjs + api/trigger-rebuild.js
// (action:'dispatch-supplier-search'). Причина переезда — владелец:
// "минуту ждать перед открытой вкладкой не захочется... я формирую поиск,
// система ищет в фоне, я закрываю вкладку, когда найдёт — уведомление, по
// аналогии с письмами". Плюс реальная диагностика того же дня показала,
// что один синхронный вызов (как было раньше) даёт от силы 15-27 компаний
// независимо от лимита поисков — модель сама решает остановиться (см.
// подробный разбор в scripts/process-supplier-web-search-jobs.mjs), а не
// упирается в стену MAX_SEARCHES. Второй авто-раунд с доисключением уже
// найденного (тот же принцип, что уже был у ручной кнопки "Искать ещё")
// теперь тоже живёт в фоновом скрипте, не здесь — HTTP-путь синхронного
// поиска отсюда убран целиком, файл переименовывать не стали (тот же файл,
// Vercel Hobby на пределе 12 функций, см. purchase-send-email.js).
// Имя файла осталось прежним ради стабильного URL для клиента
// (Suppliers.tsx уже дёргает /api/supplier-web-search для recognize-invoice).
//
// 2026-09-03: раньше этот же файл ещё обрабатывал action:'recognize-invoice'
// — ручную кнопку "Распознать данные автоматически" в предпросмотре вложения
// (SupplierCorrespondenceTab.tsx). Владелец убрал кнопку ("раз система сама
// распознает данные") — автоматическое распознавание на входящих
// (purchase-email-webhook.js, общий хелпер api/_invoiceRecognition.js)
// осталось единственным путём, ручную ветку здесь удалили вместе с кнопкой.
//
// 2026-09-09: владелец вернул ручной путь — но не для типизированного ввода
// цены (обсуждали и отвергли, "вручную не будем ничего указывать"), а для
// поставщика, найденного вне переписки в системе (PDF/Excel/скриншот email
// на руках у закупщицы): "добавляем его как нового поставщика и загружаем
// КП, система распознаёт КП и записывает цену в базу". action:
// 'recognize-invoice' восстановлен здесь же — вызывается из формы
// предложения сразу после загрузки файла в "Файлы (счета, спецификации...)"
// (Suppliers.tsx), не из предпросмотра письма (та кнопка остаётся
// убранной, как и была).
import { requireStaffAuth } from './_auth.js';
import { recognizeInvoice } from './_invoiceRecognition.js';
import { checkReliability, checkoKeyProblem, invalidInnReason, saveReliabilityIfNew } from './_checko.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;

  const action = (req.body ?? {}).action;
  if (action === 'recognize-invoice') {
    await handleRecognizeInvoice(req, res);
    return;
  }
  if (action === 'check-reliability') {
    await handleCheckReliability(req, res);
    return;
  }
  res.status(400).json({ error: 'Неизвестное действие' });
}

// Проверка благонадёжности поставщика по ИНН (Checko). Живёт здесь
// action'ом, а не отдельным api/check-reliability.js, не по вкусовым
// соображениям: в api/ ровно 12 serverless-функций, что РОВНО лимит
// Vercel Hobby — тринадцатый файл сломал бы деплой целиком.
//
// Ключ Checko — только на сервере (CHECKO_API_KEY в env Vercel): на фронт
// его отдавать нельзя, там он утёк бы в любой браузер и его бы сожгли
// чужими запросами (тариф считает запросы в сутки).
async function handleCheckReliability(req, res) {
  const keyProblem = checkoKeyProblem();
  if (keyProblem) {
    res.status(500).json({ error: keyProblem });
    return;
  }
  const inn = String((req.body ?? {}).inn ?? '').replace(/\D/g, '');
  const innProblem = invalidInnReason(inn);
  if (!inn || innProblem) {
    res.status(400).json({ error: innProblem ?? 'Не передан ИНН' });
    return;
  }
  try {
    res.status(200).json({ result: await checkReliability(inn) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось проверить поставщика' });
  }
}

// fileUrl — публичная ссылка на уже загруженный в Storage файл (клиент
// грузит его сам через uploadSupplierFile ДО вызова этого action, точно
// так же, как и вложения писем в api/_attachments.js) — сама функция
// recognizeInvoice файлов не хранит, только читает по URL.
async function handleRecognizeInvoice(req, res) {
  const { fileUrl, fileName } = req.body ?? {};
  if (typeof fileUrl !== 'string' || !fileUrl.trim() || typeof fileName !== 'string' || !fileName.trim()) {
    res.status(400).json({ error: 'Не передан файл для распознавания' });
    return;
  }
  try {
    const extraction = await recognizeInvoice(fileUrl.trim(), fileName.trim());
    // Счёт, загруженный в форму руками, — такое же "первое появление ИНН",
    // как и пришедший письмом, поэтому проверка запускается и здесь.
    if (extraction.isInvoice) {
      await saveReliabilityIfNew(extraction.supplierInn);
    }
    res.status(200).json({ extraction });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось распознать документ' });
  }
}
