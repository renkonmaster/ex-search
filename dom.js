;(function expose(globalObject, factory) {
  const api = factory()
  globalObject.ExSearchDom = api
  if (typeof module === 'object' && module.exports) module.exports = api
})(globalThis, () => {
  const SEARCH_INPUT_SELECTOR = 'input[placeholder="メッセージを検索"]'
  const HIGHLIGHT_SELECTOR = 'mark[data-ex-search-highlight="true"]'
  const SKIPPED_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SCRIPT', 'STYLE', 'CODE'
  ])

  const includingRoot = (root, selector) => {
    const matches = []
    if (root?.nodeType === 1 && root.matches(selector)) matches.push(root)
    if (typeof root?.querySelectorAll === 'function') matches.push(...root.querySelectorAll(selector))
    return matches
  }

  const isVisible = element => {
    if (!element?.isConnected || element.hidden) return false
    const view = element.ownerDocument?.defaultView
    for (let current = element; current?.nodeType === 1; current = current.parentElement) {
      if (current.hidden) return false
      const style = view?.getComputedStyle(current)
      if (style?.display === 'none' || style?.visibility === 'hidden') return false
    }
    return true
  }

  function findSearchInput(root) {
    return includingRoot(root, SEARCH_INPUT_SELECTOR).filter(isVisible).at(-1) ?? null
  }

  function setNativeInputValue(input, value) {
    let prototype = input
    let descriptor
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'value')
      prototype = Object.getPrototypeOf(prototype)
    }
    if (typeof descriptor?.set === 'function') descriptor.set.call(input, String(value ?? ''))
    else input.value = String(value ?? '')

    const EventConstructor = input.ownerDocument.defaultView.Event
    input.dispatchEvent(new EventConstructor('input', { bubbles: true, composed: true }))
    input.dispatchEvent(new EventConstructor('change', { bubbles: true, composed: true }))
  }

  const hasClassPrefix = (element, prefix) =>
    [...(element?.classList ?? [])].some(name => name.startsWith(prefix))

  function findResultCards(root) {
    const lists = includingRoot(
      root,
      '[data-ex-search-native-results], [class*="_resultList_"]'
    ).filter(element =>
      element.hasAttribute('data-ex-search-native-results') ||
      hasClassPrefix(element, '_resultList_')
    )
    const list = lists.filter(isVisible).at(-1) ?? lists.at(-1)
    if (!list) return []
    return [...list.children].filter(child =>
      child.nodeType === 1 && (
        list.hasAttribute('data-ex-search-native-results') ||
        hasClassPrefix(child, '_elementContainer_')
      )
    )
  }

  const hasExtensionAttribute = element =>
    [...(element?.attributes ?? [])].some(attribute =>
      attribute.name.startsWith('data-ex-search-') &&
      attribute.name !== 'data-ex-search-local-score' &&
      attribute.name !== 'data-ex-search-relevance-list' &&
      attribute.name !== 'data-ex-search-native-results'
    )

  const shouldSkipText = (node, boundary, skipHighlight = true) => {
    for (let element = node.parentElement; element && element !== boundary.parentElement; element = element.parentElement) {
      if (SKIPPED_TAGS.has(element.tagName)) return true
      if (skipHighlight && element.matches?.(HIGHLIGHT_SELECTOR)) return true
      if (hasExtensionAttribute(element) && !element.matches?.(HIGHLIGHT_SELECTOR)) return true
      if (element === boundary) break
    }
    return false
  }

  const textNodes = (root, skipHighlight = true) => {
    const document = root.ownerDocument ?? root
    const view = document.defaultView
    const walker = document.createTreeWalker(
      root,
      view.NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return node.nodeValue && !shouldSkipText(node, root, skipHighlight)
            ? view.NodeFilter.FILTER_ACCEPT
            : view.NodeFilter.FILTER_REJECT
        }
      }
    )
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    return nodes
  }

  function unwrapHighlights(root) {
    const marks = includingRoot(root, HIGHLIGHT_SELECTOR)
    const parents = new Set()
    for (const mark of marks) {
      const parent = mark.parentNode
      if (!parent) continue
      parents.add(parent)
      parent.replaceChild(mark.ownerDocument.createTextNode(mark.textContent ?? ''), mark)
    }
    for (const parent of parents) parent.normalize()
    return marks.length
  }

  const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

  function highlightTerms(root, values) {
    unwrapHighlights(root)
    const seen = new Set()
    const terms = []
    for (const raw of Array.isArray(values) ? values : []) {
      const value = String(raw ?? '').trim()
      const key = value.toLocaleLowerCase()
      if (!value || seen.has(key)) continue
      seen.add(key)
      terms.push(value)
    }
    terms.sort((left, right) => right.length - left.length)
    if (terms.length === 0) return 0

    const expression = new RegExp(terms.map(escapeRegExp).join('|'), 'giu')
    let count = 0
    for (const node of textNodes(root)) {
      const source = node.nodeValue
      expression.lastIndex = 0
      if (!expression.test(source)) continue
      expression.lastIndex = 0
      const fragment = node.ownerDocument.createDocumentFragment()
      let cursor = 0
      for (const match of source.matchAll(expression)) {
        if (match.index > cursor) fragment.append(source.slice(cursor, match.index))
        const mark = node.ownerDocument.createElement('mark')
        mark.setAttribute('data-ex-search-highlight', 'true')
        mark.textContent = match[0]
        fragment.append(mark)
        cursor = match.index + match[0].length
        count += 1
      }
      if (cursor < source.length) fragment.append(source.slice(cursor))
      node.replaceWith(fragment)
    }
    return count
  }

  const eligibleText = root => textNodes(root, false).map(node => node.nodeValue).join(' ')

  function scoreResultCard(card, values) {
    const text = eligibleText(card).toLocaleLowerCase()
    let score = 0
    const seen = new Set()
    for (const raw of Array.isArray(values) ? values : []) {
      const term = String(raw ?? '').trim().toLocaleLowerCase()
      if (!term || seen.has(term)) continue
      seen.add(term)
      let cursor = 0
      while ((cursor = text.indexOf(term, cursor)) !== -1) {
        score += 1
        cursor += Math.max(1, term.length)
      }
    }
    return score
  }

  function applyResultOrder(cards, terms, mode) {
    const values = Array.isArray(cards) ? cards : []
    if (mode !== 'relevance') {
      for (const card of values) {
        card.style.removeProperty('order')
        card.removeAttribute('data-ex-search-local-score')
      }
      for (const parent of new Set(values.map(card => card.parentElement).filter(Boolean))) {
        parent.removeAttribute('data-ex-search-relevance-list')
      }
      return values
    }

    const ranked = values.map((card, index) => ({
      card,
      index,
      score: scoreResultCard(card, terms)
    })).sort((left, right) => right.score - left.score || left.index - right.index)

    for (const [order, entry] of ranked.entries()) {
      entry.card.style.order = String(order)
      entry.card.setAttribute('data-ex-search-local-score', String(entry.score))
      entry.card.parentElement?.setAttribute('data-ex-search-relevance-list', 'true')
    }
    return ranked.map(entry => entry.card)
  }

  return {
    findSearchInput,
    setNativeInputValue,
    findResultCards,
    unwrapHighlights,
    highlightTerms,
    scoreResultCard,
    applyResultOrder
  }
})
