import candideLogo from "/candide-wordmark.svg";
import {
	PasskeyStoredFormat,
	createPasskey,
	toLocalStorageFormat,
	hydratePasskey,
} from "./logic/passkeys.ts";
import "./App.css";
import { useLocalStorageState } from "./hooks/useLocalStorageState.ts";
import { useState, useEffect, useMemo } from "react";
import { PasskeyCard } from "./components/PasskeyCard.tsx";
import { IdentityStrip } from "./components/IdentityStrip.tsx";
import { TransferCard } from "./components/TransferCard.tsx";
import { AccountCard } from "./components/AccountCard.tsx";
import { CodeShowcase } from "./components/CodeShowcase.tsx";
import { CtaCard } from "./components/CtaCard.tsx";
import { FaqCard } from "./components/FaqCard.tsx";

const PASSKEY_LOCALSTORAGE_KEY = "passkeyId";

function App() {
	const [storedPasskey, setPasskey] = useLocalStorageState<
		PasskeyStoredFormat | undefined
	>(PASSKEY_LOCALSTORAGE_KEY, undefined);
	const [error, setError] = useState<string>();
	const [view, setView] = useState<"main" | "settings">("main");

	// JSON.parse leaves coords as hex strings; rehydrate to bigint once so
	// every consumer (and `fromSafeWebauthn`'s strict type guard) sees the
	// canonical shape.
	const passkey = useMemo(
		() => (storedPasskey ? hydratePasskey(storedPasskey) : undefined),
		[storedPasskey],
	);

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
			</header>
			<div className="hero">
				<h1>Sign once. Execute on every chain.</h1>
				<p className="subtitle">
					One passkey signature for any batch of operations, executed in parallel across every EVM chain.
				</p>
			</div>

			{!passkey && (
				<div className="view-main" key="view-main">
					<PasskeyCard handleCreatePasskeyClick={handleCreatePasskeyClick} />
				</div>
			)}

			{passkey && view === "main" && (
				<div className="view-main" key="view-main">
					<IdentityStrip
						passkey={passkey}
						onOpenSettings={() => setView("settings")}
						settingsActive={false}
					/>
					<TransferCard passkey={passkey} />
				</div>
			)}

			{passkey && view === "settings" && (
				<div className="view-settings" key="view-settings">
					<IdentityStrip
						passkey={passkey}
						onOpenSettings={() => setView("main")}
						settingsActive={true}
					/>
					<h2 className="view-settings-title">Account Security</h2>
					<p className="view-settings-subtitle">
						Manage signers and guardians across all chains.
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
			<footer className="site-footer">
				<span>Built on Safe Smart Accounts</span>
			</footer>
		</>
	);
}

export default App;
