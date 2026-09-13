# ex-search Native Search UI Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide redundant native traQ search controls and make ex-search the sole visible search-control UI while preserving native result rendering and pagination.

**Architecture:** Add DOM adapters that identify the native suggestion view and native `PopupSelector` by semantic text and stable class prefixes. `app.js` will idempotently mark those elements as hidden, expose the three native server-sort choices in the ex-search panel, and forward selections through the hidden native selector. Native result content remains visible and serves as the API/rendering boundary.

**Tech Stack:** Manifest V3 content script, browser DOM APIs, CSS data markers, Node.js `node:test`, and jsdom.

## Global Constraints

- Do not modify `traQ` or `traQ_S-UI`.
- Do not call `/api/v3`, access Vue/Pinia state, or inject page-world JavaScript.
- Never use a complete generated CSS-module hash; use semantic text and stable class prefixes only.
- Hide only native nodes carrying extension-owned data markers and restore them on stop.
- Preserve traQ's search result rendering, empty state, pagination, and message opening.
- Use test-first red-green-refactor cycles for every new behavior.

---

### Task 1: Add failing DOM and lifecycle tests

**Files:**
- Modify: `dom.test.js`
- Modify: `app.test.js`
- Modify: `content.css.test.js`

**Interfaces:**
- Consumes: current native command-palette fixture and the DOM adapter exports.
- Produces: regression coverage for native UI discovery, hiding, server-sort forwarding, and restoration.

- [ ] **Step 1: Add DOM discovery tests**

Add fixtures containing a sibling with `._header_hash` text `検索オプション`
and a result sibling containing `._valueContainer_hash` plus
`._itemContainer_hash` entries labelled `新しい順`, `古い順`, and
`最近更新された順`. Assert the suggestion root and sort container are
discovered, the three sort values map to their labels, and an unknown value is
not selected.

- [ ] **Step 2: Add app lifecycle tests**

Extend the app fixture with the native suggestion and native sort nodes. After
`start()`, assert:

```js
assert.equal(nativeSuggestion.dataset.exSearchNativeSuggestionHidden, 'true')
assert.equal(nativeSort.dataset.exSearchNativeSortHidden, 'true')
assert.equal(nativeSuggestion.style.display, '')
assert.deepEqual(serverSortOptions, ['新しい順', '古い順', '最近更新された順'])
```

Dispatch a change to the ex-search server-sort select with value `-createdAt`
and assert the hidden native option `古い順` receives the click. After
`app.stop()`, assert both hiding attributes and the host compact-layout
attribute are absent.

- [ ] **Step 3: Extend the CSS contract test**

Assert that `content.css` contains selectors for
`data-ex-search-native-suggestion-hidden` and
`data-ex-search-native-sort-hidden`.

- [ ] **Step 4: Run the focused tests to verify they fail**

Run: `node --test dom.test.js app.test.js content.css.test.js`

Expected: FAIL because the new DOM helpers, panel server-sort control, and
hiding markers do not exist yet.

- [ ] **Step 5: Commit the failing-test changes**

```bash
git add dom.test.js app.test.js content.css.test.js
git commit -m "test: specify native search UI replacement"
```

### Task 2: Implement native UI discovery and hiding

**Files:**
- Modify: `dom.js`
- Modify: `app.js`
- Modify: `content.css`

**Interfaces:**
- Consumes: the native search DOM and the tests from Task 1.
- Produces `findNativeSearchSuggestion(panel)`, `findNativeSortSelector(panel)`, `findNativeSortOption(selector, value)`, `readNativeSortValue(selector)`, and idempotent native UI marker reconciliation used by `app.js`.

- [ ] **Step 1: Implement semantic and prefix-based DOM helpers**

Recognize the native suggestion only when the panel's immediate next sibling
contains a stable `_header_`-prefixed element whose trimmed text is
`検索オプション`. Recognize the native sort selector from the same sibling
when it contains a `_valueContainer_`-prefixed element; return its outer
selector container and value element. Map exactly:

```js
{
  createdAt: '新しい順',
  '-createdAt': '古い順',
  updatedAt: '最近更新された順'
}
```

Do not treat unrelated siblings as native search controls.

- [ ] **Step 2: Add idempotent marker reconciliation**

In `app.js`, mark the discovered suggestion root with
`data-ex-search-native-suggestion-hidden="true"` and the discovered sort
container with `data-ex-search-native-sort-hidden="true"`. Remove stale markers
from prior native nodes, set the host compact-layout marker only while the
suggestion marker is active, and avoid remove/re-add loops when markers are
already correct. On unmount/stop, remove all native markers.

- [ ] **Step 3: Add CSS hiding rules and compact layout**

Add `display: none !important` for the two native marker selectors. When the
native suggestion marker is active on the host, use three grid rows so the
hidden native suggestion does not leave an empty fourth row. Keep native
result-list selectors unmodified.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --test dom.test.js app.test.js content.css.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Commit native hiding**

```bash
git add dom.js app.js content.css
git commit -m "feat: hide redundant native search controls"
```

### Task 3: Move native server sorting into ex-search

**Files:**
- Modify: `app.js`
- Modify: `dom.js`
- Modify: `app.test.js`

**Interfaces:**
- Consumes: `findNativeSortSelector()` and `findNativeSortOption()` from Task 2.
- Produces a `[data-ex-search-server-ordering]` select with values `createdAt`, `-createdAt`, and `updatedAt`; selections are forwarded through the hidden native selector without exposing the old control.

- [ ] **Step 1: Add the server-sort select to the panel**

Render a labelled select alongside the existing local-order select with the
three exact options `新しい順`, `古い順`, and `最近更新された順`, defaulting to
`createdAt`. Keep the existing local `native`/`relevance` select separate.

- [ ] **Step 2: Forward selections through the hidden native selector**

On server-sort change, click the hidden native value element and then choose
the mapped native option. Because Vue renders the option menu after the first
click, try once immediately and once through the injected scheduler. Keep the
requested value pending until the native option is found; retry when
`reconcile()` sees a newly rendered selector.

- [ ] **Step 3: Keep control state across native DOM replacement**

When traQ replaces the result subtree, reapply the current server-sort value to
the new native selector and update the ex-search select. Do not change the
native result list or pagination DOM.

- [ ] **Step 4: Run the focused tests**

Run: `node --test app.test.js dom.test.js`

Expected: all app and DOM tests pass, including the hidden-option click check.

- [ ] **Step 5: Commit server-sort ownership**

```bash
git add app.js dom.js app.test.js
git commit -m "feat: expose native result sorting in ex-search"
```

### Task 4: Document and verify the replacement UI

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the complete replacement behavior from Tasks 2 and 3.
- Produces: user-facing documentation and final verification evidence.

- [ ] **Step 1: Document the ownership boundary**

Explain that ex-search replaces the native suggestions, history, filters, and
sort selector, while traQ continues to render results and pagination.

- [ ] **Step 2: Run complete verification**

Run:

```sh
npm test
npm run check
git diff --check main..HEAD
```

Expected: all tests pass, all runtime JavaScript syntax checks pass, and no
whitespace errors are reported.

- [ ] **Step 3: Inspect the final diff and status**

Run: `git diff main..HEAD -- dom.js app.js content.css README.md && git status --short --branch`

Confirm that only ex-search files changed, native result rendering remains
untouched, and the worktree is clean after committing documentation.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: describe ex-search native search replacement"
```
