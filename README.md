# @covantic/solana-sdk

TypeScript SDK for the [Covantic](https://covantic.org) AI Agent Insurance Protocol on Solana.

Covantic is a parametric insurance protocol for AI agents performing DeFi operations. Agents purchase coverage before a transaction; claims are auto-verified and paid out on-chain via oracle.

This SDK exposes:

- A typed client that builds Anchor instructions and transactions
- PDA derivation, premium calculation, and on-chain data decoding
- A drop-in toolkit for AI agent frameworks (Solana Agent Kit, LangChain, Vercel AI SDK, etc.)

---

## Install

```bash
pnpm add @covantic/solana-sdk @solana/web3.js
# or
npm install @covantic/solana-sdk @solana/web3.js
```

## Quickstart — read-only

```ts
import { Connection } from '@solana/web3.js';
import { CovanticClient } from '@covantic/solana-sdk';

const client = new CovanticClient({
  connection: new Connection('https://api.devnet.solana.com', 'confirmed'),
});

const vault = await client.getVault();
console.log('Total staked USDC:', Number(vault?.totalStaked ?? 0n) / 1e6);
console.log('Solvency ratio:', vault?.solvencyRatio, 'bps');
```

## Quickstart — with a wallet

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { CovanticClient, RiskTier, usdcToLamports } from '@covantic/solana-sdk';

const payer = Keypair.generate(); // load your keypair
const wallet = new Wallet(payer);

const client = new CovanticClient({
  connection: new Connection('https://api.devnet.solana.com'),
  wallet,
});

const USDC_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

// 1) Estimate premium locally for a hypothetical tier (doesn't commit to one).
const estimate = await client.quote({
  coverageLamports: usdcToLamports(1_000),
  durationSeconds: 7 * 24 * 3_600,
  riskTier: RiskTier.MEDIUM,
});
console.log('Premium USDC (if MEDIUM):', Number(estimate.premiumLamports) / 1e6);

// 2) Publish the real tier on-chain. The off-chain risk API does this via
// POST /api/policies/quote — the oracle signs an attestation PDA that
// `create_policy` requires. Without it the transaction below will fail.
const quote = await fetch('https://covantic.org/api/policies/quote', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    coverageAmount: Number(usdcToLamports(1_000)),
    durationSeconds: 7 * 24 * 3_600,
    agentAddress: wallet.publicKey.toBase58(),
  }),
}).then((r) => r.json());

// 3) Buy the policy. Tier comes from the oracle-signed attestation — buyers
// cannot pass one — and the envelope (`mandate`) the quote returned has to be
// handed back unchanged: the program hashes it and compares with the
// attestation. The purchase also writes four per-policy PDAs (mandate,
// balance checkpoint, authority checkpoint, price terms); the client derives
// them.
const { instruction } = await client.createPolicyIx({
  coverageLamports: usdcToLamports(1_000),
  durationSeconds: 7 * 24 * 3_600,
  agentAddress: wallet.publicKey,
  usdcMint: USDC_DEVNET,
  mandate: {
    maxSingleOutflow: quote.mandate.maxSingleOutflowRaw,
    maxWindowOutflow: quote.mandate.maxWindowOutflowRaw,
    windowSeconds: quote.mandate.windowSeconds,
    minRetainedBalance: quote.mandate.minRetainedBalanceRaw,
    allowedCounterparties: quote.mandate.allowedCounterparties.map((k) => new PublicKey(k)),
    allowedPrograms: quote.mandate.allowedPrograms.map((k) => new PublicKey(k)),
  },
});
const signature = await client.sendTransaction([instruction]);
console.log('Policy tx:', signature);
```

## Instruction builders

Every builder returns `{ instruction, accounts }` so callers can compose, simulate, or inspect before sending.

| Method | Instruction | Notes |
| --- | --- | --- |
| `createPolicyIx(params)` | `create_policy` | Transfers USDC premium, creates the Policy PDA plus its mandate, balance checkpoint, authority checkpoint and price terms. Requires a live oracle-signed `RiskAttestation` PDA and the `mandate` the quote returned. |
| `upsertAttestationIx(params)` | `upsert_attestation` | Oracle-only. Writes/refreshes the tier, the envelope commitment and the price terms that `create_policy` consumes. |
| `cancelPolicyIx(addr, mint)` | `cancel_policy` | Refund = remaining × premium × 80% |
| `submitClaimIx(params)` | `submit_claim` | Holder-only, marks policy ClaimPending. `triggerTxSignature` is the Base58 signature of the incident; the program validates it on chain. |
| `stakeIx(params)` | `stake` | Deposit USDC into insurance pool |
| `requestUnstakeIx()` | `request_unstake` | Starts 48-hour cooldown |
| `executeUnstakeIx(mint)` | `execute_unstake` | After cooldown, returns principal + rewards |
| `claimRewardsIx(mint)` | `claim_rewards` | Claim accumulated rewards without unstaking |
| `expirePolicyIx(addr)` | `expire_policy` | Permissionless crank. Also closes a `ClaimPending` policy once its lock and a seven-day resolution grace have elapsed. |

There is no `verify_and_payout` any more. Every payout goes through the trigger's proof
instruction (`verify_and_payout_v2`, `_exploit`, `_governance`, `_agent_error`), which the oracle
backend drives with evidence the program checks for itself. An SDK consumer files claims and reads
the evidence record the settlement left behind (`deriveClaimEvidencePda` and siblings).

## Read methods

```ts
const config = await client.getConfig();
const vault  = await client.getVault();
const policy = await client.getPolicy(holder, policyId);
const all    = await client.listPolicies(holder);
const staker = await client.getStakerPosition(wallet);
const attestation = await client.getAttestation(agentAddress);
const terms = await client.getPriceTerms(policyAddress);
const authority = await client.getAuthorityCheckpoint(policyAddress);
```

## PDAs

`derive*Pda` helpers cover every account the program keys by policy: `deriveAgentMandatePda`,
`deriveBalanceCheckpointPda`, `deriveAuthorityCheckpointPda`, `derivePolicyPriceTermsPda`,
`deriveGovernanceBaselinePda` and the four evidence records. `agentMandateCommitment(envelope)`
computes the hash the oracle attests and `create_policy` checks; it matches the program's
`AgentMandate::commitment()` byte for byte.

## Events

```ts
const listenerId = client.addEventListener('ClaimPaid', (event, slot, sig) => {
  console.log('Claim paid:', event);
});
await client.removeEventListener(listenerId);
```

## AI agent framework integration

```ts
import { CovanticClient } from '@covantic/solana-sdk';
import { covanticToolkit } from '@covantic/solana-sdk/agent-kit';

const tools = covanticToolkit(client, {
  usdcMint: USDC_DEVNET,
  riskApiUrl: 'https://api.covantic.org',
});

// Each tool has { name, description, parameters (JSON Schema), execute(input) }.
// Register with your framework of choice — e.g. Solana Agent Kit, LangChain, OpenAI function calling.
```

Available tools:

- `covantic_get_vault_stats`
- `covantic_quote_premium`
- `covantic_get_risk_score` (requires `riskApiUrl`)
- `covantic_buy_insurance`
- `covantic_list_my_policies`
- `covantic_submit_claim`
- `covantic_cancel_policy`
- `covantic_stake`
- `covantic_claim_staking_rewards`
- `covantic_request_unstake`
- `covantic_execute_unstake`

## Constants

```ts
import {
  COVANTIC_PROGRAM_ID,
  RiskTier,
  PolicyState,
  TriggerType,
  PREMIUM_BPS,
  LOCK_PERIODS,
  UNSTAKE_COOLDOWN_SECONDS,
} from '@covantic/solana-sdk';
```

| Constant | Value |
| --- | --- |
| Program ID | `52KrSMg3rsbtRw3FchxJ9jRwRzQmWcDzg1AiiHHHXz1D` |
| USDC decimals | 6 |
| Coverage | 1 – 1,000,000 USDC |
| Duration | 1 hour – 30 days |
| Premium (annual) | LOW 1%, MEDIUM 2.5%, HIGH 5% |
| Premium split | 70% stakers, 20% reserve, 10% protocol |
| Unstake cooldown | 48 hours |
| Cancel penalty | 20% |

## Development

```bash
pnpm install
pnpm build
pnpm test               # unit tests
COVANTIC_DEVNET=1 pnpm test  # include devnet read-only smoke tests
```

## License

MIT
