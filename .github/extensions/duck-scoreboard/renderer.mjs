/**
 * The iframe document for the duck scoreboard canvas. One self-contained page: it opens an
 * EventSource against the canvas server, which does the polling, so the iframe never talks to
 * the game server directly and a reload costs nothing.
 *
 * The client patches the DOM in place rather than re-rendering it. A scoreboard that rebuilds its
 * markup every second cannot animate anything: rows would restart their transitions, count-ups
 * would jump, and a reordering would be a flicker. So rows are kept in a Map by player id, values
 * are tweened toward their new numbers, and rank changes are played with FLIP.
 */

const STYLES = `
  * { box-sizing: border-box; }

  :root {
    --gap: 12px;
    --radius: 10px;
    --row-cols: 36px minmax(140px, 1.5fr) minmax(150px, 1fr) 108px 60px 66px 84px;
    --gold: #d4a72c;
    --silver: #8b949e;
    --bronze: #bc7c2e;
  }

  body {
    margin: 0;
    padding: 16px 16px 24px;
    background: var(--background-color-default, #ffffff);
    color: var(--text-color-default, #1f2328);
    font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    font-size: var(--text-body-medium, 14px);
    line-height: var(--leading-body-medium, 20px);
  }

  .mono, code { font-family: var(--font-mono, "SFMono-Regular", Consolas, monospace); }
  .muted { color: var(--text-color-muted, #59636e); }
  .num { font-variant-numeric: tabular-nums; }

  /* ---- header ---------------------------------------------------------- */

  header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
  h1 {
    margin: 0;
    font-size: var(--text-title-medium, 20px);
    font-weight: var(--font-weight-semibold, 600);
    line-height: var(--leading-title-medium, 28px);
  }
  .live {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: var(--text-body-small, 12px);
    color: var(--text-color-muted, #59636e);
  }
  .live i {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--border-color-default, #d1d9e0);
    transition: background 200ms ease;
  }
  .live.on i { background: var(--true-color-green, #1a7f37); animation: blip 1s ease-out; }
  @keyframes blip {
    0% { box-shadow: 0 0 0 0 rgba(26, 127, 55, 0.5); }
    100% { box-shadow: 0 0 0 7px rgba(26, 127, 55, 0); }
  }

  .subtitle {
    display: flex; gap: 10px; flex-wrap: wrap;
    margin: -6px 0 14px;
    font-size: var(--text-code-inline, 12px);
    color: var(--text-color-muted, #59636e);
  }

  form.controls { display: flex; gap: 8px; align-items: center; margin-left: auto; flex-wrap: wrap; }
  input {
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    transition: border-color 150ms ease, box-shadow 150ms ease;
  }
  input:hover { border-color: var(--true-color-blue-muted, #54aeff); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--color-focus-outline, #0969da); outline-offset: 1px; }
  input.code { width: 84px; text-transform: uppercase; letter-spacing: 3px; font-family: var(--font-mono, monospace); }
  input.origin { width: 190px; font-size: var(--text-code-inline, 12px); }
  button {
    background: var(--background-color-default, #fff);
    color: var(--text-color-default, #1f2328);
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 6px;
    padding: 5px 12px;
    font: inherit;
    cursor: pointer;
    transition: transform 120ms ease, border-color 150ms ease;
  }
  button:hover { border-color: var(--true-color-blue-muted, #54aeff); }
  button:active { transform: scale(0.96); }

  /* ---- banner ---------------------------------------------------------- */

  .banner {
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-left: 3px solid var(--true-color-red, #cf222e);
    border-radius: var(--radius);
    padding: 12px 14px;
    animation: rise 260ms cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  .banner.empty { border-left-color: var(--true-color-blue, #0969da); }

  /* ---- the duck -------------------------------------------------------- */

  .hero {
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 14px;
    animation: rise 300ms cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  .hero-top { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 12px; }
  .code {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-title-medium, 20px);
    font-weight: var(--font-weight-semibold, 600);
    letter-spacing: 3px;
  }
  .stat { display: flex; flex-direction: column; }
  .stat .label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--text-color-muted, #59636e);
  }
  .stat .value { font-size: var(--text-title-small, 16px); font-weight: var(--font-weight-semibold, 600); }
  .pill {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: var(--text-body-small, 12px);
  }
  .pill i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .pill.running { border-color: var(--true-color-green-muted, #4ac26b); color: var(--true-color-green, #1a7f37); }
  .pill.running i { animation: throb 1.4s ease-in-out infinite; }
  .pill.complete { border-color: var(--true-color-purple-muted, #c297ff); color: var(--true-color-purple, #8250df); }
  @keyframes throb { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(0.8); } }

  .duck-labels { display: flex; justify-content: space-between; font-size: var(--text-body-small, 12px); margin-bottom: 5px; }
  .track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--border-color-muted, #eaeef2);
    overflow: hidden;
  }
  .track > .fill {
    display: block; height: 100%; width: 0;
    border-radius: 999px;
    background: var(--gold);
    transition: width 700ms cubic-bezier(0.2, 0.8, 0.3, 1);
  }
  /* The sheen only runs while the duck is losing health, so a paused board looks paused. */
  .track.alive::after {
    content: "";
    position: absolute; inset: 0;
    background: linear-gradient(100deg, transparent 35%, rgba(255, 255, 255, 0.45) 50%, transparent 65%);
    transform: translateX(-100%);
    animation: sweep 2.4s ease-in-out infinite;
  }
  @keyframes sweep { 0% { transform: translateX(-100%); } 60%, 100% { transform: translateX(100%); } }
  .hero.hit { animation: jolt 320ms ease-out; }
  @keyframes jolt {
    0% { transform: translateX(0); } 25% { transform: translateX(-2px); }
    60% { transform: translateX(2px); } 100% { transform: translateX(0); }
  }

  /* ---- the board ------------------------------------------------------- */

  .cols, .row {
    display: grid;
    grid-template-columns: var(--row-cols);
    align-items: center;
    gap: 10px;
  }
  .cols {
    padding: 0 12px 6px;
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
    color: var(--text-color-muted, #59636e);
  }
  .board { list-style: none; margin: 0; padding: 0; }
  .row {
    position: relative;
    padding: 10px 12px;
    border: 1px solid transparent;
    border-radius: var(--radius);
    /* FLIP: the script sets a transform, clears it, and this transition plays the move. */
    transition: transform 420ms cubic-bezier(0.2, 0.8, 0.3, 1), background 200ms ease, opacity 300ms ease;
  }
  .row + .row { margin-top: 2px; }
  .row:nth-child(odd) { background: rgba(128, 128, 128, 0.06); }
  .row:hover { border-color: var(--border-color-default, #d1d9e0); }
  .row.entering { animation: rise 380ms cubic-bezier(0.2, 0.8, 0.3, 1); }
  .row.leaving { opacity: 0; transform: translateX(14px); }
  .row.down { opacity: 0.5; }
  .row.offline { opacity: 0.4; }
  .row.hurt { animation: hurt 620ms ease-out; }
  @keyframes hurt {
    0% { background: rgba(207, 34, 46, 0.22); }
    100% { background: transparent; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  .rank {
    justify-self: start;
    width: 26px; height: 26px;
    display: grid; place-items: center;
    border-radius: 50%;
    border: 1px solid var(--border-color-default, #d1d9e0);
    font-size: var(--text-body-small, 12px);
    font-variant-numeric: tabular-nums;
    color: var(--text-color-muted, #59636e);
    transition: color 300ms ease, border-color 300ms ease;
  }
  .row[data-rank="1"] .rank {
    color: var(--gold); border-color: var(--gold); font-weight: 600;
    box-shadow: 0 0 0 3px rgba(212, 167, 44, 0.15);
  }
  .row[data-rank="2"] .rank { color: var(--silver); border-color: var(--silver); }
  .row[data-rank="3"] .rank { color: var(--bronze); border-color: var(--bronze); }
  .rank.climbed { animation: pop 500ms cubic-bezier(0.2, 0.8, 0.3, 1); }
  @keyframes pop { 40% { transform: scale(1.35) rotate(-6deg); } 100% { transform: scale(1); } }

  .who { min-width: 0; }
  .who .name {
    display: flex; align-items: center; gap: 6px;
    font-weight: var(--font-weight-semibold, 600);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .who .id { font-size: 11px; color: var(--text-color-muted, #59636e); font-family: var(--font-mono, monospace); }
  .tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: 4px; padding: 0 4px;
    color: var(--text-color-muted, #59636e);
    animation: rise 240ms ease-out;
  }

  .metrics { display: flex; flex-direction: column; gap: 4px; }
  .metrics .score {
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-semibold, 600);
    font-size: var(--text-title-small, 16px);
    line-height: 1.2;
  }
  .metrics .score.up { animation: gained 700ms ease-out; }
  @keyframes gained { 0% { color: var(--true-color-green, #1a7f37); transform: translateY(-2px); } 100% { color: inherit; } }
  .metrics .track { height: 6px; }
  .metrics .fill { background: var(--true-color-blue, #0969da); }
  .row[data-rank="1"] .metrics .fill { background: var(--gold); }

  .pips { display: flex; gap: 4px; }
  .pip {
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--true-color-green, #1a7f37);
    transition: background 260ms ease, transform 260ms ease;
  }
  .pip.gone { background: var(--border-color-muted, #eaeef2); transform: scale(0.72); }
  .pip.losing { animation: burst 520ms ease-out; }
  @keyframes burst {
    0% { background: var(--true-color-red, #cf222e); transform: scale(1.5); }
    100% { background: var(--border-color-muted, #eaeef2); transform: scale(0.72); }
  }

  .acc, .shots { font-variant-numeric: tabular-nums; text-align: right; }
  .weapon { font-size: var(--text-body-small, 12px); padding-left: 4px; }

  .empty-note { padding: 18px 12px; }

  /* ---- raw ------------------------------------------------------------- */

  details { margin-top: 16px; }
  summary { cursor: pointer; color: var(--text-color-muted, #59636e); font-size: var(--text-body-small, 12px); }
  .curl { margin-top: 10px; font-size: var(--text-code-inline, 12px); }
  pre {
    margin: 8px 0 0;
    padding: 12px;
    max-height: 320px;
    overflow: auto;
    border: 1px solid var(--border-color-default, #d1d9e0);
    border-radius: var(--radius);
    font-family: var(--font-mono, monospace);
    font-size: var(--text-code-block, 12px);
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::after { animation: none !important; transition-duration: 1ms !important; }
  }
`

const CLIENT = `
  const $ = (id) => document.getElementById(id)
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

  function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const commas = (value) => Number(value).toLocaleString()

  /** Counts a number up rather than snapping it, so a burst of damage reads as a burst. */
  function tween(node, from, to, ms) {
    if (from === to) return
    if (REDUCED || ms === 0) { node.textContent = commas(to); return }
    const started = performance.now()
    cancelAnimationFrame(node.__raf)
    const step = (now) => {
      const progress = Math.min(1, (now - started) / ms)
      const eased = 1 - Math.pow(1 - progress, 3)
      node.textContent = commas(Math.round(from + (to - from) * eased))
      if (progress < 1) node.__raf = requestAnimationFrame(step)
    }
    node.__raf = requestAnimationFrame(step)
  }

  function flash(node, className, ms) {
    node.classList.remove(className)
    void node.offsetWidth
    node.classList.add(className)
    setTimeout(() => node.classList.remove(className), ms)
  }

  /* ---- controls -------------------------------------------------------- */

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

  /* ---- the duck -------------------------------------------------------- */

  let lastDuckHp = null

  function renderHero(room) {
    const run = room.run
    $('hero').hidden = false
    $('hero-code').textContent = room.room
    const pill = $('hero-status')
    pill.className = 'pill ' + room.status
    pill.replaceChildren(el('i'), document.createTextNode(room.status))
    $('hero-players').textContent = room.members + ' / ' + room.cap
    $('hero-alive').textContent = run ? run.alive : '--'
    $('hero-elapsed').textContent = run ? run.elapsed.toFixed(1) + 's' : '--'
    tween($('hero-damage'), Number($('hero-damage').dataset.value ?? 0), run ? run.teamDamage : 0, 600)
    $('hero-damage').dataset.value = run ? run.teamDamage : 0

    const track = $('duck-track')
    if (!run) {
      $('duck-line').hidden = true
      lastDuckHp = null
      return
    }
    $('duck-line').hidden = false
    $('duck-phase').textContent = 'Duck · phase ' + run.duck.phase
    $('duck-hp').textContent = commas(run.duck.hp) + ' / ' + commas(run.duck.maxHp)
    $('duck-fill').style.width = (run.duck.hp / run.duck.maxHp) * 100 + '%'
    track.classList.toggle('alive', run.status === 'running' && run.duck.hp > 0)
    if (lastDuckHp !== null && run.duck.hp < lastDuckHp) flash($('hero'), 'hit', 320)
    lastDuckHp = run.duck.hp
  }

  /* ---- the board ------------------------------------------------------- */

  const rows = new Map()

  function buildRow(player) {
    const row = el('li', 'row entering')
    row.dataset.id = player.id

    const rank = el('span', 'rank', '')
    const who = el('span', 'who')
    const name = el('span', 'name')
    const label = el('span', '', player.name)
    const tags = el('span', 'tags')
    tags.style.display = 'contents'
    name.append(label, tags)
    who.append(name, el('span', 'id', player.id))

    const metrics = el('span', 'metrics')
    const score = el('span', 'score num', '0')
    const track = el('span', 'track')
    const fill = el('span', 'fill')
    track.append(fill)
    metrics.append(score, track)

    const pips = el('span', 'pips')
    const acc = el('span', 'acc')
    const shots = el('span', 'shots num')
    const weapon = el('span', 'weapon muted')

    row.append(rank, who, metrics, pips, acc, shots, weapon)
    row.refs = { rank, label, tags, score, fill, pips, acc, shots, weapon }
    row.shown = { score: 0, hp: null, rank: null }
    setTimeout(() => row.classList.remove('entering'), 400)
    return row
  }

  function syncPips(row, player) {
    const { pips } = row.refs
    if (player.hp === null || player.maxHp === null) {
      pips.replaceChildren(el('span', 'muted', '--'))
      row.shown.hp = null
      return
    }
    if (pips.childElementCount !== player.maxHp) {
      pips.replaceChildren(...Array.from({ length: player.maxHp }, () => el('span', 'pip')))
    }
    const lost = row.shown.hp !== null && player.hp < row.shown.hp
    ;[...pips.children].forEach((pip, index) => {
      const gone = index >= player.hp
      // Only the pips that just went out get the burst; the rest settle silently.
      if (gone && lost && index >= player.hp && index < row.shown.hp) flash(pip, 'losing', 520)
      pip.classList.toggle('gone', gone)
    })
    if (lost) flash(row, 'hurt', 620)
    row.shown.hp = player.hp
  }

  function syncRow(row, player, rank, top) {
    const refs = row.refs
    refs.label.textContent = player.name

    const tags = []
    if (player.host) tags.push('host')
    if (player.waiting) tags.push('waiting')
    if (!player.connected) tags.push('offline')
    if (player.alive === false) tags.push('down')
    if (refs.tags.dataset.value !== tags.join(',')) {
      refs.tags.dataset.value = tags.join(',')
      refs.tags.replaceChildren(...tags.map((text) => el('span', 'tag', text)))
    }

    row.classList.toggle('down', player.alive === false)
    row.classList.toggle('offline', !player.connected)

    const score = player.score ?? 0
    if (player.score === null || player.score === undefined) {
      cancelAnimationFrame(refs.score.__raf)
      refs.score.textContent = '--'
    } else {
      if (score > row.shown.score) flash(refs.score, 'up', 700)
      tween(refs.score, row.shown.score, score, 600)
    }
    row.shown.score = score
    refs.fill.style.width = (score / top) * 100 + '%'

    syncPips(row, player)

    refs.acc.textContent = player.accuracy === null || player.accuracy === undefined
      ? '--'
      : Math.round(player.accuracy * 100) + '%'
    refs.shots.textContent = player.shots === null ? '--' : commas(player.shots)
    refs.weapon.textContent = player.weapon ?? '--'

    if (row.shown.rank !== null && rank < row.shown.rank) flash(refs.rank, 'climbed', 500)
    row.shown.rank = rank
    row.dataset.rank = rank
    refs.rank.textContent = rank
  }

  /** FLIP: measure, reorder, invert, then let CSS play the move. */
  function reorder(board, ordered) {
    const before = new Map()
    for (const row of rows.values()) before.set(row, row.getBoundingClientRect().top)
    for (const row of ordered) board.append(row)
    if (REDUCED) return
    for (const row of ordered) {
      const shift = (before.get(row) ?? 0) - row.getBoundingClientRect().top
      if (!shift) continue
      row.style.transition = 'none'
      row.style.transform = 'translateY(' + shift + 'px)'
      requestAnimationFrame(() => {
        row.style.transition = ''
        row.style.transform = ''
      })
    }
  }

  function renderBoard(players) {
    const board = $('board')
    $('empty-note').hidden = players.length > 0
    $('cols').hidden = players.length === 0

    const ranked = [...players].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    const top = Math.max(1, ...ranked.map((player) => player.score ?? 0))
    const seen = new Set(ranked.map((player) => player.id))

    for (const [id, row] of rows) {
      if (seen.has(id)) continue
      rows.delete(id)
      row.classList.add('leaving')
      setTimeout(() => row.remove(), 320)
    }

    const ordered = ranked.map((player, index) => {
      let row = rows.get(player.id)
      if (!row) {
        row = buildRow(player)
        rows.set(player.id, row)
        board.append(row)
      }
      syncRow(row, player, index + 1, top)
      return row
    })

    reorder(board, ordered)
  }

  /* ---- wiring ---------------------------------------------------------- */

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
    if (state.fetchedAt) flash($('live'), 'on', 900)

    if (state.error) {
      const banner = $('banner')
      banner.className = state.error.kind === 'empty' ? 'banner empty' : 'banner'
      banner.replaceChildren(
        el('strong', '', state.error.title),
        el('div', 'muted', state.error.detail),
      )
      banner.hidden = false
      $('hero').hidden = true
      $('cols').hidden = true
      $('empty-note').hidden = true
      for (const row of rows.values()) row.remove()
      rows.clear()
      lastDuckHp = null
      return
    }

    $('banner').hidden = true
    renderHero(state.body)
    renderBoard(state.body.players)
  }

  const source = new EventSource('events')
  source.onmessage = (event) => apply(JSON.parse(event.data))
`

/** The whole iframe document. Everything after first paint arrives over SSE. */
export function renderHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Duck scoreboard</title>
<link rel="icon" href="data:," />
<style>${STYLES}</style>
</head>
<body>

<header>
  <h1>Duck scoreboard</h1>
  <span class="live" id="live"><i></i>live</span>
  <form class="controls" id="controls">
    <label class="muted" for="code">Room</label>
    <input class="code" id="code" name="code" maxlength="4" placeholder="ABCD" autocomplete="off" />
    <label class="muted" for="origin">Server</label>
    <input class="origin mono" id="origin" name="origin" placeholder="http://127.0.0.1:8080" autocomplete="off" />
    <button type="submit">Watch</button>
  </form>
</header>

<div class="subtitle">
  <span class="mono" id="endpoint"></span>
  <span id="fetched"></span>
</div>

<div class="banner empty" id="banner" hidden></div>

<section class="hero" id="hero" hidden>
  <div class="hero-top">
    <span class="code" id="hero-code"></span>
    <span class="pill" id="hero-status"></span>
    <span class="stat"><span class="label">Players</span><span class="value num" id="hero-players">--</span></span>
    <span class="stat"><span class="label">Alive</span><span class="value num" id="hero-alive">--</span></span>
    <span class="stat"><span class="label">Elapsed</span><span class="value num" id="hero-elapsed">--</span></span>
    <span class="stat"><span class="label">Team damage</span><span class="value num" id="hero-damage">0</span></span>
  </div>
  <div id="duck-line">
    <div class="duck-labels muted">
      <span id="duck-phase"></span>
      <span class="num" id="duck-hp"></span>
    </div>
    <div class="track" id="duck-track"><span class="fill" id="duck-fill"></span></div>
  </div>
</section>

<div class="cols" id="cols" hidden>
  <span>#</span><span>Player</span><span>Score</span><span>Health</span>
  <span style="text-align:right">Acc</span><span style="text-align:right">Shots</span><span>Weapon</span>
</div>
<ol class="board" id="board"></ol>
<p class="empty-note muted" id="empty-note" hidden>Nobody is in this room yet.</p>

<details>
  <summary>Raw response</summary>
  <div class="curl mono muted" id="curl"></div>
  <pre id="raw">(no response yet)</pre>
</details>

<script>${CLIENT}</script>
</body>
</html>`
}
