// Run after npm run build: node scripts/verify-editor-ui.cjs.
// Real production renderer, isolated in-memory API: never reads or changes user notes.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-editor-ui-'))
  require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/shared/types.ts')], bundle: true, platform: 'node', outfile: path.join(dir, 'defaults.cjs') })
  fs.writeFileSync(path.join(dir, 'preload.cjs'), `
    const settings = { ...require('./defaults.cjs').DEFAULT_SETTINGS, theme: 'green-dark', onboardingComplete: true, lastSeenVersion: 'test', lastNoteId: 'test-note' };
    let note = { id: 'test-note', title: 'Рабочая заметка', body: Array.from({length:40}, (_,i)=>'<p>Абзац '+(i+1)+'. Спокойный текст для проверки прокрутки и чтения заметки.</p>').join(''), emoji: null, pinned: false, favorite: false, color: 'teal', tags: ['работа'], folderId: null, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, sources: {} };
    const callbacks = {};
    const on = name => cb => { callbacks[name] = cb; return () => { delete callbacks[name] }; };
    const noop = () => {};
    window.api = {
      notes: { list: async()=>[note], listTrash: async()=>[], setActive: noop, setActiveFolder: noop, onCreated:on('created'), onUpdated:on('updated'), onDeleted:on('deleted'), onProcessingStart:on('start'), onProcessingEnd:on('end'), update:async(id,patch)=>(note={...note,...patch}), cleanupEmpty:async()=>false },
      settings: { get:async()=>settings, update:async patch=>({settings:Object.assign(settings,patch),hotkeyResult:{}}) },
      app: { getVersion:async()=>'test', onFlush:on('flush'), flushed:noop, onUpdateAvailable:on('available'), onUpdateReady:on('ready') },
      providers: { list:async()=>[], onChanged:on('providers') },
      folders: { list:async()=>[], onChanged:on('folders') },
      ocr: { getState:async()=>({active:0,queued:0,running:0,failed:0}), onState:on('queue') },
      toast: { onToast:on('toast') }, navigation: { onNavigate:on('navigate') }
    };
    window.editorTest = {
      append: () => { note = {...note, body:note.body+'<p>'+('Новый распознанный текст. '.repeat(30))+'</p>',updatedAt:Date.now()}; callbacks.updated(note); },
      note: () => note,
      open: () => callbacks.navigate({view:'editor',noteId:note.id})
    };
  `)
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const result = require('node:child_process').spawnSync(require('electron'), [__filename, dir], {
    cwd: root, env: environment, stdio: 'inherit', timeout: 90000, windowsHide: true
  })
  const report = path.join(dir, 'result.json')
  if (fs.existsSync(report)) console.log(fs.readFileSync(report, 'utf8'))
  console.log(`UI artifacts: ${dir}`)
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow } = require('electron')
  const dir = process.argv[2]
  app.setPath('userData', path.join(dir, 'profile'))
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1440, height: 940, show: false, webPreferences: { offscreen: true, preload: path.join(dir, 'preload.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false } })
    const errors = []
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
    const js = code => win.webContents.executeJavaScript(code)
    const rect = selector => js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
    const click = async selector => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(300) }
    const screenshot = async name => { await delay(150); fs.writeFileSync(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
    const results = {}
    try {
      await win.loadFile(path.join(root, 'out/renderer/index.html'))
      await delay(800)
      assert.equal(await js(`!!document.querySelector('[data-note-scroll]')`), true, 'editor mounts')
      assert.equal(await js(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`), '#6dd58c', 'root defaults do not override dark accent')
      await screenshot('docked-dark')
      // Native pointer events exercise capture and dragging instead of directly setting React state.
      const handle = await rect('.editor-drag-handle')
      const hx = Math.round(handle.x + 70), hy = Math.round(handle.y + 14)
      win.webContents.sendInputEvent({ type: 'mouseDown', x: hx, y: hy, button: 'left', clickCount: 1 })
      await delay(40)
      win.webContents.sendInputEvent({ type: 'mouseMove', x: hx - 260, y: hy + 100, button: 'left', modifiers: ['leftButtonDown'] })
      await delay(80)
      win.webContents.sendInputEvent({ type: 'mouseUp', x: hx - 260, y: hy + 100, button: 'left', clickCount: 1 })
      await delay(250)
      assert.equal(await js(`document.querySelector('[data-editor-floating]').dataset.editorFloating`), 'true')
      const moved = await rect('.editor-frame')
      results.pointer = { handle, moved }
      assert.ok(moved.x < handle.x - 100 && moved.y > 50, 'pointer moved editor in both directions')
      results.drag = moved
      await screenshot('floating-dark')
      await js(`document.querySelector('[data-note-scroll]').scrollTop = 0`)
      await js(`window.editorTest.append()`)
      await delay(700)
      assert.equal(await js(`document.querySelector('[data-note-scroll]').scrollTop`), 0, 'reading earlier text stays put')
      await js(`(()=>{const e=document.querySelector('[data-note-scroll]');e.scrollTop=e.scrollHeight})()`)
      await delay(50)
      await js(`window.editorTest.append()`)
      await delay(1100)
      const gap = await js(`(()=>{const e=document.querySelector('[data-note-scroll]');return e.scrollHeight-e.scrollTop-e.clientHeight})()`)
      assert.ok(gap < 4, 'appended content follows smoothly to the end')
      results.appendGap = gap
      // Keep the caret and viewport when the user is editing the beginning.
      await js(`(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();const r=document.createRange();r.setStart(e.firstChild.firstChild,3);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);document.querySelector('[data-note-scroll]').scrollTop=0})()`)
      await delay(50)
      await js(`window.editorTest.append()`)
      await delay(500)
      assert.equal(await js(`getSelection().anchorOffset`), 3, 'caret survives external revision')
      assert.equal(await js(`document.querySelector('[data-note-scroll]').scrollTop`), 0)
      await click('[aria-label="Вернуть редактор вправо"]')
      assert.equal(await js(`document.querySelector('[data-editor-floating]').dataset.editorFloating`), 'false')
      // Keyboard movement and clamping after the sidebar/workspace changes.
      await js(`document.querySelector('.editor-drag-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`)
      await delay(150)
      win.setSize(1100, 650)
      await delay(350)
      const resized = await rect('.editor-frame')
      assert.ok(resized.x >= 0 && resized.y >= 0 && resized.x + resized.width <= 1100 && resized.y + resized.height <= 650)
      win.setSize(800, 650)
      await delay(350)
      assert.equal(await js(`document.querySelector('[data-editor-floating]').dataset.editorFloating`), 'false', 'narrow mode docks safely')
      await screenshot('narrow')
      win.setSize(1440, 940)
      await delay(350)
      await click('[aria-label="Настройки"]')
      await js(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Редактор').click()`)
      await delay(300)
      const families = await js(`Array.from(document.querySelectorAll('select[aria-label="Шрифт редактора"] optgroup:first-of-type option')).map(e=>e.value)`)
      assert.equal(families.length, 12)
      const loaded = await js(`Promise.all(${JSON.stringify(families)}.map(async f=>({family:f,faces:(await document.fonts.load('16px "'+f+'"','Привет English')).length})))`)
      assert.ok(loaded.every(f=>f.faces >= 2), 'each bundled font loads real Cyrillic and Latin faces')
      results.fonts = loaded
      await js(`(()=>{const s=document.querySelector('select[aria-label="Шрифт редактора"]');s.value='Montserrat Variable';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await delay(200)
      assert.ok(await js(`getComputedStyle(document.querySelector('.rich-content')).fontFamily.includes('Montserrat')`))
      await screenshot('fonts-dark')
      await js(`document.documentElement.dataset.theme='green-light'`)
      await screenshot('fonts-light')
      await click('[aria-label="Заметки"]')
      await delay(250)
      await screenshot('notes-light')
      const shadow = await js(`getComputedStyle(document.querySelector('.note-card')).boxShadow`)
      assert.notEqual(shadow, 'none', 'light card glow is valid CSS')
      results.lightShadow = shadow
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      await delay(100)
      await click('[aria-label="Закрыть"]')
      assert.equal(await js(`!!document.querySelector('[data-note-scroll]')`), false, 'editor closes')
      await js(`window.editorTest.open()`)
      await delay(250)
      await js(`(()=>{getSelection().removeAllRanges();const e=document.querySelector('[data-note-scroll]');e.scrollTop=e.scrollHeight;const original=e.scrollTo.bind(e);e.scrollTo=options=>{window.lastScrollBehavior=options.behavior;original(options)}})()`)
      await js(`window.editorTest.append()`)
      await delay(100)
      assert.equal(await js(`window.lastScrollBehavior`), 'instant', 'reduced motion disables smooth scrolling')
      results.reducedMotion = true
      assert.deepEqual(errors, [], 'renderer console errors')
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: true, ...results }, null, 2))
      app.exit(0)
    } catch (error) {
      await screenshot('failure')
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ok: false, error: error.stack, errors, ...results }, null, 2))
      app.exit(1)
    }
  })
}
