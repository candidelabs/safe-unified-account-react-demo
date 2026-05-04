import {
  createCredential,
  type P256Credential,
} from 'ox/WebAuthnP256';
import {
  pubkeyCoordinatesFromJson,
  pubkeyCoordinatesToJson,
  type WebauthnPublicKey,
} from 'abstractionkit';

/**
 * Creates a WebAuthn P-256 credential for signing.
 *
 * @returns A promise that resolves to a P256Credential, which includes the credential's rawId and publicKey coordinates.
 * @throws Throws an Error if credential creation fails or returns null.
 */
async function createPasskey(): Promise<P256Credential> {
  // Generate a passkey credential using WebAuthn API
  const passkeyCredential = await createCredential({
    name: 'Safe Wallet',
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: {
      id: window.location.hostname,
      name: 'Safe Wallet',
    },
    authenticatorSelection: {
      // Removed authenticatorAttachment to support both platform (Touch ID, Face ID)
      // and cross-platform authenticators (Google Password Manager, security keys)
      residentKey: 'required',
      userVerification: 'required',
    },
    timeout: 60000,
    attestation: 'none',
  });

  if (!passkeyCredential) {
    throw new Error('Failed to generate passkey. Received null as a credential');
  }
  return passkeyCredential;
}

/**
 * Runtime shape consumed by every component: bigint pubkey coords, ready
 * for `fromSafeWebauthn` and the rest of the SDK's strict-type boundaries.
 */
export type PasskeyLocalStorageFormat = {
  id: string;
  pubkeyCoordinates: WebauthnPublicKey;
};

/**
 * On-disk shape. New writes use the string variant — pubkey coords are
 * pre-serialized via the SDK's canonical helper (`{"x":"0x...","y":"0x..."}`).
 * Legacy localStorage entries written before this change carry the object
 * variant produced by `storage.ts`'s generic bigint replacer; both round-trip
 * through `pubkeyCoordinatesFromJson` unchanged.
 */
export type PasskeyStoredFormat = {
  id: string;
  pubkeyCoordinates:
    | string
    | { x: bigint | string | number; y: bigint | string | number };
};

/**
 * Convert a fresh `P256Credential` into the persisted shape. Pubkey coords
 * go through `pubkeyCoordinatesToJson` so the on-disk encoding is whatever
 * the SDK considers canonical.
 */
function toLocalStorageFormat(passkey: P256Credential): PasskeyStoredFormat {
  return {
    id: passkey.id,
    pubkeyCoordinates: pubkeyCoordinatesToJson(passkey.publicKey),
  };
}

/**
 * Inverse of {@link toLocalStorageFormat}. Restores bigint coords via the
 * SDK's `pubkeyCoordinatesFromJson` so every consumer downstream sees the
 * canonical type — `fromSafeWebauthn` rejects non-bigint coords at its
 * type guard.
 */
function hydratePasskey(stored: PasskeyStoredFormat): PasskeyLocalStorageFormat {
  return {
    id: stored.id,
    pubkeyCoordinates: pubkeyCoordinatesFromJson(stored.pubkeyCoordinates),
  };
}

export {
  createPasskey,
  toLocalStorageFormat,
  hydratePasskey,
};
