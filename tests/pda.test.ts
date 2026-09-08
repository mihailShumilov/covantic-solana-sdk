import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  COVANTIC_PROGRAM_ID,
  deriveAgentMandatePda,
  deriveAuthorityCheckpointPda,
  deriveBalanceCheckpointPda,
  deriveConfigPda,
  deriveGovernanceBaselinePda,
  derivePolicyPda,
  derivePolicyPriceTermsPda,
  deriveStakerPda,
  deriveVaultPda,
  PDA_SEEDS,
} from '../src/index.js';

describe('PDA derivation', () => {
  it('derives config PDA deterministically', () => {
    const [pda, bump] = deriveConfigPda();
    const [expected] = PublicKey.findProgramAddressSync([PDA_SEEDS.CONFIG], COVANTIC_PROGRAM_ID);
    expect(pda.equals(expected)).toBe(true);
    expect(typeof bump).toBe('number');
  });

  it('derives vault PDA deterministically', () => {
    const [pda] = deriveVaultPda();
    const [expected] = PublicKey.findProgramAddressSync([PDA_SEEDS.VAULT], COVANTIC_PROGRAM_ID);
    expect(pda.equals(expected)).toBe(true);
  });

  it('derives staker PDA per staker', () => {
    const a = PublicKey.unique();
    const b = PublicKey.unique();
    const [pdaA] = deriveStakerPda(a);
    const [pdaB] = deriveStakerPda(b);
    expect(pdaA.equals(pdaB)).toBe(false);
  });

  it('derives policy PDA from holder + policy_id (u64 LE)', () => {
    const holder = PublicKey.unique();
    const [p0] = derivePolicyPda(holder, 0);
    const [p1] = derivePolicyPda(holder, 1);
    expect(p0.equals(p1)).toBe(false);

    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(42n);
    const [expected] = PublicKey.findProgramAddressSync(
      [PDA_SEEDS.POLICY, holder.toBuffer(), idBuf],
      COVANTIC_PROGRAM_ID,
    );
    const [pda] = derivePolicyPda(holder, 42);
    expect(pda.equals(expected)).toBe(true);
  });

  it('accepts bigint policy IDs beyond u32 range', () => {
    const holder = PublicKey.unique();
    const bigId = 2n ** 33n;
    expect(() => derivePolicyPda(holder, bigId)).not.toThrow();
  });

  it('keys every per-policy account by the policy PDA with its own seed', () => {
    const holder = PublicKey.unique();
    const [policy] = derivePolicyPda(holder, 7);
    const derived = {
      mandate: deriveAgentMandatePda(policy)[0],
      checkpoint: deriveBalanceCheckpointPda(policy)[0],
      authorityCheckpoint: deriveAuthorityCheckpointPda(policy)[0],
      priceTerms: derivePolicyPriceTermsPda(policy)[0],
      baseline: deriveGovernanceBaselinePda(policy)[0],
    };
    const expected = (seed: Buffer) =>
      PublicKey.findProgramAddressSync([seed, policy.toBuffer()], COVANTIC_PROGRAM_ID)[0];
    expect(derived.mandate.equals(expected(PDA_SEEDS.AGENT_MANDATE))).toBe(true);
    expect(derived.checkpoint.equals(expected(PDA_SEEDS.CHECKPOINT))).toBe(true);
    expect(derived.authorityCheckpoint.equals(expected(PDA_SEEDS.AUTHORITY_CHECKPOINT))).toBe(true);
    expect(derived.priceTerms.equals(expected(PDA_SEEDS.POLICY_PRICE_TERMS))).toBe(true);
    expect(derived.baseline.equals(expected(PDA_SEEDS.GOVERNANCE_BASELINE))).toBe(true);
    // Five distinct accounts.
    expect(new Set(Object.values(derived).map((k) => k.toBase58())).size).toBe(5);
  });

  it('uses the seeds the program declares', () => {
    expect(PDA_SEEDS.AUTHORITY_CHECKPOINT.toString()).toBe('covantic_authority_checkpoint');
    expect(PDA_SEEDS.POLICY_PRICE_TERMS.toString()).toBe('covantic_price_terms');
    expect(PDA_SEEDS.AGENT_MANDATE.toString()).toBe('covantic_agent_mandate');
    expect(PDA_SEEDS.CHECKPOINT.toString()).toBe('covantic_checkpoint');
  });
});
