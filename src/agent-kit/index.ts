/**
 * Framework-agnostic tool definitions for AI agent frameworks
 * (LangChain, Solana Agent Kit, Vercel AI SDK, etc.).
 *
 * Each tool has:
 *  - name        — stable identifier for the tool
 *  - description — human-readable purpose
 *  - parameters  — JSON Schema describing the input
 *  - execute     — async function taking the validated input and returning a result
 *
 * Wrap these with whatever adapter your framework expects.
 */

import { PublicKey } from '@solana/web3.js';
import type { CovanticClient } from '../client.js';
import { RiskTier, TriggerType, UNSTAKE_COOLDOWN_SECONDS } from '../constants.js';
import { lamportsToUsdc, usdcToLamports } from '../utils.js';

export interface AgentToolSpec<I = unknown, O = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: I) => Promise<O>;
}

export interface CovanticToolkitOptions {
  /** USDC mint used by the protocol. Required for any tool that sends USDC. */
  usdcMint: PublicKey;
  /** Optional off-chain risk API base URL (e.g. https://api.covantic.org). */
  riskApiUrl?: string;
}

/**
 * Build a set of Covantic tool specs bound to the given client.
 * The client must have a wallet configured for write tools to succeed.
 */
export function covanticToolkit(
  client: CovanticClient,
  opts: CovanticToolkitOptions,
): AgentToolSpec[] {
  const { usdcMint, riskApiUrl } = opts;

  const tools: AgentToolSpec[] = [
    {
      name: 'covantic_get_vault_stats',
      description:
        'Fetch aggregate Covantic insurance pool stats (total staked, coverage, solvency ratio).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const vault = await client.getVault();
        if (!vault) return { initialized: false };
        return {
          initialized: true,
          totalStakedUsdc: lamportsToUsdc(vault.totalStaked),
          totalCoverageUsdc: lamportsToUsdc(vault.totalCoverage),
          solvencyRatioBps: vault.solvencyRatio,
          stakerCount: vault.stakerCount,
          totalClaimsPaidUsdc: lamportsToUsdc(vault.totalClaimsPaid),
        };
      },
    },

    {
      name: 'covantic_quote_premium',
      description:
        'Calculate the insurance premium for a coverage amount, duration, and risk tier.',
      parameters: {
        type: 'object',
        properties: {
          coverageUsdc: { type: 'number', description: 'Coverage in USDC (not lamports).' },
          durationSeconds: { type: 'number', description: 'Policy duration in seconds.' },
          riskTier: {
            type: 'number',
            description: 'Risk tier: 0=LOW, 1=MEDIUM, 2=HIGH.',
            enum: [0, 1, 2],
          },
        },
        required: ['coverageUsdc', 'durationSeconds', 'riskTier'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { coverageUsdc, durationSeconds, riskTier } = input as {
          coverageUsdc: number;
          durationSeconds: number;
          riskTier: 0 | 1 | 2;
        };
        const quote = await client.quote({
          coverageLamports: usdcToLamports(coverageUsdc),
          durationSeconds,
          riskTier: riskTier as Exclude<RiskTier, RiskTier.EXTREME>,
        });
        return {
          premiumUsdc: lamportsToUsdc(quote.premiumLamports),
          coverageUsdc,
          durationSeconds,
          riskTier,
          annualBps: quote.annualBps,
        };
      },
    },

    {
      name: 'covantic_get_risk_score',
      description:
        'Look up the Covantic risk score and recommended tier for an AI agent wallet. Requires off-chain API URL.',
      parameters: {
        type: 'object',
        properties: {
          agentAddress: { type: 'string', description: 'Solana wallet address of the agent.' },
        },
        required: ['agentAddress'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { agentAddress } = input as { agentAddress: string };
        if (!riskApiUrl) {
          throw new Error(
            'covantic_get_risk_score requires riskApiUrl — pass it in covanticToolkit options.',
          );
        }
        const res = await fetch(`${riskApiUrl.replace(/\/$/, '')}/api/risk/${agentAddress}`);
        if (!res.ok) throw new Error(`Risk API error: ${res.status} ${res.statusText}`);
        return res.json();
      },
    },

    {
      name: 'covantic_buy_insurance',
      description:
        "Purchase a Covantic insurance policy. The risk tier is derived server-side from the agent's latest on-chain assessment — callers do not pick it. Requires `riskApiUrl` to be configured so the backend can publish the oracle-signed attestation that `create_policy` depends on.",
      parameters: {
        type: 'object',
        properties: {
          coverageUsdc: { type: 'number' },
          durationSeconds: { type: 'number' },
          agentAddress: {
            type: 'string',
            description: 'Wallet address of the agent to insure (can equal caller wallet).',
          },
        },
        required: ['coverageUsdc', 'durationSeconds', 'agentAddress'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { coverageUsdc, durationSeconds, agentAddress } = input as {
          coverageUsdc: number;
          durationSeconds: number;
          agentAddress: string;
        };
        if (!riskApiUrl) {
          throw new Error(
            'covantic_buy_insurance requires riskApiUrl — the backend publishes the on-chain risk attestation required by create_policy.',
          );
        }
        // Hit the quote endpoint. Side effects: (1) server derives tier from
        // the latest assessment, (2) oracle publishes (or refreshes) the
        // on-chain attestation PDA, (3) quote is returned. Without this step
        // the create_policy instruction would fail with AccountNotInitialized.
        const quoteRes = await fetch(`${riskApiUrl.replace(/\/$/, '')}/api/policies/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coverageAmount: usdcToLamports(coverageUsdc),
            durationSeconds,
            agentAddress,
          }),
        });
        if (!quoteRes.ok) {
          const body = (await quoteRes.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          throw new Error(
            `Quote failed (${body.code ?? quoteRes.status}): ${body.error ?? quoteRes.statusText}`,
          );
        }
        const quote = (await quoteRes.json()) as {
          riskTier: RiskTier;
          premiumAmount: number;
          mandate: {
            maxSingleOutflowRaw: number;
            maxWindowOutflowRaw: number;
            windowSeconds: number;
            minRetainedBalanceRaw: number;
            allowedCounterparties: string[];
            allowedPrograms: string[];
          };
        };
        // The envelope the quote priced, handed back unchanged: the program
        // recomputes its hash and compares it with the attestation.
        const { instruction } = await client.createPolicyIx({
          coverageLamports: usdcToLamports(coverageUsdc),
          durationSeconds,
          agentAddress: new PublicKey(agentAddress),
          usdcMint,
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
        return {
          signature,
          coverageUsdc,
          durationSeconds,
          riskTier: quote.riskTier,
          premiumUsdc: quote.premiumAmount / 1_000_000,
        };
      },
    },

    {
      name: 'covantic_list_my_policies',
      description: 'List insurance policies held by the caller wallet.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        if (!client.hasWallet) throw new Error('No wallet configured');
        const policies = await client.listPolicies(client.wallet.publicKey);
        return policies.map((p) => ({
          address: p.address.toBase58(),
          policyId: p.data.policyId.toString(),
          state: p.data.state,
          coverageUsdc: lamportsToUsdc(p.data.coverageAmount),
          premiumPaidUsdc: lamportsToUsdc(p.data.premiumPaid),
          expiryTime: Number(p.data.expiryTime),
          agentAddress: p.data.agentAddress.toBase58(),
        }));
      },
    },

    {
      name: 'covantic_submit_claim',
      description:
        'Submit an insurance claim on an active policy. Requires the trigger tx signature of the covered incident.',
      parameters: {
        type: 'object',
        properties: {
          policyAddress: { type: 'string' },
          triggerType: {
            type: 'number',
            enum: [1, 2, 3, 4],
            description: '1=Exploit, 2=OracleManipulation, 3=AgentError, 4=GovernanceAttack',
          },
          triggerTxSignature: {
            type: 'string',
            description: 'Base58 Solana tx signature of the incident.',
          },
        },
        required: ['policyAddress', 'triggerType', 'triggerTxSignature'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { policyAddress, triggerType, triggerTxSignature } = input as {
          policyAddress: string;
          triggerType: 1 | 2 | 3 | 4;
          triggerTxSignature: string;
        };
        const { instruction } = await client.submitClaimIx({
          policyAddress: new PublicKey(policyAddress),
          triggerType: triggerType as Exclude<TriggerType, TriggerType.NONE>,
          triggerTxSignature,
        });
        const signature = await client.sendTransaction([instruction]);
        return { signature };
      },
    },

    {
      name: 'covantic_cancel_policy',
      description:
        'Cancel an active Covantic policy and receive a pro-rata refund (minus 20% penalty).',
      parameters: {
        type: 'object',
        properties: {
          policyAddress: { type: 'string' },
        },
        required: ['policyAddress'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { policyAddress } = input as { policyAddress: string };
        const { instruction } = await client.cancelPolicyIx(new PublicKey(policyAddress), usdcMint);
        const signature = await client.sendTransaction([instruction]);
        return { signature };
      },
    },

    {
      name: 'covantic_stake',
      description: 'Stake USDC into the Covantic insurance pool to earn premium rewards.',
      parameters: {
        type: 'object',
        properties: {
          amountUsdc: { type: 'number' },
        },
        required: ['amountUsdc'],
        additionalProperties: false,
      },
      execute: async (input: unknown) => {
        const { amountUsdc } = input as { amountUsdc: number };
        const { instruction } = await client.stakeIx({
          amountLamports: usdcToLamports(amountUsdc),
          usdcMint,
        });
        const signature = await client.sendTransaction([instruction]);
        return { signature, amountUsdc };
      },
    },

    {
      name: 'covantic_claim_staking_rewards',
      description: 'Claim accumulated staker rewards from the Covantic pool.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const { instruction } = await client.claimRewardsIx(usdcMint);
        const signature = await client.sendTransaction([instruction]);
        return { signature };
      },
    },

    {
      name: 'covantic_request_unstake',
      description: `Start the ${UNSTAKE_COOLDOWN_SECONDS / 3_600}-hour unstake cooldown. Call covantic_execute_unstake after cooldown ends.`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const { instruction } = await client.requestUnstakeIx();
        const signature = await client.sendTransaction([instruction]);
        return {
          signature,
          availableAt: Math.floor(Date.now() / 1000) + UNSTAKE_COOLDOWN_SECONDS,
        };
      },
    },

    {
      name: 'covantic_execute_unstake',
      description:
        'Finalize an unstake after the cooldown has elapsed and receive staked USDC + pending rewards.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => {
        const { instruction } = await client.executeUnstakeIx(usdcMint);
        const signature = await client.sendTransaction([instruction]);
        return { signature };
      },
    },
  ];

  return tools;
}

/**
 * Plugin class for frameworks that expect an object with a `register` method
 * (e.g. Solana Agent Kit). Wraps the toolkit so each tool is registered as an action.
 */
export class CovanticPlugin {
  readonly name = 'covantic';
  readonly description = 'Covantic — AI agent insurance protocol on Solana';

  private readonly tools: AgentToolSpec[];

  constructor(client: CovanticClient, opts: CovanticToolkitOptions) {
    this.tools = covanticToolkit(client, opts);
  }

  getTools(): AgentToolSpec[] {
    return this.tools;
  }

  register(agent: {
    registerAction: (name: string, handler: (input: unknown) => unknown) => void;
  }): void {
    for (const tool of this.tools) {
      agent.registerAction(tool.name, tool.execute);
    }
  }
}
