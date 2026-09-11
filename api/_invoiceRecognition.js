// Логика распознавания счёта/КП, общая для двух путей: (1) автоматически, на
// входящих письмах Ресерча (purchase-email-webhook.js, только offer_id);
// (2) вручную, по клику после загрузки файла в форму предложения
// (supplier-web-search.js, action:'recognize-invoice') — владелец,
// 2026-09-09: "у нас есть поставщик с КП, найденный вручную... загружаем
// КП, система распознаёт КП и записывает цену в базу" (для поставщиков,
// найденных вне переписки в системе — PDF/Excel/скриншот на руках у
// закупщицы, а не через email). Ранний вариант этого второго пути (кнопка
// в предпросмотре ВХОДЯЩЕГО письма) владелец убирал 2026-09-03 ("раз
// система сама распознает данные") — нынешний путь не то же самое:
// не альтернатива автоматике на письмах, а способ ввести КП, которого в
// переписке никогда не было. Отдельный файл с "_" в начале — общий хелпер,
// не считается в лимит 12 serverless-функций Vercel Hobby.
//
// Владелец, 2026-09-03: "делай на Haiku 4.5" (после разбора цены — доли
// цента за документ, см. журнал) + "система [должна] понимать, что перед
// ней счёт, а не каталог на 40 страниц" — отсюда два уровня защиты от
// лишних вызовов модели: (1) estimatePdfPageCount отсекает многостраничные
// файлы ДО обращения к модели вообще (каталог позиций не долетает до
// Haiku, деньги не тратятся); (2) сама модель дополнительно решает
// isInvoice — короткий документ без счёта (например, обычное письмо-
// вложение не по теме) не считается счётом, ничего не подставляется.
import { proxyApiKeyProblem } from './_proxyapi.js';
import { extractDocxText } from './_docxText.js';
import { invalidInnReason } from './_checko.js';

const MODEL = 'claude-haiku-4-5-20251001';
export const INVOICE_MAX_PAGES = 3;

const SYSTEM_PROMPT = `Ты помогаешь понять, является ли присланный документ счётом или
коммерческим предложением (КП) от поставщика стройматериалов заказчику, и
если да — извлечь из него данные.

Верни ОТВЕТ ЦЕЛИКОМ в виде JSON, без markdown-разметки, без \`\`\`, без
пояснений до или после, строго формат:
{"isInvoice": true или false, "price": число или null, "currency": "USD" или "EUR" или "BYN" или "RUB" или null,
 "supplierInn": "строка цифр" или null,
 "items": [{"name": "строка", "quantity": число или null, "unit": "строка", "price": число или null}]}

isInvoice=false — если это каталог товаров без единой итоговой суммы к
оплате, прайс-лист на много позиций без конкретного предложения клиенту,
или документ вообще не про закупку. isInvoice=true — только когда есть
чёткая итоговая сумма к оплате (счёт, инвойс, коммерческое предложение на
конкретную поставку). price — эта итоговая сумма (с НДС, если он в неё
включён), одно число, не диапазон. Если валюта не указана явно в
документе — верни null, не угадывай по контексту.

supplierInn — ИНН ПОСТАВЩИКА, то есть того, кто выставил счёт и кому уйдут
деньги (в шапке счёта он же «Поставщик», «Исполнитель», «Продавец»,
«Получатель платежа», рядом с расчётным счётом и БИК банка). В счёте почти
всегда ДВА ИНН — второй принадлежит покупателю/плательщику (мы сами), его
возвращать НЕЛЬЗЯ. Только цифры, без пробелов и префикса «ИНН». Не путать
с КПП (9 цифр), БИК (9 цифр), ОГРН (13 или 15 цифр) и номером расчётного
счёта (20 цифр): у ИНН ровно 10 цифр у организации или 12 у ИП. Если ИНН
поставщика в документе не указан или непонятно, чей из двух — верни null,
угадывать не нужно. items — позиции
документа, если их можно выделить построчно; если документ не разбит на
позиции (просто "услуга — сумма") — верни пустой массив, это поле не
обязательно. Никогда не выдумывай числа — если сумму не удаётся уверенно
прочитать, верни isInvoice=false.`;

// Грубая, но бесплатная (без внешних библиотек и без обращения к модели)
// оценка числа страниц PDF по сырым байтам — ищем "/Type /Pages ... /Count N"
// (стандартный узел дерева страниц), при неудаче считаем количество
// объектов "/Type /Page" как более грубый фолбэк. Возвращает null, если
// определить не удалось — в этом случае вызывающий код НЕ считает файл
// кандидатом на автораспознавание (лучше пропустить настоящий счёт, чем
// случайно прогнать через модель нечитаемый файл неизвестного размера).
export function estimatePdfPageCount(bytes) {
  try {
    const text = Buffer.isBuffer(bytes) ? bytes.toString('latin1') : String(bytes ?? '');
    const pagesNodeMatches = [...text.matchAll(/\/Type\s*\/Pages[^>]{0,300}?\/Count\s+(\d+)/g)];
    if (pagesNodeMatches.length > 0) {
      return Math.max(...pagesNodeMatches.map((m) => Number(m[1])));
    }
    const pageObjectMatches = text.match(/\/Type\s*\/Page(?!s)/g);
    return pageObjectMatches ? pageObjectMatches.length : null;
  } catch {
    return null;
  }
}

function blockTypeForFileName(fileName) {
  const ext = String(fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'document';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  return null;
}

// Владелец, 2026-09-09: реальный счёт (ЗАО "Волок", с разбивкой на позиции)
// пришёл файлом .docx — recognizeInvoice его не видела вовсе, ни ошибки, ни
// попытки. У Anthropic API нет content-блока под .docx (document — только
// PDF), поэтому вместо пересылки файла модели передаём уже извлечённый
// текст (см. _docxText.js) обычным text-блоком — для счёта-таблицы этого
// достаточно, реальной картинки/вёрстки документа знать не нужно.
async function buildDocxContent(fileUrl, fileName) {
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Не удалось скачать .docx для распознавания (${fileResp.status})`);
  const buffer = Buffer.from(await fileResp.arrayBuffer());
  const text = await extractDocxText(buffer);
  if (!text.trim()) throw new Error('Не удалось извлечь текст из .docx — файл повреждён или пуст');
  return [
    {
      type: 'text',
      text: `Текст документа «${fileName}» (столбцы таблиц разделены табуляцией, строки — переносом):\n\n${text}`,
    },
    { type: 'text', text: 'Определи, счёт/КП ли это, и если да — извлеки данные строго по формату из системной инструкции.' },
  ];
}

// fileUrl — публичная ссылка на уже загруженный файл (Supabase Storage). Для
// PDF/картинки модель читает его напрямую по URL; для .docx — сами скачиваем
// и извлекаем текст (см. buildDocxContent).
export async function recognizeInvoice(fileUrl, fileName) {
  const keyProblem = proxyApiKeyProblem();
  if (keyProblem) throw new Error(keyProblem);

  const ext = String(fileName || '').split('.').pop()?.toLowerCase();
  let content;
  if (ext === 'docx') {
    content = await buildDocxContent(fileUrl, fileName);
  } else {
    const blockType = blockTypeForFileName(fileName);
    if (!blockType) throw new Error('Неподдерживаемый тип файла для распознавания — нужен PDF, картинка (png/jpg/webp/gif) или .docx');
    content = [
      { type: blockType, source: { type: 'url', url: fileUrl } },
      { type: 'text', text: 'Определи, счёт/КП ли это, и если да — извлеки данные строго по формату из системной инструкции.' },
    ];
  }

  const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.PROXYAPI_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 402) {
      throw new Error('Недостаточно средств на балансе ProxyAPI — пополните счёт в личном кабинете (тот же баланс используют и остальные AI-функции проекта).');
    }
    throw new Error(`Ошибка распознавания (${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Модель не вернула JSON в ожидаемом формате');
  }
  const parsed = JSON.parse(stripped.slice(start, end + 1));

  return {
    isInvoice: parsed.isInvoice === true,
    price: typeof parsed.price === 'number' ? parsed.price : null,
    currency: typeof parsed.currency === 'string' ? parsed.currency : null,
    // Модель иногда возвращает ИНН с пробелами/префиксом, а иногда путает
    // его с КПП или БИК — чистим и проверяем контрольный разряд прямо
    // здесь. Невалидное значение отбрасываем в null, а не тащим дальше:
    // проверка благонадёжности по чужому/битому ИНН хуже, чем её
    // отсутствие (закупщица увидит зелёный светофор не того юрлица).
    supplierInn: (() => {
      const raw = String(parsed.supplierInn ?? '').replace(/\D/g, '');
      if (!raw) return null;
      return invalidInnReason(raw) ? null : raw;
    })(),
    items: Array.isArray(parsed.items)
      ? parsed.items
          .filter((i) => i && typeof i.name === 'string' && i.name.trim())
          .map((i) => ({
            name: i.name.trim(),
            quantity: typeof i.quantity === 'number' ? i.quantity : null,
            unit: typeof i.unit === 'string' ? i.unit.trim() : '',
            price: typeof i.price === 'number' ? i.price : null,
          }))
      : [],
  };
}
