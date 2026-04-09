import { encodeFunctionData, encodePacked, createPublicClient, http, parseAbi, pad, type Hex } from 'viem';
import type { MetaTransaction } from 'abstractionkit';
import type { ChainConfig } from './chains';

// ── ABI fragments ──────────────────────────────────────────────

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

export const OFT_ABI = parseAbi([
  'function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, bool payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee))',
  'function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) sendParam, (uint256 nativeFee, uint256 lzTokenFee) fee, address refundAddress) payable returns ((bytes32 guid, uint64 nonce, (uint256 nativeFee, uint256 lzTokenFee) fee), (uint256 amountSentLD, uint256 amountReceivedLD))',
]);

// ── Types ──────────────────────────────────────────────────────

export interface TransferIntent {
  totalAmount: bigint;         // in USDT0 local decimals (6)
  recipient: `0x${string}`;
  destinationChainIndex: number;
}

export interface ChainContribution {
  chainIndex: number;
  amount: bigint;              // amount this chain contributes
  type: 'local-transfer' | 'bridge';
}

// ── LayerZero executor options encoding ────────────────────────

const LZ_RECEIVE_GAS_LIMIT = 65000n;

/**
 * Encode TYPE_3 executor options for lzReceive.
 * Format: 0x0003 (type) + 0x01 (executor worker) + 0x0021 (length=33) +
 *         0x01 (lzReceive option) + uint128 gas + uint128 value
 */
export function encodeLzReceiveOption(gasLimit: bigint = LZ_RECEIVE_GAS_LIMIT): Hex {
  return encodePacked(
    ['uint16', 'uint8', 'uint16', 'uint8', 'uint128', 'uint128'],
    [3, 1, 33, 1, gasLimit, 0n],
  );
}

// ── Balance reading ────────────────────────────────────────────

/**
 * Read USDT0 balance for an address on a single chain via JSON-RPC.
 */
export async function readBalance(
  chain: ChainConfig,
  address: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(chain.jsonRpcProvider) });
  const balance = await client.readContract({
    address: chain.usdt0Token as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return balance;
}

/**
 * Read USDT0 balances across all chains in parallel.
 * Returns an array of bigints aligned with the chains array.
 */
export async function readAllBalances(
  chains: ChainConfig[],
  address: `0x${string}`,
): Promise<bigint[]> {
  return Promise.all(chains.map((chain) => readBalance(chain, address)));
}

/**
 * Read native token balance (ETH/XPL) for an address on a single chain.
 * Used to verify the Safe can pay LayerZero messaging fees.
 */
export async function readNativeBalance(
  chain: ChainConfig,
  address: `0x${string}`,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(chain.jsonRpcProvider) });
  return client.getBalance({ address });
}

// ── Transfer split computation ─────────────────────────────────

/**
 * Compute how much each chain contributes to the transfer.
 * Destination chain contributes first (local transfer), remainder bridges.
 * Returns only chains that contribute (amount > 0).
 */
export function computeTransferSplit(
  balances: bigint[],
  intent: TransferIntent,
): ChainContribution[] {
  const { totalAmount, destinationChainIndex } = intent;
  const contributions: ChainContribution[] = [];
  let remaining = totalAmount;

  // Destination chain contributes first (local transfer)
  const destBalance = balances[destinationChainIndex];
  const destContribution = destBalance < remaining ? destBalance : remaining;
  if (destContribution > 0n) {
    contributions.push({
      chainIndex: destinationChainIndex,
      amount: destContribution,
      type: 'local-transfer',
    });
    remaining -= destContribution;
  }

  // Other chains bridge the remainder
  for (let i = 0; i < balances.length && remaining > 0n; i++) {
    if (i === destinationChainIndex) continue;
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
    throw new Error(`Insufficient unified balance. Short by ${remaining} (6 decimals)`);
  }

  return contributions;
}

// ── Fee quoting ────────────────────────────────────────────────

export async function quoteBridgeFee(
  sourceChain: ChainConfig,
  destinationChain: ChainConfig,
  recipient: `0x${string}`,
  amount: bigint,
): Promise<bigint> {
  const client = createPublicClient({ transport: http(sourceChain.jsonRpcProvider) });

  const sendParam = {
    dstEid: destinationChain.lzEid,
    to: pad(recipient, { size: 32 }),
    amountLD: amount,
    minAmountLD: amount,
    extraOptions: encodeLzReceiveOption(),
    composeMsg: '0x' as Hex,
    oftCmd: '0x' as Hex,
  };

  const result = await client.readContract({
    address: sourceChain.usdt0Oft as `0x${string}`,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [sendParam, false],
  }) as { nativeFee: bigint; lzTokenFee: bigint };

  return result.nativeFee;
}

// ── MetaTransaction building ───────────────────────────────────

export interface TransferPlan {
  chainIndex: number;
  transactions: MetaTransaction[];
}

export async function buildTransferMetaTransactions(
  chains: ChainConfig[],
  contributions: ChainContribution[],
  intent: TransferIntent,
  safeAddress: `0x${string}`,
): Promise<TransferPlan[]> {
  const plans: TransferPlan[] = [];

  for (const contrib of contributions) {
    const chain = chains[contrib.chainIndex];

    if (contrib.type === 'local-transfer') {
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [intent.recipient, contrib.amount],
      });

      plans.push({
        chainIndex: contrib.chainIndex,
        transactions: [{
          to: chain.usdt0Token,
          value: 0n,
          data: transferData,
        }],
      });
    } else {
      const destChain = chains[intent.destinationChainIndex];
      const nativeFee = await quoteBridgeFee(chain, destChain, intent.recipient, contrib.amount);

      const approveData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [chain.usdt0Oft as `0x${string}`, contrib.amount],
      });

      const sendParam = {
        dstEid: destChain.lzEid,
        to: pad(intent.recipient, { size: 32 }),
        amountLD: contrib.amount,
        minAmountLD: contrib.amount,
        extraOptions: encodeLzReceiveOption(),
        composeMsg: '0x' as Hex,
        oftCmd: '0x' as Hex,
      };

      const sendData = encodeFunctionData({
        abi: OFT_ABI,
        functionName: 'send',
        args: [
          sendParam,
          { nativeFee, lzTokenFee: 0n },
          safeAddress,
        ],
      });

      plans.push({
        chainIndex: contrib.chainIndex,
        transactions: [
          {
            to: chain.usdt0Token,
            value: 0n,
            data: approveData,
          },
          {
            to: chain.usdt0Oft,
            value: nativeFee,
            data: sendData,
          },
        ],
      });
    }
  }

  return plans;
}
