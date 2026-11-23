import type { Routes } from '@angular/router';

import { fixturePreview } from './app-environment';
import { HomePage } from './home.page';

export const routes: Routes = [
  {
    path: '',
    component: HomePage,
    data: { fixturePreview },
  },
  { path: '**', redirectTo: '' },
];
