import { useEffect, useRef, useState } from 'react';

// PAGESPEED_PLAN.md, Э2-1 — общий хук "приблизились к элементу" для тяжёлых
// ресурсов ниже сгиба (сейчас — обе карты Яндекса, 689 КиБ + 2+ с CPU на
// главный поток, см. отчёт PageSpeed). Срабатывает один раз (once=true по
// умолчанию: после первого попадания в rootMargin — disconnect, не следим
// дальше) — тот самый "приблизились" достаточно один раз на весь жизненный
// цикл компонента, повторный уход из вьюпорта не должен выгружать уже
// загруженную карту. Не путать с observer подсветки активного раздела
// оглавления в DistrictGuidePage.tsx — тот про другое (какой раздел сейчас
// виден целиком), этот — "скоро понадобится, начинай грузить заранее".
export function useInView<T extends Element>(rootMargin = '600px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootMargin]);

  return [ref, inView];
}
