import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { IntentAgreementDocument } from './IntentAgreementDocument';
import { cn } from '../../lib/cn';
import { glassCardClass, glassCardShadow, glassPillClass, glassPillShadow } from '../../lib/glass';
import type { ObjectDocumentFile } from '../../data/objects';

// Тот же id стоит на обёртке PublicPlanAndUnits — кнопка "Выбрать кабинет"
// здесь просто скроллит к нему, без прокидывания рефов между соседними
// компонентами страницы.
export const PLAN_AND_UNITS_ANCHOR_ID = 'plan-and-units';

// Дублирует PURCHASE_OPTIONS_ANCHOR_ID из ObjectLandingPage.tsx — тот же
// приём, что и у PLAN_AND_UNITS_ANCHOR_ID выше (строка-якорь продублирована,
// а не импортирована, чтобы компонент не тянул зависимость на страницу).
const PURCHASE_OPTIONS_ANCHOR_ID = 'purchase-options';

interface BookingTermsCardProps {
  agreement: ObjectDocumentFile | null;
}

interface Step {
  title: string;
  description: string;
}

// Полный путь сделки видимым текстом (бронь → соглашение о намерениях,
// подписанное кодом из email — УТП, которого нет у обычных объявлений
// → бронирование без предоплаты → оплата рассрочкой/лизингом/кредитом) —
// снимает типичные возражения и заодно коммерческий фактор для Яндекса
// (см. SEO_PLAN.md, Э1-6).
const steps: Step[] = [
  { title: 'Выберите кабинет', description: 'В списке выше' },
  { title: 'Прочитайте соглашение', description: '2 страницы, без сложных терминов' },
  { title: 'Забронируйте онлайн', description: 'Подписание — кодом из email, без визитов в офис и без оплаты.' },
  { title: 'Оплатите', description: 'Рассрочка, лизинг или кредит — на выбор' },
];

// Блок-закрыватель сомнений, а не справка: раньше был статичным списком
// фактов рядом с иконкой документа, теперь — путь из 4 шагов (полный цикл
// сделки: бронь → соглашение о намерениях → бронирование → оплата, видимым
// текстом — см. SEO_PLAN.md Э1-6). Шаги не отслеживают реальный прогресс
// брони (нет состояния "активен/пройден"), поэтому все выглядят одинаково —
// это общий призыв "вот как легко", а не трекер конкретной заявки. Стоит под
// общим блоком план+список (см. PublicPlanAndUnits) — сначала клиент
// смотрит кабинеты, потом здесь снимаем тревогу и ведём назад к брони.
// Главная кнопка брони — на 3-м шаге (а не на 1-м): бронь физически нельзя
// начать без выбора конкретного кабинета (форма живёт в модалке кабинета
// в PublicPlanAndUnits), так что и там, и там кнопка ведёт к списку — но на
// 3-м шаге это финальный, самый заметный призыв после всего объяснения, а
// не дубль. Шаг 1 — только лёгкая ссылка-подсказка "куда смотреть", шаг 4 —
// ссылка назад к вариантам оплаты (карточка "3 варианта покупки" выше).
export function BookingTermsCard({ agreement }: BookingTermsCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  function scrollToUnits() {
    document.getElementById(PLAN_AND_UNITS_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToPurchaseOptions() {
    document.getElementById(PURCHASE_OPTIONS_ANCHOR_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Из превью соглашения — не просто закрыть модалку, а сразу отправить
  // читателя дальше по воронке. Скролл — на следующий тик, после того как
  // модалка реально уйдёт из DOM, а не в том же обработчике, что её закрывает.
  function handleProceedFromPreview() {
    setPreviewOpen(false);
    requestAnimationFrame(scrollToUnits);
  }

  return (
    <div className={cn('flex flex-col gap-6 p-6', glassCardClass)} style={glassCardShadow}>
      <div className="text-xl font-extrabold text-ink">Онлайн-бронирование без предоплаты</div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, i) => {
          return (
            <div key={step.title} className="flex flex-col gap-3 sm:h-full">
              <div className="flex items-center gap-2">
                <span
                  className={cn('flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-ink', glassPillClass)}
                  style={glassPillShadow}
                >
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-ink">{step.title}</span>
              </div>
              <div className="flex flex-col gap-2 pl-10 sm:flex-1">
                <p className="text-sm font-medium text-ink-muted">{step.description}</p>
                {/* mt-auto прижимает ссылку к низу колонки, чтобы шаги были на
                    одном уровне — но только от sm, где это уже сетка в
                    несколько колонок. Ниже sm колонка одна, и h-full/flex-1/
                    mt-auto друг на друге создавали огромный пустой зазор перед
                    ссылкой первого шага — просто обычный поток с небольшим
                    отступом. */}
                <div className="pt-1 sm:mt-auto">
                  {i === 0 && (
                    <button
                      type="button"
                      onClick={scrollToUnits}
                      className="w-fit text-sm font-semibold text-primary-hover hover:underline"
                    >
                      Смотреть кабинеты ↑
                    </button>
                  )}
                  {i === 1 &&
                    (agreement ? (
                      <button
                        type="button"
                        onClick={() => setPreviewOpen(true)}
                        className="w-fit text-sm font-semibold text-primary-hover hover:underline"
                      >
                        Посмотреть шаблон
                      </button>
                    ) : (
                      <p className="text-xs text-ink-faint">Шаблон соглашения скоро появится здесь.</p>
                    ))}
                  {i === 2 && (
                    <button
                      type="button"
                      onClick={scrollToUnits}
                      className="w-fit text-sm font-semibold text-primary-hover hover:underline"
                    >
                      Забронировать кабинет ↑
                    </button>
                  )}
                  {i === 3 && (
                    <button
                      type="button"
                      onClick={scrollToPurchaseOptions}
                      className="w-fit text-sm font-semibold text-primary-hover hover:underline"
                    >
                      Смотреть варианты ↑
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {previewOpen &&
        agreement &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-ink/40" onClick={() => setPreviewOpen(false)} />
            <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Соглашение о намерениях</span>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={agreement.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-primary"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Скачать
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(false)}
                    aria-label="Закрыть"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-ink-muted hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto rounded-control bg-surface-muted p-3 sm:p-6">
                <IntentAgreementDocument />
              </div>
              <div className="flex flex-col items-start gap-1 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-ink-faint">Согласны с условиями? Выберите кабинет и подпишите онлайн.</p>
                <Button type="button" onClick={handleProceedFromPreview} className="w-fit shrink-0 whitespace-nowrap">
                  Забронировать кабинет
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
