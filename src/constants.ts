import { PublicKey } from '@solana/web3.js';

export const COVANTIC_PROGRAM_ID = new PublicKey('HrLqdNdxUJq4pgsL4NsUqzfYrGxR7Hy9PHGEeHnj3skL');

/** USDC mint on Solana mainnet-beta (for reference — devnet uses a different mint). */
export const USDC_MAINNET_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/**
 * PDA seeds, verbatim from the program's `constants.rs`.
 *
 * Per-policy accounts are seeded by the policy PDA. Four of them are written
 * by `create_policy` itself: the agent mandate (the operating envelope the
 * premium was quoted for), the balance checkpoint, the authority checkpoint
 * and the price terms. The others are written later by cranks, the holder or
 * a settlement instruction.
 */
export const PDA_SEEDS = {
  CONFIG: Buffer.from('covantic_config'),
  VAULT: Buffer.from('covantic_vault'),
  POLICY: Buffer.from('covantic_policy'),
  STAKER: Buffer.from('covantic_staker'),
  /** Oracle-signed risk attestation — one per agent address. */
  ATTESTATION: Buffer.from('covantic_attestation'),
  /** Operating envelope the holder bought the policy against. Written at purchase. */
  AGENT_MANDATE: Buffer.from('covantic_agent_mandate'),
  /** Balance the exploit and agent-error proofs measure a drop against. Written at purchase. */
  CHECKPOINT: Buffer.from('covantic_checkpoint'),
  /** Who controls the covered account, as the program read it. Written at purchase. */
  AUTHORITY_CHECKPOINT: Buffer.from('covantic_authority_checkpoint'),
  /** Feed, decimals and quantity bound an oracle-manipulation claim may settle with. Written at purchase. */
  POLICY_PRICE_TERMS: Buffer.from('covantic_price_terms'),
  /** The authority set the holder declared as legitimate. Holder-written, matures on a delay. */
  GOVERNANCE_BASELINE: Buffer.from('covantic_gov_baseline'),
  /** Evidence records, one per policy, created by the settlement instruction that paid it. */
  CLAIM_EVIDENCE: Buffer.from('covantic_claim_evidence'),
  EXPLOIT_EVIDENCE: Buffer.from('covantic_exploit_evidence'),
  GOVERNANCE_EVIDENCE: Buffer.from('covantic_gov_evidence'),
  AGENT_ERROR_EVIDENCE: Buffer.from('covantic_agent_error_evidence'),
} as const;

/** Max validity window for a risk attestation (seconds). Matches the program's MAX_ATTESTATION_VALIDITY. */
export const ATTESTATION_MAX_VALIDITY_SECONDS = 3600;

export const USDC_DECIMALS = 6;

export const COVERAGE = {
  MIN_LAMPORTS: 1_000_000n,
  MAX_LAMPORTS: 1_000_000_000_000n,
} as const;

export const DURATION = {
  MIN_SECONDS: 3_600,
  MAX_SECONDS: 30 * 24 * 3_600,
} as const;

/**
 * Risk tier as the assessment produces it. `EXTREME` never reaches the
 * chain: the oracle refuses to attest it, so no policy can carry it.
 */
export enum RiskTier {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  EXTREME = 3,
}

/** The tiers a policy can actually carry. */
export type InsurableTier = RiskTier.LOW | RiskTier.MEDIUM | RiskTier.HIGH;

/** Policy lifecycle, verbatim from `InsurancePolicy::STATE_*` in the program. */
export enum PolicyState {
  ACTIVE = 0,
  CLAIM_PENDING = 1,
  CLAIM_PAID = 2,
  EXPIRED = 3,
  CANCELLED = 4,
}

export enum TriggerType {
  NONE = 0,
  EXPLOIT = 1,
  ORACLE_MANIPULATION = 2,
  AGENT_ERROR = 3,
  GOVERNANCE_ATTACK = 4,
}

/** Annual premium basis points by tier. EXTREME is ineligible for coverage. */
export const PREMIUM_BPS: Record<InsurableTier, number> = {
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

/**
 * Lock periods in seconds — time between claim submission and earliest
 * payout, verbatim from the program's `LOCK_*` constants on a production
 * build. A demo build (`devnet-fast-lock`) shortens every one to 30 s.
 */
export const LOCK_PERIODS: Record<Exclude<TriggerType, TriggerType.NONE>, number> = {
  [TriggerType.EXPLOIT]: 3_600,
  [TriggerType.ORACLE_MANIPULATION]: 3_600,
  [TriggerType.AGENT_ERROR]: 21_600,
  [TriggerType.GOVERNANCE_ATTACK]: 7_200,
};

/**
 * How long a pending claim may stay unresolved past its lock before the
 * permissionless expiry crank may close the policy and release its coverage.
 */
export const CLAIM_RESOLUTION_GRACE_SECONDS = 7 * 24 * 3_600;

/** How long a governance baseline or agent mandate sits before it can support a claim. */
export const GOVERNANCE_BASELINE_DELAY_SECONDS = 3_600;
export const MANDATE_DECLARATION_DELAY_SECONDS = 3_600;

/** How old the pre-incident authority reading may be, at the moment a governance claim is filed. */
export const GOVERNANCE_DRAIN_WINDOW_SECONDS = 30 * 60;

export const UNSTAKE_COOLDOWN_SECONDS = 48 * 3_600;

export const SECONDS_PER_YEAR = 365 * 24 * 3_600;

export const MIN_PREMIUM_LAMPORTS = 1_000n;
export const CANCEL_PENALTY_BPS = 2_000;

/** Base58 Solana transaction signature — what a claim must carry as its trigger identity. */
export const SOLANA_SIGNATURE_REGEX = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/;
