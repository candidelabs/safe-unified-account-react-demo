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

      {step === 'idle' && accountAddress && (
        <div className="transfer-form">
          <div className="form-field">
            <label className="form-label">Recipient</label>
            <input type="text" className="address-input" placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} />
            {isSelfTransfer && <span className="field-error">Cannot send to your own address</span>}
          </div>
          <div className="form-field">
            <label className="form-label">Amount (USDT0)</label>
            <input type="text" className="address-input" placeholder="0.00" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Destination Chain</label>
            <div className="chain-selector">
              {chains.map((chain, i) => (
                <button key={i} className={`chain-option ${destChainIndex === i ? 'chain-option-active' : ''}`} onClick={() => setDestChainIndex(i)}>
                  {chain.chainName}
                </button>
              ))}
            </div>
          </div>
          <button className="primary-button" onClick={handleSend} disabled={!canSend}>
            Send {parsedAmount && isAmountValid ? `${formatUsdt(parsedAmount)} USDT0` : 'USDT0'}
          </button>
        </div>
      )}

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
            <p className="confirm-note">Bridged funds arrive at the recipient in ~1 minute via LayerZero.</p>
          )}
          <div className="confirm-actions">
            <button className="primary-button" onClick={handleConfirm}>Confirm &amp; Sign</button>
            <button className="secondary-button" onClick={handleReset}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'preparing' && <p className="step-label">Preparing multichain operations…</p>}
      {step === 'signing' && <p className="step-label">Authenticate with your passkey…</p>}

      {(step === 'pending' || step === 'success') && (
        <>
          {step === 'success' && (
            <div className="success-banner">
              <p>Sent {formatUsdt(parsedAmount!)} USDT0 across {chainResults.length} chain{chainResults.length > 1 ? 's' : ''} with a single signature</p>
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
                  <span className="chain-action-type">{result.type === 'local-transfer' ? 'Transfer' : 'Bridge'}</span>
                  <div className="chain-status-row">
                    <span className={`status-dot ${statusClass}`} />
                    <span>
                      {isPending && 'Pending...'}
                      {isSuccess && 'Confirmed'}
                      {isError && result.error}
                    </span>
                  </div>
                  {isSuccess && result.txHash && (
                    <a className="chain-track-link" target="_blank" href={`${chain.explorerUrl}/tx/${result.txHash}`}>View transaction ↗</a>
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
