// Разовый (но повторно безопасный) прогон по УЖЕ полученным письмам
// поставщиков: распознать счета там, где распознавания не было вовсе, и
// записать в базу то, что висит нераспознанным/неподтверждённым.
//
// Владелец, 2026-09-12: "мне нужно автоматическое распознавание счетов и
// запись в базу ещё до открытия письма нами вручную. В том числе сделай это
// для полученных счетов". Первая половина — код приёма письма
// (api/purchase-email-webhook.js + _invoiceApply.js); эта вторая половина
// разбирает то, что накопилось в переписке до него.
//
// Что делает с каждым ВХОДЯЩИМ письмом поставщика:
//   • extraction пуст, но есть вложения → распознаёт (тем же кодом, что и
//     вебхук) и, если это счёт, записывает в карточку;
//   • extraction.status = 'pending' (распознано, но человек так и не нажал
//     "Подтвердить") → записывает в карточку;
//   • 'confirmed' / 'dismissed' → не трогает: первое уже в базе, второе
//     человек осознанно отклонил.
//
// Повторный запуск безопасен — перед записью проверяется, не попал ли этот
// счёт в карточку раньше другим путём (см. alreadyApplied). Это не
// теоретическая предосторожность: на первом прогоне 2026-09-12 счёт №1806
// ГРИЛЬЯТО-Мастер, заведённый в карточку ещё вручную, добавился вторым КП,
// а вместе с ним вернулся и счёт №1804, который владелец за день до этого
// просил удалить как ошибочный ("счет не Ваш"). Оба применения откатаны по
// снимку extraction.applied, письмо №1804 помечено 'dismissed'.
//
// Запуск:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PROXYAPI_KEY=... \
//     node scripts/backfill-invoice-recognition.mjs [--dry-run] [--limit=N]
//
// CHECKO_API_KEY необязателен — без него просто не будет автопроверки
// благонадёжности по найденным ИНН (она и так делается отдельно).
import { recognizeInvoice, pickInvoiceCandidates, estimatePdfPageCount } from '../api/_invoiceRecognition.js';
import { applyRecognizedInvoice } from '../api/_invoiceApply.js';
import { saveReliabilityIfNew } from '../api/_checko.js';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);

const auth = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
};

async function rest(path, init) {
  const resp = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...auth, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!resp.ok) throw new Error(`Supabase ${init?.method ?? 'GET'} ${path}: ${resp.status} ${await resp.text()}`);
  return resp.status === 204 ? null : resp.json();
}

// В базе у файла письма хранятся только url и fileName — pageCount и size
// (по ним отбираются кандидаты на распознавание, см. pickInvoiceCandidates)
// считаются на приёме письма и никуда не сохраняются. Для старых писем
// добираем их, скачав файл: бакет публичный, файлы небольшие.
async function withFileMetrics(files) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (!f?.url) continue;
    const ext = String(f.fileName || '').split('.').pop()?.toLowerCase();
    try {
      const resp = await fetch(f.url);
      if (!resp.ok) {
        console.warn(`  не скачался ${f.fileName} (${resp.status}) — пропуск`);
        continue;
      }
      const bytes = Buffer.from(await resp.arrayBuffer());
      out.push({ ...f, size: bytes.length, pageCount: ext === 'pdf' ? estimatePdfPageCount(bytes) : 1 });
    } catch (err) {
      console.warn(`  не скачался ${f.fileName}: ${err.message}`);
    }
  }
  return out;
}

// Не попал ли этот счёт в карточку раньше — двумя признаками: уже есть
// строка КП с этим письмом-источником, либо сам файл счёта уже прикреплён к
// карточке поставщика (так делает и ручное подтверждение в переписке, и
// загрузка счёта в форму предложения).
async function alreadyApplied(email, sourceFile) {
  const quotes = await rest(`supplier_offer_quotes?source_email_id=eq.${email.id}&select=id&limit=1`);
  if (quotes.length > 0) return 'КП по этому письму уже заведено';
  if (sourceFile?.url && email.offer_id) {
    const [offer] = await rest(`supplier_research_offers?id=eq.${email.offer_id}&select=files`);
    if ((offer?.files ?? []).some((f) => f?.url === sourceFile.url)) return 'файл счёта уже прикреплён к карточке';
  }
  return null;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  }

  const emails = await rest(
    'supplier_offer_emails?direction=eq.in&select=id,offer_id,order_id,subject,files,extraction&order=created_at.asc',
  );
  console.log(`Входящих писем поставщиков: ${emails.length}${DRY_RUN ? ' (сухой прогон)' : ''}`);

  const stats = { recognized: 0, applied: 0, notInvoice: 0, skipped: 0, failed: 0 };
  let processed = 0;

  for (const email of emails) {
    const status = email.extraction?.status ?? null;
    if (status === 'confirmed' || status === 'dismissed') {
      stats.skipped += 1;
      continue;
    }
    if (LIMIT && processed >= LIMIT) break;

    const label = `${email.subject || '(без темы)'} [${email.id.slice(0, 8)}]`;
    try {
      let recognized = email.extraction;
      let sourceFile = email.extraction?.sourceFile ?? null;

      if (!recognized) {
        const attachments = await withFileMetrics(email.files);
        const candidates = pickInvoiceCandidates(attachments);
        if (candidates.length === 0) {
          stats.skipped += 1;
          continue;
        }
        processed += 1;
        console.log(`\n${label}`);
        for (const candidate of candidates) {
          console.log(`  распознаю: ${candidate.fileName}`);
          const result = await recognizeInvoice(candidate.url, candidate.fileName);
          if (result.isInvoice) {
            recognized = result;
            sourceFile = { url: candidate.url, fileName: candidate.fileName };
            break;
          }
        }
        if (!recognized) {
          console.log('  не счёт — ничего не пишем');
          stats.notInvoice += 1;
          continue;
        }
        stats.recognized += 1;
        console.log(`  счёт: ${recognized.price ?? '—'} ${recognized.currency ?? ''}, позиций ${recognized.items.length}, ИНН ${recognized.supplierInn ?? '—'}`);
      } else {
        processed += 1;
        console.log(`\n${label}\n  уже распознан (pending): ${recognized.price ?? '—'} ${recognized.currency ?? ''}, позиций ${recognized.items.length}`);
      }

      const seen = await alreadyApplied(email, sourceFile);
      if (seen) {
        console.log(`  пропуск — ${seen}`);
        stats.skipped += 1;
        continue;
      }

      if (DRY_RUN) {
        console.log('  сухой прогон — запись пропущена');
        continue;
      }

      await saveReliabilityIfNew(recognized.supplierInn);
      const applied = await applyRecognizedInvoice({
        emailId: email.id,
        offerId: email.offer_id,
        orderId: email.order_id,
        subject: email.subject,
        recognized,
        sourceFile,
      });
      await rest(`supplier_offer_emails?id=eq.${email.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          extraction: {
            status: 'confirmed',
            isInvoice: true,
            price: recognized.price ?? null,
            currency: recognized.currency ?? null,
            items: recognized.items ?? [],
            supplierInn: recognized.supplierInn ?? null,
            sourceFile,
            recognizedAt: recognized.recognizedAt ?? new Date().toISOString(),
            appliedAutomatically: true,
            applied,
          },
        }),
      });
      stats.applied += 1;
      console.log(`  записано в ${applied.target === 'order' ? 'заявку' : 'карточку поставщика'}${applied.quoteId ? ' + строка КП' : ''}`);
    } catch (err) {
      stats.failed += 1;
      console.error(`  ОШИБКА на ${label}: ${err.message}`);
    }
  }

  console.log(`\nИтого: распознано ${stats.recognized}, записано ${stats.applied}, не счёт ${stats.notInvoice}, пропущено ${stats.skipped}, ошибок ${stats.failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
