---
name: safe-unified-account
description: Use when integrating Safe Unified Account, multichain smart accounts, chain abstraction with abstractionkit, or building apps that execute operations across multiple EVM chains with a single signature
---

# Safe Unified Account Integration

Single smart account across every EVM chain. One signature executes operations on all chains simultaneously. Built on [abstractionkit](https://docs.candide.dev) SDK.

## Source Priority

When writing code, follow this order strictly:

1. **Docs** — https://docs.candide.dev/wallet/guides/chain-abstraction-overview/ — fetch and read for current API patterns, recommended SDK version, and method signatures
2. **Examples** — https://github.com/candidelabs/abstractionkit-examples — fetch and read `chain-abstraction/add-owner.ts` (ECDSA) or `chain-abstraction/add-owner-passkey.ts` (passkey) for complete runnable implementations
3. **Demo repo** — https://github.com/candidelabs/safe-unified-account-demo — reference `src/logic/userOp.ts` for the orchestrator pattern and `src/components/SafeCard.tsx` for failure handling and retry logic

**Do NOT invent API calls.** Copy method signatures, parameter types, and return types from the sources above. If a method or parameter is not documented in the docs or visible in the examples, do not use it.

## Before You Start

Ask the developer these 4 questions before writing any code:

**Q1: New app or existing project?**
- New app → scaffold project with dependencies, tsconfig, env/config file
- Existing → install `abstractionkit` into their project, add chain config

**Q2: Signer type?**
- **ECDSA private keys** — simpler integration. One method call handles multichain signing.
- **Passkeys (WebAuthn P-256)** — phishing-resistant biometric signing. Requires the **passkey integration skill** for credential creation, storage, and signing. This skill handles the multichain flow; the passkey skill handles WebAuthn.

**Q3: Paymaster — who pays for gas?**
- **Gas sponsorship** (CandidePaymaster) — app sponsors gas, free for users. Uses two-phase commit/finalize.
- **ERC-20 token payment** — user pays gas in tokens (USDC, etc). Uses `createTokenPaymasterUserOperation()`.

**Q4: Which chains?**
- Developer names their target chains (e.g., "Ethereum + Optimism + Base")
- If unsure, suggest 2-3 Sepolia testnets to start — zero signup required
- Fetch the current supported chain list from https://docs.candide.dev/wallet/bundler/rpc-endpoints/ — do not rely on hardcoded lists, as networks are added over time

**Then, before writing code:**
- Fetch the recommended SDK version from the docs (Source #1 above) — install whichever version the docs specify (pinned or latest)
- Read the matching code example (Source #2 above) end-to-end before writing anything

## Required Outputs

You MUST produce these four building blocks. Adapt the file structure to the developer's project (single file or split — your call), but all four must exist:

**1. Chain configuration** — `ChainConfig` object or loader with these fields per chain:
- `chainId: bigint`
- `bundlerUrl: string` — Candide endpoint
- `rpcUrl: string` — standard JSON-RPC provider (NOT Candide — see gotcha below)
- `paymasterUrl: string` — Candide endpoint

**2. Account initialization** — function that:
- Takes an owner (ECDSA address or passkey public key coordinates)
- Returns a `SafeAccount` instance with deterministic address
- Handles both new accounts (`initializeNewAccount`) and existing accounts (`new SafeAccount(address)`)

**3. Multichain signing orchestrator** — function that:
- Takes: MetaTransactions (per chain or shared), chain configs, signer credentials
- Executes the 8-step flow (build txs → create userOps → paymaster commit → sign → paymaster finalize → send)
- Returns: per-chain results with status tracking (pending/sent/confirmed/failed)
- Uses `Promise.allSettled()` for sending (NOT `Promise.all()`)
- Implements retry logic for failed chains

**4. Verification script** — standalone `verify.ts` that:
- Auto-generates an ECDSA keypair (no browser needed)
- Initializes a new Safe account
- Builds a test MetaTransaction (e.g., add a random owner)
- Runs the full flow on the developer's configured testnet chains
- Verifies the operation succeeded on all chains (e.g., `getOwners()`)
- Prints per-chain results
- Runs with `npx tsx verify.ts`

Base the verification script on the ECDSA example from Source #2.

## Setup

Install `abstractionkit` as the core dependency. For utility functions (key generation, address derivation), use whichever Ethereum library the developer already has — **viem** or **ethers**. Both work with abstractionkit. Do not add viem to a project that already uses ethers, or vice versa.

If passkeys chosen, the passkey skill specifies additional dependencies.

## Chain Configuration Gotcha

Each chain needs **three separate endpoints** — this is the most common integration mistake:

1. **Bundler URL** — Candide endpoint, for submitting UserOperations
2. **Paymaster URL** — Candide endpoint, for gas sponsorship or token payment
3. **JSON-RPC provider URL** — standard RPC (NOT Candide), for reading state, nonces, gas prices

The Candide public endpoint (`https://api.candide.dev/public/v3/{chainId}`) serves as both bundler and paymaster, but it is NOT a JSON-RPC provider. The developer needs a separate RPC per chain (e.g., `publicnode.com`, `drpc.org`, Infura, Alchemy).

Fetch the current list of supported chains and public endpoint URLs from https://docs.candide.dev/wallet/bundler/public-endpoints/. For higher rate limits, get dedicated endpoints from [Candide Dashboard](https://dashboard.candide.dev/).

## Core Multichain Flow

The orchestrator follows an 8-step flow. Get the exact code from the docs and examples (Sources #1 and #2). Here is the conceptual flow — do not implement from this description alone:

1. **Build MetaTransactions** — the developer's app-specific logic. The flow is operation-agnostic: any `{ to, value, data }` MetaTransaction works (transfers, contract calls, owner management, module operations). The same transaction can go to all chains, or different transactions per chain.
2. **Create UserOperations per chain** — one `createUserOperation()` call per chain, passing the MetaTransactions, RPC URL, and bundler URL.
3. **Paymaster commit** — call the paymaster with `signingPhase: "commit"` on each chain. Gets gas estimates and fills paymaster fields. For ERC-20 token paymaster, use `createTokenPaymasterUserOperation()` instead.
4. **Sign** — differs by signer type:
   - **ECDSA**: single `signUserOperations()` call handles the multichain Merkle hash, signing, and per-chain signature formatting in one step.
   - **Passkeys**: delegate to the passkey skill. Provide the `userOpsToSign` array (each entry has `userOperation` + `chainId`). The passkey skill returns the per-chain `signatures[]` array.
5. **Paymaster finalize** — call the paymaster again with `signingPhase: "finalize"` to seal paymaster data after signatures are set.
6. **Send concurrently** — submit all UserOperations in parallel using `Promise.allSettled()`. Wait for inclusion with `response.included()`.

## Paymaster Integration

Two paymaster options, both using the same two-phase commit/finalize pattern:

**Gas sponsorship** (`createSponsorPaymasterUserOperation`): App pays gas on behalf of the user. The optional `sponsorshipPolicyId` parameter enables gated sponsorship policies.

**ERC-20 token payment** (`createTokenPaymasterUserOperation`): User pays gas in tokens (USDC, USDT, etc). The paymaster automatically prepends a token approval transaction during the commit phase. Same two-phase pattern.

Both require calling the paymaster twice: once before signing (commit) and once after (finalize). The docs explain why: the module strips paymaster signatures before hashing, so the user signs before the paymaster, and the paymaster seals its data after.

## Partial Failure Handling

**There is no cross-chain atomicity.** A UserOp can succeed on chain A and fail on chain B. The application MUST handle this. The docs and examples show the happy path — this section covers what they don't.

### Per-chain status tracking

Every multichain operation must track independent status per chain (pending → sent → confirmed / failed). Always use `Promise.allSettled()` for sending so one chain's failure doesn't block others. Reference `src/components/SafeCard.tsx` in the demo repo (Source #3) for the implementation pattern.

### Retry failed chains

When some chains fail:
1. Store the original transactions so they can be resubmitted
2. Identify failed chain indices from results
3. Rebuild UserOps for only the failed chains
4. Run the full sign-and-send flow again for just the failed subset (new signature required)
5. Update status per chain

Nonces are per-chain with no global ordering — retrying failed chains does not conflict with already-succeeded chains.

### Account security operations vs value operations

**Account security operations** (add/remove owner, change threshold, enable module): Partial failure means different security configurations across chains. This is a security concern. The app MUST surface this to the user and provide retry/sync. Retrying is safe — these operations are idempotent (adding an already-added owner reverts cleanly).

**Value operations** (transfers, swaps): Partial failure may not be safely retryable (e.g., a swap already executed at a different price). Show per-chain results and let the user decide. Time-sensitive operations may need to be rebuilt rather than retried.

### Pre-submission consistency check

Before building multichain security operations, verify account state is consistent across chains by reading current owners/state on all target chains. If a previous partial failure left different configurations on different chains, warn the developer before proceeding.

### Key persistence

- **ECDSA**: The developer is responsible for securely storing the private key for future signing sessions (env var, encrypted store, hardware module — their choice).
- **Passkeys**: Credential persistence is handled by the passkey skill.

## Additional References

- [Supported networks](https://docs.candide.dev/wallet/bundler/rpc-endpoints/)
- [Public endpoints](https://docs.candide.dev/wallet/bundler/public-endpoints/)
- [Passkeys integration guide](https://docs.candide.dev/wallet/plugins/passkeys/)
- [Candide Dashboard](https://dashboard.candide.dev/) — dedicated endpoints with higher rate limits
