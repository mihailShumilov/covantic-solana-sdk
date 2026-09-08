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
  SOLANA_SIGNATURE_REGEX,
  TriggerType,
} from './constants.js';
import { COVANTIC_IDL } from './idl/covantic.js';
import {
  deriveAgentMandatePda,
  deriveAttestationPda,
  deriveAuthorityCheckpointPda,
  deriveBalanceCheckpointPda,
  deriveConfigPda,
  deriveGovernanceBaselinePda,
  derivePolicyPda,
  derivePolicyPriceTermsPda,
  deriveStakerPda,
  deriveVaultPda,
} from './pda.js';
import type {
  AgentMandate,
  BuiltInstruction,
  CovanticWallet,
  CreatePolicyParams,
  InsurancePolicy,
  InsuranceVault,
  PolicyAuthorityCheckpoint,
  PolicyPriceTerms,
  PremiumQuote,
  PriceTerms,
  ProtocolConfig,
  RiskAttestation,
  StakerPosition,
  SubmitClaimParams,
  UpsertAttestationParams,
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

  attestationPda(agent: PublicKey): PublicKey {
    return deriveAttestationPda(agent, this.programId)[0];
  }

  /** Written by `create_policy`: the envelope the premium was quoted for. */
  agentMandatePda(policy: PublicKey): PublicKey {
    return deriveAgentMandatePda(policy, this.programId)[0];
  }

  /** Written by `create_policy`: the balance the exploit and agent-error proofs measure against. */
  balanceCheckpointPda(policy: PublicKey): PublicKey {
    return deriveBalanceCheckpointPda(policy, this.programId)[0];
  }

  /** Written by `create_policy`: who controlled the covered account, as the program read it. */
  authorityCheckpointPda(policy: PublicKey): PublicKey {
    return deriveAuthorityCheckpointPda(policy, this.programId)[0];
  }

  /** Written by `create_policy`: the feed and quantity bound a price claim may settle with. */
  priceTermsPda(policy: PublicKey): PublicKey {
    return derivePolicyPriceTermsPda(policy, this.programId)[0];
  }

  /** Holder-written declaration of who may control the agent. */
  governanceBaselinePda(policy: PublicKey): PublicKey {
    return deriveGovernanceBaselinePda(policy, this.programId)[0];
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

  /**
   * Fetch the on-chain RiskAttestation PDA for an agent. Returns `null` when
   * no attestation exists (the oracle hasn't published one yet or it was
   * garbage-collected after program upgrade).
   */
  async getAttestation(agent: PublicKey): Promise<RiskAttestation | null> {
    const raw = await this.fetchAccount('riskAttestation', this.attestationPda(agent));
    return raw ? mapAttestation(raw as Raw) : null;
  }

  /** The price terms fixed for a policy at purchase, or `null` for a policy bought before they existed. */
  async getPriceTerms(policyAddress: PublicKey): Promise<PolicyPriceTerms | null> {
    const raw = await this.fetchAccount('policyPriceTerms', this.priceTermsPda(policyAddress));
    return raw ? mapPriceTerms(raw as Raw) : null;
  }

  /** The authority checkpoint for a policy, or `null` when none has been written. */
  async getAuthorityCheckpoint(
    policyAddress: PublicKey,
  ): Promise<PolicyAuthorityCheckpoint | null> {
    const raw = await this.fetchAccount(
      'policyAuthorityCheckpoint',
      this.authorityCheckpointPda(policyAddress),
    );
    return raw ? mapAuthorityCheckpoint(raw as Raw) : null;
  }

  /** List all policies across the program, optionally filtered by holder. */
  async listPolicies(
    holder?: PublicKey,
  ): Promise<Array<{ address: PublicKey; data: InsurancePolicy }>> {
    const accountNamespace = (this.program.account as Record<string, any>).insurancePolicy;
    const filters = holder ? [{ memcmp: { offset: 8 + 8, bytes: holder.toBase58() } }] : undefined;
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

  /**
   * Build a `create_policy` instruction.
   *
   * The program reads the risk tier from the oracle-signed RiskAttestation
   * PDA — callers cannot pass it. Use the off-chain risk API (or the oracle
   * wallet with `upsertAttestationIx`) to mint an attestation before calling
   * this, or the on-chain program will reject with `AccountNotInitialized`.
   */
  async createPolicyIx(params: CreatePolicyParams): Promise<BuiltInstruction> {
    const holder = this.requireWalletPubkey();
    const config = await this.getConfig();
    if (!config) throw new Error('Protocol not initialized');

    const policyId = config.policyCounter;
    const policyPda = this.policyPda(holder, policyId);
    const vaultPda = this.vaultPda();
    const configPda = this.configPda();
    const attestationPda = this.attestationPda(params.agentAddress);
    const holderTokenAccount = getAssociatedTokenAddressSync(params.usdcMint, holder);
    const vaultTokenAccount = getAssociatedTokenAddressSync(params.usdcMint, vaultPda, true);

    // The purchase initialises four per-policy accounts alongside the policy:
    // the mandate it was priced for, the first balance reading, the first
    // authority reading (owner is the agent, verified by the program) and the
    // price terms copied from the attestation. It also reads the agent's
    // covered account, so an agent with no USDC account cannot be insured.
    const accounts = {
      holder,
      config: configPda,
      vault: vaultPda,
      attestation: attestationPda,
      policy: policyPda,
      mandate: this.agentMandatePda(policyPda),
      checkpoint: this.balanceCheckpointPda(policyPda),
      authorityCheckpoint: this.authorityCheckpointPda(policyPda),
      priceTerms: this.priceTermsPda(policyPda),
      coveredTokenAccount: getAssociatedTokenAddressSync(params.usdcMint, params.agentAddress),
      usdcMint: params.usdcMint,
      holderTokenAccount,
      vaultTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };

    const instruction = await this.methods
      .createPolicy(
        toBN(params.coverageLamports),
        toBN(params.durationSeconds),
        params.agentAddress,
        mandateArg(params.mandate),
      )
      .accountsPartial(accounts)
      .instruction();

    return { instruction, accounts };
  }

  /**
   * Build an `upsert_attestation` instruction. The signing wallet MUST be
   * the oracle authority configured in ProtocolConfig; the program rejects
   * all other signers.
   */
  async upsertAttestationIx(params: UpsertAttestationParams): Promise<BuiltInstruction> {
    const oracle = this.requireWalletPubkey();
    const accounts = {
      oracle,
      config: this.configPda(),
      attestation: this.attestationPda(params.agent),
      systemProgram: SystemProgram.programId,
    };

    if (params.mandateHash.length !== 32 || params.mandateHash.every((b) => b === 0)) {
      throw new Error('upsertAttestationIx: mandateHash must be a 32-byte non-zero commitment');
    }
    const terms = params.priceTerms;
    const instruction = await this.methods
      .upsertAttestation(
        params.agent,
        params.tier,
        toBN(params.validForSeconds),
        Array.from(params.mandateHash),
        toBN(params.envelopeFlatPremium ?? 0),
        {
          feedId: Array.from(terms?.feedId ?? new Uint8Array(32)),
          subjectMint: terms?.subjectMint ?? PublicKey.default,
          subjectDecimals: terms?.subjectDecimals ?? 0,
          maxSubjectQuantity: toBN(terms?.maxSubjectQuantity ?? 0),
        },
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

    const instruction = await this.methods.cancelPolicy().accountsPartial(accounts).instruction();

    return { instruction, accounts };
  }

  /**
   * Build a `submit_claim` instruction. The trigger transaction is identified
   * by its Base58 signature, stored on chain as UTF-8 text; the program
   * decodes it and refuses anything that is not exactly one 64-byte
   * signature, so the same check runs here before a transaction is spent.
   */
  async submitClaimIx(params: SubmitClaimParams): Promise<BuiltInstruction> {
    const holder = this.requireWalletPubkey();
    if (!SOLANA_SIGNATURE_REGEX.test(params.triggerTxSignature)) {
      throw new Error(
        'submitClaimIx: triggerTxSignature must be the Base58 signature of the incident transaction',
      );
    }
    const accounts = { holder, policy: params.policyAddress };
    const instruction = await this.methods
      .submitClaim(params.triggerType, Buffer.from(params.triggerTxSignature, 'utf8'))
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
    const instruction = await this.methods.requestUnstake().accountsPartial(accounts).instruction();
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
    const instruction = await this.methods.executeUnstake().accountsPartial(accounts).instruction();
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
    const instruction = await this.methods.claimRewards().accountsPartial(accounts).instruction();
    return { instruction, accounts };
  }

  // There is no unverified settlement instruction. Every payout goes through
  // the trigger's proof instruction — `verify_and_payout_v2`,
  // `verify_and_payout_exploit`, `verify_and_payout_governance` or
  // `verify_and_payout_agent_error` — each driven by the oracle backend with
  // evidence the program checks for itself. An SDK consumer does not settle
  // claims; it files them and reads the evidence record afterwards.

  /** Permissionless crank to mark an expired policy — any signer. */
  async expirePolicyIx(policyAddress: PublicKey): Promise<BuiltInstruction> {
    const cranker = this.requireWalletPubkey();
    const accounts = { cranker, policy: policyAddress, vault: this.vaultPda() };
    const instruction = await this.methods.expirePolicy().accountsPartial(accounts).instruction();
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
      | 'RewardsClaimed'
      | 'AttestationUpserted'
      | 'ClaimProofVerified'
      | 'ExploitProofVerified'
      | 'GovernanceProofVerified'
      | 'AgentErrorProofVerified'
      | 'BalanceCheckpointed'
      | 'AuthorityCheckpointed'
      | 'GovernanceBaselineDeclared'
      | 'AgentMandateDeclared',
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
    version: Number(r.version ?? 1),
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

function mapAttestation(r: Raw): RiskAttestation {
  return {
    agent: r.agent as PublicKey,
    tier: Number(r.tier) as RiskTier,
    issuedAt: BigInt(r.issuedAt.toString()),
    expiresAt: BigInt(r.expiresAt.toString()),
    mandateHash: Uint8Array.from(r.mandateHash ?? new Array(32).fill(0)),
    envelopeFlatPremium: BigInt((r.envelopeFlatPremium ?? 0).toString()),
    priceTerms: mapTerms(r),
    bump: r.bump,
  };
}

function mapTerms(r: Raw): PriceTerms {
  return {
    feedId: Uint8Array.from(r.insuredFeedId ?? r.feedId ?? new Array(32).fill(0)),
    subjectMint: (r.subjectMint as PublicKey | undefined) ?? PublicKey.default,
    subjectDecimals: Number(r.subjectDecimals ?? 0),
    maxSubjectQuantity: BigInt((r.maxSubjectQuantity ?? 0).toString()),
  };
}

function mapPriceTerms(r: Raw): PolicyPriceTerms {
  return {
    ...mapTerms(r),
    policyId: BigInt(r.policyId.toString()),
    holder: r.holder as PublicKey,
    bump: r.bump,
  };
}

function mapAuthorityCheckpoint(r: Raw): PolicyAuthorityCheckpoint {
  const prevSlot = BigInt(r.prevSlot.toString());
  const prevTime = BigInt(r.prevUnixTimestamp.toString());
  return {
    policyId: BigInt(r.policyId.toString()),
    coveredAccount: r.coveredAccount as PublicKey,
    owner: r.owner as PublicKey,
    delegate: (r.delegate as PublicKey | null) ?? null,
    closeAuthority: (r.closeAuthority as PublicKey | null) ?? null,
    frozen: Boolean(r.frozen),
    amount: BigInt(r.amount.toString()),
    slot: BigInt(r.slot.toString()),
    unixTimestamp: BigInt(r.unixTimestamp.toString()),
    previous:
      prevSlot === 0n && prevTime === 0n
        ? null
        : {
            owner: r.prevOwner as PublicKey,
            delegate: (r.prevDelegate as PublicKey | null) ?? null,
            closeAuthority: (r.prevCloseAuthority as PublicKey | null) ?? null,
            frozen: Boolean(r.prevFrozen),
            amount: BigInt(r.prevAmount.toString()),
            slot: prevSlot,
            unixTimestamp: prevTime,
          },
    bump: r.bump,
  };
}

/** The `AgentMandate` argument as Anchor serialises it. */
function mandateArg(m: AgentMandate) {
  return {
    maxSingleOutflow: toBN(m.maxSingleOutflow),
    maxWindowOutflow: toBN(m.maxWindowOutflow),
    windowSeconds: toBN(m.windowSeconds),
    minRetainedBalance: toBN(m.minRetainedBalance),
    allowedCounterparties: m.allowedCounterparties,
    allowedPrograms: m.allowedPrograms,
    manifestHash: Array.from(m.manifestHash ?? new Uint8Array(32)),
  };
}

/** Unused but re-exported so consumers can import alongside. */
export { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, BN };
