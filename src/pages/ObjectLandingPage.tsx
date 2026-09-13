import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Bath,
  Briefcase,
  Building2,
  CalendarClock,
  Cctv,
  Clock,
  Landmark,
  Loader2,
  Ruler,
  ShieldCheck,
  Sparkles,
  SquareParking,
  TreePine,
  TrendingUp,
  Wifi,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import type { LucideIcon } from 'lucide-react';
import { HeroImageSlider } from '../components/objects/HeroImageSlider';
import { PublicPlanAndUnits } from '../components/objects/PublicPlanAndUnits';
import { BookingTermsCard } from '../components/objects/BookingTermsCard';
import { FaqCard, FAQ_ITEMS } from '../components/objects/FaqCard';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { zonePrice, WORKSTATION_PRICE, PRICE_PER_METER, RENT_WORKSTATION_PRICE } from '../data/buildingPlans';
import type { BuildingPlan, BuildingPlanZone, DealMode } from '../data/buildingPlans';
import type { RealtyObject } from '../data/objects';
import { fetchObjectByLandingSlug } from '../lib/objectsApi';
import { fetchBuildingPlans, fetchZonesForPlan } from '../lib/buildingPlansApi';
import { setObjectPageMeta, setNoIndex, clearNoIndex, setFaqJsonLd } from '../lib/pageMeta';

function formatMoney(value: number) {
  return `$${Math.round(value).toLocaleString('ru-RU')}`;
}

// Аренда — ежемесячный платёж, не разовая цена владения как при покупке —
// суффикс добавляется везде, где показана денежная сумма в режиме "Аренда"
// (кроме ставки за метр — та уже сама по себе "$X за м²", не итоговая сумма).
function formatDealMoney(dealMode: DealMode, value: number) {
  return dealMode === 'rent' ? `${formatMoney(value)}/мес` : formatMoney(value);
}

// Стартовая цена в заголовке — фиксированный текст под фразу "фиксированные
// рабочие места" (бюджетнее самих кабинетов), не связана с расчётом
// стоимости конкретных кабинетов из zonePrice.
const STARTING_PRICE_FROM = 12000;

// Лого партнёра (ТЦ "Минск Мир") для геометки над слайдером — было прямой
// ссылкой на ibb.co, перезалито в собственное хранилище (тот же файл теперь
// используется и на гайде по району, DistrictGuidePage.tsx — фон вырезан тем
// же приёмом, что и у логотипа Dana Holdings там же).
// PAGESPEED_PLAN.md, Э4-1 — WebP 95×110 (было 171×200 PNG; размер уточнён
// под реальный DPR теста PageSpeed, 1,75, не плоские 2× — см. комментарий у
// DEVELOPER_LOGO_URL в DistrictGuidePage.tsx), тот же файл, что и там.
const MINSK_MIR_LOGO_URL = '/images/district/minsk-mir-logo.webp';

// Логотип Telegram — нарисован инлайн-SVG (фирменный синий кружок с бумажным
// самолётиком), а не скачан картинкой: внешние хосты недоступны из песочницы
// разработки, да и так надёжнее — не зависит от стороннего файла.
function TelegramLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="12" fill="#29A9EB" />
      <path fill="#FFFFFF" d="M5 12.3 18.5 7c.6-.2 1.1.2.9 1.1l-2.3 10.9c-.2.7-.6.9-1.2.6l-3.4-2.5-1.6 1.6c-.2.2-.3.3-.6.3l.2-3.1 5.7-5.1c.2-.2 0-.3-.3-.1l-7 4.4L5 13.7c-.6-.2-.6-.6 0-.9z" />
      <path fill="#B9DCF2" d="m10.5 15.4-.2 3.1c.3 0 .4-.1.6-.3l1.6-1.6-2-1.2z" />
    </svg>
  );
}

const OWNER_TELEGRAM_URL = 'https://t.me/a_trashman';
const OWNER_ONLINE_FROM_HOUR = 9;
const OWNER_ONLINE_TO_HOUR = 23;

// "Онлайн" — по часам собственника в Москве (9:00–23:00), а не по факту
// его присутствия в сети: индикатор просто честно показывает окно, когда
// обычно отвечают, без бэкенда и статуса присутствия.
function isOwnerOnlineNow() {
  const moscowHour = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false }).format(new Date()),
  );
  return moscowHour >= OWNER_ONLINE_FROM_HOUR && moscowHour < OWNER_ONLINE_TO_HOUR;
}

// Пока продающая страница только у одного объекта, оффер и буллеты на
// главном экране — фиксированный текст под него, а не поле в базе.
// Когда появится второй объект с такой страницей — вынести в данные объекта.
const MIN_ROOM_AREA = 11;
const MAX_ROOM_AREA = 40;

// Цена аренды кабинета "от" — такой же фиксированный маркетинговый якорь,
// как и STARTING_PRICE_FROM выше, не через priceForDeal(MIN_ROOM_AREA):
// это цена самого дешёвого варианта аренды, а не 11 м² по ставке за метр.
const RENT_ROOM_PRICE_FROM = 200;

const heroFeatures: { icon: LucideIcon; text: string }[] = [
  { icon: Ruler, text: `Площади от ${MIN_ROOM_AREA} м² до ${MAX_ROOM_AREA} м²` },
  { icon: Sparkles, text: 'Дизайнерский ремонт' },
  { icon: ShieldCheck, text: 'Бесплатная онлайн-бронь' },
];

const complexFeatures: { icon: LucideIcon; text: string }[] = [
  { icon: Building2, text: 'Собственное здание' },
  { icon: Clock, text: 'Доступ 24/7' },
  { icon: Cctv, text: 'Видеонаблюдение' },
  { icon: Bath, text: 'Много санузлов' },
  { icon: SquareParking, text: 'Большая парковка' },
  { icon: Zap, text: 'Все коммуникации' },
  { icon: Wifi, text: 'Телефон и интернет' },
  { icon: TreePine, text: 'Благоустройство' },
];

interface PurchaseOption {
  icon: LucideIcon;
  title: string;
  audience?: string;
  terms?: string;
  description: string;
  badge?: string;
}

// Якорь для 4-го шага BookingTermsCard ("Оплатите") — id продублирован в
// BookingTermsCard.tsx константой с тем же значением (тот же приём, что и
// PLAN_AND_UNITS_ANCHOR_ID в PublicPlanAndUnits.tsx — без кросс-импорта
// между страницей и компонентом).
const PURCHASE_OPTIONS_ANCHOR_ID = 'purchase-options';

const purchaseOptions: PurchaseOption[] = [
  {
    icon: CalendarClock,
    title: 'Рассрочка',
    terms: 'Взнос 25% · Срок 4 месяца',
    description: 'По индивидуальному согласованию.',
    badge: '🇧🇾 🇷🇺',
  },
  {
    icon: Briefcase,
    title: 'Лизинг',
    audience: 'ИП и юрлица',
    terms: 'Взнос от 10% · Срок до 10 лет',
    description: 'Специальные условия на проекты компании Redevelopment.',
  },
  {
    icon: Landmark,
    title: 'Кредит',
    audience: 'ИП и юрлица',
    terms: 'Взнос от 20% · Срок до 20 лет',
    description: 'Финансирование от банков-партнёров.',
  },
];

// Публичная продающая страница объекта под коротким URL (/:slug, см.
// RealtyObject.landingSlug).
export function ObjectLandingPage() {
  const { slug } = useParams();
  const [object, setObject] = useState<RealtyObject | null>(null);
  const [plans, setPlans] = useState<BuildingPlan[]>([]);
  const [zones, setZones] = useState<BuildingPlanZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [ownerOnline, setOwnerOnline] = useState(isOwnerOnlineNow);
  // Покупка или аренда — переключатель в шапке страницы, по умолчанию
  // "Аренда" (владелец, 2026-09-13: "давай по умолчанию делать именно
  // аренду"). Одна и та же вёрстка/данные, только цены и часть блоков
  // меняются в зависимости от режима. Состояние страницы, не роут —
  // пререндер (SEO-снимок) снимается с этим значением по умолчанию.
  const [dealMode, setDealMode] = useState<DealMode>('rent');

  useEffect(() => {
    const timer = setInterval(() => setOwnerOnline(isOwnerOnlineNow()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // title/description/og/canonical/JSON-LD в index.html статически заточены
  // под Red One (см. lib/pageMeta.ts) — здесь подменяются на актуальные для
  // реально открытого объекта, иначе, например, Red Storage выдавал бы в
  // поиске и соцсетях чужой заголовок.
  useEffect(() => {
    if (!slug || !object) return;
    setObjectPageMeta(slug, object, object.renderImageUrls[0]);
  }, [slug, object]);

  // FAQ_ITEMS общий для всех объектов (см. FaqCard.tsx), не зависит от slug —
  // достаточно один раз при монтировании страницы.
  useEffect(() => {
    setFaqJsonLd(FAQ_ITEMS);
  }, []);

  // Soft-404: /:slug (App.tsx) перехватывает любой односегментный путь раньше
  // маршрута "*", поэтому опечатка в ссылке всё равно отдаёт 200. Раз контент
  // не 404, единственный способ не дать боту проиндексировать пустую
  // страницу — явный noindex, пока не найден объект.
  useEffect(() => {
    if (!notFound) return;
    setNoIndex();
    return () => clearNoIndex();
  }, [notFound]);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setNotFound(false);
    fetchObjectByLandingSlug(slug)
      .then(async (obj) => {
        setObject(obj);
        if (obj.buildingPlanIds.length === 0) return;
        const [planList, zoneLists] = await Promise.all([
          fetchBuildingPlans(),
          Promise.all(obj.buildingPlanIds.map((planId) => fetchZonesForPlan(planId))),
        ]);
        setPlans(planList);
        setZones(zoneLists.flat());
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-bg">
        <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  if (notFound || !object) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-bg px-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary">RED</span>EVELOPMENT
          </span>
          <p className="text-sm text-ink-muted">Страница не найдена.</p>
        </div>
      </div>
    );
  }

  return (
    // Без принудительного min-h-svh: в режиме "Аренда" на странице на два
    // блока меньше (варианты покупки, инвесторам), контент короче одного
    // экрана на широких мониторах — раньше здесь искусственно растягивалось
    // пустым фоном до высоты экрана, теперь просто заканчивается по факту.
    <div className="bg-bg">
      <header className="border-b border-border py-5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 sm:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <span className="text-lg font-extrabold tracking-wide text-ink">
                <span className="font-black text-primary">RED</span>EVELOPMENT
              </span>
            </div>
            {/* Верхнее меню "Покупка"/"Аренда" — рядом с логотипом, не под ним
                (владелец, 2026-09-13). Та же страница и та же вёрстка,
                переключаются только цены и часть блоков (см. dealMode ниже).
                Не роут — состояние компонента, поэтому у обоих режимов один и
                тот же URL/SEO. */}
            <ToggleGroup
              options={['Покупка', 'Аренда']}
              value={dealMode === 'rent' ? 'Аренда' : 'Покупка'}
              onChange={(v) => setDealMode(v === 'Аренда' ? 'rent' : 'sale')}
            />
          </div>
          {/* Раньше на мобильном это был отдельный fixed-виджет в правом нижнем
              углу — при определённых позициях скролла он наезжал на контент
              под ним (факты об объекте, варианты рассрочки). Перенесена в
              шапку, как и на десктопе — всегда на виду без риска перекрыть
              что-то ниже. На мобильном текст скрыт (иконка + онлайн-индикатор
              с достаточным тап-таргетом), чтобы не сжимать лого в узкой шапке. */}
          <a
            href={OWNER_TELEGRAM_URL}
            target="_blank"
            rel="noreferrer"
            title={ownerOnline ? 'Онлайн — на связи' : 'Офлайн — отвечу завтра'}
            aria-label={`Задать вопрос в Telegram — ${ownerOnline ? 'онлайн' : 'офлайн'}`}
            className={cn(
              'flex items-center gap-2 px-3 py-2 text-sm font-medium text-ink hover:border-primary hover:text-primary sm:py-1.5',
              glassPillClass,
            )}
            style={glassPillShadow}
          >
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center sm:h-5 sm:w-5">
              <TelegramLogo className="h-7 w-7 sm:h-5 sm:w-5" />
              <span
                className={cn(
                  'absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white',
                  ownerOnline ? 'bg-success' : 'bg-ink-faint',
                )}
              />
            </span>
            <span className="hidden sm:inline">Задать вопрос</span>
          </a>
        </div>
      </header>

      <main>
      <div className="mx-auto grid max-w-5xl grid-cols-1 items-center gap-10 px-4 py-12 sm:px-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-extrabold leading-tight text-ink sm:text-3xl">
            Приватные кабинеты и фиксированные рабочие места от{' '}
            {formatDealMoney(dealMode, dealMode === 'rent' ? RENT_WORKSTATION_PRICE : STARTING_PRICE_FROM)}
          </h1>
          <div className="flex flex-col gap-3">
            {heroFeatures.map(({ icon: Icon, text }) => (
              <div key={text} className="flex min-w-0 items-center gap-3">
                <span
                  className={cn('flex h-9 w-9 shrink-0 items-center justify-center text-ink', glassPillClass)}
                  style={glassPillShadow}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 break-words text-base font-medium text-ink">{text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative">
          <HeroImageSlider
            images={object.renderImageUrls}
            alt={`Офисы и кабинеты рядом с Минск Миром — ${object.name || object.address}`}
          />
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-white/95 px-3 py-2 shadow-card backdrop-blur">
            <img src={MINSK_MIR_LOGO_URL} alt="Минск Мир" width={95} height={110} className="h-4 w-auto" />
            <span className="text-xs font-semibold text-ink">Рядом с Минск Миром</span>
          </div>
        </div>
      </div>

      {/* У всех прямых детей ниже — явный key: без него позиция каждого
          соседа в этом списке сдвигается, когда переключение dealMode
          убирает/возвращает блоки "3 варианта покупки"/"инвесторам" —
          React сверяет детей по позиции и без key принял бы, например,
          PublicPlanAndUnits за старый "инвесторам"-блок на его месте и
          размонтировал/пересоздал бы его (и всё, что после) заново при
          каждом клике по переключателю, теряя внутренний стейт (открытая
          модалка кабинета, фильтры таблицы). */}
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-8 sm:px-8">
        <div key="complex-features" className={cn('flex flex-col gap-5 p-5', glassCardClass)} style={glassCardShadow}>
          <div className="text-xl font-extrabold text-ink">Клубный деловой центр Red One</div>
          {/* 4 колонки только с lg (1024px) — на md (768px, планшет) длинные
              слова вроде "Видеонаблюдение"/"коммуникации" не помещались в
              колонку и break-words рвал их посередине символов, не по
              границе слова (UX-аудит, скриншот планшета). */}
          <div className="grid grid-cols-1 gap-y-4 sm:grid-cols-2 sm:gap-x-6 sm:gap-y-5 lg:grid-cols-4">
            {complexFeatures.map(({ icon: Icon, text }) => (
              <div key={text} className="flex min-w-0 items-center gap-3">
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center text-ink', glassPillClass)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 break-words text-sm font-medium text-ink">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Видимый текст цен в HTML, не только внутри интерактивного плана/
            таблицы ниже (PublicPlanAndUnits) — коммерческий фактор №1 для
            Яндекса и материал для цитирования AI-системами по ценовым
            запросам (см. SEO_PLAN.md, Э1-5). Цифры берём из тех же констант,
            что считают реальные цены на плане (zonePrice/WORKSTATION_PRICE),
            а не дублируем их вручную. */}
        <div key="prices" className={cn('flex flex-col gap-4 p-5', glassCardClass)} style={glassCardShadow}>
          <h2 className="text-xl font-extrabold text-ink">Цены</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <div className="text-lg font-bold text-ink">
                Кабинеты {MIN_ROOM_AREA}–{MAX_ROOM_AREA} м² — от{' '}
                {formatDealMoney(dealMode, dealMode === 'rent' ? RENT_ROOM_PRICE_FROM : zonePrice(MIN_ROOM_AREA))}
              </div>
              <p className="text-sm text-ink-muted">
                {dealMode === 'rent'
                  ? 'Помещение с чистовой отделкой'
                  : `$${PRICE_PER_METER} за м² · рассрочка, лизинг или кредит — см. ниже`}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-lg font-bold text-ink">
                Фиксированное рабочее место — от{' '}
                {formatDealMoney(dealMode, dealMode === 'rent' ? RENT_WORKSTATION_PRICE : WORKSTATION_PRICE)}
              </div>
              <p className="text-sm text-ink-muted">Готовое место в общем кабинете, с ремонтом и мебелью</p>
            </div>
          </div>
        </div>

        {/* Оба блока ниже — только про покупку (варианты оплаты, инвесторская
            сдача в аренду купленного кабинета), на странице аренды смысла не
            имеют (владелец: "убираем блок из аренды"). */}
        {dealMode === 'sale' && (
          <div key="purchase-options" id={PURCHASE_OPTIONS_ANCHOR_ID} className={cn('flex flex-col gap-5 p-5', glassCardClass)} style={glassCardShadow}>
            <div className="text-xl font-extrabold text-ink">3 варианта покупки, если нет полной суммы</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {purchaseOptions.map((opt) => (
                <div
                  key={opt.title}
                  className="flex flex-col gap-3 rounded-control border border-white bg-white/90 p-4 shadow-card backdrop-blur-md sm:border-white/50 sm:bg-white/40 sm:shadow-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center text-ink', glassPillClass)}>
                      <opt.icon className="h-5 w-5" />
                    </span>
                    {opt.badge && (
                      <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-semibold text-success">
                        {opt.badge}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-base font-bold text-ink">{opt.title}</div>
                    {opt.audience && (
                      <span className="w-fit shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                        {opt.audience}
                      </span>
                    )}
                  </div>
                  {opt.terms && <div className="text-sm font-semibold text-ink">{opt.terms}</div>}
                  <p className="text-sm text-ink-muted">{opt.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {dealMode === 'sale' && (
          <div
            key="investors"
            className={cn(
              'flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between',
              glassCardClass,
            )}
            style={glassCardShadow}
          >
            <div className="flex items-start gap-4 sm:items-center">
              <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center text-ink', glassPillClass)}>
                <TrendingUp className="h-5 w-5" />
              </span>
              <div className="flex flex-col gap-1">
                <div className="text-lg font-extrabold text-ink">Помещения с арендаторами для инвесторов</div>
                <p className="text-sm text-ink-muted">Заселим арендатора без комиссии и вашего участия</p>
              </div>
            </div>
            <a
              href={OWNER_TELEGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'flex w-fit shrink-0 items-center gap-2 self-center px-4 py-2.5 text-sm font-medium text-ink hover:border-primary hover:text-primary',
                glassPillClass,
              )}
              style={glassPillShadow}
            >
              <TelegramLogo className="h-5 w-5" />
              Обсудить с собственником
            </a>
          </div>
        )}

        <PublicPlanAndUnits
          key="plan-and-units"
          object={object}
          plans={plans}
          zones={zones}
          onZoneUpdated={(z) => setZones((prev) => prev.map((x) => (x.id === z.id ? z : x)))}
          glass
          hidePlanView
          dealMode={dealMode}
        />

        <BookingTermsCard key="booking-terms" agreement={object.intentAgreementFile} />

        <FaqCard key="faq" dealMode={dealMode} />
      </div>
      </main>
    </div>
  );
}
