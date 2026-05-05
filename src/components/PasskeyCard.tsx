interface PasskeyCardProps {
  handleCreatePasskeyClick: () => void;
}

function PasskeyCard({ handleCreatePasskeyClick }: PasskeyCardProps) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <p>Create a passkey to generate your multichain account</p>
      <button className="primary-button" onClick={handleCreatePasskeyClick}>
        Create Account
      </button>
    </div>
  );
}

export { PasskeyCard };
