import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Building2, Landmark, Store, Briefcase, KeyRound, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import {
  setGenericPageMeta,
  setArticleJsonLd,
  setBreadcrumbJsonLd,
  setFaqJsonLd,
  setNoIndex,
  clearNoIndex,
} from '../lib/pageMeta';
import { fetchPublicMarketOffers } from '../lib/marketOffersApi';
import { fetchPrimaryMarketOffers } from '../lib/primaryMarketOffersApi';
import { buildPrimaryMarketPivot } from '../data/primaryMarketOffers';
import type { PrimaryMarketOffer } from '../data/primaryMarketOffers';
import { netPricePerSqm, netSize } from '../data/marketOffers';
import type { MarketOffer } from '../data/marketOffers';
import { PRICE_PER_METER, WORKSTATION_PRICE, DOWN_PAYMENT_RATE } from '../data/buildingPlans';
import {
  MINSK_MIR_TOPIC_SLUGS,
  MINSK_MIR_TOPIC_LABELS,
  isMinskMirTopicSlug,
  minskMirTopicUrl,
} from '../data/minskMirTopics';
import type { MinskMirTopicSlug } from '../data/minskMirTopics';
import { FaqAccordion } from '../components/ui/FaqAccordion';
import type { FaqItem } from '../components/ui/FaqAccordion';

// Посадочные под подсказки Google по Минск Миру (аудит поиска 2026-09-07,
// см. data/minskMirTopics.ts). Один компонент на все темы: у каждой свой
// title/H1/тексты/FAQ (TOPICS ниже), общие — шапка, живые цифры рынка из
// тех же таблиц, что и гид (public_market_offers / primary_market_offers),
// карточка Red One и перелинковка. Правило контента то же, что и на гиде:
// ни одной выдуманной цифры — всё либо считается из базы на рендере, либо
// уже есть в карточках каталога/гида (МФЦ, Red One).
//
// Red One: диапазон площадей кабинетов — те же 11–40 м², что в H1 лендинга
// (MIN_ROOM_AREA/MAX_ROOM_AREA в ObjectLandingPage.tsx, локальные там
// константы); цена за м² и рабочее место — общие константы buildingPlans.
const RED_ONE_MIN_AREA = 11;
const RED_ONE_MAX_AREA = 40;
const RED_ONE_URL = '/minsk/one';
const GUIDE_URL = '/minsk/minsk-mir';
const CATALOG_URL = '/minsk/bcminsk';
const SITE = 'https://redevelopment.pro';
const DATE_PUBLISHED = '2026-09-07';

function formatMoney(value: number): string {
  return `$${value.toLocaleString('ru-RU').replace(/ /g, ' ')}`;
}

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

function formatLatestUpdate(offers: MarketOffer[]): string {
  const latest = offers.reduce((max, o) => (o.updatedAt > max ? o.updatedAt : max), offers[0].updatedAt);
  const date = new Date(latest);
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

interface MarketCell {
  count: number;
  medianPrice: number;
}

interface MarketSummaryRow {
  propertyType: string;
  finished: MarketCell | null;
  bare: MarketCell | null;
}

// Та же выборка, что и в таблице «Вторичный рынок» гида (reviewed && !rejected,
// цена за чистый м² без террасы), только без разбивки по площади — на
// посадочной нужен один ориентир «сколько стоит», а не полная матрица.
function summarizeMarket(offers: MarketOffer[], dealType: 'sale' | 'rent', propertyTypes: string[]): MarketSummaryRow[] {
  return propertyTypes
    .map((propertyType) => {
      const pick = (finish: string) => {
        const prices = offers
          .filter(
            (o) =>
              o.reviewed && !o.rejected && o.dealType === dealType && o.propertyType === propertyType && o.finishStatus === finish,
          )
          .map(netPricePerSqm);
        return prices.length > 0 ? { count: prices.length, medianPrice: Math.round(median(prices)) } : null;
      };
      return { propertyType, finished: pick('с отделкой'), bare: pick('без отделки') };
    })
    .filter((row) => row.finished || row.bare);
}

function countSmallFinishedOffices(offers: MarketOffer[], dealType: 'sale' | 'rent'): number {
  return offers.filter(
    (o) =>
      o.reviewed && !o.rejected && o.dealType === dealType && o.propertyType === 'Офисы' && netSize(o) < 40 && o.finishStatus === 'с отделкой',
  ).length;
}

function pluralOffers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} объявление`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} объявления`;
  return `${n} объявлений`;
}

function MarketSummaryTable({
  title,
  unit,
  rows,
  updated,
}: {
  title: string;
  unit: string;
  rows: MarketSummaryRow[];
  updated: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-bold text-ink">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="py-2 pr-4 font-semibold">Тип помещения</th>
              <th className="py-2 pr-4 font-semibold">С отделкой</th>
              <th className="py-2 font-semibold">Без отделки</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.propertyType}>
                <td className="py-2 pr-4 font-medium text-ink">{row.propertyType}</td>
                {[row.finished, row.bare].map((cell, i) => (
                  <td key={i} className="py-2 pr-4 text-ink">
                    {cell ? (
                      <>
                        <span className="font-semibold">
                          ${cell.medianPrice.toLocaleString('ru-RU')} {unit}
                        </span>
                        <span className="block text-xs text-ink-muted">{pluralOffers(cell.count)}</span>
                      </>
                    ) : (
                      <span className="text-ink-muted">нет предложений</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        Медиана по проверенным объявлениям Kufar и Realt, {updated}. Полная разбивка по площадям — в{' '}
        <Link to={`${GUIDE_URL}#market`} className="font-semibold text-primary-hover hover:underline">
          таблице вторичного рынка
        </Link>{' '}
        гида по району.
      </p>
    </div>
  );
}

function PrimaryMarketTable({ offers, keys }: { offers: PrimaryMarketOffer[]; keys: string[] }) {
  const rows = buildPrimaryMarketPivot(offers).filter((r) => keys.includes(r.key));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-bold text-ink">Первичный рынок — напрямую от застройщика</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Первичный рынок Минск Мира</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="py-2 pr-4 font-semibold">Формат</th>
              <th className="py-2 pr-4 font-semibold">Предложений</th>
              <th className="py-2 pr-4 font-semibold">Площадь</th>
              <th className="py-2 font-semibold">€ за м²</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-2 pr-4 font-medium text-ink">{r.label}</td>
                <td className="py-2 pr-4 text-ink">{r.count}</td>
                <td className="py-2 pr-4 text-ink">
                  {r.areaMin}–{r.areaMax} м²
                </td>
                <td className="py-2 text-ink">
                  {r.priceMinEur.toLocaleString('ru-RU')}–{r.priceMaxEur.toLocaleString('ru-RU')}{' '}
                  <span className="text-xs text-ink-muted">(в среднем {r.priceAvgEur.toLocaleString('ru-RU')})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        По предложениям застройщика на bir.by, цена за чистый м² без террас. Подробнее — в разделе{' '}
        <Link to={`${GUIDE_URL}#primary-market`} className="font-semibold text-primary-hover hover:underline">
          «Первичный рынок»
        </Link>{' '}
        гида.
      </p>
    </div>
  );
}

function RedOneCard({ lead }: { lead: string }) {
  return (
    <div className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 shrink-0 text-ink" />
        <h2 className="text-lg font-bold text-ink">Red One — кабинеты и рабочие места в собственность</h2>
      </div>
      <p className="text-sm leading-relaxed text-ink-muted">{lead}</p>
      <ul className="grid grid-cols-1 gap-2 text-sm text-ink sm:grid-cols-2">
        <li>
          Кабинеты {RED_ONE_MIN_AREA}–{RED_ONE_MAX_AREA} м² с дизайнерской отделкой
        </li>
        <li>
          {formatMoney(PRICE_PER_METER)} за м², первый взнос {Math.round(DOWN_PAYMENT_RATE * 100)}% — рассрочка, лизинг или
          кредит
        </li>
        <li>Фиксированное рабочее место — от {formatMoney(WORKSTATION_PRICE)}</li>
        <li>Собственное здание на ул. Полтавской, 10, по соседству с районом: доступ 24/7, парковка</li>
      </ul>
      <Link to={RED_ONE_URL} className="w-fit text-sm font-semibold text-primary-hover hover:underline">
        Выбрать кабинет на плане и забронировать онлайн без предоплаты →
      </Link>
    </div>
  );
}

interface TopicSection {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
}

interface TopicContent {
  title: string;
  description: string;
  h1: string;
  intro: ReactNode;
  sections: TopicSection[];
  // Какие живые данные показывать под текстом.
  market?: { sale?: string[]; rent?: string[]; primaryKeys?: string[] };
  redOneLead: string;
  faq: FaqItem[];
}

const guideLink = (hash: string, text: string) => (
  <Link to={`${GUIDE_URL}#${hash}`} className="font-semibold text-primary-hover hover:underline">
    {text}
  </Link>
);

const TOPICS: Record<MinskMirTopicSlug, TopicContent> = {
  'biznes-centr': {
    title: 'Бизнес-центр Минск Мир — какие есть, что строится, где взять офис',
    description:
      'Бизнес-центры в районе Минск Мир: строящийся Международный финансовый центр, офисы на первых этажах и деловой центр Red One рядом с районом. Что реально доступно сейчас.',
    h1: 'Бизнес-центр Минск Мир: что есть сейчас и что строится',
    intro: (
      <>
        Классический бизнес-центр в самом Минск Мире пока один — Минский международный финансовый центр, и он ещё
        строится. Офисы в районе сегодня — это помещения на первых этажах жилых домов и деловой центр Red One по
        соседству. Ниже — что именно доступно, по каким ценам и где смотреть дальше.
      </>
    ),
    sections: [
      {
        icon: Landmark,
        title: 'Минский международный финансовый центр (МФЦ)',
        body: (
          <>
            Единственный бизнес-центр внутри района: класс A, около 97 000 м² общей площади, пять корпусов, главный —
            42-этажная башня на проспекте Мира. Застройщик — «Дана Астра» (Dana Holdings), строительство идёт с 2022
            года, плановая сдача — конец 2027 года. Пока здание не введено, арендовать или купить офис в нём нельзя —
            подробности и статус стройки в{' '}
            <Link to="/minsk/bcminsk/mfc-minsk-mir" className="font-semibold text-primary-hover hover:underline">
              карточке МФЦ
            </Link>
            .
          </>
        ),
      },
      {
        icon: Building2,
        title: 'Готовые бизнес-центры того же застройщика',
        body: (
          <>
            Ближайший действующий БЦ Dana Holdings —{' '}
            <Link to="/minsk/bcminsk/dana-center" className="font-semibold text-primary-hover hover:underline">
              Dana Center
            </Link>{' '}
            (класс B+, 23 000 м²), но он в «Маяке Минска» у метро «Восток», а не в Минск Мире. Все бизнес-центры
            города с классом, площадью, метро и объявлениями — в{' '}
            <Link to={CATALOG_URL} className="font-semibold text-primary-hover hover:underline">
              каталоге бизнес-центров Минска
            </Link>
            , а МФЦ вместе с другими стройками города — на странице{' '}
            <Link to={`${CATALOG_URL}/stroyashchiesya`} className="font-semibold text-primary-hover hover:underline">
              строящихся бизнес-центров
            </Link>
            .
          </>
        ),
      },
      {
        icon: Briefcase,
        title: 'Где взять офис в Минск Мире, пока МФЦ строится',
        body: (
          <>
            Два реальных варианта: помещения на первых этажах жилых домов (продажа и аренда через объявления,
            чаще без отделки — актуальные медианы ниже) и деловой центр Red One рядом с районом — небольшие кабинеты
            с готовой отделкой в собственность. Общая картина по форматам — в{' '}
            {guideLink('property-types', 'гиде по коммерческой недвижимости Минск Мира')}.
          </>
        ),
      },
    ],
    market: { rent: ['Офисы'], sale: ['Офисы'] },
    redOneLead:
      'Пока единственный бизнес-центр района строится, компактный офис с отделкой можно купить в Red One — собственном здании рядом с Минск Миром.',
    faq: [
      {
        question: 'Есть ли в Минск Мире бизнес-центр?',
        answer:
          'Действующего классического бизнес-центра в районе пока нет. Единственный — Минский международный финансовый центр (класс A, около 97 000 м²) — строится, плановая сдача в конце 2027 года. Офисы сейчас — на первых этажах жилых домов и в деловом центре Red One по соседству.',
      },
      {
        question: 'Когда откроется Международный финансовый центр в Минск Мире?',
        answer:
          'По плану застройщика («Дана Астра», Dana Holdings) — конец 2027 года. Строительство идёт с июля 2022 года; главный корпус — 42-этажная башня высотой около 168 м. Актуальный статус стройки мы ведём в карточке МФЦ в каталоге бизнес-центров.',
      },
      {
        question: 'Dana Center — это бизнес-центр в Минск Мире?',
        answer:
          'Нет. Dana Center того же застройщика находится на ул. Петра Мстиславца, 9 — это «Маяк Минска» у метро «Восток», другой район города. В Минск Мире у Dana Holdings пока только строящийся МФЦ.',
      },
      {
        question: 'Где найти небольшой офис с отделкой рядом с Минск Миром?',
        answer:
          'На вторичном рынке района небольших офисов до 40 м² с готовой отделкой единицы. Такой формат предлагает деловой центр Red One рядом с районом: кабинеты от 11 до 40 м² с дизайнерской отделкой в собственность, с рассрочкой, лизингом или кредитом, и фиксированные рабочие места.',
      },
    ],
  },

  kovorking: {
    title: 'Коворкинг в Минск Мире — что есть в районе и какая альтернатива',
    description:
      'Коворкинги в районе Минск Мир: что реально работает, почему сетевых коворкингов в районе нет, и как получить фиксированное рабочее место в собственность в Red One.',
    h1: 'Коворкинг в Минск Мире: что есть и что вместо него',
    intro: (
      <>
        Минск Мир — жилой район с 80 000 жителей, ядро которых — специалисты 25–45 лет, но классических коворкингов
        с почасовой или помесячной арендой стола здесь почти нет. Рассказываем, что есть по факту, и какой формат
        закрывает ту же потребность — своё рабочее место рядом с домом.
      </>
    ),
    sections: [
      {
        icon: Users,
        title: 'Что есть в районе сейчас',
        body: (
          <>
            По нашему справочнику организаций Минск Мира (собирается по домам и обновляется ежемесячно) в формате
            коворкинга работает кофейня-коворкинг «Пространство» на ул. Белградской, 4. Сетевых коворкингов с
            переговорными, ресепшен и абонементами на рабочее место в районе нет — они сосредоточены в центре
            Минска. Полная картина по нишам — в разделе{' '}
            {guideLink('business-analytics', 'аналитики по сферам бизнеса')} гида.
          </>
        ),
      },
      {
        icon: Briefcase,
        title: 'Почему коворкинг в спальном районе не появляется сам',
        body: (
          <>
            Коворкингу нужны большие открытые площади с отделкой, а именно готовых офисных помещений в районе
            дефицит: подавляющая часть офисов на вторичном рынке продаётся и сдаётся без отделки (см. цифры ниже).
            Единственный бизнес-центр района — МФЦ — ещё строится, подробнее на странице{' '}
            <Link to={minskMirTopicUrl('biznes-centr')} className="font-semibold text-primary-hover hover:underline">
              о бизнес-центрах Минск Мира
            </Link>
            .
          </>
        ),
      },
      {
        icon: KeyRound,
        title: 'Альтернатива: своё рабочее место, а не абонемент',
        body: (
          <>
            Red One — деловой центр по соседству с районом, где фиксированное рабочее место или небольшой кабинет
            покупается в собственность, а не арендуется помесячно: доступ 24/7, парковка, общие санузлы и кухни, как в
            коворкинге, но место закреплено за вами навсегда и не дорожает с каждым продлением.
          </>
        ),
      },
    ],
    market: { rent: ['Офисы'] },
    redOneLead:
      'Если коворкинг нужен как постоянное место работы рядом с домом, а не на пару дней, — считайте покупку рабочего места: платёж фиксирован, а место остаётся вашим.',
    faq: [
      {
        question: 'Есть ли коворкинг в Минск Мире?',
        answer:
          'Сетевых коворкингов в районе нет. По справочнику организаций района в формате коворкинга работает кофейня-коворкинг «Пространство» на ул. Белградской, 4. Ближайшая альтернатива с постоянным местом — фиксированные рабочие места в деловом центре Red One рядом с районом.',
      },
      {
        question: 'Сколько стоит рабочее место в Red One?',
        answer: `Фиксированное рабочее место — от ${formatMoney(WORKSTATION_PRICE)} в собственность (не помесячная аренда), кабинеты от 11 до 40 м² — ${formatMoney(PRICE_PER_METER)} за м². Доступны рассрочка, лизинг и кредит, первый взнос ${Math.round(DOWN_PAYMENT_RATE * 100)}%.`,
      },
      {
        question: 'Чем рабочее место в собственность отличается от коворкинга?',
        answer:
          'В коворкинге вы платите абонемент каждый месяц и место не ваше. В Red One рабочее место или кабинет покупаются: платёж фиксирован в договоре, место закреплено за вами, его можно сдать или продать. Общая инфраструктура — санузлы, кухни, парковка, доступ 24/7 — как в коворкинге.',
      },
      {
        question: 'Появятся ли коворкинги в Минск Мире после запуска МФЦ?',
        answer:
          'Международный финансовый центр планируется к сдаче в конце 2027 года и рассчитан на крупные офисы класса A. Появятся ли в нём коворкинги, застройщик не объявлял — мы следим за статусом в карточке МФЦ в каталоге бизнес-центров.',
      },
    ],
  },

  'kupit-ofis': {
    title: 'Купить офис в Минск Мире — цены за м², первичка и вторичка',
    description:
      'Купить офис в Минск Мире: медианные цены за м² по проверенным объявлениям, предложения застройщика, дефицит небольших офисов с отделкой и кабинеты в собственность в Red One.',
    h1: 'Купить офис в Минск Мире: цены и что реально продаётся',
    intro: (
      <>
        Офис в Минск Мире можно купить тремя способами: у застройщика на первичном рынке, у собственника на
        вторичном или готовый кабинет с отделкой в деловом центре Red One рядом с районом. Ниже — живые цены по
        каждому варианту, посчитанные по объявлениям, а не оценки «на глаз».
      </>
    ),
    sections: [
      {
        icon: Store,
        title: 'Что продаётся на вторичном рынке',
        body: (
          <>
            Большинство офисов на продажу в районе — без отделки: голый бетон на первом этаже жилого дома, который
            ещё предстоит доводить до рабочего состояния. Готовые к въезду небольшие офисы встречаются единично, и
            это устойчивая особенность района, а не сезонность — подробнее в{' '}
            {guideLink('market', 'сводке вторичного рынка')} гида.
          </>
        ),
      },
      {
        icon: Landmark,
        title: 'Первичный рынок: офисы от застройщика',
        body: (
          <>
            «Дана Астра» продаёт офисы и бизнес-апартаменты напрямую через bir.by — цены за чистый м² ниже в таблице.
            Отдельный формат — бизнес-апартаменты с правом регистрации и юридического адреса, разбор плюсов и минусов —
            в разделе {guideLink('business-apartments', '«Бизнес-апартаменты»')} гида.
          </>
        ),
      },
      {
        icon: KeyRound,
        title: 'Готовый кабинет в собственность',
        body: (
          <>
            Red One — собственное здание по соседству с районом, где продаются кабинеты {RED_ONE_MIN_AREA}–
            {RED_ONE_MAX_AREA} м² с дизайнерской отделкой по {formatMoney(PRICE_PER_METER)} за м²: выбираете кабинет
            на плане, бронируете онлайн без предоплаты, подписываете соглашение о намерениях кодом из email.
          </>
        ),
      },
    ],
    market: { sale: ['Офисы'], primaryKeys: ['offices', 'apartments-sdano', 'apartments-stroitsya'] },
    redOneLead:
      'Если нужен готовый небольшой офис в собственность, а не бетон под ремонт — это Red One: кабинет с отделкой, рассрочка и онлайн-бронь.',
    faq: [
      {
        question: 'Сколько стоит купить офис в Минск Мире?',
        answer:
          'Ориентир — медианная цена за м² по проверенным объявлениям Kufar и Realt в таблице на этой странице, отдельно для офисов с отделкой и без. У застройщика цены указаны за чистый м² в евро. В Red One кабинеты продаются по фиксированной ставке $2 100 за м² с готовой отделкой.',
      },
      {
        question: 'Можно ли купить офис в Минск Мире в рассрочку?',
        answer: `В Red One — да: первый взнос ${Math.round(DOWN_PAYMENT_RATE * 100)}%, далее рассрочка, лизинг или кредит на выбор. Условия застройщика на первичном рынке — на bir.by, они меняются по акциям.`,
      },
      {
        question: 'Есть ли в Минск Мире небольшие офисы с отделкой на продажу?',
        answer:
          'На вторичном рынке района офисы до 40 м² с готовой отделкой встречаются единично — точное число на этот месяц показано на странице. Именно этот дефицит закрывает Red One: кабинеты от 11 до 40 м² с отделкой под ключ.',
      },
      {
        question: 'Офис или бизнес-апартаменты — что выбрать для регистрации компании?',
        answer:
          'Бизнес-апартаменты в Минск Мире дают право регистрации юрлица и прописки по одному адресу, но коммуналка начисляется по тарифу для юрлиц. Обычный офис — нежилое помещение без права прописки. Кабинет в Red One — нежилое помещение с юридическим адресом для компании.',
      },
    ],
  },

  'arenda-ofisa': {
    title: 'Аренда офиса в Минск Мире — ставки за м², что сдаётся',
    description:
      'Аренда офиса в Минск Мире: медианные ставки за м² по проверенным объявлениям, почему почти все офисы сдаются без отделки, и как получить кабинет с отделкой рядом с районом.',
    h1: 'Аренда офиса в Минск Мире: ставки и что сдаётся',
    intro: (
      <>
        Аренда офиса в Минск Мире — это в основном помещения на первых этажах жилых домов, чаще всего без отделки.
        Готовых кабинетов под ключ в аренду в районе почти нет. Ниже — актуальные ставки по объявлениям и вариант,
        который закрывает этот дефицит.
      </>
    ),
    sections: [
      {
        icon: Store,
        title: 'Какие офисы сдаются',
        body: (
          <>
            Основное предложение — помещения без отделки: арендатор сам делает ремонт и, как правило, получает за это
            арендные каникулы. Офисы с готовой отделкой площадью до 40 м² — единичные предложения на весь район.
            Полная матрица ставок по площадям и типам помещений — в {guideLink('market', 'таблице вторичного рынка')}.
          </>
        ),
      },
      {
        icon: Users,
        title: 'Кому нужен офис именно здесь',
        body: (
          <>
            Около 80 000 жителей, плотность в 7,5 раза выше средней по Минску, две станции метро, Avia Mall и
            строящийся финансовый центр — офис в районе нужен тем, кто работает с местными жителями: нотариусам,
            агентствам, IT-командам, у которых сотрудники живут рядом. Портрет аудитории — в разделе{' '}
            {guideLink('audience', '«Целевая аудитория»')} гида.
          </>
        ),
      },
      {
        icon: KeyRound,
        title: 'Альтернатива аренде: кабинет в собственность в рассрочку',
        body: (
          <>
            В Red One рядом с районом кабинеты {RED_ONE_MIN_AREA}–{RED_ONE_MAX_AREA} м² с готовой отделкой не
            арендуются, а покупаются: первый взнос {Math.round(DOWN_PAYMENT_RATE * 100)}%, дальше рассрочка, лизинг или
            кредит. Для тех, кто планирует работать в районе дольше двух-трёх лет, это замена бессрочной аренде с
            ежегодной индексацией.
          </>
        ),
      },
    ],
    market: { rent: ['Офисы', 'Торговые помещения'] },
    redOneLead:
      'Вместо аренды без отделки с ремонтом за свой счёт — готовый кабинет в собственность с фиксированным платежом.',
    faq: [
      {
        question: 'Сколько стоит аренда офиса в Минск Мире?',
        answer:
          'Медианная ставка за м² в месяц по проверенным объявлениям Kufar и Realt показана в таблице на этой странице — отдельно для офисов с отделкой и без, они различаются заметно. Данные обновляются ежемесячно.',
      },
      {
        question: 'Можно ли снять в Минск Мире небольшой офис с отделкой?',
        answer:
          'Редко: таких предложений до 40 м² в районе единицы, их число на текущий месяц показано на странице. Большинство офисов сдаётся без отделки. Готовые кабинеты 11–40 м² есть в Red One рядом с районом, но там они продаются, а не сдаются.',
      },
      {
        question: 'Сдаются ли офисы в Международном финансовом центре?',
        answer:
          'Пока нет — МФЦ строится, плановая сдача в конце 2027 года. До этого офисная аренда в районе — только первые этажи жилых домов.',
      },
      {
        question: 'Что выгоднее в Минск Мире — аренда или покупка офиса?',
        answer:
          'Зависит от горизонта. На год-два — аренда, но с ремонтом за свой счёт, если помещение без отделки. На дольше — покупка в рассрочку: в Red One платёж фиксирован в договоре, а кабинет остаётся активом, который можно сдать или продать.',
      },
    ],
  },

  'kommercheskie-pomeshcheniya': {
    title: 'Коммерческие помещения в Минск Мире — цены продажи и аренды',
    description:
      'Коммерческие помещения в Минск Мире: торговые, офисные, кладовые, бизнес-апартаменты. Медианные цены продажи и аренды за м² по проверенным объявлениям и предложения застройщика.',
    h1: 'Коммерческие помещения в Минск Мире: форматы и цены',
    intro: (
      <>
        Минск Мир — самый плотный жилой район Минска, и коммерческие помещения здесь — это в первую очередь первые
        этажи жилых домов: торговля, услуги, офисы, кладовые. Ниже — какие форматы существуют, что продаётся и
        сдаётся прямо сейчас и по каким ценам.
      </>
    ),
    sections: [
      {
        icon: Store,
        title: 'Какие форматы есть',
        body: (
          <>
            Торговые помещения с отдельным входом и витриной, офисные помещения, кладовые, бизнес-апартаменты с
            правом регистрации, машиноместа в паркингах, площади в Avia Mall и — после сдачи — офисы в МФЦ. Разбор
            каждого формата — в разделе {guideLink('property-types', '«Виды коммерческой недвижимости»')} гида.
          </>
        ),
      },
      {
        icon: Users,
        title: 'Кто арендует и покупает',
        body: (
          <>
            Основной спрос — стрит-ритейл и сервисы для 80 000 жителей: продукты, аптеки, бьюти, общепит, пункты
            выдачи, детские и медицинские центры. Какие ниши уже перенасыщены в конкретном квартале, а где ещё
            свободно, показывает {guideLink('quarter-map', 'карта конкуренции по кварталам')}.
          </>
        ),
      },
      {
        icon: Briefcase,
        title: 'Офисы: отдельная история',
        body: (
          <>
            Офисный сегмент в районе самый тонкий: бизнес-центр один и строится, готовых небольших офисов почти нет.
            Подробнее — на страницах{' '}
            <Link to={minskMirTopicUrl('kupit-ofis')} className="font-semibold text-primary-hover hover:underline">
              «Купить офис»
            </Link>{' '}
            и{' '}
            <Link to={minskMirTopicUrl('arenda-ofisa')} className="font-semibold text-primary-hover hover:underline">
              «Аренда офиса»
            </Link>
            .
          </>
        ),
      },
    ],
    market: {
      sale: ['Торговые помещения', 'Офисы', 'Кладовые'],
      rent: ['Торговые помещения', 'Офисы', 'Кладовые'],
      primaryKeys: ['retail', 'offices', 'pantry', 'apartments-sdano', 'apartments-stroitsya'],
    },
    redOneLead:
      'Для тех, кому нужен не торговый зал, а компактный офис с отделкой — кабинеты и рабочие места в Red One рядом с районом.',
    faq: [
      {
        question: 'Какие коммерческие помещения продаются в Минск Мире?',
        answer:
          'Торговые помещения на первых этажах, офисы, кладовые, бизнес-апартаменты и машиноместа. У застройщика — на первичном рынке через bir.by, у собственников — в объявлениях на Kufar и Realt. Актуальные цены за м² по каждому формату показаны на этой странице.',
      },
      {
        question: 'Сколько стоит коммерческое помещение в Минск Мире за м²?',
        answer:
          'Медианные цены продажи и аренды за м² по проверенным объявлениям — в таблицах на этой странице, раздельно для помещений с отделкой и без: это разные рынки, и смешивать их в одну цифру некорректно.',
      },
      {
        question: 'Чем торговое помещение отличается от офисного в Минск Мире?',
        answer:
          'Торговое — с отдельным входом с улицы и витриной на пешеходный поток, под магазин, салон или кафе. Офисное — без витрины, часто со входом из подъезда или общего холла. Торговые помещения в районе стоят дороже за м² и их заметно больше в предложении.',
      },
      {
        question: 'Где посмотреть конкуренцию по нишам перед покупкой помещения?',
        answer:
          'В гиде по Минск Миру: раздел «Плотность бизнеса» и карта конкуренции по кварталам показывают, сколько организаций каждой категории уже работает в каждом квартале, по данным справочника, обновляемого ежемесячно.',
      },
    ],
  },
};

const BREADCRUMB_ROOT = [
  { name: 'Коммерческая недвижимость в Минске', url: `${SITE}/minsk` },
  { name: 'Район Минск Мир', url: `${SITE}${GUIDE_URL}` },
];

export function MinskMirTopicPage() {
  const { topic = '' } = useParams();
  const slug = isMinskMirTopicSlug(topic) ? topic : null;
  const content = slug ? TOPICS[slug] : null;

  const [marketOffers, setMarketOffers] = useState<MarketOffer[] | null>(null);
  const [primaryOffers, setPrimaryOffers] = useState<PrimaryMarketOffer[] | null>(null);

  useEffect(() => {
    if (!content || !slug) {
      setNoIndex();
      return () => clearNoIndex();
    }
    const url = `${SITE}${minskMirTopicUrl(slug)}`;
    setGenericPageMeta({ title: content.title, description: content.description, url, ogType: 'article' });
    setArticleJsonLd({
      headline: content.h1,
      description: content.description,
      url,
      datePublished: DATE_PUBLISHED,
      dateModified: DATE_PUBLISHED,
    });
    setBreadcrumbJsonLd([...BREADCRUMB_ROOT, { name: MINSK_MIR_TOPIC_LABELS[slug] }]);
    setFaqJsonLd(content.faq);
    window.scrollTo(0, 0);
  }, [slug, content]);

  useEffect(() => {
    if (!content?.market) return;
    if (content.market.sale || content.market.rent) {
      fetchPublicMarketOffers()
        .then(setMarketOffers)
        .catch(() => setMarketOffers([]));
    }
    if (content.market.primaryKeys) {
      fetchPrimaryMarketOffers()
        .then(setPrimaryOffers)
        .catch(() => setPrimaryOffers([]));
    }
  }, [content]);

  const marketBlocks = useMemo(() => {
    if (!content?.market || !marketOffers || marketOffers.length === 0) return null;
    const updated = formatLatestUpdate(marketOffers);
    const sale = content.market.sale ? summarizeMarket(marketOffers, 'sale', content.market.sale) : [];
    const rent = content.market.rent ? summarizeMarket(marketOffers, 'rent', content.market.rent) : [];
    const showsOffices = [...(content.market.sale ?? []), ...(content.market.rent ?? [])].includes('Офисы');
    return {
      updated,
      sale,
      rent,
      smallSale: showsOffices && content.market.sale ? countSmallFinishedOffices(marketOffers, 'sale') : null,
      smallRent: showsOffices && content.market.rent ? countSmallFinishedOffices(marketOffers, 'rent') : null,
    };
  }, [content, marketOffers]);

  if (!content || !slug) {
    return (
      <div className="min-h-svh bg-bg">
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-16 sm:px-8">
          <h1 className="text-2xl font-extrabold text-ink">Страница не найдена</h1>
          <p className="text-ink-muted">Такой темы по Минск Миру нет.</p>
          <Link to={GUIDE_URL} className="font-semibold text-primary-hover hover:underline">
            Гид по коммерческой недвижимости Минск Мира →
          </Link>
        </main>
      </div>
    );
  }

  const otherTopics = MINSK_MIR_TOPIC_SLUGS.filter((s) => s !== slug);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 sm:px-8">
          <Link to="/minsk" className="shrink-0 text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-ink-muted sm:flex">
            <Link to={GUIDE_URL} className="whitespace-nowrap transition-colors hover:text-ink">
              Гид по району
            </Link>
            <Link to={CATALOG_URL} className="whitespace-nowrap transition-colors hover:text-ink">
              Бизнес-центры
            </Link>
            <Link to={RED_ONE_URL} className="whitespace-nowrap transition-colors hover:text-ink">
              Red One
            </Link>
          </nav>
        </div>
      </div>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-8">
        <nav aria-label="Хлебные крошки" className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <Link to="/minsk" className="hover:text-ink">
            Минск
          </Link>
          <span aria-hidden="true">/</span>
          <Link to={GUIDE_URL} className="hover:text-ink">
            Минск Мир
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-ink">{MINSK_MIR_TOPIC_LABELS[slug]}</span>
        </nav>

        <div className={cn('flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
          <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-3xl">{content.h1}</h1>
          <p className="text-base leading-relaxed text-ink-muted">{content.intro}</p>
        </div>

        <div className={cn('flex flex-col divide-y divide-border', glassCardClass)} style={glassCardShadow}>
          {content.sections.map(({ icon: Icon, title, body }) => (
            <section key={title} className="flex flex-col gap-3 px-6 py-6">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 shrink-0 text-ink" />
                <h2 className="text-lg font-bold text-ink">{title}</h2>
              </div>
              <p className="text-sm leading-relaxed text-ink-muted">{body}</p>
            </section>
          ))}
        </div>

        {content.market && (
          <div className={cn('flex flex-col gap-6 p-6', glassCardClass)} style={glassCardShadow}>
            <h2 className="text-lg font-bold text-ink">Цены в Минск Мире сейчас</h2>
            {marketOffers === null && (content.market.sale || content.market.rent) && (
              <p className="text-sm text-ink-muted">Загружаем объявления…</p>
            )}
            {marketBlocks && marketBlocks.sale.length > 0 && (
              <MarketSummaryTable title="Продажа — медианная цена за м²" unit="за м²" rows={marketBlocks.sale} updated={marketBlocks.updated} />
            )}
            {marketBlocks && marketBlocks.rent.length > 0 && (
              <MarketSummaryTable title="Аренда — медианная ставка за м² в месяц" unit="за м² в месяц" rows={marketBlocks.rent} updated={marketBlocks.updated} />
            )}
            {marketBlocks && (marketBlocks.smallSale !== null || marketBlocks.smallRent !== null) && (
              <p className="rounded-control border border-border bg-surface px-4 py-3 text-sm text-ink">
                Небольших офисов до 40 м² с готовой отделкой в объявлениях сейчас:{' '}
                {marketBlocks.smallSale !== null && (
                  <>
                    на продажу — <strong>{marketBlocks.smallSale}</strong>
                  </>
                )}
                {marketBlocks.smallSale !== null && marketBlocks.smallRent !== null && ', '}
                {marketBlocks.smallRent !== null && (
                  <>
                    в аренду — <strong>{marketBlocks.smallRent}</strong>
                  </>
                )}
                . Это структурный дефицит формата в районе, а не сезонное колебание.
              </p>
            )}
            {marketOffers !== null && marketOffers.length === 0 && (
              <p className="text-sm text-ink-muted">Данные по объявлениям пока не собраны.</p>
            )}
            {content.market.primaryKeys && primaryOffers && primaryOffers.length > 0 && (
              <PrimaryMarketTable offers={primaryOffers} keys={content.market.primaryKeys} />
            )}
          </div>
        )}

        <RedOneCard lead={content.redOneLead} />

        <FaqAccordion title="Частые вопросы" items={content.faq} id="faq" />

        <div className={cn('flex flex-col gap-3 p-6', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-lg font-bold text-ink">Ещё по Минск Миру</h2>
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link to={GUIDE_URL} className="flex items-center gap-2 font-semibold text-ink hover:text-primary-hover">
                <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                Гид по коммерческой недвижимости Минск Мира — полная картина района
              </Link>
            </li>
            {otherTopics.map((s) => (
              <li key={s}>
                <Link to={minskMirTopicUrl(s)} className="flex items-center gap-2 text-ink hover:text-primary-hover">
                  <ArrowRight className="h-4 w-4 shrink-0 text-ink-faint" />
                  {MINSK_MIR_TOPIC_LABELS[s]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
