import type { BusinessCenter } from '../data/businessCenters';

// Хаб-страницы по классу и по району (Fable-анализ SEO-блоков каталога БЦ,
// 2026-09-06 — "нужны страницы вида /minsk/bcminsk/class-a/,
// /minsk/bcminsk/centralny/... каждая со своим H1"). Статические карты
// slug<->значение — районов и классов конечное известное множество (9
// админ-районов Минска + "Великий камень" для объектов вне города, и 4
// деловых класса), не нужен динамический slugify на лету.
export const CLASS_SLUGS: Record<NonNullable<BusinessCenter['businessClass']>, string> = {
  A: 'a',
  'B+': 'b-plus',
  B: 'b',
  C: 'c',
};

export const CLASS_SLUG_TO_VALUE: Record<string, NonNullable<BusinessCenter['businessClass']>> = Object.fromEntries(
  Object.entries(CLASS_SLUGS).map(([value, slug]) => [slug, value as NonNullable<BusinessCenter['businessClass']>]),
);

export const DISTRICT_SLUGS: Record<string, string> = {
  Центральный: 'tsentralny',
  Октябрьский: 'oktyabrsky',
  Советский: 'sovetsky',
  Фрунзенский: 'frunzensky',
  Заводской: 'zavodskoy',
  Первомайский: 'pervomaysky',
  Партизанский: 'partizansky',
  Московский: 'moskovsky',
  Ленинский: 'leninsky',
  'Великий камень': 'velikiy-kamen',
};

export const DISTRICT_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(DISTRICT_SLUGS).map(([name, slug]) => [slug, name]),
);

// Предложный падеж района ("в Московском районе", не "в Московский районе")
// — нужен только для связного текста комбинированных хабов класс×район
// (владелец, 2026-09-06: "структура урлов [пересечений]"), на одноосевых
// хабах район используется как ярлык без предлога ("Минска: Московский
// район"), склонение не требовалось. Явная карта на 9 районов (конечное
// известное множество, как и сами DISTRICT_SLUGS) — надёжнее, чем угадывать
// суффикс регуляркой на разномастных окончаниях (-ский/-ой/-ный).
const DISTRICT_PREPOSITIONAL: Record<string, string> = {
  Центральный: 'Центральном',
  Октябрьский: 'Октябрьском',
  Советский: 'Советском',
  Фрунзенский: 'Фрунзенском',
  Заводской: 'Заводском',
  Первомайский: 'Первомайском',
  Партизанский: 'Партизанском',
  Московский: 'Московском',
  Ленинский: 'Ленинском',
};

export function districtPrepositional(district: string): string {
  return DISTRICT_PREPOSITIONAL[district] ?? district;
}

export function districtHubUrl(district: string): string | null {
  const slug = DISTRICT_SLUGS[district];
  return slug ? `/minsk/bcminsk/raion/${slug}` : null;
}

export function classHubUrl(businessClass: NonNullable<BusinessCenter['businessClass']>): string {
  return `/minsk/bcminsk/class/${CLASS_SLUGS[businessClass]}`;
}

// Хаб-страницы по пересечению класс×район (владелец, 2026-09-06: "давай
// пока сделаем ту самую структуру урлов [дерево пересечений]... точечные
// страницы будут очень хорошо приняты поиском, увеличит количество страниц
// в выдаче" — идея была впервые предложена самим владельцем и записана как
// задел на будущее в BCMINSK_SEO_PLAN.md, теперь реализована). Схема
// `/minsk/bcminsk/class/:classSlug/raion/:districtSlug` — та же, что
// называл сам план. Метро×класс/метро×район из того же плана НЕ делаем —
// метро всё ещё свободный текст, не структурное поле (см. блокер в плане).
export function classDistrictHubUrl(
  businessClass: NonNullable<BusinessCenter['businessClass']>,
  district: string,
): string | null {
  const districtSlug = DISTRICT_SLUGS[district];
  if (!districtSlug) return null;
  return `/minsk/bcminsk/class/${CLASS_SLUGS[businessClass]}/raion/${districtSlug}`;
}

// Хабы по неформальным микрорайонам ("Уручье", "Малиновка" — как люди сами
// называют район, не официальный административный район), владелец,
// 2026-09-07: "можем делать ещё страницы по типу «Бизнес-центры Уручье»...
// от 1 БЦ". Список — не все микрорайоны, которые в принципе знает 2GIS
// (см. таблицу `minsk_microdistricts` — там шире, для будущего), а только
// те, где на сегодня есть хотя бы 1 БЦ (иначе хаб был бы пустой страницей,
// тонкий контент) — см. journal 2026-09-07 про сам point-in-polygon матчинг.
// Слаги — транслитерация вручную (конечный список, как и у DISTRICT_SLUGS).
export const MICRODISTRICT_SLUGS: Record<string, string> = {
  Комаровка: 'komarovka',
  Чкаловский: 'chkalovsky',
  'Каменная Горка': 'kamennaya-gorka',
  Веснянка: 'vesnyanka',
  'Зелёный Луг': 'zelenyy-lug',
  Сухарево: 'suharevo',
  'Золотая Горка': 'zolotaya-gorka',
  Уручье: 'uruchye',
  Степянка: 'stepyanka',
  Барановщина: 'baranovschina',
  Магистр: 'magistr',
  Радужный: 'raduzhny',
  'Раковское Шоссе-1': 'rakovskoe-shosse-1',
  Лошица: 'loshitsa',
  'Великий Лес': 'velikiy-les',
  Грушевка: 'grushevka',
  Слепянка: 'slepyanka',
  'Михалово-2': 'mihalovo-2',
};

export const MICRODISTRICT_SLUG_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(MICRODISTRICT_SLUGS).map(([name, slug]) => [slug, name]),
);

export function microdistrictHubUrl(microdistrict: string): string | null {
  const slug = MICRODISTRICT_SLUGS[microdistrict];
  return slug ? `/minsk/bcminsk/microrayon/${slug}` : null;
}

// Хабы по станциям метро (аудит поиска 2026-09-07, «новые срезы: по станциям
// метро») — /minsk/bcminsk/metro/:metroSlug. Источник — структурные
// расстояния 2GIS (`BusinessCenter.nearestMetroStations`), не свободный
// текст `metro`: БЦ попадает на страницу станции, если она в пределах
// METRO_HUB_MAX_DISTANCE_M по прямой (≈15–20 минут пешком) — один БЦ может
// быть на страницах двух соседних станций, это честно («у метро X» и «у
// метро Y» одновременно). 38 БЦ без структурных данных (у них в `metro`
// «более 3 остановок на транспорте» или пусто) ни на один хаб не попадают.
// Слаги — транслитерация вручную, конечный список станций Минского метро,
// встречающихся в данных; хаб генерируется только для станций с ≥1 БЦ
// (см. prerender.mjs / generate-sitemap.mjs — динамический список).
export const METRO_HUB_MAX_DISTANCE_M = 1500;

export const METRO_STATION_SLUGS: Record<string, string> = {
  Молодёжная: 'molodezhnaya',
  Фрунзенская: 'frunzenskaya',
  'Площадь Франтишка Богушевича': 'ploshchad-bogushevicha',
  'Академия наук': 'akademiya-nauk',
  Пушкинская: 'pushkinskaya',
  'Институт культуры': 'institut-kultury',
  Вокзальная: 'vokzalnaya',
  'Юбилейная площадь': 'yubileynaya-ploshchad',
  'Площадь Победы': 'ploshchad-pobedy',
  Купаловская: 'kupalovskaya',
  'Ковальская Слобода': 'kovalskaya-sloboda',
  Московская: 'moskovskaya',
  'Площадь Якуба Коласа': 'ploshchad-yakuba-kolasa',
  Михалово: 'mihalovo',
  'Площадь Ленина': 'ploshchad-lenina',
  Грушевка: 'grushevka',
  Восток: 'vostok',
  Петровщина: 'petrovshchina',
  Немига: 'nemiga',
  Аэродромная: 'aerodromnaya',
  Уручье: 'uruchye',
  Октябрьская: 'oktyabrskaya',
  'Борисовский тракт': 'borisovskiy-trakt',
  'Каменная горка': 'kamennaya-gorka',
  'Парк Челюскинцев': 'park-chelyuskintsev',
  Спортивная: 'sportivnaya',
  Кунцевщина: 'kuntsevshchina',
  Первомайская: 'pervomayskaya',
  'Тракторный завод': 'traktornyy-zavod',
  Партизанская: 'partizanskaya',
  Пролетарская: 'proletarskaya',
  Малиновка: 'malinovka',
  Автозаводская: 'avtozavodskaya',
  Могилёвская: 'mogilevskaya',
};

export const METRO_SLUG_TO_STATION: Record<string, string> = Object.fromEntries(
  Object.entries(METRO_STATION_SLUGS).map(([name, slug]) => [slug, name]),
);

export function metroHubUrl(station: string): string | null {
  const slug = METRO_STATION_SLUGS[station];
  return slug ? `/minsk/bcminsk/metro/${slug}` : null;
}

// Расстояние по прямой от БЦ до станции, если станция в радиусе хаба; иначе null.
export function metroHubDistance(center: Pick<BusinessCenter, 'nearestMetroStations'>, station: string): number | null {
  const match = center.nearestMetroStations.find((s) => s.name === station && s.distanceMeters <= METRO_HUB_MAX_DISTANCE_M);
  return match ? match.distanceMeters : null;
}
