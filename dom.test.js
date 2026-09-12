const assert = require('node:assert/strict')
const test = require('node:test')
const { JSDOM } = require('jsdom')

const {
  findSearchInput,
  setNativeInputValue,
  findResultCards,
  unwrapHighlights,
  highlightTerms,
  scoreResultCard,
  applyResultOrder
} = require('./dom.js')

test('finds the last visible native message-search input', () => {
  const dom = new JSDOM(`
    <input placeholder="メッセージを検索" style="display:none">
    <input id="first" placeholder="メッセージを検索">
    <div><input id="active" placeholder="メッセージを検索"></div>
  `)
  assert.equal(findSearchInput(dom.window.document).id, 'active')
  assert.equal(findSearchInput(dom.window.document).id, 'active')
})

test('sets native input value and dispatches bubbling input and change events', () => {
  const dom = new JSDOM('<form><input></form>')
  const input = dom.window.document.querySelector('input')
  const events = []
  input.parentElement.addEventListener('input', event => events.push([event.type, event.bubbles]))
  input.parentElement.addEventListener('change', event => events.push([event.type, event.bubbles]))

  setNativeInputValue(input, '障害対応')

  assert.equal(input.value, '障害対応')
  assert.deepEqual(events, [['input', true], ['change', true]])
})

test('highlights literal eligible text safely and unwraps losslessly', () => {
  const dom = new JSDOM(`<div id="card">障害とfoo+bar
    <span>障害対応</span><a href="#">障害</a><code>障害</code>
    <input value="障害"><div data-ex-search-panel>障害</div>
  </div>`)
  const card = dom.window.document.querySelector('#card')
  const original = card.textContent

  assert.equal(highlightTerms(card, ['障害', '障害対応', 'foo+bar']), 3)
  assert.equal(card.querySelectorAll('mark[data-ex-search-highlight]').length, 3)
  assert.equal(card.querySelector('span mark').textContent, '障害対応')
  assert.equal(card.querySelector('a mark'), null)
  assert.equal(card.querySelector('code mark'), null)
  assert.equal(card.querySelector('[data-ex-search-panel] mark'), null)

  highlightTerms(card, ['障害', '障害対応', 'foo+bar'])
  assert.equal(card.querySelectorAll('mark[data-ex-search-highlight]').length, 3)
  assert.equal(card.querySelector('mark mark'), null)

  unwrapHighlights(card)
  assert.equal(card.querySelector('mark'), null)
  assert.equal(card.textContent, original)
})

test('discovers only wrappers in a semantic search-result list', () => {
  const dom = new JSDOM(`
    <main><article class="_body_hash">ordinary channel message</article></main>
    <section class="_resultList_hash_1">
      <div class="_elementContainer_hash_1">one</div>
      <div class="_elementContainer_hash_1">two</div>
    </section>
  `)
  const cards = findResultCards(dom.window.document)
  assert.equal(cards.length, 2)
  assert.deepEqual(cards.map(card => card.textContent), ['one', 'two'])
})

test('scores eligible text and applies stable visible-page CSS ordering', () => {
  const dom = new JSDOM(`<div data-ex-search-native-results>
    <div class="_elementContainer_x">release once <a>release ignored</a></div>
    <div class="_elementContainer_x">release release twice</div>
    <div class="_elementContainer_x">release tied</div>
  </div>`)
  const cards = findResultCards(dom.window.document)
  assert.equal(scoreResultCard(cards[0], ['release']), 1)

  const ordered = applyResultOrder(cards, ['release'], 'relevance')
  assert.equal(ordered[0], cards[1])
  assert.equal(cards[1].style.order, '0')
  assert.equal(cards[0].style.order, '1')
  assert.equal(cards[2].style.order, '2')

  applyResultOrder(cards, ['release'], 'native')
  assert.ok(cards.every(card => card.style.order === ''))
  assert.ok(cards.every(card => !card.hasAttribute('data-ex-search-local-score')))
})
