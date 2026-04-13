import { describe, expect, it } from 'vitest';
import {
  calculateCancelRefund,
  calculatePremium,
  lamportsToUsdc,
  MIN_PREMIUM_LAMPORTS,
  PREMIUM_BPS,
  RiskTier,
  SECONDS_PER_YEAR,
  usdcToLamports,
} from '../src/index.js';

describe('calculatePremium', () => {
  it('LOW tier for 1000 USDC, 1 year → 1% = 10 USDC', () => {
    const q = calculatePremium(usdcToLamports(1_000), SECONDS_PER_YEAR, RiskTier.LOW);
    expect(lamportsToUsdc(q.premiumLamports)).toBeCloseTo(10, 5);
    expect(q.annualBps).toBe(PREMIUM_BPS[RiskTier.LOW]);
  });

  it('MEDIUM tier for 100 USDC, 30 days', () => {
    const coverage = usdcToLamports(100);
    const duration = 30 * 24 * 3_600;
    const q = calculatePremium(coverage, duration, RiskTier.MEDIUM);
    // Expected: 100 * 250/10000 * (30*86400)/31_536_000 = 2.5 * 0.08219... ≈ 0.2054 USDC
    const expected = (100 * 250 * duration) / (10_000 * SECONDS_PER_YEAR);
    expect(lamportsToUsdc(q.premiumLamports)).toBeCloseTo(expected, 4);
  });

  it('HIGH tier for 1M USDC, 7 days → 500 bps pro-rated', () => {
    const coverage = usdcToLamports(1_000_000);
    const duration = 7 * 24 * 3_600;
    const q = calculatePremium(coverage, duration, RiskTier.HIGH);
    const expected = (1_000_000 * 500 * duration) / (10_000 * SECONDS_PER_YEAR);
    expect(lamportsToUsdc(q.premiumLamports)).toBeCloseTo(expected, 2);
  });

  it('applies premium multiplier (caution mode +25%)', () => {
    const base = calculatePremium(usdcToLamports(1_000), SECONDS_PER_YEAR, RiskTier.LOW, 10_000);
    const caution = calculatePremium(
      usdcToLamports(1_000),
      SECONDS_PER_YEAR,
      RiskTier.LOW,
      12_500,
    );
    expect(caution.premiumLamports).toBe((base.premiumLamports * 12_500n) / 10_000n);
  });

  it('enforces MIN_PREMIUM for tiny quotes', () => {
    const q = calculatePremium(1n, 1, RiskTier.LOW);
    expect(q.premiumLamports).toBe(MIN_PREMIUM_LAMPORTS);
  });
});

describe('calculateCancelRefund', () => {
  const premium = usdcToLamports(100);
  const start = 1_000_000_000n;
  const expiry = start + BigInt(SECONDS_PER_YEAR);

  it('returns 0 if expired', () => {
    expect(calculateCancelRefund(premium, start, expiry, expiry + 1n)).toBe(0n);
  });

  it('full remaining term → premium * 80%', () => {
    // At t=start+0, full year remains. refund = premium * 1 * 0.8
    const refund = calculateCancelRefund(premium, start, expiry, start);
    expect(refund).toBe((premium * 8_000n) / 10_000n);
  });

  it('half-way through → premium * 0.5 * 0.8 = premium * 0.4', () => {
    const mid = start + BigInt(SECONDS_PER_YEAR / 2);
    const refund = calculateCancelRefund(premium, start, expiry, mid);
    expect(refund).toBe((premium * 4_000n) / 10_000n);
  });
});
