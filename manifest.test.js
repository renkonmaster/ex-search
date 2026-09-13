const assert = require('node:assert/strict')
const { accessSync, readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const manifest = JSON.parse(readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'))

test('manifest grants only the documented traQ content-script capability', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.equal(manifest.version, '0.1.0')
  assert.deepEqual(manifest.permissions, ['storage'])
  assert.equal('host_permissions' in manifest, false)
  assert.equal(manifest.options_ui.page, 'options.html')
  assert.equal(manifest.content_scripts.length, 1)
  const content = manifest.content_scripts[0]
  assert.deepEqual(content.matches, ['https://q.trap.jp/*'])
  assert.deepEqual(content.js, ['core.js', 'dom.js', 'app.js', 'content.js'])
  assert.deepEqual(content.css, ['content.css'])
  assert.equal(content.run_at, 'document_idle')
  for (const file of [...content.js, ...content.css, manifest.options_ui.page]) {
    accessSync(path.join(__dirname, file))
  }
})
