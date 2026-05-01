# AGENTS.md

This file provides context to AI coding assistants working with this repository.

## Development Commands

- `npm run dev` — Start development server with Vite
- `npm run build` — Build for production (runs `tsc` then `vite build`)
- `npm run lint` — Run ESLint with TypeScript extensions
- `npm run preview` — Preview production build locally

## Project Structure

```
src/
├── App.tsx                       # Root component — passkey state, error handling
├── App.css / index.css           # Global styles (dark theme)
├── main.tsx                      # React entry point
├── utils.ts                      # hexStringToUint8Array helper
├── exports.d.ts                  # Ambient type declarations
├── vite-env.d.ts                 # Vite client types
├── components/
│   ├── PasskeyCard.tsx           # Account creation + address display with chain badges
│   ├── TransferCard.tsx          # Unified USDT0 balance, transfer form, per-chain status
│   ├── AccountCard.tsx           # Main action card — two tabs: Signers | Guardians
│   ├── CodeShowcase.tsx          # Collapsible multichain code snippet
│   ├── CtaCard.tsx               # CTA links (docs, source, schedule call)
│   └── FaqCard.tsx               # Educational FAQ section
├── hooks/
│   └── useLocalStorageState.ts   # Generic localStorage-backed React state hook
└── logic/
    ├── chains.ts                 # Account chains + destination-only chains loader
    ├── passkeys.ts               # WebAuthn P-256 credential creation (ox library)
    ├── userOp.ts                 # Multichain UserOperation signing + submission
    ├── transfer.ts               # Balance reading, split computation, LayerZero bridging
    └── storage.ts                # localStorage utilities with bigint serialization
```

## Architecture

React + Vite + TypeScript single-page app demonstrating **Safe Unified Account** — executing multichain operations with a single passkey signature.

**Key design decisions:**

- **logic/ separated from components/** — all blockchain interaction is in `logic/`, UI components only call into it
- **Two chain models** — `accountChains` (Safe operates: bundler/paymaster/OFT) loaded from `VITE_CHAIN{N}_*` (≥ 2 enforced); `destinationChains = accountChains ∪ destOnlyChains` from `VITE_DEST_CHAIN{N}_*` (optional, recipient-only). The Safe never runs userOps on destination-only chains; LayerZero delivers via the destination's OFT peer registration.
- **Two-tab UI in AccountCard** — "Authorized Signers" (add/remove owners) and "Recovery Guardians" (social recovery module)
- **Per-chain status tracking** — each chain gets independent status (preparing → signing → pending → success) with userOpHash, txHash, and error states

### Component hierarchy

```
App.tsx
├── PasskeyCard          — create passkey or show account address + chain badges
├── TransferCard         — unified USDT0 balance, transfer form, per-chain status
├── AccountCard          — (shown after passkey exists) signer & guardian management
├── CodeShowcase         — collapsible pseudocode of the multichain flow
├── CtaCard              — links to docs, source, cal.com
└── FaqCard              — react-faq-component with dark theme
```

## Environment Variables

Two chain models — see `src/logic/chains.ts`:

- **Account chain** (`VITE_CHAIN{N}_*`) — where the Safe operates: bundler, paymaster, OFT `send()` source. Minimum 2 required. Every account chain is also a valid destination.
- **Destination-only chain** (`VITE_DEST_CHAIN{N}_*`) — recipient can receive USDT0 here via OFT delivery, but the Safe runs no userOps here. Optional; zero or more. Useful for "Safe holds on Arbitrum + Polygon, send to Ethereum mainnet".

### Account chains: `VITE_CHAIN{N}_*`

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CHAIN{N}_ID` | Yes | Blockchain chain ID |
| `VITE_CHAIN{N}_BUNDLER_URL` | Yes | Bundler endpoint |
| `VITE_CHAIN{N}_JSON_RPC_PROVIDER` | Yes | JSON-RPC provider URL |
| `VITE_CHAIN{N}_PAYMASTER_URL` | Yes | Candide paymaster endpoint |
| `VITE_CHAIN{N}_USDT0_TOKEN` | Yes | USDT0 token contract address |
| `VITE_CHAIN{N}_USDT0_OFT` | Yes | USDT0 OFT (LayerZero) contract address |
| `VITE_CHAIN{N}_LZ_EID` | Yes | LayerZero endpoint ID for cross-chain bridging |
| `VITE_CHAIN{N}_SPONSORSHIP_POLICY_ID` | No | Candide gas sponsorship policy ID — passed as 4th arg to `createSponsorPaymasterUserOperation` |
| `VITE_CHAIN{N}_PRE_VERIFICATION_GAS_MULTIPLIER` | No | Integer % bump on `preVerificationGas` (e.g. `100` = +100% / 2x). Set on rollups like Arbitrum where the paymaster's default +5% bump is too low after the WebAuthn signature inflates calldata |
| `VITE_CHAIN{N}_VERIFICATION_GAS_LIMIT_MULTIPLIER` | No | Integer % bump on `verificationGasLimit` (e.g. `50` = +50% / 1.5x). Set on chains where the paymaster's default +10% bump is too low for WebAuthn P-256 signature verification (AA26 errors) |
| `VITE_CHAIN{N}_NAME` | No | Human-readable name for UI |
| `VITE_CHAIN{N}_EXPLORER_URL` | No | Block explorer base URL |

### Destination-only chains: `VITE_DEST_CHAIN{N}_*`

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_DEST_CHAIN{N}_ID` | Yes | Blockchain chain ID |
| `VITE_DEST_CHAIN{N}_NAME` | Yes | Human-readable name for UI |
| `VITE_DEST_CHAIN{N}_JSON_RPC_PROVIDER` | Yes | JSON-RPC provider URL — used for recipient balance reads + LZ delivery polling |
| `VITE_DEST_CHAIN{N}_EXPLORER_URL` | Yes | Block explorer base URL |
| `VITE_DEST_CHAIN{N}_USDT0_TOKEN` | Yes | USDT0 token contract address (for recipient balance reads) |
| `VITE_DEST_CHAIN{N}_LZ_EID` | Yes | LayerZero endpoint ID — destination of the OFT message |

`vite.config.ts` validates required fields and enforces ≥ 2 account chains. Default setup targets Ethereum Sepolia + Optimism Sepolia with public Candide bundler endpoints.

## Key SDK Patterns

### Dependencies

| Package | Purpose |
|---------|---------|
| `abstractionkit` (^0.2.41) | Safe Unified Account SDK — account management, multichain signing, paymaster, social recovery |
| `ox` (^0.8.4) | WebAuthn P-256 credential creation and signing (`ox/WebAuthnP256`) |
| `viem` (^2.31.7) | Random address generation (`generatePrivateKey` + `privateKeyToAddress` from `viem/accounts`) |

### Multichain User Operation Flow

This is the core flow in `logic/userOp.ts` → `signAndSendMultiChainUserOps()`:

1. **Initialize account** — `SafeMultiChainSigAccountV1.initializeNewAccount([pubkeyCoordinates])`
2. **Build MetaTransactions** — e.g. `createAddOwnerWithThresholdMetaTransactions()` or guardian operations
3. **Create UserOperations per chain** — `safeAccount.createUserOperation(txs, rpc, bundler)`
4. **Paymaster commit** — `CandidePaymaster.createSponsorPaymasterUserOperation(safeAccount, userOp, bundler, undefined, { context: { signingPhase: "commit" } })` — gas estimation + paymaster fields
5. **Compute Merkle root hash** — `SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(userOperationsToSign)`
6. **Sign once with WebAuthn** — single `ox/WebAuthnP256.sign({ challenge: multiChainHash })` call, one biometric prompt
7. **Expand to per-chain signatures** — `SafeAccount.formatSignaturesToUseroperationsSignatures(userOperationsToSign, [signerSignaturePair], { isInit })`
8. **Paymaster finalize** — `CandidePaymaster.createSponsorPaymasterUserOperation(safeAccount, userOp, bundler, undefined, { context: { signingPhase: "finalize" } })` — seals paymaster data after signatures
9. **Send concurrently** — `Promise.all()` submitting all chains in parallel, then wait for inclusion

### Signer Management (AccountCard.tsx — Signers tab)

```typescript
// Add owner (returns MetaTransaction[])
safeAccount.createAddOwnerWithThresholdMetaTransactions(ownerAddress, threshold, { nodeRpcUrl })

// Remove owner (returns MetaTransaction)
safeAccount.createRemoveOwnerMetaTransaction(rpc, ownerAddress, threshold)

// Read current owners
safeAccount.getOwners(rpc)
```

### Social Recovery / Guardians (AccountCard.tsx — Guardians tab)

```typescript
const socialRecoveryModule = new SocialRecoveryModule(
  SocialRecoveryModuleGracePeriodSelector.After3Minutes
);

// Auto-enable module on first guardian add
socialRecoveryModule.createEnableModuleMetaTransaction(accountAddress)

// Add guardian
socialRecoveryModule.createAddGuardianWithThresholdMetaTransaction(guardian, threshold)

// Revoke guardian
socialRecoveryModule.createRevokeGuardianWithThresholdMetaTransaction(rpc, account, guardian, threshold)

// Read guardians
socialRecoveryModule.getGuardians(rpc, accountAddress)

// Check if module is enabled
safeAccount.isModuleEnabled(rpc, socialRecoveryModule.moduleAddress)
```

### WebAuthn / Passkeys (logic/passkeys.ts)

- **Create credential** — `ox/WebAuthnP256.createCredential({ name })` with `residentKey: 'required'`, `userVerification: 'required'`, no `authenticatorAttachment` (supports both platform and cross-platform authenticators)
- **Stored format** — `{ id: string, pubkeyCoordinates: { x: bigint, y: bigint } }`
- **Sign** — `ox/WebAuthnP256.sign({ challenge, credentialId })` — returns `{ metadata: { authenticatorData, clientDataJSON }, signature: { r, s } }`
- **Signature assembly** — `authenticatorData`, post-challenge `clientDataFields` (regex-extracted from clientDataJSON), and `[r, s]` are combined into `WebauthnSignatureData`

### Paymaster

```typescript
const paymaster = new CandidePaymaster(paymasterUrl);

// Step 1: Commit — gas estimation + paymaster fields (before signing)
const [committedOp] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, undefined,
  { context: { signingPhase: "commit" } },
);

// Step 2: Finalize — seal paymaster data (after signatures are set)
const [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, undefined,
  { context: { signingPhase: "finalize" } },
);
```

## Key Files Reference

| File | Key export / responsibility |
|------|---------------------------|
| `src/logic/userOp.ts` | `signAndSendMultiChainUserOps()` — core multichain signing orchestrator |
| `src/logic/chains.ts` | `accountChains: AccountChainConfig[]` (Safe operates) + `destinationChains: DestinationChainConfig[]` (Safe operates ∪ destination-only) |
| `src/logic/passkeys.ts` | `createPasskey()`, `toLocalStorageFormat()` — WebAuthn credential management |
| `src/logic/storage.ts` | `setItem()`, `getItem()` — localStorage with bigint→hex serialization |
| `src/logic/transfer.ts` | Balance reading, split computation, LayerZero bridging logic |
| `src/components/TransferCard.tsx` | Unified USDT0 balance, transfer form, per-chain status |
| `src/components/AccountCard.tsx` | Main UI — `executeMultiChainOp()`, signer/guardian tabs, per-chain status |
| `src/components/PasskeyCard.tsx` | Account creation, address display, chain explorer badges |
| `src/hooks/useLocalStorageState.ts` | `useLocalStorageState<T>()` — generic localStorage-backed hook |
| `vite.config.ts` | Build config + env var validation (enforces ≥ 2 chains) |
