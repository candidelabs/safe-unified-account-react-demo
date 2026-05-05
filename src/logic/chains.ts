/**
 * Chain config model.
 *
 * `DestinationChainConfig` — any chain Across can deliver to. Only needs
 * recipient-balance read info and the canonical token on that chain.
 *
 * `AccountChainConfig` — where the Safe operates (source of userOps,
 * bundler, paymaster, Across deposit). Every account chain is also a valid
 * destination.
 */

export interface DestinationChainConfig {
  chainId: bigint;
  chainName: string;
  jsonRpcProvider: string;
  explorerUrl: string;
  token: string;          // canonical ERC-20 address on this chain
  tokenDecimals: number;  // 6 for USDT/USDC; supports future WETH/ETH demos
}

export interface AccountChainConfig extends DestinationChainConfig {
  bundlerUrl: string;
  paymasterUrl: string;
  spokePoolAddress: string;  // Across SpokePool on this chain
  sponsorshipPolicyId?: string;
  preVerificationGasMultiplier?: number;
  verificationGasLimitMultiplier?: number;
  // Optional public-faucet URL for this chain's bridged token. When set,
  // the Receive tab renders a one-tap link that copies the account
  // address to clipboard and opens this URL in a new tab. Omit on mainnet.
  faucetUrl?: string;
}

function parseDecimals(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 6;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 36) {
    throw new Error(`Invalid token decimals: ${raw}`);
  }
  return n;
}

function loadAccountChains(): AccountChainConfig[] {
  const result: AccountChainConfig[] = [];

  for (let n = 1; ; n++) {
    const id = import.meta.env[`VITE_CHAIN${n}_ID`];
    const bundlerUrl = import.meta.env[`VITE_CHAIN${n}_BUNDLER_URL`];
    const jsonRpcProvider = import.meta.env[`VITE_CHAIN${n}_JSON_RPC_PROVIDER`];
    const paymasterUrl = import.meta.env[`VITE_CHAIN${n}_PAYMASTER_URL`];

    if (!id || !bundlerUrl || !jsonRpcProvider || !paymasterUrl) break;

    const preVerificationGasMultiplierRaw = import.meta.env[`VITE_CHAIN${n}_PRE_VERIFICATION_GAS_MULTIPLIER`];
    const verificationGasLimitMultiplierRaw = import.meta.env[`VITE_CHAIN${n}_VERIFICATION_GAS_LIMIT_MULTIPLIER`];

    result.push({
      chainId: BigInt(id),
      bundlerUrl,
      jsonRpcProvider,
      paymasterUrl,
      sponsorshipPolicyId: import.meta.env[`VITE_CHAIN${n}_SPONSORSHIP_POLICY_ID`] as string | undefined,
      preVerificationGasMultiplier: preVerificationGasMultiplierRaw !== undefined
        ? Number(preVerificationGasMultiplierRaw)
        : undefined,
      verificationGasLimitMultiplier: verificationGasLimitMultiplierRaw !== undefined
        ? Number(verificationGasLimitMultiplierRaw)
        : undefined,
      chainName: (import.meta.env[`VITE_CHAIN${n}_NAME`] as string) ?? '',
      explorerUrl: (import.meta.env[`VITE_CHAIN${n}_EXPLORER_URL`] as string) ?? '',
      token: import.meta.env[`VITE_CHAIN${n}_TOKEN`] as string,
      tokenDecimals: parseDecimals(import.meta.env[`VITE_CHAIN${n}_TOKEN_DECIMALS`] as string | undefined),
      spokePoolAddress: import.meta.env[`VITE_CHAIN${n}_SPOKE_POOL`] as string,
      faucetUrl: (import.meta.env[`VITE_CHAIN${n}_FAUCET_URL`] as string | undefined) || undefined,
    });
  }

  return result;
}

function loadDestinationOnlyChains(): DestinationChainConfig[] {
  const result: DestinationChainConfig[] = [];

  for (let n = 1; ; n++) {
    const id = import.meta.env[`VITE_DEST_CHAIN${n}_ID`];
    if (!id) break;

    result.push({
      chainId: BigInt(id),
      chainName: (import.meta.env[`VITE_DEST_CHAIN${n}_NAME`] as string) ?? '',
      jsonRpcProvider: import.meta.env[`VITE_DEST_CHAIN${n}_JSON_RPC_PROVIDER`] as string,
      explorerUrl: (import.meta.env[`VITE_DEST_CHAIN${n}_EXPLORER_URL`] as string) ?? '',
      token: import.meta.env[`VITE_DEST_CHAIN${n}_TOKEN`] as string,
      tokenDecimals: parseDecimals(import.meta.env[`VITE_DEST_CHAIN${n}_TOKEN_DECIMALS`] as string | undefined),
    });
  }

  return result;
}

export const accountChains: AccountChainConfig[] = loadAccountChains();

/**
 * All valid destinations: every account chain plus any destination-only
 * chains the user has declared. Ordered so account chains appear first
 * in the UI selector — TransferCard relies on this for its chain picker.
 */
export const destinationChains: DestinationChainConfig[] = [
  ...accountChains,
  ...loadDestinationOnlyChains(),
];

/**
 * UI label for the bridged token (e.g. "USDT", "USDC"). Defaults to "USDT".
 */
export const tokenSymbol: string = (import.meta.env.VITE_TOKEN_SYMBOL as string) ?? 'USDT';

/**
 * True if a destination chain is one where the Safe also has balance / can
 * run userOps. When destination === account chain, the contribution from
 * that chain can be a local ERC-20 `transfer()` instead of an Across deposit.
 */
export function isAccountChain(
  dest: DestinationChainConfig,
): dest is AccountChainConfig {
  return accountChains.some((c) => c.chainId === dest.chainId);
}
