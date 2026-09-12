// Проверка благонадёжности белорусского контрагента по УНП.
//
// Владелец, 2026-09-12: "можем переходить к Беларуси... принцип такой же,
// получили счет - проверили". Принцип тот же, что и у России
// (api/_checko.js), но источник и объём данных принципиально другие.
//
// ЧЕГО ЗДЕСЬ НЕ БУДЕТ, и это не недоделка:
// - **Арбитраж.** Аналога kad.arbitr.ru в Беларуси не существует. Банк
//   данных судебных постановлений Верховного суда ищет по НАЗВАНИЮ участника
//   и требует регистрации, а банк решений на pravo.by обезличен. Судебку по
//   УНП бесплатно и программно не достать никак — только через платный
//   белорусский агрегатор (kartoteka.by, StatusPro, LEGAT, DAZOR), и у всех
//   доступ через менеджера, без самостоятельной выдачи ключа.
// - **Исполнительные производства, банкротство, налоговые долги, РНП.** Всё
//   это есть на госсайтах, но только веб-формами: у minjust.gov.by,
//   bankrot.gov.by, lkfl.portal.nalog.gov.by и gias.by нет API. Ссылки на
//   них отдаём в UI, чтобы закупщица добила руками.
//
// Что реально доступно программно и бесплатно — ГРП МНС: состояние
// плательщика (действующий / в стадии ликвидации / ликвидирован), дата
// регистрации, инспекция, признак неосуществления деятельности. Это отвечает
// на главный вопрос "жив ли контрагент и не в ликвидации ли он", но честно
// НЕ отвечает на "не судится ли он и нет ли у него долгов".

// Эндпоинт ГРП МНС. Ключ и регистрация не нужны.
//
// Два известных подвоха, оба из исходников python-stdnum, которая с этим
// эндпоинтом работает давно:
// 1) сайт отдаёт НЕПОЛНУЮ цепочку TLS-сертификатов — в Node это может дать
//    UNABLE_TO_VERIFY_LEAF_SIGNATURE. Ловим и говорим словами, а не падаем
//    невнятной сетевой ошибкой;
// 2) формат ответа уже менялся (ключ был ROW, стал row) — читаем регистро-
//    независимо и не считаем отсутствие ожидаемого поля ошибкой.
const GRP_URL = 'https://www.portal.nalog.gov.by/grp/getData';

const CYRILLIC_TO_LATIN = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T' };
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const UNP_WEIGHTS = [29, 23, 19, 17, 13, 7, 5, 3];

// Привести УНП к каноническому виду: убрать префикс, пробелы, заменить
// кириллические буквы-омографы на латиницу. Без этого УНП, скопированный из
// документа (где "А" может быть русской), не пройдёт проверку, хотя человек
// видит ровно то же самое.
export function compactUnp(value) {
  const raw = String(value ?? '')
    .toUpperCase()
    .replace(/[\s\-—]/g, '')
    .replace(/^(УНП|UNP)/, '');
  return [...raw].map((ch) => CYRILLIC_TO_LATIN[ch] ?? ch).join('');
}

// Контрольный разряд УНП — тот же алгоритм, что в python-stdnum
// (stdnum/by/unp.py). Считаем офлайн, до всякой сети: это мгновенно и
// отсекает опечатки распознавания (модель может принять за УНП номер счёта
// или БИК) ещё до обращения к реестру.
export function invalidUnpReason(value) {
  const n = compactUnp(value);
  if (n.length !== 9) return 'УНП должен состоять из 9 символов';
  if (!/^\d{7}$/.test(n.slice(2))) return 'УНП: последние 7 символов должны быть цифрами';
  const head = n.slice(0, 2);
  if (!/^\d{2}$/.test(head) && ![...head].every((c) => 'ABCEHKMOPT'.includes(c))) {
    return 'УНП: недопустимые символы в начале номера';
  }
  if (!'1234567ABCEHKM'.includes(n[0])) return 'УНП: недопустимый код региона';

  // У УНП физлиц/ИП первые два символа буквенные — вторая буква
  // разворачивается в цифру по своему алфавиту (см. calc_check_digit).
  const forSum = /^\d+$/.test(n) ? n : n[0] + String('ABCEHKMOPT'.indexOf(n[1])) + n.slice(2);
  const c = UNP_WEIGHTS.reduce((sum, w, i) => sum + w * ALPHABET.indexOf(forSum[i]), 0) % 11;
  if (c > 9) return 'УНП не проходит проверку контрольного разряда — похоже на опечатку';
  if (String(c) !== n[8]) return 'УНП не проходит проверку контрольного разряда — похоже на опечатку';
  return null;
}

// Ссылки на реестры, которые API не отдают — закупщица проверяет руками.
// Отдаём их вместе с результатом, чтобы не держать список в голове и не
// делать вид, что проверка полная.
export function manualCheckLinks(unp) {
  const n = compactUnp(unp);
  return [
    { title: 'Долги по налогам', url: 'https://lkfl.portal.nalog.gov.by/debtor/' },
    { title: 'Банкротство', url: 'https://bankrot.gov.by/Debtors/DebtorsList' },
    { title: 'Исполнительные производства', url: 'https://minjust.gov.by/directions/enforcement/debtors/' },
    { title: 'Не допущен к закупкам', url: 'https://gias.by/gias/#/directory/locked_suppliers' },
    { title: 'Карточка в ЕГР', url: `https://egr.gov.by/egrn/index.jsp?content=eJurCheckData&unp=${encodeURIComponent(n)}` },
  ];
}

// Состояния плательщика в ГРП. Точные коды ckodsost в открытой документации
// не описаны, поэтому решение принимаем по ТЕКСТУ состояния, а не по коду:
// текст МНС отдаёт человекочитаемым ("Действующий", "В стадии ликвидации",
// "Ликвидирован"). Если текста нет вовсе — не выдумываем статус.
function statusRisk(stateText) {
  const s = String(stateText ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('ликвидир') || s.includes('исключ') || s.includes('прекра')) {
    return { level: 'danger', title: `Статус: ${stateText}`, detail: 'Плательщик больше не действует' };
  }
  if (s.includes('ликвидац') || s.includes('банкрот') || s.includes('санац')) {
    return { level: 'danger', title: `Статус: ${stateText}`, detail: 'Идёт процедура ликвидации или банкротства' };
  }
  if (s.includes('действ')) return null;
  // Незнакомая формулировка — показываем как есть жёлтым, чтобы человек
  // посмотрел сам, а не молча считаем её нормой.
  return { level: 'warn', title: `Статус: ${stateText}`, detail: 'Нестандартное состояние плательщика — проверьте вручную' };
}

const YOUNG_COMPANY_MONTHS = 12;

function monthsSince(dateStr) {
  // МНС отдаёт даты в разных видах (ISO и dd.mm.yyyy) — разбираем оба, а на
  // неразобранном просто не строим флаг.
  const raw = String(dateStr ?? '').trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

// Читаем поле регистронезависимо: формат ответа МНС уже менялся (ROW→row),
// и закладываться на конкретный регистр ключей нельзя.
function pick(obj, ...names) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = new Map(Object.keys(obj).map((k) => [k.toLowerCase(), obj[k]]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function computeBelarusRisks(row) {
  const risks = [];
  const state = pick(row, 'vnaimksost', 'nsost', 'ckodsost_name', 'sost', 'vnaimsost');
  const s = statusRisk(state);
  if (s) risks.push(s);

  const regDate = pick(row, 'dreg', 'datareg');
  const months = monthsSince(regDate);
  if (months !== null && months < YOUNG_COMPANY_MONTHS) {
    risks.push({
      level: 'warn',
      title: 'Молодое юрлицо',
      detail: `Зарегистрировано ${Math.max(1, Math.round(months))} мес. назад`,
    });
  }

  // Признак "не осуществляет деятельность более 12 месяцев" — МНС публикует
  // его отдельно. Для поставщика, выставившего счёт, это прямое противоречие
  // (не работает, но продаёт), поэтому красный, а не жёлтый.
  const inactive = pick(row, 'ndeyat', 'vnaimndeyat', 'nedeyat');
  if (inactive !== undefined && /да|true|1/i.test(String(inactive))) {
    risks.push({
      level: 'danger',
      title: 'Не осуществляет деятельность более 12 месяцев',
      detail: 'По данным МНС — при этом выставлен счёт',
    });
  }
  return risks;
}

export async function checkBelarusReliability(unp) {
  const n = compactUnp(unp);
  const url = `${GRP_URL}?unp=${encodeURIComponent(n)}&charset=UTF-8&type=json`;

  let body;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`ГРП МНС ответил ${resp.status}`);
    body = await resp.json();
  } catch (err) {
    const msg = String(err?.message ?? err);
    if (/certificate|self.signed|UNABLE_TO_VERIFY/i.test(msg)) {
      throw new Error('ГРП МНС недоступен: сайт отдаёт неполную цепочку TLS-сертификатов');
    }
    throw new Error(`ГРП МНС недоступен: ${msg.slice(0, 160)}`);
  }

  const row = pick(body, 'row') ?? body?.ROW ?? body?.row;
  // Пустой ответ = плательщика с таким УНП в реестре нет. Для контрагента,
  // выставившего счёт, это красный флаг сам по себе, а не сбой связи.
  if (!row || (typeof row === 'object' && Object.keys(row).length === 0)) {
    return {
      found: false,
      unp: n,
      company: null,
      risks: [{ level: 'danger', title: 'Не найдено в реестре МНС', detail: `По УНП ${n} плательщик не найден` }],
      riskLevel: 'danger',
      manualLinks: manualCheckLinks(n),
    };
  }

  const risks = computeBelarusRisks(row);
  return {
    found: true,
    unp: n,
    company: {
      Наименование: pick(row, 'vnaimp', 'naimp', 'vnaim', 'naim') ?? null,
      Статус: pick(row, 'vnaimksost', 'nsost', 'sost', 'vnaimsost') ?? null,
      ДатаРег: pick(row, 'dreg', 'datareg') ?? null,
      ДатаЛикв: pick(row, 'dlikv') ?? null,
      Инспекция: pick(row, 'vmns', 'nmns', 'ckodinsp') ?? null,
      raw: row,
    },
    risks,
    riskLevel: risks.some((r) => r.level === 'danger') ? 'danger' : risks.length > 0 ? 'warn' : 'ok',
    manualLinks: manualCheckLinks(n),
  };
}
