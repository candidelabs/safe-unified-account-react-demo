import { sign } from 'ox/WebAuthnP256';
import { Hex as OxHex } from 'ox/Hex';
import { Bytes, Hex } from 'ox';
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
  type CandidePaymasterContext,
  type GasPaymasterUserOperationOverrides,
  SignerSignaturePair,
  WebauthnSignatureData,
  SendUseroperationResponse,
  UserOperationV9,
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
 * Sign N UserOperations with one passkey authentication and submit them.
 *
 * Workflow:
 *   1. Paymaster commit  — gas estimation and dummy paymaster fields per op.
 *   2. Compute the challenge to sign (length-dependent — see note below).
 *   3. Single passkey biometric prompt over the challenge.
 *   4. Format per-op signatures.
 *   5. Paymaster finalize — seal real paymaster data after signing.
 *   6. Submit each op to its bundler concurrently.
 *
 * Single-op vs multi-op signing
 * -----------------------------
 * The on-chain Safe 4337 module routes signature verification by depth byte.
 * For length === 1, the SDK's `formatSignaturesToUseroperationsSignatures`
 * still emits a multichain-formatted signature (depth byte 0x00, no merkle
 * proof), but the on-chain module treats depth=0 as the *normal* signature
 * flow — without the leading byte. So a length-1 multichain signature fails
 * verification with "Invalid UserOp signature or paymaster signature".
 *
 * Workaround: when length === 1, sign over the userOp's own EIP-712 hash
 * (not the merkle root) and emit a normal signature. For length >= 2, use
 * the merkle path as designed.
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

  // 2. Compute challenge. Length-dependent (see note above).
  const challenge: string = ops.length === 1
    ? SafeAccount.getUserOperationEip712Hash_V9(ops[0].userOp, ops[0].chainId)
    : SafeAccount.getMultiChainSingleSignatureUserOperationsEip712Hash(
      ops.map((op) => ({
        userOperation: op.userOp,
        chainId: op.chainId,
        overrides: { isInit: op.userOp.nonce === 0n },
      })),
    );

  // 3. Single passkey biometric prompt.
  const { metadata, signature } = await sign({
    challenge: challenge as OxHex,
    credentialId: passkey.id as OxHex,
  });

  // 4. Build the WebAuthn signature payload from the assertion.
  const clientData = JSON.parse(metadata.clientDataJSON);
  const { type: _type, challenge: _challenge, ...remainingFields } = clientData;
  const fields = Object.entries(remainingFields)
    .map(([key, value]) => `"${key}":${JSON.stringify(value)}`)
    .join(',');

  const webauthnSignatureData: WebauthnSignatureData = {
    authenticatorData: Bytes.fromHex(metadata.authenticatorData).buffer as ArrayBuffer,
    clientDataFields: Hex.fromString(fields),
    rs: [signature.r, signature.s],
  };
  const webauthSignature = SafeAccount.createWebAuthnSignature(webauthnSignatureData);
  const signerSignaturePair: SignerSignaturePair = {
    signer: passkey.pubkeyCoordinates,
    signature: webauthSignature,
  };

  // 5. Format per-op signatures (length-dependent path — see note above).
  if (ops.length === 1) {
    // Normal (non-multichain) signature: no leading depth byte.
    ops[0].userOp.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [signerSignaturePair],
      {
        isInit: ops[0].userOp.nonce === 0n,
        // isMultiChainSignature omitted → defaults to false.
        safe4337ModuleAddress: SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
        eip7212WebAuthnPrecompileVerifier: SafeAccount.DEFAULT_WEB_AUTHN_PRECOMPILE,
        eip7212WebAuthnContractVerifier: SafeAccount.DEFAULT_WEB_AUTHN_DAIMO_VERIFIER,
        webAuthnSignerFactory: SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
        webAuthnSignerSingleton: SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_SINGLETON,
        webAuthnSignerProxyCreationCode: SafeAccount.DEFAULT_WEB_AUTHN_SIGNER_PROXY_CREATION_CODE,
        webAuthnSharedSigner: SafeAccount.DEFAULT_WEB_AUTHN_SHARED_SIGNER,
      },
    );
  } else {
    const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
      ops.map((op) => ({
        userOperation: op.userOp,
        chainId: op.chainId,
        overrides: { isInit: op.userOp.nonce === 0n },
      })),
      [signerSignaturePair],
    );
    ops.forEach((op, i) => {
      op.userOp.signature = signatures[i];
    });
  }

  // 6. Paymaster finalize — seal real paymaster data now that signatures are set.
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

  // 7. Submit each op concurrently, collect per-op results.
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
