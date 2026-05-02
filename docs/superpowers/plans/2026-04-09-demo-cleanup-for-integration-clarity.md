# Demo Cleanup for Integration Clarity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the Safe Unified Account passkeys demo so developers and AI agents can extract integration patterns without hitting anti-patterns, dead code, or misleading pseudocode.

**Architecture:** Five targeted fixes — no restructuring. Delete dead code, fix a React anti-pattern in PasskeyCard, update CodeShowcase to show the real 8-step flow (including paymaster commit/finalize), add missing security attributes on external links, and sync AGENTS.md with the changes.

**Tech Stack:** React 18, TypeScript, Vite, abstractionkit SDK

---

### Task 1: Delete dead code — `src/utils.ts`

**Files:**
- Delete: `src/utils.ts`

`hexStringToUint8Array` is defined and exported but never imported anywhere in the codebase. Confirmed via grep — zero references outside the file itself.

- [ ] **Step 1: Delete the file**

```bash
rm src/utils.ts
```

- [ ] **Step 2: Verify no build errors**

Run: `npx tsc --noEmit`
Expected: Clean exit (no errors referencing utils.ts)

- [ ] **Step 3: Commit**

```bash
git add -u src/utils.ts
git commit -m "chore: remove unused utils.ts (hexStringToUint8Array)"
```

---

### Task 2: Fix PasskeyCard.tsx — remove side effect from useMemo

**Files:**
- Modify: `src/components/PasskeyCard.tsx`

`setItem('accountAddress', accountAddress)` inside `useMemo` is a React anti-pattern — side effects in render can fire unpredictably (StrictMode double-invokes, concurrent rendering). Developers copying this pattern will get bitten. Move the address derivation to a proper `useMemo` and the storage write to a `useEffect`.

- [ ] **Step 1: Refactor PasskeyCard to separate derivation from storage**

Replace the current `getAccountAddress` useMemo (lines 9-16) with:

```tsx
import { useMemo, useEffect } from 'react'
import { SafeMultiChainSigAccountV1 as SafeAccount } from 'abstractionkit'

import { PasskeyLocalStorageFormat } from '../logic/passkeys'
import { setItem } from '../logic/storage'
import { chains } from '../logic/chains'

function PasskeyCard({ passkey, handleCreatePasskeyClick }: { passkey?: PasskeyLocalStorageFormat; handleCreatePasskeyClick: () => void }) {
  const accountAddress = useMemo(() => {
    if (!passkey) return undefined
    return SafeAccount.createAccountAddress([passkey.pubkeyCoordinates])
  }, [passkey])

  useEffect(() => {
    if (accountAddress) {
      setItem('accountAddress', accountAddress)
    }
  }, [accountAddress])

  return passkey ? (
    <div className="card account-card">
      <h2>One Account. Every Chain.</h2>
      <code className="account-address">{accountAddress}</code>
      <p className="address-hint">
        This address was derived locally from your passkey, no network calls needed.
      </p>
      <div className="chain-badges">
        {chains.map((chain, i) => (
          <a
            key={i}
            className="chain-badge"
            target="_blank"
            rel="noopener noreferrer"
            href={`${chain.explorerUrl}/address/${accountAddress}`}
          >
            {chain.chainName} ↗
          </a>
        ))}
      </div>
    </div>
  ) : (
    <div className="card" style={{ textAlign: "center" }}>
      <p>Create a passkey to generate your multichain account</p>
      <button className="primary-button" onClick={handleCreatePasskeyClick}>Create Account</button>
    </div>
  )
}

export { PasskeyCard }
```

Key changes:
- `useMemo` only computes the address (pure derivation, no side effects)
- `useEffect` writes to localStorage (proper side effect boundary)
- Renamed `getAccountAddress` to `accountAddress` (it's a value, not a getter)
- Added `rel="noopener noreferrer"` to `target="_blank"` link (preview of Task 4)

- [ ] **Step 2: Verify no build errors**

Run: `npx tsc --noEmit`
Expected: Clean exit

- [ ] **Step 3: Commit**

```bash
git add src/components/PasskeyCard.tsx
git commit -m "fix: move localStorage write out of useMemo into useEffect in PasskeyCard"
```

---

### Task 3: Update CodeShowcase.tsx — show the real integration flow

**Files:**
- Modify: `src/components/CodeShowcase.tsx`

The current pseudocode shows 5 steps but omits the paymaster commit/finalize phases entirely. This is the most visible code snippet in the demo and it's misleading — a developer copying this pattern will miss gas sponsorship, which is required for the operations to work. Update to show the real 8-step flow matching `userOp.ts`.

- [ ] **Step 1: Rewrite the pseudocode to match the actual flow**

Replace the entire `CodeShowcase` component with:

```tsx
import { useState } from "react";

function CodeShowcase() {
	const [open, setOpen] = useState(false);

	return (
		<div className="code-showcase">
			<button
				className="code-showcase-toggle"
				onClick={() => setOpen(!open)}
			>
				<span className={`code-showcase-arrow ${open ? "open" : ""}`}>
					▶
				</span>
				The code behind this demo
			</button>
			{open && (
				<div className="code-block">
					<pre>
						<span className="code-comment">{"// 1. Initialize account with passkey\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"account = SafeMultiChainSigAccountV1."}
						<span className="code-fn">{"initializeNewAccount"}</span>
						{"([pubkey]);\n\n"}
						<span className="code-comment">{"// 2. Create user operations for each chain\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"ops = "}
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(\n  chains."}
						<span className="code-fn">{"map"}</span>
						{"(chain => account."}
						<span className="code-fn">{"createUserOperation"}</span>
						{"(txs, chain))\n);\n\n"}
						<span className="code-comment">{"// 3. Paymaster commit — gas estimation + sponsorship fields\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"((op, i) =>\n  paymaster."}
						<span className="code-fn">{"createSponsorPaymasterUserOperation"}</span>
						{"(\n    account, op, bundler, "}
						<span className="code-keyword">{"undefined"}</span>
						{",\n    { context: { signingPhase: "}
						<span className="code-string">{"\"commit\""}</span>
						{" } }\n  )\n));\n\n"}
						<span className="code-comment">{"// 4. Compute multichain hash (Merkle root)\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"hash = SafeMultiChainSigAccountV1\n  ."}
						<span className="code-fn">{"getMultiChainSingleSignatureUserOperationsEip712Hash"}</span>
						{"(ops);\n\n"}
						<span className="code-comment">{"// 5. Sign once with passkey — single biometric prompt\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"signature = "}
						<span className="code-keyword">{"await "}</span>
						{"WebAuthnP256."}
						<span className="code-fn">{"sign"}</span>
						{"({ challenge: hash });\n\n"}
						<span className="code-comment">{"// 6. Expand to per-chain signatures (Merkle proofs)\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"sigs = SafeMultiChainSigAccountV1\n  ."}
						<span className="code-fn">{"formatSignaturesToUseroperationsSignatures"}</span>
						{"(ops, [signature]);\n\n"}
						<span className="code-comment">{"// 7. Paymaster finalize — seal paymaster data after signing\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"((op, i) =>\n  paymaster."}
						<span className="code-fn">{"createSponsorPaymasterUserOperation"}</span>
						{"(\n    account, op, bundler, "}
						<span className="code-keyword">{"undefined"}</span>
						{",\n    { context: { signingPhase: "}
						<span className="code-string">{"\"finalize\""}</span>
						{" } }\n  )\n));\n\n"}
						<span className="code-comment">{"// 8. Send all UserOperations concurrently\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"(op => "}
						<span className="code-fn">{"sendUserOperation"}</span>
						{"(op)));"}
					</pre>
				</div>
			)}
		</div>
	);
}

export { CodeShowcase };
```

Key changes:
- Added step 3 (paymaster commit) and step 7 (paymaster finalize)
- Renumbered steps 4-8 to match the actual `userOp.ts` flow
- Step 6 clarifies "Merkle proofs" in the comment
- Added `.code-string` class for string literals (new CSS class needed)

- [ ] **Step 2: Add `.code-string` CSS class**

In `src/App.css`, find the existing code syntax classes (`.code-comment`, `.code-keyword`, `.code-fn`) and add alongside them:

```css
.code-string {
  color: #a8db8a;
}
```

- [ ] **Step 3: Verify no build errors**

Run: `npx tsc --noEmit`
Expected: Clean exit

- [ ] **Step 4: Commit**

```bash
git add src/components/CodeShowcase.tsx src/App.css
git commit -m "fix: update CodeShowcase pseudocode to show real 8-step flow including paymaster"
```

---

### Task 4: Add missing `rel="noopener noreferrer"` to all `target="_blank"` links

**Files:**
- Modify: `src/App.tsx` (2 links, lines 43 and 46)
- Modify: `src/components/CtaCard.tsx` (3 links, lines 12, 18, 24)
- Modify: `src/components/SafeCard.tsx` (1 link, line 443)
- Modify: `src/components/FaqCard.tsx` (3 links missing it — lines 39, 60, 87)

The recent "Fix tabnabbing" commit added `rel="noopener noreferrer"` to some links but missed several. All `target="_blank"` links need this attribute.

Note: `PasskeyCard.tsx` was already fixed in Task 2.

- [ ] **Step 1: Fix App.tsx — header logo links**

Add `rel="noopener noreferrer"` to both header links:

```tsx
<a href="https://candide.dev" target="_blank" rel="noopener noreferrer">
```

```tsx
<a href="https://safe.global" target="_blank" rel="noopener noreferrer">
```

- [ ] **Step 2: Fix CtaCard.tsx — all three CTA links**

Add `rel="noopener noreferrer"` to all three links in the `cta-links` div:

```tsx
<a
	href="https://docs.candide.dev/account-abstraction/research/safe-unified-account/"
	target="_blank"
	rel="noopener noreferrer"
>
```

```tsx
<a
	href="https://github.com/candidelabs/safe-unified-account-react-demo"
	target="_blank"
	rel="noopener noreferrer"
>
```

```tsx
<a
	href="https://cal.com/candidelabs/30mins"
	target="_blank"
	rel="noopener noreferrer"
>
```

- [ ] **Step 3: Fix SafeCard.tsx — transaction explorer link**

Add `rel="noopener noreferrer"` to the "View transaction" link in `renderChainStatusCard`:

```tsx
<a
	className="chain-track-link"
	target="_blank"
	rel="noopener noreferrer"
	href={`${chain.explorerUrl}/tx/${result.txHash}`}
>
```

- [ ] **Step 4: Fix FaqCard.tsx — three FAQ answer links missing rel**

The AbstractionKit SDK link (line ~38):
```tsx
<a
	href="https://docs.candide.dev/account-abstraction/research/safe-unified-account/"
	target="_blank"
	rel="noopener noreferrer"
>
```

The docs link (line ~59):
```tsx
<a
	href="https://docs.candide.dev/wallet/bundler/rpc-endpoints/"
	target="_blank"
	rel="noopener noreferrer"
>
```

The Nethermind audit link (line ~87) and Schedule a call link (line ~95) already have `rel` — leave them as-is.

- [ ] **Step 5: Verify no build errors**

Run: `npx tsc --noEmit`
Expected: Clean exit

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/CtaCard.tsx src/components/SafeCard.tsx src/components/FaqCard.tsx
git commit -m "fix: add missing rel=noopener noreferrer to all target=_blank links"
```

---

### Task 5: Update AGENTS.md to reflect changes

**Files:**
- Modify: `CLAUDE.md` (which contains the AGENTS.md content)

- [ ] **Step 1: Remove utils.ts from project structure**

In the project structure ASCII tree, remove the `utils.ts` line:

```
├── utils.ts                      # hexStringToUint8Array helper
```

- [ ] **Step 2: Remove utils.ts from exports.d.ts reference if present**

Check if `exports.d.ts` references utils. If not, skip.

- [ ] **Step 3: Verify the rest of AGENTS.md is accurate**

Skim the document. The CodeShowcase description mentions "5-step multichain flow" — update to "8-step multichain flow" to match the new CodeShowcase content:

Old: `collapsible pseudocode of the multichain flow`
Should still be accurate as a description — the component hierarchy section just says "collapsible pseudocode of the multichain flow" which is still correct. No change needed there.

In the component hierarchy section:
```
├── CodeShowcase         — collapsible pseudocode of the multichain flow
```
This is still accurate. No change needed.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: remove utils.ts from project structure in AGENTS.md"
```
