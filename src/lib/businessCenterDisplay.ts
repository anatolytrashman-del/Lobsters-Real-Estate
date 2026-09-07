import type { BusinessCenter } from '../data/businessCenters';

// Общие мелкие хелперы отображения БЦ — используются и на хабе
// (BusinessCentersMinskPage.tsx), и на отдельной странице конкретного БЦ
// (BusinessCenterDetailPage.tsx), поэтому вынесены в один файл, а не
// продублированы (см. CLAUDE.md про подобные дубли — тут повода нет,
// страницы всегда монтируются вместе в рамках одного SPA-бандла).
// Владелец, увидев красные пилюли "Класс А" на карточках хаба: "убираем
// красный оттенок тут, не нравится, делай нейтральным" — A перестал быть
// 'primary' (красный/розовый в этой теме), остальные классы не трогал.
// Рейтинг с карт (Яндекс.Карты) — свободный текст в первом highlight с
// icon='rating' (пример: "- Яндекс.Карты: **4,8** из 5 (836 оценок...)"),
// структурного поля под него нет. Общий парсер — раньше жил только внутри
// BusinessCenterDetailPage.tsx (бейдж у заголовка), теперь нужен ещё и
// рейтингу /minsk/bcminsk/reyting, поэтому вынесен сюда как единственный
// источник разбора этой строки.
export function mapRatingFromHighlights(
  highlights: BusinessCenter['highlights'],
): { value: number; label: string; source: string } | null {
  const ratingHighlight = highlights.find((h) => h.icon === 'rating');
  if (!ratingHighlight) return null;
  // ** снимаем перед разбором — иначе "**4,8** из 5" не матчится по числу
  // сразу за "из 5" (между ними остаются сами звёздочки markdown-жирного).
  const line = ratingHighlight.text.split('\n')[0].replace(/\*/g, '');
  const valueMatch = line.match(/(\d+[.,]\d+)\s*из\s*5/);
  if (!valueMatch) return null;
  const sourceMatch = line.match(/^[-\s]*([^:]+):/);
  const label = valueMatch[1];
  return { value: parseFloat(label.replace(',', '.')), label, source: sourceMatch ? sourceMatch[1].trim() : 'карты' };
}

export const businessClassTone: Record<NonNullable<BusinessCenter['businessClass']>, 'primary' | 'success' | 'neutral'> = {
  A: 'neutral',
  'B+': 'success',
  B: 'neutral',
  C: 'neutral',
};

// Короткое имя без "Бизнес-центр «...»" — для бокового меню, карточек хаба
// и заголовка отдельной страницы (владелец: "БЦ по алфавиту, но без
// «Бизнес-Центр», просто названия").
export function shortName(center: BusinessCenter): string {
  if (center.slug === 'mfc-minsk-mir') return 'МФЦ (Минск Мир)';
  const quoted = center.name.match(/«([^»]+)»/);
  if (quoted) return quoted[1];
  const paren = center.name.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  return center.name;
}

// Короткий адрес для карточки хаба — владелец: "без «г. Минск», без района,
// только конкретный адрес, улица и дом. Где непонятно, подскажу" (полный
// адрес — на отдельной странице БЦ, там сокращать не нужно). Чисто
// синтаксическая обрезка, без хардкода по конкретным БЦ: снимает ведущий
// "г. Минск, "/"Минская область, ", затем ведущий "<Название> район, " —
// сработало на всех 27 текущих адресах без единого неоднозначного случая
// (включая "Аден" — тот не в Минске вовсе, у него снимается "Минская
// область, Смолевичский район, ", остаётся "индустриальный парк «Великий
// камень», Пекинский проспект, 31"; и МФЦ — стройка без номера дома,
// остаётся "проспект Мира, район «Минск Мир»", это и есть весь адрес).
export function shortAddress(fullAddress: string): string {
  return fullAddress
    .replace(/^г\.\s*Минск,\s*/i, '')
    .replace(/^Минская\s+область,\s*/i, '')
    .replace(/^[А-ЯЁ][а-яё]+\s+район,\s*/, '')
    .trim();
}

// Короткая строка метро для карточки хаба — владелец: "метро сокращаем до
// станции метро ближайшей, всё остальное внутри карточки" (полное значение
// с расстоянием/временем пешком/на транспорте остаётся на отдельной
// странице БЦ). Чисто синтаксическая обрезка, без хардкода по конкретным
// БЦ — берёт текст до первой запятой (там, где сама станция обычно и
// заканчивается: "Уручье, ~4 мин пешком" → "Уручье"), затем снимает
// хвост-уточнение в скобках, если он остался без запятой перед собой
// ("«Академия наук» (рядом)" → "«Академия наук»"). Сработало на всех 23
// текущих непустых значениях metro, кроме одного явно перечисляющего две
// станции без ведущей запятой ("рядом со станциями «А» и «Б»") — для него
// отдельная ветка берёт первую станцию в кавычках (владелец просил именно
// "ближайшую", а не обе).
export function shortMetro(metro: string): string {
  const beforeComma = metro.split(',')[0].trim();
  const cleaned = beforeComma.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (/рядом со станциями/i.test(cleaned)) {
    const match = cleaned.match(/«([^»]+)»/);
    if (match) return `«${match[1]}»`;
  }
  return cleaned;
}

// Порядок для навигации "следующий/предыдущий БЦ" на отдельной странице —
// тот же алфавит по короткому имени, что и в боковом меню хаба, чтобы
// стрелки совпадали с порядком, который пользователь уже видел в списке.
// PAGESPEED_PLAN.md, Э9 (каталог БЦ) — фото БЦ в базе хранятся путями к
// закоммиченным JPEG (`/images/business-centers/<slug>.jpg`, 500–1600px,
// в среднем 150 КиБ, до 330 КиБ), а показываются в карточке каталога
// шириной ~380px и на странице БЦ ~700px. Рядом с каждым JPEG в репозитории
// лежат два WebP: `<slug>.webp` (до 1200px, страница БЦ) и `<slug>-card.webp`
// (до 640px, карточка каталога) — см. журнал плана, как их пересобрать.
// JPEG остаётся для og:image (соцсети/мессенджеры не все понимают WebP в
// превью) и как источник. Пути НЕ из этой папки (например, загруженные
// через админку в Supabase Storage) возвращаются как есть.
const LOCAL_BC_PHOTO_RE = /^\/images\/business-centers\/([^/]+)\.jpe?g$/i;

export function businessCenterPhotoSrc(path: string, variant: 'card' | 'detail'): string {
  const m = path.match(LOCAL_BC_PHOTO_RE);
  if (!m) return path;
  return `/images/business-centers/${m[1]}${variant === 'card' ? '-card' : ''}.webp`;
}

export function sortByShortName(centers: BusinessCenter[]): BusinessCenter[] {
  return [...centers].sort((a, b) => shortName(a).localeCompare(shortName(b), 'ru'));
}
