import { sign } from 'ox/WebAuthnP256';
import { Hex as OxHex } from 'ox/Hex'
import { Bytes, Hex } from 'ox'
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
  type CandidePaymasterContext,
  type GasPaymasterUserOperationOverrides,
  SignerSignaturePair,
  WebauthnSignatureData,
  SendUseroperationResponse,
  UserOperationV9,
} from 'abstractionkit'

import {
  PasskeyLocalStorageFormat
} from './passkeys'

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
 * Signs N UserOperations on multiple chains with a single passkey authentication
 * and sends them to their respective bundlers.
 *
 * Workflow:
 * 1. Paymaster commit — gas estimation and paymaster fields for all chains.
 * 2. Compute multichain Merkle root hash.
 * 3. Sign once with WebAuthn (single biometric prompt).
 * 4. Expand the single signature into per-chain signatures.
 * 5. Paymaster finalize — seal paymaster data after signatures are set.
 * 6. Send all UserOperations concurrently.
 */
async function signAndSendMultiChainUserOps(
  ops: MultiChainUserOpInput[],
  passkey: PasskeyLocalStorageFormat,
  safeAccount: InstanceType<typeof SafeAccount>,
): Promise<MultiChainSendResult[]> {
  // 1. Paymaster commit — gas estimation + paymaster fields.
  // Matches the canonical abstractionkit-examples/chain-abstraction flow:
  // the paymaster's defaults handle typical gas estimation; only supply
  // per-chain multiplier overrides when explicitly configured via env.
  const commitResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      const context: CandidePaymasterContext = { signingPhase: "commit" };
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

  // 2. Build signing array with per-op isInit. Chains can diverge (Safe
  // deployed on one chain but not another), so each leg needs its own flag.
  const userOperationsToSign = ops.map((op) => ({
    userOperation: op.userOp,
    chainId: op.chainId,
    overrides: {
      isInit: op.userOp.nonce === 0n,
    },
  }));

  const multiChainHash = SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(
    userOperationsToSign,
  );

  // 3. Sign with passkey (single biometric prompt)
  const { metadata, signature } = await sign({
    challenge: multiChainHash as OxHex,
    credentialId: passkey.id as OxHex,
  });

  // 4. Extract additional clientDataJSON fields (post-challenge)
  const clientData = JSON.parse(metadata.clientDataJSON);
  const { type, challenge, ...remainingFields } = clientData;
  const fields = Object.entries(remainingFields)
    .map(([key, value]) => `"${key}":${JSON.stringify(value)}`)
    .join(',');

  // 5. Assemble WebauthnSignatureData
  const webauthnSignatureData: WebauthnSignatureData = {
    authenticatorData: Bytes.fromHex(metadata.authenticatorData)
      .buffer as ArrayBuffer,
    clientDataFields: Hex.fromString(fields),
    rs: [signature.r, signature.s],
  };

  const webauthSignature = SafeAccount.createWebAuthnSignature(
    webauthnSignatureData,
  );

  const signerSignaturePair: SignerSignaturePair = {
    signer: passkey.pubkeyCoordinates,
    signature: webauthSignature,
  };

  // 6. Format single signature into per-UserOperation signatures.
  const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
    userOperationsToSign,
    [signerSignaturePair],
  );

  ops.forEach((op, i) => {
    op.userOp.signature = signatures[i];
  });

  // 7. Paymaster finalize — seal paymaster data after signatures are set.
  const finalizeResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      const context: CandidePaymasterContext = { signingPhase: "finalize" };
      return paymaster.createSponsorPaymasterUserOperation(
        safeAccount, op.userOp, op.bundlerUrl, op.sponsorshipPolicyId, context,
      );
    }),
  );

  finalizeResults.forEach(({ userOperation: finalizedOp }, i) => {
    ops[i].userOp = finalizedOp;
  });

  // 8. Send all UserOperations — use allSettled so partial failures don't block successes
  const results = await Promise.allSettled(
    ops.map((op) => {
      const sender = new SafeAccount(op.userOp.sender);
      return sender.sendUserOperation(op.userOp, op.bundlerUrl);
    }),
  );

  return results.map((result) => {
    if (result.status === 'fulfilled') {
      return { status: 'sent' as const, response: result.value };
    } else {
      const err = result.reason;
      const errMsg = err?.message || err?.toString() || 'Unknown error';
      return { status: 'failed' as const, error: errMsg };
    }
  });
}

export { signAndSendMultiChainUserOps }
