# Safe Unified Account - Passkeys React Example

This example demonstrates **Safe Unified Account**. Manage a single smart account across multiple chains with one passkey signature. Create a passkey, then add signers, remove signers, or configure recovery guardians on all chains simultaneously with a single biometric authentication.

The default setup targets Ethereum Sepolia + Optimism Sepolia + Arbitrum Sepolia, but the app supports any number of EVM chains.

## Quickstart

1.  **Clone the Repo**

    ```bash
    git clone git@github.com:candidelabs/safe-unified-account-passkeys-react-example.git
    ```

2.  **Install Dependencies**

    ```bash
    cd safe-unified-account-passkeys-react-example
    npm install
    ```

3.  **Configure Environment Variables**

    ```bash
    cp .env.example .env
    ```

    * Default Networks: Ethereum Sepolia, Optimism Sepolia and Arbitrum Sepolia.
    * Endpoints: Uses public Candide bundler endpoints. Get dedicated endpoints from [Candide Dashboard](https://dashboard.candide.dev/).
    * Adding more chains: Add `VITE_CHAIN3_*`, `VITE_CHAIN4_*`, etc. the app picks them up automatically. Minimum 2 chains required. Make sure the smart contracts are deployed on the target chains.

4.  **Run the app**

    ```bash
    npm run dev
    ```

## How It Works

1. Create a Passkey: WebAuthn P-256 credential using device biometrics (Touch ID, Face ID, security keys, or password managers)
2. Choose an action: add/remove a signer or guardian, optionally with a custom address
3. Single passkey authentication: signs a multichain Merkle root hash covering all chains at once
4. Parallel execution: UserOperations are sent to all chains concurrently, gas sponsored by AllowAllPaymaster, with per-chain status updates as each confirms

## Environment Variables

Chains are configured with numbered env vars. The app loops from `VITE_CHAIN1_*` upward and stops at the first gap.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CHAIN{N}_ID` | Yes | Chain ID |
| `VITE_CHAIN{N}_BUNDLER_URL` | Yes | Bundler endpoint |
| `VITE_CHAIN{N}_JSON_RPC_PROVIDER` | Yes | JSON-RPC URL |
| `VITE_CHAIN{N}_NAME` | No | Display name for the UI |
| `VITE_CHAIN{N}_EXPLORER_URL` | No | Block explorer base URL |

## Resources

- [Safe Unified Account documentation](https://docs.candide.dev/account-abstraction/research/safe-unified-account)
- [AbstractionKit SDK documentation](https://docs.candide.dev)
- [Passkeys integration guide](https://docs.candide.dev/wallet/plugins/passkeys/)
