// Проверка благонадёжности поставщика по ИНН через Checko (checko.ru).
//
// Владелец, 2026-09-11: "нет смысла проверять ИНН с сайта, надо смотреть, на
// какой ИНН выставлен счет... когда поставщик прислал счет и нам стали
// известны реквизиты, запускать процесс верификации поставщика" — отсюда
// точка входа: ИНН берётся из распознанного счёта (_invoiceRecognition.js),
// а не с сайта поставщика. Это принципиально: на сайте может быть красивая
// торговая марка, а счёт выставит другое юрлицо-прокладка — проверять надо
// именно того, кому уйдут деньги.
//
// ВАЖНО про имена: в проекте уже есть supplier_offers.verified и
// VerificationBadge — это ДРУГОЕ, ручная отметка закупщицы "поставщика
// проверили, можно писать письма". Всё, что здесь — "благонадёжность"
// (reliability), автоматическая проверка по госреестрам. Не смешивать.
//
// Файл с "_" в начале — общий хелпер, не отдельная serverless-функция.
// Это не косметика: в api/ ровно 12 функций, что РОВНО лимит Vercel Hobby,
// поэтому новый api/check-reliability.js сломал бы деплой целиком. Точка
// входа живёт action'ом в supplier-web-search.js.
//
// Только Россия. Владелец, 2026-09-11: "Делай на Россию, а потом напомнишь
// и сделаем и на Беларусь". Проверено живыми запросами: Checko API принимает
// только inn/ogrn и белорусские УНП (даже с корректным контрольным разрядом)
// не находит — "Не найдено ни одной организации с указанными реквизитами".
// Карточки РБ есть на сайте checko.ru, но через API не отдаются. Для РБ
// понадобится другой источник (ГРП МНС portal.nalog.gov.by/grp/getData —
// бесплатный и без ключа, плюс DaData party_by), и там принципиально нет
// аналога kad.arbitr.ru: судебных дел по УНП бесплатно не получить вообще.

const BASE_URL = 'https://api.checko.ru/v2';

// Сколько дел тянуть в кэш. Агрегаты (ОбщСуммИск, ЗапВсего) Checko считает
// на своей стороне и отдаёт в первом же ответе, поэтому для светофора
// выкачивать все страницы не нужно — держим первую страницу свежих дел,
// чтобы закупщице было на что посмотреть, а счёт берём из агрегата.
const LEGAL_CASES_LIMIT = 20;

export function checkoKeyProblem() {
  const key = process.env.CHECKO_API_KEY;
  if (!key) {
    return 'CHECKO_API_KEY не настроен в переменных окружения Vercel';
  }
  // Та же защита, что и у PROXYAPI_KEY (см. _proxyapi.js): ключ,
  // скопированный из личного кабинета в замаскированном виде, роняет fetch
  // невнятной ошибкой при сборке URL — ловим до запроса.
  if (/[^\x21-\x7e]/.test(key)) {
    return 'CHECKO_API_KEY на Vercel повреждён: в значении есть посторонние символы (похоже, ключ скопирован в замаскированном виде). Вставьте полный ключ заново и передеплойте.';
  }
  return null;
}

// ИНН юрлица — 10 цифр, ИП — 12. Проверяем контрольные разряды до обращения
// к API: распознавание счёта моделью может вернуть ИНН с опечаткой (или
// перепутать его с КПП/БИК/расчётным счётом), а каждый запрос в Checko
// расходует суточный лимит. Дешевле отсеять здесь.
export function invalidInnReason(inn) {
  const digits = String(inn ?? '').trim();
  if (!/^\d+$/.test(digits)) return 'ИНН должен состоять только из цифр';
  if (digits !== '' && digits.length !== 10 && digits.length !== 12) {
    return 'ИНН должен быть длиной 10 цифр (юрлицо) или 12 (ИП)';
  }
  const d = digits.split('').map(Number);
  const checksum = (weights) =>
    weights.reduce((sum, w, i) => sum + w * d[i], 0) % 11 % 10;
  if (digits.length === 10) {
    if (checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) !== d[9]) {
      return 'ИНН не проходит проверку контрольного разряда — похоже на опечатку';
    }
    return null;
  }
  const ok11 = checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10];
  const ok12 = checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  if (!ok11 || !ok12) {
    return 'ИНН не проходит проверку контрольного разряда — похоже на опечатку';
  }
  return null;
}

async function checkoGet(path, params) {
  const url = new URL(`${BASE_URL}/${path}`);
  url.searchParams.set('key', process.env.CHECKO_API_KEY);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await resp.json().catch(() => null);
  if (!body) throw new Error(`Checko вернул нечитаемый ответ (${resp.status}) на ${path}`);
  const meta = body.meta ?? {};
  // Checko отдаёт HTTP 200 и на "не найдено", и на ошибку параметров —
  // ориентироваться нужно на meta.status, а не на код ответа. Отдельно:
  // "не найдено" здесь НЕ ошибка (компании может не быть в ЕГРЮЛ, это сам
  // по себе значимый результат), поэтому его разбирает уже вызывающий код.
  if (meta.status === 'error') {
    throw new Error(`Checko: ${meta.message || 'неизвестная ошибка'} (${path})`);
  }
  return { data: body.data ?? {}, meta };
}

// Пороги для жёлтых флагов. Первое приближение, специально вынесены сюда
// одним местом — ожидаю, что закупщица по факту попросит их подкрутить,
// когда посмотрит на реальных поставщиков.
const YOUNG_COMPANY_MONTHS = 12;
const MASS_ADDRESS_MIN = 10;
const MIN_CHARTER_CAPITAL = 10000;
const LAWSUIT_COUNT_WARN = 10;
const LAWSUIT_SUM_WARN = 1000000;

function monthsSince(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function formatMoney(value) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

// Возвращает плоский список флагов: {level: 'danger'|'warn', title, detail}.
// Порядок внутри уровня — от более к менее значимому, UI показывает их как
// есть. Ничего не выдумываем: если поля нет в ответе — флага тоже нет
// (отсутствие данных не то же самое, что "всё чисто", и красить это в
// зелёный было бы враньём).
export function computeRisks(company, legalCases, enforcements) {
  const risks = [];
  const add = (level, title, detail) => risks.push({ level, title, detail: detail ?? null });

  const status = company.Статус ?? {};
  // Код 001 — "Действует". Всё остальное (ликвидация, реорганизация,
  // банкротство, исключение из ЕГРЮЛ) — красный: платить такому юрлицу
  // как минимум рискованно.
  if (status.Код && status.Код !== '001') {
    add('danger', `Статус: ${status.Наим || status.Код}`, 'Юрлицо не в обычном действующем состоянии');
  }

  const addr = company.ЮрАдрес ?? {};
  if (addr.Недост === true) {
    add('danger', 'Недостоверный юридический адрес', 'ФНС внесла запись о недостоверности сведений об адресе');
  }
  const massAddress = Array.isArray(addr.МассАдрес) ? addr.МассАдрес.length : 0;
  if (massAddress >= MASS_ADDRESS_MIN) {
    add('warn', 'Массовый адрес регистрации', `По этому адресу зарегистрировано ещё ${massAddress} организаций`);
  }

  if (company.НедобПост === true) {
    add('danger', 'В реестре недобросовестных поставщиков', 'Компания включена в РНП по госзакупкам');
  }
  if (company.ДисквЛица === true) {
    add('danger', 'Дисквалифицированные лица в руководстве', null);
  }
  if (company.НелегалФин === true) {
    add('danger', 'В списке ЦБ РФ с признаками нелегальной деятельности', null);
  }
  if (company.Санкции === true) {
    add('danger', 'Компания под санкциями', null);
  }
  if (company.СанкцУчр === true) {
    add('danger', 'Учредитель под санкциями', null);
  }

  const heads = Array.isArray(company.Руковод) ? company.Руковод : [];
  if (heads.some((h) => h?.Недост === true)) {
    add('danger', 'Недостоверные сведения о руководителе', 'ФНС внесла запись о недостоверности');
  }
  if (company.МассРуковод === true || heads.some((h) => h?.МассРуковод === true)) {
    add('warn', 'Массовый руководитель', 'Руководитель числится в других организациях');
  }
  if (company.МассУчред === true) {
    add('warn', 'Массовый учредитель', null);
  }

  // Сообщения ЕФРСБ — НЕ синоним "компания банкрот": в выдаче Сбербанка,
  // например, лежат "Сведения о получении требования кредитора" по чужим
  // делам, где он сам выступал кредитором. Поэтому это жёлтый флаг с явной
  // оговоркой, а собственное банкротство ловится через Статус выше.
  const efrsb = Array.isArray(company.ЕФРСБ) ? company.ЕФРСБ : [];
  if (efrsb.length > 0) {
    add('warn', `Упоминания в реестре банкротств: ${efrsb.length}`, 'Компания может быть как должником, так и кредитором — нужно смотреть дела');
  }

  const months = company.ДатаРег ? monthsSince(company.ДатаРег) : null;
  if (months !== null && months < YOUNG_COMPANY_MONTHS) {
    add('warn', 'Молодое юрлицо', `Зарегистрировано ${Math.max(1, Math.round(months))} мес. назад (${company.ДатаРег})`);
  }

  const capital = company.УстКап?.Сумма;
  if (typeof capital === 'number' && capital > 0 && capital <= MIN_CHARTER_CAPITAL) {
    add('warn', 'Минимальный уставный капитал', formatMoney(capital));
  }

  // СЧР — среднесписочная численность. null означает "ФНС не публикует"
  // (так у банков и крупных компаний), это не повод для флага; а вот явный
  // 0 или 1 у поставщика стройматериалов — повод присмотреться.
  if (typeof company.СЧР === 'number' && company.СЧР <= 1) {
    add('warn', 'Нет сотрудников по данным ФНС', `Среднесписочная численность: ${company.СЧР}`);
  }

  const arrears = company.Налоги?.СумНедоим;
  if (typeof arrears === 'number' && arrears > 0) {
    add('warn', 'Задолженность по налогам', formatMoney(arrears));
  }

  const caseCount = legalCases?.ЗапВсего ?? 0;
  const caseSum = legalCases?.ОбщСуммИск ?? 0;
  if (caseCount >= LAWSUIT_COUNT_WARN || caseSum >= LAWSUIT_SUM_WARN) {
    const parts = [`${caseCount} дел как ответчик`];
    if (caseSum > 0) parts.push(`на ${formatMoney(caseSum)}`);
    add('warn', 'Много арбитражных дел', parts.join(', '));
  }

  const debt = enforcements?.ОстЗадолж ?? 0;
  const enforcementCount = enforcements?.ОбщКолич ?? 0;
  if (enforcementCount > 0) {
    add('warn', `Исполнительные производства: ${enforcementCount}`, debt > 0 ? `Остаток задолженности ${formatMoney(debt)}` : null);
  }

  return risks;
}

export function riskLevelOf(risks) {
  if (risks.some((r) => r.level === 'danger')) return 'danger';
  if (risks.length > 0) return 'warn';
  return 'ok';
}

// Основная точка входа. Три запроса в Checko параллельно — они независимы,
// а суточный лимит расходуется одинаково что последовательно, что нет.
// Арбитраж запрашиваем role=defendant: дела, где поставщик ОТВЕТЧИК —
// это признак проблем у него, а дела, где он истец, наоборот, говорят
// скорее о том, что он взыскивает свои деньги, и в светофор их тащить
// нельзя (иначе активный взыскатель выглядел бы хуже пассивной пустышки).
export async function checkReliability(inn) {
  const [companyResp, casesResp, enforcementsResp] = await Promise.all([
    checkoGet('company', { inn }),
    checkoGet('legal-cases', { inn, role: 'defendant', limit: LEGAL_CASES_LIMIT, sort: '-date' }),
    checkoGet('enforcements', { inn }),
  ]);

  const company = companyResp.data ?? {};
  // Пустой data при status:'ok' — это "не найдено" (см. checkoGet). Для
  // поставщика, выставившего счёт, отсутствие в ЕГРЮЛ — само по себе
  // красный флаг, а не техническая неудача.
  if (!company.ИНН) {
    return {
      found: false,
      inn,
      company: null,
      legalCases: null,
      enforcements: null,
      risks: [{ level: 'danger', title: 'Не найдено в ЕГРЮЛ/ЕГРИП', detail: `По ИНН ${inn} организация не найдена` }],
      riskLevel: 'danger',
    };
  }

  const legalCases = casesResp.data ?? null;
  const enforcements = enforcementsResp.data ?? null;
  const risks = computeRisks(company, legalCases, enforcements);

  return {
    found: true,
    inn,
    company,
    legalCases,
    enforcements,
    risks,
    riskLevel: riskLevelOf(risks),
  };
}
