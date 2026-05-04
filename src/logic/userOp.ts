import { sign } from 'ox/WebAuthnP256';
import { Hex } from 'ox';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
  fromSafeWebauthn,
  webauthnSignatureFromAssertion,
  type CandidePaymasterContext,
  type GasPaymasterUserOperationOverrides,
  type SendUseroperationResponse,
  type UserOperationV9,
} from 'abstractionkit';

import { PasskeyLocalStorageFormat } from './passkeys';

export interface MultiChainUserOpInput {
  userOp: UserOperationV9;
  chainId: bigint;
  bundlerUrl: string;
  paymasterUrl: string;
  sponsorshipPolicyId?: string;
  preVerificationGasMultiplier?: number;
  verificationGasLimitMultiplier?: number;
}

export type MultiChainSendResult =
  | { status: 'sent'; response: SendUseroperationResponse }
  | { status: 'failed'; error: string };

/**
 * Sign N UserOperations with one passkey assertion and submit them.
 *
 *   1. Paymaster commit  — gas estimation + dummy paymaster fields per op.
 *   2. signUserOperationsWithSigners — single passkey biometric prompt; the
 *      SDK computes the merkle-root (or per-op SafeOp digest for length=1)
 *      and emits the matching per-op signatures.
 *   3. Paymaster finalize — seal real paymaster data after signing.
 *   4. Submit each op to its bundler concurrently.
 *
 * The `fromSafeWebauthn` adapter handles signer-address routing (shared
 * signer when isInit, per-owner verifier proxy after) and the Safe-specific
 * WebAuthn signature encoding. `accountClass: SafeAccount` is mandatory: it
 * sources the v0.2.1 Safe Passkey module defaults (Daimo P256 +
 * RIP-7951 precompile) the on-chain owner is bound to. Omit it and the
 * bundler rejects with a generic "Invalid UserOp signature" (GS026).
 *
 * Mixed init states across chains within a single batch (e.g. deployed on
 * one chain, fresh on another) aren't supported here: the adapter is
 * configured with one `isInit` value derived from the first op. In this app
 * every batch shares an init state in practice — first-ever multichain op
 * is init-on-all, every subsequent batch is non-init-on-all, and retries
 * target a single chain at a time.
 */
async function signAndSendMultiChainUserOps(
  ops: MultiChainUserOpInput[],
  passkey: PasskeyLocalStorageFormat,
  safeAccount: InstanceType<typeof SafeAccount>,
): Promise<MultiChainSendResult[]> {
  // 1. Paymaster commit — gas estimation + paymaster fields per op.
  const commitResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      const context: CandidePaymasterContext = { signingPhase: 'commit' };
      const overrides: GasPaymasterUserOperationOverrides = {
        ...(op.preVerificationGasMultiplier !== undefined && {
          preVerificationGasPercentageMultiplier: op.preVerificationGasMultiplier,
        }),
        ...(op.verificationGasLimitMultiplier !== undefined && {
          verificationGasLimitPercentageMultiplier: op.verificationGasLimitMultiplier,
        }),
      };
      return paymaster.createSponsorPaymasterUserOperation(
        safeAccount, op.userOp, op.bundlerUrl, op.sponsorshipPolicyId, context, overrides,
      );
    }),
  );
  commitResults.forEach(({ userOperation: committedOp }, i) => {
    ops[i].userOp = committedOp;
  });

  // 2. Sign every op with a single passkey assertion.
  const signer = fromSafeWebauthn({
    publicKey: passkey.pubkeyCoordinates,
    isInit: ops[0].userOp.nonce === 0n,
    accountClass: SafeAccount,
    getAssertion: async (challenge) => {
      // ox's `sign` takes an OxHex challenge; fromSafeWebauthn hands us a
      // Uint8Array. Convert at the boundary.
      const { metadata, signature } = await sign({
        challenge: Hex.fromBytes(challenge),
        credentialId: passkey.id as `0x${string}`,
      });
      return webauthnSignatureFromAssertion({
        authenticatorData: metadata.authenticatorData,
        clientDataJSON: metadata.clientDataJSON,
        signature,
      });
    },
  });

  const signatures = await safeAccount.signUserOperationsWithSigners(
    ops.map((op) => ({ userOperation: op.userOp, chainId: op.chainId })),
    [signer],
  );
  ops.forEach((op, i) => { op.userOp.signature = signatures[i]; });

  // 3. Paymaster finalize — seal real paymaster data now that signatures are set.
  const finalizeResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      const context: CandidePaymasterContext = { signingPhase: 'finalize' };
      return paymaster.createSponsorPaymasterUserOperation(
        safeAccount, op.userOp, op.bundlerUrl, op.sponsorshipPolicyId, context,
      );
    }),
  );
  finalizeResults.forEach(({ userOperation: finalizedOp }, i) => {
    ops[i].userOp = finalizedOp;
  });

  // 4. Submit each op concurrently, collect per-op results.
  const results = await Promise.allSettled(
    ops.map((op) => {
      const sender = new SafeAccount(op.userOp.sender);
      return sender.sendUserOperation(op.userOp, op.bundlerUrl);
    }),
  );

  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return { status: 'sent' as const, response: result.value };
    }
    const err = result.reason;
    const errMsg = err?.message || err?.toString() || 'Unknown error';
    return { status: 'failed' as const, error: errMsg };
  });
}

export { signAndSendMultiChainUserOps };
