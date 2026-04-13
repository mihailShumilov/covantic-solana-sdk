import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  COVANTIC_PROGRAM_ID,
  deriveConfigPda,
  derivePolicyPda,
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
});
