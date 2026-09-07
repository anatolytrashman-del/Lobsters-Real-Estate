// P0.2 аудита безопасности: анонимным (publishable) ключом пробует
// select/insert/update/delete по каждой таблице из полной карты приложения
// и падает (exit code 1), если что-то доступно сверх ожидаемого. Держать
// EXPECTED в синхроне с реальными RLS-политиками при любой их правке —
// это не декларация желаемого, а фиксация того, что anon действительно
// может/не может.
//
// Запуск: node scripts/audit-rls.mjs (или npm run audit:rls). Переменные
// окружения не нужны — URL/anon-ключ те же, что зашиты в src/lib/supabase.ts
// (публичные по дизайну, см. комментарий там).
//
// Как читать вывод: CLOSED-таблица обязана вернуть 0 видимых строк и
// отклонить insert. PUBLIC_SELECT_ALL/TOKEN_SCOPED — select разрешён,
// запись — нет. PUBLIC_FULL_CRUD/PUBLIC_INSERT_ONLY — осознанные
// исключения (публичные страницы без логина), не баг.
//
// Проверка insert безопасна для данных: пробует вставить {} (используются
// дефолты/NULL-допустимые колонки) и, если это неожиданно прошло, тут же
// удаляет созданную строку по id из ответа — мусор в базе не остаётся.
// Insert может быть неубедительным (400 из-за NOT NULL раньше, чем RLS
// успела бы отклонить) — это отдельно помечается как "inconclusive", не
// как проходящая проверка.

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_EQwXLOy5TmSPj5tzKjbSeg_xj6SM2Iz';

const CLOSED = [
  'access_profiles', 'agreement_signatures', 'activity_log', 'avangard_documents',
  'backlog_ideas', 'contractor_documents', 'contractor_research_offers',
  'contractor_research_requests', 'contractors', 'demand_stats', 'design_projects',
  'document_templates', 'estimate_catalog_items', 'fin_models', 'financing_offers',
  'generated_documents', 'lead_notes', 'legal_documents', 'legal_entities',
  'legal_entity_tax_declarations', 'market_offer_dedup_dismissals', 'moodboards',
  'people', 'pledges', 'supplier_research_offers', 'supplier_research_requests',
  'tasks', 'transaction_comments', 'transactions', 'purchases', 'purchase_emails',
  'supplier_offer_emails',
  // market_offers: 2026-09-06, PAGESPEED_PLAN.md Э5-1 — раньше был в
  // PUBLIC_SELECT_ALL с колоночным GRANT (P0.2, 2026-08-28), но
  // `select=*` при column-level privileges Postgres проваливает ВСЮ
  // выборку 42501, а не тихо прячет непозволенные колонки — из-за этого
  // публичная страница месяцами показывала пустую таблицу, и этот же
  // аудит-скрипт бага не ловил (см. новую проверку `expectSelect && !sel.ok`
  // ниже — раньше её не было, отсюда и пробел). Грант снят полностью,
  // безопасный публичный срез — отдельная вью `public_market_offers`
  // (ниже, PUBLIC_SELECT_ALL) с зашитым WHERE reviewed=true AND
  // rejected=false и только безопасными колонками.
  'market_offers',
  // deploy_debounce: чисто служебная метка времени последней пересборки
  // прода (trigger-rebuild.js) — трогает только service_role, ни anon,
  // ни authenticated тут делать нечего (даже read).
  'deploy_debounce',
  // leads: anon без прямого доступа к таблице вообще (ни select, ни insert) —
  // публичное бронирование идёт через RPC create_public_lead, см. ниже.
  'leads',
  // select закрыт (0 строк — там id лида); insert не проверяется автоматически,
  // см. комментарий у PUBLIC_INSERT_ONLY выше — сам факт, что он разрешён,
  // проверен вручную отдельно.
  'workstation_seat_leads',
];

// anon select ожидаемо разрешён (публичные лендинги/гид района), запись — нет.
const PUBLIC_SELECT_ALL = [
  'objects', 'building_plans', 'building_plan_zones', 'public_market_offers',
  'primary_market_offers', 'exchange_rates',
];
// select по токену (share_token) — сама выборка со стороны anon фильтром не
// ограничена (PostgREST этого не видит), но RLS должна пускать только строки
// с непустым share_token; полный дамп таблицы всё равно не ожидается пустым.
const PUBLIC_TOKEN_SCOPED = ['briefs', 'meeting_summaries', 'estimates'];
// осознанный полный CRUD без логина — публичная страница /business-upload.
const PUBLIC_FULL_CRUD = ['district_business_points', 'district_house_flags', 'district_quarter_flags'];
// select закрыт, insert разрешён — публичное бронирование кабинета/лида.
// leads НЕ в этом списке: anon не имеет прямого INSERT на саму таблицу
// (там имя/телефон клиента) — публичная запись идёт только через
// SECURITY DEFINER RPC create_public_lead (insertPublicLead в leadsApi.ts),
// который отдаёт наружу только id, не всю строку. Проверяется отдельно,
// см. probeCreatePublicLeadRpc(). workstation_seat_leads тоже НЕ здесь:
// generic-пробник всегда просит Prefer: return=representation, а этой
// таблице для реального insert (insertWorkstationSeatLead в
// workstationSeatLeadsApi.ts) RETURNING не нужен и не даётся (anon там
// нет SELECT) — генерик-тест на ней всегда даёт ложный 401. Плюс у
// строки обязательные FK на leads/building_plan_zones — нединструктивно
// протестировать anon-ключом без service_role для очистки. Проверено
// вручную (curl, Prefer: return=minimal, реальные id, 201) при последней
// правке; таблица просто не участвует в автоматической insert-проверке.
const PUBLIC_INSERT_ONLY = [];

// Колонки, которых не должно быть в анонимном select public_market_offers —
// внутренние заметки/статусы Светланы/владельца по обсуждению объявления
// и служебные reviewed/rejected (сама вью их не отдаёт, но проверяем на
// случай будущей неосторожной правки её определения).
const MARKET_OFFERS_FORBIDDEN_COLUMNS = [
  'owner_note', 'discussion_note', 'rejected', 'flagged_for_discussion', 'reviewed',
];

const ALL_TABLES = [...CLOSED, ...PUBLIC_SELECT_ALL, ...PUBLIC_TOKEN_SCOPED, ...PUBLIC_FULL_CRUD, ...PUBLIC_INSERT_ONLY];

function headers(extra = {}) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function probeSelect(table) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: headers({ Prefer: 'count=exact', Range: '0-0' }),
  });
  const contentRange = resp.headers.get('content-range');
  const total = contentRange ? Number(contentRange.split('/')[1]) : null;
  let sampleRow = null;
  if (resp.ok) {
    const rows = await resp.json().catch(() => []);
    sampleRow = rows[0] ?? null;
  }
  return { ok: resp.ok, status: resp.status, total, sampleRow };
}

async function probeInsertAndCleanup(table) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: '{}',
  });
  if (resp.status === 201 || resp.status === 200) {
    const rows = await resp.json().catch(() => []);
    const row = rows[0];
    if (row?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${row.id}`, { method: 'DELETE', headers: headers() });
    }
    return { allowed: true, inconclusive: false, status: resp.status, cleanedUp: !!row?.id };
  }
  const body = await resp.json().catch(() => ({}));
  const code = body?.code;
  // 42501 — постгресовская "insufficient privilege" (RLS-политика отклонила).
  // PGRST301/PGRST302 и HTTP 401/403 — тоже отказ, а не двусмысленность.
  const isRlsDenied = code === '42501' || resp.status === 401 || resp.status === 403;
  return { allowed: false, inconclusive: !isRlsDenied, status: resp.status, code };
}

// Публичное бронирование создаёт лида не через прямой insert в таблицу
// (там имя/телефон клиента), а через SECURITY DEFINER RPC create_public_lead
// (см. insertPublicLead в leadsApi.ts). Не создаём здесь настоящую строку
// (этот скрипт может гонять CI на каждый PR — незачем засорять прод leads
// тестовыми записями на каждый прогон): нарочно шлём заведомо невалидный
// p_source, чтобы упасть на check-constraint (code 23514) ВНУТРИ функции —
// если долетели до него, значит anon может вызвать функцию и она реально
// дошла до INSERT (RLS/permission её не блокировали раньше). Любая другая
// ошибка (42501 permission denied, 404 function not found и т.п.) — это
// настоящий провал публичного флоу бронирования.
async function probeCreatePublicLeadRpc() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_public_lead`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      p_name: 'audit-rls.mjs probe', p_source: '__audit_rls_invalid_source__', p_business_type: '',
      p_area: '', p_requirement: '', p_contact: 'audit-rls-probe', p_contact_method: null,
      p_phone: null, p_client_type: null, p_status: '', p_is_warm: false, p_object_id: null,
      p_photo_path: null, p_last_contacted_at: null, p_next_contact_at: null,
    }),
  });
  const body = await resp.json().catch(() => ({}));
  const reachedInsert = resp.status === 400 && body?.code === '23514';
  return { reachedInsert, status: resp.status, code: body?.code };
}

async function main() {
  const seen = new Set();
  const failures = [];
  const inconclusive = [];

  for (const table of ALL_TABLES) {
    seen.add(table);
    const sel = await probeSelect(table);
    const ins = await probeInsertAndCleanup(table);

    const expectSelect = PUBLIC_SELECT_ALL.includes(table) || PUBLIC_TOKEN_SCOPED.includes(table) || PUBLIC_FULL_CRUD.includes(table);
    const expectInsert = PUBLIC_FULL_CRUD.includes(table) || PUBLIC_INSERT_ONLY.includes(table);

    const selVisible = sel.ok && (sel.total ?? 0) > 0;
    const problems = [];

    if (!expectSelect && selVisible) {
      problems.push(`SELECT: anon видит ${sel.total} строк(и), ожидалось 0`);
    }
    // 2026-09-06, PAGESPEED_PLAN.md Э5-1 — раньше проверялось только "anon
    // не видит лишнего", но не "anon реально видит то, что должен". Именно
    // так пропустили публичный market_offers.select('*') с 42501 (Б2) —
    // страница месяцами показывала пустую таблицу, а этот скрипт молчал.
    if (expectSelect && !sel.ok) {
      problems.push(`SELECT: ожидался разрешённым anon, но получил ${sel.status}`);
    }
    if (!expectInsert && ins.allowed) {
      problems.push(`INSERT: прошёл (${ins.cleanedUp ? 'строка удалена после проверки' : 'НЕ УДАЛОСЬ УДАЛИТЬ, проверьте вручную'})`);
    }
    // inconclusive (обычно NOT NULL раньше, чем сработала бы RLS) — это не
    // провал самой политики, просто пустой {} пробник не годится для этой
    // таблицы; настоящий отказ (RLS/permission, не inconclusive) — провал.
    if (expectInsert && !ins.allowed && !ins.inconclusive) {
      problems.push(`INSERT: ожидался разрешённым, но получил ${ins.status}`);
    }
    if (table === 'public_market_offers' && sel.sampleRow) {
      const leaked = MARKET_OFFERS_FORBIDDEN_COLUMNS.filter((c) => c in sel.sampleRow);
      if (leaked.length) problems.push(`SELECT: анону видны админские колонки: ${leaked.join(', ')}`);
    }

    if (problems.length) {
      failures.push({ table, problems });
      console.log(`✗ ${table}`);
      for (const p of problems) console.log(`    ${p}`);
    } else {
      const note = expectInsert && ins.inconclusive ? ' (insert inconclusive, не финальное подтверждение)' : '';
      console.log(`✓ ${table}${note}`);
    }
  }

  const rpc = await probeCreatePublicLeadRpc();
  if (rpc.reachedInsert) {
    console.log('✓ rpc:create_public_lead (публичное бронирование лида)');
  } else {
    failures.push({ table: 'rpc:create_public_lead', problems: [`status=${rpc.status} code=${rpc.code ?? '—'}`] });
    console.log('✗ rpc:create_public_lead');
    console.log(`    status=${rpc.status} code=${rpc.code ?? '—'} — публичное бронирование может быть сломано`);
  }

  console.log('');
  console.log(`Таблиц проверено: ${seen.size}`);
  if (failures.length) {
    console.log(`ПРОВАЛ: ${failures.length} таблиц(а) с неожиданным доступом anon-ключа.`);
    process.exit(1);
  }
  console.log('Всё в рамках ожиданий.');
}

main().catch((err) => {
  console.error('audit-rls.mjs упал с ошибкой:', err);
  process.exit(1);
});
