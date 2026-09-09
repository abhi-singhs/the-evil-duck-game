# The evil duck

A single-player browser boss hunt. One duck has 26,000 HP, throws things at you, and gets worse every 30 seconds. You have two minutes, four weapons, and five lives.

React and TypeScript render the interface. Canvas 2D draws the original pixel art. The game runs locally in the browser without an account or backend.

## Run locally

Use Node.js 22.12 or newer and npm.

```sh
npm install
npm run dev
```

For a production build and local preview:

```sh
npm run build
npm run preview
```

Vite writes the production site to `dist/`. Serve that directory with a static web host. To host under a subdirectory, build with `npm run build -- --base=/your-path/`. The bundled music uses the same base path.

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

`Dockerfile` builds the site and copies it into a runtime image with `server/index.mjs`, a dependency-free Node static server. That server handles byte ranges, which the music needs because Safari will not play a track served without `206` replies. It also answers `/healthz`, and it is where the future game server goes so the browser talks to one origin.

Three things about this setup are deliberate.

Images build in ACR with `--platform linux/amd64`. A `docker build` on an Apple Silicon machine produces an arm64 image that Container Apps will not start.

The app pulls with its own managed identity holding `AcrPull`, and the registry's admin user is disabled. The script enables admin briefly on first create only, because the app has no identity until it exists, then turns it back off.

Replicas are pinned to exactly one. A multiplayer room is a single authoritative process, so a second replica would mean a second duck.

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

## Game code

`src/game/simulation.ts` contains the rules. It has no browser or React dependency. Movement is seeded, updates run at a fixed 60 Hz, and all combat uses simulation time. `config.ts` contains weapon stats and fight settings.

`session.ts` hosts the solo simulation. It accepts sequenced player commands and returns copied, serializable snapshots and events. Rendering and audio cannot mutate its authoritative state. `renderer.ts` draws the scene. `useGame.ts` connects the session to browser input, audio, and the React interface.

```sh
npm test
npm run lint
npm run build
```

The unit tests cover combat, cooldowns, heat, unlock thresholds, phase progression, attack spawning, interception, player death, deadline ordering, deterministic balance scenarios, session isolation, frame-rate equivalence, and coordinate mapping.

The balance scenarios play the fight rather than only proving the duck can lose health. Perfect aim wins at 54s without losing a life, 65% aim wins at 95s, and 20% aim gets killed at 82s. One scenario plays perfectly but never defends, and dies for it.

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

## A future shared-duck demo

This version is single-player. It does not implement or claim tested support for 50 networked players.

The game rules already distinguish shared duck state from per-player cooldowns, heat, damage, unlocks, and lives. Commands carry a player ID, sequence, aim, trigger, and selected weapon. Players never submit calculated damage or boss health. Attacks are addressed to one player, so a landed egg costs only that player a life, and simulation tests cover two players damaging the same duck without sharing cooldowns or health.

To add the planned cooperative demo, host the simulation on a server and replace the local session adapter with a network client. The server should own the timer, movement, hit detection, and health. Add rooms capped at 50 players, validated and rate-limited commands, snapshot broadcasts, reconnect handling, and clock synchronization. Tune boss health and individual unlock thresholds for the group, then load-test 50 simultaneous connections. Browser timers and local scores are not an anti-cheat boundary.

The deployment already suits this. `server/index.mjs` is the process that would run the fixed-step loop and the WebSocket endpoint, and the container app is pinned to one replica so every socket in a room reaches the same duck. Watch bandwidth rather than CPU: broadcasting all 50 players at 60 Hz is roughly 20 Mbps per room, while sending each client the duck, the live threats, and its own player at 20 Hz is closer to 1 Mbps. Concurrent rooms need routing by room ID, since raising `--max-replicas` alone would split a room across replicas.
