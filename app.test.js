const assert = require('node:assert/strict')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const Core = require('./core.js')
const Dom = require('./dom.js')
const { createStorageAdapter, createExSearchApp } = require('./app.js')

const createChangeEvent = () => {
  const listeners = new Set()
  return {
    addListener: listener => listeners.add(listener),
    removeListener: listener => listeners.delete(listener),
    emit: (changes, area) => [...listeners].forEach(listener => listener(changes, area)),
    get size() { return listeners.size }
  }
}

function createFakeChrome({ sync = {}, local = {}, reject = {} } = {}) {
  const changed = createChangeEvent()
  const makeArea = (name, initial) => ({
    values: { ...initial },
    async get(defaults) {
      if (reject[`${name}Get`]) throw new Error(`${name} get failed`)
      const result = {}
      for (const [key, fallback] of Object.entries(defaults)) {
        result[key] = key in this.values ? this.values[key] : fallback
      }
      return result
    },
    async set(values) {
      if (reject[`${name}Set`]) throw new Error(`${name} set failed`)
      Object.assign(this.values, values)
    },
    async remove(key) {
      if (reject[`${name}Remove`]) throw new Error(`${name} remove failed`)
      delete this.values[key]
    }
  })
  return {
    chromeApi: {
      storage: {
        sync: makeArea('sync', sync),
        local: makeArea('local', local),
        onChanged: changed
      }
    },
    changed
  }
}

test('storage normalizes, truncates, records, clears, and publishes changes', async () => {
  const fake = createFakeChrome({
    local: { [Core.HISTORY_KEY]: ['one', 'two', 'three'] }
  })
  const adapter = createStorageAdapter(fake.chromeApi, { warn() {} })
  assert.deepEqual(await adapter.loadSettings(), Core.DEFAULT_SETTINGS)
  assert.deepEqual(await adapter.loadHistory(), ['one', 'two', 'three'])

  const saved = await adapter.saveSettings({ ...Core.DEFAULT_SETTINGS, historyLimit: 2 })
  assert.equal(saved.historyLimit, 2)
  assert.deepEqual(fake.chromeApi.storage.local.values[Core.HISTORY_KEY], ['one', 'two'])
  assert.deepEqual(await adapter.recordQuery(' new query ', 2), ['new query', 'one'])

  let published
  const unsubscribe = adapter.subscribeHistory(value => { published = value })
  fake.changed.emit({ [Core.HISTORY_KEY]: { newValue: ['changed'] } }, 'local')
  assert.deepEqual(published, ['changed'])
  unsubscribe()
  assert.equal(fake.changed.size, 0)

  await adapter.clearHistory()
  assert.deepEqual(await adapter.loadHistory(), [])
})

test('storage failures retain usable session-memory state and warn once per operation', async () => {
  const warnings = []
  const fake = createFakeChrome({
    reject: { syncGet: true, syncSet: true, localGet: true, localSet: true, localRemove: true }
  })
  const adapter = createStorageAdapter(fake.chromeApi, {
    warn: message => warnings.push(message)
  })
  assert.deepEqual(await adapter.loadSettings(), Core.DEFAULT_SETTINGS)
  assert.equal((await adapter.saveSettings({ historyLimit: 7 })).historyLimit, 7)
  assert.deepEqual(await adapter.recordQuery('offline query', 7), ['offline query'])
  assert.deepEqual(await adapter.clearHistory(), [])
  await adapter.loadSettings()
  assert.equal(adapter.isUsingFallback(), true)
  assert.ok(warnings.every(message => message.startsWith('ex-search:')))
  assert.equal(new Set(warnings).size, warnings.length)
})

class FakeObserver {
  static instances = []
  constructor(callback) {
    this.callback = callback
    this.disconnected = false
    this.observed = null
    FakeObserver.instances.push(this)
  }
  observe(target, options) { this.observed = { target, options } }
  disconnect() { this.disconnected = true }
}

function createScheduler() {
  const jobs = new Map()
  let nextId = 1
  return {
    setTimeout(callback) { const id = nextId++; jobs.set(id, callback); return id },
    clearTimeout(id) { jobs.delete(id) },
    flush() { const pending = [...jobs.values()]; jobs.clear(); pending.forEach(job => job()) },
    get size() { return jobs.size }
  }
}

function createMemoryStorage(settings = Core.DEFAULT_SETTINGS, history = []) {
  let currentSettings = Core.normalizeSettings(settings)
  let currentHistory = Core.normalizeHistory(history, currentSettings.historyLimit)
  const settingsListeners = new Set()
  const historyListeners = new Set()
  return {
    async loadSettings() { return { ...currentSettings } },
    async saveSettings(value) { currentSettings = Core.normalizeSettings(value); return { ...currentSettings } },
    async loadHistory() { return [...currentHistory] },
    async recordQuery(query, limit) {
      currentHistory = Core.recordHistory(currentHistory, query, limit)
      historyListeners.forEach(listener => listener([...currentHistory]))
      return [...currentHistory]
    },
    async clearHistory() { currentHistory = []; return [] },
    subscribeSettings(listener) { settingsListeners.add(listener); return () => settingsListeners.delete(listener) },
    subscribeHistory(listener) { historyListeners.add(listener); return () => historyListeners.delete(listener) },
    emitSettings(value) { currentSettings = Core.normalizeSettings(value); settingsListeners.forEach(listener => listener({ ...currentSettings })) },
    get history() { return [...currentHistory] }
  }
}

const searchFixture = () => new JSDOM(`
  <div id="palette">
    <div id="input-component"><div id="input-row"><input placeholder="メッセージを検索" value="release"></div><button aria-label="close"></button></div>
    <hr id="separator">
    <div class="_resultList_hash">
      <div class="_elementContainer_hash">release once</div>
      <div class="_elementContainer_hash">release release twice</div>
    </div>
  </div>
`, { url: 'https://q.trap.jp/channels/team/dev' })

test('app lifecycle mounts once, batches mutations, follows input replacement, and cleans up', async () => {
  FakeObserver.instances = []
  const dom = searchFixture()
  const scheduler = createScheduler()
  const storage = createMemoryStorage(Core.DEFAULT_SETTINGS, ['release notes'])
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    storage,
    MutationObserver: FakeObserver,
    setTimeout: callback => scheduler.setTimeout(callback),
    clearTimeout: id => scheduler.clearTimeout(id),
    logger: { warn() {}, error() {} },
    Core,
    Dom
  })

  await app.start()
  await app.start()
  const mountedPanel = dom.window.document.querySelector('[data-ex-search-panel]')
  assert.equal(dom.window.document.querySelectorAll('[data-ex-search-panel]').length, 1)
  assert.equal(mountedPanel.parentElement.id, 'palette')
  assert.equal(mountedPanel.previousElementSibling.id, 'separator')
  assert.equal(mountedPanel.parentElement.getAttribute('data-ex-search-host'), 'true')
  assert.equal(FakeObserver.instances.length, 1)
  for (let index = 0; index < 5; index += 1) FakeObserver.instances[0].callback([{ addedNodes: [] }])
  assert.equal(scheduler.size, 1)
  scheduler.flush()
  assert.equal(dom.window.document.querySelectorAll('[data-ex-search-panel]').length, 1)

  const replacement = dom.window.document.createElement('input')
  replacement.placeholder = 'メッセージを検索'
  replacement.value = 'new query'
  dom.window.document.querySelector('#input-row input').replaceWith(replacement)
  FakeObserver.instances[0].callback([{ addedNodes: [replacement] }])
  scheduler.flush()
  replacement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(storage.history[0], 'new query')

  app.stop()
  assert.equal(FakeObserver.instances[0].disconnected, true)
  assert.equal(dom.window.document.querySelector('[data-ex-search-panel]'), null)
  assert.equal(dom.window.document.querySelector('#palette').hasAttribute('data-ex-search-host'), false)
})

test('stop during asynchronous startup does not leave observers or subscriptions', async () => {
  FakeObserver.instances = []
  const dom = searchFixture()
  let resolveSettings
  let resolveHistory
  let subscriptions = 0
  const storage = {
    loadSettings: () => new Promise(resolve => { resolveSettings = resolve }),
    loadHistory: () => new Promise(resolve => { resolveHistory = resolve }),
    subscribeSettings() { subscriptions += 1; return () => { subscriptions -= 1 } },
    subscribeHistory() { subscriptions += 1; return () => { subscriptions -= 1 } }
  }
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    storage,
    MutationObserver: FakeObserver,
    logger: { warn() {}, error() {} },
    Core,
    Dom
  })

  const startup = app.start()
  app.stop()
  resolveSettings(Core.DEFAULT_SETTINGS)
  resolveHistory([])
  await startup

  assert.equal(FakeObserver.instances.length, 0)
  assert.equal(subscriptions, 0)
  assert.equal(dom.window.document.querySelector('[data-ex-search-panel]'), null)
})

test('panel suggestions, completion, filters, highlighting, and local ordering work together', async () => {
  FakeObserver.instances = []
  const dom = searchFixture()
  const scheduler = createScheduler()
  const storage = createMemoryStorage({
    ...Core.DEFAULT_SETTINGS,
    defaultOrdering: 'relevance'
  }, ['release notes', 'release train'])
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    storage,
    MutationObserver: FakeObserver,
    setTimeout: callback => scheduler.setTimeout(callback),
    clearTimeout: id => scheduler.clearTimeout(id),
    logger: { warn() {}, error() {} },
    Core,
    Dom
  })
  await app.start()
  const document = dom.window.document
  const input = document.querySelector('input[placeholder]')
  const buttons = [...document.querySelectorAll('[data-ex-search-suggestion]')]
  assert.ok(buttons.length > 0 && buttons.length <= 8)
  assert.equal(document.querySelector('[data-ex-search-completion]').textContent, ' notes')
  const ordering = document.querySelector('[data-ex-search-ordering]')
  assert.equal(ordering.value, 'relevance')
  ordering.value = 'native'
  ordering.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  assert.equal(document.querySelectorAll('[data-ex-search-local-score]').length, 0)
  ordering.value = 'relevance'
  ordering.dispatchEvent(new dom.window.Event('change', { bubbles: true }))

  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  assert.equal(input.value, 'release notes')
  input.value = 'hello custom:value in:#old'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  document.querySelector('[data-ex-search-filter="scope"]').value = 'in:here'
  document.querySelector('[data-ex-search-filter="author"]').value = 'from:me'
  document.querySelector('[data-ex-search-filter="target"]').value = 'to:me'
  document.querySelector('[data-ex-search-filter="content"]').value = 'has:image'
  document.querySelector('[data-ex-search-filter="after"]').value = '2026-09-01'
  document.querySelector('[data-ex-search-apply-filters]').click()
  assert.equal(input.value, 'hello custom:value in:here from:me to:me has:image after:2026-09-01')
  document.querySelector('[data-ex-search-reset-filters]').click()
  assert.equal(input.value, 'hello custom:value')

  input.value = 'release'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  assert.ok(document.querySelectorAll('mark[data-ex-search-highlight]').length > 0)
  assert.equal(document.querySelectorAll('[data-ex-search-local-score]').length, 2)

  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.equal(document.querySelector('[data-ex-search-suggestions]').hidden, true)

  storage.emitSettings({
    ...Core.DEFAULT_SETTINGS,
    suggestionsEnabled: false,
    completionEnabled: false,
    highlightingEnabled: false,
    defaultOrdering: 'native'
  })
  assert.equal(document.querySelector('[data-ex-search-suggestions]').hidden, true)
  assert.equal(document.querySelector('[data-ex-search-completion]').textContent, '')
  assert.equal(document.querySelectorAll('mark[data-ex-search-highlight]').length, 0)
  assert.equal(document.querySelectorAll('[data-ex-search-local-score]').length, 0)
  app.stop()
})
