import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { APP_OPTIONS } from '../../core/app-options';
import type { TurnStatus } from '../../core/api/contract/openapi.generated';
import { AuthSession } from '../../core/auth/auth-session';
import { BrandMark, Icon } from '../../shared/icon';
import { COMPACT_QUERY, mediaQuery, MOBILE_QUERY } from '../../shared/media';
import { findScope, rememberScope, ScopePicker } from '../scopes/scope-switcher';
import { ChatStore } from './chat.store';
import { Composer } from './composer';
import { TurnView } from './turn-view';

const historyDate = new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
const sidebarKey = 'arturia.sidebar';

/** What the single status region says when a reply changes state. */
const announcements: Record<TurnStatus, string> = {
  queued: 'Respuesta en espera',
  running: 'Generando respuesta',
  completed: 'Respuesta completa',
  incomplete: 'Respuesta incompleta',
  failed: 'No se generó una respuesta',
  cancelled: 'Respuesta cancelada',
  blocked: 'Respuesta bloqueada',
};

type SidebarPreference = 'collapsed' | 'expanded';

function readSidebarPreference(): SidebarPreference | null {
  try {
    const value = localStorage.getItem(sidebarKey);
    return value === 'collapsed' || value === 'expanded' ? value : null;
  } catch {
    return null;
  }
}

@Component({
  selector: 'app-chat',
  imports: [RouterLink, ScopePicker, BrandMark, Icon, Composer, TurnView],
  providers: [ChatStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat.page.html',
})
export class ChatPage {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthSession);
  private readonly options = inject(APP_OPTIONS);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly chat = inject(ChatStore);
  protected readonly scope = computed(() => findScope(this.params().get('scope')));
  protected readonly conversationId = computed(() => this.params().get('conversation') || null);

  protected readonly mobile = mediaQuery(MOBILE_QUERY);
  private readonly compact = mediaQuery(COMPACT_QUERY);
  private readonly sidebarPreference = signal(readSidebarPreference());
  /** Collapsed rail on desktop; the preference wins over the default for the width. */
  protected readonly collapsed = computed(() => !this.mobile() &&
    (this.sidebarPreference() ?? (this.compact() ? 'collapsed' : 'expanded')) === 'collapsed');
  protected readonly drawerOpen = signal(false);
  protected readonly drawerActive = computed(() => this.mobile() && this.drawerOpen());
  protected readonly announcement = signal('');

  private readonly composer = viewChild(Composer);
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private readonly sidebar = viewChild<ElementRef<HTMLElement>>('sidebar');
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly seenStatuses = new Map<string, TurnStatus>();
  private seenConversation: string | null = null;
  private pinned = true;
  private announceTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.announceTimer));
    effect(() => {
      const scope = this.scope();
      const conversationId = this.conversationId();
      if (!this.auth.accessToken() || !scope) {
        void this.router.navigate(['/'], { replaceUrl: true });
        return;
      }
      untracked(() => {
        rememberScope(scope.key);
        this.drawerOpen.set(false);
        const scopeId = this.options.scopeIds[scope.key];
        if (!this.chat.isOpen(scopeId, conversationId)) {
          this.pinned = true;
          this.chat.open(scopeId, conversationId);
        }
      });
    });

    effect(() => {
      if (!this.mobile()) this.drawerOpen.set(false);
    });

    effect(() => {
      const conversation = this.chat.conversation();
      untracked(() => this.trackStatuses(conversation?.conversationId ?? null, conversation?.turns ?? []));
    });

    // Keep the newest text in view while the reader stays at the bottom of the thread.
    effect(() => {
      this.chat.conversation();
      this.chat.streamText();
      afterNextRender(() => {
        const thread = this.thread()?.nativeElement;
        if (thread && this.pinned) thread.scrollTop = thread.scrollHeight;
      }, { injector: this.injector });
    });
  }

  protected title(): string {
    return this.chat.conversation()?.title || 'Nueva conversación';
  }

  protected historyLabel(timestamp: string): string {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? timestamp : historyDate.format(date);
  }

  protected toggleSidebar(): void {
    const next: SidebarPreference = this.collapsed() ? 'expanded' : 'collapsed';
    this.sidebarPreference.set(next);
    try {
      localStorage.setItem(sidebarKey, next);
    } catch {
      // The choice applies to this page only.
    }
    // The rail and the expanded sidebar render different toggles: focus follows to the new one.
    afterNextRender(() => {
      this.sidebar()?.nativeElement.querySelector<HTMLElement>('[data-sidebar-toggle]')?.focus();
    }, { injector: this.injector });
  }

  protected openDrawer(): void {
    this.drawerOpen.set(true);
    afterNextRender(() => {
      this.sidebar()?.nativeElement.querySelector<HTMLElement>('[data-drawer-close]')?.focus();
    }, { injector: this.injector });
  }

  protected closeDrawer(restoreFocus = true): void {
    if (!this.drawerOpen()) return;
    this.drawerOpen.set(false);
    if (restoreFocus) {
      afterNextRender(() => this.menuButton()?.nativeElement.focus(), { injector: this.injector });
    }
  }

  /** Keeps Tab inside the open drawer; the rest of the page is inert meanwhile. */
  protected trapFocus(event: Event): void {
    const sidebar = this.sidebar()?.nativeElement;
    if (!this.drawerActive() || !sidebar || !(event instanceof KeyboardEvent) || event.key !== 'Tab') return;
    const focusable = [...sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected startConversation(): void {
    this.closeDrawer(false);
    afterNextRender(() => this.composer()?.focus(), { injector: this.injector });
  }

  protected async conversationCreated(conversationId: string): Promise<void> {
    const scope = this.scope();
    if (!scope || !this.chat.isOpen(this.options.scopeIds[scope.key], conversationId)) return;
    await this.router.navigate(['/chat'], { queryParams: { scope: scope.key, conversation: conversationId } });
  }

  protected retrySend(): void {
    void this.chat.send();
  }

  protected copied(success: boolean): void {
    this.announce(success ? 'Respuesta copiada' : 'No se pudo copiar la respuesta');
  }

  protected trackScroll(): void {
    const thread = this.thread()?.nativeElement;
    if (thread) this.pinned = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
  }

  private trackStatuses(conversationId: string | null, turns: readonly { snapshot: { turnId: string; status: TurnStatus } }[]): void {
    // Opening a conversation is silent; later changes of its replies, and new replies, are announced once.
    const silent = conversationId === null || conversationId !== this.seenConversation;
    if (silent) this.seenStatuses.clear();
    for (const { snapshot } of turns) {
      if (!silent && this.seenStatuses.get(snapshot.turnId) !== snapshot.status) {
        this.announce(announcements[snapshot.status]);
      }
      this.seenStatuses.set(snapshot.turnId, snapshot.status);
    }
    this.seenConversation = conversationId;
  }

  private announce(message: string): void {
    // Clearing first lets a repeated message be announced again.
    this.announcement.set('');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => this.announcement.set(message), 60);
  }
}
