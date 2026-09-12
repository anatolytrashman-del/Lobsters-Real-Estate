import type { MaterialLedger } from '../data/materialLedgers';
import type { PurchaseItem } from '../data/purchases';

// Мастер-ведомость (владелец, 2026-09-12: "у меня формируются отдельные
// ведомости для поставщиков, но мне нужна еще одна общая мастер-ведомость, в
// которую будет добавлено вообще все, что в других ведомостях. И как только в
// отдельных ведомостях будет что-то меняться или их будет становиться
// больше/меньше, мастер-ведомость тоже должна обновляться").
//
// ГЛАВНОЕ РЕШЕНИЕ: мастер-ведомость НЕ хранится в базе (нет своей строки в
// material_ledgers) — она каждый раз собирается из уже загруженного списка
// ведомостей. Именно это и даёт требование "обновляется сама": любое
// изменение отдельной ведомости (правка позиций, переименование, удаление,
// создание новой) меняет тот же массив materialLedgers, из которого мастер
// пересчитывается на следующем рендере — синхронизировать нечего, разъехаться
// нечему. Хранимая копия потребовала бы триггера/пересборки на каждое
// изменение и рано или поздно отстала бы от источника.
//
// Мастер собирается ПО СМЕТАМ, а не одна на всё: отдельные ведомости
// привязаны к смете (MaterialLedger.estimateId, см. data/materialLedgers.ts —
// владелец, 2026-09-09: "когда выбран Red One, всё равно видны шаблоны
// Зелёного" считалось багом), поэтому свалить Red One и Зелёный в одну
// мастер-ведомость означало бы вернуть тот же баг, только в файле, который
// уходит поставщику. Ведомости без сметы (estimateId=null — созданные из
// письма, "универсальные") получают свою отдельную мастер-ведомость.
export const MASTER_LEDGER_ID_PREFIX = 'master:';
const COMMON_GROUP_KEY = 'common';

// Виртуальная ведомость отличается от настоящей только по id — этого хватает,
// чтобы: не отправить её в updateMaterialLedger/deleteMaterialLedger (таких
// строк в базе нет), не положить её в стейт настоящих ведомостей и не собрать
// мастер-ведомость из мастер-ведомостей.
export function isMasterLedgerId(id: string): boolean {
  return id.startsWith(MASTER_LEDGER_ID_PREFIX);
}

// Ключ "та же самая позиция". Ведомости под разных поставщиков пересекаются
// (одна и та же позиция сметы попала и в "Окна", и в "Универсальные") — в
// мастере она нужна один раз, иначе поставщик увидит один материал дважды.
//
// Но ОДИНАКОВОЕ НАЗВАНИЕ ещё не значит одинаковую позицию: владелец,
// 2026-09-11 — "если две позиции с одинаковыми заголовками, но разными
// объёмами и комментариями, в итоговой ведомости позиции не суммируются и
// идут не как две, а как одна" (та же краска на 400 м² в подвал и 720 м² с
// другим примечанием — это два разных запроса поставщику). Поэтому в ключ
// входят и объём, и ед., и параметры: склеиваются только полные дубли, любое
// расхождение остаётся отдельной строкой. Количества специально НЕ
// суммируются — арифметику по чужим ведомостям тут никто не заказывал, а
// молча сложенный объём в файле поставщику страшнее лишней строки.
function itemKey(item: PurchaseItem): string {
  const base = item.sourceMaterialId
    ? `src:${item.sourceMaterialId}`
    : `name:${(item.name ?? '').trim().toLowerCase()}`;
  return [
    base,
    item.quantity ?? '',
    (item.unit ?? '').trim().toLowerCase(),
    (item.note ?? '').trim().toLowerCase(),
  ].join('|');
}

// Позиции всех переданных ведомостей подряд, без полных дублей. Порядок —
// как в списке ведомостей (он отсортирован по названию, см.
// fetchMaterialLedgers), внутри ведомости — как в ней самой.
export function mergeLedgerItems(ledgers: MaterialLedger[]): PurchaseItem[] {
  const seen = new Set<string>();
  const merged: PurchaseItem[] = [];
  for (const ledger of ledgers) {
    for (const item of ledger.items) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      // id позиции должен быть уникален внутри мастера (React-ключи, правка
      // объёма/параметров перед отправкой в MaterialLedgerModal), а одна и та
      // же позиция сметы, добавленная в две ведомости, получает там СВОИ
      // разные id — но полагаться на это нельзя, поэтому префиксуем id самой
      // ведомости.
      merged.push({ ...item, id: `${ledger.id}:${item.id}` });
    }
  }
  return merged;
}

// Одна мастер-ведомость для одной группы (смета или "без сметы").
// null, если собирать не из чего: при одной ведомости в группе мастер — её
// же полная копия, и в списках это только шум. Появится сама, как только у
// сметы будет вторая ведомость.
export function buildMasterLedger(
  ledgers: MaterialLedger[],
  estimateId: string | null,
  estimateName?: string,
): MaterialLedger | null {
  const sources = ledgers.filter((l) => !isMasterLedgerId(l.id));
  if (sources.length < 2) return null;
  const name = estimateName?.trim()
    ? `Мастер-ведомость — ${estimateName.trim()}`
    : 'Мастер-ведомость — без сметы';
  return {
    id: `${MASTER_LEDGER_ID_PREFIX}${estimateId ?? COMMON_GROUP_KEY}`,
    name,
    items: mergeLedgerItems(sources),
    estimateId,
    // Дата самой свежей из вошедших ведомостей — у виртуальной строки своей
    // даты создания нет, а поле в типе обязательное.
    createdAt: sources.reduce((max, l) => (l.createdAt > max ? l.createdAt : max), sources[0].createdAt),
  };
}

// Мастер-ведомости по всем группам сразу — для списков/пикеров, где сметы не
// выбрано (композер письма, массовая рассылка). estimateName — как показывать
// смету в названии мастера; если смета не найдена, группа получает подпись
// "без сметы".
export function buildMasterLedgers(
  ledgers: MaterialLedger[],
  estimateName: (estimateId: string) => string | undefined,
): MaterialLedger[] {
  const byEstimate = new Map<string | null, MaterialLedger[]>();
  for (const ledger of ledgers) {
    if (isMasterLedgerId(ledger.id)) continue;
    const group = byEstimate.get(ledger.estimateId) ?? [];
    group.push(ledger);
    byEstimate.set(ledger.estimateId, group);
  }
  const masters: MaterialLedger[] = [];
  for (const [estimateId, group] of byEstimate) {
    const master = buildMasterLedger(group, estimateId, estimateId ? estimateName(estimateId) : undefined);
    if (master) masters.push(master);
  }
  // Мастера смет по алфавиту, мастер "без сметы" — последним (он про
  // ведомости без контекста, в списке он нужен реже).
  return masters.sort((a, b) => {
    if (!a.estimateId !== !b.estimateId) return a.estimateId ? -1 : 1;
    return a.name.localeCompare(b.name, 'ru');
  });
}
