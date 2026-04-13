import { PublicKey } from '@solana/web3.js';
import { COVANTIC_PROGRAM_ID, PDA_SEEDS } from './constants.js';

/** Little-endian u64 buffer (matches the on-chain program encoding). */
function u64LE(value: bigint | number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

export function deriveConfigPda(programId: PublicKey = COVANTIC_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.CONFIG], programId);
}

export function deriveVaultPda(programId: PublicKey = COVANTIC_PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.VAULT], programId);
}

export function derivePolicyPda(
  holder: PublicKey,
  policyId: bigint | number,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.POLICY, holder.toBuffer(), u64LE(policyId)],
    programId,
  );
}

export function deriveStakerPda(
  staker: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.STAKER, staker.toBuffer()], programId);
}
