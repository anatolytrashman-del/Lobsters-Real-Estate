// Генерация .docx "Адрес доставки" из текста, заданного на карточке
// юрлица (LegalEntity.deliveryInfo, см. data/legalEntities.ts).
//
// Владелец, 2026-09-11: "хочу прикреплять к поставкам вместе с ведомостью
// материала и карточкой организации ещё инфу по доставке... для всех
// поставок ООО Матрёшка нужен документ, где указано: адрес объекта,
// возможна доставка машинами до 20 тонн с боковой разгрузкой, разгрузка
// осуществляется нами самостоятельно". Текст у каждого юрлица свой
// (у Матрёшки — свой объект и свои условия разгрузки), поэтому он не зашит
// в код, а редактируется на странице юрлица.
//
// Почему именно файл, а не текст в письме: поставщику это нужно переслать
// логисту/водителю — как и карточку организации, такую справку удобнее
// отдавать вложением. Сгенерированный файл кладётся в Storage ОДИН РАЗ при
// сохранении текста (LegalEntity.deliveryFile) — дальше оба места отправки
// (SupplierCorrespondenceTab и scripts/process-bulk-send-jobs.mjs) цепляют
// его ровно тем же кодом, что и карточку организации, по url. Иначе
// пришлось бы дублировать генерацию .docx ещё и в .mjs-воркере.
//
// jszip уже есть в зависимостях (тянется docx-preview), импорт динамический —
// по той же причине, что и у xlsx в materialLedgerXlsx.ts: не раздувать
// чанк админки ради файла, который собирается раз в полгода.

// Владелец, 2026-09-11: "переименуй файл в Адрес доставки" — так он
// называется и в письме, и заголовком внутри документа.
export const DELIVERY_INFO_FILE_NAME = 'Адрес доставки.docx';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Один абзац документа. bold/size — для заголовка; size в half-points, как
// того требует сам формат (24 = 12pt).
function paragraph(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const size = opts.size ?? 24;
  const runProps = `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${
    opts.bold ? '<w:b/>' : ''
  }<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  const runs = text
    ? `<w:r>${runProps}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
    : `<w:r>${runProps}<w:t xml:space="preserve"></w:t></w:r>`;
  return `<w:p><w:pPr><w:spacing w:after="160"/>${runProps}</w:pPr>${runs}</w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

// Минимальный styles.xml — без него Word открывает файл, но docx-preview
// (наш предпросмотр вложений, см. DocumentPreviewModal) рисует текст
// дефолтным Times New Roman вразнобой с самим документом.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;

export async function buildDeliveryInfoDocx(entityName: string, deliveryInfo: string): Promise<File> {
  const { default: JSZip } = await import('jszip');
  const body = [
    paragraph('Адрес доставки', { bold: true, size: 28 }),
    ...(entityName ? [paragraph(entityName, { bold: true })] : []),
    // Пустые строки исходного текста сохраняем как пустые абзацы — владелец
    // разделяет ими смысловые блоки (адрес / условия разгрузки).
    ...deliveryInfo.replace(/\r\n/g, '\n').split('\n').map((line) => paragraph(line.trim())),
  ].join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1701"/></w:sectPr></w:body></w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file('word/document.xml', documentXml);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS);
  zip.file('word/styles.xml', STYLES);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], DELIVERY_INFO_FILE_NAME, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
