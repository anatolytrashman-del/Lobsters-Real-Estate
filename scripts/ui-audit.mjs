#!/usr/bin/env node
// UI-аудит страниц: Playwright + axe-core (бесплатно, без сети) + опциональный
// vision-разбор скриншотов через уже подключённый ProxyAPI (Claude Haiku, платно).
//
// Использование:
//   node scripts/ui-audit.mjs <url> [url2 ...] [--vision] [--out <dir>]
//
// На КАЖДОМ url и на 3 вьюпортах (375×800 моб., 768×1024 планшет, 1280×900 десктоп):
//   - гоняет axe-core (реальные нарушения доступности — контраст, alt, размер тап-таргетов);
//   - проверяет горизонтальный overflow страницы (document.documentElement.scrollWidth);
//   - ловит ошибки в консоли браузера и необработанные исключения;
//   - сохраняет полноэкранный скриншот в --out (по умолчанию ./ui-audit-report, в .gitignore).
//
// Флаг --vision дополнительно шлёт каждый скриншот в Claude Haiku 4.5 через ProxyAPI
// (нужен PROXYAPI_KEY в окружении) с просьбой найти визуальные баги, которые axe-core
// в принципе не видит — наехавшие элементы, обрезанный текст, сломанные картинки,
// вылезающие за экран блоки. Это тратит реальные деньги за каждый скриншот, поэтому
// не включено по умолчанию — использовать только при реальной необходимости.

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AXE_SOURCE_PATH = path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js');

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
];

const VISION_MODEL = 'claude-haiku-4-5-20251001';

function parseArgs(argv) {
  const urls = [];
  let vision = false;
  let outDir = path.join(process.cwd(), 'ui-audit-report');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--vision') vision = true;
    else if (arg === '--out') outDir = argv[++i];
    else urls.push(arg);
  }
  return { urls, vision, outDir };
}

function slugForUrl(url) {
  return url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80) || 'page';
}

async function launchBrowser() {
  // Тот же путь, что уже используется в scripts/prerender.mjs для этой же
  // предустановленной песочничной сборки Chromium.
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
}

async function auditPage(browser, url, viewport, outDir, axeSource) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  let axeResult = { violations: [] };
  let overflow = null;
  let screenshotPath = null;
  let navError = null;

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    // Немного времени на асинхронные данные/анимации до снимка состояния.
    await page.waitForTimeout(800);

    overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflowing: doc.scrollWidth > doc.clientWidth + 1,
      };
    });

    if (axeSource) {
      await page.addScriptTag({ content: axeSource });
      axeResult = await page.evaluate(async () => {
        // eslint-disable-next-line no-undef
        return await axe.run(document, { resultTypes: ['violations'] });
      });
    }

    fs.mkdirSync(outDir, { recursive: true });
    screenshotPath = path.join(outDir, `${slugForUrl(url)}__${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (err) {
    navError = err.message;
  } finally {
    await context.close();
  }

  return {
    url,
    viewport: viewport.name,
    navError,
    overflow,
    consoleErrors,
    violations: (axeResult.violations || []).map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      example: v.nodes[0]?.target?.join(' '),
    })),
    screenshotPath,
  };
}

async function visionReview(screenshotPath, url, viewportName) {
  const apiKey = process.env.PROXYAPI_KEY;
  if (!apiKey) {
    return { error: 'PROXYAPI_KEY не задан в окружении — vision-проверка пропущена' };
  }
  const imageBase64 = fs.readFileSync(screenshotPath).toString('base64');
  const body = {
    model: VISION_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
          {
            type: 'text',
            text:
              `Это скриншот страницы ${url} на вьюпорте "${viewportName}" (реальный сайт в разработке). ` +
              'Найди ТОЛЬКО настоящие визуальные баги: наехавшие друг на друга элементы, обрезанный или ' +
              'переполненный текст, сломанные/не загрузившиеся картинки, элементы, вылезающие за пределы ' +
              'экрана, нечитаемый текст на фоне, явно кривое выравнивание. Не придумывай проблем, если их ' +
              'нет — если страница выглядит нормально, так и напиши коротко одной строкой. Отвечай по-русски, ' +
              'кратким списком, без лишних слов.',
          },
        ],
      },
    ],
  };
  let res;
  try {
    res = await fetch('https://api.proxyapi.ru/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { error: `сетевая ошибка при обращении к ProxyAPI: ${err.message}` };
  }
  if (!res.ok) {
    const text = await res.text();
    return { error: `ProxyAPI ответил ${res.status}: ${text.slice(0, 300)}` };
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text).filter(Boolean).join('\n') || '(пустой ответ)';
  return { text };
}

async function main() {
  const { urls, vision, outDir } = parseArgs(process.argv.slice(2));
  if (urls.length === 0) {
    console.error('Использование: node scripts/ui-audit.mjs <url> [url2 ...] [--vision] [--out <dir>]');
    process.exitCode = 1;
    return;
  }

  let axeSource = null;
  if (fs.existsSync(AXE_SOURCE_PATH)) {
    axeSource = fs.readFileSync(AXE_SOURCE_PATH, 'utf8');
  } else {
    console.warn('axe-core не найден в node_modules — проверка доступности будет пропущена (npm install axe-core).');
  }

  const browser = await launchBrowser();
  const allResults = [];
  try {
    for (const url of urls) {
      for (const viewport of VIEWPORTS) {
        console.log(`\n=== ${url} — ${viewport.name} (${viewport.width}×${viewport.height}) ===`);
        const result = await auditPage(browser, url, viewport, outDir, axeSource);
        allResults.push(result);

        if (result.navError) {
          console.log(`  ОШИБКА ЗАГРУЗКИ: ${result.navError}`);
          continue;
        }
        let clean = true;
        if (result.overflow?.overflowing) {
          clean = false;
          console.log(
            `  ⚠ Горизонтальный overflow: scrollWidth=${result.overflow.scrollWidth} > clientWidth=${result.overflow.clientWidth}`,
          );
        }
        if (result.consoleErrors.length) {
          clean = false;
          console.log(`  ⚠ Ошибки в консоли (${result.consoleErrors.length}):`);
          result.consoleErrors.slice(0, 5).forEach((e) => console.log(`    - ${e.slice(0, 200)}`));
        }
        if (result.violations.length) {
          clean = false;
          console.log(`  ⚠ Нарушения доступности, axe-core (${result.violations.length}):`);
          result.violations.forEach((v) =>
            console.log(`    - [${v.impact}] ${v.id}: ${v.help} (${v.nodes} узел(ов), напр. ${v.example})`),
          );
        }
        if (clean) console.log('  ✓ Без нарушений (overflow / консоль / доступность)');
        console.log(`  Скриншот: ${result.screenshotPath}`);

        if (vision && result.screenshotPath) {
          const review = await visionReview(result.screenshotPath, url, viewport.name);
          if (review.error) {
            console.log(`  Vision-проверка: ${review.error}`);
          } else {
            console.log(`  Vision-проверка (Claude Haiku):\n    ${review.text.split('\n').join('\n    ')}`);
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(allResults, null, 2));
  console.log(`\nПолный отчёт: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
