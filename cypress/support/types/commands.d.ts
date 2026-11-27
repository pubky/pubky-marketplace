import { HasBackedUp, BackupType } from './enums';

declare global {
  namespace Cypress {
    interface Chainable {
      signOut(hasBackedUp: HasBackedUp): Chainable<void>;
      signInWithEncryptedFile(backupFilepath: string, passcode?: string): Chainable<void>;
      signInWithRecoveryPhrase(recoveryPhrase: string): Chainable<void>;
      completeOnboardingFromInstall(
        profileName: string,
        profileBio?: string,
        backup?: BackupType[],
        pubkyAlias?: string,
      ): Chainable<void>;
      onboardAsNewUser(
        profileName: string,
        profileBio?: string,
        backup?: BackupType[],
        pubkyAlias?: string,
      ): Chainable<void>;
      deleteDownloadsFolder(): Chainable<void>;
      renameFile(fromPath: string, toPath: string): Chainable<void>;
      saveStringToAlias(text: string, alias: string): Chainable<void>;
      saveElementValueToAlias(selector: string, alias: string): Chainable<void>;
      saveCopiedPubkyToAlias(alias: string): Chainable<void>;
    }
  }
}
