import { sha256 } from '@noble/hashes/sha256';

/**
 * The envelope commitment a premium is quoted against.
 *
 * The oracle hashes the envelope it priced into the attestation it signs,
 * and `create_policy` recomputes the hash from the `mandate` argument it is
 * handed and refuses a mismatch — so the deductible a holder ends up with is
 * the one the premium was quoted for. This is the TypeScript half of
 * `AgentMandate::commitment()` in the program, laid out explicitly rather
 * than delegated to a serialiser: explicit little-endian fields and sorted
 * keys are something both sides implement from the description.
 *
 * `manifestHash` is deliberately excluded, on both sides: it commits to
 * off-chain terms the program cannot read and the oracle does not price.
 */
export interface MandateEnvelope {
  /** Largest single outflow permitted, raw base units of the covered mint. */
  maxSingleOutflowRaw: bigint | number;
  /** Largest cumulative outflow over `windowSeconds`. */
  maxWindowOutflowRaw: bigint | number;
  windowSeconds: bigint | number;
  /** Balance the agent must never take the covered account below. */
  minRetainedBalanceRaw: bigint | number;
  /** Destinations the holder permits, as 32-byte keys. Order does not matter. */
  allowedCounterparties: Uint8Array[];
  /** Programs the holder permits, as 32-byte keys. Order does not matter. */
  allowedPrograms: Uint8Array[];
}

function u64le(v: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(v), true);
  return out;
}

function i64le(v: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(v), true);
  return out;
}

/** Bytewise, matching Rust's `sort_unstable` over `[u8; 32]`. */
function sortedKeys(keys: Uint8Array[]): Uint8Array[] {
  return [...keys].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
    }
    return a.length - b.length;
  });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function agentMandateCommitment(envelope: MandateEnvelope): Uint8Array {
  const counterparties = sortedKeys(envelope.allowedCounterparties);
  const programs = sortedKeys(envelope.allowedPrograms);

  return sha256(
    concat([
      u64le(envelope.maxSingleOutflowRaw),
      u64le(envelope.maxWindowOutflowRaw),
      i64le(envelope.windowSeconds),
      u64le(envelope.minRetainedBalanceRaw),
      Uint8Array.from([counterparties.length]),
      ...counterparties,
      Uint8Array.from([programs.length]),
      ...programs,
    ]),
  );
}
