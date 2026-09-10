// Общий хелпер для OTP-кодов подписания соглашения (agreement-otp-request.js /
// agreement-otp-verify.js) — код никогда не хранится в базе открытым текстом,
// только sha256-хэш; сравнение — timing-safe, чтобы не давать боковой канал
// по времени ответа.

import { createHash, timingSafeEqual } from 'node:crypto';

export function hashOtpCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}

export function otpCodeMatches(code, storedHash) {
  if (!storedHash) return false;
  const actual = Buffer.from(hashOtpCode(code), 'hex');
  const expected = Buffer.from(String(storedHash), 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export const OTP_MAX_ATTEMPTS = 5;

// Чистая логика проверки кода (P1.1 аудита безопасности: "юнит на логику
// проверки кода/TTL/попыток, вынести в чистую функцию") — без сетевых
// запросов, чтобы тестировать ветвление напрямую. Используется в
// agreement-otp-verify.js; сама запись (increment попыток при неверном
// коде, обновление verified_at при успехе) остаётся в хендлере — это
// сайд-эффекты, не часть решения "что делать с этим кодом сейчас".
export function evaluateOtpVerification(row, code, now = new Date()) {
  if (row.verified_at) {
    return { outcome: 'already_verified', documentUrl: row.document_url };
  }
  if (row.otp_attempts >= OTP_MAX_ATTEMPTS) {
    return { outcome: 'too_many_attempts' };
  }
  if (new Date(row.otp_expires_at).getTime() < now.getTime()) {
    return { outcome: 'expired' };
  }
  if (!otpCodeMatches(code, row.otp_code_hash)) {
    return { outcome: 'invalid_code' };
  }
  return { outcome: 'valid' };
}
