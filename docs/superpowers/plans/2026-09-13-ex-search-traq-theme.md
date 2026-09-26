# ex-search traQ Theme Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ex-search UI inside traQ follow the active traQ CSS theme variables.

**Architecture:** Keep the change in the content stylesheet. Define extension-scoped CSS aliases that read traQ's public custom properties, then use those aliases for every visible panel color, control state, and search highlight. Keep fallback colors inside `var()` only so the extension still renders on an unavailable/older host page.

**Tech Stack:** Manifest V3 content CSS, traQ_S-UI CSS custom properties, Node.js `node:test`.

## Global Constraints

- Do not modify `traQ` or `traQ_S-UI`.
- Do not read Vue/Pinia state or add runtime JavaScript for theme detection.
- Apply theme styles only to extension-owned elements and marks.
- Use the active traQ variables; copied light/dark palette values are fallback-only.

---

### Task 1: Add a CSS theme contract test

**Files:**
- Create: `content.css.test.js`

**Interfaces:**
- Consumes: `content.css` as a text contract.
- Produces: a repeatable check that all ex-search visible color roles use traQ variables.

- [ ] **Step 1: Write the failing test**

Create a Node test that reads `content.css`, requires the panel to reference all
of the following variables, and rejects the old active hover/highlight colors:

```js
const required = [
  '--theme-background-primary-default',
  '--theme-background-primary-border',
  '--theme-background-secondary-default',
  '--theme-background-secondary-border',
  '--theme-ui-primary-default',
  '--theme-ui-secondary-default',
  '--theme-accent-primary-default',
  '--theme-accent-primary-background',
  '--markdown-mark-text',
  '--markdown-mark-background',
  '--color-scheme'
]
```

Assert each variable appears in a `var(--...)` expression and assert the raw
active declarations `border-color: #4899f9`, `background: #ffd84d`, and
`background: #8a6500` do not appear.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test content.css.test.js`

Expected: FAIL because the current stylesheet still has several fixed control,
hover, and highlight colors.

- [ ] **Step 3: Commit the test**

```bash
git add content.css.test.js
git commit -m "test: define ex-search theme variable contract"
```

### Task 2: Replace content colors with traQ variables

**Files:**
- Modify: `content.css`

**Interfaces:**
- Consumes: traQ_S-UI variables exposed by `useThemeVariables.ts`.
- Produces: theme-following styles scoped to `[data-ex-search-panel]` and its extension-owned descendants.

- [ ] **Step 1: Define panel-scoped aliases**

At the panel root, map the required traQ variables to `--ex-search-*` aliases.
Use the existing fixed colors only as the second argument of `var()` fallbacks.
Keep the existing user change that sets the panel's primary background, border,
foreground, and `color-scheme`.

- [ ] **Step 2: Use aliases for controls and states**

Replace raw gray borders and `Canvas` backgrounds on the ordering select,
history entries, suggestions, filter inputs/selects, and filter buttons with
the scoped aliases. Use the primary/secondary UI variables for text and muted
labels. Use the accent variables for hover and keyboard focus.

- [ ] **Step 3: Use Markdown theme colors for highlighting**

Replace both light and dark hard-coded highlight backgrounds with
`--markdown-mark-text` and `--markdown-mark-background`. Remove the media-query
override because the active traQ variable already changes with the selected
theme.

- [ ] **Step 4: Run the focused test**

Run: `node --test content.css.test.js`

Expected: PASS, with no raw active hover/highlight declarations remaining.

- [ ] **Step 5: Commit the stylesheet**

```bash
git add content.css
git commit -m "feat: follow traQ theme variables in ex-search"
```

### Task 3: Document and verify the integration

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the stylesheet behavior from Task 2.
- Produces: user-facing documentation of theme behavior and complete verification evidence.

- [ ] **Step 1: Document theme behavior**

Add a short UI note explaining that the traQ-page panel follows traQ's active
custom theme variables, while the standalone options page has its own theme.

- [ ] **Step 2: Run all tests and syntax checks**

Run:

```sh
npm test
npm run check
git diff --check HEAD~2..HEAD
```

Expected: all tests pass, all runtime JavaScript syntax checks pass, and Git
reports no whitespace errors.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff HEAD~2..HEAD -- content.css README.md content.css.test.js`

Confirm the only behavior change is theme-variable consumption and the options
page remains untouched.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: describe ex-search traQ theme support"
```
