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
  riskTier: Exclude<RiskTier, RiskTier.EXTREME>;
  agentAddress: PublicKey;
  usdcMint: PublicKey;
}

export interface BuiltInstruction {
  instruction: TransactionInstruction;
  /** Named account map for inspection/debugging. */
  accounts: Record<string, PublicKey>;
}

/** Anchor uses BN for u64/i64 args; re-exported for caller convenience. */
export type { BN };
