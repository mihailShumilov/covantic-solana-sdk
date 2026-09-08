import { describe, expect, it } from 'vitest';
import { agentMandateCommitment } from '../src/index.js';

/**
 * The commitment must match the program's `AgentMandate::commitment()` byte
 * for byte, or a premium is quoted for an envelope the purchase then refuses.
 * The vector below is the one asserted in the program's own unit test
 * (`commitment_tests::commits_to_a_known_value`).
 */

const key = (byte: number) => new Uint8Array(32).fill(byte);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const envelope = (counterparties: Uint8Array[], programs: Uint8Array[]) => ({
  maxSingleOutflowRaw: 100_000_000,
  maxWindowOutflowRaw: 150_000_000,
  windowSeconds: 3_600,
  minRetainedBalanceRaw: 4_600_000_000,
  allowedCounterparties: counterparties,
  allowedPrograms: programs,
});

describe('agentMandateCommitment', () => {
  it('matches the on-chain vector', () => {
    expect(hex(agentMandateCommitment(envelope([key(1)], [key(2)])))).toBe(
      '121da6db6c63adfbd79263f232f1f109da30043c1cad5dd7708c6af28b4ae515',
    );
  });

  it('is independent of the order keys arrive in', () => {
    const a = agentMandateCommitment(envelope([key(1), key(9)], [key(2), key(8)]));
    const b = agentMandateCommitment(envelope([key(9), key(1)], [key(8), key(2)]));
    expect(hex(a)).toBe(hex(b));
  });

  it('changes when the cap changes', () => {
    const quoted = agentMandateCommitment(envelope([], []));
    const narrowed = agentMandateCommitment({
      ...envelope([], []),
      maxSingleOutflowRaw: 1_000_000,
    });
    expect(hex(quoted)).not.toBe(hex(narrowed));
  });
});
