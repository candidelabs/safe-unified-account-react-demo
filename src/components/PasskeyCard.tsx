import { useMemo, useEffect } from 'react'
import { SafeMultiChainSigAccountV1 as SafeAccount } from 'abstractionkit'

import { PasskeyLocalStorageFormat } from '../logic/passkeys'
import { setItem } from '../logic/storage'
import { chains } from '../logic/chains'

function PasskeyCard({ passkey, handleCreatePasskeyClick }: { passkey?: PasskeyLocalStorageFormat; handleCreatePasskeyClick: () => void }) {
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
      <h2>One Account. Every Chain.</h2>
      <code className="account-address">{accountAddress}</code>
      <p className="address-hint">
        This address was derived locally from your passkey, no network calls needed.
      </p>
      <div className="chain-badges">
        {chains.map((chain, i) => (
          <a
            key={i}
            className="chain-badge"
            target="_blank"
            rel="noopener noreferrer"
            href={`${chain.explorerUrl}/address/${accountAddress}`}
          >
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
