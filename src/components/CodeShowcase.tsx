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
