import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { setArticleJsonLd, setBreadcrumbJsonLd, setGenericPageMeta, setOrganizationJsonLd } from '../lib/pageMeta';
import { MIN_RELIABLE_N } from '../data/marketSnapshots';

const TITLE = 'Методика расчёта — аналитика рынка коммерческой недвижимости';
const DESCRIPTION = 'Как мы собираем и считаем ставки аренды и цены продажи коммерческой недвижимости в Минске.';
const URL = 'https://redevelopment.pro/minsk/analytics/metodika';
const LAST_UPDATED = '2026-09-07';

export function AnalyticsMethodologyPage() {
  useEffect(() => {
    setGenericPageMeta({ title: TITLE, description: DESCRIPTION, url: URL, ogType: 'article' });
    setOrganizationJsonLd(false);
    setBreadcrumbJsonLd([
      { name: 'Минск', url: 'https://redevelopment.pro/minsk' },
      { name: 'Аналитика рынка', url: 'https://redevelopment.pro/minsk/analytics' },
      { name: 'Методика' },
    ]);
    setArticleJsonLd({
      headline: TITLE,
      description: DESCRIPTION,
      url: URL,
      datePublished: LAST_UPDATED,
      dateModified: LAST_UPDATED,
    });
  }, []);

  return (
    <div className="min-h-svh bg-bg">
      <div className="border-b border-border py-5">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 sm:px-8">
          <Link to="/minsk" className="text-lg font-extrabold tracking-wide text-ink">
            <span className="font-black text-primary-hover">RED</span>EVELOPMENT
          </Link>
        </div>
      </div>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Методика</h1>
          <p className="text-sm text-ink-muted">Версия от {LAST_UPDATED}. Обновляем при изменении подхода к расчёту.</p>
        </div>

        <div className={cn('flex flex-col gap-5 p-6 text-sm leading-relaxed text-ink', glassCardClass)} style={glassCardShadow}>
          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Что сейчас считается</h2>
            <p>
              Три сегмента. <strong>Офисы в бизнес-центрах Минска</strong> (аренда и продажа) — 143 здания из
              нашего каталога бизнес-центров, каждое объявление привязано к конкретному зданию по адресу.{' '}
              <strong>Торговые помещения</strong> (аренда и продажа) — по всему Минску, без привязки к каталогу
              (такого справочника торговых центров и жилых комплексов у нас пока нет) — район и тип здания берём из
              собственных полей площадок. <strong>Склады</strong> (аренда и продажа) — тоже по всему городу, только
              по административному району: класса склада, высоты потолков и направления шоссе площадки не дают как
              структурные поля, поэтому такого среза нет. Остальные сегменты рынка (офисы вне бизнес-центров,
              первичный рынок, готовый арендный бизнес, машиноместа) пока не собираются.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Источники</h2>
            <p>
              Активные объявления с Kufar (re.kufar.by) и Realt.by. Для офисов — найденные по точному адресу
              каждого здания из каталога бизнес-центров. Для торговых помещений и складов — по всему городу,
              категории «Магазины, торговые помещения» и «Склады» на обеих площадках. Собираются автоматически раз
              в месяц.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Внешние источники для сравнения</h2>
            <p>
              На страницах ставок аренды/продажи рядом с нашей медианой показаны справочные цифры отраслевых
              аналитиков — <strong>«Твоя столица»</strong> (t-s.by, ежемесячный мониторинг ставок по классам A/B+/B/C
              в BYN и EUR — у них нет отдельных рядов по классам A и B+ для продажи, только B и C) и{' '}
              <strong>Colliers International</strong> (годовой отчёт по офисному рынку — вакантность, общий сток,
              новое предложение). Цифры вводятся вручную по мере выхода новых отчётов, не пересчитываются в наши
              единицы — курсы и методика классификации у каждого источника свои. В частности, деление на классы у
              Colliers (A/B1/B2) не совпадает с нашим A/B+/B/C (это классификация «Твоей столицы», её же использует
              наш каталог бизнес-центров) — сравнивать их напрямую класс-в-класс некорректно, сопоставима только
              цифра по городу целиком. Пока это есть только на страницах офисов — для торговых помещений подходящего
              открытого источника с сопоставимой методикой ещё не нашли.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Ставка предложения, не ставка сделки</h2>
            <p>
              Мы считаем цену, которую просит собственник в объявлении на момент сбора данных, а не подтверждённую
              цену сделки. По оценке отраслевого аналитика «Твоя столица», ставка сделки обычно ниже ставки
              предложения примерно на 10% — это стоит учитывать при сравнении наших цифр с реальными переговорами.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Дедупликация</h2>
            <p>
              У офисов в бизнес-центрах дедупликации между Kufar и Realt.by нет: если один и тот же объект выставлен
              на обеих площадках, он может учитываться дважды — известное ограничение первой версии. У торговых
              помещений и складов дедупликация есть (сделана при сборе): совпадающие по улице, дому, площади, этажу
              и типу сделки объявления с обеих площадок считаются один раз, оставляем найденное первым.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Расчёт</h2>
            <p>
              Для каждого среза (город целиком; для офисов — класс здания A/B+/B/C и административный район; для
              торговых помещений — административный район и тип здания: жилой дом, торговый центр, бизнес-центр,
              отдельно стоящее и т.п.; для складов — только административный район) — медиана и 25-й/75-й
              перцентили цены за м² по объявлениям с указанной ценой.
              При выборке от 8 объявлений цена за м² вне 5–95-го перцентиля внутри этого среза исключается перед
              расчётом медианы — чтобы одно объявление с явно ошибочной ценой не искажало картину. Валюта — доллары
              США (так их указывают сами площадки). Отдельного фильтра выбросов сверх этой обрезки нет — учитывать
              при цитировании цифр.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Порог достаточности выборки</h2>
            <p>
              Срез с {MIN_RELIABLE_N} объявлениями и больше показывается как обычная цифра. Меньше — помечается
              «ориентировочно» (если хотя бы одно объявление есть) или «недостаточно данных» (совсем пусто). Это
              не значит, что в здании/районе нет предложений вообще — значит, что мы не набрали достаточно
              объявлений для устойчивой медианы.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-bold text-ink">Обновление</h2>
            <p>
              Снимок строится автоматически раз в месяц, 3-го числа. История снимков не перезаписывается — старые
              периоды остаются в базе, это основа будущих графиков динамики.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
