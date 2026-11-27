import * as path from 'path';

export const defaultBackupFilename = (): string => {
  // return `pubky_recovery_${moment().utc().format('YYYY-MM-DD')}.pkarr`
  return 'recovery.pkarr';
};

/** Password for encrypted backup files made in tests. Backup files need at least 16 characters. */
export const TEST_BACKUP_PASSWORD = 'e2e-backup-password';

export const backupDownloadFilePath = (filename?: string): string => {
  const filenameWithExtension = filename ? `${filename}.pkarr` : defaultBackupFilename();
  const downloadsFolder = Cypress.config('downloadsFolder');
  return path.join(downloadsFolder, filenameWithExtension);
};

/**
 * Returns a timeout options object with doubled timeout when not in CI
 * Useful for commands that may need extra time in local development
 */
export const extendedTimeout = (): Partial<Cypress.Timeoutable> => {
  return Cypress.expose('ci')
    ? { timeout: Cypress.config('defaultCommandTimeout') * 1.2 }
    : { timeout: Cypress.config('defaultCommandTimeout') * 2 };
};
