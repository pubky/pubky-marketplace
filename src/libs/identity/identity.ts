import { Keypair } from '@synonymdev/pubky';
import * as bip39 from 'bip39';
import { ValidationErrorCode } from '@/libs/error/error.codes';
import { Err } from '@/libs/error/error.factories';
import { ErrorService } from '@/libs/error/error.types';
import type { Pubky } from '@/models/models.types';
import type { THomeserverSessionResult } from '@/services/homeserver/homeserver.types';
import type { TDecryptRecoveryFileParams } from './identity.types';

export class Identity {
  // Mention pattern: pk: or pubky followed by exactly 52 lowercase alphanumeric characters
  static readonly PUBKY_IDENTIFIER_WITH_PREFIX_SOURCE = '(?:pk:|pubky)[a-z0-9]{52}';

  /**
   * Decrypts a recovery file and returns the keypair
   * @param encryptedFile - The encrypted recovery file
   * @param passphrase - The passphrase to decrypt the recovery file
   * @returns The keypair
   */
  static async decryptRecoveryFile({ encryptedFile, passphrase }: TDecryptRecoveryFileParams) {
    const arrayBuffer = await encryptedFile.arrayBuffer();
    const recoveryFile = new Uint8Array(arrayBuffer);
    try {
      return Keypair.fromRecoveryFile(recoveryFile, passphrase);
    } catch (error) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid recovery file or passphrase', {
        service: ErrorService.Local,
        operation: 'decryptRecoveryFile',
        cause: error,
      });
    }
  }

  /**
   * Converts a keypair to a human-readable pubky string
   * @param keypair - The keypair to convert
   * @returns The pubky string with prefix
   */
  static pubkyFromKeypair(keypair: Keypair): string {
    return keypair.publicKey.toString();
  }

  /**
   * Converts a mnemonic to a keypair
   * @param mnemonic - The mnemonic to convert
   * @returns The keypair
   */
  static keypairFromMnemonic(mnemonic: string) {
    if (!bip39.validateMnemonic(mnemonic)) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Invalid recovery phrase', {
        service: ErrorService.Local,
        operation: 'keypairFromMnemonic',
      });
    }

    try {
      // Convert mnemonic to seed using BIP39 standard
      const seedMnemonic = bip39.mnemonicToSeedSync(mnemonic);

      // Use first 32 bytes as secret key (same as signup process)
      // TODO: const secretKey = new Uint8Array(seedMnemonic.subarray(0, 32));
      const secretKey = seedMnemonic.slice(0, 32);

      return Keypair.fromSecret(secretKey);
    } catch (error) {
      throw Err.validation(ValidationErrorCode.INVALID_INPUT, 'Failed to restore keypair from recovery phrase', {
        service: ErrorService.Local,
        operation: 'keypairFromMnemonic',
        context: { originalError: error instanceof Error ? error.message : 'Unknown error' },
        cause: error,
      });
    }
  }

  /**
   * Gets the z32 pubky from a session
   * @param session - The session to get the pubky from
   * @returns The z32 pubky
   */
  static z32FromSession({ session }: THomeserverSessionResult): Pubky {
    return session.info.publicKey.z32();
  }

  /**
   * Extracts the public key from a pubky identifier string
   * Validates that the input matches the expected format and returns only the key portion
   *
   * @param pubky - The pubky identifier string (e.g., "pk:abc123..." or "pubkyabc123...")
   * @returns The 52-character public key portion, or null if the format is invalid
   *
   * @example
   * Identity.extractPubkyPublicKey("pk:abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop") // "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop"
   * Identity.extractPubkyPublicKey("pubkyabcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop") // "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnop"
   * Identity.extractPubkyPublicKey("invalid") // null
   */
  static extractPubkyPublicKey(pubky: string): string | null {
    if (!pubky || typeof pubky !== 'string') {
      return null;
    }

    // Pattern for 52 lowercase alphanumeric characters
    const keyPattern = /^[a-z0-9]{52}$/;

    // Check for "pk:" prefix
    if (pubky.startsWith('pk:')) {
      const key = pubky.slice(3);
      return keyPattern.test(key) ? key : null;
    }

    // Check for "pubky" prefix
    if (pubky.startsWith('pubky')) {
      const key = pubky.slice(5);
      return keyPattern.test(key) ? key : null;
    }

    return null;
  }
}
