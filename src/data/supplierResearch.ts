import type { Currency } from './transactions';
import type { DocumentFile } from './contractorDocuments';
import type { PurchaseItem } from './purchases';
import { RESEARCH_CURRENCIES, RESEARCH_CONTACT_METHODS, type ResearchContactMethod } from './contractorResearch';
import type { SupplierOfferEmail } from './supplierOfferEmails';

// Валюты/способы связи — те же самые списки, что и у "Подрядчики → Ресерч"
// (data/contractorResearch.ts), общие для любого сравнения предложений в
// проекте, поэтому переиспользуются как есть, без дублирования.
export { RESEARCH_CURRENCIES, RESEARCH_CONTACT_METHODS };
export type { ResearchContactMethod };

// Владелец, 2026-09-03: "будут поставщики из Беларуси и России, для каждой
// категории нужно получать цены и в Беларуси, и в России" — открытый список
// (тот же принцип, что и у leadRequirements/leadClientTypes в data/leads.ts —
// AddableSelect + useMemo, объединяющий пресет с фактически встречающимися
// значениями), не жёсткий enum: если появится третья страна, её можно будет
// добавить прямо из формы, без правки кода.
// Владелец, 2026-09-09: "делай по умолчанию все рассылки из России, сейчас
// по умолчанию Беларусь" — Россия первой в списке, чтобы все места, где
// значение по умолчанию берётся как SUPPLIER_COUNTRIES[0] (страна поиска в
// вебе, фильтр переписки, фолбэк для предложений без явно указанной страны
// и т.п.), по умолчанию показывали/считали Россию, а не Беларусь.
export const SUPPLIER_COUNTRIES = ['Россия', 'Беларусь'] as const;

// Регион ВЕБ-ПОИСКА поставщиков — отдельно от страны самого поставщика
// (country выше: он про то, где поставщик находится, и по нему фильтруются
// списки/переписка). Владелец, 2026-09-11: "по грильято подтянулось много
// поставщиков из других городов... при поиске ставь регион не Россия, а
// именно Москва" — объекты компании в Москве и Подмосковье, а поиск "по
// России" исправно приносил региональные сайты федеральных сетей
// (spb./perm./nsk.-поддомены) и местные компании Новосибирска/Казани, с
// которыми закупку не сделать. Поэтому у поиска свой список регионов, где
// Москва — отдельное значение (и значение по умолчанию для России), а не
// "уточнение" в свободном поле пожеланий.
export const SUPPLIER_SEARCH_REGIONS = ['Москва', 'Россия', 'Беларусь'] as const;

// Какой регион поиска подставлять, когда поиск запускается из карточки
// категории с выбранной страной: для России — Москва (см. выше), для
// остальных стран — сама страна.
export function defaultSearchRegion(country: string): string {
  return country === 'Россия' ? 'Москва' : country;
}

// Владелец, 2026-09-03: "Страницу Поставщики разбиваем на 3 логических
// блока: Материалы и оборудование / Работы / Сервисы" — "Работы" реализована
// отдельным независимым механизмом (ContractorsResearch, свои таблицы
// contractor_research_*), сюда не относится. Эти два — жёсткий enum (в
// отличие от SUPPLIER_COUNTRIES): структурное деление UI страницы, не
// растущий пользовательский список, добавлять третье значение — это правка
// кода (новый блок на странице), а не просто новая строка в списке.
export const SUPPLIER_REQUEST_GROUPS = ['materials', 'services'] as const;
export type SupplierRequestGroup = (typeof SUPPLIER_REQUEST_GROUPS)[number];

export const SUPPLIER_REQUEST_GROUP_LABELS: Record<SupplierRequestGroup, string> = {
  materials: 'Материалы и оборудование',
  services: 'Сервисы',
};

// Владелец, 2026-09-09: "Грильято, где есть комплектующие, нужно оценивать
// полностью. Мы не будем заказывать несущие в одном месте, а подвесы в
// другом... но, если бы позиции были штукатурка и плитка, то могли бы
// заказать и в разных местах" — не все категории одинаковы: у одних все
// компоненты уходят ОДНОМУ поставщику единой поставкой (сравнивать нужно
// сумму всего КП целиком, не выхватывать по позиции лучшую цену у разных
// поставщиков — так реально закупку не оформить), у других каждая позиция
// закупается независимо (сравнение "лучшая цена" по каждому материалу само
// по себе корректно). Различить это по данным нельзя — оба типа документов
// выглядят одинаково (счёт с разбивкой на несколько строк), поэтому это
// явный выбор при создании категории, не автоматика.
export const SUPPLIER_COMPARISON_MODES = ['material', 'lot'] as const;
export type SupplierComparisonMode = (typeof SUPPLIER_COMPARISON_MODES)[number];

export const SUPPLIER_COMPARISON_MODE_LABELS: Record<SupplierComparisonMode, string> = {
  material: 'По материалам',
  lot: 'Поставка целиком',
};

export const SUPPLIER_COMPARISON_MODE_HINTS: Record<SupplierComparisonMode, string> = {
  material: 'Каждую позицию можно заказать у разного поставщика — сравниваем лучшую цену по каждому материалу отдельно.',
  lot: 'Все позиции идут одной поставкой от одного поставщика (как компоненты Грильято) — сравниваем сумму всего КП целиком, не по отдельным строкам.',
};

// Владелец, 2026-09-11: "номера в телеграме, вотапе и максе — нам
// понадобится отдельное поле, там сейчас один номер телефона, а тут надо и
// номер, и название мессенджера фиксировать" — в отличие от contact/
// contactMethod (ровно ОДИН способ связи, телефон ИЛИ телеграм, см. ниже),
// у поставщика может быть сразу несколько мессенджеров с разными номерами.
// Жёсткий enum (не AddableSelect) — ровно те три мессенджера, что owner
// назвал явно, не растущий пользовательский список.
export const SUPPLIER_MESSENGER_TYPES = ['Telegram', 'WhatsApp', 'Max'] as const;
export type SupplierMessengerType = (typeof SUPPLIER_MESSENGER_TYPES)[number];

export interface SupplierMessengerContact {
  type: SupplierMessengerType;
  number: string;
}

// Владелец, 2026-09-03: "вместо 'Страна Беларусь'/'Страна Россия' ставь
// просто эмодзи с флагом" — бейджи страны везде в UI показывают флаг
// вместо текста. Для страны, добавленной вручную сверх пресета (нет в
// этом словаре) — падаем обратно на текст, эмодзи неоткуда взять.
const COUNTRY_FLAGS: Record<string, string> = {
  Беларусь: '🇧🇾',
  Россия: '🇷🇺',
};

export function countryFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? country;
}

// Владелец, 2026-09-03: "для всех поставщиков с сайтом в зоне .by
// автоматически проставляй Беларусь, для .ru — Россию" — грубая эвристика
// по домену сайта (не гарантия — бывают исключения), используется как
// подсказка при вводе адреса сайта (Suppliers.tsx), не перезаписывает уже
// выбранную вручную страну. Пустая строка — не удалось определить (домен
// не .by/.ru, или сайт не указан).
export function guessCountryFromWebsite(websiteUrl: string): string {
  const trimmed = websiteUrl.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let hostname: string;
  try {
    hostname = new URL(withProtocol).hostname.toLowerCase();
  } catch {
    hostname = trimmed.toLowerCase();
  }
  if (hostname.endsWith('.by')) return 'Беларусь';
  if (hostname.endsWith('.ru')) return 'Россия';
  return '';
}

// Как показать и куда вести номер в мессенджере. Владелец, 2026-09-11:
// "ID в максе непонятный, хз как ему написать — сделай или кликабельной
// ссылкой на макс, или как-то понятно". Обогащение забирает с сайта то, что
// там реально написано: у Telegram это обычно @ник, у WhatsApp — телефон, а
// у Max — длинный непрозрачный идентификатор из ссылки max.ru/u/<id>,
// который человеку сам по себе ни о чём не говорит. Поэтому показываем не
// сырое значение, а понятную подпись + ссылку, если по ней реально можно
// открыть диалог.
export function messengerLink(m: SupplierMessengerContact): { href: string | null; label: string } {
  const value = m.number.trim();
  if (!value) return { href: null, label: '—' };

  // Уже готовая ссылка (модель иногда приносит её целиком) — ведём по ней,
  // подпись достаём из последнего сегмента пути.
  if (/^https?:\/\//i.test(value)) {
    const tail = value.replace(/\/+$/, '').split('/').pop() ?? '';
    if (m.type === 'Max') return { href: value, label: 'открыть диалог' };
    return { href: value, label: tail.startsWith('+') || /^\d/.test(tail) ? tail : `@${tail.replace(/^@/, '')}` };
  }

  const digits = value.replace(/\D/g, '');
  const isPhone = digits.length >= 10 && digits.length <= 15 && /^[+\d\s()-]+$/.test(value);

  if (m.type === 'WhatsApp') {
    return isPhone ? { href: `https://wa.me/${digits}`, label: value } : { href: null, label: value };
  }
  if (m.type === 'Telegram') {
    // По телефону диалог в Telegram ссылкой не открыть (t.me/+<номер> — это
    // инвайт в чат, не контакт), поэтому линкуем только ники.
    if (isPhone) return { href: null, label: value };
    const handle = value.replace(/^@/, '');
    return { href: `https://t.me/${handle}`, label: `@${handle}` };
  }
  // Max: телефон показываем как есть, длинный id — только ссылкой с
  // человекочитаемой подписью (сам id бесполезен на экране).
  if (isPhone) return { href: null, label: value };
  return { href: `https://max.ru/u/${value}`, label: 'открыть диалог' };
}

// Вкладка "Поставщики" (пункт меню "Стройка") — та же механика, что и у
// "Подрядчики → Ресерч": 1 запрос — 1 карточка, внутри — сравнение
// предложений разных поставщиков, дешевле всех подсвечено (см. rankOffers
// в Suppliers.tsx, скопирован из ContractorsResearch.tsx один в один).
// В отличие от подрядчика (услуга) здесь сравнивают КОНКРЕТНЫЙ товар —
// поэтому у предложения дополнительно есть ссылка на сайт, карточка модели
// в каталоге (название+фото), статус переговоров (свободный текст,
// владелец вводит вручную) и место для файлов (счета, спецификации и т.п.).
//
// Владелец, 2026-09-11: поле items ("Что просим оценить у поставщиков") —
// удалено, оно никак не участвовало ни в логике смет, ни где-либо ещё в
// приложении (кроме плейсхолдера {материалы} в письмах, который теперь
// просто подставляет title запроса). Уже накопленные позиции перенесены
// вручную в ведомость материалов "Зелёный" (см. docs/session-journal.md) —
// колонка items в supplier_research_requests в БД не удалялась, просто
// больше не используется приложением.
export interface SupplierRequest {
  id: string;
  title: string;
  // Владелец, 2026-09-03: страница "Поставщики" разбита на 3 блока —
  // Материалы и оборудование / Работы / Сервисы. group различает первые два
  // (третий — ContractorsResearch, отдельный механизм без этого поля).
  group: SupplierRequestGroup;
  estimateId: string | null;
  sectionId: string | null;
  sectionTitle: string;
  // Владелец, 2026-09-09: "чтобы Альмира могла выбрать, что это закупки ООО
  // «Матрешка», и нужная карточка была прикреплена автоматически" — от
  // какого юрлица (data/legalEntities.ts) идёт закупка по этой категории.
  // null — юрлицо не выбрано явно, тогда используется юрлицо по умолчанию
  // (см. resolveRequestLegalEntity в lib/legalEntityAttachment.ts) — старые
  // категории, заведённые до этого поля, продолжают работать как раньше.
  legalEntityId: string | null;
  // Владелец, 2026-09-09: тип сравнения на вкладке "Сравнение цен" — 'material'
  // (по умолчанию, старое поведение) или 'lot' (см. комментарий у
  // SUPPLIER_COMPARISON_MODES выше). Заводится один раз на категорию, не
  // меняется автоматически.
  comparisonMode: SupplierComparisonMode;
  createdAt: string;
}

export interface SupplierRequestRow {
  id: string;
  title: string;
  category_group: string;
  estimate_id: string | null;
  section_id: string | null;
  section_title: string | null;
  legal_entity_id: string | null;
  comparison_mode: string | null;
  created_at: string;
}

export interface SupplierOffer {
  id: string;
  requestId: string;
  name: string;
  contact: string;
  contactMethod: ResearchContactMethod;
  // Отдельно от contact — тот же принцип, что у Contractor.email:
  // contact/contactMethod могут быть телефоном/телеграмом, а письмо всегда
  // уходит именно на email, если он указан (см. api/supplier-offer-send-email.js).
  email: string;
  // Имя менеджера поставщика (не название компании — это name) — владелец,
  // 2026-09-03: "подтягивать автоматически email из письма и имя менеджера
  // из письма". Заполняется автоматически на первом входящем письме (см.
  // api/purchase-email-webhook.js, парсинг заголовка From — "Имя <email>"),
  // но остаётся обычным редактируемым полем — правится вручную, если
  // распознано неверно или нужно сменить контактное лицо.
  managerName: string;
  // Страна поставщика (см. SUPPLIER_COUNTRIES выше) — владелец сравнивает
  // цены отдельно по Беларуси и по России в рамках одной категории (запроса).
  country: string;
  websiteUrl: string;
  // Ссылка на конкретную позицию/товар/раздел каталога на сайте (не просто
  // главная страница сайта, как websiteUrl) — владелец, 2026-09-10:
  // "давай добавлять... ссылку на саму позицию искомую, чтобы вручную на
  // сайте не искать". Заполняется автоматически при добавлении из
  // веб-поиска (см. SupplierWebSearchModal/addWebSearchResults в
  // Suppliers.tsx), но остаётся обычным редактируемым полем.
  listingUrl: string;
  // Номера в мессенджерах (см. SupplierMessengerContact выше) — заполняются
  // либо вручную, либо автообогащением (см. lib/supplierEnrichmentApi.ts).
  // Может быть несколько записей одного типа (например, два номера
  // WhatsApp) — не выбрасываем дубли автоматически, обогащение само не
  // добавляет уже присутствующий тип+номер повторно.
  messengers: SupplierMessengerContact[];
  catalogModelName: string;
  catalogModelPhoto: DocumentFile | null;
  // Итоговая цена/валюта — больше не редактируется вручную (владелец,
  // 2026-09-04: "срок доставки будет отличаться для каждой поставки" — то
  // же верно и для цены, она теперь живёт на уровне конкретной заявки,
  // SupplierOrder.price). Здесь остаётся только как последний известный
  // итог по счёту, который распознала система (applyExtractionToOffer),
  // используется как контекст валюты для offer.items в сравнении "лучшая
  // цена по позиции" (см. bestPricesByMaterialId в Suppliers.tsx).
  price: number;
  currency: Currency;
  // Позиции КП (название/кол-во/ед./цена) — переиспользован PurchaseItem
  // (тот же смысл, что у SupplierRequest.items: снимок на момент добавления).
  // Владелец, 2026-09-04: "вручную это указывать тупо... когда получим КП от
  // поставщика, вполне можем записать в базу" — заполняются ИСКЛЮЧИТЕЛЬНО
  // автораспознаванием счёта из переписки (applyExtractionToOffer в
  // SupplierCorrespondenceTab.tsx), ручного добавления в форме больше нет.
  items: PurchaseItem[];
  files: DocumentFile[];
  // Короткий технический код для plus-адреса переписки (см.
  // supplierOfferEmailAddress ниже) — 5 hex-символов, генерируется в БД
  // (default на колонке short_code, миграция 2026-09-03), уникален. Сам id —
  // полноценный UUID, слишком длинный для видимого email-адреса.
  shortCode: string;
  // Владелец, 2026-09-04: "когда поставщик только добавлен из поиска, ставим
  // ему статус 'Требуется верификация'... закупщик заполняет поля, жмёт
  // сохранить — поставщик становится доступен для переписки". false — только
  // у предложений, созданных веб-поиском (addWebSearchResults в
  // Suppliers.tsx); любое сохранение через форму (создание вручную или
  // правка через "Редактировать") выставляет true — считается, что человек
  // проверил данные. Пока false — предложение скрыто из вкладки "Письма"
  // (см. SupplierCorrespondenceTab.tsx).
  verified: boolean;
  // ИНН юрлица, ВЫСТАВИВШЕГО СЧЁТ. Владелец, 2026-09-11: "нет смысла
  // проверять ИНН с сайта, надо смотреть, на какой ИНН выставлен счет...
  // когда поставщик прислал счет и нам стали известны реквизиты, запускать
  // процесс верификации поставщика". Заполняется автоматически из
  // распознанного счёта (EmailExtraction.supplierInn) в момент, когда
  // закупщица подтверждает распознавание, либо руками в форме. null —
  // счёта ещё не было (проверять нечего, это нормальное состояние, а не
  // пробел в данных).
  //
  // Не путать с verified выше: verified — ручная отметка "данные
  // поставщика посмотрел человек, можно писать письма"; inn — вход для
  // АВТОМАТИЧЕСКОЙ проверки благонадёжности по госреестрам
  // (data/supplierReliability.ts). Это разные вещи, одно не заменяет другое.
  inn: string | null;
  createdAt: string;
}

export interface SupplierOfferRow {
  id: string;
  request_id: string;
  name: string;
  contact: string;
  contact_method: string;
  email: string | null;
  manager_name: string | null;
  country: string | null;
  website_url: string;
  listing_url: string | null;
  messengers: SupplierMessengerContact[] | null;
  catalog_model_name: string;
  catalog_model_photo: DocumentFile | null;
  price: number;
  currency: string;
  items: PurchaseItem[] | null;
  files: DocumentFile[] | null;
  short_code: string;
  verified: boolean;
  inn: string | null;
  created_at: string;
}

// Email-адрес для переписки по конкретному предложению — тот же принцип
// plus-адресации, что и у purchaseEmailAddress (data/purchases.ts): ответ
// поставщика матчится на сервере по короткому коду в локальной части, без
// отдельного ящика на каждое предложение. Владелец, 2026-09-03: "давай
// заменим адрес на zakupki" — раньше был свой префикс research+ (нужен был,
// чтобы сервер по одному только адресу понимал, в какую таблицу класть
// письмо), теперь webhook сам определяет таблицу по тому, где реально
// нашёлся short_code (см. extractShortCode в api/purchase-email-webhook.js),
// поэтому оба вида переписки используют один и тот же префикс zakupki+.
// Старый research+-адрес всё ещё принимается на сервере (совместимость с
// уже отправленным вживую письмом), просто новые больше не строятся так.
export function supplierOfferEmailAddress(shortCode: string): string {
  return `zakupki+${shortCode}@redevelopment.pro`;
}

// Владелец, 2026-09-04: "Статус коммуникации — вполне можем определять
// автоматически. Если не было отправок писем, то одно. Если направили, но
// не получили ответ — другое. Если получили счет и записали цены в базу —
// третье" — больше не свободный ручной ввод, а всегда пересчитывается из
// реальной переписки/данных, три взаимоисключающих состояния.
//
// Владелец, 2026-09-09: "если я загрузил КП, значит статус не 'Не писали', а
// 'Получили КП'" — реальный кейс, поймавший пробел: у поставщика,
// добавленного вручную (без переписки вовсе), счёт может распознаться с
// итоговой ценой, но БЕЗ разбивки на позиции (документ — просто "итого",
// без построчной сметы) — offer.items остаётся пустым, а offer.price уже
// заполнен. Раньше это давало "confirmed" только по items, поэтому такой
// случай ошибочно показывал "Не писали". Теперь любой из двух признаков
// (есть распознанные позиции ИЛИ есть просто зафиксированная итоговая цена)
// считается "получили и записали".
export type OfferCommunicationStatus = 'none' | 'sent' | 'confirmed';

export function offerCommunicationStatus(offer: SupplierOffer, emails: SupplierOfferEmail[]): OfferCommunicationStatus {
  if (offer.items.length > 0 || offer.price > 0) return 'confirmed';
  const hasSent = emails.some((e) => e.offerId === offer.id && e.direction === 'out');
  return hasSent ? 'sent' : 'none';
}

export const OFFER_COMMUNICATION_STATUS_LABEL: Record<OfferCommunicationStatus, string> = {
  none: 'Не писали',
  sent: 'Отправили, ждём ответ',
  confirmed: 'Получили КП, цены в базе',
};
