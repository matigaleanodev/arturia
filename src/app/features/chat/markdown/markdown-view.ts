import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { parseMarkdown } from './markdown';

/**
 * Renders the parsed tree with interpolation and element bindings only. Reply headings start at h2 so
 * they stay below the conversation title, the page's h1.
 */
@Component({
  selector: 'app-markdown',
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'md' },
  template: `
    <ng-container *ngTemplateOutlet="blocksTemplate; context: { $implicit: blocks() }" />

    <ng-template #blocksTemplate let-blocks>
      @for (block of blocks; track $index) {
        @switch (block.type) {
          @case ('paragraph') {
            <p><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></p>
          }
          @case ('heading') {
            @switch (block.level) {
              @case (1) { <h2 class="md-h1"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></h2> }
              @case (2) { <h3 class="md-h2"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></h3> }
              @case (3) { <h4 class="md-h3"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></h4> }
              @case (4) { <h5 class="md-h4"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></h5> }
              @default { <h6 class="md-h4"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: block.children }" /></h6> }
            }
          }
          @case ('list') {
            @if (block.ordered) {
              <ol [attr.start]="block.start === 1 ? null : block.start">
                @for (item of block.items; track $index) {
                  <li><ng-container *ngTemplateOutlet="blocksTemplate; context: { $implicit: item }" /></li>
                }
              </ol>
            } @else {
              <ul>
                @for (item of block.items; track $index) {
                  <li><ng-container *ngTemplateOutlet="blocksTemplate; context: { $implicit: item }" /></li>
                }
              </ul>
            }
          }
          @case ('code') {
            <div class="md-code">
              @if (block.lang) {
                <span class="md-code-lang">{{ block.lang }}</span>
              }
              <pre tabindex="0"><code>{{ block.text }}</code></pre>
            </div>
          }
          @case ('quote') {
            <blockquote><ng-container *ngTemplateOutlet="blocksTemplate; context: { $implicit: block.children }" /></blockquote>
          }
          @case ('table') {
            <div class="md-table" tabindex="0">
              <table>
                <thead>
                  <tr>
                    @for (cell of block.head; track $index) {
                      <th scope="col" [class]="'align-' + (block.align[$index] ?? 'start')"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: cell }" /></th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of block.rows; track $index) {
                    <tr>
                      @for (cell of row; track $index) {
                        <td [class]="'align-' + (block.align[$index] ?? 'start')"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: cell }" /></td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @case ('rule') { <hr /> }
        }
      }
    </ng-template>

    <ng-template #inlineTemplate let-nodes>@for (node of nodes; track $index) {@switch (node.type) {@case ('text') {<ng-container>{{ node.text }}</ng-container>}@case ('code') {<code>{{ node.text }}</code>}@case ('break') {<br />}@case ('strong') {<strong><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: node.children }" /></strong>}@case ('em') {<em><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: node.children }" /></em>}@case ('del') {<del><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: node.children }" /></del>}@case ('link') {<a [href]="node.href" target="_blank" rel="noopener noreferrer nofollow"><ng-container *ngTemplateOutlet="inlineTemplate; context: { $implicit: node.children }" /></a>}}}</ng-template>
  `,
})
export class MarkdownView {
  readonly source = input.required<string>();
  protected readonly blocks = computed(() => parseMarkdown(this.source()));
}
