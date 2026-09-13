# ex-search traQ Theme Integration Design

## Goal

Make the ex-search UI rendered inside traQ use the active traQ theme, including
custom themes, without changing traQ or reading its internal Vue state.

## Design

`content.css` will consume the CSS custom properties that traQ_S-UI exposes on
the page. A small set of extension-scoped aliases will map panel backgrounds,
foregrounds, borders, accents, and Markdown highlighting to the corresponding
traQ variables. Fallback values will remain only for environments where the
variables are absent.

The extension will not copy the light/dark values from `defaultTheme.js`, use
the browser color scheme as a substitute for the traQ theme, or add JavaScript
that inspects Vue/theme state. The options page remains independently themed
because it is not rendered in the traQ document and cannot inherit its custom
theme variables.

## Mapping

- Panel background: `--theme-background-primary-default`
- Controls and borders: `--theme-background-secondary-default` and
  `--theme-background-secondary-border`
- Primary and secondary UI text: `--theme-ui-primary-default` and
  `--theme-ui-secondary-default`
- Hover/focus: `--theme-accent-primary-default` and
  `--theme-accent-primary-background`
- Search highlighting: `--markdown-mark-text` and
  `--markdown-mark-background`
- Native control color scheme: `--color-scheme`

## Verification

Automated tests will check that each color role is backed by the corresponding
traQ variable and that the old standalone active colors are not used. Existing
JavaScript tests and syntax checks must continue to pass.
