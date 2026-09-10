/**
 * The iframe document for the duck scoreboard canvas. One self-contained page: it opens an
 * EventSource against the canvas server, which does the polling, so the iframe never talks to
 * the game server directly and a reload costs nothing.
 */

const STYLES = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 16px;
    background: var(--background-color-default, #ffffff);
    color: var(--text-color-default, #1f2328);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: var(--text-body-medium, 14px);
    line-height: var(--leading-body-medium, 20px);
  }
  h1 {
    margin: 0;
    font-size: var(--text-title-medium, 20px);
    font-weight: var(--font-weight-semibold, 600);
    line-height: var(--leading-title-medium, 28px);
  }
  code, .mono { font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace); }
  .muted { color: var(--text-color-muted, #59636e); }
  header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header .endpoint { font-size: var(--text-code-inline, 12px); }

  form.controls { display: flex; gap: 8px; align-items: center; margin: 12px 0 16px; flex-wrap: wrap; }
  input {
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
  }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 1px; }
  input.code { width: 92px; text-transform: uppercase; letter-spacing: 2px; font-family: var(--font-mono, monospace); }
  input.origin { width: 210px; }
  button {
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 6px;
    padding: 5px 12px;
    font: inherit;
    cursor: pointer;
  }
  button[data-primary] { border-color: var(--true-color-blue-muted, #54aeff); }

  .banner {
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-left: 3px solid var(--true-color-red, #cf222e);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 16px;
  }
  .banner.empty { border-left-color: var(--true-color-blue, #0969da); }

  .summary { display: flex; gap: 20px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat .label { font-size: var(--text-body-small, 12px); color: var(--text-color-muted, #59636e); }
  .stat .value { font-size: var(--text-title-small, 16px); font-weight: var(--font-weight-semibold, 600); }
  .pill {
    display: inline-block;
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 999px;
    padding: 1px 8px;
    font-size: var(--text-body-small, 12px);
  }
  .pill.running { border-color: var(--true-color-green-muted, #4ac26b); color: var(--true-color-green, #1a7f37); }
  .pill.complete { border-color: var(--true-color-purple-muted, #c297ff); color: var(--true-color-purple, #8250df); }

  .duck { margin-bottom: 18px; }
  .bar { height: 8px; border-radius: 999px; background: var(--border-color-muted, #eaeef2); overflow: hidden; }
  .bar > span { display: block; height: 100%; background: var(--true-color-yellow, #d4a72c); }

  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border-color-muted, #eaeef2); }
  th { font-size: var(--text-body-small, 12px); font-weight: var(--font-weight-semibold, 600); color: var(--text-color-muted, #59636e); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.out td { opacity: 0.55; }
  .name { display: flex; align-items: center; gap: 6px; }
  .tag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid var(--border-color-default, #d1d9e0); border-radius: 4px; padding: 0 4px; color: var(--text-color-muted, #59636e); }
  .score { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
  .score .bar { width: 84px; }
  .score .bar > span { background: var(--true-color-blue, #0969da); }
  .pips { letter-spacing: 2px; }
  .pips .lost { opacity: 0.25; }

  details { margin-top: 18px; }
  summary { cursor: pointer; color: var(--text-color-muted, #59636e); font-size: var(--text-body-small, 12px); }
  pre {
    margin: 8px 0 0;
    padding: 12px;
    max-height: 340px;
    overflow: auto;
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 6px;
    font-family: var(--font-mono, monospace);
    font-size: var(--text-code-block, 12px);
  }
  .curl { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: var(--text-code-inline, 12px); }
`

const CLIENT = `
  const $ = (id) => document.getElementById(id)
  const escape = (value) => String(value).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ))
  const num = (value) => value === null || value === undefined ? '--' : value.toLocaleString()
  let editing = false

  for (const field of ['code', 'origin']) {
    $(field).addEventListener('focus', () => { editing = true })
    $(field).addEventListener('blur', () => { editing = false })
  }

  $('controls').addEventListener('submit', async (event) => {
    event.preventDefault()
    $('code').blur()
    $('origin').blur()
    await fetch('config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: $('code').value, origin: $('origin').value }),
    })
  })

  function pips(hp, maxHp) {
    if (hp === null || maxHp === null) return '<span class="muted">--</span>'
    const full = '&#9679;'.repeat(hp)
    const lost = '&#9679;'.repeat(Math.max(0, maxHp - hp))
    return full + (lost ? '<span class="lost">' + lost + '</span>' : '')
  }

  function renderPlayers(players) {
    if (!players.length) return '<p class="muted">Nobody is in this room yet.</p>'
    const ranked = [...players].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    const top = Math.max(1, ...ranked.map((player) => player.score ?? 0))
    const rows = ranked.map((player, index) => {
      const tags = [
        player.host ? '<span class="tag">host</span>' : '',
        player.waiting ? '<span class="tag">waiting</span>' : '',
        player.connected ? '' : '<span class="tag">offline</span>',
        player.alive === false ? '<span class="tag">down</span>' : '',
      ].join('')
      const width = Math.round(((player.score ?? 0) / top) * 100)
      return \`<tr class="\${player.alive === false || !player.connected ? 'out' : ''}">
        <td class="num muted">\${index + 1}</td>
        <td><div class="name">\${escape(player.name)}\${tags}</div>
          <div class="muted mono" style="font-size:11px">\${escape(player.id)}</div></td>
        <td class="num"><div class="score"><span>\${num(player.score)}</span>
          <span class="bar"><span style="width:\${width}%"></span></span></div></td>
        <td class="pips">\${pips(player.hp, player.maxHp)}</td>
        <td class="num">\${player.accuracy === null || player.accuracy === undefined
          ? '<span class="muted">--</span>'
          : Math.round(player.accuracy * 100) + '%'}</td>
        <td class="num muted">\${num(player.shots)}</td>
        <td class="num muted">\${num(player.blocked)}</td>
        <td>\${player.weapon ? escape(player.weapon) : '<span class="muted">--</span>'}</td>
      </tr>\`
    }).join('')
    return \`<table>
      <thead><tr>
        <th class="num">#</th><th>Player</th><th class="num">Score</th><th>Health</th>
        <th class="num">Acc</th><th class="num">Shots</th><th class="num">Blocked</th><th>Weapon</th>
      </tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`
  }

  function renderRoom(room) {
    const run = room.run
    const duck = run ? Math.round((run.duck.hp / run.duck.maxHp) * 100) : 0
    return \`<div class="summary">
      <div class="stat"><span class="label">Room</span>
        <span class="value mono">\${escape(room.room)}</span></div>
      <div class="stat"><span class="label">Status</span>
        <span class="value"><span class="pill \${escape(room.status)}">\${escape(room.status)}</span></span></div>
      <div class="stat"><span class="label">Players</span>
        <span class="value">\${room.members} / \${room.cap}</span></div>
      \${run ? \`<div class="stat"><span class="label">Alive</span>
        <span class="value">\${run.alive}</span></div>
      <div class="stat"><span class="label">Elapsed</span>
        <span class="value">\${run.elapsed.toFixed(1)}s / \${run.duration}s</span></div>
      <div class="stat"><span class="label">Team damage</span>
        <span class="value">\${num(run.teamDamage)}</span></div>\` : ''}
    </div>
    \${run ? \`<div class="duck">
      <div class="muted" style="display:flex;justify-content:space-between;font-size:12px">
        <span>Duck &middot; phase \${run.duck.phase}</span><span>\${num(run.duck.hp)} / \${num(run.duck.maxHp)}</span>
      </div>
      <div class="bar"><span style="width:\${duck}%"></span></div>
    </div>\` : '<p class="muted">No run in progress. Scores appear once the host starts the hunt.</p>'}
    \${renderPlayers(room.players)}\`
  }

  function apply(state) {
    $('endpoint').textContent = state.endpoint
    $('curl').textContent = 'curl ' + state.endpoint
    if (!editing) {
      $('code').value = state.code ?? ''
      $('origin').value = state.origin
    }
    $('fetched').textContent = state.fetchedAt
      ? 'updated ' + new Date(state.fetchedAt).toLocaleTimeString()
      : ''
    $('raw').textContent = state.body ? JSON.stringify(state.body, null, 2) : '(no response yet)'
    if (state.error) {
      $('banner').className = state.error.kind === 'empty' ? 'banner empty' : 'banner'
      $('banner').innerHTML = '<strong>' + escape(state.error.title) + '</strong><br>'
        + '<span class="muted">' + escape(state.error.detail) + '</span>'
      $('banner').hidden = false
      $('room').innerHTML = ''
      return
    }
    $('banner').hidden = true
    $('room').innerHTML = renderRoom(state.body)
  }

  const source = new EventSource('events')
  source.onmessage = (event) => apply(JSON.parse(event.data))
`

/** The whole iframe document. Values are injected server-side once; everything after is SSE. */
export function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Duck scoreboard</title>
<style>${STYLES}</style>
</head>
<body>
<header>
  <h1>Duck scoreboard</h1>
  <span class="muted endpoint mono" id="endpoint"></span>
  <span class="muted endpoint" id="fetched"></span>
</header>

<form class="controls" id="controls">
  <label class="muted" for="code">Room</label>
  <input class="code mono" id="code" name="code" maxlength="4" placeholder="ABCD" autocomplete="off" />
  <label class="muted" for="origin">Server</label>
  <input class="origin mono" id="origin" name="origin" placeholder="http://127.0.0.1:8080" autocomplete="off" />
  <button type="submit" data-primary>Watch</button>
</form>

<div class="banner empty" id="banner" hidden></div>
<div id="room"></div>

<details>
  <summary>Raw response</summary>
  <div class="curl mono muted" id="curl"></div>
  <pre id="raw">(no response yet)</pre>
</details>

<script>${CLIENT}</script>
</body>
</html>`
}
