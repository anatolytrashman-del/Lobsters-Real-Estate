// Ежедневный бэкап базы в приватный бакет Storage (db-backups).
//
// Зачем: 2026-09-11 владелец удалил карточку поставщика, а вместе с ней по
// ON DELETE CASCADE ушла вся переписка и заявки. Откатить было нечем — проект
// на free-плане Supabase, где бэкапов нет вообще (ни ежедневных, ни PITR), а
// прочитать ещё не вычищенные автовакуумом мёртвые строки нельзя без
// суперюзера. Тогда спасло то, что вложения писем лежали в Storage отдельно
// от Postgres; этот скрипт делает то же самое осознанно — регулярно кладёт
// снимок ВСЕХ таблиц туда же, в Storage, который переживает любое удаление
// строк в базе.
//
// Чего он НЕ заменяет: это защита от случайного удаления данных, а не от
// потери самого проекта Supabase (снимок лежит внутри него же). Настоящие
// бэкапы — это Pro-план, см. docs/session-journal.md за 2026-09-11.
//
// Бакет приватный: публичной ссылки у файлов нет, скачать можно только
// service-role ключом (или из дашборда). Это важно — в снимке лежат лиды,
// контакты и переписка.

import { createClient } from '@supabase/supabase-js';
import { gzipSync } from 'node:zlib';

const SUPABASE_URL = 'https://iohcdylttyuhwovztrbk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Не задана переменная окружения SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const BUCKET = 'db-backups';
// Сколько снимков держим. Две недели — компромисс с лимитом Storage на
// free-плане (1 ГБ на весь бакет, а там же лежат документы и вложения писем):
// пропажу данных замечают в пределах нескольких дней, а глубже история стоит
// дороже, чем даёт. Если снимок окажется лёгким — можно поднять.
const KEEP_LAST = 14;
// PostgREST отдаёт максимум ~1000 строк за запрос — тянем страницами.
const PAGE = 1000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Список таблиц не зашит в скрипт намеренно: новые сущности появляются
// постоянно, и бэкап, который надо не забыть дописать руками, рано или поздно
// окажется неполным ровно на ту таблицу, которую снесли.
async function listTables() {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SUPABASE_SERVICE_ROLE_KEY}`, {
    headers: { Accept: 'application/openapi+json' },
  });
  if (!resp.ok) throw new Error(`Не удалось получить список таблиц: ${resp.status}`);
  const spec = await resp.json();
  return Object.keys(spec.definitions ?? spec.components?.schemas ?? {}).sort();
}

async function dumpTable(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function pruneOldBackups() {
  const { data, error } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000,
    sortBy: { column: 'name', order: 'desc' },
  });
  if (error) throw new Error(`Не удалось получить список бэкапов: ${error.message}`);
  const stale = data.slice(KEEP_LAST).map((f) => f.name);
  if (stale.length === 0) return 0;
  const { error: delError } = await supabase.storage.from(BUCKET).remove(stale);
  if (delError) throw new Error(`Не удалось удалить старые бэкапы: ${delError.message}`);
  return stale.length;
}

async function main() {
  const tables = await listTables();
  console.log(`Таблиц к выгрузке: ${tables.length}`);

  const dump = {};
  const counts = {};
  const failed = [];
  for (const table of tables) {
    try {
      const rows = await dumpTable(table);
      dump[table] = rows;
      counts[table] = rows.length;
    } catch (err) {
      // Одна недоступная таблица (например, вью без прав) не должна отменять
      // весь бэкап — записываем, что не получилось, и идём дальше.
      failed.push(`${table}: ${err.message}`);
    }
  }

  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const payload = {
    takenAt: new Date().toISOString(),
    project: SUPABASE_URL,
    tables: counts,
    failed,
    data: dump,
  };

  const gz = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const name = `${new Date().toISOString().slice(0, 10)}.json.gz`;

  const { error } = await supabase.storage.from(BUCKET).upload(name, gz, {
    contentType: 'application/gzip',
    upsert: true,
  });
  if (error) throw new Error(`Не удалось загрузить бэкап: ${error.message}`);

  const pruned = await pruneOldBackups();
  console.log(`Снимок ${name}: ${totalRows} строк, ${(gz.length / 1024 / 1024).toFixed(2)} МБ`);
  if (failed.length > 0) console.warn(`Не выгрузились: ${failed.join('; ')}`);
  if (pruned > 0) console.log(`Удалено старых снимков: ${pruned}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
