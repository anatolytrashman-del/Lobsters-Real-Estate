import type { PurchaseItem } from '../data/purchases';

// Генерация .xlsx ведомости материалов для вложения в письмо поставщику
// (владелец, 2026-09-03: "система генерирует эксель-табличку с материалами
// и количеством"). ВАЖНО про выбор библиотеки: у пакета xlsx (SheetJS) есть
// известные высокие CVE (prototype pollution, ReDoS) — но обе живут ИСКЛЮЧИТЕЛЬНО
// в чтении/парсинге чужого .xlsx (XLSX.read/readFile), который здесь никогда
// не вызывается. Используем только запись (aoa_to_sheet + write) над данными,
// которые сами же и собрали, поэтому эти CVE к этому коду не применимы —
// держать в голове при апдейте зависимости и не начинать вызывать XLSX.read
// в этом файле без пересмотра этого решения.
//
// Импорт динамический (не статический `import * as XLSX`) — библиотека
// весит ~280 КБ минифицированной, а страница "Поставщики" грузится с
// админки лениво уже целиком (см. App.tsx); статический импорт раздувал бы
// этот один чанк на каждое открытие страницы, даже если ведомость ни разу
// не понадобится. Так xlsx подгружается только по клику "Прикрепить".
export interface LedgerAttachment {
  fileName: string;
  contentType: string;
  contentBase64: string;
  // Ключ СОДЕРЖИМОГО ведомости (sha256 от названия + строк таблицы) — по нему
  // сервер понимает, что эта ведомость уже уходила, и не шлёт владельцу копию
  // второй раз (владелец, 2026-09-11: копия на КАЖДУЮ УНИКАЛЬНУЮ ведомость,
  // а не на каждое письмо — в массовой рассылке одна ведомость уходит
  // десяткам поставщиков). Хэшируются именно данные, а не байты .xlsx:
  // SheetJS пишет в docProps момент создания файла, поэтому у двух генераций
  // одной и той же ведомости байты (и их хэш) разные.
  //
  // Необязательное поле: этим же типом описаны обычные файлы, прикреплённые
  // руками (lib/legalEntityAttachment.ts) — у них ключа нет и копия по ним
  // не шлётся, копия — только про ведомости материалов.
  contentKey?: string;
}

async function ledgerContentKey(ledgerName: string, items: PurchaseItem[]): Promise<string> {
  const canonical = JSON.stringify({
    name: ledgerName.trim(),
    items: items.map((i) => [i.name ?? '', i.quantity ?? '', i.unit ?? '', i.note ?? '']),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Владелец, 2026-09-04: "в ведомости оставляй только Позиция, Количество и
// Ед. Именно в этом порядке" — цена/сумма/итого (добавленные раньше)
// убраны: поставщики считают в своей таре (банки, упаковки и т.п.), а не в
// единицах сметы, поэтому голая "цена за шт." из ведомости вводила в
// заблуждение при сравнении — сравнение цен теперь идёт по факту
// полученного КП (см. SupplierCorrespondenceTab.tsx), не по этому файлу.
//
// Владелец, 2026-09-09: "важно не только объём, но и ряд параметров...
// нет поля комментария, которое бы и в таблицу попадало" (Grigliato —
// нужны фактура/формат и т.п., не только площадь) — добавлена колонка
// "Параметры" из PurchaseItem.note, ровно четвёртая, после уже
// утверждённых трёх — не меняет их порядок.
export async function buildMaterialLedgerXlsx(ledgerName: string, items: PurchaseItem[]): Promise<LedgerAttachment> {
  const XLSX = await import('xlsx');
  const headerRow = ['Позиция', 'Количество', 'Ед.', 'Параметры'];
  const rows: (string | number)[][] = [
    headerRow,
    ...items.map((i) => [i.name, i.quantity ?? '', i.unit || '', i.note || '']),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 40 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Ведомость');
  const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }) as string;
  const safeName = ledgerName.trim() || 'Ведомость материалов';
  return {
    fileName: `${safeName}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    contentBase64,
    contentKey: await ledgerContentKey(safeName, items),
  };
}
