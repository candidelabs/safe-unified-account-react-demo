import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
} from 'abstractionkit';

import type { PasskeyLocalStorageFormat } from '../logic/passkeys';
import { signAndSendMultiChainUserOps } from '../logic/userOp';
import { accountChains, destinationChains, tokenSymbol } from '../logic/chains';
import { ChainIcon } from './ChainIcon';
import { TokenIcon } from './TokenIcon';
import {
  readAllBalances,
  readBalance,
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

// Half-up round to N decimals + thousand separators on the integer part.
// Used in the Review screen so users see "147.94" not "147.938281".
function formatTokenShort(amount: bigint, decimals = 2): string {
  const scale = 10n ** BigInt(TOKEN_DECIMALS - decimals);
  const rounded = (amount + scale / 2n) / scale;
  const denom = 10n ** BigInt(decimals);
  const whole = rounded / denom;
  const frac = rounded % denom;
  return `${whole.toLocaleString('en-US')}.${frac.toString().padStart(decimals, '0')}`;
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
  const [debugFetchError, setDebugFetchError] = useState<string | null>(null);
  const [debugPerChain, setDebugPerChain] = useState<Array<{ chainId: string; name: string; token: string; rpc: string; balance?: string; error?: string }>>([]);

  // Derive directly from the passkey instead of reading the localStorage entry
  // IdentityStrip writes — that write happens in a useEffect, so on the first
  // render after passkey creation it isn't there yet and the Receive tab would
  // render empty until a state change forced a re-read.
  const accountAddress = useMemo(
    () => SafeAccount.createAccountAddress([passkey.pubkeyCoordinates]) as `0x${string}`,
    [passkey],
  );
  const unifiedBalance = balances.reduce((sum, b) => sum + b, 0n);
  // Auto-default: zero balance ⇒ Receive (the new-user path), funded ⇒ Send.
  // Once the user clicks a tab, manualTab takes over until handleReset clears it.
  const tab: 'send' | 'receive' = manualTab ?? (unifiedBalance === 0n ? 'receive' : 'send');
  const parsedAmount = parseToken(amountInput);
  const destination = destinationChains[destChainIndex];

  const fetchBalances = useCallback(async () => {
    if (!accountAddress) return;
    setLoadingBalances(true);
    setDebugFetchError(null);
    try {
      const result = await readAllBalances(accountChains, accountAddress);
      setBalances(result);
    } catch (err) {
      console.error('Failed to fetch balances:', err);
      setDebugFetchError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    } finally {
      setLoadingBalances(false);
    }

    const perChain = await Promise.all(
      accountChains.map(async (chain) => {
        const base = {
          chainId: chain.chainId.toString(),
          name: chain.chainName,
          token: chain.token,
          rpc: chain.jsonRpcProvider,
        };
        try {
          const b = await readBalance(chain, accountAddress);
          return { ...base, balance: b.toString() };
        } catch (err) {
          return { ...base, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        }
      }),
    );
    setDebugPerChain(perChain);
  }, [accountAddress]);

  useEffect(() => {
    fetchBalances();
  }, [fetchBalances]);

  const isValidRecipient = ADDRESS_REGEX.test(recipient.trim());
  const isSelfTransfer = recipient.trim().toLowerCase() === accountAddress?.toLowerCase();
  const isAmountValid = parsedAmount !== null && parsedAmount > 0n && parsedAmount <= unifiedBalance;
  const canSend = isValidRecipient && !isSelfTransfer && isAmountValid && step === 'idle';

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

  const debugEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

  return (
    <div className="card action-card">
      {debugEnabled && (
        <pre
          style={{
            background: '#111',
            color: '#0f0',
            padding: '8px',
            fontSize: '10px',
            lineHeight: 1.3,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            border: '1px solid #0f0',
            borderRadius: '4px',
            margin: '0 0 12px',
            maxHeight: '50vh',
            overflow: 'auto',
          }}
        >
          {JSON.stringify(
            {
              accountAddress,
              loadingBalances,
              unifiedBalance: unifiedBalance.toString(),
              balancesIndexed: balances.map((b, i) => ({
                i,
                chain: accountChains[i]?.chainName,
                chainId: accountChains[i]?.chainId.toString(),
                balance: b.toString(),
              })),
              debugFetchError,
              debugPerChain,
              accountChainsCount: accountChains.length,
            },
            null,
            2,
          )}
        </pre>
      )}
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
          <div className="balance-label">Unified balance across {accountChains.length} chains</div>
          <div className="balance-token-row">
            <TokenIcon symbol={tokenSymbol} size={28} />
            <span className="balance-token-symbol">{tokenSymbol}</span>
          </div>
          <div className="balance-amount">
            {loadingBalances ? '...' : formatToken(unifiedBalance)}
          </div>
          <div className="balance-breakdown-label">Held on</div>
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
            <input
              type="text"
              className="address-input"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
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

      {step === 'confirm' && (() => {
        const totalInput = legs.reduce((sum, l) => sum + l.inputAmount, 0n);
        const totalOutput = legs.reduce((sum, l) => sum + l.outputAmount, 0n);
        const bridgeFee = totalInput - totalOutput;
        const sourceLegs = legs.filter((l) => l.inputAmount > 0n);

        return (
          <div className="confirm-breakdown">
            <h3>Review transfer</h3>

            <div className="review-hero">
              <div className="review-hero-amount">
                {formatTokenShort(totalOutput)} {tokenSymbol}
              </div>
              <div className="review-hero-fiat">≈ ${formatFiat(totalOutput)}</div>
              <div className="review-hero-to">
                <span className="review-hero-label">To</span>
                <code>{recipient.slice(0, 6)}…{recipient.slice(-4)}</code>
                <span className="review-hero-chain">
                  <ChainIcon chainId={destination.chainId} />
                  {destination.chainName}
                </span>
              </div>
            </div>

            {sourceLegs.length > 0 && (
              <div className="review-source">
                <div className="review-section-label">
                  Sourced from {sourceLegs.length} chain{sourceLegs.length > 1 ? 's' : ''}
                </div>
                <ul className="review-source-rows">
                  {sourceLegs.map((leg, i) => (
                    <li key={i} className="review-source-row">
                      <span className="review-source-chain">
                        <ChainIcon chainId={accountChains[leg.chainIndex].chainId} />
                        {accountChains[leg.chainIndex].chainName}
                      </span>
                      <span className="review-source-amount">
                        {formatTokenShort(leg.inputAmount)} {tokenSymbol}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="review-totals">
              {bridgeFee > 0n && (
                <div className="review-total-row">
                  <span>Bridge fee</span>
                  <span>+{formatTokenShort(bridgeFee)} {tokenSymbol}</span>
                </div>
              )}
              <div className="review-total-row review-total-spend">
                <span>You send</span>
                <span>{formatTokenShort(totalInput)} {tokenSymbol}</span>
              </div>
            </div>

            {legs.some((l) => l.type === 'bridge') && (
              <p className="review-hint">Funds arrive in seconds.</p>
            )}

            <div className="confirm-actions">
              <button className="primary-button" onClick={handleConfirm}>
                Confirm with passkey
              </button>
              <button className="ghost-button" onClick={handleReset}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {(step === 'resolving' || step === 'preparing' || step === 'signing') && (
        <div className="tx-status-inline">
          <span className="tx-status-spinner" />
          <span>
            {step === 'resolving' && 'Quoting fees…'}
            {step === 'preparing' && 'Preparing transfer…'}
            {step === 'signing' && 'Authenticate with your passkey'}
          </span>
        </div>
      )}

      {(step === 'pending' || step === 'delivering' || step === 'success') && (() => {
        const hasFailure = chainResults.some((r) => !!r.error);
        const hasReturned = chainResults.some((r) => r.expired === true);
        const truncatedRecipient = `${recipient.slice(0, 6)}…${recipient.slice(-4)}`;
        const fullySent = step === 'success' && !hasFailure && !hasReturned;

        let heroVariant: 'spinner' | 'check' | 'none' = 'spinner';
        let heroHeadline = '';
        if (fullySent) {
          heroVariant = 'check';
          heroHeadline = `${formatTokenShort(parsedAmount!)} ${tokenSymbol} sent`;
        } else if (step === 'success' && (hasFailure || hasReturned)) {
          heroVariant = 'none';
          heroHeadline = hasFailure
            ? "Couldn't send on every chain"
            : 'Some funds returned to source';
        } else if (step === 'delivering') {
          heroHeadline = `Delivering to ${destination.chainName}…`;
        } else {
          heroHeadline = `Sending ${formatTokenShort(parsedAmount!)} ${tokenSymbol}`;
        }

        const showRecipientSubline = !hasFailure && !hasReturned;
        const chainCount = chainResults.length;

        return (
          <div className="tx-status">
            <div className={`tx-status-hero ${heroVariant === 'none' ? 'tx-status-hero-textonly' : ''}`}>
              {heroVariant !== 'none' && (
                <div className={`tx-status-icon tx-status-icon-${heroVariant}`}>
                  {heroVariant === 'check' && (
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="5 12 10 17 19 7" />
                    </svg>
                  )}
                </div>
              )}
              <div className="tx-status-hero-content">
                <div className="tx-status-headline">{heroHeadline}</div>
                {showRecipientSubline ? (
                  <div className="tx-status-subline">
                    <span className="tx-status-subline-label">To</span>
                    <code>{truncatedRecipient}</code>
                    <span className="tx-status-subline-chain">
                      <ChainIcon chainId={destination.chainId} />
                      {destination.chainName}
                    </span>
                  </div>
                ) : (
                  <div className="tx-status-subline">See breakdown below.</div>
                )}
              </div>
            </div>

            <div className="tx-status-source">
              <div className="review-section-label">
                {chainCount} chain{chainCount > 1 ? 's' : ''}
              </div>
              <ul className="tx-status-rows">
                {chainResults.map((result, i) => {
                  const chain = accountChains[result.chainIndex];
                  const leg = legs.find((l) => l.chainIndex === result.chainIndex);
                  const isPending = result.userOpHash && !result.txHash && !result.error;
                  const isError = !!result.error;
                  const isBridge = result.type === 'bridge';
                  const isDelivering = isBridge && result.delivering;
                  const isDelivered = isBridge && result.delivered;
                  const isExpired = isBridge && result.expired === true;
                  const isSourceConfirmedOnly = isBridge && !!result.txHash && !result.delivering && !result.delivered && !result.expired;
                  const isLocalConfirmed = !isBridge && !!result.txHash;

                  let statusClass = '';
                  if (isPending || isDelivering || isSourceConfirmedOnly) statusClass = 'pending';
                  else if (isLocalConfirmed || isDelivered) statusClass = 'success';
                  else if (isError || isExpired) statusClass = 'error';

                  let statusText = '';
                  if (isPending) statusText = 'Sending…';
                  else if (isLocalConfirmed) statusText = 'Arrived';
                  else if (isDelivering) statusText = 'Delivering…';
                  else if (isDelivered) statusText = 'Arrived';
                  else if (isExpired) statusText = 'Returned';
                  else if (isSourceConfirmedOnly) statusText = 'Sent on chain';
                  else if (isError) statusText = result.error!;

                  return (
                    <li key={i} className="tx-status-row">
                      <div className="tx-status-row-top">
                        <span className="tx-status-row-chain">
                          <ChainIcon chainId={chain.chainId} />
                          {chain.chainName}
                        </span>
                        {leg && (
                          <span className="tx-status-row-amount">
                            {formatTokenShort(leg.inputAmount)} {tokenSymbol}
                          </span>
                        )}
                      </div>
                      <div className="tx-status-row-bottom">
                        <span className={`tx-status-row-state tx-status-row-state-${statusClass}`}>
                          <span className={`status-dot ${statusClass}`} />
                          {statusText}
                        </span>
                        <span className="tx-status-row-links">
                          {!!result.txHash && (
                            <a target="_blank" rel="noreferrer" href={`${chain.explorerUrl}/tx/${result.txHash}`}>
                              {chain.chainName} ↗
                            </a>
                          )}
                          {!!result.fillTxHash && (
                            <a target="_blank" rel="noreferrer" href={`${destination.explorerUrl}/tx/${result.fillTxHash}`}>
                              {destination.chainName} ↗
                            </a>
                          )}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {step === 'success' && (
              <>
                {fullySent && (
                  <div className="tx-status-metrics">
                    <span><strong>1</strong> signature</span>
                    <span className="tx-status-metrics-sep">·</span>
                    <span><strong>{chainCount}</strong> chain{chainCount > 1 ? 's' : ''}</span>
                  </div>
                )}
                <button className="primary-button tx-status-cta" onClick={handleReset}>
                  New transfer
                </button>
              </>
            )}
          </div>
        );
      })()}

      {error && <div className="error-message"><p>Error: {error}</p></div>}
    </div>
  );
}

export { TransferCard };
