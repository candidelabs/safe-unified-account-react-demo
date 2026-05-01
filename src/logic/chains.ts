/**
 * Chain config model.
 *
 * `DestinationChainConfig` — any chain USDT0 OFT can deliver to. Needs only
 * balance-read + LZ-routing info. No Safe userOps ever run here if it's
 * destination-only.
 *
 * `AccountChainConfig` — where the Safe operates (source of userOps, bundler,
 * paymaster, OFT `send()`). Every account chain is also a valid destination.
 */

export interface DestinationChainConfig {
  chainId: bigint;
  chainName: string;
  jsonRpcProvider: string;
  explorerUrl: string;
  usdt0Token: string;
  lzEid: number;
}

export interface AccountChainConfig extends DestinationChainConfig {
  bundlerUrl: string;
  paymasterUrl: string;
  usdt0Oft: string;
  sponsorshipPolicyId?: string;
  preVerificationGasMultiplier?: number;
  verificationGasLimitMultiplier?: number;
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
      usdt0Token: import.meta.env[`VITE_CHAIN${n}_USDT0_TOKEN`] as string,
      usdt0Oft: import.meta.env[`VITE_CHAIN${n}_USDT0_OFT`] as string,
      lzEid: Number(import.meta.env[`VITE_CHAIN${n}_LZ_EID`]),
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
      usdt0Token: import.meta.env[`VITE_DEST_CHAIN${n}_USDT0_TOKEN`] as string,
      lzEid: Number(import.meta.env[`VITE_DEST_CHAIN${n}_LZ_EID`]),
    });
  }

  return result;
}

export const accountChains: AccountChainConfig[] = loadAccountChains();

/**
 * All valid destinations: every account chain (which can receive locally or
 * via its own peer), plus any destination-only chains the user has declared.
 * Ordered so account chains appear first in the UI selector.
 */
export const destinationChains: DestinationChainConfig[] = [
  ...accountChains,
  ...loadDestinationOnlyChains(),
];

/**
 * True if a destination chain is one where the Safe also has balance / can run
 * userOps. When destination === account chain, the contribution from that
 * chain can be a local ERC-20 `transfer()` instead of an OFT bridge.
 */
export function isAccountChain(
  dest: DestinationChainConfig,
): dest is AccountChainConfig {
  return accountChains.some((c) => c.chainId === dest.chainId);
}
