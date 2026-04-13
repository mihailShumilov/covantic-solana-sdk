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

// 1) Get a quote (reads on-chain multiplier)
const quote = await client.quote({
  coverageLamports: usdcToLamports(1_000),
  durationSeconds: 7 * 24 * 3_600,
  riskTier: RiskTier.MEDIUM,
});
console.log('Premium USDC:', Number(quote.premiumLamports) / 1e6);

// 2) Buy a policy
const { instruction } = await client.createPolicyIx({
  coverageLamports: usdcToLamports(1_000),
  durationSeconds: 7 * 24 * 3_600,
  riskTier: RiskTier.MEDIUM,
  agentAddress: wallet.publicKey,
  usdcMint: USDC_DEVNET,
});
const signature = await client.sendTransaction([instruction]);
console.log('Policy tx:', signature);
```

## Instruction builders

Every builder returns `{ instruction, accounts }` so callers can compose, simulate, or inspect before sending.

| Method | Instruction | Notes |
| --- | --- | --- |
| `createPolicyIx(params)` | `create_policy` | Transfers USDC premium, creates Policy PDA |
| `cancelPolicyIx(addr, mint)` | `cancel_policy` | Refund = remaining × premium × 80% |
| `submitClaimIx(params)` | `submit_claim` | Holder-only, marks policy ClaimPending |
| `stakeIx(params)` | `stake` | Deposit USDC into insurance pool |
| `requestUnstakeIx()` | `request_unstake` | Starts 48-hour cooldown |
| `executeUnstakeIx(mint)` | `execute_unstake` | After cooldown, returns principal + rewards |
| `claimRewardsIx(mint)` | `claim_rewards` | Claim accumulated rewards without unstaking |
| `verifyAndPayoutIx(params)` | `verify_and_payout` | Oracle-only, pays out a claim |
| `expirePolicyIx(addr)` | `expire_policy` | Permissionless crank |

## Read methods

```ts
const config = await client.getConfig();
const vault  = await client.getVault();
const policy = await client.getPolicy(holder, policyId);
const all    = await client.listPolicies(holder);
const staker = await client.getStakerPosition(wallet);
```

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
