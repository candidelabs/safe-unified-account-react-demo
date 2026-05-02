# Merge & Reorganization: Unified Three-Section Demo

## Goal

Merge the `feature/unified-usdt-balance` branch work back into `main` to produce a single demo app with three clear sections: unified balance/transfers, signer management, and guardian management. Use `CandidePaymaster` for gas sponsorship throughout.

## Starting Point

**Main branch** is the foundation — it has:
- `userOp.ts` with `CandidePaymaster` commit/finalize flow, retry-friendly `MultiChainSendResult` type
- `SafeCard.tsx` (660 lines) with signers + guardians tabs, `executeMultiChainOp`, per-chain status, retry logic
- `ChainConfig` with `paymasterUrl`
- `PasskeyCard`, `CodeShowcase`, `CtaCard`, `FaqCard`

**Feature branch** adds:
- `TransferCard.tsx` — unified USDT0 balance display, transfer form, confirmation breakdown, per-chain execution status
- `transfer.ts` — ERC-20/OFT ABIs, balance reading, transfer split computation, LayerZero fee quoting, MetaTransaction building
- USDT0-specific chain config fields (`usdt0Token`, `usdt0Oft`, `lzEid`)

## UI Layout

After passkey creation, the app renders top-to-bottom:

```
PasskeyCard          — account address + chain badges (unchanged from main)
TransferCard         — hero section: unified USDT0 balance, send form, per-chain status
AccountCard          — secondary: tabs for Signers | Guardians (main's SafeCard, renamed)
CodeShowcase         — updated pseudocode reflecting both features
CtaCard / FaqCard    — unchanged
```

TransferCard is the hero because it demonstrates the most compelling value prop (unified balance, one-signature cross-chain transfers). Account management is important but secondary — setup/admin work done occasionally.

## File Changes

### 1. `src/logic/chains.ts` — Merge chain config

Combine main's fields with feature branch's USDT0/LZ fields:

```typescript
export interface ChainConfig {
  chainId: bigint;
  bundlerUrl: string;
  jsonRpcProvider: string;
  paymasterUrl: string;       // from main
  chainName: string;
  explorerUrl: string;
  usdt0Token: string;          // from feature
  usdt0Oft: string;            // from feature
  lzEid: number;               // from feature
}
```

All fields loaded from `VITE_CHAIN{N}_*` env vars. The loader breaks on missing required fields (`ID`, `BUNDLER_URL`, `JSON_RPC_PROVIDER`, `PAYMASTER_URL`, `USDT0_TOKEN`, `USDT0_OFT`, `LZ_EID`).

### 2. `src/logic/transfer.ts` — Bring from feature branch

Port as-is. Contains:
- `ERC20_ABI`, `OFT_ABI` — ABI fragments for USDT0 and LayerZero OFT
- `readBalance()`, `readAllBalances()` — per-chain and multi-chain USDT0 balance reading
- `readNativeBalance()` — for LayerZero fee preflight check
- `computeTransferSplit()` — greedy algorithm: destination chain first, then bridge remainder
- `quoteBridgeFee()` — LayerZero native fee estimation
- `buildTransferMetaTransactions()` — builds approve+transfer or approve+OFT.send MetaTransactions
- `encodeLzReceiveOption()` — LayerZero TYPE_3 executor options encoding

No changes needed. LayerZero bridging stays until replaced by Across in a future iteration.

### 3. `src/logic/userOp.ts` — Use main's version

Main's version is the correct one. It has:
- `CandidePaymaster` commit/finalize flow
- `MultiChainSendResult` return type (per-chain success/failure)
- `MultiChainUserOpInput` with `paymasterUrl`
- Accepts `safeAccount` instance as parameter (needed for paymaster calls)
- Clean separation: no debug logging clutter

No changes needed.

### 4. `src/components/TransferCard.tsx` — Port and adapt

Port from feature branch with these adaptations:

**Wire to main's orchestrator signature:**
- Current feature branch calls `signAndSendMultiChainUserOps(ops, passkey)` (2 args)
- Main's signature is `signAndSendMultiChainUserOps(ops, passkey, safeAccount)` (3 args)
- Ops must include `paymasterUrl` field (from chain config)

**Remove manual `createUserOperation` options:**
- Drop `expectedSigners` and `preVerificationGasPercentageMultiplier` from `createUserOperation` calls — the paymaster handles gas estimation during commit phase

**Handle `MultiChainSendResult` return type:**
- Main returns `{ status: 'sent', response } | { status: 'failed', error }` per chain
- Feature branch expected `SendUseroperationResponse[]` — adapt to handle partial failures

**Keep everything else:** balance display, transfer form, confirmation breakdown, per-chain status UI, formatUsdt/parseUsdt helpers.

### 5. `src/components/SafeCard.tsx` → `src/components/AccountCard.tsx` — Rename

Rename file and component. No logic changes — main's SafeCard already works correctly with paymaster, has retry logic, signer/guardian management.

### 6. `src/App.tsx` — Update layout

```tsx
<PasskeyCard ... />
{passkey && <TransferCard passkey={passkey} />}
{passkey && <AccountCard passkey={passkey} />}
<CodeShowcase />
<CtaCard />
<FaqCard />
```

Update hero copy to reflect both capabilities (unified balance + account management).

### 7. `src/components/CodeShowcase.tsx` — Update pseudocode

Update the collapsible code snippet to reflect the full flow: balance reading, transfer split, paymaster commit/finalize, single passkey signature, multichain send.

### 8. `src/App.css` — Merge styles

Main's styles cover SafeCard/AccountCard. Feature branch added styles for unified balance display, transfer form, confirmation breakdown, chain results. Merge both sets, ensure no class name collisions.

### 9. `vite.config.ts` — Update required env vars

Add USDT0/LZ fields to the `REQUIRED_PER_CHAIN` array:

```typescript
const REQUIRED_PER_CHAIN = [
  'ID', 'BUNDLER_URL', 'JSON_RPC_PROVIDER', 'PAYMASTER_URL',
  'USDT0_TOKEN', 'USDT0_OFT', 'LZ_EID',
]
```

### 10. `.env.example` — Merge all env vars

Combine main's vars (with `PAYMASTER_URL`) and feature's vars (with `USDT0_TOKEN`, `USDT0_OFT`, `LZ_EID`).

## What does NOT change

- `src/logic/passkeys.ts` — identical on both branches
- `src/logic/storage.ts` — identical on both branches
- `src/hooks/useLocalStorageState.ts` — identical on both branches
- `src/components/FaqCard.tsx` — content updates only if needed
- `package.json` — already at `abstractionkit@^0.2.41` on feature branch; main may need the version bump

## Execution strategy

Work on a new branch from `main`. Cherry-pick or manually port the transfer feature. This avoids merge conflict resolution on files that diverged significantly (App.tsx, App.css, userOp.ts, chains.ts).

Order of operations:
1. Branch from main
2. Merge chain config (add USDT0/LZ fields)
3. Port `transfer.ts` as-is
4. Port and adapt `TransferCard.tsx`
5. Rename SafeCard → AccountCard
6. Update App.tsx layout and hero copy
7. Merge CSS
8. Update vite.config.ts and .env.example
9. Update CodeShowcase
10. Update CLAUDE.md to reflect new structure
11. Verify build (`tsc --noEmit` + `vite build`)

## Future work (not in this spec)

- Replace LayerZero bridging with Across Protocol (separate spec)
- The Across integration will modify `transfer.ts` and chain config but not the component structure or orchestrator
