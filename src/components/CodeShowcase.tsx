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
						<span className="code-comment">{"// 2. Build a UserOperation per chain (expectedSigners → WebAuthn dummy sig for gas)\n"}</span>
						<span className="code-keyword">{"let "}</span>
						{"ops = "}
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(\n  chains."}
						<span className="code-fn">{"map"}</span>
						{"(chain => account."}
						<span className="code-fn">{"createUserOperation"}</span>
						{"(txs, chain.rpc, chain.bundler,\n    "}
						{"{ expectedSigners: [pubkey] }))\n);\n\n"}
						<span className="code-comment">{"// 3. Paymaster commit — gas estimation + sponsorship fields\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"(op => paymaster."}
						<span className="code-fn">{"createSponsorPaymasterUserOperation"}</span>
						{"(\n  account, op, bundler, undefined, { signingPhase: "}
						<span className="code-string">{"\"commit\""}</span>
						{" })));\n\n"}
						<span className="code-comment">{"// 4. One adapter handles signer routing + Safe-specific WebAuthn encoding\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"signer = "}
						<span className="code-fn">{"fromSafeWebauthn"}</span>
						{"({\n  publicKey: pubkey,\n  isInit: ops[0].nonce === 0n,\n  accountClass: SafeMultiChainSigAccountV1,\n  getAssertion: "}
						<span className="code-keyword">{"async "}</span>
						{"(challenge) => {\n    "}
						<span className="code-keyword">{"const "}</span>
						{"{ metadata, signature } = "}
						<span className="code-keyword">{"await "}</span>
						{"WebAuthnP256."}
						<span className="code-fn">{"sign"}</span>
						{"({ challenge, credentialId });\n    "}
						<span className="code-keyword">{"return "}</span>
						<span className="code-fn">{"webauthnSignatureFromAssertion"}</span>
						{"({ ...metadata, signature });\n  },\n});\n\n"}
						<span className="code-comment">{"// 5. One passkey prompt → per-op signatures (merkle root or single-op SafeOp digest)\n"}</span>
						<span className="code-keyword">{"const "}</span>
						{"sigs = "}
						<span className="code-keyword">{"await "}</span>
						{"account."}
						<span className="code-fn">{"signUserOperationsWithSigners"}</span>
						{"(\n  ops."}
						<span className="code-fn">{"map"}</span>
						{"((op, i) => ({ userOperation: op, chainId: chains[i].id })),\n  [signer],\n);\n"}
						{"ops."}
						<span className="code-fn">{"forEach"}</span>
						{"((op, i) => { op.signature = sigs[i]; });\n\n"}
						<span className="code-comment">{"// 6. Paymaster finalize — seal paymaster data after signing\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"(op => paymaster."}
						<span className="code-fn">{"createSponsorPaymasterUserOperation"}</span>
						{"(\n  account, op, bundler, undefined, { signingPhase: "}
						<span className="code-string">{"\"finalize\""}</span>
						{" })));\n\n"}
						<span className="code-comment">{"// 7. Submit every chain in parallel\n"}</span>
						<span className="code-keyword">{"await "}</span>
						{"Promise."}
						<span className="code-fn">{"all"}</span>
						{"(ops."}
						<span className="code-fn">{"map"}</span>
						{"(op => account."}
						<span className="code-fn">{"sendUserOperation"}</span>
						{"(op, bundler)));"}
					</pre>
				</div>
			)}
		</div>
	);
}

export { CodeShowcase };
