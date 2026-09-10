# The evil duck

A browser boss hunt for one player or fifty. One duck has 26,000 HP, throws things at you, and gets worse every 30 seconds. You have two minutes, four weapons, and five lives.

React and TypeScript render the interface. Canvas 2D draws the original pixel art. Solo runs entirely in the browser with no account and no backend. Co-op rooms run the fight on a Node server over WebSockets.

## Run locally

Use Node.js 22.12 or newer and npm.

```sh
npm install
npm run dev
```

That serves the page and gives you solo play. Co-op also needs the game server, in a second terminal:

```sh
npm run dev:server
```

The dev server proxies `/ws` to it, so the browser code is the same in development as in the container.

For a production build and local preview:

```sh
npm run build
npm run serve
```

`npm run build` writes the site to `dist/` and compiles the game rules to `server/core/game-core.mjs`, which the Node server imports. `npm run serve` then runs the real server on port 8080: static files, byte ranges, health check, and the game endpoint. `npm run preview` still works for the solo game alone.

To host under a subdirectory, build with `npm run build -- --base=/your-path/`. The bundled music uses the same base path.

## Deploy

Live at [ca-evil-duck.happycoast-7ae1ae03.westus2.azurecontainerapps.io](https://ca-evil-duck.happycoast-7ae1ae03.westus2.azurecontainerapps.io/), running on Azure Container Apps.

```sh
./deploy/deploy.sh
```

The script creates anything missing and updates what exists, so the first deploy and every redeploy use the same command. It tags the image with the current git sha, then checks the health endpoint, the page, and a byte-range request before it prints the URL. Pass `TAG=v3 ./deploy/deploy.sh` to ship a specific tag.

Resource names live in `deploy/azure.env` and can be overridden from the shell. The subscription is not pinned there: the script uses whatever `az account show` reports.

| Resource | Name |
| --- | --- |
| Resource group | `rg-abhising-tad-demo` |
| Region | `westus2` |
| Container registry | `acrevilduck109048529` |
| Container Apps environment | `cae-evil-duck` |
| Container app | `ca-evil-duck` |

`Dockerfile` builds the site, compiles the game core, and copies both into a runtime image with `server/index.mjs`. That server handles byte ranges, which the music needs because Safari will not play a track served without `206` replies. It answers `/healthz`, and it runs the co-op fight on `/ws`, so the browser talks to one origin.

Three things about this setup are deliberate.

Images build in ACR with `--platform linux/amd64`. A `docker build` on an Apple Silicon machine produces an arm64 image that Container Apps will not start.

The app pulls with its own managed identity holding `AcrPull`, and the registry's admin user is disabled. The script enables admin briefly on first create only, because the app has no identity until it exists, then turns it back off.

Replicas are pinned to exactly one. A room is a single authoritative process, so a second replica would mean a second duck. Container Apps ingress passes WebSockets on HTTP/1.1 with the default transport, and the server pings every socket every 15 seconds, well inside the 240-second idle timeout.

Two regional notes if you redeploy elsewhere. This subscription has zero VM quota in `eastus`, which blocks App Service there at every tier, and a room lives in one region, so pick the one nearest the players.

## Play

Reduce the duck's health to zero before the timer expires. Every 30 seconds it evolves, moving faster and gaining telegraphed dashes, armor, and brief vulnerable windows.

The duck fights back. It lobs eggs at you on a timer that tightens each phase, and each one draws a closing ring. Shoot an egg before its ring closes and it breaks. Let it land and you lose one of five lives. You lose the run when the clock expires or your last life goes.

Eggs sit between you and the duck, so any shot that clips one stops there. Clearing an attack always costs you damage output, which is the whole tension: the duck is only reachable when you are not defending.

| Input | Action |
| --- | --- |
| Mouse | Aim and hold the left button to fire |
| Touch | Touch and drag in the arena to fire; use a second finger to change weapons |
| 1 through 4 | Select an unlocked weapon |
| WASD or arrow keys | Move the crosshair |
| F | Hold to fire with keyboard controls |
| Escape | Pause or resume |
| Space | Pause or resume while the arena has keyboard focus |

The shotgun unlocks after 2,600 damage, the blaster after 6,500, and the rocket launcher after 11,700. Unlocks count damage actually removed from the duck, after armor. Misses do not count.

Weapons have unlimited ammunition and independent cooldowns. The blaster overheats. Rockets travel to the point you aimed at, so lead the duck rather than following it. Switching weapons does not reset cooldowns or heat.

The game pauses when the tab becomes hidden, the window loses focus, or a frame stalls for more than half a second. Resume explicitly to continue. Starting another run resets your weapons and the duck. Your best damage, wins, fastest clear, and settings stay in this browser if storage is available.

Portrait and landscape layouts use the same logical playfield. The page follows the device's light or dark preference. Append `?scoutTheme=dark` or `?scoutTheme=light` to override it.

## Play together

Pick **Create a room** or **Join a room** in the header. The first time, the game asks what to call you and remembers it, so after that creating a room is a single click.

Creating gives you a four-character code and a link. Anyone with either one joins the same duck, up to 50 players. Joining asks for the code, unless you opened an invite link, which fills it in for you.

The room waits in a lobby between runs. Members can mark themselves ready, and the host starts the hunt. The host is whoever has been connected longest; if they leave, the next member takes over, so a room never loses its start button.

Four rules change in a room.

The duck keeps its 26,000 HP however many of you turn up. Fifty players tear through it in seconds, which is the point.

Weapons unlock on the team's damage rather than yours. The thresholds are the same 10%, 25%, and 45%, so everyone gets rockets at roughly the same moment.

Eggs are still addressed to one hunter at a time, at the same rate as solo. In a full room you will rarely be the target. Your five lives are yours, and the run only ends when the whole room is down or the clock expires.

Nobody can pause a shared fight. The pause button and Escape drop your trigger and nothing else. Losing focus or hiding the tab does the same.

Joining is lobby-only. Arrive while a hunt is running and you hold a seat until the next round. When a run ends the result stays up for a few seconds, then the room returns to the lobby.

Drop your connection mid-run and the game keeps your seat, your damage, and your lives for as long as the run lasts. Reconnecting reclaims it. The duck stops throwing eggs at a seat nobody is sitting in.

Co-op runs do not touch your local best scores. Those are for solo.

## Game code

`src/game/simulation.ts` contains the rules. It has no browser or React dependency. Movement is seeded, updates run at a fixed 60 Hz, and all combat uses simulation time. `config.ts` contains weapon stats and fight settings.

`session.ts` defines `GameSession` and hosts the solo simulation. It accepts sequenced player commands and returns copied, serializable snapshots and events. Rendering and audio cannot mutate its authoritative state. `renderer.ts` draws the scene. `useGame.ts` connects a session to browser input, audio, and the React interface, and it does not care which kind it gets.

`src/net/RemoteSession.ts` is the other implementation. It sends commands and draws what comes back.

```sh
npm test
npm run lint
npm run build
```

The unit tests cover combat, cooldowns, heat, unlock thresholds, phase progression, attack spawning, interception, player death, deadline ordering, deterministic balance scenarios, session isolation, frame-rate equivalence, coordinate mapping, co-op unlocks, disconnect handling, message validation, room capacity, host transfer, reconnection, and a live server that fifty sockets join and a fifty-first cannot.

The balance scenarios play the fight rather than only proving the duck can lose health. Perfect aim wins at 54s without losing a life, 65% aim wins at 95s, and 20% aim gets killed at 82s. One scenario plays perfectly but never defends, and dies for it.

## The co-op server

`server/index.mjs` serves files and hands `/ws` to `server/game-server.mjs`. It also answers `GET /api/rooms/:code/players` from the same module. `server/rooms.mjs` holds the rooms. One interval steps every running room at a fixed 60 Hz against real elapsed time, so a busy event loop slows the tick rate rather than the fight.

The server owns the clock, the duck, hit detection, and health. Clients send aim, a trigger, a weapon, and a sequence number. Nothing a client sends carries damage or boss health, so a tampered browser can only lie about where it is pointing. The server rejects out-of-range aim, replayed sequences, and weapons a player has not unlocked, then rate limits what survives.

### The scoreboard endpoint

`GET /api/rooms/:code/players` returns everyone in a room with their score and health so far, as JSON. Score is damage dealt to the duck, the same number the in-game scoreboard ranks by.

```sh
curl http://localhost:8080/api/rooms/TARH/players
```

```json
{
  "room": "TARH",
  "status": "running",
  "hostId": "p0",
  "cap": 50,
  "members": 1,
  "run": {
    "status": "running",
    "elapsed": 12.4,
    "duration": 120,
    "teamDamage": 820,
    "duck": { "hp": 25180, "maxHp": 26000, "phase": 0 },
    "alive": 1
  },
  "players": [
    {
      "id": "p0",
      "name": "Abhi",
      "host": true,
      "connected": true,
      "ready": false,
      "waiting": false,
      "score": 820,
      "hp": 4,
      "maxHp": 5,
      "alive": true,
      "shots": 41,
      "hits": 33,
      "accuracy": 0.805,
      "blocked": 2,
      "weapon": "shotgun"
    }
  ]
}
```

The list covers the whole room, including members who are disconnected or waiting out a run in progress, and neither of those ever appears in a snapshot. A member with no seat in the current run reports `null` for the per-run fields rather than zero, so "has not played" reads differently from "has hit nothing". `run` is `null` in the lobby. An unknown or malformed code answers `404` with `{"error":"no-room"}`.

### The scoreboard canvas

`.github/extensions/duck-scoreboard/` is a Copilot CLI canvas extension that watches the endpoint. Ask Copilot to open the duck scoreboard, give it a room code, and it polls once a second and renders the ranked room next to the raw JSON that produced it. The panel has its own room and server fields, and the agent can drive it with two actions: `watch_room` to repoint it, `read_scoreboard` to pull the current numbers into the conversation.

The client patches the DOM in place instead of re-rendering it, which is what makes the motion possible: scores count up, bars ease to their new width, a rank change plays as a FLIP slide, and losing a life bursts the pip and flashes the row. `prefers-reduced-motion` turns all of it off.

It reads the deployed server at `https://ca-evil-duck.happycoast-7ae1ae03.westus2.azurecontainerapps.io`, so the room code is the only thing it asks for.

The rules run as one copy, not two. `npm run build:core` bundles `src/game/simulation.ts` and the protocol into `server/core/game-core.mjs`, so the server enforces the same TypeScript the browser and the unit tests run.

Bandwidth is the constraint, not CPU. A full room measured 12.6 Mbps and about 32 KB/s per client with all fifty firing:

```sh
node server/loadtest.mjs
```

Three decisions got it there from an initial 64 Mbps.

Snapshots go out at 20 Hz, not 60, and the client interpolates between the two frames bracketing a moment 100 ms in the past.

Aim and the scoreboard travel separately. Every snapshot carries `[id, x, y, firing]` per teammate, because position is what has to be smooth. Health, damage, and weapon ride a slower message at 4 Hz. Player ids are `p0` through `p49` rather than UUIDs, since fifty UUIDs would be 1.8 KB of pure identifier twenty times a second.

You get all of your own events. Of everyone else's, you get rocket blasts and teammates taking hits, capped per batch. Their muzzle flashes are already implied by the crosshairs in every snapshot, and fifty players' worth of them was two thirds of the traffic.

Concurrent rooms need routing by room ID before `--max-replicas` can rise above one, since raising it alone would split a room across replicas.

## Music and artwork

"Chibi Ninja" by Eric Skiff, from *Resistor Anthems*, plays during the hunt.

- [Creator and source](https://ericskiff.com/music/)
- [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- [Asset license and attribution](public/audio/LICENSE.txt)

The creator permits royalty-free use with attribution. The app serves the unmodified MP3 locally and repeats it during play. Audio starts after a user gesture. Music and synthesized effects have separate volume controls and a shared mute switch.

Duck sprites, scenery, and weapon icons are original to this game. The page chrome uses the Clawpilot theme tokens. The arcade scene runs on its own saturated palette, defined as `--game-*` custom properties in `src/styles.css` with a day and a night version, so the canvas stays vivid and still follows the light or dark setting. `readPalette()` in `src/game/sprites.ts` is the only place that reads them.

## License

The code and the original artwork are MIT licensed. See [LICENSE](LICENSE).

`public/audio/chibi-ninja.mp3` is the exception. It is Eric Skiff's work under CC BY 4.0, not MIT, and the attribution travels with it. Keep the credit in the game and [`public/audio/LICENSE.txt`](public/audio/LICENSE.txt) intact, or replace the track.
