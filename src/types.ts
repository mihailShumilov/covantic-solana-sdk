import type {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import type { BN } from '@coral-xyz/anchor';
import { PolicyState, RiskTier, TriggerType } from './constants.js';

/** Minimal wallet interface compatible with Anchor's Wallet type. */
export interface CovanticWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  payer?: Signer;
}

export interface ProtocolConfig {
  admin: PublicKey;
  oracleAuthority: PublicKey;
  usdcMint: PublicKey;
  policyCounter: bigint;
  paused: boolean;
  premiumMultiplierBps: number;
  bump: number;
}

export interface InsuranceVault {
  authority: PublicKey;
  totalStaked: bigint;
  totalCoverage: bigint;
  totalPremiumsCollected: bigint;
  totalClaimsPaid: bigint;
  stakerCount: number;
  solvencyRatio: number;
  totalStakerRewards: bigint;
  reserveFund: bigint;
  protocolTreasury: bigint;
  bump: number;
}

export interface InsurancePolicy {
  /** Schema version; the program refuses a policy it was not written for. */
  version: number;
  policyId: bigint;
  holder: PublicKey;
  agentAddress: PublicKey;
  coverageAmount: bigint;
  premiumPaid: bigint;
  riskTier: RiskTier;
  startTime: bigint;
  expiryTime: bigint;
  claimSubmittedAt: bigint;
  state: PolicyState;
  triggerType: TriggerType;
  triggerTxSignature: Buffer;
  payoutAmount: bigint;
  bump: number;
}

export interface StakerPosition {
  staker: PublicKey;
  amountStaked: bigint;
  shareBps: number;
  rewardsClaimed: bigint;
  rewardsPending: bigint;
  depositedAt: bigint;
  unstakeRequestedAt: bigint;
  bump: number;
}

/**
 * Oracle-signed risk attestation for an agent. Required for `create_policy`;
 * the program refuses to mint a policy without a live attestation.
 */
export interface RiskAttestation {
  agent: PublicKey;
  tier: RiskTier;
  issuedAt: bigint;
  expiresAt: bigint;
  /** `agentMandateCommitment()` of the envelope this attestation prices. */
  mandateHash: Uint8Array;
  /** What that envelope costs, flat, in base units. */
  envelopeFlatPremium: bigint;
  /** The asset an oracle-manipulation claim may be priced against, or empty. */
  priceTerms: PriceTerms;
  bump: number;
}

/**
 * The feed, decimals and quantity bound an oracle-manipulation claim may be
 * settled with. Attested by the oracle, copied into `PolicyPriceTerms` at
 * purchase. All-zero feed means the agent has no priced habit and such a
 * claim cannot settle on the proof path.
 */
export interface PriceTerms {
  /** Pyth feed id, 32 bytes. */
  feedId: Uint8Array;
  subjectMint: PublicKey;
  subjectDecimals: number;
  maxSubjectQuantity: bigint;
}

/** `PolicyPriceTerms` PDA, written by `create_policy`. */
export interface PolicyPriceTerms extends PriceTerms {
  policyId: bigint;
  holder: PublicKey;
  bump: number;
}

/**
 * The operating envelope the holder is permitted to run the agent in. The
 * quote endpoint derives it from the agent's own record and the oracle
 * commits to it in the attestation; `create_policy` must be handed it
 * unchanged.
 */
export interface AgentMandate {
  maxSingleOutflow: bigint | number;
  maxWindowOutflow: bigint | number;
  windowSeconds: bigint | number;
  minRetainedBalance: bigint | number;
  allowedCounterparties: PublicKey[];
  allowedPrograms: PublicKey[];
  /** sha256 of any richer off-chain mandate document, or 32 zero bytes. */
  manifestHash?: Uint8Array;
}

/** `PolicyAuthorityCheckpoint` PDA: who controlled the covered account when the program looked. */
export interface PolicyAuthorityCheckpoint {
  policyId: bigint;
  coveredAccount: PublicKey;
  owner: PublicKey;
  delegate: PublicKey | null;
  closeAuthority: PublicKey | null;
  frozen: boolean;
  amount: bigint;
  slot: bigint;
  unixTimestamp: bigint;
  /** The reading before the last change of control; absent on a first reading. */
  previous: {
    owner: PublicKey;
    delegate: PublicKey | null;
    closeAuthority: PublicKey | null;
    frozen: boolean;
    amount: bigint;
    slot: bigint;
    unixTimestamp: bigint;
  } | null;
  bump: number;
}

export interface PremiumQuote {
  /** Premium in USDC lamports (6 decimals). */
  premiumLamports: bigint;
  /** Coverage in USDC lamports. */
  coverageLamports: bigint;
  /** Duration in seconds. */
  durationSeconds: number;
  /** Risk tier used for the quote. */
  riskTier: RiskTier;
  /** Annual rate in basis points (before any multiplier). */
  annualBps: number;
}

export interface CreatePolicyParams {
  coverageLamports: bigint | number;
  durationSeconds: number;
  agentAddress: PublicKey;
  usdcMint: PublicKey;
  /**
   * The envelope from the quote, passed back unchanged. The program hashes
   * it and compares against the attestation the quote published; a mismatch
   * is refused with `AttestationMandateMismatch`.
   */
  mandate: AgentMandate;
}

export interface UpsertAttestationParams {
  agent: PublicKey;
  tier: Exclude<RiskTier, RiskTier.EXTREME>;
  /** Validity window in seconds. Clamped server-side to MAX_ATTESTATION_VALIDITY. */
  validForSeconds: number;
  /** `agentMandateCommitment()` of the envelope this attestation prices. Must not be zero. */
  mandateHash: Uint8Array;
  /** Flat price of that envelope in base units; zero when the envelope is derived, not chosen. */
  envelopeFlatPremium?: bigint | number;
  /** Omit for an agent with no priced habit: the program stores all-zero terms. */
  priceTerms?: PriceTerms;
}

export interface SubmitClaimParams {
  policyAddress: PublicKey;
  triggerType: Exclude<TriggerType, TriggerType.NONE>;
  /**
   * Base58 signature of the incident transaction. The program decodes it on
   * chain and refuses anything that is not exactly one 64-byte signature.
   */
  triggerTxSignature: string;
}

export interface BuiltInstruction {
  instruction: TransactionInstruction;
  /** Named account map for inspection/debugging. */
  accounts: Record<string, PublicKey>;
}

/** Anchor uses BN for u64/i64 args; re-exported for caller convenience. */
export type { BN };
