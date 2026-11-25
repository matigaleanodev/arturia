import type { Provider } from '@angular/core';

import { APP_OPTIONS, type AppOptions } from './core/app-options';
import { loadRuntimeConfig } from './core/runtime-config';

const scopeIds: AppOptions['scopeIds'] = { personal: 'personal', work: 'work' };

// The build carries no environment values: each deployment publishes /config.json.
export async function appEnvironment(): Promise<Provider[]> {
  const result = await loadRuntimeConfig(new URL(location.href));
  const options: AppOptions = 'connection' in result
    ? { scopeIds, apiBaseUrl: result.connection.apiBaseUrl, oauth: result.connection.oauth }
    : { scopeIds, configError: result.error };
  return [{ provide: APP_OPTIONS, useValue: options }];
}
