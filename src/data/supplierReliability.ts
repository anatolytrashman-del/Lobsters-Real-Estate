// Благонадёжность поставщика — автоматическая проверка юрлица по
// госреестрам РФ через Checko (см. api/_checko.js, там же правила рисков).
//
// Владелец, 2026-09-11: "когда поставщик прислал счет и нам стали известны
// реквизиты, запускать процесс верификации поставщика... Будем смотреть
// вообще все, что есть... нам важно подсвечивать в первую очередь опасные
// и потенциально рискованные моменты, как большое количество арбитражных
// дел, слишком новое юрлицо, недостоверный юрадрес, банкроство".
//
// НЕ путать с SupplierOffer.verified — то ручная отметка закупщицы
// "данные поставщика посмотрел человек, можно писать письма". Здесь —
// машинная проверка по ЕГРЮЛ/арбитражу/ФССП. Одно не заменяет другое, и
// зелёный светофор здесь не делает поставщика verified.
//
// Кэш живёт по ИНН, а НЕ по предложению: одно и то же юрлицо запросто
// всплывает в нескольких категориях закупки, и проверять его повторно —
// зря жечь суточный лимит запросов к Checko.

// Только Россия. Проверено живыми запросами к API: белорусские УНП (даже с
// корректным контрольным разрядом) Checko не находит — карточки РБ есть на
// сайте checko.ru, но через API не отдаются. Владелец, 2026-09-11: "Делай
// на Россию, а потом напомнишь и сделаем и на Беларусь". Когда дойдут руки
// до РБ — это будет ДРУГОЙ источник (ГРП МНС portal.nalog.gov.by/grp/getData,
// бесплатный и без ключа, плюс DaData party_by для реквизитов), и там
// принципиально не будет арбитража: аналога kad.arbitr.ru в Беларуси нет,
// судебные дела по УНП бесплатно не достать вообще никак.
export const RELIABILITY_COUNTRY = 'Россия';

export type RiskLevel = 'ok' | 'warn' | 'danger';

export interface RiskFlag {
  level: 'warn' | 'danger';
  title: string;
  detail: string | null;
}

export interface SupplierReliability {
  id: string;
  inn: string;
  // false — юрлица с таким ИНН нет в ЕГРЮЛ/ЕГРИП. Само по себе красный
  // флаг (счёт выставил кто-то несуществующий), а не техническая неудача,
  // поэтому это нормальная сохранённая запись, а не error.
  found: boolean;
  riskLevel: RiskLevel;
  risks: RiskFlag[];
  // Сырые ответы Checko — храним целиком, чтобы показывать подробную
  // карточку ("Будем смотреть вообще все, что есть") и чтобы при изменении
  // правил рисков не бежать перезапрашивать API по всем поставщикам.
  company: Record<string, unknown> | null;
  legalCases: Record<string, unknown> | null;
  enforcements: Record<string, unknown> | null;
  // Непусто — проверка сорвалась (Checko недоступен, кончился лимит).
  // Отличать от found=false: там ответ получен и он отрицательный, здесь
  // ответа нет вовсе и показывать что-либо про поставщика нельзя.
  error: string | null;
  checkedAt: string;
}

export interface SupplierReliabilityRow {
  id: string;
  inn: string;
  found: boolean;
  risk_level: string;
  risks: RiskFlag[] | null;
  company: Record<string, unknown> | null;
  legal_cases: Record<string, unknown> | null;
  enforcements: Record<string, unknown> | null;
  error: string | null;
  checked_at: string;
}

export const RISK_LEVEL_LABEL: Record<RiskLevel, string> = {
  ok: 'Проверен, рисков не найдено',
  warn: 'Есть на что обратить внимание',
  danger: 'Опасный контрагент',
};

// Через сколько считать проверку устаревшей. Реестры обновляются не чаще
// раза в сутки (арбитраж у Checko вообще с лагом 1–2 недели), а суточный
// лимит запросов ограничен — поэтому месяц, с возможностью перепроверить
// руками кнопкой в карточке.
const STALE_AFTER_DAYS = 30;

export function isReliabilityStale(r: SupplierReliability): boolean {
  const checked = new Date(r.checkedAt).getTime();
  if (Number.isNaN(checked)) return true;
  return Date.now() - checked > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

// Показывать ли восклицательный знак. Владелец, 2026-09-11: такие моменты
// "должны обязательно выводить уведомлением восклицательного знака и в
// списке поставщиков (прям на главной), и в сравнении цен, и в переписке".
// Ошибку проверки специально НЕ подсвечиваем как риск: "не смогли
// проверить" — это не "нашли проблему", и путать эти два состояния
// восклицательным знаком нельзя (иначе он обесценится).
export function shouldFlag(r: SupplierReliability | null | undefined): boolean {
  return !!r && !r.error && (r.riskLevel === 'warn' || r.riskLevel === 'danger');
}

export function riskSummary(r: SupplierReliability): string {
  if (r.error) return `Не удалось проверить: ${r.error}`;
  if (!r.found) return 'Юрлицо не найдено в ЕГРЮЛ/ЕГРИП';
  if (r.risks.length === 0) return RISK_LEVEL_LABEL.ok;
  return r.risks.map((f) => f.title).join('; ');
}
