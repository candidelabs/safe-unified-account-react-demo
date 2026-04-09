function CtaCard() {
	return (
		<div className="cta-card">
			<h3>Ready to integrate?</h3>
			<code className="cta-install">npm install abstractionkit@0.2.41</code>
			<p className="action-description">
				Both abstractionkit and this demo come with preconfigured AI Agent instructions, so you can just summon and get help with code right out of the box.
			</p>
			<div className="cta-links">
				<a
					href="https://docs.candide.dev/account-abstraction/research/safe-unified-account/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Read the docs →
				</a>
				<a
					href="https://github.com/candidelabs/safe-unified-account-react-demo"
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
