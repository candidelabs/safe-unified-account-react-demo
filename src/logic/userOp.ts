import { sign } from 'ox/WebAuthnP256';
import { Hex as OxHex } from 'ox/Hex'
import { Bytes, Hex } from 'ox'
import {
  SafeMultiChainSigAccountV1 as SafeAccount,
  CandidePaymaster,
  SignerSignaturePair,
  WebauthnSignatureData,
  SendUseroperationResponse,
  UserOperationV9,
} from 'abstractionkit'

type PaymasterOverrides = NonNullable<Parameters<CandidePaymaster['createSponsorPaymasterUserOperation']>[4]>;

import {
  PasskeyLocalStorageFormat
} from './passkeys'

export interface MultiChainUserOpInput {
  userOp: UserOperationV9;
  chainId: bigint;
  bundlerUrl: string;
  paymasterUrl: string;
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
  // 1. Paymaster commit — gas estimation + paymaster fields
  const commitOverrides: PaymasterOverrides = {
    context: { signingPhase: "commit" as const },
  };

  const commitResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      return paymaster.createSponsorPaymasterUserOperation(
        safeAccount, op.userOp, op.bundlerUrl, undefined, commitOverrides,
      );
    }),
  );

  commitResults.forEach(([committedOp], i) => {
    ops[i].userOp = committedOp;
  });

  // 2. Build signing array and compute multichain Merkle root hash
  const userOperationsToSign = ops.map((op) => ({
    userOperation: op.userOp,
    chainId: op.chainId,
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

  // 6. Format single signature into per-UserOperation signatures
  const isInit = ops[0].userOp.nonce === 0n;

  const signatures = SafeAccount.formatSignaturesToUseroperationsSignatures(
    userOperationsToSign,
    [signerSignaturePair],
    {
      isInit,
      safe4337ModuleAddress: SafeAccount.DEFAULT_SAFE_4337_MODULE_ADDRESS,
    },
  );

  ops.forEach((op, i) => {
    op.userOp.signature = signatures[i];
  });

  // 7. Paymaster finalize — seal paymaster data after signatures
  const finalizeOverrides: PaymasterOverrides = {
    context: { signingPhase: "finalize" as const },
  };

  const finalizeResults = await Promise.all(
    ops.map((op) => {
      const paymaster = new CandidePaymaster(op.paymasterUrl);
      return paymaster.createSponsorPaymasterUserOperation(
        safeAccount, op.userOp, op.bundlerUrl, undefined, finalizeOverrides,
      );
    }),
  );

  finalizeResults.forEach(([finalizedOp], i) => {
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
