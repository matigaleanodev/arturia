import { inject } from '@angular/core';
import { Router, type Routes } from '@angular/router';

import { AuthSession } from './core/auth/auth-session';
import { findScope } from './features/scopes/scope-switcher';
import { HomePage } from './home.page';

export const routes: Routes = [
  { path: '', component: HomePage },
  {
    path: 'chat',
    loadComponent: () => import('./features/chat/chat.page').then((module) => module.ChatPage),
    canActivate: [
      (route) =>
        (Boolean(inject(AuthSession).accessToken()) &&
          Boolean(findScope(route.queryParamMap.get('scope')))) ||
        inject(Router).createUrlTree(['/']),
    ],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  { path: '**', redirectTo: '' },
];
