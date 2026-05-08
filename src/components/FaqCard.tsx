import { useState } from "react";

const faqItems = [
	{
		question: "What is Safe Unified Account?",
		answer: (
			<p>
				A single Safe smart account that lives on every EVM chain at the
				same address. The user signs once and the operation executes on
				the chains they target. No per-chain prompts, nothing syncing
				in the background.
			</p>
		),
	},
	{
		question: "Is this production ready?",
		answer: (
			<p>
				Yes. The contracts are audited by{" "}
				<a
					href="https://github.com/candidelabs/safe-4337-multi-chain-signature-module/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Nethermind
				</a>{" "}
				and live on mainnet today. If you're scoping an integration,{" "}
				<a
					href="https://cal.com/candidelabs/30mins"
					target="_blank"
					rel="noopener noreferrer"
				>
					schedule a call
				</a>
				.
			</p>
		),
	},
	{
		question: "How does the single signature work?",
		answer: (
			<p>
				The system computes a Merkle root from the EIP-712 hashes of the
				UserOperations on each target chain. The user signs that root
				with their passkey. The signature is then expanded into per-chain
				proofs, so each chain's contract independently verifies against
				the shared root.
			</p>
		),
	},
	{
		question: "What operations work multichain?",
		answer: (
			<p>
				Any account-management operation: add or remove signers,
				configure recovery guardians, enable modules, change signing
				thresholds. The demo above lets you manage signers and guardians
				across every configured chain in a single tap.
			</p>
		),
	},
	{
		question: "What about stablecoin transfers?",
		answer: (
			<p>
				Multichain stablecoin transfers work today via intent-based
				bridges. This demo uses Across Protocol: the user signs once to
				initiate deposits on multiple source chains in parallel, and a
				relayer fronts liquidity on the destination.
			</p>
		),
	},
	{
		question: "What if one chain fails mid-execution?",
		answer: (
			<p>
				Each chain's UserOperation submits independently to its bundler,
				so execution is parallel but not atomic across chains. If one
				chain's bundler rejects or times out, the others still execute
				and the demo surfaces the failure on that specific chain.
			</p>
		),
	},
	{
		question: "Who pays gas?",
		answer: (
			<p>
				The integrator does, via Candide's paymaster. You attach a
				sponsorship policy ID per chain and the paymaster covers gas for
				any UserOperation that matches. Users never need to hold the
				native gas token.
			</p>
		),
	},
	{
		question: "Can users move off this account?",
		answer: (
			<p>
				Yes. The account is a Safe: same contracts, same ownership
				semantics as any other Safe. Users can rotate signers to an EOA,
				hardware wallet, or another passkey at any time. There is no
				Candide-side custody: the account keeps working if our
				infrastructure goes away.
			</p>
		),
	},
	{
		question: "Why a smart account instead of EIP-7702?",
		answer: (
			<p>
				EIP-7702 lets an EOA temporarily run contract code while keeping
				the same secp256k1 key. Safe Unified Account is a smart account
				from the start, so passkey signing, on-chain recovery, modules,
				and the multichain Merkle-root signature scheme all work without
				leaning on EOA semantics.
			</p>
		),
	},
	{
		question: "What chains are supported?",
		answer: (
			<p>
				Every EVM-compatible chain Candide supports: major L1s and L2s
				on mainnet, plus their public testnets. See the{" "}
				<a
					href="https://docs.candide.dev/wallet/bundler/rpc-endpoints/"
					target="_blank"
					rel="noopener noreferrer"
				>
					RPC endpoints docs
				</a>{" "}
				for the current list.
			</p>
		),
	},
	{
		question: "How long does integration take?",
		answer: (
			<p>
				The{" "}
				<a
					href="https://docs.candide.dev/account-abstraction/research/safe-unified-account/"
					target="_blank"
					rel="noopener noreferrer"
				>
					AbstractionKit SDK
				</a>{" "}
				gives you a small API surface: initialize an account, build
				transactions, sign once, send.
			</p>
		),
	},
	{
		question: "What are passkeys?",
		answer: (
			<p>
				Device-bound credentials (Touch ID, Face ID, security keys) that
				produce WebAuthn P-256 signatures. Those signatures are verified
				directly on-chain via EIP-7212. No custodial signer in the
				middle, and the private key never leaves the user's device.
			</p>
		),
	},
];

function FaqCard() {
	const [openIndex, setOpenIndex] = useState<number | null>(null);

	return (
		<div className="faq-section">
			<h2 className="faq-title">Frequently Asked Questions</h2>
			<div className="faq-list">
				{faqItems.map((item, i) => {
					const isOpen = openIndex === i;
					const questionId = `faq-question-${i}`;
					const answerId = `faq-answer-${i}`;
					return (
						<div
							key={i}
							className={`faq-item ${isOpen ? "faq-open" : ""}`}
						>
							<button
								className="faq-question"
								onClick={() => setOpenIndex(isOpen ? null : i)}
								aria-expanded={isOpen}
								aria-controls={answerId}
								id={questionId}
							>
								<span>{item.question}</span>
								<span className="faq-chevron">+</span>
							</button>
							{isOpen && (
								<div
									className="faq-answer"
									id={answerId}
									role="region"
									aria-labelledby={questionId}
								>
									{item.answer}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export { FaqCard };
