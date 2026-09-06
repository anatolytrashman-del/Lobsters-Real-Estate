import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  Banknote,
  Building2,
  Calendar,
  Car,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Landmark,
  Layers,
  Leaf,
  MapPin,
  MessageSquareQuote,
  Newspaper,
  Palette,
  Phone,
  Ruler,
  ScrollText,
  Sparkles,
  Star,
  TrainFront,
  X,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../lib/glass';
import { Badge } from '../components/ui/Badge';
import { PhotoBlock, FactRow, FactTile } from '../components/businessCenters/BusinessCenterVisuals';
import { setBreadcrumbJsonLd, setNoIndex, clearNoIndex, setBusinessCenterPageMeta } from '../lib/pageMeta';
import { businessClassTone, shortName, sortByShortName } from '../lib/businessCenterDisplay';
import type { BusinessCenter, HighlightIconKey, TenantOrganization } from '../data/businessCenters';
import { fetchBusinessCenters } from '../lib/businessCentersApi';
import type { BusinessCenterOffer } from '../data/businessCenterOffers';
import { fetchBusinessCenterOffers } from '../lib/businessCenterOffersApi';

// Отдельная страница одного бизнес-центра (владелец, 2026-09-04: "для SEO
// лучше хаб + отдельная страница на каждый БЦ" — согласился с этим доводом
// и попросил именно так). Визуально — оверлей-«модалка» (та же стилистика,
// что у ImageLightbox.tsx: крестик-закрытие, стрелки влево/вправо по краям
// экрана), но технически обычная полноценная страница со своим URL —
// иначе AI-краулеры/Яндекс без выполнения JS не увидели бы контент, а
// title/canonical/JSON-LD не смогли бы быть уникальными под конкретный БЦ.
// "Закрытие" ведёт не назад в истории браузера, а явно на /minsk/bcminsk —
// так работает предсказуемо и при заходе по прямой ссылке из поиска, когда
// в истории браузера страницы хаба вообще нет.
export function BusinessCenterDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [centers, setCenters] = useState<BusinessCenter[] | null>(null);
  const [offers, setOffers] = useState<BusinessCenterOffer[] | null>(null);

  useEffect(() => {
    fetchBusinessCenters()
      .then(setCenters)
      .catch(() => setCenters([]));
  }, []);

  // Объявления о продаже/аренде из business_center_offers (владелец,
  // 2026-09-05: "хочу спарсить объявления... эту инфу мы будем выводить в
  // полной карточке" — см. scripts/sync-business-center-offers.mjs).
  // Отдельный запрос по слагу, не общий с fetchBusinessCenters — так при
  // переходе на следующий/предыдущий БЦ (тот же компонент, меняется только
  // slug) список объявлений сам перезапрашивается под новый БЦ.
  useEffect(() => {
    if (!slug) return;
    setOffers(null);
    fetchBusinessCenterOffers(slug)
      .then(setOffers)
      .catch(() => setOffers([]));
  }, [slug]);

  // Порядок для "предыдущий/следующий" — тот же алфавит по короткому имени,
  // что и в боковом меню хаба, чтобы стрелки совпадали с порядком, который
  // пользователь уже видел в списке до перехода сюда.
  const sorted = useMemo(() => sortByShortName(centers ?? []), [centers]);
  const center = useMemo(() => sorted.find((c) => c.slug === slug) ?? null, [sorted, slug]);
  const index = center ? sorted.findIndex((c) => c.slug === center.slug) : -1;
  const prev = index > 0 ? sorted[index - 1] : null;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;

  const saleRows = useMemo(() => computeOfferRows(offers ?? [], 'sale'), [offers]);
  const rentRows = useMemo(() => computeOfferRows(offers ?? [], 'rent'), [offers]);

  useEffect(() => {
    if (!center) return;
    setBusinessCenterPageMeta(center.slug, center, center.photos[0]);
    setBreadcrumbJsonLd([
      { name: 'Коммерческая недвижимость в Минске', url: 'https://redevelopment.pro/minsk' },
      { name: 'Бизнес-центры Минска', url: 'https://redevelopment.pro/minsk/bcminsk' },
      { name: shortName(center) },
    ]);
  }, [center]);

  // Слаг не найден (опечатка в ссылке, удалённый БЦ) — soft-404: страница
  // остаётся доступной (200, не редирект), но не индексируется, тот же
  // принцип, что и у ObjectLandingPage для неизвестного /:slug.
  useEffect(() => {
    if (centers === null || center) return;
    setNoIndex();
    return () => clearNoIndex();
  }, [centers, center]);

  if (centers === null) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-bg">
        <p className="text-sm text-ink-faint">Загрузка…</p>
      </div>
    );
  }

  if (!center) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg px-4 text-center">
        <p className="text-base text-ink-muted">Такой бизнес-центр не найден.</p>
        <Link to="/minsk/bcminsk" className="text-sm font-semibold text-primary hover:underline">
          ← Все бизнес-центры Минска
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-bg px-4 py-8 sm:py-14">
      <div className="mx-auto flex max-w-3xl items-center justify-between pb-5">
        <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
          <span className="font-black text-primary">RED</span>EVELOPMENT
        </Link>
        <Link
          to="/minsk/bcminsk"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <X className="h-4 w-4 shrink-0" />
          Все бизнес-центры
        </Link>
      </div>

      {/* Стрелки влево/вправо по краям экрана — тот же паттерн, что и в
          ImageLightbox.tsx. Только от lg — на мобильном места мало, там
          навигация — строка кнопок под карточкой ниже. */}
      {prev && (
        <Link
          to={`/minsk/bcminsk/${prev.slug}`}
          aria-label={`Предыдущий бизнес-центр: ${shortName(prev)}`}
          className={cn(
            'fixed left-4 top-1/2 z-40 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink lg:flex',
            glassPillClass,
          )}
          style={glassPillShadow}
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
      )}
      {next && (
        <Link
          to={`/minsk/bcminsk/${next.slug}`}
          aria-label={`Следующий бизнес-центр: ${shortName(next)}`}
          className={cn(
            'fixed right-4 top-1/2 z-40 hidden -translate-y-1/2 items-center justify-center rounded-full p-3 text-ink lg:flex',
            glassPillClass,
          )}
          style={glassPillShadow}
        >
          <ChevronRight className="h-5 w-5" />
        </Link>
      )}

      <div className="mx-auto max-w-3xl">
        <div className={cn('overflow-hidden', glassCardClass)} style={glassCardShadow}>
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            <PhotoBlock center={center} />
          </div>

          <div className="flex flex-col gap-4 p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h1 className="text-2xl font-extrabold leading-tight text-ink">{center.name}</h1>
              {center.status === 'under_construction' && (
                <div className="flex shrink-0 flex-wrap gap-1.5">
                  <Badge tone="warning">Строится</Badge>
                </div>
              )}
            </div>

            <FactRow icon={MapPin}>{center.address}</FactRow>

            {/* Плитки фактов вместо простого списка строк — владелец,
                2026-09-06: "переработай этот блок в плиточки, можно разного
                размера, но чтобы выглядело как концепт... пример бери с
                минск мира" (см. "Ключевые цифры" в DistrictGuidePage.tsx —
                тот же визуальный язык: круглая иконка, белая карточка), и
                следом, увидев результат на "S Union": "класс БЦ тоже
                плиточкой, паркинг растянуть на 3 карточки, "в пешей
                доступности" — на конкретное расстояние, текстовый блок
                описания — убрать вовсе". Класс — бывший цветной Badge у
                заголовка (был отдельно от плиток) теперь сама "value"
                плитки — тон по businessClassTone сохранён, просто внутри
                плитки, не потерян при переезде. Короткие числовые факты
                (площадь/год/этажи/метро) — в "stat"-режиме FactTile
                (крупное значение + подпись); метро разбивается на
                "станция"/"расстояние" по первой запятой в тексте, если
                запятой нет — вся строка уходит в подпись (сами значения
                метро отдельно вычищены от расплывчатого "в шаговой/пешей
                доступности" — см. запись в журнале). Парковка/застройщик —
                свободный текст произвольной длины, не раскладывается на
                число+подпись, поэтому "text"-режим (просто текст покрупнее);
                парковка — на 3 из 4 колонок (span=3), самый длинный факт на
                практике. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {center.businessClass && (
                <FactTile
                  icon={Award}
                  value={<Badge tone={businessClassTone[center.businessClass]}>Класс {center.businessClass}</Badge>}
                  label="Деловой класс"
                />
              )}
              {center.totalArea != null && (
                <FactTile icon={Ruler} value={`${center.totalArea.toLocaleString('ru-RU')} м²`} label="Общая площадь" />
              )}
              {center.yearBuilt != null && (
                <FactTile
                  icon={Calendar}
                  value={`${center.yearBuilt} г.`}
                  label={center.status === 'under_construction' ? 'Ожидаемая сдача' : 'Год сдачи'}
                />
              )}
              {center.floors != null && <FactTile icon={Layers} value={center.floors} label="Этажей" />}
              {center.metro &&
                (() => {
                  const idx = center.metro.indexOf(',');
                  // Разбивка на "станция"/"расстояние" только для коротких строк
                  // вида "Станция, ~N м" — более длинные (в скобках уточнение,
                  // без запятой и т.п., напр. "Могилёвская (прямого перехода
                  // нет — быстрее на транспорте)") не влезут крупным шрифтом
                  // в плитку-статистику, поэтому уходят в обычный текстовый режим.
                  if (idx === -1 || center.metro.length > 28) {
                    return <FactTile icon={TrainFront} text={center.metro} />;
                  }
                  return <FactTile icon={TrainFront} value={center.metro.slice(0, idx)} label={center.metro.slice(idx + 1).trim()} />;
                })()}
              {center.developer && <FactTile icon={Building2} text={center.developer} />}
              {center.parking && <FactTile icon={Car} text={center.parking} span={3} />}
            </div>

            {center.website && (
              <a
                href={center.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <Globe className="h-4 w-4 shrink-0" />
                {center.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {/* "Интересные факты" — произвольный набор блоков, разный у каждого
            БЦ (владелец, 2026-09-06, второй заход: "старайся делать
            кастомную страницу под каждый БЦ. Если у БЦ нет наград, не
            делай этот блок вообще. Если есть что-то новое — кастомный
            блок"). Раньше был фиксированный объект (history/tenants/media/
            rating/reviews), теперь — HighlightSection[] (см. комментарий у
            BusinessCenter.highlights в data/businessCenters.ts). icon
            'warning' — единственная особая: выносится наверх акцентным
            жёлтым блоком (как caveat в RentalInfo), а не в общий список.
            Порядок блоков на странице (владелец, 2026-09-06): главный блок
            → Интересные факты → Условия для арендаторов → Объявления с
            Kufar и Realt. */}
        {center.highlights.length > 0 && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <Sparkles className="h-5 w-5 shrink-0 text-primary" />
              Интересные факты
            </h2>

            {center.highlights
              .filter((s) => s.icon === 'warning')
              .map((s, i) => (
                <div
                  key={`warning-${i}`}
                  className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {s.label && <p className="text-xs font-semibold uppercase tracking-wide">{s.label}</p>}
                    <p className="mt-0.5 leading-relaxed">{renderRentalText(s.text)}</p>
                  </div>
                </div>
              ))}

            <div className="flex flex-col divide-y divide-border">
              {center.highlights
                .filter((s) => s.icon !== 'warning')
                .map((s, i) => (
                  <LabeledTextRow key={i} icon={HIGHLIGHT_ICONS[s.icon]} label={s.label} text={s.text} />
                ))}
            </div>

            <p className="text-xs text-ink-faint">
              Собрано веб-поиском по открытым источникам (новости, реестры, карты) — не куратировано вручную.
            </p>
          </div>
        )}

        {/* Организации внутри здания — владелец, 2026-09-06 (третий заход):
            "давай сделаем ещё блок арендаторов внутри БЦ... сгруппировать,
            на первое место ставь места с максимумом отзывов на картах".
            Источник — карусель "Организации внутри" на Яндекс.Картах
            (веб-архив) — она отдаёт только название+категорию на каждую
            организацию, БЕЗ числа отзывов на неё саму (в отличие от
            рейтинга/отзывов всего здания в блоке выше). Настоящей сортировки
            "по числу отзывов" на уровне отдельной организации из этих данных
            не построить — группы отсортированы по размеру (категории с
            большим числом организаций первыми) как ближайший доступный
            прокси, без выдумывания цифр (см. комментарий у
            BusinessCenter.tenantOrganizations в data/businessCenters.ts). */}
        {center.tenantOrganizations.length > 0 && <TenantOrganizationsBlock organizations={center.tenantOrganizations} />}

        {/* Условия для арендаторов с офиц. сайта БЦ (владелец, 2026-09-05,
            на примере "Проспект"/Elite Estate — по нему нет объявлений на
            Kufar/Realt, но на собственном сайте есть условия для
            арендаторов: "пройдись по сайтам БЦ и поищешь такую информацию").
            Собрано веб-поиском (Gemini через ProxyAPI — прямого доступа к
            большинству сайтов БЦ из песочницы нет). Первая версия рисовала
            всё одним абзацем — владелец: "верстка — пиздец, разбей на
            логические блоки, используй форматирование" — теперь отдельная
            подписанная строка на каждый раздел (LabeledTextRow), важная
            оговорка источника (сайт недоступен, "Аден" по факту гостиница
            и т.п.) — акцентным блоком сверху, не затёртая в общем тексте.
            Каждое поле независимо может быть null — рисуем только то, что
            реально нашлось. */}
        {center.rentalInfo && (
          <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
              <FileText className="h-5 w-5 shrink-0 text-primary" />
              Условия для арендаторов
            </h2>

            {center.rentalInfo.caveat && (
              <div className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-relaxed">{center.rentalInfo.caveat}</p>
              </div>
            )}

            <div className="flex flex-col divide-y divide-border">
              <LabeledTextRow icon={ScrollText} label="Условия аренды" text={center.rentalInfo.terms} />
              <LabeledTextRow icon={Banknote} label="Ставки" text={center.rentalInfo.rates} />
              <LabeledTextRow icon={Ruler} label="Площади и типы помещений" text={center.rentalInfo.sizes} />
              <LabeledTextRow icon={Car} label="Парковка" text={center.rentalInfo.parking} />
              <LabeledTextRow icon={Phone} label="Контакты отдела аренды" text={center.rentalInfo.contacts} />
            </div>

            <p className="text-xs text-ink-faint">
              Собрано автоматически по официальному сайту БЦ и открытым источникам — не куратировано вручную, перед
              подписанием договора уточняйте актуальные условия напрямую у арендодателя.
            </p>
          </div>
        )}

        {/* "Интересные факты" — отдельная от условий аренды категория:
            история объекта, известные арендаторы, награды/СМИ, рейтинг и
            отзывы с карт (владелец, 2026-09-06: "подтянуть рейтинг из
            Яндекс.Карт, отзывы, другую инфу... чтобы страница была даже
            понятнее, чем официальный сайт"). history/tenants/media — веб-
            поиск (Gemini+google_search), КАЖДЫЙ факт перепроверен отдельным
            независимым поиском (см. комментарий у BusinessCenterHighlights
            в data/businessCenters.ts — первая попытка дала неподтверждённые
            детали). rating/reviews заполняются владельцем вручную — прямой
            поиск с картами дал похожие на правду, но выдуманные цитаты
            отзывов, публиковать нельзя. */}

        {/* Объявления с Kufar и Realt — было "Рынок в этом здании", владелец
            переименовал (2026-09-06), чтобы сразу было понятно источник
            данных. История правок самой таблицы (разбивка по типу
            помещения, явная строка "нет объявлений" вместо исчезновения
            секции, убранные прямые ссылки на Kufar/Realt) — см. запись
            2026-09-05 в CLAUDE.md. */}
        {offers !== null && (
          <div className={cn('mt-6 flex flex-col gap-3 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
            <h2 className="text-lg font-bold text-ink">Объявления с Kufar и Realt</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    <th scope="col" className="py-2 pr-3 text-left">
                      Тип помещения
                    </th>
                    <th scope="col" className="py-2 px-2 text-right">
                      Объявлений
                    </th>
                    <th scope="col" className="py-2 px-2 text-right">
                      Площадь
                    </th>
                    <th scope="col" className="py-2 pl-2 text-right">
                      Цена за м²
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <OfferDealSection title="Продажа" rows={saleRows} isFirst />
                  <OfferDealSection title="Аренда" rows={rentRows} />
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Мобильная навигация "следующий/предыдущий" — фиксированные стрелки
            выше скрыты до lg, здесь тот же переход обычной строкой кнопок. */}
        {(prev || next) && (
          <div className="mt-5 flex items-center justify-between gap-3 lg:hidden">
            {prev ? (
              <Link
                to={`/minsk/bcminsk/${prev.slug}`}
                className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4 shrink-0" />
                {shortName(prev)}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                to={`/minsk/bcminsk/${next.slug}`}
                className="flex items-center gap-1.5 text-right text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
              >
                {shortName(next)}
                <ChevronRight className="h-4 w-4 shrink-0" />
              </Link>
            ) : (
              <span />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Одна строка блока "Условия для арендаторов" — иконка + подпись раздела +
// Иконка на раздел "Интересных фактов" по ключу из HighlightSection.icon —
// 'warning' в общий список не попадает (свой рендер, акцентный блок выше),
// но остаётся в мапе для полноты типа (Record должен покрывать все ключи).
const HIGHLIGHT_ICONS: Record<HighlightIconKey, typeof FileText> = {
  history: Landmark,
  tenants: Building2,
  media: Newspaper,
  rating: Star,
  reviews: MessageSquareQuote,
  design: Palette,
  eco: Leaf,
  warning: AlertTriangle,
  fact: Sparkles,
};

// Сколько категорий показывать сразу — у части БЦ (владелец, 2026-09-06:
// "ограничь список видимых категорий с кнопкой «показать ещё»") реальная
// страница "Организации внутри" на Яндекс.Картах даёт не карусель из
// 6-10 позиций, а полный список зарегистрированных на адрес юрлиц — у
// "Паруса", например, 160+ категорий одним полотном. Первый экран остаётся
// компактным, весь список доступен по клику, без ограничения на бэкенде.
const VISIBLE_TENANT_CATEGORIES = 8;

// "5 категорий"/"2 категории"/"1 категорию" — числительное требует разного
// падежа/числа (тот же принцип, что и pluralOrganizations в DistrictQuarterMap.tsx).
function pluralCategories(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'категорию';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'категории';
  return 'категорий';
}

function TenantOrganizationsBlock({ organizations }: { organizations: TenantOrganization[] }) {
  const [expanded, setExpanded] = useState(false);
  const groups = useMemo(() => groupTenantOrganizations(organizations), [organizations]);
  const visibleGroups = expanded ? groups : groups.slice(0, VISIBLE_TENANT_CATEGORIES);
  const hiddenCount = groups.length - visibleGroups.length;

  return (
    <div className={cn('mt-6 flex flex-col gap-4 p-6 sm:p-8', glassCardClass)} style={glassCardShadow}>
      <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
        <Building2 className="h-5 w-5 shrink-0 text-primary" />
        Организации в здании
      </h2>
      {/* Владелец, 2026-09-06 (третий заход): "предложи более компактный
          способ — плитки занимают слишком много места, а полезной инфы
          немного". Раньше на каждую категорию уходило 2 строки (заголовок
          категории отдельно + отдельный ряд плашек-названий) — теперь
          категория и список названий в одной строке ("Категория (N):
          названия через запятую"), обычным текстом без плашек-фонов —
          при 150+ категориях у "Паруса" разница в высоте блока в разы. */}
      <div className="flex flex-col divide-y divide-border">
        {visibleGroups.map((group) => (
          <p key={group.category} className="py-1.5 text-sm leading-relaxed first:pt-0 last:pb-0">
            <span className="font-semibold text-ink">
              {group.category} <span className="text-ink-faint">({group.items.length})</span>:
            </span>{' '}
            <span className="text-ink-muted">{group.items.join(', ')}</span>
          </p>
        ))}
      </div>
      {groups.length > VISIBLE_TENANT_CATEGORIES && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-sm font-semibold text-primary hover:underline"
        >
          {expanded ? 'Свернуть' : `Показать ещё ${hiddenCount} ${pluralCategories(hiddenCount)}`}
        </button>
      )}
      <p className="text-xs text-ink-faint">
        Собрано по карте Яндекс.Карт — полный список организаций мог измениться, уточняйте у арендодателя.
      </p>
    </div>
  );
}

// Группировка "Организации в здании" по категории — без реального числа
// отзывов на каждую организацию (см. комментарий в JSX выше) сортируем
// группы по размеру (больше организаций одной категории — выше), внутри
// группы — по алфавиту. "Без категории" (пустая строка из формы) — всегда
// последней группой, не мешает содержательным категориям наверху.
function groupTenantOrganizations(orgs: TenantOrganization[]): { category: string; items: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const org of orgs) {
    const category = org.category.trim() || 'Без категории';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(org.name);
  }
  return Array.from(groups.entries())
    .map(([category, items]) => ({ category, items: [...items].sort((a, b) => a.localeCompare(b, 'ru')) }))
    .sort((a, b) => {
      if (a.category === 'Без категории') return 1;
      if (b.category === 'Без категории') return -1;
      if (b.items.length !== a.items.length) return b.items.length - a.items.length;
      return a.category.localeCompare(b.category, 'ru');
    });
}

// сам текст, ничего не рендерит, если по этому разделу нашлось не найдено
// (text === null) — не показываем пустые подписи.
function LabeledTextRow({ icon: Icon, label, text }: { icon: typeof FileText; label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        <div className="mt-1 text-sm leading-relaxed text-ink-muted">{renderRentalText(text)}</div>
      </div>
    </div>
  );
}

// Мини-разметка внутри полей "Условия для арендаторов" (владелец, 2026-09-06:
// "делай еще сильнее дробить... в таком формате: * Пункт 1... важные цифры
// выделяй жирным") — сознательно не полноценный markdown-парсер (незачем
// тянуть библиотеку ради двух приёмов), просто: строки, начинающиеся с "- "
// или "* ", группируются в маркированный список, остальные строки — обычные
// абзацы; **текст** внутри любой строки — жирным. Текст полей набирается в
// админке (BusinessCentersAdminTab.tsx) в этой же нотации.
function renderRentalText(text: string): ReactNode {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let bulletBuffer: string[] = [];
  const flushBullets = () => {
    if (bulletBuffer.length === 0) return;
    blocks.push(
      <ul key={blocks.length} className="list-disc space-y-1 pl-4 marker:text-ink-faint">
        {bulletBuffer.map((item, i) => (
          <li key={i}>{renderBold(item)}</li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };
  for (const line of lines) {
    if (line.startsWith('- ') || line.startsWith('* ')) {
      bulletBuffer.push(line.slice(2));
    } else {
      flushBullets();
      blocks.push(
        <p key={blocks.length} className={blocks.length > 0 ? 'mt-2' : undefined}>
          {renderBold(line)}
        </p>,
      );
    }
  }
  flushBullets();
  return <>{blocks}</>;
}

function renderBold(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

// Одна строка таблицы — либо реальная разбивка по типу помещения (для
// сделки, где объявления есть), либо единственная строка-заглушка "нет
// объявлений" (propertyType: null), когда по этой сделке сейчас пусто —
// владелец: "Продажа" должна быть видна явной строкой, а не пропадать.
interface OfferRow {
  propertyType: string | null;
  count: number;
  minSize: number;
  maxSize: number;
  minPrice: number;
  medianPrice: number;
  maxPrice: number;
}

function computeOfferRows(offers: BusinessCenterOffer[], dealType: BusinessCenterOffer['dealType']): OfferRow[] {
  const filtered = offers.filter((o) => o.dealType === dealType);
  if (filtered.length === 0) {
    return [{ propertyType: null, count: 0, minSize: 0, maxSize: 0, minPrice: 0, medianPrice: 0, maxPrice: 0 }];
  }

  const groups = new Map<string, BusinessCenterOffer[]>();
  for (const o of filtered) {
    const key = o.propertyType ?? 'Без категории';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  return Array.from(groups.entries())
    .map(([propertyType, group]) => {
      const sizes = group.map((o) => o.size);
      const prices = [...group.map((o) => o.pricePerSqm)].sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const medianPrice = prices.length % 2 !== 0 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
      return {
        propertyType,
        count: group.length,
        minSize: Math.min(...sizes),
        maxSize: Math.max(...sizes),
        minPrice: Math.min(...prices),
        medianPrice,
        maxPrice: Math.max(...prices),
      };
    })
    .sort((a, b) => b.count - a.count);
}

function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString('ru-RU')}`;
}

// Заголовок сделки (Продажа/Аренда) — не отдельная колонка (чтобы не
// повторять текст на каждой строке разбивки), а строка-разделитель на всю
// ширину таблицы, за ней сразу строки по типу помещения.
function OfferDealSection({ title, rows, isFirst }: { title: string; rows: OfferRow[]; isFirst?: boolean }) {
  return (
    <>
      <tr>
        <td colSpan={4} className={cn('pb-1.5 text-xs font-bold uppercase tracking-wide text-ink-faint', isFirst ? 'pt-0' : 'pt-4')}>
          {title}
        </td>
      </tr>
      {rows.map((row) =>
        row.propertyType === null ? (
          <tr key="empty">
            <td colSpan={4} className="py-3 text-ink-faint">
              Нет активных объявлений
            </td>
          </tr>
        ) : (
          <tr key={row.propertyType}>
            <td className="py-3 pr-3 font-medium text-ink">{row.propertyType}</td>
            <td className="py-3 px-2 text-right tabular-nums text-ink-faint">{row.count}</td>
            <td className="whitespace-nowrap py-3 px-2 text-right tabular-nums text-ink-faint">
              {row.minSize === row.maxSize
                ? `${row.minSize.toLocaleString('ru-RU')} м²`
                : `${row.minSize.toLocaleString('ru-RU')}–${row.maxSize.toLocaleString('ru-RU')} м²`}
            </td>
            <td className="whitespace-nowrap py-3 pl-2 text-right tabular-nums font-semibold text-ink">
              {row.minPrice === row.maxPrice
                ? `${formatUsd(row.minPrice)}/м²`
                : `${formatUsd(row.minPrice)}–${formatUsd(row.maxPrice)}/м² (медиана ${formatUsd(row.medianPrice)})`}
            </td>
          </tr>
        ),
      )}
    </>
  );
}
