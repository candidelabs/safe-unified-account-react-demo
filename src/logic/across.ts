import { parseAbi } from 'viem';

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
