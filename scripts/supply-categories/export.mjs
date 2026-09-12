#!/usr/bin/env node
// Шаг 2а: выгрузить готовые снимки сайтов поставщиков пачками для
// классификации по товарным группам (см. README.md рядом).
//
// Работает через Supabase Management API (SUPABASE_ACCESS_TOKEN — тот же,
// что для SQL-миграций из CLAUDE.md), сервисный ключ не нужен. Пачка — файл
// out/batch-NN.json, который отдаётся одному субагенту.
//
//   node scripts/supply-categories/export.mjs [--all] [--batch=12] [--out=DIR]
//
// По умолчанию берутся только ещё не классифицированные снимки
// (classified_at is null); --all — переклассифицировать всё (после правки
// справочника). Ключ в лог/файлы не попадает.
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_REF = 'iohcdylttyuhwovztrbk';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN не задан');
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const batchSize = Number(args.batch ?? 12);
const outDir = args.out ?? path.join(process.cwd(), 'scripts/supply-categories/out');
const onlyNew = !args.all;

async function query(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!resp.ok) throw new Error(`Management API ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp.json();
}

const rows = await query(`
  select host, website_url, page_title, meta_description, home_text, sections
  from supplier_site_snapshots
  where status = 'done' ${onlyNew ? 'and classified_at is null' : ''}
  order by host
`);

fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) {
  if (/^batch-\d+\.json$/.test(f)) fs.unlinkSync(path.join(outDir, f));
}

// Классификатору нужны названия разделов, не адреса: 250 URL — это лишние
// токены. Дубли названий (одна категория с главной и из каталога под
// разными путями) схлопываем.
const items = rows.map((r) => {
  const titles = [];
  const seen = new Set();
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    const t = String(s?.title ?? '').trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    titles.push(t);
  }
  return {
    host: r.host,
    websiteUrl: r.website_url,
    pageTitle: r.page_title ?? '',
    metaDescription: r.meta_description ?? '',
    homeText: String(r.home_text ?? '').slice(0, 1500),
    sections: titles.slice(0, 160),
  };
});

let n = 0;
for (let i = 0; i < items.length; i += batchSize) {
  n++;
  const file = path.join(outDir, `batch-${String(n).padStart(2, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(items.slice(i, i + batchSize), null, 1));
}
console.log(`снимков: ${items.length}, пачек: ${n}, папка: ${outDir}`);
