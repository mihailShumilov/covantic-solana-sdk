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

/** RiskAttestation PDA for a specific agent (one-to-one with `create_policy.agent_address`). */
export function deriveAttestationPda(
  agent: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.ATTESTATION, agent.toBuffer()], programId);
}

function perPolicy(seed: Buffer, policy: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([seed, policy.toBuffer()], programId);
}

/** The operating envelope the policy was bought against. Written by `create_policy`. */
export function deriveAgentMandatePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.AGENT_MANDATE, policy, programId);
}

/** Balance checkpoint the exploit and agent-error proofs measure against. Written by `create_policy`. */
export function deriveBalanceCheckpointPda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.CHECKPOINT, policy, programId);
}

/**
 * Authority checkpoint: who controlled the covered account, as the program
 * read it. `create_policy` writes the first reading, with the agent as owner
 * by construction, which is the permitted state a governance payout later
 * proves a departure from.
 */
export function deriveAuthorityCheckpointPda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.AUTHORITY_CHECKPOINT, policy, programId);
}

/**
 * Price terms fixed at purchase from the oracle-signed attestation: the feed,
 * decimals and quantity bound an oracle-manipulation claim may settle with.
 */
export function derivePolicyPriceTermsPda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.POLICY_PRICE_TERMS, policy, programId);
}

/** The authority set the holder declared as legitimate for the agent. */
export function deriveGovernanceBaselinePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.GOVERNANCE_BASELINE, policy, programId);
}

/** Evidence record created by `verify_and_payout_v2`. */
export function deriveClaimEvidencePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.CLAIM_EVIDENCE, policy, programId);
}

/** Evidence record created by `verify_and_payout_exploit`. */
export function deriveExploitEvidencePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.EXPLOIT_EVIDENCE, policy, programId);
}

/** Evidence record created by `verify_and_payout_governance`. */
export function deriveGovernanceEvidencePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.GOVERNANCE_EVIDENCE, policy, programId);
}

/** Evidence record created by `verify_and_payout_agent_error`. */
export function deriveAgentErrorEvidencePda(
  policy: PublicKey,
  programId: PublicKey = COVANTIC_PROGRAM_ID,
): [PublicKey, number] {
  return perPolicy(PDA_SEEDS.AGENT_ERROR_EVIDENCE, policy, programId);
}
