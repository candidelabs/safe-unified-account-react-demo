---
name: safe-unified-account
description: Use when integrating Safe Unified Account, multichain smart accounts, chain abstraction with abstractionkit, or building apps that execute operations across multiple EVM chains with a single signature
---

# Safe Unified Account Integration

Single smart account across every EVM chain. One signature executes operations on all chains simultaneously. Built on [abstractionkit](https://docs.candide.dev) SDK.

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
- Fetch the recommended SDK version from https://docs.candide.dev/wallet/guides/chain-abstraction-overview/ — install whichever version the docs specify (pinned or latest)
- Read the integration guide and code examples at the references below to get the current API patterns

## Setup

Install `abstractionkit` as the core dependency. For utility functions (key generation, address derivation), use whichever Ethereum library the developer already has — **viem** or **ethers**. Both work with abstractionkit. Do not add viem to a project that already uses ethers, or vice versa.

If passkeys chosen, the passkey skill specifies additional dependencies.

## Chain Configuration

Each chain needs **three separate endpoints**:

1. **Bundler URL** — Candide endpoint, for submitting UserOperations
2. **Paymaster URL** — Candide endpoint, for gas sponsorship or token payment
3. **JSON-RPC provider URL** — standard RPC (NOT Candide), for reading state, nonces, gas prices

This is a common gotcha: the Candide public endpoint (`https://api.candide.dev/public/v3/{chainId}`) serves as both bundler and paymaster, but the developer also needs a separate standard JSON-RPC provider per chain (e.g., `publicnode.com`, `drpc.org`, Infura, Alchemy).

Fetch the current list of supported chains and public endpoint URLs from https://docs.candide.dev/wallet/bundler/public-endpoints/. For higher rate limits, get dedicated endpoints from [Candide Dashboard](https://dashboard.candide.dev/).

## Core Multichain Flow

The integration follows an 8-step flow. Fetch the full code patterns from the docs and examples listed in References below. Here is the conceptual flow:

1. **Build MetaTransactions** — the developer's app-specific logic. The flow is operation-agnostic: any `{ to, value, data }` MetaTransaction works (transfers, contract calls, owner management, module operations). The same transaction can go to all chains, or different transactions per chain.
2. **Create UserOperations per chain** — one `createUserOperation()` call per chain, passing the MetaTransactions, RPC URL, and bundler URL.
3. **Paymaster commit** — call the paymaster with `signingPhase: "commit"` on each chain. Gets gas estimates and fills paymaster fields. For ERC-20 token paymaster, use `createTokenPaymasterUserOperation()` instead.
4. **Sign** — differs by signer type:
   - **ECDSA**: single `signUserOperations()` call handles the multichain Merkle hash, signing, and per-chain signature formatting in one step.
   - **Passkeys**: delegate to the passkey skill. Provide the `userOpsToSign` array (each entry has `userOperation` + `chainId`). The passkey skill returns the per-chain `signatures[]` array.
5. **Paymaster finalize** — call the paymaster again with `signingPhase: "finalize"` to seal paymaster data after signatures are set.
6. **Send concurrently** — submit all UserOperations in parallel using `Promise.allSettled()` (not `Promise.all()`) so one chain's failure doesn't block others. Wait for inclusion with `response.included()`.

The ECDSA multichain example and passkey multichain example in the References section show complete, runnable implementations of this flow.

## Paymaster Integration

Two paymaster options, both using the same two-phase commit/finalize pattern:

**Gas sponsorship** (`createSponsorPaymasterUserOperation`): App pays gas on behalf of the user. The optional `sponsorshipPolicyId` parameter enables gated sponsorship policies. See the paymaster docs in References.

**ERC-20 token payment** (`createTokenPaymasterUserOperation`): User pays gas in tokens (USDC, USDT, etc). The paymaster automatically prepends a token approval transaction during the commit phase. Same two-phase pattern.

Both require calling the paymaster twice: once before signing (commit) and once after (finalize). The docs explain why: the module strips paymaster signatures before hashing, so the user signs before the paymaster, and the paymaster seals its data after.

## Partial Failure Handling

**There is no cross-chain atomicity.** A UserOp can succeed on chain A and fail on chain B. The application MUST handle this. This is the most important section of this skill — the docs and examples show the happy path, but production apps need failure handling.

### Per-chain status tracking

Every multichain operation must track independent status per chain (pending → sent → confirmed / failed). Always use `Promise.allSettled()` for sending so one chain's failure doesn't block others.

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

## Verification

After integration, produce a standalone test script that runs the full 8-step flow on testnet using ECDSA with an auto-generated key — no browser needed. Use the ECDSA multichain example in References as the template. The script should:

1. Auto-generate an owner keypair
2. Initialize a new Safe account
3. Build a test MetaTransaction (e.g., add a random owner)
4. Run the complete flow on 2-3 testnet chains
5. Verify the operation succeeded on all chains (e.g., check `getOwners()`)
6. Print per-chain results

Run with `npx tsx verify.ts`.

## References

**Docs:**
- [Safe Unified Account — integration guide + recommended SDK version](https://docs.candide.dev/wallet/guides/chain-abstraction-overview/)
- [AbstractionKit SDK docs](https://docs.candide.dev)
- [Supported networks](https://docs.candide.dev/wallet/bundler/rpc-endpoints/)
- [Public endpoints](https://docs.candide.dev/wallet/bundler/public-endpoints/)
- [Passkeys integration guide](https://docs.candide.dev/wallet/plugins/passkeys/)
- [Candide Dashboard](https://dashboard.candide.dev/) — dedicated endpoints with higher rate limits

**Code examples:**
- [abstractionkit-examples](https://github.com/candidelabs/abstractionkit-examples) — runnable scripts including ECDSA multichain (`chain-abstraction/add-owner.ts`) and passkey multichain (`chain-abstraction/add-owner-passkey.ts`)
- [Safe Unified Account demo](https://github.com/candidelabs/safe-unified-account-demo) — React demo with partial failure handling, retry logic, per-chain status tracking (see `src/logic/userOp.ts` for the flow, `src/components/SafeCard.tsx` for failure handling)
