import { useState, useRef, useEffect } from "react";

const SKILL_URL =
	"https://raw.githubusercontent.com/candidelabs/skills/main/skills/safe-unified-account/SKILL.md";

const PROMPTS = [
	{
		label: "Claude Code",
		text: `/plugin marketplace add candidelabs/skills\n/plugin install candide@candide`,
	},
	{
		label: "Codex CLI",
		text: `npx -y github:candidelabs/skills`,
	},
	{
		label: "Cursor / Windsurf",
		text: `Read ${SKILL_URL} and integrate Safe Unified Account into this project`,
	},
];

function CtaCard() {
	const [activeTab, setActiveTab] = useState(0);
	const [copied, setCopied] = useState(false);
	const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		return () => clearTimeout(copyTimeoutRef.current);
	}, []);

	const handleCopy = async () => {
		try {
			await navigator.clipboard?.writeText(PROMPTS[activeTab].text);
			setCopied(true);
			clearTimeout(copyTimeoutRef.current);
			copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
		} catch {
			// clipboard write failed (e.g. permissions denied)
		}
	};

	return (
		<div className="cta-card">
			<h3>Start Integrating with AI</h3>
			<p className="action-description">
				Add the Safe Unified Account skill to your coding agent — it
				will know how to integrate it correctly.
			</p>
			<div className="cta-agent-tabs">
				{PROMPTS.map((p, i) => (
					<button
						key={p.label}
						className={`cta-agent-tab ${activeTab === i ? "cta-agent-tab-active" : ""}`}
						onClick={() => { setActiveTab(i); setCopied(false); }}
					>
						{p.label}
					</button>
				))}
			</div>
			<div className="cta-prompt-container" onClick={handleCopy}>
				<code className="cta-prompt">{PROMPTS[activeTab].text}</code>
				<span className="cta-copy-hint">{copied ? "Copied" : "Click to copy"}</span>
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
