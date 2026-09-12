;(function expose(globalObject, factory) {
  const core = globalObject.ExSearchCore ||
    (typeof require === 'function' ? require('./core.js') : null)
  const app = globalObject.ExSearchApp ||
    (typeof require === 'function' ? require('./app.js') : null)
  const api = factory(core, app)
  globalObject.ExSearchOptions = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(globalThis, (Core, App) => {
  const controllers = new WeakMap()

  function createOptionsController({ document, storage, confirm = globalThis.confirm }) {
    if (controllers.has(document)) return controllers.get(document)
    const form = document.querySelector('#settings-form')
    const limit = document.querySelector('#history-limit')
    const suggestions = document.querySelector('#suggestions-enabled')
    const completion = document.querySelector('#completion-enabled')
    const highlighting = document.querySelector('#highlighting-enabled')
    const status = document.querySelector('#status')
    let startPromise = null

    const showStatus = (message, error = false) => {
      status.textContent = message
      status.dataset.error = String(error)
    }

    const writeForm = value => {
      const settings = Core.normalizeSettings(value)
      limit.value = String(settings.historyLimit)
      suggestions.checked = settings.suggestionsEnabled
      completion.checked = settings.completionEnabled
      highlighting.checked = settings.highlightingEnabled
      const ordering = form.querySelector(
        `[name="default-ordering"][value="${settings.defaultOrdering}"]`
      )
      if (ordering) ordering.checked = true
    }

    const readForm = () => {
      const historyLimit = Number(limit.value)
      if (!Number.isInteger(historyLimit) || historyLimit < 1 || historyLimit > 100) {
        throw new Error('履歴件数は1から100の整数で入力してください')
      }
      return {
        historyLimit,
        suggestionsEnabled: suggestions.checked,
        completionEnabled: completion.checked,
        highlightingEnabled: highlighting.checked,
        defaultOrdering: form.querySelector('[name="default-ordering"]:checked')?.value ?? 'native'
      }
    }

    form.addEventListener('submit', event => {
      event.preventDefault()
      void (async () => {
        try {
          const saved = await storage.saveSettings(readForm())
          writeForm(saved)
          showStatus('設定を保存しました')
        } catch (error) {
          showStatus(error instanceof Error ? error.message : '設定を保存できませんでした', true)
          limit.focus()
        }
      })()
    })

    document.querySelector('#reset-defaults').addEventListener('click', () => {
      writeForm(Core.DEFAULT_SETTINGS)
      showStatus('既定値をフォームへ戻しました。保存すると反映されます。')
    })

    document.querySelector('#clear-history').addEventListener('click', () => {
      if (typeof confirm === 'function' && !confirm('ex-searchの検索履歴をすべて消去しますか？')) return
      void storage.clearHistory().then(() => {
        showStatus('検索履歴を消去しました')
      }).catch(error => {
        showStatus(error instanceof Error ? error.message : '検索履歴を消去できませんでした', true)
      })
    })

    const controller = {
      start() {
        if (!startPromise) {
          startPromise = storage.loadSettings().then(settings => {
            writeForm(settings)
          }).catch(error => {
            writeForm(Core.DEFAULT_SETTINGS)
            showStatus(error instanceof Error ? error.message : '設定を読み込めませんでした', true)
          })
        }
        return startPromise
      },
      readForm,
      writeForm
    }
    controllers.set(document, controller)
    return controller
  }

  if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
    const storage = App.createStorageAdapter(chrome)
    void createOptionsController({ document, storage }).start()
  }

  return { createOptionsController }
})
