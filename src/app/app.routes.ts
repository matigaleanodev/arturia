import { inject } from '@angular/core';
import { type CanActivateFn, Router, type Routes } from '@angular/router';

import { AuthSession } from './core/auth/auth-session';
import { findScope } from './features/scopes/scope-switcher';
import { HomePage } from './home.page';

const signedIn: CanActivateFn = () =>
  Boolean(inject(AuthSession).accessToken()) || inject(Router).createUrlTree(['/']);

export const routes: Routes = [
  { path: '', component: HomePage },
  {
    path: 'chat',
    loadComponent: () => import('./features/chat/chat.page').then((module) => module.ChatPage),
    canActivate: [
      signedIn,
      (route) => Boolean(findScope(route.queryParamMap.get('scope'))) || inject(Router).createUrlTree(['/']),
    ],
    runGuardsAndResolvers: 'paramsOrQueryParamsChange',
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.page').then((module) => module.SettingsPage),
    canActivate: [signedIn],
  },
  { path: '**', redirectTo: '' },
];
