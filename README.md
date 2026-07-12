# FLOP 🫠

**A wobbly 4-player co-op physics puzzle platformer in the browser.**
A motor-driven active ragdoll who is barely in control of his own body, plus
up to three friends who definitely aren't helping.

**Play it live: https://jerzysukiennik.github.io/flop/**

## How to play

| Input | Action |
|---|---|
| **WASD** | wobble around |
| **mouse** | look / aim your arms |
| **LMB / RMB** | left / right arm — hold to reach, touch something to **grab** |
| **both buttons + W** | climb (grab a ledge, haul yourself up) |
| **Space** | jump |
| **Q** (hold) | emote wheel |
| **E** | grappling hook (hub only — grab the glowing yellow pad) |
| **C** | spectator free-cam |

Grab crates, levers, ropes, valves — **and your friends**. Everything is
physics: heavy things rip out of your grip, players can be dragged and
hurled, and falling over is half the game. No health, no death — falling off
the map returns you to the last checkpoint.

**Levels:** The Yard (hub) → Site 7 (construction) · Pier 4 (docks) ·
Flopstone Keep (castle). Walk into a portal ring and stand there to vote.

## Multiplayer

- **Host co-op game** → share the 4-letter room code (or friends find you in
  the public lobby list). Up to 4 players, drop-in/drop-out.
- Host-authoritative physics over WebRTC DataChannels; Firebase Realtime
  Database handles only signalling + lobby listing.
- **The host can disconnect** — the session migrates to another player from
  a warm-standby world snapshot (~2 s rewind).
- No TURN server: players behind symmetric NATs may fail to connect
  (most home networks are fine).

## Development

```bash
npm install
npm run fetch-assets   # downloads CC0 textures/HDRIs/audio (see assets.manifest.json)
npm run dev            # http://localhost:5173/flop/
```

Useful dev URLs: `?level=docks` (solo-start level), `?debug=1` (live physics
tuning panel).

### Tests (the gates)

```bash
npm run gates    # A ragdoll · B grab · C determinism/snapshot · D netcode — headless Node
npm run gate:e   # Playwright smoke over the built site (headed Chromium)
node tests/levels-sanity.mjs
```

### Deploy

Push to `main` → GitHub Actions builds and deploys to GitHub Pages.

## Docs

- [docs/PLAN.md](docs/PLAN.md) — the build plan (research, architecture, netcode design)
- [docs/DECISIONS.md](docs/DECISIONS.md) — every decision, cut and fallback
- [docs/CREDITS.md](docs/CREDITS.md) — every asset, source, author, licence (all CC0)

Built with [three.js](https://threejs.org), [Rapier](https://rapier.rs)
(`rapier3d-compat`), [Vite](https://vitejs.dev) and Firebase RTDB.
Game mechanics inspired by the physics-ragdoll genre; all code, levels,
character and name are original.
