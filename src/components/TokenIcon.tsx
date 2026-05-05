/**
 * Renders a token logo by symbol. Uses TrustWallet's assets CDN (the same
 * source pattern as ChainIcon). Returns null silently if the symbol has no
 * mapping or the image fails to load.
 */

const TOKEN_ICONS: Record<string, string> = {
  USDC: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  USDT: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
};

export function getTokenIconUrl(symbol: string): string | undefined {
  return TOKEN_ICONS[symbol.toUpperCase()];
}

export function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const url = getTokenIconUrl(symbol);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="token-icon"
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}
