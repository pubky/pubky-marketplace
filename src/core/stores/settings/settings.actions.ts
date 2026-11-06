import { type ZustandSet } from '../stores.types';
import {
  type SettingsActions,
  SettingsActionTypes,
  settingsInitialState,
  type SettingsState,
  type SettingsStore,
} from './settings.types';

// Helper to update state with timestamp
const withTimestamp = <T extends object>(updates: T): T & { updatedAt: number } => ({
  ...updates,
  updatedAt: Date.now(),
});

export const createSettingsActions = (set: ZustandSet<SettingsStore>): SettingsActions => ({
  // Notification actions
  setNotificationPreference: (type, enabled) => {
    set(
      (state) =>
        withTimestamp({
          notifications: {
            ...state.notifications,
            [type]: enabled,
          },
        }),
      false,
      SettingsActionTypes.SET_NOTIFICATION_PREFERENCE,
    );
  },

  // Privacy actions
  setShowConfirm: (showConfirm) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            showConfirm,
          },
        }),
      false,
      SettingsActionTypes.SET_SHOW_CONFIRM,
    );
  },

  setBlurCensored: (blurCensored) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            blurCensored,
          },
        }),
      false,
      SettingsActionTypes.SET_BLUR_CENSORED,
    );
  },

  setSignOutInactive: (signOutInactive) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            signOutInactive,
          },
        }),
      false,
      SettingsActionTypes.SET_SIGN_OUT_INACTIVE,
    );
  },

  setRequirePin: (requirePin) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            requirePin,
          },
        }),
      false,
      SettingsActionTypes.SET_REQUIRE_PIN,
    );
  },

  setHideWhoToFollow: (hideWhoToFollow) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            hideWhoToFollow,
          },
        }),
      false,
      SettingsActionTypes.SET_HIDE_WHO_TO_FOLLOW,
    );
  },

  setHideActiveFriends: (hideActiveFriends) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            hideActiveFriends,
          },
        }),
      false,
      SettingsActionTypes.SET_HIDE_ACTIVE_FRIENDS,
    );
  },

  setHideSearch: (hideSearch) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            hideSearch,
          },
        }),
      false,
      SettingsActionTypes.SET_HIDE_SEARCH,
    );
  },

  setNeverShowPosts: (neverShowPosts) => {
    set(
      (state) =>
        withTimestamp({
          privacy: {
            ...state.privacy,
            neverShowPosts,
          },
        }),
      false,
      SettingsActionTypes.SET_NEVER_SHOW_POSTS,
    );
  },

  // General actions
  reset: () => {
    set({ ...settingsInitialState }, false, SettingsActionTypes.RESET);
  },

  // Homeserver sync action, used by bootstrap to load remote settings
  loadFromHomeserver: (settings: SettingsState) => {
    set(
      {
        notifications: settings.notifications,
        privacy: settings.privacy,
        muted: settings.muted,
        updatedAt: settings.updatedAt,
        version: settings.version,
      },
      false,
      SettingsActionTypes.LOAD_FROM_HOMESERVER,
    );
  },
});
