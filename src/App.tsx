import safeLogo from "/safe-logo-white.svg";
import candideLogo from "/candide-wordmark.svg";
import {
	PasskeyLocalStorageFormat,
	createPasskey,
	toLocalStorageFormat,
} from "./logic/passkeys.ts";
import "./App.css";
import { useLocalStorageState } from "./hooks/useLocalStorageState.ts";
import { useState } from "react";
import { PasskeyCard } from "./components/PasskeyCard.tsx";
import { TransferCard } from "./components/TransferCard.tsx";
import { AccountCard } from "./components/AccountCard.tsx";
import { CodeShowcase } from "./components/CodeShowcase.tsx";
import { CtaCard } from "./components/CtaCard.tsx";
import { FaqCard } from "./components/FaqCard.tsx";

const PASSKEY_LOCALSTORAGE_KEY = "passkeyId";

function App() {
	const [passkey, setPasskey] = useLocalStorageState<
		PasskeyLocalStorageFormat | undefined
	>(PASSKEY_LOCALSTORAGE_KEY, undefined);
	const [error, setError] = useState<string>();

	const handleCreatePasskeyClick = async () => {
		setError(undefined);
		try {
			const passkey = await createPasskey();

			setPasskey(toLocalStorageFormat(passkey));
		} catch (error) {
			if (error instanceof Error) {
				setError(error.message);
			} else {
				setError("Unknown error");
			}
		}
	};

	return (
		<>
			<header className="header">
				<a href="https://candide.dev" target="_blank" rel="noopener noreferrer">
					<img src={candideLogo} className="logo" alt="Candide Atelier logo" />
				</a>
				<a href="https://safe.global" target="_blank" rel="noopener noreferrer">
					<img src={safeLogo} className="logo" alt="Safe logo" />
				</a>
			</header>
			<div className="hero">
				<span className="demo-badge">Live Demo</span>
				<h1>Safe Unified Account</h1>
				<p className="subtitle">
					A single USDT0 balance across Arbitrum, Plasma, and more.
					<br />
					One passkey. One signature. Transfer across every chain.
				</p>
			</div>

			<PasskeyCard
				passkey={passkey}
				handleCreatePasskeyClick={handleCreatePasskeyClick}
			/>

			{passkey && <TransferCard passkey={passkey} />}
			{passkey && <AccountCard passkey={passkey} />}

			{error && (
				<div className="card">
					<p>Error: {error}</p>
				</div>
			)}

			<CodeShowcase />
			<CtaCard />
			<FaqCard />
		</>
	);
}

export default App;
