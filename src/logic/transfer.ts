import { createPublicClient, http, parseAbi } from 'viem';
import type { MetaTransaction } from 'abstractionkit';
import type { AccountChainConfig, DestinationChainConfig } from './chains';

// ── ABI fragments ──────────────────────────────────────────────

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

// ── Types ──────────────────────────────────────────────────────

export interface TransferIntent {
  totalAmount: bigint;                  // in token's local decimals
  recipient: `0x${string}`;
  destination: DestinationChainConfig;
}

/**
 * Pre-fee allocation produced by `computeTransferSplit`. `amount` is the
 * recipient-side output for this leg.
 */
export interface ChainContribution {
  chainIndex: number;
  amount: bigint;
  type: 'local-transfer' | 'bridge';
}

export interface TransferPlan {
  chainIndex: number;
  transactions: MetaTransaction[];
}

// ── Balance reading ────────────────────────────────────────────

export async function readBalance(
  chain: DestinationChainConfig,
  address: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(chain.jsonRpcProvider) });
  const balance = await client.readContract({
    address: chain.token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return balance;
}

export async function readAllBalances(
  chains: AccountChainConfig[],
  address: `0x${string}`,
): Promise<bigint[]> {
  return Promise.all(chains.map((chain) => readBalance(chain, address)));
}

// ── Transfer split (pre-fee, pure) ─────────────────────────────

/**
 * Pre-fee split: which account chains contribute and how much output each
 * provides. Local-chain destination consumes its balance first (cheap
 * ERC-20 transfer); the rest bridges from other account chains.
 *
 * Throws if the unified balance is short of `intent.totalAmount`. Fee
 * gross-up happens later in `resolveLegs` (Task 8).
 */
export function computeTransferSplit(
  accountChains: AccountChainConfig[],
  balances: bigint[],
  intent: TransferIntent,
): ChainContribution[] {
  const { totalAmount, destination } = intent;
  const contributions: ChainContribution[] = [];
  let remaining = totalAmount;

  const localIndex = accountChains.findIndex(
    (c) => c.chainId === destination.chainId,
  );

  if (localIndex >= 0) {
    const destBalance = balances[localIndex];
    const destContribution = destBalance < remaining ? destBalance : remaining;
    if (destContribution > 0n) {
      contributions.push({
        chainIndex: localIndex,
        amount: destContribution,
        type: 'local-transfer',
      });
      remaining -= destContribution;
    }
  }

  for (let i = 0; i < balances.length && remaining > 0n; i++) {
    if (i === localIndex) continue;
    const available = balances[i];
    const contribution = available < remaining ? available : remaining;
    if (contribution > 0n) {
      contributions.push({
        chainIndex: i,
        amount: contribution,
        type: 'bridge',
      });
      remaining -= contribution;
    }
  }

  if (remaining > 0n) {
    throw new Error(`Insufficient unified balance. Short by ${remaining}`);
  }

  return contributions;
}

// ── (resolveLegs and buildTransferMetaTransactions land in next tasks) ──
