// Минимальный парсер binary plist (формат "bplist00") — нужен, чтобы читать
// .webarchive файлы, которые Safari сохраняет по Cmd+S (владелец прислал
// такой файл как реальный пример выгрузки Светланы, см. журнал docs/session-journal.md,
// 2026-08-26 — оказалось не .txt, как предполагалось изначально). Формат
// bplist00 — открытый и стабильный (Apple CFBinaryPList), сторонняя
// npm-библиотека под браузер не нужна, структура компактная. Разбирает
// в обычные JS-значения: null/boolean/number/string/Uint8Array(Data)/
// массив/объект (dict с строковыми ключами) — по спецификации.
//
// Не поддерживает UID (только для keyed archives, .webarchive их не
// использует) — такие объекты вернутся как null, не должно встречаться.

function readUIntBE(bytes: Uint8Array, offset: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[offset + i];
  return value;
}

export function parseBplist(buffer: ArrayBuffer): unknown {
  const bytes = new Uint8Array(buffer);
  const magic = new TextDecoder('ascii').decode(bytes.subarray(0, 8));
  if (magic !== 'bplist00') throw new Error('Не bplist00 (неверная сигнатура файла)');

  const trailer = bytes.subarray(bytes.length - 32);
  const offsetSize = trailer[6];
  const objectRefSize = trailer[7];
  const numObjects = readUIntBE(trailer, 8, 8);
  const topObject = readUIntBE(trailer, 16, 8);
  const offsetTableOffset = readUIntBE(trailer, 24, 8);

  const offsetTable: number[] = [];
  for (let i = 0; i < numObjects; i++) {
    offsetTable.push(readUIntBE(bytes, offsetTableOffset + i * offsetSize, offsetSize));
  }

  function readObjectRef(offset: number): number {
    return readUIntBE(bytes, offset, objectRefSize);
  }

  // Длина элемента, закодированная в маркере: если nibble < 0xF — это и есть
  // длина; если 0xF — сразу следом идёт целочисленный объект с длиной.
  function readCountAndDataStart(offset: number): { count: number; dataStart: number } {
    const marker = bytes[offset];
    const nibble = marker & 0x0f;
    if (nibble !== 0x0f) return { count: nibble, dataStart: offset + 1 };
    const intMarker = bytes[offset + 1];
    const intNibble = intMarker & 0x0f;
    const intLen = 1 << intNibble;
    const count = readUIntBE(bytes, offset + 2, intLen);
    return { count, dataStart: offset + 2 + intLen };
  }

  const cache = new Map<number, unknown>();

  function readObjectAt(index: number): unknown {
    if (cache.has(index)) return cache.get(index);
    const offset = offsetTable[index];
    const marker = bytes[offset];
    const type = marker & 0xf0;

    let result: unknown;
    switch (type) {
      case 0x00: {
        if (marker === 0x08) result = false;
        else if (marker === 0x09) result = true;
        else result = null;
        break;
      }
      case 0x10: {
        // int: длина = 2^nibble байт, big-endian, знаковое для 8-байтных
        const nibble = marker & 0x0f;
        const len = 1 << nibble;
        if (len === 8) {
          // 64-бит: используем BigInt, чтобы не терять точность, но
          // возвращаем Number (нам хватает — не работаем с id > 2^53)
          let v = 0n;
          for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[offset + 1 + i]);
          if (v >= 1n << 63n) v -= 1n << 64n;
          result = Number(v);
        } else {
          result = readUIntBE(bytes, offset + 1, len);
        }
        break;
      }
      case 0x20: {
        // real — не нужен для нашей задачи, но разбираем для полноты
        const nibble = marker & 0x0f;
        const len = 1 << nibble;
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, len);
        result = len === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false);
        break;
      }
      case 0x30: {
        // date — не нужен, пропускаем как null
        result = null;
        break;
      }
      case 0x40: {
        const { count, dataStart } = readCountAndDataStart(offset);
        result = bytes.slice(dataStart, dataStart + count);
        break;
      }
      case 0x50: {
        const { count, dataStart } = readCountAndDataStart(offset);
        result = new TextDecoder('ascii').decode(bytes.subarray(dataStart, dataStart + count));
        break;
      }
      case 0x60: {
        const { count, dataStart } = readCountAndDataStart(offset);
        // UTF-16BE — count здесь в code units (по 2 байта каждый)
        const byteLen = count * 2;
        const slice = bytes.slice(dataStart, dataStart + byteLen);
        // TextDecoder не поддерживает utf-16be напрямую — свапаем байты в LE
        const swapped = new Uint8Array(byteLen);
        for (let i = 0; i < byteLen; i += 2) {
          swapped[i] = slice[i + 1];
          swapped[i + 1] = slice[i];
        }
        result = new TextDecoder('utf-16le').decode(swapped);
        break;
      }
      case 0xa0: {
        const { count, dataStart } = readCountAndDataStart(offset);
        const arr: unknown[] = [];
        for (let i = 0; i < count; i++) {
          const ref = readObjectRef(dataStart + i * objectRefSize);
          arr.push(readObjectAt(ref));
        }
        result = arr;
        break;
      }
      case 0xd0: {
        const { count, dataStart } = readCountAndDataStart(offset);
        const keysStart = dataStart;
        const valuesStart = dataStart + count * objectRefSize;
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < count; i++) {
          const keyRef = readObjectRef(keysStart + i * objectRefSize);
          const valRef = readObjectRef(valuesStart + i * objectRefSize);
          const key = readObjectAt(keyRef);
          obj[String(key)] = readObjectAt(valRef);
        }
        result = obj;
        break;
      }
      default:
        result = null;
    }

    cache.set(index, result);
    return result;
  }

  return readObjectAt(topObject);
}
