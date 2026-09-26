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

test('startup loads the configured history above 20 even when settings arrive later', async () => {
  const dom = searchFixture()
  const queries = Array.from({ length: 60 }, (_, index) => `query ${index}`)
  const fake = createFakeChrome({ local: { [Core.HISTORY_KEY]: queries } })
  let resolveSettings
  fake.chromeApi.storage.sync.get = () => new Promise(resolve => { resolveSettings = resolve })
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    chromeApi: fake.chromeApi,
    MutationObserver: FakeObserver
  })
  const startup = app.start()
  await Promise.resolve()
  resolveSettings({ [Core.SETTINGS_KEY]: { ...Core.DEFAULT_SETTINGS, historyLimit: 50 } })
  await startup
  assert.equal(dom.window.document.querySelectorAll('[data-ex-search-history-entry]').length, 50)
  app.stop()
})

test('IME confirmation and repeated Enter do not record a search', async () => {
  const dom = searchFixture()
  const storage = createMemoryStorage(Core.DEFAULT_SETTINGS, ['release notes'])
  const app = createExSearchApp({
    document: dom.window.document, location: dom.window.location,
    storage, MutationObserver: FakeObserver
  })
  await app.start()
  const input = dom.window.document.querySelector('input[placeholder]')
  const key = options => {
    const event = new dom.window.KeyboardEvent('keydown', {
      bubbles: true, cancelable: true, ...options
    })
    input.dispatchEvent(event)
    assert.equal(event.defaultPrevented, false)
  }
  input.dispatchEvent(new dom.window.CompositionEvent('compositionstart'))
  key({ key: 'Enter' })
  key({ key: 'Tab' })
  assert.equal(input.value, 'release')
  input.dispatchEvent(new dom.window.CompositionEvent('compositionend'))
  key({ key: 'Enter', isComposing: true })
  key({ key: 'Enter', keyCode: 229 })
  key({ key: 'Enter', repeat: true })
  await Promise.resolve()
  assert.deepEqual(storage.history, ['release notes'])
  key({ key: 'Enter' })
  await Promise.resolve()
  assert.deepEqual(storage.history, ['release', 'release notes'])
  app.stop()
})

test('Tab cycles through a stable set of candidates without moving focus or leaking to traQ', async () => {
  const dom = searchFixture()
  const document = dom.window.document
  document.querySelector('._resultList_hash').remove()
  const storage = createMemoryStorage(Core.DEFAULT_SETTINGS, ['release notes', 'release train'])
  const app = createExSearchApp({
    document, location: dom.window.location, storage, MutationObserver: FakeObserver
  })
  await app.start()
  const input = document.querySelector('input[placeholder]')
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  let nativeKeydowns = 0
  input.addEventListener('keydown', () => { nativeKeydowns += 1 })
  const tab = () => {
    const event = new dom.window.KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true
    })
    input.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(document.activeElement, input)
    assert.equal(input.selectionStart, input.value.length)
    assert.equal(input.selectionEnd, input.value.length)
  }
  tab()
  assert.equal(input.value, 'release notes')
  app.reconcile()
  tab()
  assert.equal(input.value, 'release train')
  tab()
  assert.equal(input.value, 'release notes')
  assert.equal(nativeKeydowns, 0)
  assert.equal(document.querySelectorAll('[data-ex-search-suggestion]').length, 2)

  input.value = 'release t'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  tab()
  assert.equal(input.value, 'release train')
  tab()
  assert.equal(input.value, 'release train')

  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }))
  await Promise.resolve()
  assert.equal(storage.history[0], 'release train')
  app.stop()
})

test('Tab can select non-prefix suggestions and resets the cycle after focus leaves', async () => {
  const dom = searchFixture()
  const document = dom.window.document
  document.querySelector('._resultList_hash').remove()
  const storage = createMemoryStorage(Core.DEFAULT_SETTINGS, ['weekly release', 'old release'])
  const app = createExSearchApp({
    document, location: dom.window.location, storage, MutationObserver: FakeObserver
  })
  await app.start()
  const input = document.querySelector('input[placeholder]')
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  const tab = () => input.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true
  }))
  assert.equal(tab(), false)
  assert.equal(input.value, 'weekly release')
  input.blur()
  input.focus()
  assert.equal(tab(), false)
  assert.equal(input.value, 'weekly release')
  app.stop()
})

test('completion works with suggestions hidden and respects editing and keyboard navigation', async () => {
  const dom = searchFixture()
  const storage = createMemoryStorage({
    ...Core.DEFAULT_SETTINGS, suggestionsEnabled: false
  }, ['release notes'])
  const app = createExSearchApp({
    document: dom.window.document, location: dom.window.location,
    storage, MutationObserver: FakeObserver
  })
  await app.start()
  const document = dom.window.document
  const input = document.querySelector('input[placeholder]')
  const tab = options => {
    const event = new dom.window.KeyboardEvent('keydown', {
      key: 'Tab', bubbles: true, cancelable: true, ...options
    })
    input.dispatchEvent(event)
    return event.defaultPrevented
  }
  assert.equal(document.querySelector('[data-ex-search-suggestions]').hidden, true)
  assert.equal(document.querySelector('[data-ex-search-completion]').textContent, ' notes')
  input.setSelectionRange(7, 7)
  for (const modifier of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) {
    assert.equal(tab({ [modifier]: true }), false)
  }
  input.setSelectionRange(2, 2)
  assert.equal(tab(), false)
  input.setSelectionRange(0, 7)
  assert.equal(tab(), false)
  input.setSelectionRange(7, 7)
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(document.querySelector('[data-ex-search-completion]').textContent, '')
  assert.equal(tab(), false)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  assert.equal(tab(), true)
  assert.equal(input.value, 'release notes')
  app.stop()
})

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
  for (const element of mountedPanel.querySelectorAll('*')) {
    assert.ok(
      [...element.attributes].some(attribute => attribute.name.startsWith('data-ex-search-')),
      element.outerHTML
    )
  }
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

test('hides native search suggestions and restores them when stopped', async () => {
  FakeObserver.instances = []
  const dom = new JSDOM(`
    <div id="palette">
      <div id="input-component"><div id="input-row"><input placeholder="メッセージを検索"></div></div>
      <hr id="separator">
      <div id="native-suggestion"><div class="_header_hash">検索オプション</div></div>
    </div>
  `, { url: 'https://q.trap.jp/channels/team/dev' })
  const storage = createMemoryStorage()
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    storage,
    MutationObserver: FakeObserver,
    logger: { warn() {}, error() {} },
    Core,
    Dom
  })

  await app.start()
  const document = dom.window.document
  const nativeSuggestion = document.querySelector('#native-suggestion')
  assert.equal(nativeSuggestion.dataset.exSearchNativeSuggestionHidden, 'true')
  assert.equal(document.querySelector('#palette').dataset.exSearchNativeSuggestionLayout, 'compact')

  app.stop()
  assert.equal(nativeSuggestion.hasAttribute('data-ex-search-native-suggestion-hidden'), false)
  assert.equal(document.querySelector('#palette').hasAttribute('data-ex-search-native-suggestion-layout'), false)
})

test('owns server sort choices while forwarding them to the hidden native selector', async () => {
  FakeObserver.instances = []
  const dom = new JSDOM(`
    <div id="palette">
      <div id="input-component"><div id="input-row"><input placeholder="メッセージを検索" value="release"></div></div>
      <hr id="separator">
      <div id="native-result">
        <div id="native-sort" class="_container_hash">
          <div class="_valueContainer_hash">新しい順</div>
          <div class="_selectorContainer_hash">
            <div class="_itemContainer_hash">新しい順</div>
            <div class="_itemContainer_hash">古い順</div>
            <div class="_itemContainer_hash">最近更新された順</div>
          </div>
        </div>
        <div class="_resultList_hash">
          <div class="_elementContainer_hash">release once</div>
        </div>
      </div>
    </div>
  `, { url: 'https://q.trap.jp/channels/team/dev' })
  const clicked = []
  for (const item of dom.window.document.querySelectorAll('._itemContainer_hash')) {
    item.addEventListener('click', () => clicked.push(item.textContent.trim()))
  }
  const scheduler = createScheduler()
  const app = createExSearchApp({
    document: dom.window.document,
    location: dom.window.location,
    storage: createMemoryStorage(),
    MutationObserver: FakeObserver,
    setTimeout: callback => scheduler.setTimeout(callback),
    clearTimeout: id => scheduler.clearTimeout(id),
    logger: { warn() {}, error() {} },
    Core,
    Dom
  })

  await app.start()
  const document = dom.window.document
  const nativeSort = document.querySelector('#native-sort')
  const serverOrdering = document.querySelector('[data-ex-search-server-ordering]')
  assert.equal(nativeSort.dataset.exSearchNativeSortHidden, 'true')
  assert.deepEqual([...serverOrdering.options].map(option => option.textContent), [
    '新しい順', '古い順', '最近更新された順'
  ])

  serverOrdering.value = '-createdAt'
  serverOrdering.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  scheduler.flush()
  assert.deepEqual(clicked, ['古い順'])

  app.stop()
  assert.equal(nativeSort.hasAttribute('data-ex-search-native-sort-hidden'), false)
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
  }, [
    'release notes', 'release train', '障害対応', 'weekly report',
    'from:me update', 'has:image design', 'after:2026-09-01 roadmap'
  ])
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
  const historyEntries = [...document.querySelectorAll('[data-ex-search-history-entry]')]
  assert.equal(historyEntries.length, 7)
  assert.ok(historyEntries.length > 5)
  assert.equal(document.querySelector('[data-ex-search-completion]').textContent, ' notes')
  const ordering = document.querySelector('[data-ex-search-ordering]')
  assert.equal(ordering.value, 'relevance')
  ordering.value = 'native'
  ordering.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  assert.equal(document.querySelectorAll('[data-ex-search-local-score]').length, 0)
  ordering.value = 'relevance'
  ordering.dispatchEvent(new dom.window.Event('change', { bubbles: true }))

  historyEntries.at(-1).click()
  assert.equal(input.value, 'after:2026-09-01 roadmap')
  input.value = 'release'
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))

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
