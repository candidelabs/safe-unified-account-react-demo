/**
 * Renders a chain logo by chainId. Uses DefiLlama's icon CDN (zero-cost,
 * served from a long-cached edge). Falls back silently if the chain has no
 * mapping or the request fails — the layout absorbs the missing image so the
 * label still reads cleanly.
 */

const CHAIN_ICONS: Record<string, string> = {
  // Mainnets
  '1':        'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',
  '10':       'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',
  '130':      'https://icons.llamao.fi/icons/chains/rsz_unichain.jpg',
  '137':      'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
  '999':      'https://icons.llamao.fi/icons/chains/rsz_hyperliquid.jpg',
  '1329':     'https://icons.llamao.fi/icons/chains/rsz_sei.jpg',
  '5000':     'https://icons.llamao.fi/icons/chains/rsz_mantle.jpg',
  '9745':     'https://icons.llamao.fi/icons/chains/rsz_plasma.jpg',
  '42161':    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
  '57073':    'https://icons.llamao.fi/icons/chains/rsz_ink.jpg',
  '80094':    'https://icons.llamao.fi/icons/chains/rsz_berachain.jpg',
  // Testnets reuse mainnet branding
  '80002':    'https://icons.llamao.fi/icons/chains/rsz_polygon.jpg',
  '421614':   'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png',
  '11155111': 'https://icons.llamao.fi/icons/chains/rsz_ethereum.jpg',
  '11155420': 'https://icons.llamao.fi/icons/chains/rsz_optimism.jpg',
};

export function getChainIconUrl(chainId: bigint): string | undefined {
  return CHAIN_ICONS[chainId.toString()];
}

export function ChainIcon({ chainId, size = 16 }: { chainId: bigint; size?: number }) {
  const url = getChainIconUrl(chainId);
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="chain-icon"
      loading="lazy"
      onError={(e) => {
        // Hide gracefully on 404 / network error so the label stays readable
        e.currentTarget.style.display = 'none';
      }}
    />
  );
}
