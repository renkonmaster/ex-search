# ex-search Design

## Purpose

ex-search augments traQ's existing message-search command palette without
changing traQ or calling its API. It provides a longer configurable history,
plain-language search controls, full-query suggestions, inline completion,
term highlighting, and relevance ordering for the currently displayed result
page.

## Compatibility and constraints

- Ship as a Chrome and Edge Manifest V3 extension for
  `https://q.trap.jp/*`.
- Request only the `storage` permission and the q.trap.jp host match needed by
  the content script.
- Do not read authentication data, call `/api/v3`, inject code into the page's
  JavaScript world, or depend on Vue/Pinia internals.
- Do not modify `/home/renkon/traQdev/traQ` or
  `/home/renkon/traQdev/traQ_S-UI`.
- Keep runtime files dependency-free and directly loadable as an unpacked
  extension.
- Use traQ_S-UI's `input[placeholder="メッセージを検索"]` as the primary
  semantic integration point. Generated CSS-module hashes may only be used via
  stable class-name prefixes as a fallback, never as exact hashes.

## Settings and storage

The options page exposes:

- history limit, an integer from 1 through 100, default 20;
- enable full-query suggestions, default on;
- enable inline completion, default on;
- enable result highlighting, default on;
- default local ordering: native or relevance, default native;
- clear extension history.

Settings are validated and stored in `chrome.storage.sync`. Search history is
private to this extension and stored in `chrome.storage.local` under one
versioned key. A new non-empty query is trimmed, deduplicated, moved to the
front, and truncated to the configured limit. Reducing the limit truncates the
stored history immediately. Page text used to create suggestions is never
persisted.

The extension does not alter traQ's IndexedDB-backed five-item history.
Instead, it renders its own longer history beside the native search UI. This
avoids coupling to the `app/commandPalette` Pinia store and its database schema.

## DOM integration

The content script observes the single-page application with a debounced
`MutationObserver`. It locates a visible search input by its placeholder,
mounts one idempotent extension panel next to the command palette, and removes
or reconnects listeners when Vue replaces the input. Every extension-owned
element uses a `data-ex-search-*` attribute and styles are scoped beneath the
extension panel.

Values are applied to the native input through its prototype value setter,
followed by bubbling `input` and `change` events. Search submission dispatches
the same keyboard event a user action would produce. The extension never
reaches into Vue component instances.

## Suggestions and completion

Full-query candidates come from three local sources:

1. stored search history;
2. current-route context, including `in:here` on `/channels/...` and a
   `from:<username>` template on `/users/<username>`;
3. frequent meaningful terms from currently rendered message text.

Candidate ranking prefers an exact prefix match, then token-prefix matches,
then recency and frequency. Duplicate normalized candidates are removed. At
most eight candidates are shown. Token extraction uses `Intl.Segmenter` when
available and a Unicode-aware fallback otherwise; URLs, query operators,
one-character tokens, and a small Japanese/English stop-word list are ignored.

Inline completion chooses the highest-ranked candidate that strictly extends
the current input. It displays only the remaining suffix and lets Tab accept
the candidate. Tab is not intercepted when no candidate exists, and Enter
always retains native traQ behavior.

## Search-option builder

The extension panel presents Japanese labels that insert or replace valid
traQ query tokens:

- scope: all channels or `in:here`;
- author: any, `from:me`, Bot (`is:bot`), or non-Bot (`not:bot`);
- target: any or `to:me`;
- content: any, `has:attachments`, `has:image`, `has:video`, or `has:audio`;
- date range: `after:YYYY-MM-DD` and `before:YYYY-MM-DD`.

Changing a control rewrites only the filter family owned by that control and
preserves free-text terms and unrelated filters. Invalid or incomplete dates
are not inserted. The builder includes a reset action that removes only its
owned filters.

## Highlighting and local ordering

Highlight terms are derived from the settled native input by excluding known
filter tokens and query punctuation. Case-insensitive literal matches of terms
with at least two Unicode characters are wrapped in
`mark[data-ex-search-highlight]`. Existing links, form controls, code blocks,
and extension UI are not rewritten. Before each pass, prior extension marks
are safely unwrapped so Vue updates do not accumulate nested markup.

The local ordering selector offers `traQの順番` and `一致度順`. Relevance is
the weighted number of highlighted term occurrences in each visible result
card, with the original DOM index as a stable tiebreaker. Ordering is applied
with CSS `order` to the currently displayed page only; it does not claim to
rerank results that traQ has not fetched. Returning to native order removes all
extension ordering styles.

## Accessibility and failures

- All controls have labels, keyboard focus styles, and an `aria-live` status
  region.
- Suggestion buttons are keyboard reachable; Escape closes only the extension
  suggestion list and does not suppress traQ's handler.
- Invalid stored data falls back to documented defaults.
- Missing or changed traQ DOM results in a no-op and a concise console warning,
  not a broken page.
- Storage failures keep an in-memory session history and show a non-blocking
  status message.

## Testing

Separate pure logic from browser/DOM adapters. Use Node 18 or later with
`node:test`, `node:assert/strict`, and a development-only DOM implementation for
fixture tests. Runtime extension files must not import the test dependency.

Tests cover settings validation, history deduplication/truncation, token and
filter parsing, filter-family replacement, route candidates, frequency and
ranking behavior, suffix completion, highlight extraction, safe mark/unmark,
stable relevance scores, idempotent mounting, storage fallbacks, and manifest
entry points. Final verification runs the full test suite and syntax-checks all
runtime JavaScript.

## Out of scope

- Server-wide trend analysis, semantic/vector search, or suggestions based on
  data not currently rendered in the browser.
- Replacing traQ's search API, fetching more than the native result page, or
  changing server-side relevance.
- Supporting origins other than `https://q.trap.jp` in the first version.

## Acceptance criteria

On traQ's search palette, the extension displays up to the configured number
of persistent history entries, offers local full-query and Tab-completion
suggestions, builds valid search filters through Japanese controls, highlights
literal search terms, and can stably reorder the visible page by relevance.
Disabling each feature restores native behavior, no traQ API request is made,
and all automated checks pass.
