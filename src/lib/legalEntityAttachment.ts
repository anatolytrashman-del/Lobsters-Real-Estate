import type { LegalEntity } from '../data/legalEntities';

// Замена старого хардкодного data/organizationCard.ts (один-единственный
// файл ЧУП «Лавэ Драйв» на всё приложение) — владелец, 2026-09-09: письмо
// поставщику Vanguard (Россия) всё равно получало белорусскую карточку,
// потому что выбора юрлица не было вовсе. Теперь у каждого юрлица своя
// карточка (LegalEntity.cardFile), а какое юрлицо использовать для
// конкретной категории — решает resolveRequestLegalEntity ниже.
export interface EmailAttachment {
  fileName: string;
  contentType: string;
  contentBase64: string;
}

// Юрлицо категории — своё (если закупщица выбрала для этой категории через
// SupplierRequest.legalEntityId) или юрлицо по умолчанию, если категория
// ничего не выбрала (старые категории, заведённые до этой правки, продолжают
// работать как раньше — с юрлицом по умолчанию). null — юрлица по умолчанию
// тоже нет (только что удалили последнее) — тогда прикреплять нечего.
export function resolveRequestLegalEntity(
  legalEntityId: string | null,
  legalEntities: LegalEntity[],
): LegalEntity | null {
  if (legalEntityId) {
    const found = legalEntities.find((e) => e.id === legalEntityId);
    if (found) return found;
  }
  return legalEntities.find((e) => e.isDefault) ?? null;
}

function guessContentType(fileName: string, blobType: string): string {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'doc') return 'application/msword';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // data:<mime>;base64,<тут> — нам нужна только часть после запятой.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(blob);
  });
}

// Карточка организации хранится в Storage как обычный DocumentFile (url +
// fileName), а Resend (см. api/purchase-send-email.js) ждёт вложение уже
// base64-строкой — та же форма, что и у сгенерированной на клиенте ведомости
// материалов (LedgerAttachment, lib/materialLedgerXlsx.ts).
export async function fetchDocumentFileAsAttachment(file: { url: string; fileName: string }): Promise<EmailAttachment> {
  const res = await fetch(file.url);
  if (!res.ok) throw new Error('Не удалось загрузить карточку организации');
  const blob = await res.blob();
  const contentBase64 = await blobToBase64(blob);
  return { fileName: file.fileName, contentType: guessContentType(file.fileName, blob.type), contentBase64 };
}

// Владелец, 2026-09-10: "мне нужна возможность прикреплять файлы к письму:
// картинки, таблицы, не ограничивай форматы" — произвольный File из
// <input type="file"> (не по URL, как у карточки организации выше) в тот
// же формат вложения, что уже ждёт Resend (см. api/purchase-send-email.js).
// Без ограничения по расширению/типу — что выбрал в проводнике, то и уйдёт.
export async function fileToAttachment(file: File): Promise<EmailAttachment> {
  const contentBase64 = await blobToBase64(file);
  return { fileName: file.name, contentType: guessContentType(file.name, file.type), contentBase64 };
}
