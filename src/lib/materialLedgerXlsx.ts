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
  };
}
