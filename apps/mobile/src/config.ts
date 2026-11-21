import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the school's API is.
 * - EXPO_PUBLIC_API_URL when set (e.g. https://fees.bnmpschool.in for the live app, or a test system).
 * - Otherwise, in development, the computer running `expo start` on port 3000, so a phone on the same
 *   Wi-Fi reaches the API started with `pnpm dev`.
 */
function devApiUrl(): string {
  if (Platform.OS === 'web') return `http://${globalThis.location?.hostname ?? 'localhost'}:3000`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:3000` : 'http://localhost:3000';
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || devApiUrl()).replace(/\/+$/, '');
