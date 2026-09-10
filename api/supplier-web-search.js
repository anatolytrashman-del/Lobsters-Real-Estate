// Vercel serverless function: веб-поиск реальных поставщиков под список
// материалов запроса на вкладке "Ресерч" (Suppliers.tsx) — action по
// умолчанию/'web-search'. Второй action — 'recognize-invoice'.
//
// 2026-09-03: раньше этот же файл ещё обрабатывал action:'recognize-invoice'
// — ручную кнопку "Распознать данные автоматически" в предпросмотре вложения
// (SupplierCorrespondenceTab.tsx). Владелец убрал кнопку ("раз система сама
// распознает данные") — автоматическое распознавание на входящих
// (purchase-email-webhook.js, общий хелпер api/_invoiceRecognition.js)
// осталось единственным путём, ручную ветку здесь удалили вместе с кнопкой.
//
// 2026-09-09: владелец вернул ручной путь — но не для типизированного ввода
// цены (обсуждали и отвергли, "вручную не будем ничего указывать"), а для
// поставщика, найденного вне переписки в системе (PDF/Excel/скриншот email
// на руках у закупщицы): "добавляем его как нового поставщика и загружаем
// КП, система распознаёт КП и записывает цену в базу". action:
// 'recognize-invoice' восстановлен здесь же (тот же файл, не новый — Vercel
// Hobby на пределе 12 функций) — вызывается из формы предложения сразу
// после загрузки файла в "Файлы (счета, спецификации...)" (Suppliers.tsx),
// не из предпросмотра письма (та кнопка остаётся убранной, как и была).
//
// 2026-08-31, дважды за день. Первая версия (claude-sonnet-5, Anthropic-путь
// ProxyAPI) обошлась в 358 ₽ за 4 запроса (~90 ₽/запрос) — владелец увидел
// это в отчёте расходов ProxyAPI и попросил модель подешевле. Первая
// попытка чинить — перевести на gpt-4o-mini-search-preview
// (OpenAI-совместимый путь) — не сработала: ProxyAPI отдаёт на этот
// эндпоинт `400 Model not supported`, хотя модель числится в каталоге
// `/openai/v1/models` (то же самое для gpt-4o-search-preview и
// gpt-5-search-api — проверено вживую curl'ом, ни одна search-модель
// OpenAI через этот шлюз не работает, каталог не значит поддержку).
//
// Настоящая причина дороговизны Sonnet 5 — не сама модель, а то, что она
// без явного указания заворачивает вызов web_search в "программный вызов
// инструмента" (пишет и исполняет код, который сам зовёт web_search) —
// это видно в сыром ответе API как отдельный блок `code_execution`
// server_tool_use РЯДОМ с `web_search`, и именно эта обвязка раздувала
// input_tokens до 41-45 тысяч на тривиальный запрос. Найдено случайно:
// claude-haiku-4-5 без явного `allowed_callers` на web_search вообще
// отказывается работать с ошибкой "does not support programmatic tool
// calling... explicitly set allowed_callers=['direct']" — то есть сама
// Anthropic считает эту обвязку побочным поведением, которое не все
// модели готовы включать молча. Добавление `allowed_callers: ['direct']`
// на инструмент запрещает эту обвязку и модели, которые её поддерживают
// (Sonnet 5) — тоже. Живой прогон claude-haiku-4-5 + allowed_callers:
// input_tokens 13 943 (было 41-45 тыс.), 8 секунд (было 20-115 с.),
// нашёл реальные телефоны/email 5 поставщиков. И модель дешевле яруса
// Haiku, и токенов на порядок меньше — комбинированная экономия в разы
// больше, чем просто смена модели.
import { proxyApiKeyProblem } from './_proxyapi.js';
import { requireStaffAuth } from './_auth.js';
import { recognizeInvoice } from './_invoiceRecognition.js';

const MODEL = 'claude-haiku-4-5-20251001';

// Владелец, 2026-09-03: "пусть ищет более основательно, мало ссылок было,
// давай минимум 20 валидных источников делать, если найдется" — было 3
// (хватало на 3-6 компаний), для 20 нужно заметно больше реальных поисковых
// запросов (разными формулировками/категориями/площадками), не один заход.
//
// 2026-09-10: владелец попросил поднять планку до 40 источников и явно
// искать и через Google, и через Яндекс. У инструмента web_search нет
// параметра "выбрать поисковик" (только max_uses/allowed_domains/
// blocked_domains/user_location — проверено по спецификации инструмента),
// поэтому буквально заставить его дёрнуть конкретно Google или конкретно
// Яндекс нельзя — сам бэкенд поиска решает это сам. Вместо этого системный
// промт явно просит часть запросов формулировать в стиле обычного веб-
// поиска (сайты компаний, международные каталоги), а часть — целенаправленно
// под рунет-агрегаторы, которые лучше всего проиндексированы именно в
// Яндексе (Яндекс.Маркет, 2ГИС/Яндекс.Карты — организации, TIU.ru, Deal.by,
// Prom.by, Avito) — так охват реально шире, даже если техническо это всё
// ещё один и тот же инструмент. Под 40 источников нужно почти вдвое больше
// поисковых запросов, чем под 20.
// Всё ещё ограничено (не unlimited) — по той же причине, что и раньше:
// защита от утягивания функции за maxDuration (300с, см. vercel.json) без
// единого ответа клиенту.
const MAX_SEARCHES = 20;

// Владелец, 2026-09-10: "давай добавлять... ссылку на саму позицию искомую,
// чтобы вручную на сайте не искать" — раньше от модели брался только адрес
// САЙТА (обычно главная страница), дальше владельцу приходилось искать
// нужный товар на сайте руками. Теперь модель дополнительно возвращает
// прямую ссылку на страницу конкретного товара/позиции/раздела каталога,
// если реально нашла её в поиске (не выдумывает, если такой страницы не
// было в результатах поиска — тогда просто пустая строка, см. buildSystemPrompt).
const MAX_RESULTS = 40;

// 2026-09-07: раньше страна поиска была жёстко зашита текстом прямо в
// системный промт ("в Беларуси, преимущественно Минск") И финальной строкой
// buildUserQuery ("Найди поставщиков... в Минске/Беларуси") — независимо от
// того, что реально выбрано на странице (вкладка страны "Беларусь"/"Россия"
// у конкретного запроса) или написано в "Дополнительные пожелания" (например,
// город "Москва"). Из-за этого выбор "Россия" + "Москва" в пожеланиях всё
// равно уходил в поиск белорусских поставщиков — сама модель получала два
// противоречащих требования и слушалась жёстко прописанного. Теперь страна —
// параметр запроса (см. Suppliers.tsx, ToggleGroup в модалке "Найти в сети"),
// подставляется в промт вместо того, чтобы быть вкопанной константой.
const COUNTRY_SEARCH_HINTS = {
  Беларусь: 'в Беларуси (если в пожеланиях не указан конкретный город — ищи прежде всего в Минске)',
  Россия: 'в России (если в пожеланиях не указан конкретный город — ищи прежде всего в Москве и других крупных городах)',
};
const DEFAULT_COUNTRY = 'Беларусь';

function buildSystemPrompt(country) {
  const hint = COUNTRY_SEARCH_HINTS[country] || COUNTRY_SEARCH_HINTS[DEFAULT_COUNTRY];
  return `Ты помогаешь найти реальных поставщиков строительных материалов ${hint}
через веб-поиск для девелоперской компании. Если в "Дополнительные пожелания"
указан другой город, регион или страна — ищи именно там, это имеет приоритет
над регионом по умолчанию.
Ищи ОСНОВАТЕЛЬНО и ШИРОКО — используй инструмент web_search до ${MAX_SEARCHES} раз,
разными запросами, чтобы найти МАКСИМУМ реальных компаний-поставщиков —
стремись к ${MAX_RESULTS}, если реально столько существует и находится.
Обязательно комбинируй два вида запросов:
1. Обычные веб-поисковые запросы (как в Google) — конкретные позиции по
   отдельности, синонимы, категории, названия компаний, международные
   каталоги и маркетплейсы.
2. Запросы, нацеленные на источники, которые лучше всего проиндексированы
   именно Яндексом — Яндекс.Маркет, Яндекс.Карты/2ГИС (организации),
   TIU.ru, Deal.by, Prom.by, Avito и подобные региональные агрегаторы.
Не возвращай одну и ту же компанию дважды (даже если нашёл её и в
обычном, и в "яндексовом" запросе) — каждая компания в ответе только один раз.

Для каждой найденной компании собери:
- сайт (website) — адрес сайта компании;
- ссылку на позицию (link) — ПРЯМУЮ ссылку на страницу конкретного товара,
  позиции или раздела каталога с искомым материалом на сайте этой компании
  ИЛИ на странице объявления/карточки товара на маркетплейсе/агрегаторе, если
  такая ссылка реально встретилась в результатах поиска. Это НЕ то же самое,
  что website — website может быть главной страницей сайта, а link должен
  вести туда, где реально видно нужный товар, чтобы не пришлось искать его
  на сайте вручную. Если такой конкретной ссылки в поиске не нашлось — оставь
  пустую строку, не подставляй туда просто адрес сайта и не выдумывай урл;
- телефон и/или email, если реально нашёл.
Не выдумывай компании, контакты и ссылки ради количества — бери только то,
что действительно нашёл в поиске, для неизвестного поля оставляй пустую
строку. Лучше меньше, но реальных, чем ровно ${MAX_RESULTS} с придуманными.

После поиска верни ОТВЕТ ЦЕЛИКОМ в виде JSON-массива, без markdown-разметки,
без пояснений до или после, без \`\`\` — строго формат:
[{"name": "...", "website": "...", "link": "...", "phone": "...", "email": "...", "note": "..."}]

"note" — одна короткая фраза по-русски: что продают/чем подходят под запрос.
Если ничего подходящего не нашёл — верни пустой массив [].`;
}

function buildUserQuery(itemsText, sectionTitle, extra, country) {
  const parts = [];
  if (sectionTitle) parts.push(`Раздел: ${sectionTitle}.`);
  parts.push(`Материалы: ${itemsText}.`);
  if (extra) parts.push(`Дополнительные пожелания: ${extra}.`);
  const hint = COUNTRY_SEARCH_HINTS[country] || COUNTRY_SEARCH_HINTS[DEFAULT_COUNTRY];
  parts.push(`Найди поставщиков этих материалов ${hint}, если пожелания не указывают иное.`);
  return parts.join(' ');
}

// Ответ модели после tool use — несколько текстовых блоков (в них же могут
// попадать цитаты найденных страниц), финальный JSON — их конкатенация.
// Модель иногда оборачивает JSON в ```json несмотря на прямой запрет —
// снимаем обёртку перед парсингом.
function extractJsonArray(content) {
  const text = (Array.isArray(content) ? content : [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Модель не вернула список поставщиков в ожидаемом формате');
  }
  const parsed = JSON.parse(stripped.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('Модель вернула не массив');
  return parsed;
}

// Ключ для дедупликации — нормализованный домен сайта (без протокола/www/
// хвостового слэша), а если сайта нет вовсе — нормализованное название
// компании. Модель просят не повторяться сама (см. системный промт), но при
// двух проходах (Google-стиль + Яндекс-стиль запросы) один и тот же
// поставщик реально может всплыть дважды — это последний рубеж защиты.
function dedupKey(r) {
  const site = r.website.trim().toLowerCase();
  if (site) {
    return site
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
      .split(/[/?#]/)[0];
  }
  return r.name.trim().toLowerCase();
}

function dedupeResults(list) {
  const seen = new Set();
  const result = [];
  for (const r of list) {
    const key = dedupKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  return result;
}

function sanitizeResults(raw) {
  const cleaned = raw
    .filter((r) => r && typeof r.name === 'string' && r.name.trim())
    .map((r) => ({
      name: r.name.trim(),
      website: typeof r.website === 'string' ? r.website.trim() : '',
      link: typeof r.link === 'string' ? r.link.trim() : '',
      phone: typeof r.phone === 'string' ? r.phone.trim() : '',
      email: typeof r.email === 'string' ? r.email.trim() : '',
      note: typeof r.note === 'string' ? r.note.trim() : '',
    }));
  return dedupeResults(cleaned).slice(0, MAX_RESULTS);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const user = await requireStaffAuth(req, res);
  if (!user) return;

  if ((req.body ?? {}).action === 'recognize-invoice') {
    await handleRecognizeInvoice(req, res);
    return;
  }
  await handleWebSearch(req, res);
}

// fileUrl — публичная ссылка на уже загруженный в Storage файл (клиент
// грузит его сам через uploadSupplierFile ДО вызова этого action, точно
// так же, как и вложения писем в api/_attachments.js) — сама функция
// recognizeInvoice файлов не хранит, только читает по URL.
async function handleRecognizeInvoice(req, res) {
  const { fileUrl, fileName } = req.body ?? {};
  if (typeof fileUrl !== 'string' || !fileUrl.trim() || typeof fileName !== 'string' || !fileName.trim()) {
    res.status(400).json({ error: 'Не передан файл для распознавания' });
    return;
  }
  try {
    const extraction = await recognizeInvoice(fileUrl.trim(), fileName.trim());
    res.status(200).json({ extraction });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось распознать документ' });
  }
}

async function handleWebSearch(req, res) {
  const keyProblem = proxyApiKeyProblem();
  if (keyProblem) {
    res.status(500).json({ error: keyProblem });
    return;
  }

  const { itemsText, sectionTitle, extra, country } = req.body ?? {};
  if (typeof itemsText !== 'string' || !itemsText.trim()) {
    res.status(400).json({ error: 'Список материалов пуст' });
    return;
  }
  const resolvedCountry = typeof country === 'string' && COUNTRY_SEARCH_HINTS[country] ? country : DEFAULT_COUNTRY;

  try {
    const resp = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.PROXYAPI_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        // Было 2000 (3-6 компаний, 1-3 поиска), потом 6000 (до 20 компаний,
        // до 10 поисков). 2026-09-10: до 20 поисков и до 40 компаний с
        // добавленным полем "link" в каждой — нужно ещё больше места и на
        // сами tool_use-блоки поисков, и на развёрнутый финальный JSON.
        max_tokens: 10000,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, allowed_callers: ['direct'] }],
        system: buildSystemPrompt(resolvedCountry),
        messages: [
          {
            role: 'user',
            content: buildUserQuery(
              itemsText.trim(),
              typeof sectionTitle === 'string' ? sectionTitle.trim() : '',
              typeof extra === 'string' ? extra.trim() : '',
              resolvedCountry,
            ),
          },
        ],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      // 402 — недостаточно средств на балансе ProxyAPI. Проверено вживую:
      // тот же баланс общий для OpenAI- и Anthropic-путей шлюза (meeting-ai.js
      // на gpt-4o упадёт с той же ошибкой) — не проблема конкретно этого
      // эндпоинта, а нужно пополнить счёт в личном кабинете ProxyAPI.
      if (resp.status === 402) {
        throw new Error('Недостаточно средств на балансе ProxyAPI — пополните счёт в личном кабинете ProxyAPI (тот же баланс используют и остальные AI-функции проекта).');
      }
      throw new Error(`Ошибка веб-поиска (${resp.status}): ${text.slice(0, 300)}`);
    }
    const data = await resp.json();
    const results = sanitizeResults(extractJsonArray(data.content));
    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Не удалось выполнить веб-поиск поставщиков' });
  }
}
