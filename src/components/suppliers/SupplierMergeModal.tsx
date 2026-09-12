import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { mergeSupplierOffers } from '../../lib/supplierMergeApi';
import { UNIVERSAL_SUPPLIERS_TITLE, type SupplierOffer } from '../../data/supplierResearch';
import type { SupplierOfferEmail } from '../../data/supplierOfferEmails';
import type { SupplierQuote } from '../../data/supplierQuotes';
import type { SupplierOrder } from '../../data/supplierOrders';

// Что во что сливаем: target — карточка в "Универсальных поставщиках"
// (остаётся), sources — её дубликаты в профильных категориях (исчезают,
// отдав всё содержимое target). См. lib/supplierMergeApi.ts.
export interface SupplierMergePlan {
  target: SupplierOffer;
  sources: { offer: SupplierOffer; requestTitle: string }[];
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ${few}`;
  return `${count} ${many}`;
}

// Подпись "что именно переедет" — ровно то, из-за чего владелец просил не
// удалять дубликаты, а сливать: "не потерять присланные КП, данные
// карточки, всю переписку и тд". Пустое (совсем голая карточка-дубликат) —
// так и пишем, чтобы было видно, что терять там нечего.
function movedContentLabel(counts: { emails: number; quotes: number; orders: number; files: number }): string {
  const parts: string[] = [];
  if (counts.emails > 0) parts.push(plural(counts.emails, 'письмо', 'письма', 'писем'));
  if (counts.quotes > 0) parts.push(plural(counts.quotes, 'КП', 'КП', 'КП'));
  if (counts.orders > 0) parts.push(plural(counts.orders, 'заявка', 'заявки', 'заявок'));
  if (counts.files > 0) parts.push(plural(counts.files, 'файл', 'файла', 'файлов'));
  return parts.length > 0 ? `переедет: ${parts.join(', ')}` : 'переносить нечего — карточка пустая';
}

export function SupplierMergeModal({
  open,
  plans,
  emails,
  quotes,
  orders,
  intro,
  onClose,
  onMerged,
}: {
  open: boolean;
  plans: SupplierMergePlan[];
  emails: SupplierOfferEmail[];
  quotes: SupplierQuote[];
  orders: SupplierOrder[];
  // Первая фраза модалки — она разная у двух входов в неё: разовая чистка
  // уже накопленных дубликатов и только что добавленный универсальный
  // поставщик, который уже есть в профильных категориях.
  intro: string;
  onClose: () => void;
  onMerged: (merged: SupplierOffer[], removedOfferIds: string[]) => void;
}) {
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function countsFor(offer: SupplierOffer) {
    return {
      emails: emails.filter((e) => e.offerId === offer.id).length,
      quotes: quotes.filter((q) => q.offerId === offer.id).length,
      orders: orders.filter((o) => o.offerId === offer.id).length,
      files: offer.files.length,
    };
  }

  async function handleMerge() {
    setMerging(true);
    setError(null);
    try {
      const merged: SupplierOffer[] = [];
      const removed: string[] = [];
      for (const plan of plans) {
        const result = await mergeSupplierOffers(
          plan.target,
          plan.sources.map((s) => s.offer),
        );
        merged.push(result);
        removed.push(...plan.sources.map((s) => s.offer.id));
      }
      onMerged(merged, removed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось объединить карточки');
    } finally {
      setMerging(false);
    }
  }

  const totalSources = plans.reduce((sum, p) => sum + p.sources.length, 0);

  return (
    <Modal open={open} onClose={merging ? () => {} : onClose} title="Объединить карточки поставщика">
      <p className="text-sm text-ink-muted">{intro}</p>

      <div className="flex flex-col gap-4">
        {plans.map((plan) => (
          <div key={plan.target.id} className="flex flex-col gap-2 rounded-control border border-border p-3">
            <div className="text-sm font-semibold text-ink">{plan.target.name}</div>
            {plan.sources.map((source) => (
              <div key={source.offer.id} className="flex items-start gap-2 text-sm text-ink-muted">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                <span>
                  <span className="font-medium text-ink">«{source.requestTitle}»</span> — {movedContentLabel(countsFor(source.offer))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="text-sm text-ink-muted">
        Останется одна карточка в категории «{UNIVERSAL_SUPPLIERS_TITLE}» — вся переписка, КП, заявки и файлы будут в ней.
        {totalSources > 0 && ` Опустевшие карточки в профильных категориях (${totalSources}) удалим.`}
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={merging}>
          Отмена
        </Button>
        <Button
          type="button"
          onClick={handleMerge}
          disabled={merging || plans.length === 0}
          icon={merging ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
        >
          {merging ? 'Объединяем...' : 'Объединить'}
        </Button>
      </div>
    </Modal>
  );
}
