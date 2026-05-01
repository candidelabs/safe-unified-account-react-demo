import { parseAbi, decodeEventLog, type Hex } from 'viem';
import type { AccountChainConfig, DestinationChainConfig } from './chains';

// ── Across SpokePool ABI ────────────────────────────────────────
//
// Reference: https://github.com/across-protocol/contracts/blob/master/contracts/SpokePool.sol
// Inlined here (instead of pulling the full SDK) for parity with how
// `transfer.ts` inlines `ERC20_ABI`.

export const SPOKE_POOL_ABI = parseAbi([
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable',
  // depositV3 is kept by current SpokePools as a backward-compat shim;
  // calling it works and emits the new universal-token-format event below.
  'event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)',
]);

// ── Public types ────────────────────────────────────────────────

export interface SuggestedFeesQuote {
  /** Total relayer fee in absolute input units. */
  totalRelayFeeTotal: bigint;
  /** Relayer fee as a fraction of input, in 1e18 fixed point. */
  totalRelayFeePct: bigint;
  /** LP fee as a fraction of input, in 1e18 fixed point. */
  lpFeePct: bigint;
  /** Output amount the recipient receives for the queried input amount. */
  outputAmount: bigint;
  /** quoteTimestamp — must echo into depositV3. */
  timestamp: number;
  /** Unix seconds; deposit can be refunded if not filled by this. */
  fillDeadline: number;
  /** Optional exclusive relayer. Zero address if Across set none. */
  exclusiveRelayer: `0x${string}`;
  exclusivityDeadline: number;
  /** SpokePool the deposit must be sent to. Sanity-check vs env. */
  spokePoolAddress: `0x${string}`;
}

export interface DepositStatus {
  status: 'pending' | 'filled' | 'expired';
  fillTxHash?: `0x${string}`;
}

// ── Helpers (filled in by later tasks) ──────────────────────────

/**
 * Across runs separate REST hosts for mainnet vs testnet. `app.across.to`
 * is mainnet; `testnet.across.to` is the Sepolia-family endpoint. Driven
 * by env so both presets in `.env.example` work without code changes.
 */
export const ACROSS_API_BASE: string =
  (import.meta.env.VITE_ACROSS_API_BASE as string) ?? 'https://app.across.to/api';

export const ZERO_ADDRESS: `0x${string}` = '0x0000000000000000000000000000000000000000';

// ── /suggested-fees ─────────────────────────────────────────────

interface SuggestedFeesRaw {
  totalRelayFee:  { total: string; pct: string };
  lpFee:          { total: string; pct: string };
  outputAmount:   string;
  timestamp:      string;
  fillDeadline:   string;
  exclusiveRelayer:    string;
  exclusivityDeadline: string;
  spokePoolAddress:    string;
}

/**
 * Quote a single bridge leg. Returns the relayer + LP fees, the
 * resulting recipient `outputAmount` for the supplied `inputAmount`,
 * and the `quoteTimestamp` / `fillDeadline` that must be echoed into
 * `depositV3`.
 *
 * Throws "Across quote endpoint unreachable" on network failure and
 * "Across quote rejected: <reason>" on a 4xx/5xx response.
 */
export async function quoteAcrossFee(args: {
  sourceChain: AccountChainConfig;
  destinationChain: DestinationChainConfig;
  inputAmount: bigint;
  recipient: `0x${string}`;
}): Promise<SuggestedFeesQuote> {
  const url = new URL(`${ACROSS_API_BASE}/suggested-fees`);
  url.searchParams.set('inputToken', args.sourceChain.token);
  url.searchParams.set('outputToken', args.destinationChain.token);
  url.searchParams.set('originChainId', args.sourceChain.chainId.toString());
  url.searchParams.set('destinationChainId', args.destinationChain.chainId.toString());
  url.searchParams.set('amount', args.inputAmount.toString());
  url.searchParams.set('recipient', args.recipient);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    throw new Error('Across quote endpoint unreachable');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Across quote rejected: ${text}`);
  }

  const raw = (await res.json()) as SuggestedFeesRaw;

  return {
    totalRelayFeeTotal: BigInt(raw.totalRelayFee.total),
    totalRelayFeePct:   BigInt(raw.totalRelayFee.pct),
    lpFeePct:           BigInt(raw.lpFee.pct),
    outputAmount:       BigInt(raw.outputAmount),
    timestamp:          Number(raw.timestamp),
    fillDeadline:       Number(raw.fillDeadline),
    exclusiveRelayer:   raw.exclusiveRelayer as `0x${string}`,
    exclusivityDeadline: Number(raw.exclusivityDeadline),
    spokePoolAddress:   raw.spokePoolAddress as `0x${string}`,
  };
}

// ── Exact-out gross-up ──────────────────────────────────────────

const ONE_E18 = 10n ** 18n;

/**
 * Given a target `outputAmount` the recipient should receive on the
 * destination chain, compute the `inputAmount` to deposit on the source.
 *
 * Across charges totalRelayFee.pct + lpFee.pct of *input*, both in 1e18
 * fixed point:  output = input × (1e18 − totalRelayFeePct − lpFeePct) / 1e18.
 * Solving for input:  input = ceil(output × 1e18 / (1e18 − totalRelayFeePct − lpFeePct)).
 *
 * Adds a 1-wei cushion to absorb integer-division rounding inside the
 * SpokePool's own fee math at execution.
 */
export function grossUpInputAmount(
  outputTarget: bigint,
  quote: SuggestedFeesQuote,
): bigint {
  const feePct = quote.totalRelayFeePct + quote.lpFeePct;
  if (feePct >= ONE_E18) {
    throw new Error('Across fees exceed 100% — leg unroutable');
  }
  const denom = ONE_E18 - feePct;
  // ceilDiv(output × 1e18, denom)
  const inputAmount = (outputTarget * ONE_E18 + denom - 1n) / denom;
  return inputAmount + 1n;
}

// ── Deposit ID extraction ───────────────────────────────────────

/**
 * Raw RPC log shape after JSON-parsing abstractionkit's stringified
 * `UserOperationReceipt.logs` blob (which is typed `string`, not `Log[]`).
 */
interface RawLog {
  address: string;
  topics: string[];
  data: string;
}

/**
 * Find the SpokePool's FundsDeposited event in a transaction receipt's
 * logs and return the depositId. Looks at logs emitted by the supplied
 * `spokePoolAddress` only — keeps us safe against unrelated contracts
 * emitting a similarly-shaped event.
 *
 * abstractionkit's `UserOperationReceipt.logs` is a JSON-stringified blob
 * (see `index.d.mts:110` — `logs: string`), not an array. We parse it
 * here so callers can pass the receipt's `logs` field directly.
 */
export function extractDepositIdFromLogs(
  rawLogs: string,
  spokePoolAddress: string,
): bigint {
  const lower = spokePoolAddress.toLowerCase();
  let parsed: RawLog[];
  try {
    parsed = JSON.parse(rawLogs) as RawLog[];
  } catch (e) {
    throw new Error(`Could not parse receipt logs JSON: ${(e as Error).message}`);
  }
  for (const log of parsed) {
    if (!log.address || log.address.toLowerCase() !== lower) continue;
    try {
      const decoded = decodeEventLog({
        abi: SPOKE_POOL_ABI,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === 'FundsDeposited') {
        return BigInt(decoded.args.depositId);
      }
    } catch {
      // Not a SpokePool event we recognize — skip.
    }
  }
  throw new Error(`No FundsDeposited log emitted by ${spokePoolAddress}`);
}

// ── /deposit/status + polling ───────────────────────────────────

interface DepositStatusRaw {
  status: string;            // "pending" | "filled" | "expired" | other
  fillTx?: string;
  destinationChainId?: string;
}

/**
 * Query Across deposit status. Returns one of pending/filled/expired
 * (any unrecognized status is normalized to "pending" — Across may add
 * intermediate states).
 */
export async function getDepositStatus(
  originChainId: bigint,
  depositId: bigint,
): Promise<DepositStatus> {
  const url = new URL(`${ACROSS_API_BASE}/deposit/status`);
  url.searchParams.set('originChainId', originChainId.toString());
  url.searchParams.set('depositId', depositId.toString());

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch (e) {
    throw new Error('Across status endpoint unreachable');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Across status rejected: ${text}`);
  }

  const raw = (await res.json()) as DepositStatusRaw;
  const status: DepositStatus['status'] =
    raw.status === 'filled' ? 'filled' :
    raw.status === 'expired' ? 'expired' : 'pending';
  return {
    status,
    fillTxHash: raw.fillTx ? (raw.fillTx as `0x${string}`) : undefined,
  };
}

/**
 * Poll `getDepositStatus` until it returns a terminal state (`filled` or
 * `expired`), or until `timeoutMs` elapses (in which case the last status
 * — typically `pending` — is returned).
 */
export async function waitForDeposit(
  originChainId: bigint,
  depositId: bigint,
  timeoutMs: number = 5 * 60 * 1000,
  pollIntervalMs: number = 5_000,
): Promise<DepositStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: DepositStatus = { status: 'pending' };
  while (Date.now() < deadline) {
    last = await getDepositStatus(originChainId, depositId);
    if (last.status === 'filled' || last.status === 'expired') return last;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return last;
}
