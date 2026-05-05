import { useState, useEffect, useCallback } from 'react';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
} from 'abstractionkit';

import type { PasskeyLocalStorageFormat } from '../logic/passkeys';
import { signAndSendMultiChainUserOps } from '../logic/userOp';
import { getItem } from '../logic/storage';
import { accountChains, destinationChains, tokenSymbol } from '../logic/chains';
import { ChainIcon } from './ChainIcon';
import {
  readAllBalances,
  computeTransferSplit,
  buildTransferMetaTransactions,
  resolveLegs,
  type ResolvedLeg,
  type TransferIntent,
} from '../logic/transfer';
import { extractDepositIdFromLogs, waitForDeposit } from '../logic/across';
import { ReceiveView } from './ReceiveView';

type Step = 'idle' | 'resolving' | 'confirm' | 'preparing' | 'signing' | 'pending' | 'delivering' | 'success';

interface ChainResult {
  chainIndex: number;
  userOpHash?: string;
  txHash?: string;
  depositId?: bigint;
  fillTxHash?: string;
  error?: string;
  type: 'local-transfer' | 'bridge';
  delivering?: boolean;
  delivered?: boolean;
  expired?: boolean;
}

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
// both USDT and USDC are 6-decimal in this demo
const TOKEN_DECIMALS = 6;

function formatToken(amount: bigint): string {
  const whole = amount / 10n ** BigInt(TOKEN_DECIMALS);
  const frac = amount % 10n ** BigInt(TOKEN_DECIMALS);
  const fracStr = frac.toString().padStart(TOKEN_DECIMALS, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

// Both USDC and USDT are 1:1 USD pegs in this demo. Truncate to 2 decimals.
function formatFiat(amount: bigint): string {
  const dollars = amount / 10n ** BigInt(TOKEN_DECIMALS);
  const cents = (amount % 10n ** BigInt(TOKEN_DECIMALS)) / 10n ** BigInt(TOKEN_DECIMALS - 2);
  return `${dollars}.${cents.toString().padStart(2, '0')}`;
}

function parseToken(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d+(\.\d{0,6})?$/.test(trimmed)) return null;
  const parts = trimmed.split('.');
  const whole = BigInt(parts[0] || '0');
  const fracStr = (parts[1] || '').padEnd(TOKEN_DECIMALS, '0').slice(0, TOKEN_DECIMALS);
  return whole * 10n ** BigInt(TOKEN_DECIMALS) + BigInt(fracStr);
}

function TransferCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
  // `balances` is aligned with `accountChains` — destination-only chains have no Safe balance.
  // `destChainIndex` indexes into `destinationChains` (account chains + destination-only chains).
  const [balances, setBalances] = useState<bigint[]>(() => accountChains.map(() => 0n));
  const [recipient, setRecipient] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [destChainIndex, setDestChainIndex] = useState(0);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string>();
  const [legs, setLegs] = useState<ResolvedLeg[]>([]);
  const [chainResults, setChainResults] = useState<ChainResult[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [manualTab, setManualTab] = useState<'send' | 'receive' | null>(null);
  const [maxLoading, setMaxLoading] = useState(false);

  const accountAddress = getItem('accountAddress') as `0x${string}`;
  const unifiedBalance = balances.reduce((sum, b) => sum + b, 0n);
  // Auto-default: zero balance ⇒ Receive (the new-user path), funded ⇒ Send.
  // Once the user clicks a tab, manualTab takes over until handleReset clears it.
  const tab: 'send' | 'receive' = manualTab ?? (unifiedBalance === 0n ? 'receive' : 'send');
  const parsedAmount = parseToken(amountInput);
  const destination = destinationChains[destChainIndex];

  const fetchBalances = useCallback(async () => {
    if (!accountAddress) return;
    setLoadingBalances(true);
    try {
      const result = await readAllBalances(accountChains, accountAddress);
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

  // Find the largest recipient amount such that the total input (after
  // Across gross-up on cross-chain legs) fits in unifiedBalance.
  //
  // resolveLegs throws "Insufficient unified balance after Across fees"
  // when the request can't fit — fees are non-linear in amount (Across
  // has fixed minimums), so we probe downward: try a target, on throw
  // shrink by 8%, retry. We track the largest target that succeeded.
  // Apply a 1% buffer on success to absorb fee jitter between MAX and
  // the actual Send (Across quotes can shift between calls).
  const handleMax = async () => {
    if (unifiedBalance === 0n) return;
    setMaxLoading(true);
    try {
      const recipientAddr = (ADDRESS_REGEX.test(recipient.trim())
        ? recipient.trim()
        : accountAddress) as `0x${string}`;

      let target = unifiedBalance;
      let lastFeasible: bigint | null = null;
      let hasBridge = false;

      // Up to 6 passes: 0.92^6 ≈ 0.61 (down to 61% of balance) covers
      // even high-fee testnet scenarios with small amounts.
      for (let i = 0; i < 6; i++) {
        try {
          const intent: TransferIntent = {
            totalAmount: target,
            recipient: recipientAddr,
            destination,
          };
          const split = computeTransferSplit(accountChains, balances, intent);
          const resolved = await resolveLegs(accountChains, balances, split, intent);
          // resolveLegs returning ⇒ feasible. Lock it in and stop.
          lastFeasible = target;
          hasBridge = resolved.some((l) => l.type === 'bridge');
          break;
        } catch {
          // Infeasible at this target — shrink 8% and retry.
          target = (target * 92n) / 100n;
        }
        if (target <= 0n) break;
      }

      let finalTarget: bigint;
      if (lastFeasible !== null) {
        // Apply 1% safety buffer for cross-chain to absorb fee jitter
        // between this MAX quote and the actual Send quote.
        finalTarget = hasBridge ? (lastFeasible * 99n) / 100n : lastFeasible;
      } else {
        // Probing never landed on a feasible target (route problems,
        // very high fees, etc.) — fall back to 50% of balance. The user
        // can adjust upward and the Send-time quote will surface any
        // remaining shortfall with a precise error.
        finalTarget = (unifiedBalance * 50n) / 100n;
      }
      setAmountInput(formatToken(finalTarget));
    } finally {
      setMaxLoading(false);
    }
  };

  const handleSend = async () => {
    if (!parsedAmount) return;
    setError(undefined);
    setStep('resolving');
    try {
      const intent: TransferIntent = {
        totalAmount: parsedAmount,
        recipient: recipient.trim() as `0x${string}`,
        destination,
      };
      const split = computeTransferSplit(accountChains, balances, intent);
      const resolved = await resolveLegs(accountChains, balances, split, intent);
      setLegs(resolved);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to plan transfer');
      setStep('idle');
    }
  };

  // Helper for per-result patches that survives interleaved async updates.
  const updateChainResult = (index: number, patch: Partial<ChainResult>) => {
    setChainResults((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
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
        destination,
      };

      const safeAccount = SafeAccount.initializeNewAccount([
        passkey.pubkeyCoordinates,
      ]);

      // No native-fee preflight: Across deposits carry msg.value=0; gas is
      // paymaster-sponsored.

      const plans = buildTransferMetaTransactions(
        accountChains,
        legs,
        intent,
        accountAddress,
      );

      const userOps = await Promise.all(
        plans.map((plan) => {
          const chain = accountChains[plan.chainIndex];
          return safeAccount.createUserOperation(
            plan.transactions,
            chain.jsonRpcProvider,
            chain.bundlerUrl,
            { expectedSigners: [passkey.pubkeyCoordinates] },
          );
        }),
      );

      setStep('signing');

      const results = await signAndSendMultiChainUserOps(
        plans.map((plan, i) => ({
          userOp: userOps[i],
          chainId: accountChains[plan.chainIndex].chainId,
          bundlerUrl: accountChains[plan.chainIndex].bundlerUrl,
          paymasterUrl: accountChains[plan.chainIndex].paymasterUrl,
          sponsorshipPolicyId: accountChains[plan.chainIndex].sponsorshipPolicyId,
          preVerificationGasMultiplier: accountChains[plan.chainIndex].preVerificationGasMultiplier,
          verificationGasLimitMultiplier: accountChains[plan.chainIndex].verificationGasLimitMultiplier,
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
            type: legs.find((l) => l.chainIndex === plan.chainIndex)!.type,
          };
        }),
      );

      // Track per-leg depositIds in a local map so the delivery-wait phase
      // can read them without reaching back into React state.
      const legDeposits = new Map<number, { depositId: bigint; originChainId: bigint }>();

      const inclusionPromises = results.map((r, i) => {
        if (r.status !== 'sent') return Promise.resolve();
        return r.response.included().then((receipt) => {
          const plan = plans[i];
          const leg = legs.find((l) => l.chainIndex === plan.chainIndex)!;
          const sourceChain = accountChains[plan.chainIndex];

          if (receipt == null) {
            updateChainResult(i, { error: 'Receipt not found (timeout)' });
            return;
          }
          if (!receipt.success) {
            updateChainResult(i, { error: 'Execution failed' });
            return;
          }

          updateChainResult(i, { txHash: receipt.receipt.transactionHash });

          if (leg.type !== 'bridge') return;

          try {
            const depositId = extractDepositIdFromLogs(
              receipt.receipt.logs,
              sourceChain.spokePoolAddress,
            );
            legDeposits.set(i, { depositId, originChainId: sourceChain.chainId });
            updateChainResult(i, { depositId, delivering: true });
          } catch (e) {
            updateChainResult(i, {
              error: `Could not extract Across depositId: ${(e as Error).message}`,
            });
          }
        });
      });

      await Promise.all(inclusionPromises);

      if (legDeposits.size > 0) {
        setStep('delivering');
        await Promise.all(
          Array.from(legDeposits.entries()).map(async ([i, { depositId, originChainId }]) => {
            const status = await waitForDeposit(originChainId, depositId);
            updateChainResult(i, {
              delivering: false,
              delivered: status.status === 'filled',
              expired: status.status === 'expired',
              fillTxHash: status.fillTxHash,
            });
          }),
        );
      }

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
    setLegs([]);
    setChainResults([]);
    setAmountInput('');
    setRecipient('');
    setError(undefined);
    setManualTab(null);
  };

  return (
    <div className="card action-card">
      {step === 'idle' && (
        <div className="tab-bar">
          <button
            type="button"
            className={`tab-button ${tab === 'send' ? 'tab-active' : ''}`}
            onClick={() => setManualTab('send')}
          >
            Send
          </button>
          <button
            type="button"
            className={`tab-button ${tab === 'receive' ? 'tab-active' : ''}`}
            onClick={() => setManualTab('receive')}
          >
            Receive
          </button>
        </div>
      )}

      {step === 'idle' && tab === 'receive' && accountAddress && (
        <ReceiveView accountAddress={accountAddress} />
      )}

      {((step === 'idle' && tab === 'send') || step === 'confirm') && (
        <div className="unified-balance">
          <div className="balance-label">Unified {tokenSymbol} Balance</div>
          <div className="balance-amount">
            {loadingBalances ? '...' : formatToken(unifiedBalance)}
          </div>
          <div className="balance-breakdown">
            {accountChains.map((chain, i) => (
              <span key={i} className="chain-balance">
                <ChainIcon chainId={chain.chainId} />
                {chain.chainName}: {formatToken(balances[i])}
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

      {step === 'idle' && tab === 'send' && accountAddress && (
        <div className="transfer-form">
          {unifiedBalance === 0n && (
            <div className="send-empty-state">
              <p>No balance yet.</p>
              <button
                type="button"
                className="send-empty-link"
                onClick={() => setManualTab('receive')}
              >
                Switch to Receive →
              </button>
            </div>
          )}
          <div className="form-field">
            <label className="form-label">Recipient</label>
            <input type="text" className="address-input" placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {isSelfTransfer && <span className="field-error">Cannot send to your own address</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Amount ({tokenSymbol})</label>
            <div className="amount-input-wrap">
              <input
                type="text"
                className="address-input amount-input"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              {unifiedBalance > 0n && (
                <button
                  type="button"
                  className="amount-max-button"
                  onClick={handleMax}
                  disabled={maxLoading}
                  title={maxLoading ? 'Calculating bridge fees…' : 'Use full balance (after bridge fees)'}
                >
                  {maxLoading ? '•••' : 'MAX'}
                </button>
              )}
            </div>
            <span className="amount-fiat-estimate">≈ ${formatFiat(parsedAmount ?? 0n)}</span>
          </div>
          <div className="form-field">
            <label className="form-label">Recipient Chain</label>
            <div className="chain-selector">
              {destinationChains.map((chain, i) => (
                <button key={i} className={`chain-option ${destChainIndex === i ? 'chain-option-active' : ''}`} onClick={() => setDestChainIndex(i)}>
                  <ChainIcon chainId={chain.chainId} />
                  {chain.chainName}
                </button>
              ))}
            </div>
          </div>
          <button className="primary-button" onClick={handleSend} disabled={!canSend}>
            Send {parsedAmount && isAmountValid ? `${formatToken(parsedAmount)} ${tokenSymbol}` : tokenSymbol}
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="confirm-breakdown">
          <h3>Review</h3>
          <p className="confirm-summary">
            Sending {formatToken(parsedAmount!)} {tokenSymbol} to{' '}
            <code>{recipient.slice(0, 8)}...{recipient.slice(-6)}</code> on{' '}
            {destination.chainName}
          </p>
          <div className="confirm-steps">
            {legs.map((leg, i) => (
              <div key={i} className="confirm-step">
                <span className="confirm-chain">
                  <ChainIcon chainId={accountChains[leg.chainIndex].chainId} />
                  {accountChains[leg.chainIndex].chainName}
                </span>
                <span className="confirm-action">
                  {formatToken(leg.outputAmount)} {tokenSymbol}
                  <span className="action-chip">
                    {leg.type === 'local-transfer' ? 'Direct' : 'Cross-chain'}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {legs.some((l) => l.type === 'bridge') && (
            <p className="confirm-note">Cross-chain legs deliver in seconds.</p>
          )}
          <div className="confirm-actions">
            <button className="primary-button" onClick={handleConfirm}>Confirm &amp; Sign</button>
            <button className="secondary-button" onClick={handleReset}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'resolving' && <p className="step-label">Quoting fees…</p>}
      {step === 'preparing' && <p className="step-label">Preparing transfer…</p>}
      {step === 'signing' && <p className="step-label">Authenticate with your passkey…</p>}
      {step === 'delivering' && <p className="step-label">Sent — delivering to {destination.chainName}…</p>}

      {(step === 'pending' || step === 'delivering' || step === 'success') && (
        <>
          {step === 'success' && (() => {
            // Honest status: a leg counts as fully done only if it executed AND
            // (for bridges) the destination saw the funds arrive.
            const hasFailure = chainResults.some((r) => !!r.error);
            const hasUndeliveredBridge = chainResults.some(
              (r) => r.type === 'bridge' && !!r.txHash && r.delivered === false,
            );
            const truncatedRecipient = `${recipient.slice(0, 8)}...${recipient.slice(-6)}`;

            if (hasFailure) {
              return (
                <div className="success-banner failure-banner">
                  <p>Couldn't send on every chain — see details below.</p>
                </div>
              );
            }

            if (hasUndeliveredBridge) {
              return (
                <div className="success-banner">
                  <div className="success-banner-headline">Sent ✓</div>
                  <p className="success-banner-subline">Delivering to {destination.chainName}…</p>
                </div>
              );
            }

            return (
              <div className="success-banner">
                <div className="success-banner-headline">Sent ✓</div>
                <p className="success-banner-subline">
                  {formatToken(parsedAmount!)} {tokenSymbol} to <code>{truncatedRecipient}</code> on {destination.chainName}
                </p>
              </div>
            );
          })()}
          <div className="chain-results">
            {chainResults.map((result, i) => {
              const chain = accountChains[result.chainIndex];
              const isPending = result.userOpHash && !result.txHash && !result.error;
              const isError = !!result.error;
              const isBridge = result.type === 'bridge';
              const isDelivering = isBridge && result.delivering;
              const isDelivered = isBridge && result.delivered;
              const isExpired = isBridge && result.expired === true;
              const isSourceConfirmedOnly = isBridge && !!result.txHash && !result.delivering && !result.delivered && !result.expired;
              const isLocalConfirmed = !isBridge && !!result.txHash;
              let statusClass = '';
              if (isPending || isDelivering) statusClass = 'pending';
              else if (isLocalConfirmed || isDelivered) statusClass = 'success';
              else if (isError || isExpired) statusClass = 'error';
              else if (isSourceConfirmedOnly) statusClass = 'pending';
              return (
                <div key={i} className="chain-status-card">
                  <strong>
                    <ChainIcon chainId={chain.chainId} />
                    {chain.chainName}
                  </strong>
                  <span className="action-chip">{result.type === 'local-transfer' ? 'Direct' : 'Cross-chain'}</span>
                  <div className="chain-status-row">
                    <span className={`status-dot ${statusClass}`} />
                    <span>
                      {isPending && 'Sending…'}
                      {isLocalConfirmed && 'Arrived'}
                      {isDelivering && `Delivering to ${destination.chainName}…`}
                      {isDelivered && 'Arrived'}
                      {isExpired && `Couldn't deliver — funds returned to ${chain.chainName}`}
                      {isSourceConfirmedOnly && 'Sent'}
                      {isError && result.error}
                    </span>
                  </div>
                  {!!result.txHash && (
                    <a className="chain-track-link" target="_blank" href={`${chain.explorerUrl}/tx/${result.txHash}`}>View on {chain.chainName} ↗</a>
                  )}
                  {!!result.fillTxHash && (
                    <a
                      className="chain-track-link"
                      target="_blank"
                      href={`${destination.explorerUrl}/tx/${result.fillTxHash}`}
                    >
                      View on {destination.chainName} ↗
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          {step === 'success' && (
            <>
              <div className="completion-metrics">
                <div className="metric"><span className="metric-value">1</span><span className="metric-label">signature</span></div>
                <div className="metric"><span className="metric-value">{chainResults.length}</span><span className="metric-label">chains used</span></div>
              </div>
              <button className="primary-button" style={{ marginTop: '1rem' }} onClick={handleReset}>New Transfer</button>
            </>
          )}
        </>
      )}

      {error && <div className="error-message"><p>Error: {error}</p></div>}
    </div>
  );
}

export { TransferCard };
