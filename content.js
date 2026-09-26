try {
  const exSearchApp = globalThis.ExSearchApp.createExSearchApp({
    document,
    location,
    chromeApi: chrome
  })
  void exSearchApp.start().catch(error => {
    console.error('ex-search: 起動に失敗しました', error)
  })
} catch (error) {
  console.error('ex-search: 起動に失敗しました', error)
}
