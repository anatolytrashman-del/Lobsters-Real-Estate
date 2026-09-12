// Статические HTML-шеллы под разделы админки (владелец, 2026-09-12: «у меня
// дохрена разных страниц, а превью на ту же админку — почему-то как для
// лендинга минск мира»).
//
// Причина ровно та же, что у tz.html/plan.html/estimate.html (см.
// generate-tz-preview-html.mjs): index.html один на все роуты, а его
// <title>/og:* заточены под продающую страницу Red One. Краулер мессенджера
// (Telegram, VK, WhatsApp) JS не выполняет — ссылка на /admin/purchases
// показывала карточку «Офисы и помещения в Минск Мире».
//
// Здесь — тот же приём, но не одним файлом на роут, а каталогом на раздел:
// dist/admin/<раздел>/index.html Vercel отдаёт как статику РАНЬШЕ общего
// rewrite "/(.*)" → index.html (тот же механизм, на котором держится
// пререндер публичных страниц, см. scripts/prerender.mjs). Никакой правки
// vercel.json под каждый новый раздел не требуется — только под ДЕТСКИЕ
// пути с параметром (/admin/objects/:id и подобные): у них своего файла
// нет, для них в vercel.json заведены rewrite'ы на шелл раздела, плюс общий
// /admin/(.*) → /admin/index.html как страховка для всего остального.
//
// Картинка превью у всех разделов одна — фирменная красная обложка с «R»
// (public/og-image.png, дефолт из index.html, тут не трогаем): владелец,
// 2026-09-12 — «у нас была классная обложка красного цвета с буквой R,
// можем на админку её везде поставить». Уникален только текст карточки.
// Публичные страницы — наоборот, получают СВОЮ генерируемую обложку с
// заголовком (см. scripts/generate-og-cards.mjs).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST_DIR = 'dist';
const SITE_ORIGIN = 'https://redevelopment.pro';
const SUFFIX = ' — админка Redevelopment';

// Разделы админки. path — ровно то, что в App.tsx (без ведущего слэша),
// title/description — то, что увидит мессенджер/поисковик.
//
// Скрытые за RequireSuperAdmin страницы (/admin/activity-log,
// /admin/metrics) здесь СОЗНАТЕЛЬНО отсутствуют: у них своих шеллов быть не
// должно (см. комментарий в Sidebar.tsx — «не палить сам факт существования
// страницы с трекингом чужих действий»). Они попадают под общий rewrite
// /admin/(.*) → /admin/index.html и показывают нейтральное «Админка
// Redevelopment», без названия раздела.
const ADMIN_SHELLS = [
  { path: 'admin', title: 'Админка Redevelopment', description: 'Внутренняя CRM: объекты, стройка, финансы, продажи.' },
  { path: 'admin/dashboard', title: 'Дашборд', description: 'Сводка по объектам, задачам и сделкам компании.' },
  { path: 'admin/tasks', title: 'Задачи', description: 'Задачи команды по объектам и стройке: сроки, ответственные, статусы.' },
  { path: 'admin/objects', title: 'Объекты', description: 'Карточки объектов: планировки, кабинеты и рабочие места, статусы.' },
  { path: 'admin/tz', title: 'Техзадания', description: 'Техзадания на просчёт объёмов работ по объектам.' },
  { path: 'admin/estimates', title: 'Сметы', description: 'Сметы подрядчиков: позиции, стоимость, сравнение предложений.' },
  { path: 'admin/purchases', title: 'Закупки', description: 'Поставщики, ведомости материалов и переписка по закупкам.' },
  { path: 'admin/design-projects', title: 'Дизайн-проекты', description: 'Дизайн-проекты и мудборды по объектам.' },
  { path: 'admin/finmodels', title: 'Финмодели', description: 'Финансовые модели объектов: доходность, окупаемость, сценарии.' },
  { path: 'admin/financing', title: 'Финансирование', description: 'Кредиты, лизинг и рассрочки по объектам.' },
  { path: 'admin/transactions', title: 'Транзакции', description: 'Сделки и платежи по объектам: приход, расход, отчёты.' },
  { path: 'admin/documents', title: 'Документы', description: 'Документы и юрлица: шаблоны, генерация, хранение.' },
  { path: 'admin/landings', title: 'Лендинги', description: 'Продающие страницы объектов: адреса, публикация, превью.' },
  { path: 'admin/site-metrics', title: 'Показатели', description: 'Посещаемость сайта: визиты, источники, поисковые запросы.' },
  { path: 'admin/market-offers', title: 'Аналитика рынка', description: 'Предложения с Kufar, Realt и Avito: разбор и проверка.' },
  { path: 'admin/leads', title: 'Лиды', description: 'Заявки с сайта и из рекламы: контакты, требования, статусы.' },
  { path: 'admin/contractors', title: 'Команда', description: 'Подрядчики и сотрудники: контакты, специализация, дни рождения.' },
  { path: 'admin/meeting-summaries', title: 'Саммери встреч', description: 'Записи встреч и краткие итоги с задачами.' },
  { path: 'admin/settings', title: 'Настройки', description: 'Настройки админки: профили доступа, справочники, интеграции.' },
  { path: 'admin/backlog', title: 'Предложить идею', description: 'Бэклог идей и предложений по платформе.' },
];

// Страховка от расхождения с реальным меню: ADMIN_PAGES живёт в
// src/data/pages.ts (TS + иконки lucide, импортировать из голого node
// нельзя — см. тот же приём с плоскими списками в prerender.mjs), поэтому
// просто сверяем адреса регуляркой. Не роняем сборку — новый раздел без
// шелла просто получит нейтральное превью через общий rewrite, это не
// повод краснеть деплою.
function warnOnDrift() {
  let source;
  try {
    source = readFileSync('src/data/pages.ts', 'utf8');
  } catch {
    return;
  }
  const known = new Set(ADMIN_SHELLS.map((s) => `/${s.path}`));
  const missing = [...source.matchAll(/to:\s*'(\/admin\/[^']+)'/g)]
    .map((m) => m[1])
    .filter((route) => !known.has(route));
  if (missing.length > 0) {
    console.warn(
      `[admin-shells] в src/data/pages.ts есть разделы без своего превью: ${missing.join(', ')} — ` +
        'добавьте их в ADMIN_SHELLS (scripts/generate-admin-shells.mjs)',
    );
  }
}

const escapeAttr = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function buildShell(template, { path, title, description }) {
  const fullTitle = title === 'Админка Redevelopment' ? title : `${title}${SUFFIX}`;
  const url = `${SITE_ORIGIN}/${path}`;
  return (
    template
      .replace(/<title>.*?<\/title>/, `<title>${escapeAttr(fullTitle)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeAttr(description)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(fullTitle)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeAttr(description)}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escapeAttr(url)}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapeAttr(fullTitle)}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${escapeAttr(description)}$2`)
      // Внутренняя CRM в индексе не нужна (и canonical вместе с noindex —
      // конфликтующий сигнал), тот же приём, что в generate-tz-preview-html.mjs.
      .replace(/(<meta name="robots" content=")[^"]*(")/, '$1noindex, nofollow$2')
      .replace(/\s*<link rel="canonical"[^>]*>/, '')
      // RealEstateListing из index.html описывает лендинг Red One — на
      // странице CRM это просто неверные данные.
      .replace(
        /(<script type="application\/ld\+json" id="object-json-ld">)[\s\S]*?(<\/script>)/,
        '$1$2',
      )
  );
}

const template = readFileSync(join(DIST_DIR, 'index.html'), 'utf8');
warnOnDrift();

for (const shell of ADMIN_SHELLS) {
  const dir = join(DIST_DIR, shell.path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), buildShell(template, shell));
}

console.log(`[admin-shells] готово: ${ADMIN_SHELLS.length} разделов админки со своим превью`);
