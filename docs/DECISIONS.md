# FLOP — Decision log

Chronological. Every product decision, cut, fallback, and synthesized asset lands here.

## Build start (2026-07-12)

- **Physics: Rapier** (`@dimforge/rapier3d-compat` 0.19.3) — only candidate with built-in world snapshot/restore (host migration) plus motorized joints. See PLAN.md §2 decision matrix.
- **Stack versions**: three 0.185.1, firebase 12, vite 8, Node 25 local / Node 22 CI.
- **Asset delivery: vendored** into `public/assets/` via `scripts/fetch-assets.mjs` + `assets.manifest.json`. Runtime hotlinking rejected: CORS/hotlink/rate-limit risk, GH Pages self-containment wins. 1K textures to keep repo size sane.
- **Music: ambient-only, no melodic soundtrack.** Physics comedy carries the audio; a looping melody grates over 20-minute puzzle sessions. Ambient bed + physics SFX per level.
- **WebRTC: vanilla RTCPeerConnection, no PeerJS** — we own the signalling (Firebase RTDB) anyway; fewer deps, fewer surprises.
- **No client-side prediction** of ragdoll physics — host-authoritative with ~100 ms interpolation delay. Predicting motor-driven ragdolls is a research problem; on a deliberately floppy character the latency is imperceptible comedy anyway.
- **No TURN server.** Public STUN only (no budget, no infra). Most home NATs fine; symmetric-NAT users may fail to connect — documented in README.
