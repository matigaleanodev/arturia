import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { App } from './app/app';
import { appEnvironment } from './app/app-environment';
import { routes } from './app/app.routes';

const router = provideRouter(routes, withInMemoryScrolling({ anchorScrolling: 'enabled' }));

appEnvironment()
  .then((providers) => bootstrapApplication(App, { providers: [router, ...providers] }))
  .catch((error: unknown) => console.error(error));
