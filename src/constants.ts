import { PublicKey } from '@solana/web3.js';

export const COVANTIC_PROGRAM_ID = new PublicKey('52KrSMg3rsbtRw3FchxJ9jRwRzQmWcDzg1AiiHHHXz1D');

/** USDC mint on Solana mainnet-beta (for reference — devnet uses a different mint). */
export const USDC_MAINNET_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

export const PDA_SEEDS = {
  CONFIG: Buffer.from('covantic_config'),
  VAULT: Buffer.from('covantic_vault'),
  POLICY: Buffer.from('covantic_policy'),
  STAKER: Buffer.from('covantic_staker'),
} as const;

export const USDC_DECIMALS = 6;

export const COVERAGE = {
  MIN_LAMPORTS: 1_000_000n,
  MAX_LAMPORTS: 1_000_000_000_000n,
} as const;

export const DURATION = {
  MIN_SECONDS: 3_600,
  MAX_SECONDS: 30 * 24 * 3_600,
} as const;

export enum RiskTier {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  EXTREME = 3,
}

export enum PolicyState {
  ACTIVE = 0,
  CLAIM_PENDING = 1,
  CLAIM_APPROVED = 2,
  CLAIM_PAID = 3,
  EXPIRED = 4,
  CANCELLED = 5,
}

export enum TriggerType {
  NONE = 0,
  EXPLOIT = 1,
  ORACLE_MANIPULATION = 2,
  AGENT_ERROR = 3,
  GOVERNANCE_ATTACK = 4,
}

/** Annual premium basis points by tier. EXTREME is ineligible for coverage. */
export const PREMIUM_BPS: Record<Exclude<RiskTier, RiskTier.EXTREME>, number> = {
  [RiskTier.LOW]: 100,
  [RiskTier.MEDIUM]: 250,
  [RiskTier.HIGH]: 500,
};

/** Premium distribution (sum = 10000). */
export const PREMIUM_SPLIT = {
  STAKER_BPS: 7000,
  RESERVE_BPS: 2000,
  PROTOCOL_BPS: 1000,
} as const;

/** Lock periods in seconds — time between claim submission and earliest payout. */
export const LOCK_PERIODS: Record<Exclude<TriggerType, TriggerType.NONE>, number> = {
  [TriggerType.EXPLOIT]: 0,
  [TriggerType.ORACLE_MANIPULATION]: 3_600,
  [TriggerType.AGENT_ERROR]: 21_600,
  [TriggerType.GOVERNANCE_ATTACK]: 7_200,
};

export const UNSTAKE_COOLDOWN_SECONDS = 48 * 3_600;

export const SECONDS_PER_YEAR = 365 * 24 * 3_600;

export const MIN_PREMIUM_LAMPORTS = 1_000n;
export const CANCEL_PENALTY_BPS = 2_000;
