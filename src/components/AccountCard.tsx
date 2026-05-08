import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
	SafeMultiChainSigAccountV1 as SafeAccount,
	MetaTransaction,
	SocialRecoveryModule,
	SocialRecoveryModuleGracePeriodSelector
} from "abstractionkit";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

import { PasskeyLocalStorageFormat } from "../logic/passkeys";
import { signAndSendMultiChainUserOps } from "../logic/userOp";
import { getItem } from "../logic/storage";
import { accountChains as chains } from "../logic/chains";
import { ChainIcon } from "./ChainIcon";

type Step = "idle" | "preparing" | "signing" | "pending" | "success";
type Tab = "signers" | "guardians";

interface ChainResult {
	userOpHash?: string;
	txHash?: string;
	error?: string;
}

interface ActionSummary {
	type: "add" | "remove";
	address: string;
	tab: Tab;
}

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

// Compute the union of address arrays from each chain (case-insensitive),
// preserving the first canonical-cased version we saw.
function unionAddresses(perChain: string[][]): string[] {
	const seen = new Map<string, string>();
	for (const list of perChain) {
		for (const addr of list) {
			const key = addr.toLowerCase();
			if (!seen.has(key)) seen.set(key, addr);
		}
	}
	return Array.from(seen.values());
}

// For a given address, return a boolean[] aligned with chains indicating
// whether that address is present on each chain.
function presenceVector(perChain: string[][], addr: string): boolean[] {
	const target = addr.toLowerCase();
	return perChain.map((list) => list.some((a) => a.toLowerCase() === target));
}

function AccountCard({ passkey }: { passkey: PasskeyLocalStorageFormat }) {
	const [ownersPerChain, setOwnersPerChain] = useState<string[][]>(
		() => chains.map(() => []),
	);
	const [guardiansPerChain, setGuardiansPerChain] = useState<string[][]>(
		() => chains.map(() => []),
	);
	const [moduleEnabledPerChain, setModuleEnabledPerChain] = useState<boolean[]>(
		() => chains.map(() => false),
	);
	const [chainResults, setChainResults] = useState<ChainResult[]>(
		() => chains.map(() => ({})),
	);
	const [step, setStep] = useState<Step>("idle");
	const [error, setError] = useState<string>();
	const [actionSummary, setActionSummary] = useState<ActionSummary>();
	const [activeTab, setActiveTab] = useState<Tab>("signers");
	const [customAddress, setCustomAddress] = useState("");
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const lastTransactionsRef = useRef<MetaTransaction[][]>([]);

	const accountAddress = getItem("accountAddress") as string;

	const passkeySignerAddress = useMemo(
		() =>
			SafeAccount.createWebAuthnSignerVerifierAddress(
				passkey.pubkeyCoordinates.x,
				passkey.pubkeyCoordinates.y,
			).toLowerCase(),
		[passkey.pubkeyCoordinates],
	);

	const socialRecoveryModule = useMemo(() => new SocialRecoveryModule(SocialRecoveryModuleGracePeriodSelector.After3Minutes), []);

	// Read owners from EVERY chain in parallel — chains can drift apart if a
	// past multichain operation succeeded on some chains and failed on others.
	const fetchOwners = useCallback(async () => {
		if (!accountAddress) return;
		const safeAccount = new SafeAccount(accountAddress);
		const results = await Promise.all(
			chains.map(async (chain) => {
				try {
					return await safeAccount.getOwners(chain.jsonRpcProvider);
				} catch {
					// Safe not deployed on this chain yet — treat as empty
					return [] as string[];
				}
			}),
		);
		setOwnersPerChain(results);
	}, [accountAddress]);

	const fetchGuardians = useCallback(async () => {
		if (!accountAddress) return;
		const safeAccount = new SafeAccount(accountAddress);
		const results = await Promise.all(
			chains.map(async (chain) => {
				try {
					const enabled = await safeAccount.isModuleEnabled(
						chain.jsonRpcProvider,
						socialRecoveryModule.moduleAddress,
					);
					if (!enabled) return { enabled: false, list: [] as string[] };
					const list = await socialRecoveryModule.getGuardians(
						chain.jsonRpcProvider,
						accountAddress,
					);
					return { enabled: true, list };
				} catch {
					return { enabled: false, list: [] as string[] };
				}
			}),
		);
		setModuleEnabledPerChain(results.map((r) => r.enabled));
		setGuardiansPerChain(results.map((r) => r.list));
	}, [accountAddress, socialRecoveryModule]);

	useEffect(() => {
		fetchOwners();
		fetchGuardians();
	}, [fetchOwners, fetchGuardians]);

	// Run a multichain op against a SUBSET of chains (defaults to all). The
	// `buildTxs` callback receives only the targeted chain indices and must
	// return one MetaTransaction[] per *targeted* chain (in the same order).
	// chainResults stays aligned with the full chains array — non-targeted
	// chains keep an empty {} result.
	const executeMultiChainOp = async (
		buildTxs: (
			safeAccount: InstanceType<typeof SafeAccount>,
			targetedChains: typeof chains,
			targetedIndices: number[],
		) => Promise<MetaTransaction[][]>,
		chainIndices: number[] = chains.map((_, i) => i),
	) => {
		setStep("preparing");
		setError(undefined);
		setChainResults(chains.map(() => ({})));

		const safeAccount = SafeAccount.initializeNewAccount([
			passkey.pubkeyCoordinates,
		]);

		const targetedChains = chainIndices.map((i) => chains[i]);
		const targetedTransactions = await buildTxs(safeAccount, targetedChains, chainIndices);

		// Mirror targeted txs into a full per-chain array for retry support
		const allTransactions: MetaTransaction[][] = chains.map(() => []);
		chainIndices.forEach((i, j) => { allTransactions[i] = targetedTransactions[j]; });
		lastTransactionsRef.current = allTransactions;

		const userOps = await Promise.all(
			targetedChains.map((chain, j) =>
				safeAccount.createUserOperation(
					targetedTransactions[j],
					chain.jsonRpcProvider,
					chain.bundlerUrl,
					{ expectedSigners: [passkey.pubkeyCoordinates] },
				),
			),
		);

		setStep("signing");

		const results = await signAndSendMultiChainUserOps(
			targetedChains.map((chain, j) => ({
				userOp: userOps[j],
				chainId: chain.chainId,
				bundlerUrl: chain.bundlerUrl,
				paymasterUrl: chain.paymasterUrl,
				sponsorshipPolicyId: chain.sponsorshipPolicyId,
				preVerificationGasMultiplier: chain.preVerificationGasMultiplier,
				verificationGasLimitMultiplier: chain.verificationGasLimitMultiplier,
			})),
			passkey,
			safeAccount,
		);

		setStep("pending");
		setChainResults((prev) => {
			const next = [...prev];
			results.forEach((r, j) => {
				const i = chainIndices[j];
				next[i] = r.status === "sent"
					? { userOpHash: r.response.userOperationHash }
					: { error: r.error };
			});
			return next;
		});

		const inclusionPromises = results.map((r, j) => {
			if (r.status !== "sent") return Promise.resolve();
			const i = chainIndices[j];
			return r.response.included().then((receipt) => {
				setChainResults((prev) => {
					const next = [...prev];
					if (receipt == null) {
						next[i] = { ...next[i], error: "No receipt returned" };
					} else if (receipt.success) {
						next[i] = { ...next[i], txHash: receipt.receipt.transactionHash };
					} else {
						next[i] = { ...next[i], error: "Execution failed" };
					}
					return next;
				});
			});
		});

		await Promise.all(inclusionPromises);
		setStep("success");
		await fetchOwners();
		await fetchGuardians();
	};

	const handleRetryFailedChains = async () => {
		const failedIndices = chainResults
			.map((r, i) => (r.error ? i : -1))
			.filter((i) => i !== -1);
		if (failedIndices.length === 0) return;

		setRetrying(true);
		// Clear errors on failed chains
		setChainResults((prev) => {
			const next = [...prev];
			for (const i of failedIndices) next[i] = {};
			return next;
		});

		try {
			const safeAccount = SafeAccount.initializeNewAccount([
				passkey.pubkeyCoordinates,
			]);

			// Rebuild UserOps for failed chains only
			const failedChains = failedIndices.map((i) => chains[i]);
			const failedTxs = failedIndices.map((i) => lastTransactionsRef.current[i]);

			const userOps = await Promise.all(
				failedChains.map((chain, j) =>
					safeAccount.createUserOperation(
						failedTxs[j],
						chain.jsonRpcProvider,
						chain.bundlerUrl,
						{ expectedSigners: [passkey.pubkeyCoordinates] },
					),
				),
			);

			// Full sign flow for failed chains (new passkey prompt)
			const results = await signAndSendMultiChainUserOps(
				failedChains.map((chain, j) => ({
					userOp: userOps[j],
					chainId: chain.chainId,
					bundlerUrl: chain.bundlerUrl,
					paymasterUrl: chain.paymasterUrl,
					sponsorshipPolicyId: chain.sponsorshipPolicyId,
					preVerificationGasMultiplier: chain.preVerificationGasMultiplier,
					verificationGasLimitMultiplier: chain.verificationGasLimitMultiplier,
				})),
				passkey,
				safeAccount,
			);

			// Map results back to original chain indices
			setChainResults((prev) => {
				const next = [...prev];
				results.forEach((r, j) => {
					const i = failedIndices[j];
					next[i] = r.status === "sent"
						? { userOpHash: r.response.userOperationHash }
						: { error: r.error };
				});
				return next;
			});

			// Wait for inclusion on successfully sent retries
			const inclusionPromises = results.map((r, j) => {
				if (r.status !== "sent") return Promise.resolve();
				const i = failedIndices[j];
				return r.response.included().then((receipt) => {
					setChainResults((prev) => {
						const next = [...prev];
						if (receipt == null) {
							next[i] = { ...next[i], error: "No receipt returned" };
						} else if (receipt.success) {
							next[i] = { ...next[i], txHash: receipt.receipt.transactionHash };
						} else {
							next[i] = { ...next[i], error: "Execution failed" };
						}
						return next;
					});
				});
			});

			await Promise.all(inclusionPromises);
			await fetchOwners();
			await fetchGuardians();
		} catch (err) {
			// Pre-send failure (e.g. passkey cancelled) — restore errors
			const errMsg = err instanceof Error ? err.message : "Unknown error";
			setChainResults((prev) => {
				const next = [...prev];
				for (const i of failedIndices) {
					if (!next[i].txHash && !next[i].userOpHash) {
						next[i] = { error: errMsg };
					}
				}
				return next;
			});
		} finally {
			setRetrying(false);
		}
	};

	const resolveAddress = (): string | null => {
		if (showCustomInput) {
			const addr = customAddress.trim();
			if (!ADDRESS_REGEX.test(addr)) {
				setError("Please enter a valid Ethereum address (0x...)");
				return null;
			}
			return addr;
		}
		return privateKeyToAddress(generatePrivateKey());
	};

	const reportError = (err: unknown) => {
		if (err instanceof Error) {
			console.log(err);
			setError(err.message);
		} else {
			setError("Unknown error");
		}
		setStep("idle");
	};

	// ── Signer actions ─────────────────────────────────────────────
	// Each action targets only the chains where the on-chain state actually
	// permits it. Prevents "already an owner" / "not a current owner" reverts
	// when chains have drifted out of sync.

	const buildAddSignerOnChains = async (signerAddress: string, chainIndices: number[]) =>
		executeMultiChainOp(
			async (safeAccount, targetedChains) =>
				Promise.all(
					targetedChains.map((chain) =>
						safeAccount.createAddOwnerWithThresholdMetaTransactions(
							signerAddress,
							1,
							{ nodeRpcUrl: chain.jsonRpcProvider },
						),
					),
				),
			chainIndices,
		);

	const buildRemoveSignerOnChains = async (signerToRemove: string, chainIndices: number[]) =>
		executeMultiChainOp(
			async (safeAccount, targetedChains) =>
				Promise.all(
					targetedChains.map((chain) =>
						safeAccount
							.createRemoveOwnerMetaTransaction(
								chain.jsonRpcProvider,
								signerToRemove,
								1,
							)
							.then((tx) => [tx]),
					),
				),
			chainIndices,
		);

	const handleAddSigner = async () => {
		const signerAddress = resolveAddress();
		if (!signerAddress) return;

		// Only target chains where this address isn't already an owner
		const presence = presenceVector(ownersPerChain, signerAddress);
		const targetIndices = presence
			.map((present, i) => (present ? -1 : i))
			.filter((i) => i !== -1);

		if (targetIndices.length === 0) {
			setError("That address is already an owner on every chain.");
			return;
		}

		setActionSummary({ type: "add", address: signerAddress, tab: "signers" });
		setCustomAddress("");
		setShowCustomInput(false);

		try {
			await buildAddSignerOnChains(signerAddress, targetIndices);
		} catch (err) {
			reportError(err);
		}
	};

	const handleRemoveSigner = async (signerToRemove: string) => {
		// Only target chains where this address actually is an owner
		const presence = presenceVector(ownersPerChain, signerToRemove);
		const targetIndices = presence
			.map((present, i) => (present ? i : -1))
			.filter((i) => i !== -1);

		if (targetIndices.length === 0) {
			setError("That address isn't an owner on any chain.");
			return;
		}

		setActionSummary({ type: "remove", address: signerToRemove, tab: "signers" });

		try {
			await buildRemoveSignerOnChains(signerToRemove, targetIndices);
		} catch (err) {
			reportError(err);
		}
	};

	// Sync actions: bring divergent state in line with the user's preference
	const handleSyncSignerToMissingChains = async (signerAddress: string) => {
		const presence = presenceVector(ownersPerChain, signerAddress);
		const missingIndices = presence
			.map((present, i) => (present ? -1 : i))
			.filter((i) => i !== -1);
		if (missingIndices.length === 0) return;

		setActionSummary({ type: "add", address: signerAddress, tab: "signers" });
		try {
			await buildAddSignerOnChains(signerAddress, missingIndices);
		} catch (err) {
			reportError(err);
		}
	};

	const handleRemoveSignerFromPresentChains = async (signerAddress: string) => {
		const presence = presenceVector(ownersPerChain, signerAddress);
		const presentIndices = presence
			.map((present, i) => (present ? i : -1))
			.filter((i) => i !== -1);
		if (presentIndices.length === 0) return;

		setActionSummary({ type: "remove", address: signerAddress, tab: "signers" });
		try {
			await buildRemoveSignerOnChains(signerAddress, presentIndices);
		} catch (err) {
			reportError(err);
		}
	};

	// The passkey is "missing" on a chain when that chain's Safe hasn't been
	// deployed yet — its address is determined by initCode that includes the
	// passkey, so deployment automatically registers it as the initial owner.
	// A no-op self-call is enough payload to trigger the bundler's initCode.
	const handleSyncPasskeyToMissingChains = async () => {
		const presence = presenceVector(ownersPerChain, passkeySignerAddress);
		const missingIndices = presence
			.map((present, i) => (present ? -1 : i))
			.filter((i) => i !== -1);
		if (missingIndices.length === 0) return;

		setActionSummary({ type: "add", address: passkeySignerAddress, tab: "signers" });
		try {
			await executeMultiChainOp(
				async () =>
					missingIndices.map(() => [
						{ to: accountAddress, value: 0n, data: "0x" },
					]),
				missingIndices,
			);
		} catch (err) {
			reportError(err);
		}
	};

	// ── Guardian actions ────────────────────────────────────────────

	const handleAddGuardian = async () => {
		const guardianAddress = resolveAddress();
		if (!guardianAddress) return;

		// Only target chains where the guardian isn't already registered
		const presence = presenceVector(guardiansPerChain, guardianAddress);
		const targetIndices = presence
			.map((present, i) => (present ? -1 : i))
			.filter((i) => i !== -1);

		if (targetIndices.length === 0) {
			setError("That address is already a guardian on every chain.");
			return;
		}

		setActionSummary({ type: "add", address: guardianAddress, tab: "guardians" });
		setCustomAddress("");
		setShowCustomInput(false);

		try {
			await executeMultiChainOp(
				async () => {
					return targetIndices.map((i) => {
						const newThreshold = BigInt(guardiansPerChain[i].length + 1);
						const addTx = socialRecoveryModule.createAddGuardianWithThresholdMetaTransaction(
							guardianAddress,
							newThreshold,
						);
						if (!moduleEnabledPerChain[i]) {
							const enableTx = socialRecoveryModule.createEnableModuleMetaTransaction(accountAddress);
							return [enableTx, addTx];
						}
						return [addTx];
					});
				},
				targetIndices,
			);
		} catch (err) {
			reportError(err);
		}
	};

	const handleRemoveGuardian = async (guardianToRemove: string) => {
		const presence = presenceVector(guardiansPerChain, guardianToRemove);
		const targetIndices = presence
			.map((present, i) => (present ? i : -1))
			.filter((i) => i !== -1);

		if (targetIndices.length === 0) {
			setError("That address isn't a guardian on any chain.");
			return;
		}

		setActionSummary({ type: "remove", address: guardianToRemove, tab: "guardians" });

		try {
			await executeMultiChainOp(
				async (_safe, targetedChains) =>
					Promise.all(
						targetedChains.map((chain, j) => {
							const i = targetIndices[j];
							const newThreshold = BigInt(Math.max(0, guardiansPerChain[i].length - 1));
							return socialRecoveryModule
								.createRevokeGuardianWithThresholdMetaTransaction(
									chain.jsonRpcProvider,
									accountAddress,
									guardianToRemove,
									newThreshold,
								)
								.then((tx) => [tx]);
						}),
					),
				targetIndices,
			);
		} catch (err) {
			reportError(err);
		}
	};

	const handleSyncGuardianToMissingChains = async (guardianAddress: string) => {
		const presence = presenceVector(guardiansPerChain, guardianAddress);
		const missingIndices = presence
			.map((present, i) => (present ? -1 : i))
			.filter((i) => i !== -1);
		if (missingIndices.length === 0) return;

		setActionSummary({ type: "add", address: guardianAddress, tab: "guardians" });
		try {
			await executeMultiChainOp(
				async () =>
					missingIndices.map((i) => {
						const newThreshold = BigInt(guardiansPerChain[i].length + 1);
						const addTx = socialRecoveryModule.createAddGuardianWithThresholdMetaTransaction(
							guardianAddress,
							newThreshold,
						);
						if (!moduleEnabledPerChain[i]) {
							const enableTx = socialRecoveryModule.createEnableModuleMetaTransaction(accountAddress);
							return [enableTx, addTx];
						}
						return [addTx];
					}),
				missingIndices,
			);
		} catch (err) {
			reportError(err);
		}
	};

	const handleRemoveGuardianFromPresentChains = async (guardianAddress: string) => {
		const presence = presenceVector(guardiansPerChain, guardianAddress);
		const presentIndices = presence
			.map((present, i) => (present ? i : -1))
			.filter((i) => i !== -1);
		if (presentIndices.length === 0) return;

		setActionSummary({ type: "remove", address: guardianAddress, tab: "guardians" });
		try {
			await executeMultiChainOp(
				async (_safe, targetedChains) =>
					Promise.all(
						targetedChains.map((chain, j) => {
							const i = presentIndices[j];
							const newThreshold = BigInt(Math.max(0, guardiansPerChain[i].length - 1));
							return socialRecoveryModule
								.createRevokeGuardianWithThresholdMetaTransaction(
									chain.jsonRpcProvider,
									accountAddress,
									guardianAddress,
									newThreshold,
								)
								.then((tx) => [tx]);
						}),
					),
				presentIndices,
			);
		} catch (err) {
			reportError(err);
		}
	};

	// Derived state for divergence-aware rendering
	const unifiedOwners = useMemo(() => unionAddresses(ownersPerChain), [ownersPerChain]);
	const unifiedGuardians = useMemo(() => unionAddresses(guardiansPerChain), [guardiansPerChain]);
	const cosigners = unifiedOwners.filter(
		(o) => o.toLowerCase() !== passkeySignerAddress,
	);

	const ownersDivergent = useMemo(
		() => unifiedOwners.some((o) => presenceVector(ownersPerChain, o).some((p) => !p)),
		[ownersPerChain, unifiedOwners],
	);
	const guardiansDivergent = useMemo(
		() => unifiedGuardians.some((g) => presenceVector(guardiansPerChain, g).some((p) => !p)),
		[guardiansPerChain, unifiedGuardians],
	);

	// Render the per-chain presence row for one address. Divergent chains
	// (missing this address) appear dimmed with a tooltip.
	const renderPresenceRow = (presence: boolean[]) => (
		<div className="presence-row">
			{chains.map((chain, i) => (
				<span
					key={i}
					className={`presence-chain ${presence[i] ? "presence-on" : "presence-off"}`}
					title={presence[i] ? `On ${chain.chainName}` : `Missing on ${chain.chainName}`}
				>
					<ChainIcon chainId={chain.chainId} size={14} />
					<span className="presence-chain-label">{chain.chainName}</span>
				</span>
			))}
		</div>
	);

	const renderChainStatusCard = (
		chainIndex: number,
		result: ChainResult,
	) => {
		const chain = chains[chainIndex];
		const isEmpty = !result.userOpHash && !result.txHash && !result.error;
		const isPending = (result.userOpHash && !result.txHash && !result.error) || (isEmpty && retrying);
		const isSuccess = !!result.txHash;
		const isError = !!result.error;

		let statusClass = "";
		if (isPending) statusClass = "pending";
		else if (isSuccess) statusClass = "success";
		else if (isError) statusClass = "error";

		return (
			<div key={chainIndex} className="chain-status-card">
				<strong>{chain.chainName}</strong>
				<div className="chain-status-row">
					<span className={`status-dot ${statusClass}`} />
					<span>
						{isPending && "Pending..."}
						{isSuccess && "Confirmed"}
						{isError && result.error}
					</span>
				</div>
				{isSuccess && result.txHash && (
					<a
						className="chain-track-link"
						target="_blank"
						rel="noopener noreferrer"
						href={`${chain.explorerUrl}/tx/${result.txHash}`}
					>
						View transaction ↗
					</a>
				)}
			</div>
		);
	};

	const actionLabel = actionSummary
		? actionSummary.tab === "signers"
			? actionSummary.type === "add" ? "Signer added" : "Signer removed"
			: actionSummary.type === "add" ? "Guardian added" : "Guardian removed"
		: "";

	const handleAdd = activeTab === "signers" ? handleAddSigner : handleAddGuardian;
	const addLabel = activeTab === "signers" ? "Add signer" : "Add guardian";

	const renderAddressInput = () => (
		<div className="address-input-section">
			{showCustomInput ? (
				<div className="address-input-row">
					<input
						type="text"
						className="address-input"
						placeholder="0x..."
						value={customAddress}
						onChange={(e) => setCustomAddress(e.target.value)}
					/>
					<button
						className="primary-button"
						onClick={handleAdd}
						disabled={!customAddress.trim()}
					>
						{addLabel}
					</button>
					<button
						className="secondary-button"
						onClick={() => { setShowCustomInput(false); setCustomAddress(""); setError(undefined); }}
					>
						Cancel
					</button>
				</div>
			) : (
				<div className="address-input-actions">
					<button className="primary-button" onClick={handleAdd}>
						{addLabel}
					</button>
					<button
						className="secondary-button"
						onClick={() => setShowCustomInput(true)}
					>
						Use custom address
					</button>
				</div>
			)}
		</div>
	);

	return (
		<div className="card action-card">
			{step === "idle" && accountAddress && (
				<>
					<div className="tab-bar">
						<button
							className={`tab-button ${activeTab === "signers" ? "tab-active" : ""}`}
							onClick={() => { setActiveTab("signers"); setError(undefined); setShowCustomInput(false); setCustomAddress(""); }}
						>
							Authorized Signers
						</button>
						<button
							className={`tab-button ${activeTab === "guardians" ? "tab-active" : ""}`}
							onClick={() => { setActiveTab("guardians"); setError(undefined); setShowCustomInput(false); setCustomAddress(""); }}
						>
							Recovery Guardians
						</button>
					</div>

					{activeTab === "signers" && (
						<>
							{ownersDivergent && (
								<div className="divergence-banner">
									<strong>Some signers aren't on every chain.</strong>
									<span> Sync them below.</span>
								</div>
							)}
							<div className="owner-list">
								{(() => {
									const presence = presenceVector(ownersPerChain, passkeySignerAddress);
									const allChains = presence.every(Boolean);
									const missing = presence.filter((p) => !p).length;
									return (
										<div
											className={`owner-item owner-item-block ${allChains ? "" : "owner-item-divergent"}`}
										>
											<div className="owner-item-row">
												<span className="owner-label">Passkey (you)</span>
											</div>
											{renderPresenceRow(presence)}
											{!allChains && (
												<div className="divergence-actions">
													<span className="divergence-hint">
														Missing on {missing} chain{missing > 1 ? "s" : ""}.
													</span>
													<button
														className="sync-button sync-add"
														onClick={handleSyncPasskeyToMissingChains}
														title={`Add this passkey on the ${missing} chain${missing > 1 ? "s" : ""} where it's missing`}
													>
														Sync to all chains
													</button>
												</div>
											)}
										</div>
									);
								})()}
								{cosigners.map((cosigner) => {
									const presence = presenceVector(ownersPerChain, cosigner);
									const allChains = presence.every(Boolean);
									const missing = presence.filter((p) => !p).length;
									const present = presence.filter(Boolean).length;
									return (
										<div
											key={cosigner}
											className={`owner-item owner-item-block ${allChains ? "" : "owner-item-divergent"}`}
										>
											<div className="owner-item-row">
												<code className="owner-item-address">{cosigner}</code>
												<button
													className="remove-button"
													onClick={() => handleRemoveSigner(cosigner)}
													title={allChains ? "Remove from all chains" : `Remove from ${present} chain${present > 1 ? "s" : ""} where present`}
												>
													Remove
												</button>
											</div>
											{renderPresenceRow(presence)}
											{!allChains && (
												<div className="divergence-actions">
													<span className="divergence-hint">
														Missing on {missing} chain{missing > 1 ? "s" : ""}.
													</span>
													<button
														className="sync-button sync-add"
														onClick={() => handleSyncSignerToMissingChains(cosigner)}
														title={`Add this signer on the ${missing} chain${missing > 1 ? "s" : ""} where it's missing`}
													>
														Sync to all chains
													</button>
													<button
														className="sync-button sync-remove"
														onClick={() => handleRemoveSignerFromPresentChains(cosigner)}
														title={`Remove from the ${present} chain${present > 1 ? "s" : ""} where it currently exists`}
													>
														Remove from {present} chain{present > 1 ? "s" : ""}
													</button>
												</div>
											)}
										</div>
									);
								})}
							</div>
							<p className="action-description">
								Add or remove authorized signers across all chains.
							</p>
							{renderAddressInput()}
						</>
					)}

					{activeTab === "guardians" && (
						<>
							{guardiansDivergent && (
								<div className="divergence-banner">
									<strong>Some guardians aren't on every chain.</strong>
									<span> Sync them below.</span>
								</div>
							)}
							<div className="owner-list">
								{unifiedGuardians.map((guardian) => {
									const presence = presenceVector(guardiansPerChain, guardian);
									const allChains = presence.every(Boolean);
									const missing = presence.filter((p) => !p).length;
									const present = presence.filter(Boolean).length;
									return (
										<div
											key={guardian}
											className={`owner-item owner-item-block ${allChains ? "" : "owner-item-divergent"}`}
										>
											<div className="owner-item-row">
												<code className="owner-item-address">{guardian}</code>
												<button
													className="remove-button"
													onClick={() => handleRemoveGuardian(guardian)}
													title={allChains ? "Remove from all chains" : `Remove from ${present} chain${present > 1 ? "s" : ""} where present`}
												>
													Remove
												</button>
											</div>
											{renderPresenceRow(presence)}
											{!allChains && (
												<div className="divergence-actions">
													<span className="divergence-hint">
														Missing on {missing} chain{missing > 1 ? "s" : ""}.
													</span>
													<button
														className="sync-button sync-add"
														onClick={() => handleSyncGuardianToMissingChains(guardian)}
														title={`Add this guardian on the ${missing} chain${missing > 1 ? "s" : ""} where it's missing`}
													>
														Sync to all chains
													</button>
													<button
														className="sync-button sync-remove"
														onClick={() => handleRemoveGuardianFromPresentChains(guardian)}
														title={`Remove from the ${present} chain${present > 1 ? "s" : ""} where it currently exists`}
													>
														Remove from {present} chain{present > 1 ? "s" : ""}
													</button>
												</div>
											)}
										</div>
									);
								})}
							</div>
							<p className="action-description">
								Set up account recovery across all chains.
								<br />
								<br />
								Guardians can be friends, family, a hardware wallet, or a service like Candide Guardian (email/SMS recovery). Configured once, enforced everywhere.
							</p>
							{renderAddressInput()}
						</>
					)}
				</>
			)}

			{step === "preparing" && (
				<p className="step-label">Preparing multichain operations…</p>
			)}

			{step === "signing" && (
				<p className="step-label">Authenticate with your passkey…</p>
			)}

			{(step === "pending" || step === "success") && (
				<>
					{step === "success" && actionSummary && (() => {
						const succeededCount = chainResults.filter((r) => r.txHash).length;
						if (succeededCount === 0) return null;
						return (
							<div className="success-banner">
								<p>
									{actionLabel} across {succeededCount} chain{succeededCount > 1 ? "s" : ""} with a single signature
								</p>
								<code className="owner-address">
									{actionSummary.address}
								</code>
							</div>
						);
					})()}
					<div className="chain-results">
						{chainResults.map((result, i) => {
							const isEmpty = !result.userOpHash && !result.txHash && !result.error;
							// Skip chains that didn't participate in this op (subset operations)
							if (isEmpty && !retrying) return null;
							return renderChainStatusCard(i, result);
						})}
					</div>
					{step === "success" && (() => {
						const failedCount = chainResults.filter((r) => r.error).length;
						const succeededCount = chainResults.filter((r) => r.txHash).length;
						return (
							<>
								{failedCount > 0 && (
									<button
										className="retry-button"
										style={{ marginTop: "0.75rem" }}
										onClick={handleRetryFailedChains}
										disabled={retrying}
									>
										{retrying ? "Retrying..." : `Retry ${failedCount} failed chain${failedCount > 1 ? "s" : ""}`}
									</button>
								)}
								{succeededCount > 0 && (
									<div className="completion-metrics">
										<div className="metric">
											<span className="metric-value">1</span>
											<span className="metric-label">signature</span>
										</div>
										<div className="metric">
											<span className="metric-value">{succeededCount}</span>
											<span className="metric-label">chain{succeededCount > 1 ? "s" : ""} updated</span>
										</div>
									</div>
								)}
								<button
									className="primary-button"
									style={{ marginTop: "1rem" }}
									onClick={() => setStep("idle")}
								>
									Back to Account
								</button>
							</>
						);
					})()}
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

export { AccountCard };
