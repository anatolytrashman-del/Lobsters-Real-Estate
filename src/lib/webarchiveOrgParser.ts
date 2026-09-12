import { parseBplist } from './bplist';
import type { ParsedBusinessEntry } from './districtBusinessPointsApi';

// Разбор .webarchive-выгрузки карточки дома с Яндекс.Карт (владелец прислал
// реальный пример через Cmd+S в Safari, см. журнал docs/session-journal.md, 2026-08-26 —
// предполагавшийся простой .txt оказался не тем, чем Светлана реально
// пользуется). Внутри — binary plist (см. lib/bplist.ts), WebMainResource.
// WebResourceData — это HTML-снимок страницы В МОМЕНТ СОХРАНЕНИЯ (Safari
// сериализует уже отрисованный DOM, не исходный SPA-шелл), поэтому весь
// список организаций уже там как обычная разметка. Разобрано на реальном
// файле владельца (Аэродромная, 32) — каждая организация лежит в
// .search-business-snippet-view, часть карточек (замечено — первые 2-3)
// дублируются вторым блоком на странице (какой-то "похожие"/pinned виджет
// с тем же компонентом) — дедуп по числовому id организации из ссылки на
// её карточку (/maps/org/.../<id>/...).
//
// Фильтр по числу оценок (MIN_REVIEW_COUNT) убран целиком (2026-08-26) —
// оказался нерелевантным. Изначально ставился, чтобы отсечь "точки жителей"
// (неполноценные записи вроде "Seo"/"Механизированная шпаклевка" из более
// раннего примера, Аэродромная 32). Но два реальных живых файла это не
// подтвердили: "Добрыя лекi" (29 оценок на своей странице, 0/null в этой
// конкретной выгрузке списка — блок оценок просто не успел отрендериться) и
// сразу три обычных бизнеса на Жореса Алфёрова 16 (SWG — светильники,
// Stierlitz — автоподбор, Slivka Beauty — салон красоты, у всех троих
// полноценная карточка с фото/категорией/статусом работы, но 0 отзывов и
// без синего бейджа) — все ложно отфильтровались бы. Владелец сам поймал
// это на банкомате Белгазпромбанка ("Ещё нет отзывов") — у сервисных точек
// вроде банкоматов отзывов может не быть вообще никогда, это не признак
// "ненастоящей" точки. Прямого структурного отличия "точки жителя" от
// настоящего бизнеса в разметке карточки найдено не было (обе живые
// выгрузки содержали только полноценные карточки с категорией/ссылкой на
// органайзер /maps/org/.../) — решили не гадать и не отсекать вовсе:
// Светлана и так вручную подтверждает диф перед сохранением (см.
// HouseModal), это и есть настоящий фильтр качества, не эвристика по
// разметке. reviewCount по-прежнему извлекается и показывается в
// интерфейсе — просто больше ничего не отбрасывает.

export function parseWebarchiveOrgList(buffer: ArrayBuffer): ParsedBusinessEntry[] {
  const root = parseBplist(buffer) as { WebMainResource?: { WebResourceData?: Uint8Array } };
  const htmlBytes = root?.WebMainResource?.WebResourceData;
  if (!htmlBytes) throw new Error('В файле не нашлось WebMainResource — это точно .webarchive от Safari?');

  const html = new TextDecoder('utf-8').decode(htmlBytes);
  return extractOrgsFromHtml(html);
}

// Тот же разбор, но для сохранённой страницы в виде обычного HTML — Chrome/
// Edge/Firefox сохраняют так по Ctrl+S → "Страница целиком"/"Только HTML"
// (.html), не .webarchive (это формат только Safari/macOS). Не знаем
// заранее, на чём будет работать фрилансер — поддерживаем оба, разбор
// самого списка организаций один и тот же (см. extractOrgsFromHtml).
export function parseHtmlSnapshotOrgList(html: string): ParsedBusinessEntry[] {
  return extractOrgsFromHtml(html);
}

function extractOrgsFromHtml(html: string): ParsedBusinessEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cards = doc.querySelectorAll('.search-business-snippet-view');

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const entries: ParsedBusinessEntry[] = [];

  for (const card of cards) {
    const titleEl = card.querySelector('.search-business-snippet-view__title');
    const title = titleEl?.textContent?.trim();
    if (!title) continue;

    const linkEl = card.querySelector('a[href*="/maps/org/"]');
    const href = linkEl?.getAttribute('href') ?? '';
    const idMatch = href.match(/\/maps\/org\/[^/]+\/(\d+)\//);
    const orgId = idMatch?.[1] ?? null;

    const dedupKey = orgId ?? title.trim().toLowerCase();
    if (orgId ? seenIds.has(orgId) : seenTitles.has(dedupKey)) continue;
    if (orgId) seenIds.add(orgId);
    seenTitles.add(dedupKey);

    const categoryEl = card.querySelector('.search-business-snippet-view__categories');
    const rawCategory = categoryEl?.textContent?.trim() || null;

    // "25 оценок" / "3 оценки" / "1 оценка" — берём число целиком; нет
    // блока оценок вовсе — null (не 0, это просто "не увидели", не участвует
    // ни в каком отсечении, см. комментарий выше файла).
    const countEl = card.querySelector('.business-rating-amount-view');
    const countMatch = countEl?.textContent?.match(/\d+/);
    const reviewCount = countMatch ? Number(countMatch[0]) : null;

    entries.push({ title, rawCategory, reviewCount });
  }

  return entries;
}

export function looksLikeBplist(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 8));
  return new TextDecoder('ascii').decode(bytes) === 'bplist00';
}
