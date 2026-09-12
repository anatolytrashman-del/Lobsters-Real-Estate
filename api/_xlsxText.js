// Извлечение читаемого текста из .xlsx — продолжение истории _docxText.js
// (владелец, 2026-09-12: "мне нужно автоматическое распознавание счетов...
// в том числе для полученных счетов"). Реальный случай из базы: поставщик
// прислал "Грильято.xlsx" — файл в переписке лежит, а распознавание его не
// видело вовсе, потому что recognizeInvoice принимала только PDF/картинку/
// .docx. Счёт в Excel — обычное дело у мелких поставщиков, отдельная
// причина терять данные.
//
// .xlsx — тот же zip, что и .docx, но текст размазан по двум местам:
// xl/sharedStrings.xml (общий словарь строк, на который ячейки ссылаются
// номером) и xl/worksheets/sheetN.xml (сами ячейки). Полноценный парсер
// не подключаем по той же причине, что и в _docxText.js — лишняя
// зависимость ради плоского текста для модели; XML разбирается регулярками,
// границы ячеек/строк заменяются на таб/перенос ДО вырезания тегов, иначе
// таблица счёта схлопнется в одну строку.
//
// Формулы намеренно игнорируются (<f>): в файле от поставщика нас
// интересует посчитанное значение (<v>), а не выражение — а для ячеек с
// формулой Excel всё равно хранит рядом последний вычисленный результат.
import JSZip from 'jszip';

const MAX_SHEETS = 5;
const MAX_CHARS = 60000;

export async function extractXlsxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared = sharedFile ? parseSharedStrings(await sharedFile.async('string')) : [];

  const sheets = zip
    .file(/^xl\/worksheets\/sheet\d+\.xml$/)
    .sort((a, b) => sheetIndex(a.name) - sheetIndex(b.name))
    .slice(0, MAX_SHEETS);

  const parts = [];
  for (const sheet of sheets) {
    const text = sheetXmlToText(await sheet.async('string'), shared);
    if (text) parts.push(text);
  }
  return parts.join('\n\n').slice(0, MAX_CHARS).trim();
}

function sheetIndex(name) {
  const match = /sheet(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

// <si> — одна строка словаря; внутри может быть несколько <t> (Excel бьёт
// строку на "runs", когда часть текста выделена другим шрифтом) — их надо
// склеить без разделителя, иначе "Грильято 100х100" станет двумя словами
// в разных ячейках.
function parseSharedStrings(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join(''),
  );
}

function sheetXmlToText(xml, shared) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      cells.push(cellValue(cellMatch[1], cellMatch[2] ?? '', shared));
    }
    // Пустые строки (разделители, форматирование) в текст не тащим — они
    // только раздувают промпт.
    if (cells.some((c) => c !== '')) rows.push(cells.join('\t'));
  }
  return rows.join('\n');
}

function cellValue(attrs, inner, shared) {
  const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
  // t="inlineStr" — строка лежит прямо в ячейке, t="s" — ссылка номером в
  // общий словарь sharedStrings, всё остальное (число, дата, формула) —
  // готовое значение в <v>.
  if (type === 'inlineStr') {
    return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
  }
  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
  if (raw == null) return '';
  if (type === 's') {
    const idx = Number(decodeXml(raw));
    return Number.isInteger(idx) ? (shared[idx] ?? '') : '';
  }
  return decodeXml(raw);
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}
