import type { Provider } from '@angular/core';

import { APP_OPTIONS, type AppOptions } from './core/app-options';

const options: AppOptions = {
  scopeIds: { personal: 'personal', work: 'work' },
};

export const appProviders: Provider[] = [{ provide: APP_OPTIONS, useValue: options }];
