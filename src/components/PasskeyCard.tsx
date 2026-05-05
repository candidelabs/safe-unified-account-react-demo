import { accountChains } from '../logic/chains';

interface PasskeyCardProps {
  handleCreatePasskeyClick: () => void;
}

function joinChainNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function PasskeyCard({ handleCreatePasskeyClick }: PasskeyCardProps) {
  const chainList = joinChainNames(accountChains.map((c) => c.chainName));

  return (
    <div className="card create-account-card">
      <h2 className="create-account-title">Create your account</h2>
      <p className="create-account-subtitle">
        A multichain Safe account, secured by a passkey.
      </p>
      <ul className="create-account-features">
        <li className="create-account-feature">
          <span className="create-account-feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
              <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
              <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
              <path d="M2 12a10 10 0 0 1 18-6" />
              <path d="M2 16h.01" />
              <path d="M21.8 16c.2-2 .131-5.354 0-6" />
              <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
              <path d="M8.65 22c.21-.66.45-1.32.57-2" />
              <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
            </svg>
          </span>
          <div className="create-account-feature-text">
            <strong>No seed phrase</strong>
            <span>Just Face ID, Touch ID, or a security key.</span>
          </div>
        </li>
        <li className="create-account-feature">
          <span className="create-account-feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
            </svg>
          </span>
          <div className="create-account-feature-text">
            <strong>Built on Safe Smart Accounts</strong>
            <span>The most-audited smart-account standard.</span>
          </div>
        </li>
        <li className="create-account-feature">
          <span className="create-account-feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
          </span>
          <div className="create-account-feature-text">
            <strong>Works on every chain</strong>
            <span>One address — {chainList}.</span>
          </div>
        </li>
      </ul>
      <button className="primary-button" onClick={handleCreatePasskeyClick}>
        Create Account
      </button>
    </div>
  );
}

export { PasskeyCard };
