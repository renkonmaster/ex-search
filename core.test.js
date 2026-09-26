const assert = require('node:assert/strict')
const test = require('node:test')

const {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  HISTORY_KEY,
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
} = require('./core.js')

test('settings fall back and clamp the history limit', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.notEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.equal(normalizeSettings({ historyLimit: 0 }).historyLimit, 1)
  assert.equal(normalizeSettings({ historyLimit: 101 }).historyLimit, 100)
  assert.equal(normalizeSettings({ historyLimit: 12.8 }).historyLimit, 12)
  assert.equal(normalizeSettings({ historyLimit: 'bad' }).historyLimit, 20)
  assert.equal(normalizeSettings({ suggestionsEnabled: 1 }).suggestionsEnabled, true)
  assert.equal(normalizeSettings({ suggestionsEnabled: false }).suggestionsEnabled, false)
  assert.equal(normalizeSettings({ defaultOrdering: 'other' }).defaultOrdering, 'native')
  assert.equal(SETTINGS_KEY, 'exSearchSettingsV1')
  assert.equal(HISTORY_KEY, 'exSearchHistoryV1')
})

test('history is trimmed, deduplicated, newest first, and bounded', () => {
  assert.deepEqual(recordHistory(['old', ' same '], 'same', 2), ['same', 'old'])
  assert.deepEqual(recordHistory(['b', 'c'], ' a ', 2), ['a', 'b'])
  assert.deepEqual(recordHistory(['a'], '   ', 20), ['a'])
  assert.deepEqual(normalizeHistory([' a ', '', 3, 'a', 'b'], 2), ['a', 'b'])
})

test('history and suggestions preserve spaces and escapes inside quoted queries', () => {
  const query = 'release "two  spaces" "say \\"hello\\""'
  assert.deepEqual(recordHistory([], `  ${query}  `), [query])
  assert.deepEqual(normalizeHistory(['"a  b"', '"a b"']), ['"a  b"', '"a b"'])
  const suggestions = rankSuggestions({ input: 'release', history: [query] })
  assert.equal(suggestions[0].value, query)
  assert.equal(getCompletion('release', suggestions), query.slice('release'.length))
})

test('unrelated candidates are excluded before source and frequency bonuses', () => {
  assert.deepEqual(rankSuggestions({
    input: 'missing',
    history: ['release notes'],
    context: ['in:here'],
    frequentTerms: [{ term: 'popular', count: 10000 }]
  }), [])
  assert.deepEqual(rankSuggestions({
    input: 'release',
    history: ['old query', 'Release notes', 'weekly release', 'prerelease']
  }).map(item => item.value), ['Release notes', 'weekly release', 'prerelease'])
})

test('filter replacement is quote-aware and preserves unrelated operators', () => {
  assert.deepEqual(splitQuery('hello "release notes" custom:value'), [
    'hello',
    '"release notes"',
    'custom:value'
  ])
  assert.equal(
    applyOwnedFilters('hello in:#general from:alice has:image custom:value', {
      scope: 'in:here',
      author: 'not:bot',
      target: '',
      content: 'has:audio',
      after: '2026-09-01',
      before: ''
    }),
    'hello custom:value in:here not:bot has:audio after:2026-09-01'
  )
  assert.equal(
    applyOwnedFilters('"release notes" #old @bob since:2020-01-01 until:2020-02-01 x:y', {
      scope: '', author: '', target: 'to:alice', content: '', after: '', before: ''
    }),
    '"release notes" x:y to:alice'
  )
  assert.equal(
    applyOwnedFilters('free has:unknown is:human', {
      scope: 'javascript:bad', author: '', target: '', content: '', after: '', before: ''
    }),
    'free has:unknown is:human'
  )
})

test('search terms omit operators, URLs, stop words, and one-character terms', () => {
  assert.deepEqual(
    extractSearchTerms('障害対応 in:here has:image "release notes"'),
    ['障害対応', 'release notes']
  )
  assert.deepEqual(
    extractSearchTerms('the API https://example.com/path a and Fixed.'),
    ['API', 'Fixed']
  )
  assert.deepEqual(extractSearchTerms('C++ (node.js) foo?'), ['C++', 'node.js', 'foo'])
})

test('frequent visible terms are deterministic and do not expose source text', () => {
  const fallback = null
  assert.deepEqual(
    extractFrequentTerms(['alpha beta alpha', 'beta gamma'], 2, fallback),
    [{ term: 'alpha', count: 2 }, { term: 'beta', count: 2 }]
  )
  assert.deepEqual(extractFrequentTerms(['障害対応 障害対応 復旧作業'], 2, fallback), [
    { term: '障害対応', count: 2 },
    { term: '復旧作業', count: 1 }
  ])
})

test('context candidates follow the current traQ route', () => {
  assert.deepEqual(buildContextCandidates('/channels/team/dev'), ['in:here'])
  assert.deepEqual(buildContextCandidates('/users/alice'), ['from:alice'])
  assert.deepEqual(buildContextCandidates('/settings/theme'), [])
})

test('suggestions rank deterministically, deduplicate, and complete suffixes', () => {
  const ranked = rankSuggestions({
    input: 'release',
    history: ['release notes', 'Release Notes', 'old query'],
    context: ['in:here release'],
    frequentTerms: [{ term: 'release train', count: 3 }],
    limit: 8
  })
  assert.equal(ranked[0].value, 'release notes')
  assert.equal(ranked.filter(item => item.value.toLowerCase() === 'release notes').length, 1)
  assert.ok(ranked.length <= 8)
  assert.equal(getCompletion('release', ranked), ' notes')
  assert.equal(getCompletion('missing', ranked), '')
  assert.deepEqual(rankSuggestions({ input: '', history: [], context: [], frequentTerms: [], limit: 8 }), [])
})
