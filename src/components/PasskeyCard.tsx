import { useMemo, useEffect } from 'react'
import { SafeMultiChainSigAccountV1 as SafeAccount } from 'abstractionkit'

import { PasskeyLocalStorageFormat } from '../logic/passkeys'
import { setItem } from '../logic/storage'
import { accountChains } from '../logic/chains'
import { ChainIcon } from './ChainIcon'

interface PasskeyCardProps {
  passkey?: PasskeyLocalStorageFormat;
  handleCreatePasskeyClick: () => void;
  onOpenSettings?: () => void;
  settingsActive?: boolean;
}

function PasskeyCard({ passkey, handleCreatePasskeyClick, onOpenSettings, settingsActive }: PasskeyCardProps) {
  const accountAddress = useMemo(() => {
    if (!passkey) return undefined
    return SafeAccount.createAccountAddress([passkey.pubkeyCoordinates])
  }, [passkey])

  useEffect(() => {
    if (accountAddress) {
      setItem('accountAddress', accountAddress)
    }
  }, [accountAddress])

  return passkey ? (
    <div className="card account-card">
      {onOpenSettings && (
        <button
          type="button"
          className={`settings-button account-settings-button ${settingsActive ? 'settings-button-active' : ''}`}
          onClick={onOpenSettings}
          aria-label={settingsActive ? 'Back to transfer' : 'Account security settings'}
          aria-pressed={settingsActive}
          title={settingsActive ? 'Back to transfer' : 'Account security settings'}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      )}
      <h2>One Account. Every Chain.</h2>
      <code className="account-address">{accountAddress}</code>
      <p className="address-hint">
        This address was derived locally from your passkey, no network calls needed.
      </p>
      <div className="chain-badges">
        {accountChains.map((chain, i) => (
          <a
            key={i}
            className="chain-badge"
            target="_blank"
            rel="noopener noreferrer"
            href={`${chain.explorerUrl}/address/${accountAddress}`}
          >
            <ChainIcon chainId={chain.chainId} />
            {chain.chainName} ↗
          </a>
        ))}
      </div>
    </div>
  ) : (
    <div className="card" style={{ textAlign: "center" }}>
      <p>Create a passkey to generate your multichain account</p>
      <button className="primary-button" onClick={handleCreatePasskeyClick}>Create Account</button>
    </div>
  )
}

export { PasskeyCard }
