import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { App } from './app/app';
import { appEnvironment } from './app/app-environment';
import { routes } from './app/app.routes';

appEnvironment()
  .then((providers) => bootstrapApplication(App, { providers: [provideRouter(routes), ...providers] }))
  .catch((error: unknown) => console.error(error));
