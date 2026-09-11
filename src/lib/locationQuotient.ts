import { DISTRICT_BUSINESS_CATEGORIES } from '../data/districtBusinessCategories';
import { BUSINESS_BUCKETS, bucketForRawCategory } from './businessBuckets';

export interface BucketLocationQuotient {
  bucketId: string;
  label: string;
  localCount: number;
  citywideCount: number;
  lq: number | null; // null — по корзине нет данных ни локально, ни по району
}

// Location quotient — сколько раз доля категории в квартале больше/меньше
// её же доли по всему району в среднем. LQ = 1 — типично, LQ > 1 —
// категория переконцентрирована именно здесь (высокая конкуренция за эту
// нишу), LQ < 1 — недопредставлена (возможная свободная ниша). Метод
// специально нечувствителен к тому, что у категорий разный "нормальный"
// уровень насыщения (владелец: "ПВЗ хватит 1 на пару домов, а кофеен
// может быть несколько даже в одном доме") — сравнение всегда идёт с
// собственной районной базой категории, не с абсолютным числом точек.
//
// citywide (районная база) — по district_business_points ЦЕЛИКОМ (все
// точки района, 17 из 20 кварталов на 2026-08-26, см. журнал docs/session-journal.md —
// раньше считалась по DISTRICT_PLACE_CATEGORIES, куда пины заносятся
// вручную по одной категории за раз и покрытие сильно отставало).
// local (числитель) — тот же датасет, отфильтрованный по нужному
// кварталу. Оба берутся из DISTRICT_BUSINESS_CATEGORIES
// (data/districtBusinessCategories.ts) — единый источник, поэтому больше
// нет риска задвоить счёт старыми фрагментарными точками по категориям.
export function computeLocationQuotients(quarterId: string): BucketLocationQuotient[] {
  const citywideByBucket: Record<string, number> = {};
  let citywideTotal = 0;
  const localByBucket: Record<string, number> = {};
  let localTotal = 0;

  for (const entry of DISTRICT_BUSINESS_CATEGORIES) {
    const bucketId = entry.rawCategory ? bucketForRawCategory(entry.rawCategory) : null;
    if (!bucketId) continue;
    citywideByBucket[bucketId] = (citywideByBucket[bucketId] ?? 0) + 1;
    citywideTotal += 1;
    if (entry.quarterId === quarterId) {
      localByBucket[bucketId] = (localByBucket[bucketId] ?? 0) + 1;
      localTotal += 1;
    }
  }

  return BUSINESS_BUCKETS.map((bucket) => {
    const localCount = localByBucket[bucket.id] ?? 0;
    const citywideCount = citywideByBucket[bucket.id] ?? 0;
    const localShare = localTotal > 0 ? localCount / localTotal : 0;
    const citywideShare = citywideTotal > 0 ? citywideCount / citywideTotal : 0;
    const lq = citywideShare > 0 && localTotal > 0 ? localShare / citywideShare : null;
    return { bucketId: bucket.id, label: bucket.label, localCount, citywideCount, lq };
  }).filter((b) => b.localCount > 0 || b.citywideCount > 0);
}
