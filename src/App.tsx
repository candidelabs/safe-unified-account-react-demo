import safeLogo from "/safe-logo-white.svg";
import candideLogo from "/candide-wordmark.svg";
import {
	PasskeyLocalStorageFormat,
	createPasskey,
	toLocalStorageFormat,
} from "./logic/passkeys.ts";
import "./App.css";
import { useLocalStorageState } from "./hooks/useLocalStorageState.ts";
import { useState, useEffect } from "react";
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
	const [view, setView] = useState<"main" | "settings">("main");

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

	// In settings view: Escape returns to main view
	useEffect(() => {
		if (view !== "settings") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setView("main");
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [view]);

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
					A single USDT balance across Arbitrum, Optimism, and more.
					<br />
					One passkey. One signature. Transfer across every chain.
				</p>
			</div>

			{(!passkey || view === "main") && (
				<div className="view-main" key="view-main">
					<PasskeyCard
						passkey={passkey}
						handleCreatePasskeyClick={handleCreatePasskeyClick}
						onOpenSettings={passkey ? () => setView("settings") : undefined}
						settingsActive={false}
					/>
					{passkey && <TransferCard passkey={passkey} />}
				</div>
			)}

			{passkey && view === "settings" && (
				<div className="view-settings" key="view-settings">
					<PasskeyCard
						passkey={passkey}
						handleCreatePasskeyClick={handleCreatePasskeyClick}
						onOpenSettings={() => setView("main")}
						settingsActive={true}
					/>
					<h2 className="view-settings-title">Account Security</h2>
					<p className="view-settings-subtitle">
						Manage authorized signers and recovery guardians across every chain — in a single signature.
					</p>
					<AccountCard passkey={passkey} />
				</div>
			)}

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
