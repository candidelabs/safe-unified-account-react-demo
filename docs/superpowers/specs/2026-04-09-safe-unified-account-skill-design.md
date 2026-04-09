# Safe Unified Account Integration Skill — Design Spec

**Goal:** Create a standalone `.md` skill that AI agents follow to integrate Safe Unified Account (multichain chain abstraction) into a developer's app. Distributed via URL on docs.candide.dev.

**Distribution:** Single `.md` file. Developers tell their AI agent: "use this skill at [URL] and integrate Safe Unified Account into my app."

**SDK:** `abstractionkit` — the skill instructs the agent to check https://docs.candide.dev/account-abstraction/research/safe-unified-account/ for the recommended version before installing. The docs will show either a pinned version or "latest" — the agent follows whichever is specified.

---

## Skill Behavior

### Conversational Flow

The skill instructs the AI agent to ask 4 questions before writing any code:

**Q1: New app or existing project?**
- New app → scaffold dependencies, tsconfig, env file
- Existing → `npm install abstractionkit` + add env vars to existing config

**Q2: Signer type?**
- **ECDSA private keys** → simpler flow, `signUserOperations()` handles multichain hash + signature formatting in one call. Fully covered in this skill.
- **Passkeys (WebAuthn P-256)** → this skill references a separate **passkey integration skill** for WebAuthn credential creation, storage, and signing. The multichain flow stays the same; only steps 4-6 (signing) delegate to the passkey skill.

**Q3: Paymaster type?**
- **Gas sponsorship** (CandidePaymaster) → free for users, two-phase commit/finalize pattern
- **ERC-20 token payment** → user pays gas in tokens (USDC, etc.), uses `createTokenPaymasterUserOperation()`

**Q4: Which chains?**
- Developer specifies target chains (e.g., "Ethereum + Optimism + Arbitrum")
- If unsure, suggest starting with 2-3 Sepolia testnets (zero setup with public Candide endpoints)
- Determines: chain IDs, RPC endpoints, bundler URLs, paymaster URLs
- Testnet → public Candide endpoints (no signup)
- Mainnet → point to [Candide Dashboard](https://dashboard.candide.dev/) for dedicated endpoints

### What the Agent Produces

After the 4 questions, the agent writes these building blocks (adapted to the developer's project structure — single file or split, the agent decides):

1. **Chain configuration** — multi-chain endpoints object (chainId, bundlerUrl, rpcUrl, paymasterUrl per chain)
2. **Account initialization** — function to create/load account from passkey or ECDSA key, with deterministic address derivation
3. **Multichain signing orchestrator** — the core flow that takes MetaTransactions and executes them across all chains with one signature
4. **Verification script** — runnable script that executes the full flow on testnet to prove the integration works

---

## Core Integration Flow

The orchestrator follows an 8-step flow. Steps 1-3 and 7-8 are shared across signer types. Steps 4-6 differ.

### Shared Steps

**Step 1: Build MetaTransactions**
The developer's app-specific logic. The multichain flow is **operation-agnostic** — any `{ to, value, data }` MetaTransaction works. The skill shows `createStandardAddOwnerWithThresholdMetaTransaction()` as the example, but the developer can use any operation: ETH transfers, ERC-20 transfers, contract calls, module interactions, or batched operations. The same MetaTransaction can be sent to all chains, or different transactions per chain.

**Step 2: Create UserOperations per chain**
```typescript
const userOps = await Promise.all(
  chains.map(chain =>
    safeAccount.createUserOperation(transactions, chain.rpcUrl, chain.bundlerUrl)
  )
);
```

**Step 3: Paymaster commit — gas estimation + sponsorship fields**
```typescript
const commitOverrides = { context: { signingPhase: "commit" as const } };
// Per chain:
const [committedOp] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, sponsorshipPolicyId, commitOverrides
);
```

For ERC-20 token paymaster, this step uses `createTokenPaymasterUserOperation()` instead.

**Step 7: Paymaster finalize — seal after signing**
```typescript
const finalizeOverrides = { context: { signingPhase: "finalize" as const } };
// Same call, different phase
const [finalizedOp] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, sponsorshipPolicyId, finalizeOverrides
);
```

**Step 8: Send concurrently**
```typescript
const results = await Promise.allSettled(
  ops.map(op => {
    const sender = new SafeAccount(op.userOp.sender);
    return sender.sendUserOperation(op.userOp, op.bundlerUrl);
  })
);
// Wait for inclusion
await Promise.all(results.filter(r => r.status === 'fulfilled').map(r => r.value.included()));
```

### ECDSA Path (Steps 4-6 combined)

One method call handles everything — multichain hash, signing, per-chain signature formatting:

```typescript
const signatures = safeAccount.signUserOperations(
  userOpsToSign.map((op, i) => ({ userOperation: op, chainId: chains[i].chainId })),
  [privateKey]
);
userOps.forEach((op, i) => { op.signature = signatures[i]; });
```

### Passkey Path (Steps 4-6 — delegates to passkey skill)

If the developer chose passkeys, the skill references the **separate passkey integration skill** for steps 4-6. The passkey skill covers:
- Computing the multichain Merkle root hash (`getMultiChainSingleSignatureUserOperationsEip712Hash`)
- Signing with WebAuthn (browser: `ox/WebAuthnP256.sign`, Node.js: `WebAuthnCredentials` emulation)
- Assembling `WebauthnSignatureData` (authenticatorData, clientDataFields, rs)
- Creating the signature (`SafeAccount.createWebAuthnSignature`)
- Expanding to per-chain signatures (`formatSignaturesToUseroperationsSignatures`)

The main skill provides the `userOpsToSign` array to the passkey signing flow and receives back the per-chain `signatures[]` array. The interface between the two skills is clean: MetaTransactions in, signatures out.

---

## Account Initialization

### ECDSA
```typescript
import { SafeMultiChainSigAccountV1 as SafeAccount } from 'abstractionkit';

// New account — address is deterministic (CREATE2), derived from owner(s)
const safeAccount = SafeAccount.initializeNewAccount([ownerAddress]);
console.log("Account address:", safeAccount.accountAddress);
// Address can be shown to user BEFORE first transaction (no deployment needed yet)

// Existing account (already deployed)
const safeAccount = new SafeAccount(knownAddress);
```

**Key persistence:** The developer is responsible for securely storing the ECDSA private key for future sessions. The skill should remind the agent that the private key must be available for every signing operation — how it's stored (env var, encrypted database, hardware module) is the developer's choice.

### Passkeys

Passkey credential creation, storage, and signing are covered by the **separate passkey integration skill**. This skill just needs the resulting public key coordinates to initialize the account:

```typescript
// After passkey creation (handled by passkey skill):
const safeAccount = SafeAccount.initializeNewAccount([{ x: pubkeyX, y: pubkeyY }]);
```

The passkey skill covers: WebAuthn credential creation (browser + Node.js emulation), credential persistence (storing credential ID + public key coordinates for future sessions), and the signing flow.

---

## Chain Configuration

The skill produces a config object or env-driven loader based on the developer's chosen chains:

```typescript
interface ChainConfig {
  chainId: bigint;
  bundlerUrl: string;
  rpcUrl: string;
  paymasterUrl: string;
  name?: string; // display name
}
```

**Public endpoints (no signup required):**

URL pattern: `https://api.candide.dev/public/v3/{chainId}` — works as both bundler and paymaster URL.

The agent MUST fetch the current list of supported chains from https://docs.candide.dev/wallet/bundler/rpc-endpoints/ rather than relying on any hardcoded list (networks are added over time). The agent uses this list to validate the developer's chain choices and construct endpoint URLs.

Common chains for quick reference (may not be exhaustive):
- Mainnet: Ethereum (1), Optimism (10), Arbitrum (42161), Base (8453), Polygon (137)
- Testnet: Ethereum Sepolia (11155111), Optimism Sepolia (11155420), Arbitrum Sepolia (421614)

**IMPORTANT: JSON-RPC provider is separate.** The Candide public endpoint serves as bundler and paymaster only. Each chain also needs a standard JSON-RPC provider URL (for reading state, getting nonces, gas prices). Use public RPCs (e.g., `publicnode.com`, `drpc.org`) or providers like Infura/Alchemy. The agent must configure three URLs per chain: bundler, paymaster (both Candide), and JSON-RPC provider (separate).

**Dedicated endpoints** (higher rate limits): [Candide Dashboard](https://dashboard.candide.dev/)

---

## Verification Script

The skill instructs the agent to produce a standalone script that:
1. Initializes an account (ECDSA: auto-generated key; Passkey: WebAuthnCredentials emulation)
2. Builds an "add owner" MetaTransaction as a test operation
3. Runs the full 8-step flow on the developer's configured testnet chains
4. Verifies the owner was added on all chains by calling `getOwners()`
5. Prints success/failure per chain

This runs in Node.js with `npx tsx verify.ts` — no browser needed for either signer type.

---

## SDK Dependencies

```json
{
  "abstractionkit": "<check docs for recommended version>",
  "viem": "<latest>"
}
```

If passkeys chosen, the passkey skill specifies additional dependencies (`ox`, `cbor`, etc.).
```

---

## Skill File Structure

Single `SKILL.md` with YAML frontmatter:

```yaml
---
name: safe-unified-account
description: Use when integrating Safe Unified Account, multichain smart accounts, chain abstraction with abstractionkit, or building apps that execute operations across multiple EVM chains with a single signature
---
```

### Section Outline

1. **Overview** — what Safe Unified Account does (2-3 sentences)
2. **Before You Start** — instruct agent to ask the 4 questions
3. **Setup** — dependencies + chain config (conditional on Q1 and Q4); note RPC provider is separate from bundler/paymaster
4. **Account Initialization** — ECDSA self-contained; passkey references passkey skill (conditional on Q2)
5. **Core Multichain Flow** — the 8-step orchestrator; ECDSA signing inline, passkey signing delegates to passkey skill
6. **Paymaster Integration** — sponsor vs token (conditional on Q3)
7. **Partial Failure Handling** — per-chain status, retry logic, state reconciliation (REQUIRED, not optional)
8. **Verification** — test script template
9. **SDK Quick Reference** — key types and methods table

### Token Budget

Target: ~2000 words of prose + ~300 lines of code blocks. The code blocks are the value — prose should be minimal and directive.

---

## Partial Failure Handling (Critical)

There is **no cross-chain atomicity**. A UserOp can succeed on chain A and fail on chain B. The module is completely chain-agnostic — it performs local validation only. Handling divergent state is the **application's responsibility**.

The skill MUST guide the agent to build per-chain status tracking and retry logic into the integration.

### What the agent must produce

**1. Per-chain status tracking**

Every multichain operation must track independent status per chain:
```typescript
type ChainStatus =
  | { state: 'pending' }
  | { state: 'sent'; userOpHash: string }
  | { state: 'confirmed'; txHash: string }
  | { state: 'failed'; error: string }
```

Use `Promise.allSettled()` (not `Promise.all()`) so one chain's failure doesn't block others.

**2. Retry logic for failed chains**

When some chains fail:
- Store the original MetaTransactions so they can be resubmitted
- Rebuild UserOps for only the failed chains
- Sign again (new passkey prompt or ECDSA sign) — only the failed subset
- Send only to failed chains
- Update status per chain

**3. State reconciliation guidance**

The skill should explain the two categories of multichain operations:

**Account security operations** (add/remove owner, change threshold, add/remove guardian, enable module):
- Partial failure means the account has **different security configurations on different chains**
- This is a security concern — e.g., an owner exists on chain A but not chain B
- The app MUST surface this to the user and provide a way to retry/sync
- Retrying is safe because these operations are idempotent at the account level (adding an already-added owner is a no-op or reverts cleanly)

**Value operations** (transfers, swaps, bridge initiations):
- Partial failure may not be safely retryable (e.g., a swap may have already executed at a different price)
- The app should show per-chain results and let the user decide
- Time-sensitive operations may need to be rebuilt rather than retried

### What the skill tells the agent

The skill should instruct the agent to:
1. Always use `Promise.allSettled()` for sending UserOps
2. Always track per-chain status independently
3. Always implement a retry mechanism for failed chains
4. Warn the developer that account security operations should block further actions until all chains are synced
5. Note that nonces are per-chain (no global ordering) — retries don't conflict with previous successes

### Pre-submission consistency check

Before building a multichain operation, the app should verify that account state is consistent across target chains. If chain A has a different owner set than chain B (from a previous partial failure), the operation may behave differently on each chain. The skill should recommend checking `getOwners()` or relevant state on all chains before proceeding with security operations.

---

## Additional Integration Considerations

From the module's architecture and audit:

**1. Leaf verification is handled by abstractionkit** — The SDK builds the merkle tree and verifies all leaves before presenting the hash for signing. The developer doesn't need to implement this, but should understand that the single signature covers a verified merkle root of all chain operations.

**2. Two execution modes** — The module supports `executeUserOp` (generic error) and `executeUserOpWithErrorString` (bubbles up revert reason). The SDK uses the latter by default for better error messages.

**3. Paymaster signature stripping** — The module strips paymaster signatures before hashing, which is why the two-phase commit/finalize pattern works. The user signs before the paymaster, and the paymaster appends its signature after. This is transparent to the developer but explains why the paymaster phases exist.

**4. Account must be deployed consistently** — For first-time operations (nonce 0), the Safe is deployed via `initCode` in the UserOp. If deployment succeeds on chain A but fails on chain B, the account exists on only some chains. Retry will re-attempt deployment on failed chains (deterministic CREATE2 address).

**5. Timestamp validity** — UserOps can include `validAfter` and `validUntil` timestamps. For multichain operations, ensure the validity window is wide enough that all chains can process within it.

---

## Related Skills

- **Passkey integration skill** (separate, future) — WebAuthn credential creation, storage, signing, browser + Node.js emulation. Referenced by this skill when developer chooses passkeys as signer type. Can also be used independently for single-chain passkey signing.

## What the Skill Does NOT Cover

- Passkey/WebAuthn internals (delegated to passkey skill)
- UI components or React patterns (framework-agnostic)
- Social recovery / guardian management (out of scope — core integration only)
- Custom module development
- Cross-chain token transfers (bridges, CCTP)
- Account recovery flows
