# Merge & Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the unified USDT0 balance/transfer feature from `feature/unified-usdt-balance` into `main`, producing a three-section demo app (balance, signers, guardians) with CandidePaymaster throughout.

**Architecture:** Start from `main` (has paymaster, retry logic, clean orchestrator). Port transfer feature and adapt it to main's `signAndSendMultiChainUserOps` signature. Rename SafeCard to AccountCard, wire both cards into App.tsx with TransferCard as the hero.

**Tech Stack:** React + TypeScript + Vite, abstractionkit ^0.2.41, viem, ox/WebAuthnP256

**Spec:** `docs/superpowers/specs/2026-04-09-merge-reorganization-design.md`

---

### Task 1: Create branch and update chain config

**Files:**
- Modify: `src/logic/chains.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Create a new branch from main**

```bash
git checkout main
git checkout -b feature/merge-three-sections
```

- [ ] **Step 2: Update `src/logic/chains.ts` to add USDT0/LZ fields**

Replace the full file content with:

```typescript
export interface ChainConfig {
  chainId: bigint;
  bundlerUrl: string;
  jsonRpcProvider: string;
  paymasterUrl: string;
  chainName: string;
  explorerUrl: string;
  usdt0Token: string;
  usdt0Oft: string;
  lzEid: number;
}

function loadChains(): ChainConfig[] {
  const result: ChainConfig[] = [];

  for (let n = 1; ; n++) {
    const id = import.meta.env[`VITE_CHAIN${n}_ID`];
    const bundlerUrl = import.meta.env[`VITE_CHAIN${n}_BUNDLER_URL`];
    const jsonRpcProvider = import.meta.env[`VITE_CHAIN${n}_JSON_RPC_PROVIDER`];
    const paymasterUrl = import.meta.env[`VITE_CHAIN${n}_PAYMASTER_URL`];

    if (!id || !bundlerUrl || !jsonRpcProvider || !paymasterUrl) break;

    result.push({
      chainId: BigInt(id),
      bundlerUrl,
      jsonRpcProvider,
      paymasterUrl,
      chainName: (import.meta.env[`VITE_CHAIN${n}_NAME`] as string) ?? '',
      explorerUrl: (import.meta.env[`VITE_CHAIN${n}_EXPLORER_URL`] as string) ?? '',
      usdt0Token: import.meta.env[`VITE_CHAIN${n}_USDT0_TOKEN`] as string,
      usdt0Oft: import.meta.env[`VITE_CHAIN${n}_USDT0_OFT`] as string,
      lzEid: Number(import.meta.env[`VITE_CHAIN${n}_LZ_EID`]),
    });
  }

  return result;
}

export const chains: ChainConfig[] = loadChains();
```

- [ ] **Step 3: Update `vite.config.ts` required env vars**

Replace the `REQUIRED_PER_CHAIN` array:

```typescript
const REQUIRED_PER_CHAIN = ['ID', 'BUNDLER_URL', 'JSON_RPC_PROVIDER', 'PAYMASTER_URL', 'USDT0_TOKEN', 'USDT0_OFT', 'LZ_EID']
```

- [ ] **Step 4: Update `.env.example` with all env vars**

Replace with merged config. Use Arbitrum and Plasma mainnets (the chains the demo targets):

```
# Arbitrum
VITE_CHAIN1_ID=42161
VITE_CHAIN1_BUNDLER_URL=https://api.candide.dev/public/v3/42161
VITE_CHAIN1_PAYMASTER_URL=https://api.candide.dev/public/v3/42161
VITE_CHAIN1_JSON_RPC_PROVIDER=https://arbitrum-one-rpc.publicnode.com
VITE_CHAIN1_NAME=Arbitrum
VITE_CHAIN1_EXPLORER_URL=https://arbiscan.io
VITE_CHAIN1_USDT0_TOKEN=0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
VITE_CHAIN1_USDT0_OFT=0x0000000000000000000000000000000000000000
VITE_CHAIN1_LZ_EID=30110

# Plasma
VITE_CHAIN2_ID=10849
VITE_CHAIN2_BUNDLER_URL=https://api.candide.dev/public/v3/10849
VITE_CHAIN2_PAYMASTER_URL=https://api.candide.dev/public/v3/10849
VITE_CHAIN2_JSON_RPC_PROVIDER=https://rpc.plasma.build
VITE_CHAIN2_NAME=Plasma
VITE_CHAIN2_EXPLORER_URL=https://explorer.plasma.build
VITE_CHAIN2_USDT0_TOKEN=0x0000000000000000000000000000000000000000
VITE_CHAIN2_USDT0_OFT=0x0000000000000000000000000000000000000000
VITE_CHAIN2_LZ_EID=30331
```

Note: The USDT0 token/OFT addresses above are placeholders — update with real addresses for your deployment.

- [ ] **Step 5: Commit**

```bash
git add src/logic/chains.ts vite.config.ts .env.example
git commit -m "feat: merge chain config — add USDT0/LZ fields alongside paymaster"
```

---

### Task 2: Port transfer logic from feature branch

**Files:**
- Create: `src/logic/transfer.ts`
- Create: `src/utils.ts`

- [ ] **Step 1: Create `src/logic/transfer.ts`**

Copy the file from the feature branch. This file has no dependencies on the feature branch's divergent code — it only imports from `viem` and `abstractionkit` (the `MetaTransaction` type), plus `ChainConfig` from `./chains`.

```bash
git show feature/unified-usdt-balance:src/logic/transfer.ts > src/logic/transfer.ts
```

- [ ] **Step 2: Create `src/utils.ts` if not present on main**

Check if `src/utils.ts` exists on main. If not, copy from feature branch:

```bash
git show feature/unified-usdt-balance:src/utils.ts > src/utils.ts 2>/dev/null || true
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: PASS. `transfer.ts` imports `ChainConfig` which now has all the fields it needs (`usdt0Token`, `usdt0Oft`, `lzEid`).

- [ ] **Step 4: Commit**

```bash
git add src/logic/transfer.ts src/utils.ts
git commit -m "feat: port transfer logic — balance reading, split computation, LZ bridging"
```

---

### Task 3: Port and adapt TransferCard component

**Files:**
- Create: `src/components/TransferCard.tsx`

This is the main adaptation task. The feature branch's `TransferCard` needs to be rewired to main's `signAndSendMultiChainUserOps` which has a different signature:
- Takes 3 args: `(ops, passkey, safeAccount)` instead of 2
- `ops` items include `paymasterUrl` field
- Returns `MultiChainSendResult[]` instead of `SendUseroperationResponse[]`

- [ ] **Step 1: Create `src/components/TransferCard.tsx`**

```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
} from 'abstractionkit';

import type { PasskeyLocalStorageFormat } from '../logic/passkeys';
import { signAndSendMultiChainUserOps } from '../logic/userOp';
import { getItem } from '../logic/storage';
import { chains } from '../logic/chains';
import {
  readAllBalances,
  readNativeBalance,
  computeTransferSplit,
  buildTransferMetaTransactions,
  quoteBridgeFee,
  type ChainContribution,
  type TransferIntent,
} from '../logic/transfer';

type Step = 'idle' | 'confirm' | 'preparing' | 'signing' | 'pending' | 'success';

interface ChainResult {
  chainIndex: number;
  userOpHash?: string;
  txHash?: string;
  error?: string;
  type: 'local-transfer' | 'bridge';
}

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const USDT0_DECIMALS = 6;

function formatUsdt(amount: bigint): string {
  const whole = amount / 10n ** BigInt(USDT0_DECIMALS);
  const frac = amount % 10n ** BigInt(USDT0_DECIMALS);
  const fracStr = frac.toString().padStart(USDT0_DECIMALS, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function parseUsdt(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d{0,6})?$/.test(trimmed)) return null;
  const parts = trimmed.split('.');
  const whole = BigInt(parts[0] || '0');
  const fracStr = (parts[1] || '').padEnd(USDT0_DECIMALS, '0').slice(0, USDT0_DECIMALS);
  return whole * 10n ** BigInt(USDT0_DECIMALS) + BigInt(fracStr);
}

function TransferCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
  const [balances, setBalances] = useState<bigint[]>(() => chains.map(() => 0n));
  const [recipient, setRecipient] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [destChainIndex, setDestChainIndex] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string>();
  const [contributions, setContributions] = useState<ChainContribution[]>([]);
  const [chainResults, setChainResults] = useState<ChainResult[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const accountAddress = getItem('accountAddress') as `0x${string}`;
  const unifiedBalance = balances.reduce((sum, b) => sum + b, 0n);
  const parsedAmount = parseUsdt(amountInput);

  const fetchBalances = useCallback(async () => {
    if (!accountAddress) return;
    setLoadingBalances(true);
    try {
      const result = await readAllBalances(chains, accountAddress);
      setBalances(result);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
    } finally {
      setLoadingBalances(false);
    }
  }, [accountAddress]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const isValidRecipient = ADDRESS_REGEX.test(recipient.trim());
  const isSelfTransfer = recipient.trim().toLowerCase() === accountAddress?.toLowerCase();
  const isAmountValid = parsedAmount !== null && parsedAmount > 0n && parsedAmount <= unifiedBalance;
  const canSend = isValidRecipient && !isSelfTransfer && isAmountValid && step === 'idle';

  const handleSend = () => {
    if (!parsedAmount) return;
    setError(undefined);

    try {
      const intent: TransferIntent = {
        totalAmount: parsedAmount,
        recipient: recipient.trim() as `0x${string}`,
        destinationChainIndex: destChainIndex,
      };
      const split = computeTransferSplit(balances, intent);
      setContributions(split);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute transfer split');
    }
  };

  const handleConfirm = async () => {
    if (!parsedAmount) return;
    setStep('preparing');
    setError(undefined);
    setChainResults([]);

    try {
      const intent: TransferIntent = {
        totalAmount: parsedAmount,
        recipient: recipient.trim() as `0x${string}`,
        destinationChainIndex: destChainIndex,
      };

      const safeAccount = SafeAccount.initializeNewAccount([
        passkey.pubkeyCoordinates,
      ]);

      // Pre-flight: check native balance for bridge fees on source chains
      const bridgeContribs = contributions.filter((c) => c.type === 'bridge');
      if (bridgeContribs.length > 0) {
        const destChain = chains[intent.destinationChainIndex];
        for (const contrib of bridgeContribs) {
          const srcChain = chains[contrib.chainIndex];
          const [nativeBalance, requiredFee] = await Promise.all([
            readNativeBalance(srcChain, accountAddress),
            quoteBridgeFee(srcChain, destChain, intent.recipient, contrib.amount),
          ]);
          if (nativeBalance < requiredFee) {
            throw new Error(
              `Insufficient ${srcChain.chainName} native balance for LayerZero fee. ` +
              `Need ${requiredFee} wei, have ${nativeBalance} wei.`
            );
          }
        }
      }

      const plans = await buildTransferMetaTransactions(
        chains,
        contributions,
        intent,
        accountAddress,
      );

      // Create UserOperations for participating chains only
      const userOps = await Promise.all(
        plans.map((plan) => {
          const chain = chains[plan.chainIndex];
          return safeAccount.createUserOperation(
            plan.transactions,
            chain.jsonRpcProvider,
            chain.bundlerUrl,
          );
        }),
      );

      setStep('signing');

      // Use main's orchestrator — includes paymaster commit/finalize
      const results = await signAndSendMultiChainUserOps(
        plans.map((plan, i) => ({
          userOp: userOps[i],
          chainId: chains[plan.chainIndex].chainId,
          bundlerUrl: chains[plan.chainIndex].bundlerUrl,
          paymasterUrl: chains[plan.chainIndex].paymasterUrl,
        })),
        passkey,
        safeAccount,
      );

      setStep('pending');
      setChainResults(
        plans.map((plan, i) => {
          const r = results[i];
          return {
            chainIndex: plan.chainIndex,
            userOpHash: r.status === 'sent' ? r.response.userOperationHash : undefined,
            error: r.status === 'failed' ? r.error : undefined,
            type: contributions.find((c) => c.chainIndex === plan.chainIndex)!.type,
          };
        }),
      );

      // Wait for inclusion per chain
      const promises = results.map((r, i) => {
        if (r.status !== 'sent') return Promise.resolve();
        return r.response.included().then((receipt) => {
          setChainResults((prev) => {
            const next = [...prev];
            if (receipt == null) {
              next[i] = { ...next[i], error: 'Receipt not found (timeout)' };
            } else if (receipt.success) {
              next[i] = { ...next[i], txHash: receipt.receipt.transactionHash };
            } else {
              next[i] = { ...next[i], error: 'Execution failed' };
            }
            return next;
          });
        });
      });

      await Promise.all(promises);
      setStep('success');
      await fetchBalances();
    } catch (err) {
      console.error('Transfer failed:', err);
      setError(err instanceof Error ? err.message : 'Transfer failed');
      setStep('idle');
    }
  };

  const handleReset = () => {
    setStep('idle');
    setContributions([]);
    setChainResults([]);
    setAmountInput('');
    setRecipient('');
    setError(undefined);
  };

  return (
    <div className="card action-card">
      {/* Balance display (always visible in idle/confirm) */}
      {(step === 'idle' || step === 'confirm') && (
        <div className="unified-balance">
          <div className="balance-label">Unified USDT0 Balance</div>
          <div className="balance-amount">
            {loadingBalances ? '...' : formatUsdt(unifiedBalance)}
          </div>
          <div className="balance-breakdown">
            {chains.map((chain, i) => (
              <span key={i} className="chain-balance">
                {chain.chainName}: {formatUsdt(balances[i])}
              </span>
            ))}
          </div>
          <button
            className="secondary-button refresh-button"
            onClick={fetchBalances}
            disabled={loadingBalances}
          >
            {loadingBalances ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Transfer form (idle state) */}
      {step === 'idle' && accountAddress && (
        <div className="transfer-form">
          <div className="form-field">
            <label className="form-label">Recipient</label>
            <input
              type="text"
              className="address-input"
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            {isSelfTransfer && (
              <span className="field-error">Cannot send to your own address</span>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Amount (USDT0)</label>
            <input
              type="text"
              className="address-input"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Destination Chain</label>
            <div className="chain-selector">
              {chains.map((chain, i) => (
                <button
                  key={i}
                  className={`chain-option ${destChainIndex === i ? 'chain-option-active' : ''}`}
                  onClick={() => setDestChainIndex(i)}
                >
                  {chain.chainName}
                </button>
              ))}
            </div>
          </div>

          <button
            className="primary-button"
            onClick={handleSend}
            disabled={!canSend}
          >
            Send {parsedAmount && isAmountValid ? `${formatUsdt(parsedAmount)} USDT0` : 'USDT0'}
          </button>
        </div>
      )}

      {/* Pre-sign confirmation */}
      {step === 'confirm' && (
        <div className="confirm-breakdown">
          <h3>Transaction Breakdown</h3>
          <p className="confirm-summary">
            Sending {formatUsdt(parsedAmount!)} USDT0 to{' '}
            <code>{recipient.slice(0, 8)}...{recipient.slice(-6)}</code> on{' '}
            {chains[destChainIndex].chainName}
          </p>
          <div className="confirm-steps">
            {contributions.map((contrib, i) => (
              <div key={i} className="confirm-step">
                <span className="confirm-chain">{chains[contrib.chainIndex].chainName}</span>
                <span className="confirm-action">
                  {contrib.type === 'local-transfer'
                    ? `Transfer ${formatUsdt(contrib.amount)} USDT0`
                    : `Bridge ${formatUsdt(contrib.amount)} USDT0 → ${chains[destChainIndex].chainName}`}
                </span>
              </div>
            ))}
          </div>
          {contributions.some((c) => c.type === 'bridge') && (
            <p className="confirm-note">
              Bridged funds arrive at the recipient in ~1 minute via LayerZero.
            </p>
          )}
          <div className="confirm-actions">
            <button className="primary-button" onClick={handleConfirm}>
              Confirm &amp; Sign
            </button>
            <button className="secondary-button" onClick={handleReset}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Execution states */}
      {step === 'preparing' && (
        <p className="step-label">Preparing multichain operations…</p>
      )}

      {step === 'signing' && (
        <p className="step-label">Authenticate with your passkey…</p>
      )}

      {(step === 'pending' || step === 'success') && (
        <>
          {step === 'success' && (
            <div className="success-banner">
              <p>
                Sent {formatUsdt(parsedAmount!)} USDT0 across {chainResults.length} chain
                {chainResults.length > 1 ? 's' : ''} with a single signature
              </p>
            </div>
          )}
          <div className="chain-results">
            {chainResults.map((result, i) => {
              const chain = chains[result.chainIndex];
              const isPending = result.userOpHash && !result.txHash && !result.error;
              const isSuccess = !!result.txHash;
              const isError = !!result.error;

              let statusClass = '';
              if (isPending) statusClass = 'pending';
              else if (isSuccess) statusClass = 'success';
              else if (isError) statusClass = 'error';

              return (
                <div key={i} className="chain-status-card">
                  <strong>{chain.chainName}</strong>
                  <span className="chain-action-type">
                    {result.type === 'local-transfer' ? 'Transfer' : 'Bridge'}
                  </span>
                  <div className="chain-status-row">
                    <span className={`status-dot ${statusClass}`} />
                    <span>
                      {isPending && 'Pending...'}
                      {isSuccess && 'Confirmed'}
                      {isError && result.error}
                    </span>
                  </div>
                  {isSuccess && result.txHash && (
                    <a
                      className="chain-track-link"
                      target="_blank"
                      href={`${chain.explorerUrl}/tx/${result.txHash}`}
                    >
                      View transaction ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          {step === 'success' && (
            <>
              <div className="completion-metrics">
                <div className="metric">
                  <span className="metric-value">1</span>
                  <span className="metric-label">signature</span>
                </div>
                <div className="metric">
                  <span className="metric-value">{chainResults.length}</span>
                  <span className="metric-label">chains used</span>
                </div>
              </div>
              <button
                className="primary-button"
                style={{ marginTop: '1rem' }}
                onClick={handleReset}
              >
                New Transfer
              </button>
            </>
          )}
        </>
      )}

      {error && (
        <div className="error-message">
          <p>Error: {error}</p>
        </div>
      )}
    </div>
  );
}

export { TransferCard };
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/TransferCard.tsx
git commit -m "feat: add TransferCard — unified balance, transfer form, paymaster integration"
```

---

### Task 4: Rename SafeCard to AccountCard

**Files:**
- Rename: `src/components/SafeCard.tsx` → `src/components/AccountCard.tsx`

- [ ] **Step 1: Rename and update component name**

```bash
git mv src/components/SafeCard.tsx src/components/AccountCard.tsx
```

Then edit `src/components/AccountCard.tsx`:
- Change `function SafeCard` → `function AccountCard`
- Change `export { SafeCard }` → `export { AccountCard }`

The two lines to change:

```
function SafeCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
```
→
```
function AccountCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
```

```
export { SafeCard };
```
→
```
export { AccountCard };
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: FAIL — `App.tsx` still imports `SafeCard`. This is expected and will be fixed in Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/components/AccountCard.tsx
git commit -m "refactor: rename SafeCard to AccountCard"
```

---

### Task 5: Update App.tsx layout

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace App.tsx with the merged layout**

```typescript
import safeLogo from "/safe-logo-white.svg";
import candideLogo from "/candide-wordmark.svg";
import {
	PasskeyLocalStorageFormat,
	createPasskey,
	toLocalStorageFormat,
} from "./logic/passkeys.ts";
import "./App.css";
import { useLocalStorageState } from "./hooks/useLocalStorageState.ts";
import { useState } from "react";
import { PasskeyCard } from "./components/PasskeyCard.tsx";
import { TransferCard } from "./components/TransferCard.tsx";
import { AccountCard } from "./components/AccountCard.tsx";
import { CodeShowcase } from "./components/CodeShowcase.tsx";
import { CtaCard } from "./components/CtaCard.tsx";
import { FaqCard } from "./components/FaqCard.tsx";

const PASSKEY_LOCALSTORAGE_KEY = "passkeyId";

function App() {
	const [passkey, setPasskey] = useLocalStorageState<
		PasskeyLocalStorageFormat | undefined
	>(PASSKEY_LOCALSTORAGE_KEY, undefined);
	const [error, setError] = useState<string>();

	const handleCreatePasskeyClick = async () => {
		setError(undefined);
		try {
			const passkey = await createPasskey();

			setPasskey(toLocalStorageFormat(passkey));
		} catch (error) {
			if (error instanceof Error) {
				setError(error.message);
			} else {
				setError("Unknown error");
			}
		}
	};

	return (
		<>
			<header className="header">
				<a href="https://candide.dev" target="_blank" rel="noopener noreferrer">
					<img src={candideLogo} className="logo" alt="Candide Atelier logo" />
				</a>
				<a href="https://safe.global" target="_blank" rel="noopener noreferrer">
					<img src={safeLogo} className="logo" alt="Safe logo" />
				</a>
			</header>
			<div className="hero">
				<span className="demo-badge">Live Demo</span>
				<h1>Safe Unified Account</h1>
				<p className="subtitle">
					A single USDT0 balance across Arbitrum, Plasma, and more.
					<br />
					One passkey. One signature. Transfer across every chain.
				</p>
			</div>

			<PasskeyCard
				passkey={passkey}
				handleCreatePasskeyClick={handleCreatePasskeyClick}
			/>

			{passkey && <TransferCard passkey={passkey} />}
			{passkey && <AccountCard passkey={passkey} />}

			{error && (
				<div className="card">
					<p>Error: {error}</p>
				</div>
			)}

			<CodeShowcase />
			<CtaCard />
			<FaqCard />
		</>
	);
}

export default App;
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire TransferCard + AccountCard into App layout"
```

---

### Task 6: Merge CSS from both branches

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add transfer-specific CSS to App.css**

Main's CSS already has all the shared styles (buttons, chain results, status dots, etc.). Append the transfer-specific styles after the existing responsive section, before the closing of the file.

Add these styles at the end of `src/App.css` (after the last `@media` block):

```css
/* ── Unified Balance ── */
.unified-balance {
  text-align: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.balance-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
}

.balance-amount {
  font-family: var(--font-display);
  font-size: 2.5rem;
  font-weight: 400;
  font-style: italic;
  color: var(--success);
  margin: 0.5rem 0;
}

.balance-breakdown {
  display: flex;
  justify-content: center;
  gap: 1rem;
  font-size: 0.85rem;
  color: var(--text-tertiary);
}

.chain-balance {
  background: rgba(255, 255, 255, 0.05);
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
}

.refresh-button {
  margin-top: 0.75rem;
  font-size: 0.75rem;
  padding: 0.25rem 0.75rem;
}

/* ── Transfer Form ── */
.transfer-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  text-align: left;
}

.form-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field-error {
  font-size: 0.8rem;
  color: var(--error);
}

.chain-selector {
  display: flex;
  gap: 0.5rem;
}

.chain-option {
  flex: 1;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.15s;
}

.chain-option:hover {
  border-color: var(--border-strong);
  color: var(--text-secondary);
}

.chain-option-active {
  border-color: var(--success);
  color: var(--success);
  background: rgba(52, 211, 153, 0.08);
}

/* ── Confirmation Breakdown ── */
.confirm-breakdown {
  text-align: left;
}

.confirm-breakdown h3 {
  margin: 0 0 0.5rem;
}

.confirm-summary {
  color: var(--text-secondary);
  margin-bottom: 1rem;
}

.confirm-summary code {
  color: var(--text-primary);
}

.confirm-steps {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.confirm-step {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-sm);
}

.confirm-chain {
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-action {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.confirm-note {
  font-size: 0.85rem;
  color: var(--text-tertiary);
  font-style: italic;
  margin-bottom: 1rem;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
}

/* ── Chain action type badge ── */
.chain-action-type {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

Note: These styles use CSS custom properties (`var(--text-tertiary)`, `var(--success)`, etc.) to match main's design system, instead of the hardcoded hex values from the feature branch.

- [ ] **Step 2: Also add the retry-button styles if missing from main's CSS**

Check if `.retry-button` exists in `App.css`. It should exist on main. If not, add after `.chain-track-link`:

```css
.retry-button {
  margin-top: 0.5rem;
  background: transparent;
  border: 1px solid var(--error-muted);
  color: var(--error);
  border-radius: var(--radius-sm);
  padding: 0.3rem 0.8rem;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.retry-button:not(:disabled):hover {
  background: var(--error-muted);
  border-color: rgba(248, 113, 113, 0.35);
}

.retry-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "feat: add CSS styles for unified balance and transfer UI"
```

---

### Task 7: Update abstractionkit version, CodeShowcase, and CLAUDE.md

**Files:**
- Modify: `package.json`
- Modify: `src/components/CodeShowcase.tsx`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update abstractionkit to latest**

In `package.json`, change:
```
"abstractionkit": "^0.2.38"
```
→
```
"abstractionkit": "^0.2.41"
```

Then run:
```bash
npm install
```

- [ ] **Step 2: CodeShowcase is already correct on main**

Main's `CodeShowcase.tsx` already shows the paymaster commit/finalize flow. No changes needed — the pseudocode covers the full 8-step flow.

- [ ] **Step 3: Update CLAUDE.md**

Update the project structure section to reflect the new component names and files. Key changes:
- `SafeCard.tsx` → `AccountCard.tsx` — Account management (signers + guardians tabs)
- Add `TransferCard.tsx` — Unified USDT0 balance, transfer form, per-chain status
- Add `transfer.ts` — Balance reading, split computation, LayerZero bridging
- Update the component hierarchy diagram
- Update the SDK version reference to `^0.2.41`

- [ ] **Step 4: Run full build**

```bash
npx tsc --noEmit && npx vite build
```

Expected: Both PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/CodeShowcase.tsx CLAUDE.md
git commit -m "chore: update abstractionkit to 0.2.41, update docs"
```

---

### Task 8: Final verification

- [ ] **Step 1: Run linter**

```bash
npm run lint
```

Fix any issues.

- [ ] **Step 2: Run dev server**

```bash
npm run dev
```

Verify the app starts without errors. Check that:
- PasskeyCard renders
- After creating a passkey, TransferCard appears above AccountCard
- AccountCard has two tabs: Authorized Signers and Recovery Guardians
- TransferCard shows unified balance and transfer form

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address lint and build issues"
```

This step is only needed if step 1 produced fixes.
