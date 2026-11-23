import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { App } from './app/app';
import { appProviders } from './app/app-environment';
import { routes } from './app/app.routes';

bootstrapApplication(App, {
  providers: [provideRouter(routes), ...appProviders],
}).catch((error: unknown) => console.error(error));
