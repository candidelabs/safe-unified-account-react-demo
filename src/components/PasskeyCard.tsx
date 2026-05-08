interface PasskeyCardProps {
  handleCreatePasskeyClick: () => void;
}

function PasskeyCard({ handleCreatePasskeyClick }: PasskeyCardProps) {
  return (
    <div className="card create-account-card">
      <h2 className="create-account-title">Create your Safe Unified Account</h2>
      <p className="create-account-subtitle">
        One smart account at the same address on every chain.
      </p>
      <ul className="create-account-features">
        <li className="create-account-feature">
          <span className="create-account-feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3 -8 4 16 3 -8h4" />
            </svg>
          </span>
          <div className="create-account-feature-text">
            <strong>Unified balance</strong>
            <span>One number across every chain. Spend from any in a single signature.</span>
          </div>
        </li>
        <li className="create-account-feature">
          <span className="create-account-feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-3.51-7.13" />
              <path d="M21 4v5h-5" />
            </svg>
          </span>
          <div className="create-account-feature-text">
            <strong>Account synced everywhere</strong>
            <span>Update signers or rotate recovery methods once. The change applies on every chain.</span>
          </div>
        </li>
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
      </ul>
      <button className="primary-button" onClick={handleCreatePasskeyClick}>
        Create Account
      </button>
    </div>
  );
}

export { PasskeyCard };
