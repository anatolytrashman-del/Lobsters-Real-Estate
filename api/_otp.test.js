import { describe, expect, it } from 'vitest';
import { hashOtpCode, otpCodeMatches, evaluateOtpVerification, OTP_MAX_ATTEMPTS } from './_otp.js';

describe('hashOtpCode / otpCodeMatches', () => {
  it('одинаковый код даёт одинаковый хэш детерминированно', () => {
    expect(hashOtpCode('123456')).toBe(hashOtpCode('123456'));
  });

  it('otpCodeMatches: верный код — true, неверный — false', () => {
    const hash = hashOtpCode('123456');
    expect(otpCodeMatches('123456', hash)).toBe(true);
    expect(otpCodeMatches('654321', hash)).toBe(false);
  });

  it('otpCodeMatches: пустой/отсутствующий хэш в базе — false, не исключение', () => {
    expect(otpCodeMatches('123456', null)).toBe(false);
    expect(otpCodeMatches('123456', undefined)).toBe(false);
    expect(otpCodeMatches('123456', '')).toBe(false);
  });
});

function baseRow(overrides = {}) {
  return {
    verified_at: null,
    document_url: null,
    otp_attempts: 0,
    otp_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    otp_code_hash: hashOtpCode('123456'),
    ...overrides,
  };
}

describe('evaluateOtpVerification', () => {
  it('уже подписано — already_verified с готовым documentUrl, код не проверяется вовсе', () => {
    const row = baseRow({ verified_at: '2026-01-01T00:00:00Z', document_url: 'https://example.com/doc.pdf' });
    const result = evaluateOtpVerification(row, 'любой-код');
    expect(result).toEqual({ outcome: 'already_verified', documentUrl: 'https://example.com/doc.pdf' });
  });

  it('исчерпаны попытки — too_many_attempts, даже если код на самом деле верный', () => {
    const row = baseRow({ otp_attempts: OTP_MAX_ATTEMPTS });
    const result = evaluateOtpVerification(row, '123456');
    expect(result.outcome).toBe('too_many_attempts');
  });

  it('попытки ровно на пороге (MAX-1) ещё разрешены — проверяет код', () => {
    const row = baseRow({ otp_attempts: OTP_MAX_ATTEMPTS - 1 });
    const result = evaluateOtpVerification(row, '123456');
    expect(result.outcome).toBe('valid');
  });

  it('код истёк — expired, даже с валидными попытками и правильным кодом', () => {
    const row = baseRow({ otp_expires_at: new Date(Date.now() - 1000).toISOString() });
    const result = evaluateOtpVerification(row, '123456');
    expect(result.outcome).toBe('expired');
  });

  it('неверный код (не истёк, попытки есть) — invalid_code', () => {
    const row = baseRow();
    const result = evaluateOtpVerification(row, '000000');
    expect(result.outcome).toBe('invalid_code');
  });

  it('верный код, не истёк, попытки не исчерпаны — valid', () => {
    const row = baseRow();
    const result = evaluateOtpVerification(row, '123456');
    expect(result.outcome).toBe('valid');
  });

  it('порядок проверок: попытки исчерпаны важнее истечения срока', () => {
    const row = baseRow({
      otp_attempts: OTP_MAX_ATTEMPTS,
      otp_expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(evaluateOtpVerification(row, '123456').outcome).toBe('too_many_attempts');
  });

  it('now передаётся явным параметром — детерминированно тестируем истечение без реального ожидания', () => {
    const row = baseRow({ otp_expires_at: '2026-01-01T00:10:00Z' });
    const beforeExpiry = new Date('2026-01-01T00:09:59Z');
    const afterExpiry = new Date('2026-01-01T00:10:01Z');
    expect(evaluateOtpVerification(row, '123456', beforeExpiry).outcome).toBe('valid');
    expect(evaluateOtpVerification(row, '123456', afterExpiry).outcome).toBe('expired');
  });
});
