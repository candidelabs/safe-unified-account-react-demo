import { createPublicClient, http, parseAbi } from 'viem';
import type { MetaTransaction } from 'abstractionkit';
import type { AccountChainConfig, DestinationChainConfig } from './chains';
import {
  quoteAcrossFee,
  grossUpInputAmount,
  type SuggestedFeesQuote,
} from './across';

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

/**
 * A leg with quotes resolved and amounts fitted to source-chain balance.
 * `inputAmount` is what the Safe deposits on the source. `outputAmount` is
 * what the recipient receives on the destination. For local-transfer legs
 * `inputAmount === outputAmount` and `quote` is undefined.
 */
export interface ResolvedLeg {
  chainIndex: number;
  type: 'local-transfer' | 'bridge';
  inputAmount: bigint;
  outputAmount: bigint;
  quote?: SuggestedFeesQuote;
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


// ── Fee-aware leg resolution with spill ────────────────────────

const SPILL_PASS_LIMIT = 2;

/**
 * Quote each bridge leg via Across, gross up `inputAmount` to cover fees,
 * and spill any overflow onto the next chain in `accountChains` order.
 *
 * Local-transfer legs have no fees and pass through unchanged.
 *
 * Bridge legs:
 *   1. Quote Across with `inputAmount := outputTarget`.
 *   2. inputAmount := grossUpInputAmount(outputTarget, quote).
 *   3. If inputAmount > balance: shrink the leg's output so input fits;
 *      remember the resulting output deficit; find a spill target chain
 *      (next account chain in order with unconsumed balance) and credit
 *      its outputAmount with the deficit. Re-quote the spill target.
 *   4. Repeat the whole gross-up sweep up to SPILL_PASS_LIMIT times.
 *      If still infeasible, throw.
 */
export async function resolveLegs(
  accountChains: AccountChainConfig[],
  balances: bigint[],
  contributions: ChainContribution[],
  intent: TransferIntent,
): Promise<ResolvedLeg[]> {
  const outputs = new Map<number, { type: ChainContribution['type']; output: bigint }>();
  for (const c of contributions) {
    outputs.set(c.chainIndex, { type: c.type, output: c.amount });
  }

  const quotes = new Map<number, SuggestedFeesQuote>();

  for (let pass = 0; pass < SPILL_PASS_LIMIT; pass++) {
    let allFit = true;

    for (const [chainIndex, slot] of outputs) {
      if (slot.type === 'local-transfer') continue;

      const sourceChain = accountChains[chainIndex];
      const balance = balances[chainIndex];

      const quote = await quoteAcrossFee({
        sourceChain,
        destinationChain: intent.destination,
        inputAmount: slot.output,
        recipient: intent.recipient,
      });
      quotes.set(chainIndex, quote);

      const requiredInput = grossUpInputAmount(slot.output, quote);
      if (requiredInput <= balance) continue;

      // Shrink this leg until input fits balance.
      const feePct = quote.totalRelayFeePct + quote.lpFeePct;
      const maxOutput = balance * (10n ** 18n - feePct) / (10n ** 18n) - 1n;
      const newOutput = maxOutput < 0n ? 0n : maxOutput;
      const deficit = slot.output - newOutput;
      slot.output = newOutput;
      quotes.delete(chainIndex);

      const target = findSpillTarget(accountChains, balances, outputs, chainIndex);
      if (target === null) {
        throw new Error('Insufficient unified balance after Across fees');
      }
      const targetSlot = outputs.get(target);
      if (targetSlot) {
        targetSlot.output += deficit;
      } else {
        outputs.set(target, { type: 'bridge', output: deficit });
      }
      quotes.delete(target);
      allFit = false;
    }

    if (allFit) break;
    if (pass === SPILL_PASS_LIMIT - 1) {
      // Final validation sweep: re-quote anything missing a fresh quote.
      for (const [chainIndex, slot] of outputs) {
        if (slot.type === 'local-transfer') continue;
        const balance = balances[chainIndex];
        let quote = quotes.get(chainIndex);
        if (!quote) {
          quote = await quoteAcrossFee({
            sourceChain: accountChains[chainIndex],
            destinationChain: intent.destination,
            inputAmount: slot.output,
            recipient: intent.recipient,
          });
          quotes.set(chainIndex, quote);
        }
        const requiredInput = grossUpInputAmount(slot.output, quote);
        if (requiredInput > balance) {
          throw new Error('Insufficient unified balance after Across fees');
        }
      }
    }
  }

  const legs: ResolvedLeg[] = [];
  for (const [chainIndex, slot] of outputs) {
    if (slot.output === 0n) continue;
    if (slot.type === 'local-transfer') {
      legs.push({
        chainIndex,
        type: 'local-transfer',
        inputAmount: slot.output,
        outputAmount: slot.output,
      });
    } else {
      const quote = quotes.get(chainIndex)!;
      const inputAmount = grossUpInputAmount(slot.output, quote);
      legs.push({
        chainIndex,
        type: 'bridge',
        inputAmount,
        outputAmount: slot.output,
        quote,
      });
    }
  }
  return legs;
}

function findSpillTarget(
  accountChains: AccountChainConfig[],
  balances: bigint[],
  outputs: Map<number, { type: ChainContribution['type']; output: bigint }>,
  excludeIndex: number,
): number | null {
  for (let i = 0; i < accountChains.length; i++) {
    if (i === excludeIndex) continue;
    const slot = outputs.get(i);
    const consumed = slot ? slot.output : 0n;
    if (balances[i] > consumed) return i;
  }
  return null;
}
