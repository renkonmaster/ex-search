const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const Core = require('./core.js')
require('./app.js')
const { createOptionsController } = require('./options.js')

const markup = readFileSync(path.join(__dirname, 'options.html'), 'utf8')
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(settings = Core.DEFAULT_SETTINGS) {
  const dom = new JSDOM(markup, { url: 'https://extension.invalid/options.html' })
  const saves = []
  let clearCalls = 0
  const storage = {
    async loadSettings() { return Core.normalizeSettings(settings) },
    async saveSettings(value) { const normalized = Core.normalizeSettings(value); saves.push(normalized); return normalized },
    async clearHistory() { clearCalls += 1; return [] }
  }
  const controller = createOptionsController({
    document: dom.window.document,
    storage,
    confirm: () => true
  })
  return { dom, controller, saves, get clearCalls() { return clearCalls } }
}

test('loads and persists the limit, feature switches, and ordering', async () => {
  const state = setup({
    historyLimit: 42,
    suggestionsEnabled: false,
    completionEnabled: true,
    highlightingEnabled: false,
    defaultOrdering: 'relevance'
  })
  await state.controller.start()
  const document = state.dom.window.document
  assert.equal(document.querySelector('#history-limit').value, '42')
  assert.equal(document.querySelector('#suggestions-enabled').checked, false)
  assert.equal(document.querySelector('[name="default-ordering"][value="relevance"]').checked, true)

  document.querySelector('#history-limit').value = '17'
  document.querySelector('#suggestions-enabled').checked = true
  document.querySelector('#completion-enabled').checked = false
  document.querySelector('#highlighting-enabled').checked = true
  document.querySelector('[name="default-ordering"][value="native"]').checked = true
  document.querySelector('#settings-form').dispatchEvent(new state.dom.window.Event('submit', {
    bubbles: true,
    cancelable: true
  }))
  await flush()
  assert.deepEqual(state.saves.at(-1), {
    historyLimit: 17,
    suggestionsEnabled: true,
    completionEnabled: false,
    highlightingEnabled: true,
    defaultOrdering: 'native'
  })
  assert.equal(document.querySelector('#status').textContent, '設定を保存しました')
})

test('rejects invalid limits without overwriting settings', async () => {
  const state = setup()
  await state.controller.start()
  const document = state.dom.window.document
  document.querySelector('#history-limit').value = '0'
  document.querySelector('#settings-form').dispatchEvent(new state.dom.window.Event('submit', {
    bubbles: true,
    cancelable: true
  }))
  await flush()
  assert.equal(state.saves.length, 0)
  assert.match(document.querySelector('#status').textContent, /1から100/u)
  assert.equal(document.querySelector('#status').dataset.error, 'true')
})

test('clears history only after confirmation', async () => {
  const state = setup()
  await state.controller.start()
  state.dom.window.document.querySelector('#clear-history').click()
  await flush()
  assert.equal(state.clearCalls, 1)
  assert.equal(state.dom.window.document.querySelector('#status').textContent, '検索履歴を消去しました')
})
