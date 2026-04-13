import { describe, expect, it } from 'vitest';
import { Connection, Keypair } from '@solana/web3.js';
import { CovanticClient } from '../src/index.js';

/**
 * Devnet integration smoke test. Skipped unless `COVANTIC_DEVNET=1` is set
 * (and a devnet RPC is reachable). Does NOT send any transactions — only
 * exercises read methods against the deployed program.
 */
const shouldRun = process.env.COVANTIC_DEVNET === '1';
const describeIf = shouldRun ? describe : describe.skip;

describeIf('CovanticClient @ devnet (read-only)', () => {
  const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';

  it('fetches protocol config', async () => {
    const client = new CovanticClient({ connection: new Connection(rpc, 'confirmed') });
    const config = await client.getConfig();
    expect(config).not.toBeNull();
    expect(config?.admin).toBeDefined();
  }, 30_000);

  it('fetches vault stats', async () => {
    const client = new CovanticClient({ connection: new Connection(rpc, 'confirmed') });
    const vault = await client.getVault();
    expect(vault).not.toBeNull();
    expect(typeof vault?.solvencyRatio).toBe('number');
  }, 30_000);

  it('returns null for non-existent staker position', async () => {
    const client = new CovanticClient({ connection: new Connection(rpc, 'confirmed') });
    const random = Keypair.generate().publicKey;
    const position = await client.getStakerPosition(random);
    expect(position).toBeNull();
  }, 30_000);
});
