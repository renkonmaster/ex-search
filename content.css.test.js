const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const css = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8')

test('hidden suggestions stay hidden despite their grid layout', () => {
  const dom = new JSDOM(`<style>${css}</style>
    <section data-ex-search-panel><div data-ex-search-suggestions hidden></div></section>`)
  const suggestions = dom.window.document.querySelector('[data-ex-search-suggestions]')
  assert.equal(dom.window.getComputedStyle(suggestions).display, 'none')
  suggestions.hidden = false
  assert.equal(dom.window.getComputedStyle(suggestions).display, 'grid')
  dom.window.close()
})

test('content styles consume traQ theme variables for visible color roles', () => {
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

  for (const variable of required) {
    assert.match(
      css,
      new RegExp(`var\\(\\s*${variable}`),
      `missing var(${variable}`
    )
  }

  assert.doesNotMatch(css, /border-color:\s*#4899f9;/)
  assert.doesNotMatch(css, /background:\s*#ffd84d;/)
  assert.doesNotMatch(css, /background:\s*#8a6500;/)
  assert.match(css, /data-ex-search-native-suggestion-hidden/)
  assert.match(css, /data-ex-search-native-sort-hidden/)
})

test('highlight marks read Markdown theme variables outside the panel scope', () => {
  const highlightRule = css.slice(css.indexOf("mark[data-ex-search-highlight='true']"))

  assert.match(highlightRule, /color:\s*var\(--markdown-mark-text/)
  assert.match(highlightRule, /background:\s*var\(--markdown-mark-background/)
})
