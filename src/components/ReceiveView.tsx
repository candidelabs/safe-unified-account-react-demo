import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

import { accountChains, tokenSymbol } from '../logic/chains';
import { ChainIcon } from './ChainIcon';
import { TokenIcon } from './TokenIcon';

interface ReceiveViewProps {
  accountAddress: `0x${string}`;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ReceiveView({ accountAddress }: ReceiveViewProps) {
  const [copied, setCopied] = useState(false);

  const faucetChains = accountChains.filter((c) => !!c.faucetUrl);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context). User can still
      // long-press / select the address text manually.
    }
  };

  const handleFaucet = async (faucetUrl: string) => {
    try {
      await navigator.clipboard.writeText(accountAddress);
    } catch {
      // ignore — faucet still opens
    }
    window.open(faucetUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="receive-view">
      <div className="receive-header">
        <div className="receive-eyebrow">Receive</div>
        <div className="receive-token-row">
          <TokenIcon symbol={tokenSymbol} size={28} />
          <span className="receive-token">{tokenSymbol}</span>
        </div>
      </div>
      <div className="receive-grid">
        <div className="receive-qr-wrap">
          <QRCodeSVG
            value={accountAddress}
            size={120}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
            marginSize={2}
          />
        </div>
        <div className="receive-right">
          <button
            type="button"
            className="receive-address"
            onClick={handleCopy}
            title="Copy address"
            aria-label={`Copy account address ${accountAddress}`}
          >
            <span className="receive-address-text">{truncateAddress(accountAddress)}</span>
            <span className="receive-address-copy">{copied ? 'Copied ✓' : 'Copy ⧉'}</span>
          </button>
          <div className="receive-chains-label">Receivable on</div>
          <div className="receive-chains">
            {accountChains.map((chain) => (
              <span key={chain.chainId.toString()} className="receive-chain-chip">
                <ChainIcon chainId={chain.chainId} size={14} />
                {chain.chainName}
              </span>
            ))}
          </div>
          <p className="receive-tagline">
            Senders pay on any chain. You receive on these.
          </p>
        </div>
      </div>

      {faucetChains.length > 0 && (
        <div className="receive-faucet">
          <div className="receive-faucet-label">Need test tokens?</div>
          <div className="receive-faucet-list">
            {faucetChains.map((chain) => (
              <button
                key={chain.chainId.toString()}
                type="button"
                className="receive-faucet-link"
                onClick={() => handleFaucet(chain.faucetUrl!)}
                title={`Copy address and open ${chain.chainName} faucet`}
              >
                <span>Get test {tokenSymbol} on {chain.chainName}</span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <p className="receive-faucet-hint">
            Clicking copies your address. Paste it on the faucet site.
          </p>
        </div>
      )}
    </div>
  );
}

export { ReceiveView };
