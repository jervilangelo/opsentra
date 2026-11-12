import type { Mode } from '@/types/domain';

/**
 * Public build-time configuration only (blueprint §9.3). Only VITE_* values are
 * bundled; never add secrets, keys, account IDs or a Cognito client secret.
 */
function readMode(value: string | undefined): Mode {
  return value === 'live' ? 'live' : 'demo';
}

function readOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const env = {
  defaultMode: readMode(import.meta.env.VITE_APP_MODE_DEFAULT),
  apiBaseUrl: readOptional(import.meta.env.VITE_API_BASE_URL),
  cognitoUserPoolId: readOptional(import.meta.env.VITE_COGNITO_USER_POOL_ID),
  cognitoClientId: readOptional(import.meta.env.VITE_COGNITO_CLIENT_ID),
} as const;

/** Single supported region (blueprint §0 principle 7). */
export const LIVE_REGION = 'ap-southeast-1';
