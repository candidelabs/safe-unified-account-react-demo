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

**Then:**
- Fetch the recommended SDK version from https://docs.candide.dev/account-abstraction/research/safe-unified-account/ — install whichever version the docs specify (pinned or latest)

## Setup

Install dependencies:
```bash
npm install abstractionkit viem
```

If passkeys chosen, the passkey skill specifies additional dependencies (`ox`, etc).

### Chain Configuration

Each chain needs three endpoints:

```typescript
interface ChainConfig {
  chainId: bigint;
  bundlerUrl: string;     // Candide endpoint
  rpcUrl: string;         // Standard JSON-RPC (separate from Candide)
  paymasterUrl: string;   // Candide endpoint
}
```

**Candide public endpoints** (bundler + paymaster, no signup):
```
https://api.candide.dev/public/v3/{chainId}
```

**JSON-RPC provider is separate.** The Candide endpoint is for bundler and paymaster only. Each chain also needs a standard JSON-RPC URL for reading state, nonces, and gas prices. Use public RPCs (`publicnode.com`, `drpc.org`) or providers (Infura, Alchemy).

Example config for two testnet chains:
```typescript
const chains: ChainConfig[] = [
  {
    chainId: 11155111n, // Ethereum Sepolia
    bundlerUrl: 'https://api.candide.dev/public/v3/11155111',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    paymasterUrl: 'https://api.candide.dev/public/v3/11155111',
  },
  {
    chainId: 11155420n, // Optimism Sepolia
    bundlerUrl: 'https://api.candide.dev/public/v3/11155420',
    rpcUrl: 'https://sepolia.optimism.io',
    paymasterUrl: 'https://api.candide.dev/public/v3/11155420',
  },
];
```

For higher rate limits, get dedicated endpoints from [Candide Dashboard](https://dashboard.candide.dev/).

## Account Initialization

```typescript
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
} from 'abstractionkit';
```

### ECDSA

```typescript
// New account — address is deterministic (CREATE2), can be shown before first tx
const safeAccount = SafeAccount.initializeNewAccount([ownerAddress]);
console.log('Account address:', safeAccount.accountAddress);

// Existing account (already deployed)
const safeAccount = new SafeAccount(knownAddress);
```

The developer is responsible for storing the private key securely for future signing sessions (env var, encrypted store, hardware module — their choice).

### Passkeys

Credential creation, storage, and signing are handled by the **passkey integration skill**. This skill only needs the resulting public key coordinates:

```typescript
// After passkey creation (handled by passkey skill):
const safeAccount = SafeAccount.initializeNewAccount([{ x: pubkeyX, y: pubkeyY }]);
```

## Core Multichain Flow

The flow is **operation-agnostic** — any `{ to, value, data }` MetaTransaction works. ETH transfers, ERC-20 transfers, contract calls, module operations, batched transactions. The same transaction can go to all chains, or different transactions per chain.

### Step 1: Build MetaTransactions

```typescript
// Example: add an owner across all chains
const tx = safeAccount.createStandardAddOwnerWithThresholdMetaTransaction(
  newOwnerAddress, 1
);
// Same tx for all chains, or build different txs per chain
const transactionsPerChain = chains.map(() => [tx]);
```

### Step 2: Create UserOperations per chain

```typescript
let userOps = await Promise.all(
  chains.map((chain, i) =>
    safeAccount.createUserOperation(
      transactionsPerChain[i], chain.rpcUrl, chain.bundlerUrl,
    )
  )
);
```

### Step 3: Paymaster commit — gas estimation + sponsorship

```typescript
const commitOverrides = { context: { signingPhase: "commit" as const } };

const commitResults = await Promise.all(
  chains.map((chain, i) => {
    const paymaster = new CandidePaymaster(chain.paymasterUrl);
    return paymaster.createSponsorPaymasterUserOperation(
      safeAccount, userOps[i], chain.bundlerUrl, undefined, commitOverrides,
    );
  })
);
// Update userOps with paymaster fields
commitResults.forEach(([committedOp], i) => { userOps[i] = committedOp; });
```

For ERC-20 token paymaster, see the Paymaster Integration section.

### Steps 4-6: Sign

**ECDSA** — one method call handles multichain hash, signing, and per-chain signature formatting:

```typescript
const userOpsToSign = userOps.map((op, i) => ({
  userOperation: op,
  chainId: chains[i].chainId,
}));

const signatures = safeAccount.signUserOperations(
  userOpsToSign, [privateKey],
);

userOps.forEach((op, i) => { op.signature = signatures[i]; });
```

**Passkeys** — delegate to the passkey skill. Provide `userOpsToSign` (same array as above). The passkey skill returns the per-chain `signatures[]` array. The interface:
- Input: `userOpsToSign` array of `{ userOperation, chainId }`
- Output: `signatures` string array, one per chain
- Key methods used: `getMultiChainSingleSignatureUserOperationsEip712Hash()`, `createWebAuthnSignature()`, `formatSignaturesToUseroperationsSignatures()`

### Step 7: Paymaster finalize — seal after signing

```typescript
const finalizeOverrides = { context: { signingPhase: "finalize" as const } };

const finalizeResults = await Promise.all(
  chains.map((chain, i) => {
    const paymaster = new CandidePaymaster(chain.paymasterUrl);
    return paymaster.createSponsorPaymasterUserOperation(
      safeAccount, userOps[i], chain.bundlerUrl, undefined, finalizeOverrides,
    );
  })
);
finalizeResults.forEach(([finalizedOp], i) => { userOps[i] = finalizedOp; });
```

### Step 8: Send concurrently

Use `Promise.allSettled` — one chain's failure must not block others.

```typescript
const results = await Promise.allSettled(
  userOps.map((op, i) => {
    const sender = new SafeAccount(op.sender);
    return sender.sendUserOperation(op, chains[i].bundlerUrl);
  })
);

// Track per-chain results
const chainResults = results.map((result) => {
  if (result.status === 'fulfilled') {
    return { status: 'sent' as const, response: result.value };
  } else {
    const err = result.reason;
    return { status: 'failed' as const, error: err?.message || String(err) };
  }
});

// Wait for inclusion on successful sends
await Promise.all(
  chainResults.map((r, i) => {
    if (r.status !== 'sent') return;
    return r.response.included().then((receipt) => {
      if (receipt?.success) {
        console.log(`Chain ${chains[i].chainId}: confirmed, tx ${receipt.receipt.transactionHash}`);
      } else {
        console.log(`Chain ${chains[i].chainId}: execution failed`);
      }
    });
  })
);
```

## Paymaster Integration

### Gas Sponsorship (CandidePaymaster)

Two-phase pattern — shown in Steps 3 and 7 above:
1. **Commit** (`signingPhase: "commit"`) — before signing. Gets gas estimates, fills paymaster fields.
2. **Finalize** (`signingPhase: "finalize"`) — after signing. Seals paymaster data with final signature.

The `sponsorshipPolicyId` parameter (4th arg) is optional — use it for gated sponsorship policies. Pass `undefined` for default sponsorship.

```typescript
const paymaster = new CandidePaymaster(paymasterUrl);

// With sponsorship policy
const [op] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, 'your-policy-id', commitOverrides,
);

// Without (default sponsorship)
const [op] = await paymaster.createSponsorPaymasterUserOperation(
  safeAccount, userOp, bundlerUrl, undefined, commitOverrides,
);
```

### ERC-20 Token Payment

User pays gas in ERC-20 tokens instead of native currency. Replace `createSponsorPaymasterUserOperation` with `createTokenPaymasterUserOperation` in Steps 3 and 7:

```typescript
const paymaster = new CandidePaymaster(paymasterUrl);
const tokenAddress = '0x...'; // USDC, USDT, etc.

// Commit phase (Step 3)
const op = await paymaster.createTokenPaymasterUserOperation(
  safeAccount, userOp, tokenAddress, bundlerUrl, commitOverrides,
);

// Finalize phase (Step 7) — same call with finalize overrides
const finalOp = await paymaster.createTokenPaymasterUserOperation(
  safeAccount, userOp, tokenAddress, bundlerUrl, finalizeOverrides,
);
```

The paymaster automatically prepends a token approval transaction during the commit phase. Same two-phase pattern as gas sponsorship.

Check supported tokens:
```typescript
const supported = await paymaster.isSupportedERC20Token(tokenAddress);
const rate = await paymaster.fetchTokenPaymasterExchangeRate(tokenAddress);
```

## Partial Failure Handling

**There is no cross-chain atomicity.** A UserOp can succeed on chain A and fail on chain B. The application MUST handle this.

### Per-chain status tracking

Every multichain operation must track independent status per chain:

```typescript
type ChainStatus =
  | { state: 'pending' }
  | { state: 'sent'; userOpHash: string }
  | { state: 'confirmed'; txHash: string }
  | { state: 'failed'; error: string };
```

### Retry failed chains

When some chains fail:
1. Store the original `transactionsPerChain` array so they can be resubmitted
2. Identify failed chain indices from `chainResults`
3. Rebuild UserOps for only the failed chains
4. Run steps 2-8 again for just the failed subset (new signature required)
5. Update status per chain

Nonces are per-chain with no global ordering — retrying failed chains does not conflict with already-succeeded chains.

### Account security operations vs value operations

**Account security operations** (add/remove owner, change threshold, enable module): Partial failure means different security configurations across chains. The app MUST surface this and provide retry/sync. Retrying is safe — adding an already-added owner reverts cleanly.

**Value operations** (transfers, swaps): Partial failure may not be safely retryable (e.g., a swap already executed). Show per-chain results and let the user decide. Time-sensitive operations may need to be rebuilt rather than retried.

### Pre-submission consistency check

Before building multichain security operations, verify account state is consistent across chains:

```typescript
const ownersPerChain = await Promise.all(
  chains.map(chain => safeAccount.getOwners(chain.rpcUrl))
);
// Compare — if owners differ, warn the developer before proceeding
```

## Verification

After integration, produce a standalone test script. This uses ECDSA with an auto-generated key to verify the full flow on testnet — no browser needed.

```typescript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
} from 'abstractionkit';

async function verify() {
  // Auto-generate owner for testing
  const privateKey = generatePrivateKey();
  const owner = privateKeyToAccount(privateKey);

  const chains = [
    { chainId: 11155111n, bundlerUrl: 'https://api.candide.dev/public/v3/11155111', rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com', paymasterUrl: 'https://api.candide.dev/public/v3/11155111' },
    { chainId: 11155420n, bundlerUrl: 'https://api.candide.dev/public/v3/11155420', rpcUrl: 'https://sepolia.optimism.io', paymasterUrl: 'https://api.candide.dev/public/v3/11155420' },
  ];

  const safeAccount = SafeAccount.initializeNewAccount([owner.address]);
  console.log('Account:', safeAccount.accountAddress);

  // Build test transaction: add a random owner
  const newOwner = privateKeyToAccount(generatePrivateKey()).address;
  const tx = safeAccount.createStandardAddOwnerWithThresholdMetaTransaction(newOwner, 1);

  // Create UserOps
  let userOps = await Promise.all(
    chains.map(chain => safeAccount.createUserOperation([tx], chain.rpcUrl, chain.bundlerUrl))
  );

  // Paymaster commit
  const commitOverrides = { context: { signingPhase: "commit" as const } };
  const commitResults = await Promise.all(
    chains.map((chain, i) =>
      new CandidePaymaster(chain.paymasterUrl)
        .createSponsorPaymasterUserOperation(safeAccount, userOps[i], chain.bundlerUrl, undefined, commitOverrides)
    )
  );
  commitResults.forEach(([op], i) => { userOps[i] = op; });

  // Sign — single call for all chains
  const sigs = safeAccount.signUserOperations(
    userOps.map((op, i) => ({ userOperation: op, chainId: chains[i].chainId })),
    [privateKey],
  );
  userOps.forEach((op, i) => { op.signature = sigs[i]; });

  // Paymaster finalize
  const finalizeOverrides = { context: { signingPhase: "finalize" as const } };
  const finalResults = await Promise.all(
    chains.map((chain, i) =>
      new CandidePaymaster(chain.paymasterUrl)
        .createSponsorPaymasterUserOperation(safeAccount, userOps[i], chain.bundlerUrl, undefined, finalizeOverrides)
    )
  );
  finalResults.forEach(([op], i) => { userOps[i] = op; });

  // Send
  const results = await Promise.allSettled(
    userOps.map((op, i) => new SafeAccount(op.sender).sendUserOperation(op, chains[i].bundlerUrl))
  );

  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      console.log(`Chain ${chains[i].chainId}: sent, waiting...`);
      const receipt = await result.value.included();
      console.log(`Chain ${chains[i].chainId}: ${receipt?.success ? 'confirmed' : 'failed'}`, receipt?.receipt?.transactionHash ?? '');
    } else {
      console.log(`Chain ${chains[i].chainId}: error -`, result.reason?.message);
    }
  }

  // Verify
  const owners = await Promise.all(chains.map(c => safeAccount.getOwners(c.rpcUrl)));
  for (const [i, o] of owners.entries()) {
    const has = o.map((a: string) => a.toLowerCase()).includes(newOwner.toLowerCase());
    console.log(`Chain ${chains[i].chainId} owners:`, has ? 'NEW OWNER ADDED' : 'NOT FOUND', o);
  }
}

verify().catch(console.error);
```

Run: `npx tsx verify.ts`

## SDK Quick Reference

### Key Types

| Type | Description |
|------|-------------|
| `SafeMultiChainSigAccountV1` | Multi-chain Safe account. Aliased as `SafeAccount` in examples. |
| `CandidePaymaster` | Gas sponsorship and token paymaster. |
| `MetaTransaction` | `{ to: string, value: bigint, data: string }` — any on-chain operation. |
| `UserOperationV9` | ERC-4337 UserOperation for EntryPoint v0.9. |
| `SendUseroperationResponse` | Returned by `sendUserOperation()`. Has `.userOperationHash` and `.included()`. |
| `SignerSignaturePair` | `{ signer: string \| WebauthnPublicKey, signature: string }` — for passkey flow. |
| `WebauthnSignatureData` | `{ authenticatorData, clientDataFields, rs }` — for passkey flow. |

### Key Methods

| Method | Description |
|--------|-------------|
| `SafeAccount.initializeNewAccount(owners)` | Create new account from owner addresses or WebAuthn public keys. Returns account with deterministic address. |
| `new SafeAccount(address)` | Load existing deployed account. |
| `safeAccount.createUserOperation(txs, rpcUrl, bundlerUrl)` | Build unsigned UserOperation from MetaTransactions. |
| `safeAccount.signUserOperations(opsToSign, privateKeys)` | **ECDSA only.** Sign multiple chains with one call. Returns per-chain signatures. |
| `SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(opsToSign)` | **Passkey flow.** Compute Merkle root hash for signing. |
| `SafeAccount.createWebAuthnSignature(signatureData)` | **Passkey flow.** Encode WebAuthn signature for on-chain verification. |
| `SafeAccount.formatSignaturesToUseroperationsSignatures(opsToSign, signerPairs, overrides)` | **Passkey flow.** Expand single signature into per-chain signatures with Merkle proofs. |
| `safeAccount.sendUserOperation(userOp, bundlerUrl)` | Submit signed UserOperation to bundler. |
| `response.included(timeoutSeconds?)` | Wait for UserOperation inclusion. Returns receipt with `success` and `transactionHash`. |
| `safeAccount.getOwners(rpcUrl)` | Read current Safe owners from chain. |
| `paymaster.createSponsorPaymasterUserOperation(account, op, bundler, policyId?, overrides?)` | Gas sponsorship — commit or finalize phase. |
| `paymaster.createTokenPaymasterUserOperation(account, op, token, bundler)` | ERC-20 token gas payment. |

### Resources

- [Safe Unified Account docs](https://docs.candide.dev/account-abstraction/research/safe-unified-account/)
- [AbstractionKit SDK docs](https://docs.candide.dev)
- [Supported networks](https://docs.candide.dev/wallet/bundler/rpc-endpoints/)
- [Public endpoints](https://docs.candide.dev/wallet/bundler/public-endpoints/)
- [Candide Dashboard](https://dashboard.candide.dev/) (dedicated endpoints)
- [Demo source code](https://github.com/candidelabs/safe-unified-account-react-demo)
