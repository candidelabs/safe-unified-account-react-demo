# Safe Unified Account Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the standalone `safe-unified-account.md` skill file that AI agents follow to integrate Safe Unified Account into a developer's app.

**Architecture:** Single task — write the complete skill file following the spec at `docs/superpowers/specs/2026-04-09-safe-unified-account-skill-design.md`. The skill is a standalone `.md` file with YAML frontmatter, 9 sections, ~2000 words of prose + ~300 lines of code. All code blocks must be accurate against the abstractionkit SDK.

**Tech Stack:** Markdown, TypeScript code blocks (abstractionkit SDK)

---

### Task 1: Write the skill file

**Files:**
- Create: `safe-unified-account.md` (in project root — will be hosted on docs.candide.dev)

**Spec:** `docs/superpowers/specs/2026-04-09-safe-unified-account-skill-design.md`

**SDK reference sources (read for accurate method signatures):**
- ECDSA multichain example: `/home/marco/Documents/candide/abstractionkit-examples/chain-abstraction/add-owner.ts`
- Passkey multichain example: `/home/marco/Documents/candide/abstractionkit-examples/chain-abstraction/add-owner-passkey.ts`
- Environment config: `/home/marco/Documents/candide/abstractionkit-examples/utils/env.ts`
- SDK types: `/home/marco/Documents/candide/abstractionkit/src/types.ts`
- SafeMultiChainSigAccountV1: `/home/marco/Documents/candide/abstractionkit/src/account/Safe/SafeMultiChainSigAccount.ts`
- CandidePaymaster: `/home/marco/Documents/candide/abstractionkit/src/paymaster/CandidePaymaster.ts`

- [ ] **Step 1: Write the complete skill file**

The skill must have these 9 sections in order:

**Frontmatter:**
```yaml
---
name: safe-unified-account
description: Use when integrating Safe Unified Account, multichain smart accounts, chain abstraction with abstractionkit, or building apps that execute operations across multiple EVM chains with a single signature
---
```

**Section 1: Overview** (2-3 sentences)
- What Safe Unified Account does
- Single account, single signature, multiple chains
- Built on abstractionkit SDK

**Section 2: Before You Start** 
- Instruct agent to ask 4 questions: (Q1) new app or existing, (Q2) signer type, (Q3) paymaster type, (Q4) which chains
- For each question, list the options and what they determine
- Instruct agent to fetch SDK version from https://docs.candide.dev/account-abstraction/research/safe-unified-account/
- Instruct agent to fetch supported chains from https://docs.candide.dev/wallet/bundler/rpc-endpoints/

**Section 3: Setup**
- Dependencies: abstractionkit (version from docs), viem
- Chain config: `ChainConfig` interface with chainId, bundlerUrl, rpcUrl, paymasterUrl
- Public endpoint pattern: `https://api.candide.dev/public/v3/{chainId}` for bundler + paymaster
- IMPORTANT: JSON-RPC provider is separate (publicnode.com, drpc.org, Infura, Alchemy)
- Three URLs per chain: bundler, paymaster (both Candide), RPC (separate)

**Section 4: Account Initialization**
- ECDSA: `SafeAccount.initializeNewAccount([ownerAddress])` — deterministic CREATE2 address
- ECDSA: `new SafeAccount(knownAddress)` for existing accounts
- Key persistence reminder
- Passkeys: reference passkey skill, show just `initializeNewAccount([{x, y}])`

**Section 5: Core Multichain Flow**
- The 8-step orchestrator with complete code blocks
- Steps 1-3 shared (build txs, create userOps, paymaster commit)
- Steps 4-6 ECDSA: `signUserOperations()` — one call
- Steps 4-6 passkey: delegate to passkey skill, describe the interface
- Step 7 shared (paymaster finalize)
- Step 8 shared (send with `Promise.allSettled`)
- Note: flow is operation-agnostic — any MetaTransaction works

**Section 6: Paymaster Integration**
- Gas sponsorship: two-phase commit/finalize with `createSponsorPaymasterUserOperation()`
- ERC-20 token: `createTokenPaymasterUserOperation()` 
- `sponsorshipPolicyId` parameter (optional, for gated sponsorship)

**Section 7: Partial Failure Handling**
- No cross-chain atomicity — app must handle
- Per-chain status tracking (`ChainStatus` type)
- `Promise.allSettled()` not `Promise.all()`
- Retry logic: store original txs, rebuild for failed chains, sign again, send
- State reconciliation: account security ops (must sync) vs value ops (user decides)
- Pre-submission consistency check: verify state across chains before security operations
- Nonces are per-chain — retries don't conflict

**Section 8: Verification**
- Standalone script template using ECDSA (auto-generated key)
- Full 8-step flow on testnet
- Verify with `getOwners()` on all chains
- Run with `npx tsx verify.ts`

**Section 9: SDK Quick Reference**
- Key types table: `SafeMultiChainSigAccountV1`, `CandidePaymaster`, `MetaTransaction`, `UserOperationV9`, `SendUseroperationResponse`, `SignerSignaturePair`, `WebauthnSignatureData`
- Key methods table with signatures
- Links to docs

**Writing guidelines:**
- Prose is minimal and directive — imperative voice, not explanatory
- Code blocks are the value — complete, runnable, no placeholders
- All code must match actual SDK method signatures from the reference sources
- Target ~2000 words prose + ~300 lines code
- Follow writing-skills frontmatter format (name, description only)

- [ ] **Step 2: Self-review against spec**

Read the spec and verify every section/requirement has corresponding content in the skill:
- [ ] Q1-Q4 questions covered
- [ ] Setup with three URLs per chain
- [ ] ECDSA path complete and self-contained
- [ ] Passkey path references separate skill
- [ ] Both paymaster types covered
- [ ] Partial failure handling with all 5 agent instructions
- [ ] Verification script template
- [ ] SDK reference table
- [ ] Agent checks docs for SDK version (not hardcoded)
- [ ] Agent checks docs for supported chains (not hardcoded)
- [ ] MetaTransaction flexibility noted
- [ ] Key persistence mentioned
- [ ] Pre-submission consistency check included

- [ ] **Step 3: Commit**

```bash
git add safe-unified-account.md
git commit -m "feat: add Safe Unified Account integration skill for AI agents"
```
