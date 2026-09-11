import { AlertTriangle } from 'lucide-react';
import type { SupplierReliability } from '../../data/supplierReliability';
import { riskSummary, shouldFlag } from '../../data/supplierReliability';

// Восклицательный знак «с этим поставщиком что-то не так». Владелец,
// 2026-09-11: "Такие моменты должны обязательно выводить уведомлением
// восклицательного знака и в списке поставщиков (прям на главной), и в
// сравнении цен, и в переписке" — отсюда отдельный компонент, а не три
// похожих куска разметки: подписи и цвета в трёх местах обязаны совпадать
// (та же причина, по которой в Suppliers.tsx один VerificationBadge на всё).
//
// Сознательно НЕ показываем ничего в двух случаях: когда рисков нет и когда
// проверки не было вовсе (нет ИНН — счёта ещё не присылали). Зелёная
// галочка "всё чисто" рядом с каждым поставщиком превратила бы список в
// шум, а восклицательный знак в нём перестал бы цеплять взгляд — а он
// здесь именно ради этого.
//
// Ошибку проверки тоже не показываем (shouldFlag её отсекает): "не смогли
// проверить" — это не "нашли проблему". Она видна в карточке поставщика,
// где есть место объяснить словами и дать кнопку повтора.
export function RiskBadge({
  inn,
  reliabilityByInn,
}: {
  inn: string | null;
  reliabilityByInn: Map<string, SupplierReliability>;
}) {
  const reliability = inn ? reliabilityByInn.get(inn) ?? null : null;
  if (!shouldFlag(reliability) || !reliability) return null;

  const danger = reliability.riskLevel === 'danger';
  return (
    <span
      // title, а не кастомный тултип: текст рисков может быть длинным
      // ("22736 дел как ответчик, на 571 398 489 297 ₽"), а нативная
      // подсказка браузера переносит его сама и не ломает вёрстку строки
      // списка. Подробности всё равно есть в карточке.
      title={riskSummary(reliability)}
      aria-label={riskSummary(reliability)}
      className={`inline-flex shrink-0 items-center ${danger ? 'text-danger' : 'text-warning'}`}
    >
      <AlertTriangle className="h-4 w-4" />
    </span>
  );
}
