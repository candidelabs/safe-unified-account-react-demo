import { useState } from "react";

const SKILL_URL = "https://docs.candide.dev/wallet/guides/safe-unified-account-skill.md";

function CtaCard() {
	const [copied, setCopied] = useState(false);

	const prompt = `claude "Read ${SKILL_URL} and integrate Safe Unified Account"`;

	const handleCopy = () => {
		navigator.clipboard.writeText(prompt);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="cta-card">
			<h3>Start Integrating with AI</h3>
			<p className="action-description">
				Use this prompt with your coding agent to integrate Safe Unified Account.
			</p>
			<div className="cta-prompt-container">
				<code className="cta-prompt">{prompt}</code>
				<button
					className="cta-copy-button"
					onClick={handleCopy}
				>
					{copied ? "Copied" : "Copy"}
				</button>
			</div>
			<div className="cta-links">
				<a
					href="https://docs.candide.dev/wallet/guides/chain-abstraction-overview/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Docs →
				</a>
				<a
					href="https://github.com/candidelabs/abstractionkit-examples"
					target="_blank"
					rel="noopener noreferrer"
				>
					Examples →
				</a>
				<a
					href="https://github.com/candidelabs/safe-unified-account-demo"
					target="_blank"
					rel="noopener noreferrer"
				>
					View source →
				</a>
				<a
					href="https://cal.com/candidelabs/30mins"
					target="_blank"
					rel="noopener noreferrer"
				>
					Schedule a call →
				</a>
			</div>
		</div>
	);
}

export { CtaCard };
