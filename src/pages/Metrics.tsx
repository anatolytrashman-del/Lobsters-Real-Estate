import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { cn } from '../lib/cn';
import { glassCardClass, glassCardShadow } from '../lib/glass';
import { fetchActivityLog } from '../lib/activityLogApi';
import type { ActivityLogEntry } from '../data/activityLog';
import { fetchAllSupplierOfferEmails } from '../lib/supplierOfferEmailsApi';
import type { SupplierOfferEmail } from '../data/supplierOfferEmails';
import { fetchSupplierWebSearchJobs, type SupplierWebSearchJob } from '../lib/supplierWebSearchApi';

// Владелец, 2026-09-05: "давай трекать Альмиру" (по аналогии с Activity Log
// Светланы — см. data/activityLog.ts/ActivityLog.tsx). Страница НЕ в меню и
// не в data/pages.ts (владелец: "не выводи в меню, дай просто ссылку") —
// доступ только по прямому урлу /admin/metrics, гейт RequireSuperAdmin (см.
// App.tsx), тот же принцип, что и у /admin/activity-log.
//
// Верификация/ручное добавление поставщика — события, у которых нет своего
// поля в базе (verified:true ставится в обоих случаях, см. комментарий в
// Suppliers.tsx у submitOffer), поэтому считаем их через activity_log, как и
// у Светланы (market_offer_verified — тот же лог, действие только другое).
// Письма, наоборот, НЕ логируем отдельно — вся переписка уже хранится в
// supplier_offer_emails с адресом получателя, этого достаточно, чтобы
// посчитать и общее число, и число уникальных получателей напрямую.
//
// 2026-09-05, доработка по фидбеку владельца: (1) статистика Светланы не
// была видна вовсе — на этой странице считался только action'ы Альмиры,
// хотя market_offer_verified пишется в тот же activity_log; (2) блоки не
// были подписаны, кто есть кто; (3) добавлена разбивка по периоду —
// сегодня/неделя/этот месяц/любой выбранный месяц, раньше был только один
// показатель "за всё время".
//
// 2026-09-10 — реальный пробел, найденный по жалобе владельца ("не могу
// понять, система не трекает или Альмира реально ничего не делает"):
// "Верифицировано поставщиков" логируется ТОЛЬКО в submitOffer
// (Suppliers.tsx) — то есть только когда карточку открывают и сохраняют
// через форму "Подробнее". Самый частый на практике путь работы с уже
// идущей перепиской — кнопка "Подтвердить и заполнить карточку" на
// автораспознанном счёте прямо в письме (SupplierCorrespondenceTab.tsx,
// applyExtractionToOffer/applyExtractionToOrder) — минует submitOffer
// полностью и до этой правки не логировалась вообще, поэтому такая работа
// была не "недосчитана", а полностью невидима. Добавлено отдельное
// событие supplier_invoice_confirmed на эту кнопку — не смешано с
// supplier_offer_verified (то по-прежнему означает "первая ручная
// верификация карточки, добавленной веб-поиском"), у него другой смысл
// ("уже N-е подтверждение присланного счёта/КП по переписке").
//
// 2026-09-12 — владелец: "добавь учёт действий Светланы по добавлению новых
// поставщиков", "добавь учёт моих действий по поставщикам и письмам".
// Реальная проблема, которую это вскрыло: до этой правки страница считала
// события ПО ТИПУ ДЕЙСТВИЯ, а не по сотруднику — тип действия работал
// заглушкой вместо человека ("supplier_* значит Альмира"). Пока поставщиками
// занимался ровно один человек, это совпадало; как только их стало трое,
// цифры поехали — в блоке Альмиры в тот же день лежали 11 верификаций
// владельца и лежали бы все добавления Светланы. Теперь КАЖДЫЙ счётчик
// фильтруется по profile_name залогировавшего профиля, а блоки строятся по
// людям (TRACKED_PEOPLE + все прочие профили, реально встретившиеся в логе,
// чтобы ничья работа не осталась невидимой), с одинаковым набором плиток —
// никаких предположений "кто чем занимается" в коде больше нет.
//
// Три новых источника данных, которых не хватало для этого:
//  1. supplier_web_search_jobs.created_by_name — кто запустил веб-поиск;
//     рядом лежит added_count (сколько поставщиков реально добавилось), то
//     есть "добавлено поиском" считается по факту, а не по числу запусков.
//  2. activity_log 'supplier_web_search_started' — само действие "запустил
//     поиск" (Suppliers.tsx), видно сразу, не дожидаясь результата.
//  3. supplier_offer_emails.sent_by_name — автор исходящего письма. Раньше
//     письма нельзя было разделить по сотрудникам в принципе (в таблице не
//     было автора), поэтому весь их объём висел на Альмире. Заполняется
//     сервером по вошедшему пользователю (api/purchase-send-email.js) и
//     автором задания у массовой рассылки; историю разобрали бэкфиллом по
//     подписи в теле письма (см. docs/session-journal.md, 2026-09-12).

type Period = 'today' | 'week' | 'month' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Сегодня',
  week: 'Неделя',
  month: 'Этот месяц',
  custom: 'Другой месяц',
};
const PERIOD_OPTIONS = Object.values(PERIOD_LABELS);
const LABEL_TO_PERIOD = Object.fromEntries(Object.entries(PERIOD_LABELS).map(([k, v]) => [v, k as Period])) as Record<
  string,
  Period
>;

function currentMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Понедельник текущей недели — тот же принцип "европейской" недели, что и
// startOfWeekIsoDate в Tasks.tsx (getDay() воскресенье=0, сдвигаем на Пн=0).
function startOfWeek(d: Date): Date {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const mondayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - mondayOffset);
  return monday;
}

// [start, end) — весь диапазон отдаётся полными календарными границами
// (не "до текущего момента"), будущего внутри диапазона просто не бывает
// записей, поэтому это не завышает счётчики.
function periodRange(period: Period, customMonth: string): { start: Date; end: Date } {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (period === 'week') {
    const start = startOfWeek(now);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }
  const [y, m] = customMonth.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, 1);
  const end = new Date(y, m || 1, 1);
  return { start, end };
}

function formatPeriodCaption(period: Period, start: Date, end: Date): string {
  if (period === 'today') {
    return start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  }
  if (period === 'week') {
    const endInclusive = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })} – ${endInclusive.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })} (текущая неделя, с понедельника)`;
  }
  return start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

interface StatTileProps {
  label: string;
  value: number;
  hint?: string;
}

function StatTile({ label, value, hint }: StatTileProps) {
  return (
    <div className={cn('flex flex-col gap-1 p-4', glassCardClass)} style={glassCardShadow}>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="text-3xl font-semibold text-ink">{value.toLocaleString('ru-RU')}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}

function PersonSection({ name, subtitle, children }: { name: string; subtitle: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-ink">{name}</h2>
        <p className="text-xs text-ink-faint">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </Card>
  );
}

// Сотрудники, чей блок показывается всегда — даже если за период у них нули:
// ноль здесь несёт смысл ("трекается, но человек ничего не делал"), именно
// из-за невозможности отличить его от "действие вообще не логируется" была
// правка 2026-09-10 (см. комментарий в начале файла). Все прочие профили,
// реально встретившиеся в данных за период, дописываются к списку сами.
const TRACKED_PEOPLE = ['Светлана', 'Альмира', 'Трэшмен'];

// display_name владельца в профиле — рабочий никнейм ("в платформе имя не
// меняй", 2026-09-03); на этой странице, которую видит только он сам,
// показываем полное имя — та же узкая подмена, что и в подписи писем
// (emailSignature в SupplierCorrespondenceTab.tsx), сам профиль не трогаем.
function personTitle(name: string): string {
  return name === 'Трэшмен' ? 'Анатолий (Трэшмен)' : name;
}

interface PersonStats {
  name: string;
  marketOffersVerified: number;
  suppliersAddedManually: number;
  supplierSearchesStarted: number;
  suppliersAddedBySearch: number;
  suppliersVerified: number;
  invoicesConfirmed: number;
  emailsTotal: number;
  emailsUnique: number;
}

export function Metrics() {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [emails, setEmails] = useState<SupplierOfferEmail[] | null>(null);
  const [searchJobs, setSearchJobs] = useState<SupplierWebSearchJob[] | null>(null);
  const [error, setError] = useState('');

  const [period, setPeriod] = useState<Period>('today');
  const [customMonth, setCustomMonth] = useState(currentMonthStr());

  useEffect(() => {
    Promise.all([fetchActivityLog(), fetchAllSupplierOfferEmails(), fetchSupplierWebSearchJobs()])
      .then(([logEntries, offerEmails, jobs]) => {
        setEntries(logEntries);
        setEmails(offerEmails);
        setSearchJobs(jobs);
      })
      .catch(() => setError('Не удалось загрузить метрики.'));
  }, []);

  const { start, end } = useMemo(() => periodRange(period, customMonth), [period, customMonth]);
  const inRange = useMemo(() => {
    const startMs = start.getTime();
    const endMs = end.getTime();
    return (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= startMs && t < endMs;
    };
  }, [start, end]);

  const entriesInRange = useMemo(() => (entries ?? []).filter((e) => inRange(e.createdAt)), [entries, inRange]);

  const outgoingEmailsInRange = useMemo(
    () => (emails ?? []).filter((e) => e.direction === 'out' && inRange(e.createdAt)),
    [emails, inRange],
  );

  // Задание веб-поиска относим к периоду по времени ПОСТАНОВКИ В ОЧЕРЕДЬ —
  // это и есть момент действия человека. Обработчик дописывает added_count
  // минутами позже, но в ту же строку, поэтому поиск, запущенный в конце
  // периода, не теряется и не задваивается.
  const searchJobsInRange = useMemo(
    () => (searchJobs ?? []).filter((j) => inRange(j.createdAt)),
    [searchJobs, inRange],
  );

  const people: PersonStats[] = useMemo(() => {
    const names = [...TRACKED_PEOPLE];
    const seen = [
      ...entriesInRange.map((e) => e.profileName),
      ...outgoingEmailsInRange.map((e) => e.sentByName),
      ...searchJobsInRange.map((j) => j.createdByName),
    ];
    for (const name of seen) {
      if (name && !names.includes(name)) names.push(name);
    }
    return names.map((name) => {
      const actions = entriesInRange.filter((e) => e.profileName === name);
      const countAction = (action: string) => actions.filter((e) => e.action === action).length;
      const sent = outgoingEmailsInRange.filter((e) => e.sentByName === name);
      return {
        name,
        marketOffersVerified: countAction('market_offer_verified'),
        suppliersAddedManually: countAction('supplier_offer_added_manually'),
        supplierSearchesStarted: countAction('supplier_web_search_started'),
        suppliersAddedBySearch: searchJobsInRange
          .filter((j) => j.createdByName === name)
          .reduce((sum, j) => sum + (j.addedCount ?? 0), 0),
        suppliersVerified: countAction('supplier_offer_verified'),
        invoicesConfirmed: countAction('supplier_invoice_confirmed'),
        emailsTotal: sent.length,
        emailsUnique: new Set(sent.map((e) => e.toAddress.trim().toLowerCase())).size,
      };
    });
  }, [entriesInRange, outgoingEmailsInRange, searchJobsInRange]);

  // Письма без автора — отправленные до появления колонки sent_by_name и не
  // разобранные бэкфиллом по подписи. Показываем их отдельной строкой, а не
  // растворяем в чьих-то плитках: приписать их наугад = ровно та ошибка,
  // из-за которой эта страница и переделывалась.
  const emailsWithoutAuthor = useMemo(
    () => outgoingEmailsInRange.filter((e) => !e.sentByName).length,
    [outgoingEmailsInRange],
  );

  const loading = entries === null || emails === null || searchJobs === null;

  return (
    <>
      <PageHeader title="Метрики" />

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading && !error && (
        <div className="flex items-center gap-2 text-sm text-ink-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка…
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <ToggleGroup
              label="Период"
              options={PERIOD_OPTIONS}
              value={PERIOD_LABELS[period]}
              onChange={(label) => setPeriod(LABEL_TO_PERIOD[label])}
            />
            {period === 'custom' && (
              <Input
                type="month"
                label="Месяц"
                value={customMonth}
                max={currentMonthStr()}
                onChange={(e) => setCustomMonth(e.target.value)}
                className="w-fit"
              />
            )}
          </div>
          <p className="text-xs text-ink-faint">{formatPeriodCaption(period, start, end)}</p>

          {people.map((p) => (
            <PersonSection
              key={p.name}
              name={personTitle(p.name)}
              subtitle={`Действия, залогированные под профилем «${p.name}»`}
            >
              <StatTile
                label="Верифицировано объявлений"
                value={p.marketOffersVerified}
                hint="Аналитика рынка, /admin/market-offers"
              />
              <StatTile
                label="Добавлено поставщиков вручную"
                value={p.suppliersAddedManually}
                hint="Новая карточка, заполненная через форму с нуля"
              />
              <StatTile
                label="Запущено веб-поисков"
                value={p.supplierSearchesStarted}
                hint="Кнопка «Найти в сети» в категории Ресерча"
              />
              <StatTile
                label="Добавлено поставщиков поиском"
                value={p.suppliersAddedBySearch}
                hint="Реально созданные карточки по запущенным им поискам"
              />
              <StatTile
                label="Верифицировано поставщиков"
                value={p.suppliersVerified}
                hint="Подтверждены данные у поставщика, добавленного веб-поиском"
              />
              <StatTile
                label="Подтверждено счетов/КП"
                value={p.invoicesConfirmed}
                hint="Автораспознанный счёт в письме, подтверждён кнопкой"
              />
              <StatTile
                label="Уникальных писем отправлено"
                value={p.emailsUnique}
                hint="Разных адресов получателей"
              />
              <StatTile label="Писем отправлено всего" value={p.emailsTotal} hint="Включая повторные письма" />
            </PersonSection>
          ))}

          {emailsWithoutAuthor > 0 && (
            <p className="text-xs text-ink-faint">
              Писем за период без автора: {emailsWithoutAuthor} — отправлены до того, как отправитель начал
              записываться в саму переписку (и не опознались по подписи в теле письма).
            </p>
          )}
        </div>
      )}
    </>
  );
}
