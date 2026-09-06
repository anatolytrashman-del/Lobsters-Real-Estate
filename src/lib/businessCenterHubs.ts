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
