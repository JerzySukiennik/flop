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

## Mid-build decisions

- **Spherical joint motors don't exist in rapier.js bindings** (only `UnitImpulseJoint` has `configureMotorPosition`). Ball joints (shoulders/hips/spine/neck) are passive constraints driven by hand-rolled PD torque pairs (`addTorque` on child + parent). Hinges use native motors.
- **Grabs are spring joints, not hard constraints** — grip strength is finite *by construction* (`grabSpringK × grabBreakDistance ≈ 1260 N`): you can hang from a ledge (686 N) but a 500 kg crate rips free. Sustained overstretch (4 ticks) = break; transients forgiven.
- **Fixed world recipe: all 4 ragdolls always exist** (parked at z=−120 when no human). World structure never changes on join/leave → manifest hash and snapshot-restore stay valid for any roster.
- **Arm PD gains capped by 60 Hz stability limit** — shoulder kp·boost must stay ≲70 for the arm's tiny inertia or the arm flails (limit cycle). Found empirically at Gate B.
- **KO model: "fought and lost"** — sustained lean > 0.62 rad for 0.22 s, or head Δv > 7.5 m/s. Full-strength upright assist below 0.5 rad, fading above (lets real momentum topple him), 1.7× boosted struggle during recovery.
- **peerId = anonymous uid + per-tab suffix** — two tabs in one browser share the Firebase anonymous uid; without the suffix you can't join a lobby hosted from the same browser. RTDB rules use `beginsWith(auth.uid)`.
- **Hidden-tab host keepalive** — rAF freezes in background tabs, which read as host death (3 s) to clients. A 250 ms `setInterval` (browser-clamped to ~1 Hz in background) keeps the authoritative sim and broadcasts alive; the game slows for everyone until the host tabs back. Chosen over pausing: session survives.
- **Migration drops old grab joints** — they exist in the snapshot but can't be attributed to controller state on the new host; players re-grab (≤2 s rewind applies anyway).
- **Skinned mesh: attempted, cut at the pre-authorized timebox.** Sourced Quaternius *Universal Base Characters* via the itch.io API (direct links expire in 60 s — procedure: POST `/download_url` with page csrf_token, then POST `/file/<upload_id>`), inspected the glTF (UE-style rig, 7 texture dependencies). Cut at the bind-pose-mapping stage: capsule ragdoll is already readable and charming; the remaining risk/benefit favored spending the hour on textures, audio and gates. `docs/PLAN.md §5.5` fallback invoked.
- **Ambient beds are synthesized** (filtered brown noise + slow LFO, per-level gain) — the only synthesized asset. Reason: no CC0 ambient loop obtainable without Freesound OAuth (no token present); Kenney has jingles/SFX but no ambience. All other audio is Kenney CC0.
- **Gate E runs headed Chromium** — headless uses SwiftShader (software GL) and reports ~5 FPS, which measures the rasterizer, not the game. Headed gets the real GPU like actual players (60 FPS).
- **Lever logic uses a Schmitt trigger** (+0.1 on, −0.45 off) — physics levers wobble around the threshold and would machine-gun contraptions.
- **Build time: the 10-hour target was exceeded** (~12h wall-clock by ship). Overrun went to: WebRTC same-browser debugging (peerId collision, ICE races, channel-open races, hidden-tab rAF) and the balance-controller tuning loop. Nothing was cut except the skinned mesh (above); all P0/P1/P2 scope shipped.
