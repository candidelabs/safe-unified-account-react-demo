import { useState } from "react";

const SKILL_URL = "https://docs.candide.dev/wallet/guides/safe-unified-account-skill.md";

const PROMPTS = [
	{
		label: "Claude Code",
		text: `claude "Read ${SKILL_URL} and integrate Safe Unified Account"`,
	},
	{
		label: "Cursor / Windsurf",
		text: `Read ${SKILL_URL} and integrate Safe Unified Account into this project`,
	},
	{
		label: "Codex / ChatGPT",
		text: `Read ${SKILL_URL} and integrate Safe Unified Account into this project`,
	},
];

function PromptBlock({ label, text }: { label: string; text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="cta-prompt-block">
			<span className="cta-prompt-label">{label}</span>
			<div className="cta-prompt-container" onClick={handleCopy}>
				<code className="cta-prompt">{text}</code>
				<span className="cta-copy-hint">{copied ? "Copied" : "Click to copy"}</span>
			</div>
		</div>
	);
}

function CtaCard() {
	return (
		<div className="cta-card">
			<h3>Start Integrating with AI</h3>
			<p className="action-description">
				Use one of these prompts with your coding agent to integrate Safe Unified Account.
			</p>
			<div className="cta-prompts">
				{PROMPTS.map((p) => (
					<PromptBlock key={p.label} label={p.label} text={p.text} />
				))}
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
