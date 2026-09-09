// Извлечение читаемого текста из .docx — владелец, 2026-09-09: реальный
// живой баг — счёт от ЗАО "Волок" пришёл файлом .docx (не PDF), уже был
// разбит на позиции внутри документа (таблица), но recognizeInvoice
// (api/_invoiceRecognition.js) вообще не пыталась его прочитать —
// isRecognizableFileName (Suppliers.tsx) и blockTypeForFileName здесь
// исключали .docx сознательно ("не .xlsx/.docx — им распознавание не
// предлагается"), рассчитанное на случай "каталог на много страниц", а не
// на настоящий разовый счёт-предложение от конкретного поставщика.
//
// .docx — обычный zip-архив, текст лежит в word/document.xml как дерево
// <w:p>(абзац)/<w:tr>(строка таблицы)/<w:tc>(ячейка)/<w:t>(текст). Claude не
// принимает .docx как файл (document-блок API поддерживает только PDF) —
// поэтому вместо пересылки самого файла модели передаём уже извлечённый
// плоский текст обычным text-блоком. Полноценный XML-парсер не подключаем
// (лишняя зависимость ради простой задачи) — текстовые узлы вынимаются
// регуляркой, границы ячеек/строк/абзацев заменяются на taб/перенос строки
// ДО того, как остальные теги вырезаются, чтобы таблица не схлопнулась в
// одну сплошную строку без разделителей.
import JSZip from 'jszip';

export async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xmlFile = zip.file('word/document.xml');
  if (!xmlFile) return '';
  const xml = await xmlFile.async('string');
  return docxXmlToText(xml);
}

function docxXmlToText(xml) {
  let text = xml
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
