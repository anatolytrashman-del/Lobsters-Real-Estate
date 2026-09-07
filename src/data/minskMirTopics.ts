// Посадочные под подсказки Google «Другие также ищут» по Минск Миру
// (аудит поиска 2026-09-07, SEOSTRATEGY.md: «Бизнес-центр Минск Мир»,
// «Коворкинг Минск Мир», «Купить офис Минск Мир», «Коммерческое помещение
// Минск Мир», «Аренда офиса Минск Мир»). Гид /minsk/minsk-mir остаётся
// хабом, каждая посадочная берёт свой срез данных и ведёт на Red One.
// Slug'и продублированы plain-массивом в scripts/prerender.mjs (скрипт
// запускается голым node без TS-загрузчика) — при добавлении темы
// поправить оба места и public/sitemap.xml.
export const MINSK_MIR_TOPIC_SLUGS = [
  'biznes-centr',
  'kovorking',
  'kupit-ofis',
  'arenda-ofisa',
  'kommercheskie-pomeshcheniya',
] as const;

export type MinskMirTopicSlug = (typeof MINSK_MIR_TOPIC_SLUGS)[number];

export function isMinskMirTopicSlug(value: string): value is MinskMirTopicSlug {
  return (MINSK_MIR_TOPIC_SLUGS as readonly string[]).includes(value);
}

export function minskMirTopicUrl(slug: MinskMirTopicSlug): string {
  return `/minsk/minsk-mir/${slug}`;
}

// Короткие подписи для перелинковки (гид → посадочные, посадочные → друг
// на друга). Заголовки/тексты самих страниц — в pages/MinskMirTopicPage.tsx.
export const MINSK_MIR_TOPIC_LABELS: Record<MinskMirTopicSlug, string> = {
  'biznes-centr': 'Бизнес-центры Минск Мира',
  kovorking: 'Коворкинг в Минск Мире',
  'kupit-ofis': 'Купить офис в Минск Мире',
  'arenda-ofisa': 'Аренда офиса в Минск Мире',
  'kommercheskie-pomeshcheniya': 'Коммерческие помещения в Минск Мире',
};
