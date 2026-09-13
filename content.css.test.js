const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const css = fs.readFileSync(path.join(__dirname, 'content.css'), 'utf8')

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
})
