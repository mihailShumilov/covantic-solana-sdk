import { AnchorProvider, BN, Program, type Idl } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';

import {
  COVANTIC_PROGRAM_ID,
  PolicyState,
  RiskTier,
  TriggerType,
} from './constants.js';
import { COVANTIC_IDL } from './idl/covantic.js';
import {
  deriveConfigPda,
  derivePolicyPda,
  deriveStakerPda,
  deriveVaultPda,
} from './pda.js';
import type {
  BuiltInstruction,
  CovanticWallet,
  CreatePolicyParams,
  InsurancePolicy,
  InsuranceVault,
  PremiumQuote,
  ProtocolConfig,
  StakerPosition,
} from './types.js';
import { calculatePremium, toBN } from './utils.js';

export interface CovanticClientOptions {
  connection: Connection;
  /** Omit for read-only clients — writes will throw. */
  wallet?: CovanticWallet;
  /** Override for localnet or custom deployments. Defaults to the devnet program ID. */
  programId?: PublicKey;
  /** Confirm commitment for Anchor's provider. Default: 'confirmed'. */
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

/** Read-only placeholder wallet for clients that never send transactions. */
const READ_ONLY_WALLET: CovanticWallet = {
  publicKey: PublicKey.default,
  signTransaction: async () => {
    throw new Error('CovanticClient: no wallet configured — sign operation not available');
  },
  signAllTransactions: async () => {
    throw new Error('CovanticClient: no wallet configured — sign operation not available');
  },
};

/**
 * High-level TypeScript client for the Covantic insurance program.
 *
 * All write methods return either a TransactionInstruction (via *Ix builders)
 * or send a signed transaction (via the higher-level send helpers).
 */
export class CovanticClient {
  readonly connection: Connection;
  readonly programId: PublicKey;
  readonly provider: AnchorProvider;
  readonly program: Program<Idl>;
  readonly wallet: CovanticWallet;

  constructor(opts: CovanticClientOptions) {
    this.connection = opts.connection;
    this.programId = opts.programId ?? COVANTIC_PROGRAM_ID;
    this.wallet = opts.wallet ?? READ_ONLY_WALLET;
    this.provider = new AnchorProvider(this.connection, this.wallet, {
      commitment: opts.commitment ?? 'confirmed',
    });
    const idl = { ...COVANTIC_IDL, address: this.programId.toBase58() } as Idl;
    this.program = new Program(idl, this.provider);
  }

  /** Loosely-typed methods namespace (avoids IDL type narrowing friction). */
  private get methods(): any {
    return this.program.methods;
  }

  /** True if a real wallet was provided at construction time. */
  get hasWallet(): boolean {
    return !this.wallet.publicKey.equals(PublicKey.default);
  }

  // ----- PDA helpers -----

  configPda(): PublicKey {
    return deriveConfigPda(this.programId)[0];
  }

  vaultPda(): PublicKey {
    return deriveVaultPda(this.programId)[0];
  }

  policyPda(holder: PublicKey, policyId: bigint | number): PublicKey {
    return derivePolicyPda(holder, policyId, this.programId)[0];
  }

  stakerPda(staker: PublicKey): PublicKey {
    return deriveStakerPda(staker, this.programId)[0];
  }

  // ----- Read methods -----

  async getConfig(): Promise<ProtocolConfig | null> {
    const raw = await this.fetchAccount('protocolConfig', this.configPda());
    return raw ? (mapConfig(raw) as ProtocolConfig) : null;
  }

  async getVault(): Promise<InsuranceVault | null> {
    const raw = await this.fetchAccount('insuranceVault', this.vaultPda());
    return raw ? (mapVault(raw) as InsuranceVault) : null;
  }

  async getPolicy(holder: PublicKey, policyId: bigint | number): Promise<InsurancePolicy | null> {
    return this.fetchPolicyAt(this.policyPda(holder, policyId));
  }

  async fetchPolicyAt(address: PublicKey): Promise<InsurancePolicy | null> {
    const raw = await this.fetchAccount('insurancePolicy', address);
    return raw ? (mapPolicy(raw) as InsurancePolicy) : null;
  }

  async getStakerPosition(staker: PublicKey): Promise<StakerPosition | null> {
    const raw = await this.fetchAccount('stakerPosition', this.stakerPda(staker));
    return raw ? (mapStaker(raw) as StakerPosition) : null;
  }

  /** List all policies across the program, optionally filtered by holder. */
  async listPolicies(
    holder?: PublicKey,
  ): Promise<Array<{ address: PublicKey; data: InsurancePolicy }>> {
    const accountNamespace = (this.program.account as Record<string, any>).insurancePolicy;
    const filters = holder
      ? [{ memcmp: { offset: 8 + 8, bytes: holder.toBase58() } }]
      : undefined;
    const results = await accountNamespace.all(filters);
    return results.map((r: { publicKey: PublicKey; account: unknown }) => ({
      address: r.publicKey,
      data: mapPolicy(r.account as Raw),
    }));
  }

  // ----- Premium quoting (off-chain, mirrors on-chain math) -----

  /** Returns a premium quote using the current protocol multiplier (if fetched). */
  async quote(params: {
    coverageLamports: bigint;
    durationSeconds: number;
    riskTier: Exclude<RiskTier, RiskTier.EXTREME>;
  }): Promise<PremiumQuote> {
    const config = await this.getConfig();
    const multiplier = config?.premiumMultiplierBps ?? 10_000;
    return calculatePremium(
      params.coverageLamports,
      params.durationSeconds,
      params.riskTier,
      multiplier,
    );
  }

  // ----- Instruction builders -----

  async createPolicyIx(params: CreatePolicyParams): Promise<BuiltInstruction> {
    const holder = this.requireWalletPubkey();
    const config = await this.getConfig();
    if (!config) throw new Error('Protocol not initialized');

    const policyId = config.policyCounter;
    const policyPda = this.policyPda(holder, policyId);
    const vaultPda = this.vaultPda();
    const configPda = this.configPda();
    const holderTokenAccount = getAssociatedTokenAddressSync(params.usdcMint, holder);
    const vaultTokenAccount = getAssociatedTokenAddressSync(params.usdcMint, vaultPda, true);

    const accounts = {
      holder,
      config: configPda,
      vault: vaultPda,
      policy: policyPda,
      holderTokenAccount,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    const instruction = await this.methods
      .createPolicy(
        toBN(params.coverageLamports),
        toBN(params.durationSeconds),
        params.riskTier,
        params.agentAddress,
      )
      .accountsPartial(accounts)
      .instruction();

    return { instruction, accounts };
  }

  async cancelPolicyIx(policyAddress: PublicKey, usdcMint: PublicKey): Promise<BuiltInstruction> {
    const holder = this.requireWalletPubkey();
    const vaultPda = this.vaultPda();

    const accounts = {
      holder,
      policy: policyAddress,
      vault: vaultPda,
      vaultTokenAccount: getAssociatedTokenAddressSync(usdcMint, vaultPda, true),
      holderTokenAccount: getAssociatedTokenAddressSync(usdcMint, holder),
      tokenProgram: TOKEN_PROGRAM_ID,
    };

    const instruction = await this.methods
      .cancelPolicy()
      .accountsPartial(accounts)
      .instruction();

    return { instruction, accounts };
  }

  async submitClaimIx(params: {
    policyAddress: PublicKey;
    triggerType: Exclude<TriggerType, TriggerType.NONE>;
    triggerTxSignature: Buffer | Uint8Array;
  }): Promise<BuiltInstruction> {
    const holder = this.requireWalletPubkey();
    const accounts = { holder, policy: params.policyAddress };
    const sigBuf = Buffer.from(params.triggerTxSignature);
    const instruction = await this.methods
      .submitClaim(params.triggerType, sigBuf)
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  async stakeIx(params: {
    amountLamports: bigint | number;
    usdcMint: PublicKey;
  }): Promise<BuiltInstruction> {
    const staker = this.requireWalletPubkey();
    const vaultPda = this.vaultPda();
    const accounts = {
      staker,
      config: this.configPda(),
      vault: vaultPda,
      stakerPosition: this.stakerPda(staker),
      stakerTokenAccount: getAssociatedTokenAddressSync(params.usdcMint, staker),
      vaultTokenAccount: getAssociatedTokenAddressSync(params.usdcMint, vaultPda, true),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const instruction = await this.methods
      .stake(toBN(params.amountLamports))
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  async requestUnstakeIx(): Promise<BuiltInstruction> {
    const staker = this.requireWalletPubkey();
    const accounts = { staker, stakerPosition: this.stakerPda(staker) };
    const instruction = await this.methods
      .requestUnstake()
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  async executeUnstakeIx(usdcMint: PublicKey): Promise<BuiltInstruction> {
    const staker = this.requireWalletPubkey();
    const vaultPda = this.vaultPda();
    const accounts = {
      staker,
      stakerPosition: this.stakerPda(staker),
      vault: vaultPda,
      vaultTokenAccount: getAssociatedTokenAddressSync(usdcMint, vaultPda, true),
      stakerTokenAccount: getAssociatedTokenAddressSync(usdcMint, staker),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const instruction = await this.methods
      .executeUnstake()
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  async claimRewardsIx(usdcMint: PublicKey): Promise<BuiltInstruction> {
    const staker = this.requireWalletPubkey();
    const vaultPda = this.vaultPda();
    const accounts = {
      staker,
      stakerPosition: this.stakerPda(staker),
      vault: vaultPda,
      vaultTokenAccount: getAssociatedTokenAddressSync(usdcMint, vaultPda, true),
      stakerTokenAccount: getAssociatedTokenAddressSync(usdcMint, staker),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const instruction = await this.methods
      .claimRewards()
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  /**
   * Build the oracle-only `verify_and_payout` instruction. Assumes the caller
   * wallet is the oracle authority; the program will reject otherwise.
   */
  async verifyAndPayoutIx(params: {
    policyAddress: PublicKey;
    policyHolder: PublicKey;
    payoutLamports: bigint | number;
    usdcMint: PublicKey;
  }): Promise<BuiltInstruction> {
    const oracle = this.requireWalletPubkey();
    const vaultPda = this.vaultPda();
    const accounts = {
      oracle,
      config: this.configPda(),
      policy: params.policyAddress,
      vault: vaultPda,
      vaultTokenAccount: getAssociatedTokenAddressSync(params.usdcMint, vaultPda, true),
      holderTokenAccount: getAssociatedTokenAddressSync(params.usdcMint, params.policyHolder),
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const instruction = await this.methods
      .verifyAndPayout(toBN(params.payoutLamports))
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  /** Permissionless crank to mark an expired policy — any signer. */
  async expirePolicyIx(policyAddress: PublicKey): Promise<BuiltInstruction> {
    const cranker = this.requireWalletPubkey();
    const accounts = { cranker, policy: policyAddress, vault: this.vaultPda() };
    const instruction = await this.methods
      .expirePolicy()
      .accountsPartial(accounts)
      .instruction();
    return { instruction, accounts };
  }

  // ----- Higher-level send helpers -----

  /**
   * Build, sign, and send a transaction containing the given instructions.
   * Adds an idempotent ATA-create for the holder's USDC account when one is missing.
   */
  async sendTransaction(
    instructions: TransactionInstruction[],
    opts?: { preflightCommitment?: 'processed' | 'confirmed' | 'finalized' },
  ): Promise<string> {
    if (!this.hasWallet) throw new Error('CovanticClient: cannot send — no wallet configured');
    const tx = new Transaction().add(...instructions);
    tx.feePayer = this.wallet.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    const signed = await this.wallet.signTransaction(tx);
    return this.connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: opts?.preflightCommitment ?? 'confirmed',
    });
  }

  /** Convenience: ensure an ATA exists before depositing USDC. */
  ensureHolderAtaIx(
    owner: PublicKey,
    mint: PublicKey,
    payer: PublicKey = this.wallet.publicKey,
  ): TransactionInstruction {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    return createAssociatedTokenAccountIdempotentInstruction(
      payer,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
  }

  // ----- Events -----

  /** Subscribe to a Covantic program event. Returns a listener ID for removal. */
  addEventListener<T = unknown>(
    eventName:
      | 'PolicyCreated'
      | 'ClaimSubmitted'
      | 'ClaimPaid'
      | 'PolicyCancelled'
      | 'PolicyExpiredEvent'
      | 'Staked'
      | 'UnstakeRequested'
      | 'Unstaked'
      | 'RewardsClaimed',
    callback: (event: T, slot: number, signature: string) => void,
  ): number {
    return this.program.addEventListener(eventName, callback as any);
  }

  async removeEventListener(listenerId: number): Promise<void> {
    await this.program.removeEventListener(listenerId);
  }

  // ----- Internals -----

  private requireWalletPubkey(): PublicKey {
    if (!this.hasWallet) throw new Error('CovanticClient: wallet required for this operation');
    return this.wallet.publicKey;
  }

  private async fetchAccount(name: string, address: PublicKey): Promise<unknown | null> {
    const accountNamespace = (this.program.account as Record<string, any>)[name];
    if (!accountNamespace) throw new Error(`Unknown account type: ${name}`);
    try {
      return await accountNamespace.fetch(address);
    } catch (err) {
      if (err instanceof Error && /Account does not exist/i.test(err.message)) return null;
      throw err;
    }
  }
}

// ----- Raw → TS shape mappers (camelCase BN/Pubkey → our BigInt/PublicKey shape) -----

type Raw = Record<string, any>;

function mapConfig(r: Raw): ProtocolConfig {
  return {
    admin: r.admin,
    oracleAuthority: r.oracleAuthority,
    usdcMint: r.usdcMint,
    policyCounter: BigInt(r.policyCounter.toString()),
    paused: r.paused,
    premiumMultiplierBps: r.premiumMultiplierBps,
    bump: r.bump,
  };
}

function mapVault(r: Raw): InsuranceVault {
  return {
    authority: r.authority,
    totalStaked: BigInt(r.totalStaked.toString()),
    totalCoverage: BigInt(r.totalCoverage.toString()),
    totalPremiumsCollected: BigInt(r.totalPremiumsCollected.toString()),
    totalClaimsPaid: BigInt(r.totalClaimsPaid.toString()),
    stakerCount: Number(r.stakerCount),
    solvencyRatio: Number(r.solvencyRatio),
    totalStakerRewards: BigInt(r.totalStakerRewards.toString()),
    reserveFund: BigInt(r.reserveFund.toString()),
    protocolTreasury: BigInt(r.protocolTreasury.toString()),
    bump: r.bump,
  };
}

function mapPolicy(r: Raw): InsurancePolicy {
  return {
    policyId: BigInt(r.policyId.toString()),
    holder: r.holder,
    agentAddress: r.agentAddress,
    coverageAmount: BigInt(r.coverageAmount.toString()),
    premiumPaid: BigInt(r.premiumPaid.toString()),
    riskTier: r.riskTier as RiskTier,
    startTime: BigInt(r.startTime.toString()),
    expiryTime: BigInt(r.expiryTime.toString()),
    claimSubmittedAt: BigInt(r.claimSubmittedAt.toString()),
    state: r.state as PolicyState,
    triggerType: r.triggerType as TriggerType,
    triggerTxSignature: Buffer.from(r.triggerTxSignature),
    payoutAmount: BigInt(r.payoutAmount.toString()),
    bump: r.bump,
  };
}

function mapStaker(r: Raw): StakerPosition {
  return {
    staker: r.staker,
    amountStaked: BigInt(r.amountStaked.toString()),
    shareBps: Number(r.shareBps),
    rewardsClaimed: BigInt(r.rewardsClaimed.toString()),
    rewardsPending: BigInt(r.rewardsPending.toString()),
    depositedAt: BigInt(r.depositedAt.toString()),
    unstakeRequestedAt: BigInt(r.unstakeRequestedAt.toString()),
    bump: r.bump,
  };
}

/** Unused but re-exported so consumers can import alongside. */
export { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, BN };
