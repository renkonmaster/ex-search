;(function expose(globalObject, factory) {
  const api = factory()
  globalObject.ExSearchCore = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(globalThis, () => {
  const SETTINGS_KEY = 'exSearchSettingsV1'
  const HISTORY_KEY = 'exSearchHistoryV1'
  const DEFAULT_SETTINGS = Object.freeze({
    historyLimit: 20,
    suggestionsEnabled: true,
    completionEnabled: true,
    highlightingEnabled: true,
    defaultOrdering: 'native'
  })

  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
    'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
    'with', 'から', 'これ', 'して', 'する', 'その', 'ため', 'です', 'ます'
  ])

  const normalizeLimit = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_SETTINGS.historyLimit
    }
    return Math.min(100, Math.max(1, Math.floor(value)))
  }

  const cleanQuery = value => splitQuery(value).join(' ')

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {}
    return {
      historyLimit: normalizeLimit(source.historyLimit),
      suggestionsEnabled: typeof source.suggestionsEnabled === 'boolean'
        ? source.suggestionsEnabled
        : DEFAULT_SETTINGS.suggestionsEnabled,
      completionEnabled: typeof source.completionEnabled === 'boolean'
        ? source.completionEnabled
        : DEFAULT_SETTINGS.completionEnabled,
      highlightingEnabled: typeof source.highlightingEnabled === 'boolean'
        ? source.highlightingEnabled
        : DEFAULT_SETTINGS.highlightingEnabled,
      defaultOrdering: source.defaultOrdering === 'relevance'
        ? 'relevance'
        : 'native'
    }
  }

  function normalizeHistory(value, limit = DEFAULT_SETTINGS.historyLimit) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const result = []
    for (const item of value) {
      if (typeof item !== 'string') continue
      const query = cleanQuery(item)
      const key = query.toLocaleLowerCase()
      if (!query || seen.has(key)) continue
      seen.add(key)
      result.push(query)
      if (result.length >= normalizeLimit(limit)) break
    }
    return result
  }

  function recordHistory(history, query, limit = DEFAULT_SETTINGS.historyLimit) {
    const value = cleanQuery(query)
    if (!value) return normalizeHistory(history, limit)
    return normalizeHistory([value, ...(Array.isArray(history) ? history : [])], limit)
  }

  function splitQuery(query) {
    const source = String(query ?? '')
    const tokens = []
    let token = ''
    let quoted = false
    let escaped = false

    for (const character of source) {
      if (escaped) {
        token += character
        escaped = false
        continue
      }
      if (character === '\\' && quoted) {
        token += character
        escaped = true
        continue
      }
      if (character === '"') {
        token += character
        quoted = !quoted
        continue
      }
      if (/\s/u.test(character) && !quoted) {
        if (token) tokens.push(token)
        token = ''
        continue
      }
      token += character
    }
    if (token) tokens.push(token)
    return tokens
  }

  const ownedFamily = token => {
    const value = token.toLocaleLowerCase()
    if (/^#[^\s]+$/u.test(value) || /^in:[^\s]+$/u.test(value)) return 'scope'
    if (
      /^(?:from|by):[^\s]+$/u.test(value) ||
      value === 'is:bot' || value === 'not:bot'
    ) return 'author'
    if (/^@[^\s]+$/u.test(value) || /^to:[^\s]+$/u.test(value)) return 'target'
    if (/^has:(?:attachments|image|video|audio)$/u.test(value)) return 'content'
    if (/^(?:after|since):[^\s]+$/u.test(value)) return 'after'
    if (/^(?:before|until):[^\s]+$/u.test(value)) return 'before'
    return null
  }

  const FILTER_VALIDATORS = Object.freeze({
    scope: /^in:(?:here|#[^\s]+)$/iu,
    author: /^(?:(?:from|by):[^\s]+|is:bot|not:bot)$/iu,
    target: /^to:@?[^\s]+$/iu,
    content: /^has:(?:attachments|image|video|audio)$/iu,
    after: /^after:\d{4}-\d{2}-\d{2}$/u,
    before: /^before:\d{4}-\d{2}-\d{2}$/u
  })

  function applyOwnedFilters(query, values = {}) {
    const preserved = splitQuery(query).filter(token => !ownedFamily(token))
    for (const key of ['scope', 'author', 'target', 'content', 'after', 'before']) {
      const value = cleanQuery(values[key])
      const token = (key === 'after' || key === 'before') && /^\d{4}-\d{2}-\d{2}$/u.test(value)
        ? `${key}:${value}`
        : value
      if (token && FILTER_VALIDATORS[key].test(token)) preserved.push(token)
    }
    return preserved.join(' ')
  }

  const trimTerm = value => String(value)
    .replace(/^[\s"'“”‘’()[\]{}<>.,!?;:、。！？・]+/u, '')
    .replace(/[\s"'“”‘’()[\]{}<>.,!?;:、。！？・]+$/u, '')

  function extractSearchTerms(query) {
    const terms = []
    const seen = new Set()
    for (const rawToken of splitQuery(query)) {
      if (/^https?:\/\//iu.test(rawToken)) continue
      if (ownedFamily(rawToken) || /^[^\s:]+:[^\s]+$/u.test(rawToken)) continue
      if (/^[#@]/u.test(rawToken)) continue

      const quoted = rawToken.length >= 2 && rawToken.startsWith('"') && rawToken.endsWith('"')
      const term = trimTerm(quoted ? rawToken.slice(1, -1) : rawToken)
      const key = term.toLocaleLowerCase()
      if (Array.from(term).length < 2 || STOP_WORDS.has(key) || seen.has(key)) continue
      seen.add(key)
      terms.push(term)
    }
    return terms
  }

  const defaultSegmenter = (() => {
    try {
      return typeof Intl?.Segmenter === 'function'
        ? new Intl.Segmenter('ja', { granularity: 'word' })
        : null
    } catch {
      return null
    }
  })()

  function extractFrequentTerms(texts, limit = 8, segmenter = defaultSegmenter) {
    const entries = new Map()
    let occurrence = 0
    for (const text of Array.isArray(texts) ? texts : []) {
      let pieces
      if (segmenter && typeof segmenter.segment === 'function') {
        pieces = [...segmenter.segment(String(text ?? ''))]
          .filter(part => part.isWordLike !== false)
          .map(part => part.segment)
      } else {
        pieces = String(text ?? '').split(/[\s,、。！？!?()[\]{}<>]+/u)
      }
      for (const piece of pieces) {
        for (const term of extractSearchTerms(piece)) {
          const key = term.toLocaleLowerCase()
          const existing = entries.get(key)
          if (existing) existing.count += 1
          else entries.set(key, { term, count: 1, first: occurrence })
          occurrence += 1
        }
      }
    }
    return [...entries.values()]
      .sort((left, right) => right.count - left.count || left.first - right.first)
      .slice(0, Math.max(0, Math.floor(Number(limit) || 0)))
      .map(({ term, count }) => ({ term, count }))
  }

  function buildContextCandidates(pathname) {
    const path = String(pathname ?? '').split(/[?#]/u, 1)[0]
    if (/^\/channels(?:\/|$)/u.test(path)) return ['in:here']
    const user = path.match(/^\/users\/([^/]+)\/?$/u)
    if (!user) return []
    try {
      const name = decodeURIComponent(user[1])
      return name && !/\s/u.test(name) ? [`from:${name}`] : []
    } catch {
      return []
    }
  }

  const matchScore = (candidate, input) => {
    if (!input) return 400
    if (candidate === input) return 1200
    if (candidate.startsWith(input)) return 1000
    if (candidate.split(/\s+/u).some(token => token.startsWith(input))) return 800
    if (candidate.includes(input)) return 600
    return -1
  }

  function rankSuggestions({
    input = '', history = [], context = [], frequentTerms = [], limit = 8
  } = {}) {
    const query = cleanQuery(input).toLocaleLowerCase()
    const candidates = []
    history.forEach((value, index) => candidates.push({ value, source: 'history', index, weight: 0 }))
    context.forEach((value, index) => candidates.push({ value, source: 'context', index, weight: 0 }))
    frequentTerms.forEach((entry, index) => {
      const value = typeof entry === 'string' ? entry : entry?.term
      candidates.push({ value, source: 'local', index, weight: Number(entry?.count) || 0 })
    })

    const sourceBonus = { history: 120, context: 80, local: 40 }
    const seen = new Set()
    return candidates
      .filter(candidate => typeof candidate.value === 'string' && cleanQuery(candidate.value))
      .map(candidate => ({ ...candidate, value: cleanQuery(candidate.value) }))
      .filter(candidate => {
        const key = candidate.value.toLocaleLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        candidate.key = key
        return true
      })
      .map(candidate => ({ ...candidate, match: matchScore(candidate.key, query) }))
      .filter(candidate => candidate.match >= 0)
      .map(candidate => ({
        ...candidate,
        score: candidate.match + sourceBonus[candidate.source] + candidate.weight
      }))
      .sort((left, right) =>
        right.score - left.score ||
        left.index - right.index ||
        left.value.localeCompare(right.value, 'ja')
      )
      .slice(0, Math.min(8, Math.max(0, Math.floor(Number(limit) || 0))))
      .map(({ value, source, score }) => ({ value, source, score }))
  }

  function getCompletion(input, suggestions) {
    const value = String(input ?? '')
    if (!value) return ''
    const lower = value.toLocaleLowerCase()
    const candidate = (Array.isArray(suggestions) ? suggestions : [])
      .find(item => typeof item?.value === 'string' &&
        item.value.length > value.length &&
        item.value.toLocaleLowerCase().startsWith(lower))
    return candidate ? candidate.value.slice(value.length) : ''
  }

  return {
    SETTINGS_KEY,
    HISTORY_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    normalizeHistory,
    recordHistory,
    splitQuery,
    applyOwnedFilters,
    extractSearchTerms,
    extractFrequentTerms,
    buildContextCandidates,
    rankSuggestions,
    getCompletion
  }
})
