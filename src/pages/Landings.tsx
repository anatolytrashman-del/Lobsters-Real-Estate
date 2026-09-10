import { BadgeCheck, Clock, ExternalLink, Globe } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { MINSK_MIR_TOPIC_SLUGS, MINSK_MIR_TOPIC_LABELS, minskMirTopicUrl } from '../data/minskMirTopics';
import type { MinskMirTopicSlug } from '../data/minskMirTopics';

// Что именно дорабатывать на каждой посадочной — заметки для владельца,
// на публичные страницы не попадают.
const MINSK_MIR_TOPIC_ADMIN_NOTES: Record<MinskMirTopicSlug, string> = {
  'biznes-centr':
    'Посадочная под запрос «бизнес-центр Минск Мир»: МФЦ, Dana Center (другой район), офисы на первых этажах, Red One. Доработать: фото, статус стройки МФЦ по мере новостей.',
  kovorking:
    'Посадочная под «коворкинг Минск Мир»: в районе один коворкинг по справочнику, альтернатива — рабочие места в Red One. Доработать: проверить список коворкингов вживую, фото рабочих мест.',
  'kupit-ofis':
    'Посадочная под «купить офис Минск Мир»: живые медианы вторички, первичка от застройщика, кабинеты Red One. Доработать: примеры конкретных лотов, расчёт рассрочки.',
  'arenda-ofisa':
    'Посадочная под «аренда офиса Минск Мир»: ставки за м², дефицит офисов с отделкой, покупка в рассрочку как альтернатива. Доработать: сравнение аренда vs рассрочка в цифрах.',
  'kommercheskie-pomeshcheniya':
    'Посадочная под «коммерческое помещение Минск Мир»: все форматы, продажа и аренда по типам, первичка. Доработать: ссылки на карту конкуренции по нишам, примеры помещений.',
};

// Пока просто информационный список действующих продающих страниц — без
// редактирования (владелец: "без правок, пока только инфа"). Список
// намеренно статический, не из Supabase objects: это не сущность "объект",
// а курируемый список публичных лендингов, среди которых уже есть не
// только объекты (гид по району — обычная контентная страница).
//
// url опционален — запись без него (см. "Бизнес-апартаменты" ниже) это
// ещё не существующая страница, только заявка в план ("заготовка статьи",
// владелец 2026-08-25): не на что ссылаться, карточка не кликается, вместо
// внешней ссылки — статус. status — открытый список в том же духе, что и
// остальные "растущие" поля проекта (не жёсткий enum). 'needs-work'
// ("Требует проработки") — для записей без url вообще. 'in-progress'
// ("В работе", владелец 2026-09-04) — для уже опубликованных страниц
// (url есть, карточка кликается), которые ещё дорабатываются — например,
// "Бизнес-центры Минска" ждут фото от владельца. 'done' ("Готова",
// владелец 2026-09-10) — явная зелёная отметка "полностью готова", не
// просто отсутствие статуса (без status карточка выглядит нейтрально, не
// как явное подтверждение готовности).
interface LandingEntry {
  title: string;
  description: string;
  url?: string;
  status?: 'needs-work' | 'in-progress' | 'done';
}

const LANDING_STATUS_LABEL: Record<NonNullable<LandingEntry['status']>, string> = {
  'needs-work': 'Требует проработки',
  'in-progress': 'В работе',
  done: 'Готова',
};

const LANDINGS: LandingEntry[] = [
  {
    title: 'Хаб «Минск»',
    description: 'Гиды по районам — общий раздел /minsk.',
    url: 'https://redevelopment.pro/minsk',
  },
  {
    title: 'Лендинг комплекса Red One',
    description: 'Продающая страница делового комплекса Red One — планировки, бронирование кабинетов и рабочих мест.',
    url: 'https://redevelopment.pro/minsk/one',
  },
  {
    title: 'Страница про Минск-Мир',
    description: 'Гид и аналитика по офисам и коммерческим помещениям в районе Минск Мир — контентная SEO-страница.',
    url: 'https://redevelopment.pro/minsk/minsk-mir',
    status: 'done',
  },
  {
    title: 'Статья: Бизнес-апартаменты',
    description:
      'Разбор нового для района формата коммерческой недвижимости — чем отличается от офиса и жилых апартаментов, как оформляется, кому подходит. Возможно, будет отдельным лендингом. Нужна фактура от Татьяны Гаврис (налоговый консультант).',
    status: 'needs-work',
  },
  {
    title: 'Бизнес-центры Минска',
    description: 'Справочник бизнес-центров города: адреса, класс, площадь, год постройки — по данным веб-ресерча, фото добавляет владелец.',
    url: 'https://redevelopment.pro/minsk/bcminsk',
    status: 'in-progress',
  },
  // Посадочные под подсказки Google по Минск Миру (аудит поиска 2026-09-07,
  // см. data/minskMirTopics.ts и MinskMirTopicPage.tsx) — опубликованы
  // первой версией, владелец: "нужно будет доработать" — все 'in-progress'.
  ...MINSK_MIR_TOPIC_SLUGS.map(
    (slug): LandingEntry => ({
      title: MINSK_MIR_TOPIC_LABELS[slug],
      description: MINSK_MIR_TOPIC_ADMIN_NOTES[slug],
      url: `https://redevelopment.pro${minskMirTopicUrl(slug)}`,
      status: 'in-progress',
    }),
  ),
  {
    title: 'Хаб «Бизнес-центры у метро»',
    description:
      'Пример: /minsk/bcminsk/metro/molodezhnaya — карточки БЦ в радиусе 1,5 км от станции, отсортированы по расстоянию. Ещё 32 такие страницы (по одной на станцию с хотя бы 1 БЦ). Доработать: проверить формулировки FAQ, при желании — свои тексты под ключевые станции (Молодёжная/Академия наук/Пушкинская — самые насыщенные).',
    url: 'https://redevelopment.pro/minsk/bcminsk/metro/molodezhnaya',
    status: 'in-progress',
  },
  {
    title: 'Хаб «Бизнес-центры по улице»',
    description:
      'Пример: /minsk/bcminsk/ulitsa/pr-t-pobediteley — 8 БЦ на проспекте Победителей, самая насыщенная улица каталога. Ещё 22 такие страницы (только улицы с 2+ БЦ — на 69 улицах с одним БЦ хаб не заводился, был бы дублем карточки здания). Доработать: проверить формулировки, при желании — свои тексты под самые крупные улицы (Победителей/Независимости/Дзержинского).',
    url: 'https://redevelopment.pro/minsk/bcminsk/ulitsa/pr-t-pobediteley',
    status: 'in-progress',
  },
  // Раздел «Аналитика рынка» (ANALYTICSPLAN.md, спринты 1-3) — все
  // страницы 'in-progress': методика/охват сегментов ещё дополняются,
  // первичка/ГАБ/квартальный обзор из плана не начаты (нет источника
  // данных на первичку/ГАБ, обзору нужен второй месячный снимок).
  {
    title: 'Хаб «Аналитика рынка»',
    description:
      '/minsk/analytics — сводка по всем живым сегментам (офисы в БЦ, торговые помещения, склады, машиноместа), ссылки на район и на сравнение районов. Доработать: первичка/ГАБ пока без данных (нет источника), квартальный обзор ждёт второй месячный снимок.',
    url: 'https://redevelopment.pro/minsk/analytics',
    status: 'in-progress',
  },
  {
    title: 'Методика аналитики рынка',
    description: '/minsk/analytics/metodika — источники, дедупликация, пороги достаточности выборки, обновление раз в месяц.',
    url: 'https://redevelopment.pro/minsk/analytics/metodika',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: офисы в БЦ',
    description:
      'Ставки аренды и цены продажи по классам A/B+/B/C и районам, сравнение с «Твоей столицей» и Colliers. /minsk/analytics/ofisy/arenda и /prodazha.',
    url: 'https://redevelopment.pro/minsk/analytics/ofisy/arenda',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: торговые помещения',
    description:
      'Ставки аренды и цены продажи по районам и типу здания, city-wide (Kufar + Realt, с дедупликацией). /minsk/analytics/torgovye/arenda и /prodazha.',
    url: 'https://redevelopment.pro/minsk/analytics/torgovye/arenda',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: склады',
    description:
      'Ставки аренды и цены продажи складов по районам, city-wide (Kufar + Realt). Без разбивки по типу здания — у складов оно почти всегда не заполнено источниками. /minsk/analytics/sklady/arenda и /prodazha.',
    url: 'https://redevelopment.pro/minsk/analytics/sklady/arenda',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: машиноместа и паркинги',
    description:
      'Цена за объект целиком (не за м²) по районам и типу парковки — только Kufar (у Realt нет поля, отличающего машиноместо от гаража-бокса). /minsk/analytics/mashinomesta/arenda и /prodazha.',
    url: 'https://redevelopment.pro/minsk/analytics/mashinomesta/arenda',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: Минск Мир',
    description: 'Первичный и вторичный рынок конкретно в Минск Мире — /minsk/analytics/minsk-mir.',
    url: 'https://redevelopment.pro/minsk/analytics/minsk-mir',
    status: 'in-progress',
  },
  {
    title: 'Аналитика: районы Минска',
    description:
      'Сравнение медианной ставки аренды по административным районам сразу по трём сегментам (офисы в БЦ / торговля / склады) — /minsk/analytics/rajony. Машиноместа не в этой таблице — там другая единица цены (за объект, не за м²).',
    url: 'https://redevelopment.pro/minsk/analytics/rajony',
    status: 'in-progress',
  },
];

export function Landings() {
  return (
    <>
      <PageHeader title="Лендинги" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LANDINGS.map((l) => {
          const content = (
            <>
              <div className="flex items-center justify-between gap-2">
                {l.url ? (
                  <div className="flex min-w-0 items-center gap-2 text-ink-muted">
                    <Globe className="h-4 w-4 shrink-0" />
                    <span className="truncate text-xs">{l.url.replace('https://', '')}</span>
                  </div>
                ) : (
                  <span className="text-xs text-ink-faint">Страницы ещё нет</span>
                )}
                {l.status &&
                  (l.status === 'done' ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-success/30 bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success">
                      <BadgeCheck className="h-3 w-3 shrink-0" />
                      {LANDING_STATUS_LABEL[l.status]}
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-warning/30 bg-warning-bg px-2 py-0.5 text-[11px] font-semibold text-warning">
                      <Clock className="h-3 w-3 shrink-0" />
                      {LANDING_STATUS_LABEL[l.status]}
                    </span>
                  ))}
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-ink">{l.title}</span>
                {l.url && <ExternalLink className="h-4 w-4 shrink-0 text-ink-faint" />}
              </div>
              <p className="text-sm text-ink-muted">{l.description}</p>
            </>
          );

          return l.url ? (
            <a
              key={l.title}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn('flex flex-col gap-3 p-4 transition-colors hover:border-primary/40', glassCardClass)}
              style={glassCardShadow}
            >
              {content}
            </a>
          ) : (
            <div key={l.title} className={cn('flex flex-col gap-3 p-4', glassCardClass)} style={glassCardShadow}>
              {content}
            </div>
          );
        })}
      </div>
    </>
  );
}
