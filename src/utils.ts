import { BN } from '@coral-xyz/anchor';
import {
  CANCEL_PENALTY_BPS,
  MIN_PREMIUM_LAMPORTS,
  PREMIUM_BPS,
  RiskTier,
  SECONDS_PER_YEAR,
  USDC_DECIMALS,
} from './constants.js';
import type { PremiumQuote } from './types.js';

export function usdcToLamports(usdc: number): bigint {
  return BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));
}

export function lamportsToUsdc(lamports: bigint): number {
  return Number(lamports) / 10 ** USDC_DECIMALS;
}

export function toBN(value: bigint | number): BN {
  return new BN(value.toString());
}

/**
 * Mirrors the on-chain premium formula in create_policy.rs.
 * premium = coverage * bps / 10000 * duration / SECONDS_PER_YEAR * multiplier / 10000
 * Returned value is floored to match integer division on-chain, and enforces MIN_PREMIUM.
 */
export function calculatePremium(
  coverageLamports: bigint,
  durationSeconds: number,
  riskTier: Exclude<RiskTier, RiskTier.EXTREME>,
  premiumMultiplierBps = 10_000,
  /** Flat price of the envelope from the attestation, base units. Zero when derived. */
  envelopeFlatPremium: bigint | number = 0n,
): PremiumQuote {
  const annualBps = PREMIUM_BPS[riskTier];
  const annualPremium = (coverageLamports * BigInt(annualBps)) / 10_000n;
  const base = (annualPremium * BigInt(durationSeconds)) / BigInt(SECONDS_PER_YEAR);
  // The envelope's price is added before the multiplier, as create_policy does.
  const withEnvelope = base + BigInt(envelopeFlatPremium);
  const adjusted = (withEnvelope * BigInt(premiumMultiplierBps)) / 10_000n;
  const premiumLamports = adjusted < MIN_PREMIUM_LAMPORTS ? MIN_PREMIUM_LAMPORTS : adjusted;
  return {
    premiumLamports,
    coverageLamports,
    durationSeconds,
    riskTier,
    annualBps,
  };
}

/** Refund amount when cancelling a policy mid-term (matches cancel_policy.rs). */
export function calculateCancelRefund(
  premiumPaidLamports: bigint,
  startTime: bigint,
  expiryTime: bigint,
  now: bigint,
): bigint {
  if (now >= expiryTime) return 0n;
  const total = expiryTime - startTime;
  const remaining = expiryTime - now;
  if (total <= 0n || remaining <= 0n) return 0n;
  const gross = (premiumPaidLamports * remaining) / total;
  return (gross * BigInt(10_000 - CANCEL_PENALTY_BPS)) / 10_000n;
}
