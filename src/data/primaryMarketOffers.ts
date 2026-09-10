// Первичный рынок Минск Мира (bir.by) — см. scripts/sync-bir-primary-market.mjs
// и SEO_PLAN.md. Обычные квартиры (vid=Квартира) сознательно не собираются —
// владелец: "нам вообще квартиры не нужны, только апарты и остальная
// коммерция". Строка — одно объявление, не готовый агрегат (тот же принцип,
// что у market_offers для Kufar/Realt) — блок на гиде района считает сводку
// прямо из этих строк.

export interface PrimaryMarketOffer {
  id: number;
  source: string;
  externalId: string;
  category: string;
  complex: string | null;
  house: string | null;
  unitNumber: string | null;
  floor: number | null;
  areaM2: number;
  // Только у коммерческих (см. terraceAreaM2 в scripts/sync-bir-primary-market.mjs)
  // — у квартир/апартаментов/кладовых bir.by эту площадь не показывает.
  terraceAreaM2: number | null;
  yearHandover: number | null;
  // 'Сдано' | 'Строится' — только у "Бизнес-апартаменты", для сравнения
  // сданных домов с ценой на вторичке (владелец).
  stage: string | null;
  priceTotalByn: number;
  priceTotalEur: number;
  adLink: string | null;
  scrapedAt: string;
  // 2026-09-10 (владелец: "раз у нас есть инфа, сколько юнитов снял с сайта
  // застройщик, значит у нас есть инфа по продажам") — заполняется
  // scripts/sync-bir-primary-market.mjs (pruneStaleOffers), когда объект
  // подтверждённо пропал с bir.by (ссылка отдаёт 404). null — объект всё
  // ещё в продаже. Не факт сделки, а вывод из снятия объявления — bir.by
  // это собственный сайт застройщика, у объекта там обычно нет причины
  // пропасть, кроме продажи, но 100% гарантии нет (могла быть и техническая
  // правка) — поэтому везде на страницах формулировка "предположительно
  // продано", не "продано".
  soldAt: string | null;
}

export interface PrimaryMarketOfferRow {
  id: number;
  source: string;
  external_id: string;
  category: string;
  complex: string | null;
  house: string | null;
  unit_number: string | null;
  floor: number | null;
  area_m2: number;
  terrace_area_m2: number | null;
  year_handover: number | null;
  stage: string | null;
  price_total_byn: number;
  price_total_eur: number;
  ad_link: string | null;
  scraped_at: string;
  sold_at: string | null;
}

// Чистая площадь — общая минус терраса (тот же принцип, что netSize у
// market_offers для Kufar/Realt, см. src/data/marketOffers.ts): терраса
// стоит заметно дешевле закрытого помещения, официальная "Цена за м²" у
// bir.by считается по общей площади (с террасой) — искажает картину для
// офисов/торговых с террасой.
export function primaryNetAreaM2(offer: Pick<PrimaryMarketOffer, 'areaM2' | 'terraceAreaM2'>): number {
  if (offer.terraceAreaM2 == null) return offer.areaM2;
  const net = offer.areaM2 - offer.terraceAreaM2;
  return net > 0 ? net : offer.areaM2;
}

export function primaryNetPricePerM2Eur(offer: Pick<PrimaryMarketOffer, 'areaM2' | 'terraceAreaM2' | 'priceTotalEur'>): number {
  const net = primaryNetAreaM2(offer);
  return Math.round((offer.priceTotalEur / net) * 100) / 100;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface PrimaryMarketPivotRow {
  key: string;
  label: string;
  count: number;
  areaMin: number;
  areaMax: number;
  priceMinEur: number;
  priceAvgEur: number;
  priceMaxEur: number;
}

// Порядок строк сводки первичного рынка — обычные квартиры (vid=Квартира)
// сюда сознательно не входят (владелец: "квартиры не нужны, только апарты
// и остальная коммерция"). Апартаменты разбиты на "сдано"/"строится" —
// владелец: "сданные дома фиксируем и выводим отдельно, по ним стоит
// сравнивать цену с вторичкой". Машиноместа — владелец попросил добавить
// сюда же то, что уже спарсено для блока "Паркинги" (тот же исходный срез
// bir.by, дозагружен в primary_market_offers отдельным разовым запуском,
// не через sync-bir-primary-market.mjs — там нет колонки под крытые/
// подземные). Цены здесь и есть "другой блок", куда их обещали перенести
// при чистке "Паркинги" от цен — карточки там остались только с
// количеством/площадью, сравнение цены за м² — тут.
//
// Ключ (key) отдельно от подписи (label) — подпись меняли пару раз в этой
// сессии (правки формулировок), а key используется как стабильный
// идентификатор категории между таблицей и Pro-модалкой (выбранная
// вкладка), завязывать его на текст подписи было бы хрупко.
export const PRIMARY_MARKET_ROW_ORDER: { key: string; label: string; filter: (o: PrimaryMarketOffer) => boolean }[] = [
  {
    key: 'apartments-sdano',
    label: 'Бизнес-апартаменты — сдано',
    filter: (o) => o.category === 'Бизнес-апартаменты' && o.stage === 'Сдано',
  },
  {
    key: 'apartments-stroitsya',
    label: 'Бизнес-апартаменты',
    filter: (o) => o.category === 'Бизнес-апартаменты' && o.stage === 'Строится',
  },
  { key: 'retail', label: 'Торговые помещения', filter: (o) => o.category === 'Торговые помещения' },
  { key: 'offices', label: 'Офисы', filter: (o) => o.category === 'Офисы' },
  { key: 'pantry', label: 'Кладовые', filter: (o) => o.category === 'Кладовые' },
  { key: 'parking-covered', label: 'Машиноместа крытые', filter: (o) => o.category === 'Машиноместа (крытые)' },
  { key: 'parking-underground', label: 'Машиноместа подземные', filter: (o) => o.category === 'Машиноместа (подземные)' },
];

// Сводка "что сейчас продаётся" — предположительно проданные (soldAt задан,
// см. комментарий у PrimaryMarketOffer.soldAt) объекты сюда не входят, они
// больше не предложение на рынке. Фильтр применяется здесь ОДИН РАЗ, а не в
// каждом вызывающем компоненте по отдельности — так безопаснее (не забудешь
// отфильтровать в новом месте) и сам смысл "рыночного среза" требует именно
// активных предложений, ничего другого эта функция и не должна показывать.
export function buildPrimaryMarketPivot(offers: PrimaryMarketOffer[]): PrimaryMarketPivotRow[] {
  const active = offers.filter((o) => !o.soldAt);
  const rows: PrimaryMarketPivotRow[] = [];
  for (const { key, label, filter } of PRIMARY_MARKET_ROW_ORDER) {
    const matched = active.filter(filter);
    if (matched.length === 0) continue;
    const areas = matched.map(primaryNetAreaM2);
    const prices = matched.map(primaryNetPricePerM2Eur);
    rows.push({
      key,
      label,
      count: matched.length,
      areaMin: Math.round(Math.min(...areas) * 10) / 10,
      areaMax: Math.round(Math.max(...areas) * 10) / 10,
      priceMinEur: Math.round(Math.min(...prices)),
      priceAvgEur: Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length),
      priceMaxEur: Math.round(Math.max(...prices)),
    });
  }
  return rows;
}

export interface PrimarySalesStat {
  key: string;
  label: string;
  soldCount: number;
  soldAreaM2: number;
  // Сумма ПОСЛЕДНЕЙ известной цены объявления на момент, когда оно пропало
  // с bir.by — не факт сделки (застройщик мог согласовать скидку/рассрочку
  // на иных условиях), явно так и подписано на страницах, не "выручка".
  soldValueEur: number;
}

// Продажи застройщика (владелец, 2026-09-10: "раз у нас есть инфа, сколько
// юнитов снял с сайта застройщик, значит у нас есть инфа по продажам
// застройщика") — считается по тем же категориям и в том же порядке, что и
// buildPrimaryMarketPivot, только по объектам с soldAt (задаётся
// scripts/sync-bir-primary-market.mjs при подтверждённом снятии с публикации,
// см. комментарий у PrimaryMarketOffer.soldAt). Отслеживание запущено
// 2026-09-10 — до этой даты объекты пропадали с сайта незамеченными
// (скрипт их не удалял и не помечал), поэтому это не полная история продаж
// комплекса с открытия, а только то, что зафиксировано автоматической
// проверкой с этого момента.
export function buildPrimarySalesSummary(offers: PrimaryMarketOffer[]): PrimarySalesStat[] {
  const rows: PrimarySalesStat[] = [];
  for (const { key, label, filter } of PRIMARY_MARKET_ROW_ORDER) {
    const sold = offers.filter((o) => o.soldAt != null && filter(o));
    if (sold.length === 0) continue;
    rows.push({
      key,
      label,
      soldCount: sold.length,
      soldAreaM2: Math.round(sold.reduce((sum, o) => sum + primaryNetAreaM2(o), 0) * 10) / 10,
      soldValueEur: Math.round(sold.reduce((sum, o) => sum + o.priceTotalEur, 0)),
    });
  }
  return rows;
}

// Самая ранняя дата в имеющихся soldAt — используется как "отслеживаем с
// {дата}" на странице, не хардкодится: если понадобится когда-нибудь снести
// и пересобрать отслеживание заново, подпись сама подстроится под реальные
// данные, не будет врать про уже неактуальную дату запуска.
export function earliestSoldAt(offers: PrimaryMarketOffer[]): string | null {
  const dates = offers.map((o) => o.soldAt).filter((d): d is string => d != null);
  if (dates.length === 0) return null;
  return dates.reduce((min, d) => (d < min ? d : min));
}
