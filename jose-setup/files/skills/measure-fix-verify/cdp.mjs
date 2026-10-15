// Dependency-free Chrome DevTools Protocol helper for Electron/Chrome apps (Node 22+: global fetch + WebSocket).
// Launch the app with --remote-debugging-port=<port> and a fresh --user-data-dir, then:
//   node cdp.mjs <port> list
//   node cdp.mjs <port> eval   <target-substring> '<js expression>'
//   node cdp.mjs <port> click  <target-substring> '<visible text>'
//   node cdp.mjs <port> type   <target-substring> '<css selector>' '<text>' [--enter]
//   node cdp.mjs <port> shot   <target-substring> <out.png>
//   node cdp.mjs <port> errors <target-substring> [reload]     # console errors + exceptions (optionally after reload)
// <target-substring> matches the page URL (e.g. "window=overlay").
import { writeFileSync } from 'node:fs'

const [port, cmd, match, a1, a2, a3] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
if (cmd === 'list') {
  for (const t of targets) {
    console.log(t.type, t.url)
  }
  process.exit(0)
}
const t = targets.find((x) => x.type === 'page' && x.url.includes(match))
if (!t) {
  console.error(`no page matching "${match}"`)
  process.exit(2)
}

const ws = new WebSocket(t.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const logs = []
await new Promise((r) => {
  ws.onopen = r
})
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push(
      `EXC ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`
    )
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push(`ERR ${m.params.args.map((x) => x.value ?? x.description ?? '').join(' ')}`)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
  }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  if (cmd === 'eval') {
    console.log(JSON.stringify(await evaluate(a1), null, 1))
  } else if (cmd === 'click') {
    console.log(
      await evaluate(`(() => { const want = ${JSON.stringify(a1)};
      const els = [...document.querySelectorAll('button,[role=button],[role=option],a,li,label,div,span')]
        .filter(e => e.offsetParent !== null && e.textContent.trim() === want);
      const el = els.pop() || [...document.querySelectorAll('button,[role=button],[role=option],a')].find(e => e.textContent.includes(want));
      if (!el) return 'not found'; el.click(); return 'clicked ' + el.tagName; })()`)
    )
  } else if (cmd === 'type') {
    console.log(
      await evaluate(`(async () => { const el = document.querySelector(${JSON.stringify(a1)}); if (!el) return 'no element';
      el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(a2)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      ${a3 === '--enter' ? "await new Promise(r => setTimeout(r, 150)); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));" : ''}
      return 'typed'; })()`)
    )
  } else if (cmd === 'shot') {
    const s = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(a1, Buffer.from(s.result.data, 'base64'))
    console.log('saved', a1)
  } else if (cmd === 'errors') {
    await send('Runtime.enable')
    if (a1 === 'reload') {
      await send('Page.reload')
      await sleep(4000)
    } else {
      await sleep(1500)
    }
    console.log(logs.length ? logs.join('\n') : 'no errors')
  } else {
    console.error('unknown command')
    process.exitCode = 2
  }
} finally {
  ws.close()
}
