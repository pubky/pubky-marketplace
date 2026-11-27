// <reference types="cypress" />

import { TEST_BACKUP_PASSWORD, backupDownloadFilePath, extendedTimeout } from './common';
import { goToProfilePageFromHeader } from './header';
import { waitForFeedToLoad } from './posts';
import { BackupType } from './types/enums';
// ***********************************************
// This example commands.ts shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************

// Complete onboarding from install page. Separated from onboardAsNewUser to allow for reuse in onboarding test for /invite/<code> URL
Cypress.Commands.add(
  'completeOnboardingFromInstall',
  (profileName: string, profileBio: string = '', backup?: BackupType[], pubkyAlias?: string) => {
    cy.get('#create-keys-in-browser-btn').click();
    cy.location('pathname').should('eq', '/onboarding/pubky');

    cy.get('[data-cy="pubky-display"]').should('be.visible');
    cy.get('[data-cy="pubky-display"]').invoke('val').should('not.eq', '').and('have.length.greaterThan', 0);

    // copy pubky to alias
    if (pubkyAlias) {
      // WebKit doesn't support clipboard read, so read directly from input field
      if (Cypress.browser.family === 'webkit') {
        cy.saveElementValueToAlias('[data-cy="pubky-display"]', pubkyAlias);
      } else {
        // Chrome/Firefox are configured to support clipboard read, so copy to clipboard and read from clipboard
        cy.get('#copy-to-clipboard-action-btn').click();
        cy.saveCopiedPubkyToAlias(pubkyAlias);
      }
    }

    cy.get('#public-key-navigation-continue-btn').click();
    cy.location('pathname').should('eq', '/onboarding/backup');

    if (backup?.includes(BackupType.EncryptedFile)) {
      cy.get('#backup-encrypted-file-btn').click();
      cy.get('#password').type(TEST_BACKUP_PASSWORD);
      cy.get('#confirmPassword').type(TEST_BACKUP_PASSWORD);
      cy.get('#download-file-btn').click();
      cy.renameFile(backupDownloadFilePath(), backupDownloadFilePath(profileName));
      cy.get('#backup-successful-ok-btn').click();
    }
    if (
      backup?.includes(BackupType.RecoveryPhraseWithoutConfirmation) ||
      backup?.includes(BackupType.RecoveryPhraseWithConfirmation)
    ) {
      cy.get('#backup-recovery-phrase-btn').click();
      cy.get('#backup-recovery-phrase-reveal-btn').click();

      // Store the recovery phrase in a unique alias for later use
      collectRecoveryPhraseWords().then((recoveryPhrase) => {
        cy.wrap(recoveryPhrase).as(`recoveryPhrase-${profileName}`);
      });

      // Select button based on viewport (mobile or desktop)
      const confirmBtnId = Cypress.expose('isMobile')
        ? '#backup-recovery-phrase-confirm-btn-mobile'
        : '#backup-recovery-phrase-confirm-btn-desktop';
      cy.get(confirmBtnId).click();

      // either skip phrase confirmation or confirm it
      if (backup?.includes(BackupType.RecoveryPhraseWithoutConfirmation)) {
        cy.get('[data-testid="dialog-close"]').click();
      } else if (backup?.includes(BackupType.RecoveryPhraseWithConfirmation)) {
        cy.get(`@recoveryPhrase-${profileName}`).then((recoveryPhrase) => {
          confirmRecoveryPhrase(recoveryPhrase.toString());
        });
      }
    }

    cy.get('#backup-navigation-continue-btn').click();
    cy.location('pathname').should('eq', '/onboarding/profile');

    cy.get('#profile-name-input').clear().type(profileName);
    if (profileBio) {
      cy.get('#profile-bio-input').type(profileBio);
    }

    cy.get('#profile-finish-btn').click(extendedTimeout());

    cy.location('pathname').should('eq', '/home');

    // confirm welcome message is shown and dismiss it
    cy.get('#welcome-title').should('exist');
    cy.get('#welcome-explore-pubky-btn').click();
  },
);

Cypress.Commands.add(
  'onboardAsNewUser',
  (
    profileName: string,
    profileBio: string = '',
    backup?: BackupType[],
    //skipOnboardingSlides: SkipOnboardingSlides = SkipOnboardingSlides.Yes,
    pubkyAlias?: string,
  ) => {
    cy.location('pathname').then((pathname) => {
      if (pathname !== '/') cy.visit('/');
    });
    cy.location('pathname').should('eq', '/');

    cy.get('#create-account-btn').click();
    cy.location('pathname').should('eq', '/onboarding/human');

    // Click 'enter invite code' button
    cy.get('[data-cy="invite-code-link"]').should('exist').click();

    // use cy.request to get the invite code from the HOMESERVER_ADMIN_URL using the HOMESERVER_ADMIN_PASSWORD
    cy.env(['homeserverAdminUrl', 'homeserverAdminPassword']).then(
      ({ homeserverAdminUrl, homeserverAdminPassword }) => {
        cy.request({
          method: 'GET',
          url: homeserverAdminUrl,
          headers: {
            'X-Admin-Password': homeserverAdminPassword,
          },
        }).then((response) => {
          const inviteCode = response.body;
          console.log('inviteCode', inviteCode);
          cy.get('[data-cy="human-invite-code-input"]').type(inviteCode);
          cy.get('[data-cy="human-invite-code-continue-btn"]').should('not.be.disabled').click();
        });
      },
    );

    cy.location('pathname').should('eq', '/onboarding/install');

    cy.completeOnboardingFromInstall(profileName, profileBio, backup, pubkyAlias);
  },
);

// Confirm recovery phrase by clicking each word in order
function confirmRecoveryPhrase(recoveryPhrase: string): void {
  const words = recoveryPhrase.split(' ');
  const sortedWords = [...words].sort();

  // Track which indices in sortedWords we've already used
  const usedIndices = new Set<number>();

  words.forEach((word) => {
    // Find the next available index of the current word in the sorted list
    let alphaIndex = -1;
    for (let i = 0; i < sortedWords.length; i++) {
      if (sortedWords[i] === word && !usedIndices.has(i)) {
        alphaIndex = i;
        usedIndices.add(i);
        break;
      }
    }

    if (alphaIndex === -1) {
      throw new Error(`Could not find available index for word: ${word}`);
    }

    cy.get(`#backup-recovery-phrase-choice-${alphaIndex + 1}`).click();
  });
  cy.get('#backup-recovery-phrase-validate-btn').click();
  cy.get('#backup-recovery-phrase-finish-btn').click();
}

// Collect all 12 recovery phrase words
function collectRecoveryPhraseWords(): Cypress.Chainable<string> {
  return cy.get('[id^="backup-recovery-phrase-word-"]').then(($elements) => {
    const words: string[] = [];

    // Extract words from each element in order
    $elements.each((index, element) => {
      const $el = Cypress.$(element);
      const wordText = $el.parent().find('span').text().trim();
      words.push(wordText);
    });

    return words.join(' ');
  });
}

Cypress.Commands.add('signOut', () => {
  goToProfilePageFromHeader();

  cy.get('#profile-logout-btn').click();
  cy.location('pathname').should('eq', '/logout');

  // navigate back to onboarding homepage
  cy.get('#logout-navigation-back-btn').click();
  cy.location('pathname').should('eq', '/');
});

Cypress.Commands.add('signInWithEncryptedFile', (backupFilepath: string, passcode = TEST_BACKUP_PASSWORD) => {
  cy.location('pathname').then((pathname) => {
    if (pathname !== '/') cy.visit('/');
  });
  cy.location('pathname').should('eq', '/');

  cy.get('[data-cy="header-sign-in-btn"]').click();
  cy.location('pathname').should('eq', '/sign-in');

  cy.get('#restore-encrypted-file-btn').click();

  cy.get('#encrypted-file-input').selectFile(
    backupFilepath,
    { force: true }, // force to bypass visibility check of hidden input field
  );

  if (passcode) {
    cy.get('#restore-password').type(passcode);
  }
  cy.get('#encrypted-file-restore-btn').click();

  cy.location('pathname').should('eq', '/home');
  waitForFeedToLoad();
});

Cypress.Commands.add('signInWithRecoveryPhrase', (recoveryPhrase: string) => {
  cy.location('pathname').then((pathname) => {
    if (pathname !== '/') cy.visit('/');
  });
  cy.location('pathname').should('eq', '/');

  cy.get('[data-cy="header-sign-in-btn"]').click();
  cy.location('pathname').should('eq', '/sign-in');

  cy.get('#restore-recovery-phrase-btn').click();
  inputRecoveryPhraseWords(recoveryPhrase);
  cy.get('#recovery-phrase-restore-btn').click();

  cy.location('pathname').should('eq', '/home');
  waitForFeedToLoad();
});

// Input recovery phrase words into the form
function inputRecoveryPhraseWords(recoveryPhrase: string): void {
  const words = recoveryPhrase.split(' ');
  words.forEach((word, index) => {
    cy.get(`#word-slot-input-${index + 1}`).type(word);
  });
}

Cypress.Commands.add('deleteDownloadsFolder', () => {
  const downloadsFolder = Cypress.config('downloadsFolder');
  cy.task('deleteFolder', downloadsFolder);
});

Cypress.Commands.add('renameFile', (fromPath: string, toPath: string) => {
  cy.task('renameFile', { fromPath, toPath }).then(() => {
    cy.log(`File has been renamed from ${fromPath} to ${toPath}`);
  });
});

// Common helper function to store a string value to an alias and Cypress env
// see https://docs.cypress.io/guides/core-concepts/variables-and-aliases#Sharing-Context
// note: aliases work in the context of as test and only the first test after before
function storeStringToAlias(text: string, alias: string): void {
  // store text as alias
  cy.wrap(text).as(alias);
  // also store text in Cypress env to be used in beforeEach to re-create aliases because they are cleared at end of each test
  // e.g. cy.wrap(Cypress.expose(profile1.pubkyAlias)).as(profile1.pubkyAlias);
  Cypress.expose(alias, text);
}

// Stores a string value to an alias
Cypress.Commands.add('saveStringToAlias', (text: string, alias: string) => {
  if (!text || text.length === 0) {
    throw new Error('Cannot save empty string to alias');
  }
  storeStringToAlias(text, alias);
});

// Reads a value from an element and stores it to an alias
Cypress.Commands.add('saveElementValueToAlias', (selector: string, alias: string) => {
  cy.get(selector)
    .invoke('val')
    .then((text) => {
      const value = text as string;
      if (!value || value.length === 0) {
        throw new Error(`Unable to read value from ${selector}`);
      }
      cy.saveStringToAlias(value, alias);
    });
});

// Stores the clipboard contents to an alias for later use
// see https://docs.cypress.io/guides/core-concepts/variables-and-aliases#Sharing-Context
// note: aliases work in the context of as test and only the first test after before
Cypress.Commands.add('saveCopiedPubkyToAlias', (alias: string) => {
  cy.window()
    .then((win) => {
      // ensure focus is on the window before attempting to read clipboard
      win.focus();
      // requires browser to be in focus
      return win.navigator.clipboard.readText().then((text) => {
        // format assertion for `pubky` prefix
        expect(text).to.match(/^pubky/);
        return text;
      });
      // previous 'then' is callback of a promise which doesn't guarantee synchronous execution
      // so an additional 'then' is needed to guarantee the alias is stored before the next test step
    })
    .then((text) => {
      storeStringToAlias(text, alias);
    });
});
