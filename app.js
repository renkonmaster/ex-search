;(function expose(globalObject, factory) {
  const core = globalObject.ExSearchCore ||
    (typeof require === 'function' ? require('./core.js') : null)
  const dom = globalObject.ExSearchDom ||
    (typeof require === 'function' ? require('./dom.js') : null)
  const api = factory(core, dom)
  globalObject.ExSearchApp = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(globalThis, (DefaultCore, DefaultDom) => {
  function createStorageAdapter(chromeApi, logger = console, Core = DefaultCore) {
    let sessionSettings = Core.normalizeSettings(Core.DEFAULT_SETTINGS)
    let sessionHistory = []
    let usingFallback = false
    const warned = new Set()

    const warnOnce = (code, message, error) => {
      usingFallback = true
      if (warned.has(code)) return
      warned.add(code)
      logger.warn(`ex-search: ${message}`, error)
    }

    async function loadSettings() {
      try {
        const stored = await chromeApi.storage.sync.get({
          [Core.SETTINGS_KEY]: Core.DEFAULT_SETTINGS
        })
        sessionSettings = Core.normalizeSettings(stored[Core.SETTINGS_KEY])
      } catch (error) {
        warnOnce('settings-read', '設定を読み込めないため、このタブ内の設定を使います', error)
      }
      return { ...sessionSettings }
    }

    async function loadHistory(limit = sessionSettings.historyLimit) {
      try {
        const stored = await chromeApi.storage.local.get({ [Core.HISTORY_KEY]: [] })
        sessionHistory = Core.normalizeHistory(stored[Core.HISTORY_KEY], limit)
      } catch (error) {
        warnOnce('history-read', '履歴を読み込めないため、このタブ内の履歴を使います', error)
        sessionHistory = Core.normalizeHistory(sessionHistory, limit)
      }
      return [...sessionHistory]
    }

    async function persistHistory(code = 'history-write') {
      try {
        await chromeApi.storage.local.set({ [Core.HISTORY_KEY]: [...sessionHistory] })
      } catch (error) {
        const message = code === 'history-truncate'
          ? '履歴上限をブラウザーへ反映できないため、このタブ内だけで反映します'
          : '履歴を保存できないため、このタブ内だけで保持します'
        warnOnce(code, message, error)
      }
      return [...sessionHistory]
    }

    async function saveSettings(value) {
      sessionSettings = Core.normalizeSettings(value)
      try {
        await chromeApi.storage.sync.set({ [Core.SETTINGS_KEY]: { ...sessionSettings } })
      } catch (error) {
        warnOnce('settings-write', '設定を保存できないため、このタブ内だけで反映します', error)
      }
      await loadHistory(sessionSettings.historyLimit)
      sessionHistory = Core.normalizeHistory(sessionHistory, sessionSettings.historyLimit)
      await persistHistory('history-truncate')
      return { ...sessionSettings }
    }

    async function recordQuery(query, limit = sessionSettings.historyLimit) {
      await loadHistory(limit)
      sessionHistory = Core.recordHistory(sessionHistory, query, limit)
      return persistHistory()
    }

    async function clearHistory() {
      sessionHistory = []
      try {
        await chromeApi.storage.local.remove(Core.HISTORY_KEY)
      } catch (error) {
        warnOnce('history-clear', '履歴を消去できないため、このタブ内だけで消去します', error)
      }
      return []
    }

    const subscribe = (key, areaName, normalize, listener) => {
      const event = chromeApi.storage.onChanged
      if (!event?.addListener) return () => {}
      const handler = (changes, changedArea) => {
        if (changedArea !== areaName || !Object.hasOwn(changes, key)) return
        listener(normalize(changes[key].newValue))
      }
      event.addListener(handler)
      return () => event.removeListener?.(handler)
    }

    return {
      loadSettings,
      saveSettings,
      loadHistory,
      recordQuery,
      clearHistory,
      subscribeSettings(listener) {
        return subscribe(Core.SETTINGS_KEY, 'sync', value => {
          sessionSettings = Core.normalizeSettings(value)
          return { ...sessionSettings }
        }, listener)
      },
      subscribeHistory(listener) {
        return subscribe(Core.HISTORY_KEY, 'local', value => {
          sessionHistory = Core.normalizeHistory(value, sessionSettings.historyLimit)
          return [...sessionHistory]
        }, listener)
      },
      isUsingFallback() { return usingFallback }
    }
  }

  const setData = (element, name, value = 'true') => {
    element.setAttribute(`data-ex-search-${name}`, value)
    return element
  }

  const appendLabeledControl = (document, parent, labelText, control) => {
    const label = setData(document.createElement('label'), 'filter-label')
    const text = setData(document.createElement('span'), 'filter-label-text')
    text.textContent = labelText
    label.append(text, control)
    parent.append(label)
  }

  function createPanel(document) {
    const panel = setData(document.createElement('section'), 'panel')
    panel.setAttribute('aria-label', 'ex-search 検索支援')

    const heading = document.createElement('div')
    setData(heading, 'heading')
    const title = setData(document.createElement('strong'), 'title')
    title.textContent = 'ex-search'
    const note = setData(document.createElement('span'), 'note')
    note.textContent = '候補と並び替えはローカル処理です'
    const orderingLabel = setData(document.createElement('label'), 'ordering-control')
    const orderingText = setData(document.createElement('span'), 'ordering-label')
    orderingText.textContent = '並び順'
    const ordering = setData(document.createElement('select'), 'ordering')
    for (const [value, text] of [['native', 'traQの順番'], ['relevance', '一致度順']]) {
      const option = setData(document.createElement('option'), 'ordering-option')
      option.value = value
      option.textContent = text
      ordering.append(option)
    }
    orderingLabel.append(orderingText, ordering)
    const serverOrderingLabel = setData(document.createElement('label'), 'server-ordering-control')
    const serverOrderingText = setData(document.createElement('span'), 'server-ordering-label')
    serverOrderingText.textContent = '検索結果の順番'
    const serverOrdering = setData(document.createElement('select'), 'server-ordering')
    for (const [value, text] of [
      ['createdAt', '新しい順'],
      ['-createdAt', '古い順'],
      ['updatedAt', '最近更新された順']
    ]) {
      const option = setData(document.createElement('option'), 'server-ordering-option')
      option.value = value
      option.textContent = text
      serverOrdering.append(option)
    }
    serverOrderingLabel.append(serverOrderingText, serverOrdering)
    heading.append(title, note, serverOrderingLabel, orderingLabel)

    const completion = setData(document.createElement('span'), 'completion')
    completion.setAttribute('aria-label', 'Tab補完候補')
    const suggestions = setData(document.createElement('div'), 'suggestions')
    suggestions.setAttribute('role', 'listbox')
    suggestions.setAttribute('aria-label', '検索候補')

    const historyDetails = setData(document.createElement('details'), 'history')
    const historySummary = setData(document.createElement('summary'), 'history-summary')
    historySummary.textContent = '検索履歴'
    const historyList = setData(document.createElement('div'), 'history-list')
    historyDetails.append(historySummary, historyList)

    const filters = document.createElement('details')
    setData(filters, 'filters')
    const summary = setData(document.createElement('summary'), 'filter-summary')
    summary.textContent = '検索条件をわかりやすく指定'
    const fields = setData(document.createElement('div'), 'filter-grid')

    const scope = setData(document.createElement('select'), 'filter', 'scope')
    for (const [value, text] of [['', '指定なし'], ['in:here', '現在のチャンネル']]) {
      const option = setData(document.createElement('option'), 'filter-option')
      option.value = value
      option.textContent = text
      scope.append(option)
    }
    appendLabeledControl(document, fields, '場所', scope)

    const author = setData(document.createElement('select'), 'filter', 'author')
    for (const [value, text] of [
      ['', '指定なし'], ['from:me', '自分の投稿'], ['is:bot', 'Botのみ'], ['not:bot', 'Bot以外']
    ]) {
      const option = setData(document.createElement('option'), 'filter-option')
      option.value = value
      option.textContent = text
      author.append(option)
    }
    appendLabeledControl(document, fields, '投稿者種別', author)

    const target = setData(document.createElement('select'), 'filter', 'target')
    for (const [value, text] of [['', '指定なし'], ['to:me', '自分宛て']]) {
      const option = setData(document.createElement('option'), 'filter-option')
      option.value = value
      option.textContent = text
      target.append(option)
    }
    appendLabeledControl(document, fields, '宛先', target)

    const content = setData(document.createElement('select'), 'filter', 'content')
    for (const [value, text] of [
      ['', '指定なし'], ['has:attachments', '添付あり'], ['has:image', '画像あり'],
      ['has:video', '動画あり'], ['has:audio', '音声あり']
    ]) {
      const option = setData(document.createElement('option'), 'filter-option')
      option.value = value
      option.textContent = text
      content.append(option)
    }
    appendLabeledControl(document, fields, '内容', content)

    for (const [name, labelText] of [['after', 'この日以降'], ['before', 'この日以前']]) {
      const date = setData(document.createElement('input'), 'filter', name)
      date.type = 'date'
      appendLabeledControl(document, fields, labelText, date)
    }

    const actions = setData(document.createElement('div'), 'filter-actions')
    const apply = setData(document.createElement('button'), 'apply-filters')
    apply.type = 'button'
    apply.textContent = '条件を反映'
    const reset = setData(document.createElement('button'), 'reset-filters')
    reset.type = 'button'
    reset.textContent = '条件を解除'
    actions.append(apply, reset)
    fields.append(actions)
    filters.append(summary, fields)

    const status = setData(document.createElement('p'), 'status')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    panel.append(heading, completion, suggestions, historyDetails, filters, status)
    return panel
  }

  function createExSearchApp(dependencies = {}) {
    const Core = dependencies.Core ?? DefaultCore
    const Dom = dependencies.Dom ?? DefaultDom
    const document = dependencies.document ?? globalThis.document
    const location = dependencies.location ?? globalThis.location
    const logger = dependencies.logger ?? console
    const Observer = dependencies.MutationObserver ?? document.defaultView?.MutationObserver
    const scheduleTimeout = dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis)
    const cancelTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis)
    let fallbackNotice = ''
    const storageLogger = {
      warn(message, error) {
        fallbackNotice = 'ブラウザー保存を利用できないため、このタブ内だけで動作しています。'
        logger.warn(message, error)
        updateStatus()
      }
    }
    const storage = dependencies.storage ?? createStorageAdapter(
      dependencies.chromeApi ?? globalThis.chrome,
      storageLogger,
      Core
    )

    let settings = Core.normalizeSettings(Core.DEFAULT_SETTINGS)
    let history = []
    let currentInput = null
    let panel = null
    let panelHost = null
    let observer = null
    let timer = null
    let started = false
    let lifecycleVersion = 0
    let suggestionsHidden = false
    let currentCompletion = ''
    let currentSuggestions = []
    let completionCycle = null
    let currentOrdering = settings.defaultOrdering
    let currentServerOrdering = 'createdAt'
    let pendingServerOrdering = null
    let nativeSortContainer = null
    let cleanInputListeners = () => {}
    let unsubscribeSettings = () => {}
    let unsubscribeHistory = () => {}
    let lastSignature = ''
    const cardIds = new WeakMap()
    let nextCardId = 1

    const updateStatus = message => {
      const status = panel?.querySelector('[data-ex-search-status]')
      if (status) status.textContent = [message, fallbackNotice].filter(Boolean).join(' ')
    }

    const cardId = card => {
      if (!cardIds.has(card)) cardIds.set(card, nextCardId++)
      return cardIds.get(card)
    }

    const reconcileNativeSearchUi = () => {
      const nativeSuggestion = Dom.findNativeSearchSuggestion(panel)
      const nativeSort = Dom.findNativeSortSelector(panel)
      const activeSuggestion = nativeSuggestion
      const activeSortContainer = nativeSort?.container ?? null

      for (const element of document.querySelectorAll(
        '[data-ex-search-native-suggestion-hidden]'
      )) {
        if (element !== activeSuggestion) {
          element.removeAttribute('data-ex-search-native-suggestion-hidden')
        }
      }
      for (const element of document.querySelectorAll(
        '[data-ex-search-native-sort-hidden]'
      )) {
        if (element !== activeSortContainer) {
          element.removeAttribute('data-ex-search-native-sort-hidden')
        }
      }

      if (activeSuggestion) {
        activeSuggestion.setAttribute('data-ex-search-native-suggestion-hidden', 'true')
      }
      if (activeSortContainer) {
        activeSortContainer.setAttribute('data-ex-search-native-sort-hidden', 'true')
      }
      if (panelHost) {
        if (activeSuggestion) {
          panelHost.setAttribute('data-ex-search-native-suggestion-layout', 'compact')
        } else {
          panelHost.removeAttribute('data-ex-search-native-suggestion-layout')
        }
      }

      if (activeSortContainer !== nativeSortContainer) {
        nativeSortContainer = activeSortContainer
        if (
          nativeSort &&
          Dom.readNativeSortValue(nativeSort) !== currentServerOrdering &&
          !pendingServerOrdering
        ) {
          pendingServerOrdering = currentServerOrdering
        }
      }
      return nativeSort
    }

    const restoreNativeSearchUi = () => {
      for (const element of document.querySelectorAll(
        '[data-ex-search-native-suggestion-hidden], [data-ex-search-native-sort-hidden]'
      )) {
        element.removeAttribute('data-ex-search-native-suggestion-hidden')
        element.removeAttribute('data-ex-search-native-sort-hidden')
      }
      panelHost?.removeAttribute('data-ex-search-native-suggestion-layout')
      nativeSortContainer = null
      pendingServerOrdering = null
    }

    const applyPendingServerOrdering = () => {
      if (!pendingServerOrdering || !panel) return
      const nativeSort = Dom.findNativeSortSelector(panel)
      if (!nativeSort) return
      if (Dom.readNativeSortValue(nativeSort) === pendingServerOrdering) {
        pendingServerOrdering = null
        return
      }

      nativeSort.valueContainer.click()
      const chooseOption = () => {
        const currentNativeSort = Dom.findNativeSortSelector(panel)
        const option = Dom.findNativeSortOption(
          currentNativeSort,
          pendingServerOrdering
        )
        if (!option) return
        option.click()
        pendingServerOrdering = null
      }
      chooseOption()
      scheduleTimeout(chooseOption, 0)
    }

    const stateSignature = (input, cards) => JSON.stringify({
      input: input?.value ?? '',
      settings,
      history,
      cards: cards.map(card => [cardId(card), card.textContent])
    })

    const renderSuggestions = suggestions => {
      if (!panel) return
      const container = panel.querySelector('[data-ex-search-suggestions]')
      container.replaceChildren()
      for (const suggestion of suggestions.slice(0, 8)) {
        const button = setData(document.createElement('button'), 'suggestion')
        button.type = 'button'
        button.setAttribute('role', 'option')
        const value = setData(document.createElement('span'), 'suggestion-value')
        value.textContent = suggestion.value
        const source = setData(document.createElement('small'), 'suggestion-source')
        source.textContent = {
          history: '履歴', context: '現在の画面', local: '表示中の結果'
        }[suggestion.source] ?? '候補'
        button.append(value, source)
        button.addEventListener('click', () => {
          Dom.setNativeInputValue(currentInput, suggestion.value)
          suggestionsHidden = false
          refresh()
          currentInput.focus()
        })
        container.append(button)
      }
      container.hidden = suggestionsHidden || !settings.suggestionsEnabled || suggestions.length === 0
      panel.querySelector('[data-ex-search-completion]').textContent = suggestionsHidden
        ? ''
        : currentCompletion
    }

    const renderHistory = () => {
      if (!panel) return
      const details = panel.querySelector('[data-ex-search-history]')
      const summary = panel.querySelector('[data-ex-search-history-summary]')
      const list = panel.querySelector('[data-ex-search-history-list]')
      const entries = history.slice(0, settings.historyLimit)
      summary.textContent = `検索履歴（${entries.length}件）`
      list.replaceChildren()
      for (const query of entries) {
        const button = setData(document.createElement('button'), 'history-entry')
        button.type = 'button'
        button.textContent = query
        button.addEventListener('click', () => {
          Dom.setNativeInputValue(currentInput, query)
          suggestionsHidden = false
          refresh()
          currentInput.focus()
        })
        list.append(button)
      }
      details.hidden = entries.length === 0
    }

    const refresh = () => {
      if (!currentInput || !panel) return
      const cards = Dom.findResultCards(document)
      const visibleTexts = cards.map(card => card.textContent ?? '')
      const frequentTerms = Core.extractFrequentTerms(visibleTexts, 8)
      if (completionCycle && (
        !settings.completionEnabled || currentInput.value !== completionCycle.value
      )) completionCycle = null
      currentSuggestions = completionCycle?.suggestions ?? (settings.suggestionsEnabled || settings.completionEnabled
        ? Core.rankSuggestions({
            input: currentInput.value,
            history,
            context: Core.buildContextCandidates(location.pathname),
            frequentTerms,
            limit: 8
          })
        : [])
      currentCompletion = completionCycle
        ? `候補 ${completionCycle.index + 1}/${completionCycle.values.length}（Tabで次へ）`
        : settings.completionEnabled
        ? Core.getCompletion(currentInput.value, currentSuggestions)
        : ''
      renderSuggestions(currentSuggestions)
      renderHistory()

      const terms = Core.extractSearchTerms(currentInput.value)
      for (const card of cards) {
        if (settings.highlightingEnabled) Dom.highlightTerms(card, terms)
        else Dom.unwrapHighlights(card)
      }
      Dom.applyResultOrder(cards, terms, currentOrdering)
      updateStatus(currentOrdering === 'relevance'
        ? '表示中の検索結果だけを関連度順に並べています。'
        : undefined)
      lastSignature = stateSignature(currentInput, cards)
    }

    const filterValues = () => {
      const get = name => panel.querySelector(`[data-ex-search-filter="${name}"]`).value.trim()
      return {
        scope: get('scope'),
        author: get('author'),
        target: get('target'),
        content: get('content'),
        after: get('after'),
        before: get('before')
      }
    }

    const clearFilterControls = () => {
      for (const control of panel.querySelectorAll('[data-ex-search-filter]')) control.value = ''
    }

    const mount = input => {
      currentInput = input
      panel = createPanel(document)
      panel.querySelector('[data-ex-search-ordering]').value = currentOrdering
      panel.querySelector('[data-ex-search-server-ordering]').value = currentServerOrdering
      let ancestor = input.parentElement
      let separator = null
      for (let depth = 0; ancestor?.parentElement && depth < 5; depth += 1) {
        const parent = ancestor.parentElement
        separator = [...parent.children].find(child => child.tagName === 'HR') ?? null
        if (separator) {
          panelHost = parent
          break
        }
        ancestor = parent
      }
      if (separator && panelHost) {
        separator.insertAdjacentElement('afterend', panel)
        panelHost.setAttribute('data-ex-search-host', 'true')
      } else {
        const anchor = input.parentElement ?? input
        anchor.insertAdjacentElement('afterend', panel)
        panelHost = panel.parentElement
      }
      reconcileNativeSearchUi()
      applyPendingServerOrdering()
      const cleanups = []
      const listen = (target, type, handler, options) => {
        target.addEventListener(type, handler, options)
        cleanups.push(() => target.removeEventListener(type, handler, options))
      }

      let composing = false
      let applyingCompletion = false
      const resetCompletionCycle = () => { completionCycle = null }
      listen(input, 'blur', resetCompletionCycle)
      listen(input, 'focus', () => { if (!completionCycle) refresh() })
      listen(input, 'click', () => {
        resetCompletionCycle()
        refresh()
      })
      listen(input, 'compositionstart', () => {
        composing = true
        resetCompletionCycle()
      })
      listen(input, 'compositionend', () => { composing = false })
      listen(input, 'input', () => {
        if (!applyingCompletion) resetCompletionCycle()
        suggestionsHidden = false
        refresh()
      })
      listen(input, 'keydown', event => {
        if (composing || event.isComposing || event.keyCode === 229) return
        if (
          event.key === 'Tab' && !event.shiftKey && !event.ctrlKey &&
          !event.altKey && !event.metaKey && !suggestionsHidden &&
          input.selectionStart === input.value.length &&
          input.selectionEnd === input.value.length &&
          settings.completionEnabled && currentSuggestions.length > 0
        ) {
          event.preventDefault()
          event.stopImmediatePropagation()
          if (!completionCycle) {
            const alternatives = currentSuggestions.filter(item => item.value !== input.value)
            completionCycle = {
              suggestions: currentSuggestions,
              values: (alternatives.length ? alternatives : currentSuggestions).map(item => item.value),
              index: -1,
              value: input.value
            }
          }
          completionCycle.index = (completionCycle.index + 1) % completionCycle.values.length
          completionCycle.value = completionCycle.values[completionCycle.index]
          applyingCompletion = true
          try {
            Dom.setNativeInputValue(input, completionCycle.value)
          } finally {
            applyingCompletion = false
          }
          input.focus({ preventScroll: true })
          input.setSelectionRange(input.value.length, input.value.length)
          suggestionsHidden = false
          refresh()
        } else if (event.key === 'Escape') {
          resetCompletionCycle()
          suggestionsHidden = true
          renderSuggestions(currentSuggestions)
        } else if (event.key === 'Enter' && !event.repeat && input.value.trim()) {
          resetCompletionCycle()
          void storage.recordQuery(input.value, settings.historyLimit).then(nextHistory => {
            history = Core.normalizeHistory(nextHistory, settings.historyLimit)
            refresh()
          }).catch(error => logger.warn('ex-search: 履歴を記録できませんでした', error))
        }
      }, true)

      listen(panel.querySelector('[data-ex-search-apply-filters]'), 'click', () => {
        Dom.setNativeInputValue(input, Core.applyOwnedFilters(input.value, filterValues()))
        refresh()
      })
      listen(panel.querySelector('[data-ex-search-reset-filters]'), 'click', () => {
        clearFilterControls()
        Dom.setNativeInputValue(input, Core.applyOwnedFilters(input.value, {}))
        refresh()
      })
      listen(panel.querySelector('[data-ex-search-ordering]'), 'change', event => {
        currentOrdering = event.currentTarget.value === 'relevance' ? 'relevance' : 'native'
        lastSignature = ''
        refresh()
      })
      listen(panel.querySelector('[data-ex-search-server-ordering]'), 'change', event => {
        const value = ['createdAt', '-createdAt', 'updatedAt'].includes(event.currentTarget.value)
          ? event.currentTarget.value
          : 'createdAt'
        currentServerOrdering = value
        pendingServerOrdering = value
        applyPendingServerOrdering()
      })
      cleanInputListeners = () => cleanups.splice(0).forEach(cleanup => cleanup())
      updateStatus()
    }

    const unmount = () => {
      cleanInputListeners()
      cleanInputListeners = () => {}
      restoreNativeSearchUi()
      if (panel?.parentNode) panel.parentNode.removeChild(panel)
      panelHost?.removeAttribute('data-ex-search-host')
      panel = null
      panelHost = null
      currentInput = null
      currentCompletion = ''
      currentSuggestions = []
      completionCycle = null
      lastSignature = ''
    }

    function reconcile() {
      if (!started) return
      const input = Dom.findSearchInput(document)
      if (!input) {
        if (currentInput) unmount()
        return
      }
      if (input !== currentInput) {
        unmount()
        mount(input)
      }
      reconcileNativeSearchUi()
      applyPendingServerOrdering()
      const cards = Dom.findResultCards(document)
      if (stateSignature(input, cards) === lastSignature) return
      refresh()
    }

    const scheduleReconcile = mutations => {
      const relevant = !mutations || mutations.some(mutation => {
        const targetPanel = mutation.target?.nodeType === 1
          ? mutation.target.closest?.('[data-ex-search-panel]')
          : mutation.target?.parentElement?.closest?.('[data-ex-search-panel]')
        if (targetPanel) return false
        const added = [...(mutation.addedNodes ?? [])]
        return added.length === 0 || added.some(node =>
          node.nodeType !== 1 || !node.hasAttribute?.('data-ex-search-panel')
        )
      })
      if (!relevant || timer !== null) return
      timer = scheduleTimeout(() => {
        timer = null
        reconcile()
      }, 50)
    }

    async function start() {
      if (started) return
      started = true
      const version = ++lifecycleVersion
      let loaded
      try {
        // Settings may arrive after history; defer applying the configured limit.
        loaded = await Promise.all([storage.loadSettings(), storage.loadHistory(100)])
      } catch (error) {
        if (version === lifecycleVersion) started = false
        throw error
      }
      if (!started || version !== lifecycleVersion) return
      ;[settings, history] = loaded
      settings = Core.normalizeSettings(settings)
      currentOrdering = settings.defaultOrdering
      history = Core.normalizeHistory(history, settings.historyLimit)
      unsubscribeSettings = storage.subscribeSettings(value => {
        settings = Core.normalizeSettings(value)
        currentOrdering = settings.defaultOrdering
        history = Core.normalizeHistory(history, settings.historyLimit)
        lastSignature = ''
        const ordering = panel?.querySelector('[data-ex-search-ordering]')
        if (ordering) ordering.value = currentOrdering
        refresh()
      })
      unsubscribeHistory = storage.subscribeHistory(value => {
        history = Core.normalizeHistory(value, settings.historyLimit)
        lastSignature = ''
        refresh()
      })
      if (Observer) {
        observer = new Observer(scheduleReconcile)
        observer.observe(document.documentElement, { childList: true, subtree: true })
      }
      reconcile()
    }

    function stop() {
      if (!started) return
      started = false
      lifecycleVersion += 1
      observer?.disconnect()
      observer = null
      unsubscribeSettings()
      unsubscribeHistory()
      unsubscribeSettings = () => {}
      unsubscribeHistory = () => {}
      if (timer !== null) cancelTimeout(timer)
      timer = null
      unmount()
      Dom.unwrapHighlights(document)
      Dom.applyResultOrder(Dom.findResultCards(document), [], 'native')
    }

    return { start, stop, reconcile }
  }

  return { createStorageAdapter, createExSearchApp }
})
