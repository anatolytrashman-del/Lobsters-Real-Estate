import { supabase } from './supabase';
import { withRetry } from './withRetry';
import { updateSupplierOffer, deleteSupplierOffer } from './supplierResearchApi';
import type { SupplierMessengerContact, SupplierOffer } from '../data/supplierResearch';
import type { DocumentFile } from '../data/contractorDocuments';

// Слияние карточек одного и того же поставщика (см. блок "Универсальные
// поставщики" в data/supplierResearch.ts). Владелец, 2026-09-12: "его надо
// оставить только в универсальных поставщиках, а из других категорий
// удалить, при этом не потерять присланные КП, данные карточки, всю
// переписку и тд".
//
// Поэтому это НЕ удаление дубликатов, а перенос: всё, что висело на
// карточках-дубликатах, переезжает на ту, что остаётся (в категории
// "Универсальные поставщики"), и только после этого пустые дубликаты
// удаляются.
//
// Таблицы, ссылающиеся на supplier_research_offers.id (проверено по
// pg_constraint, все FK — ON DELETE CASCADE):
//   supplier_offer_emails   — переписка            → переносим
//   supplier_offer_quotes   — распознанные КП      → переносим
//   supplier_orders         — доп. заявки-ветки    → переносим
//   bulk_send_job_items     — лог массовых рассылок → переносим
//   supplier_enrichment_jobs — очередь автосбора контактов → НЕ переносим:
//     это техническая очередь, её результат уже записан в поля самой
//     карточки (их мы сливаем ниже), а незавершённое задание на удалённую
//     карточку смысла не имеет — уходит каскадом вместе с ней.
//
// Про переписку отдельно: у каждой карточки свой short_code, зашитый в
// plus-адрес (zakupki+<code>@redevelopment.pro), и после удаления дубликата
// его адрес перестаёт резолвиться напрямую. Ответ поставщика на уже
// отправленное с него письмо всё равно ляжет в нужную карточку —
// api/purchase-email-webhook.js для не найденного кода идёт по фолбэку
// resolveOfferIdByEmailHistory, а тот ищет offer_id по from_address уже
// отправленного письма, то есть по строке, которую мы сюда и переносим.
const OFFER_CHILD_TABLES = ['supplier_offer_emails', 'supplier_offer_quotes', 'supplier_orders', 'bulk_send_job_items'] as const;

function mergeDocuments(target: DocumentFile[], sources: DocumentFile[][]): DocumentFile[] {
  const result = [...target];
  const seen = new Set(result.map((f) => f.url));
  for (const list of sources) {
    for (const file of list) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      result.push(file);
    }
  }
  return result;
}

function mergeMessengers(target: SupplierMessengerContact[], sources: SupplierMessengerContact[][]): SupplierMessengerContact[] {
  const result = [...target];
  const key = (m: SupplierMessengerContact) => `${m.type}|${m.number.trim().toLowerCase()}`;
  const seen = new Set(result.map(key));
  for (const list of sources) {
    for (const m of list) {
      if (seen.has(key(m))) continue;
      seen.add(key(m));
      result.push(m);
    }
  }
  return result;
}

// Карточка-победитель дополняется тем, чего в ней не хватает, но никогда не
// перезаписывается: у неё приоритет по каждому полю (это та карточка, что
// остаётся жить, и её данные человек видел последними). Дубликаты идут в
// том порядке, в каком их передали — первый непустой выигрывает.
export function buildMergedOfferPayload(target: SupplierOffer, sources: SupplierOffer[]): Omit<SupplierOffer, 'id' | 'createdAt' | 'shortCode'> {
  const firstFilled = (pick: (o: SupplierOffer) => string): string => {
    const own = pick(target).trim();
    if (own) return own;
    return sources.map(pick).map((v) => v.trim()).find((v) => v.length > 0) ?? '';
  };

  // Цена/валюта ходят парой: цену берём с той карточки, где она реально
  // есть, вместе с её валютой — иначе рублёвый счёт дубликата отобразится
  // как доллары (currency по умолчанию USD).
  const priceDonor = target.price > 0 ? target : sources.find((o) => o.price > 0);
  // items — снимок позиций последнего распознанного счёта (полная история
  // КП живёт в supplier_offer_quotes, они переносятся отдельно), поэтому не
  // склеиваем списки в кучу, а берём первый непустой.
  const itemsDonor = target.items.length > 0 ? target : sources.find((o) => o.items.length > 0);

  return {
    requestId: target.requestId,
    name: target.name,
    contactMethod: target.contact.trim() ? target.contactMethod : (sources.find((o) => o.contact.trim())?.contactMethod ?? target.contactMethod),
    contact: firstFilled((o) => o.contact),
    email: firstFilled((o) => o.email),
    managerName: firstFilled((o) => o.managerName),
    country: firstFilled((o) => o.country),
    websiteUrl: firstFilled((o) => o.websiteUrl),
    listingUrl: firstFilled((o) => o.listingUrl),
    contactSource: firstFilled((o) => o.contactSource),
    messengers: mergeMessengers(target.messengers, sources.map((o) => o.messengers)),
    catalogModelName: firstFilled((o) => o.catalogModelName),
    catalogModelPhoto: target.catalogModelPhoto ?? sources.find((o) => o.catalogModelPhoto)?.catalogModelPhoto ?? null,
    price: priceDonor?.price ?? 0,
    currency: priceDonor?.currency ?? target.currency,
    items: itemsDonor?.items ?? [],
    files: mergeDocuments(target.files, sources.map((o) => o.files)),
    // Достаточно, чтобы карточку проверил человек хоть где-то: снимать уже
    // выданную верификацию при слиянии не за что.
    verified: target.verified || sources.some((o) => o.verified),
    inn: (target.inn ?? '').trim() ? target.inn : (sources.map((o) => o.inn).find((v) => (v ?? '').trim()) ?? null),
  };
}

function moveChildRows(table: string, fromOfferId: string, toOfferId: string): Promise<void> {
  return withRetry(async () => {
    const { error } = await supabase.from(table).update({ offer_id: toOfferId }).eq('offer_id', fromOfferId);
    if (error) throw error;
  });
}

// Порядок шагов важен именно такой: сначала переносим всё, что можно
// потерять (переписка, КП, заявки), и только потом удаляем дубликаты. Если
// операция оборвётся посередине, в худшем случае останутся пустые карточки
// дубликатов — данные не пропадут ни на каком шаге.
export async function mergeSupplierOffers(target: SupplierOffer, sources: SupplierOffer[]): Promise<SupplierOffer> {
  const realSources = sources.filter((o) => o.id !== target.id);
  if (realSources.length === 0) return target;

  for (const source of realSources) {
    for (const table of OFFER_CHILD_TABLES) {
      await moveChildRows(table, source.id, target.id);
    }
  }

  const merged = await updateSupplierOffer(target.id, buildMergedOfferPayload(target, realSources));

  for (const source of realSources) {
    await deleteSupplierOffer(source.id);
  }

  return merged;
}
