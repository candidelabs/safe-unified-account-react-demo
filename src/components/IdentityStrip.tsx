import { useEffect, useMemo, useState } from 'react';
import { SafeMultiChainSigAccountV1 as SafeAccount } from 'abstractionkit';

import { PasskeyLocalStorageFormat } from '../logic/passkeys';
import { setItem } from '../logic/storage';

interface IdentityStripProps {
  passkey: PasskeyLocalStorageFormat;
  onOpenSettings: () => void;
  settingsActive: boolean;
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function IdentityStrip({ passkey, onOpenSettings, settingsActive }: IdentityStripProps) {
  const [copied, setCopied] = useState(false);

  const accountAddress = useMemo(
    () => SafeAccount.createAccountAddress([passkey.pubkeyCoordinates]),
    [passkey],
  );

  useEffect(() => {
    if (accountAddress) setItem('accountAddress', accountAddress);
  }, [accountAddress]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(accountAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — silent
    }
  };

  return (
    <div className="identity-strip">
      <div className="identity-avatar" aria-hidden="true">●</div>
      <button
        type="button"
        className="identity-address"
        onClick={handleCopy}
        title="Copy account address"
        aria-label={`Copy account address ${accountAddress}`}
      >
        <span className="identity-address-text">{truncateAddress(accountAddress)}</span>
        <span className="identity-address-copy">{copied ? 'Copied ✓' : 'Copy ⧉'}</span>
      </button>
      <div className="identity-divider" aria-hidden="true" />
      <button
        type="button"
        className={`settings-button identity-settings ${settingsActive ? 'settings-button-active' : ''}`}
        onClick={onOpenSettings}
        aria-label={settingsActive ? 'Back to transfer' : 'Account security settings'}
        aria-pressed={settingsActive}
        title={settingsActive ? 'Back to transfer' : 'Account security settings'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );
}

export { IdentityStrip };
