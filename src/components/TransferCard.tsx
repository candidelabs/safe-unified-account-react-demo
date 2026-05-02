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

  const accountAddress = getItem('accountAddress') as `0x${string}`;
  const unifiedBalance = balances.reduce((sum, b) => sum + b, 0n);
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

      // Pre-flight: check native balance for bridge fees on source chains
      const bridgeContribs = contributions.filter((c) => c.type === 'bridge');
      if (bridgeContribs.length > 0) {
        for (const contrib of bridgeContribs) {
          const srcChain = accountChains[contrib.chainIndex];
          const [nativeBalance, requiredFee] = await Promise.all([
            readNativeBalance(srcChain, accountAddress),
            quoteBridgeFee(srcChain, intent.destination, intent.recipient, contrib.amount),
          ]);
          if (nativeBalance < requiredFee) {
            throw new Error(
              `Insufficient ${srcChain.chainName} native balance for LayerZero fee. ` +
              `Need ${requiredFee} wei, have ${nativeBalance} wei.`
            );
          }
        }
      }

      // Snapshot recipient's destination balance so we can detect LZ delivery
      // by waiting for the balance to grow by the full intended total.
      const recipientStartBalance = bridgeContribs.length > 0
        ? await readBalance(intent.destination, intent.recipient)
        : 0n;

      const plans = await buildTransferMetaTransactions(
        accountChains,
        contributions,
        intent,
        accountAddress,
      );

      // Create UserOperations for participating chains only.
      // `expectedSigners` lets the SDK generate a WebAuthn-shaped dummy
      // signature for gas estimation so the bundler's estimate matches what
      // the real signature will consume at execution.
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

      // Use main's orchestrator — includes paymaster commit/finalize
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

      // For bridge legs, source-chain inclusion only confirms the LayerZero
      // message was dispatched — not delivered. Poll the destination chain's
      // recipient balance to confirm delivery before declaring success.
      if (bridgeContribs.length > 0) {
        setStep('delivering');
        setChainResults((prev) =>
          prev.map((r) =>
            r.type === 'bridge' && r.txHash ? { ...r, delivering: true } : r,
          ),
        );

        const expectedBalance = recipientStartBalance + intent.totalAmount;
        const finalBalance = await waitForDestinationBalance(
          intent.destination,
          intent.recipient,
          expectedBalance,
        );
        const delivered = finalBalance >= expectedBalance;

        setChainResults((prev) =>
          prev.map((r) =>
            r.type === 'bridge' && r.txHash
              ? { ...r, delivering: false, delivered }
              : r,
          ),
        );

        if (!delivered) {
          setError(
            `Source transactions confirmed, but destination delivery did not arrive within 5 minutes. ` +
            `LayerZero may still deliver — check ${intent.destination.chainName} later.`,
          );
        }
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
  };

  return (
    <div className="card action-card">
      {(step === 'idle' || step === 'confirm') && (
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

      {step === 'idle' && accountAddress && (
        <div className="transfer-form">
          <div className="form-field">
            <label className="form-label">Recipient</label>
            <input type="text" className="address-input" placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {isSelfTransfer && <span className="field-error">Cannot send to your own address</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Amount ({tokenSymbol})</label>
            <input type="text" className="address-input" placeholder="0.00" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Destination Chain</label>
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
          <h3>Transaction Breakdown</h3>
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
                  {leg.type === 'local-transfer'
                    ? `Transfer ${formatToken(leg.outputAmount)} ${tokenSymbol}`
                    : `Bridge ${formatToken(leg.outputAmount)} ${tokenSymbol} → ${destination.chainName}`}
                </span>
              </div>
            ))}
          </div>
          {legs.some((l) => l.type === 'bridge') && (
            <p className="confirm-note">Bridged funds arrive at the recipient in seconds via Across.</p>
          )}
          <div className="confirm-actions">
            <button className="primary-button" onClick={handleConfirm}>Confirm &amp; Sign</button>
            <button className="secondary-button" onClick={handleReset}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'resolving' && <p className="step-label">Quoting Across fees…</p>}
      {step === 'preparing' && <p className="step-label">Preparing multichain operations…</p>}
      {step === 'signing' && <p className="step-label">Authenticate with your passkey…</p>}
      {step === 'delivering' && <p className="step-label">Source confirmed — waiting on LayerZero delivery to destination…</p>}

      {(step === 'pending' || step === 'delivering' || step === 'success') && (
        <>
          {step === 'success' && (() => {
            // Honest status: a leg counts as fully done only if it executed AND
            // (for bridges) the destination saw the funds arrive.
            const hasFailure = chainResults.some((r) => !!r.error);
            const hasUndeliveredBridge = chainResults.some(
              (r) => r.type === 'bridge' && !!r.txHash && r.delivered === false,
            );
            const chainCountLabel = `${chainResults.length} chain${chainResults.length > 1 ? 's' : ''}`;
            const bannerClass = hasFailure ? 'success-banner failure-banner' : 'success-banner';
            let message: string;
            if (hasFailure) {
              message = `Some operations failed across ${chainCountLabel} — see per-chain status below.`;
            } else if (hasUndeliveredBridge) {
              message = `Source transactions confirmed across ${chainCountLabel} with a single signature. Bridge delivery still in progress.`;
            } else {
              message = `Sent ${formatToken(parsedAmount!)} ${tokenSymbol} across ${chainCountLabel} with a single signature`;
            }
            return (
              <div className={bannerClass}>
                <p>{message}</p>
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
              const isSourceConfirmedOnly = isBridge && !!result.txHash && !result.delivering && !result.delivered;
              const isLocalConfirmed = !isBridge && !!result.txHash;
              let statusClass = '';
              if (isPending || isDelivering) statusClass = 'pending';
              else if (isLocalConfirmed || isDelivered) statusClass = 'success';
              else if (isError) statusClass = 'error';
              else if (isSourceConfirmedOnly) statusClass = 'pending';
              return (
                <div key={i} className="chain-status-card">
                  <strong>
                    <ChainIcon chainId={chain.chainId} />
                    {chain.chainName}
                  </strong>
                  <span className="chain-action-type">{result.type === 'local-transfer' ? 'Transfer' : 'Bridge'}</span>
                  <div className="chain-status-row">
                    <span className={`status-dot ${statusClass}`} />
                    <span>
                      {isPending && 'Pending...'}
                      {isLocalConfirmed && 'Confirmed'}
                      {isDelivering && 'Bridging to destination…'}
                      {isDelivered && 'Delivered'}
                      {isSourceConfirmedOnly && 'Source confirmed — delivery pending'}
                      {isError && result.error}
                    </span>
                  </div>
                  {!!result.txHash && (
                    <a className="chain-track-link" target="_blank" href={`${chain.explorerUrl}/tx/${result.txHash}`}>View source transaction ↗</a>
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
