import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildDeliveryInfoDocx, DELIVERY_INFO_FILE_NAME } from './deliveryInfoDocx';

// .docx собирается вручную (минимальный OOXML поверх jszip, без библиотеки
// генерации Word) — тест держит то, на чём такая сборка обычно и ломается:
// обязательные части пакета, well-formed XML и экранирование текста,
// который печатает владелец (амперсанд/угловые скобки в адресе объекта
// иначе сделали бы файл нечитаемым для Word).
describe('buildDeliveryInfoDocx', () => {
  const info = 'Адрес объекта: Московская область\n\nДоставка машинами до 20 тонн';

  it('собирает пакет со всеми обязательными частями', async () => {
    const file = await buildDeliveryInfoDocx('ООО «Матрёшка»', info);
    expect(file.name).toBe(DELIVERY_INFO_FILE_NAME);
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) {
      expect(zip.file(part), part).not.toBeNull();
    }
  });

  it('кладёт в документ имя юрлица и каждую строку текста', async () => {
    const zip = await JSZip.loadAsync(await (await buildDeliveryInfoDocx('ООО «Матрёшка»', info)).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('ООО «Матрёшка»');
    expect(xml).toContain('Адрес объекта: Московская область');
    expect(xml).toContain('Доставка машинами до 20 тонн');
    // Пустая строка между блоками — отдельный абзац, а не склейка.
    expect((xml.match(/<w:p>/g) ?? []).length).toBe(5);
  });

  it('экранирует спецсимволы XML', async () => {
    const zip = await JSZip.loadAsync(await (await buildDeliveryInfoDocx('ООО «А & Б»', 'дом 1 <корпус 2>')).arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('ООО «А &amp; Б»');
    expect(xml).toContain('дом 1 &lt;корпус 2&gt;');
    expect(xml).not.toContain('<корпус');
  });
});
