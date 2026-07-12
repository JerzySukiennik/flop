# FLOP — Build Plan (Phase 0 output)

## Context

Build **Flop**: a browser-based 4-player co-op physics-ragdoll puzzle platformer (Human: Fall Flat mechanics, 100% original content/name/levels), deployed to GitHub Pages at `https://jerzysukiennik.github.io/flop/`. One agent, one continuous build, no subagents, no mid-build questions. Target 10h; overruns logged in `docs/DECISIONS.md`. This file becomes `docs/PLAN.md` in the repo at build start.

Prereqs verified: GitHub MCP ✅, Firebase MCP ✅ (connected), Node/Vite/Playwright available locally. Freesound/Pixabay tokens: assume absent → Kenney is primary audio source (no auth); if env keys exist, use them opportunistically, never block.

---

## 1. Game research — what makes HFF feel right

- **Active ragdoll, not animation**: the body is ~13 dynamic rigid bodies whose joint motors *try* to hold a pose; balance is an active control loop, not a kinematic cheat. The character must genuinely topple.
- **Balance technique consensus** (HFF, TABS, Octodad, open-source active-ragdoll repos): combination of (a) an upward "marionette string" force/spring on chest+head, (b) PD torque driving torso toward upright, (c) joint motors holding a stand/walk pose at *moderate* stiffness, (d) grounded-check raycast gating the assist — no ground contact → assist off → true ragdoll fall.
- **Feel levers**: motor stiffness/damping ratio (too stiff = robot/explosion, too soft = puddle); assist force capped so pushes/trips still win; a short "unconscious" state after a hard fall before the character re-rights (comedy beat).
- **Arms**: while LMB/RMB held, that arm's shoulder+elbow motors drive the hand toward a target point projected from the camera ray (~1.6 m reach). Arms are always dynamic — they flail during walks and catch on geometry.
- **Climbing emerges** from: grab joints strong enough to hang from + arm motors pulling hand-target *down past the chest* while grabbed (which hoists the body) + a small upward assist on pelvis when both hands are latched and player pushes W. HFF does the same trick.
- **Walking**: don't animate legs kinematically. Drive hip/knee motor target angles from a simple 2-phase gait oscillator (phase advanced by horizontal speed), plus a horizontal force on the pelvis capped by ground friction. Looks drunk. That's correct.

## 2. Physics engine — decision matrix

| Criterion | **Rapier** | Jolt (JS) | Havok (WASM) | cannon-es |
|---|---|---|---|---|
| Motorized joints (position + velocity, stiffness/damping) | ✅ `configureMotorPosition/Velocity/Model` | ✅ but JS bindings immature | ✅ but closed blob | ⚠️ weak |
| World serialization (host migration) | ✅ **built-in** `world.takeSnapshot(): Uint8Array` / `World.restoreSnapshot(data)` | ❌ hand-rolled | ❌ hand-rolled | ❌ |
| Vite/WASM friction | ✅ solved via `@dimforge/rapier3d-compat` + `await RAPIER.init()` | ⚠️ | ⚠️ licence + setup | n/a (JS) |
| Runs headless in Node (Gate A–D harness) | ✅ | ⚠️ | ⚠️ | ✅ |
| Bonus | built-in `createPidController(kp,ki,kd,axes)` | — | — | — |

**Decision: Rapier, `@dimforge/rapier3d-compat` (latest, ≥0.19).** Signatures verified against the published `.d.ts` (takeSnapshot/restoreSnapshot/createPidController/createImpulseJoint/step/timestep all confirmed). Rule for the whole build: **read `node_modules/@dimforge/**/*.d.ts` before using any API**, same for three.js and firebase.

## 3. Active-ragdoll architecture

**13 bodies**: pelvis, chest, head, upperArm×2, forearm×2 (hand = forearm tip collider), thigh×2, shin×2, foot×2. Capsule colliders; total mass ~70 kg distributed realistically (pelvis 11, chest 24, head 5, arms 2+1.5, legs 7+3.5+1 per side). Collision groups: body parts don't self-collide except hands/feet vs world.

**Joints** (all `ImpulseJoint`s, motorized):
- Shoulders, hips, neck, spine (pelvis↔chest): **spherical**, motors on all 3 angular DOFs via `configureMotorPosition(target, stiffness, damping)`.
- Elbows, knees: **revolute** with limits (elbow 0..150°, knee 0..−150°), position motors.
- Ankles: revolute, stiff, small range (mostly passive stabilizers).

**Balance controller** (runs inside the fixed 60 Hz step, host only):
1. **Grounded check**: raycast down from each foot (0.15 m). Grounded = either hit.
2. **Upright PD torque on chest+pelvis**: `torque = kp·(uprightError axis-angle) − kd·angvel`, force-capped. Evaluate Rapier's built-in `PidController` for the pelvis *position* channel (it's linear-position oriented); expected outcome: use it for the locomotion/hover assist, hand-rolled PD for orientation. Whichever wins goes in DECISIONS.md.
3. **Hover/leg-spring**: spring force lifting pelvis toward `standHeight` above ground hit point (this is the pragmatic "balance capsule" equivalent — implemented as a force on the pelvis, no hidden kinematic body, visible body stays fully physical).
4. **Pose motors**: stand/walk pose targets fed to all joint motors at moderate stiffness.
5. **Fall state**: if torso tilt > ~65° or upright assist fought and lost for >0.5 s → assist off, motors near-zero for 1.5 s (limp comedy flop) → re-enable and struggle back up.
6. All gains/stiffnesses/masses in **one file** `src/game/tuning.js`, surfaced in a dev-only lil-gui/DIY debug panel (`?debug=1`).

**Arms/grab**: per-arm state machine (idle → reaching → grabbing). Reaching: shoulder+elbow motor targets from a 2-bone analytic IK toward camera-ray point. Grab: on hand-collider contact with a `grabbable` body while button held → create **spherical joint** hand↔object at contact point. Break: each step compare joint anchor separation; > 0.12 m (solver failing = force beyond budget) → destroy joint. Heavy objects therefore rip free naturally. Players' body parts are colliders of grabbable bodies → **players are grabbable for free**.

**Jump**: grounded only; impulse on pelvis + brief crouch-pose pre-wind for feel.

## 4. Netcode design

**Topology**: host-authoritative; host runs the only Rapier world. Transport WebRTC DataChannels (vanilla RTCPeerConnection, no PeerJS — fewer deps, we control signalling anyway). Star topology: every client ↔ host. Two channels: `state` `{ordered:false, maxRetransmits:0}`, `events` (reliable ordered).

**Signalling/lobby**: Firebase RTDB, anonymous auth. Schema exactly per spec (`/lobbies/{roomCode}`, `/signals/{roomCode}/{peerId}`). Security rules: public read on `/lobbies`; writes uid-scoped (`hostPeerId`/`peerId` must belong to `auth.uid`); clients prune lobbies with `heartbeat` older than 30 s on read. Room code = 4 letters from a 20-consonant-safe alphabet. Public lobby list + join by code. Max 4 players, drop-in/out; mid-join spawns at party checkpoint.

**Loop**: host steps at fixed 1/60 with accumulator (never variable dt). Clients send input packets at 30 Hz: `{seq:u16, move:i8x2, camQuat:i16x4, buttons:u8}` ≈ 14 B. Host broadcasts state at 20 Hz.

**Snapshot format** (binary, DataView): header `{tick:u32, baseline flags}` then per-awake-body records `{id:u16, pos:i16x3 (quantized to world bounds ±256 m → ~8 mm), quat: smallest-three i16x3+2bit, linvel:i16x3, angvel:i16x3}` = 26 B/body. 4 players ×13 bodies + ~30 awake props ≈ 82 bodies ≈ 2.1 KB worst case, typical far less (sleeping props skipped; Rapier tracks sleep). If over budget, drop angvel for props. Clients render 100 ms behind newest snapshot, lerp pos / slerp quat between the two bracketing snapshots; velocities used for extrapolation when the buffer starves. **No client-side prediction** — documented as a deliberate choice.

**Events channel** (reliable, JSON — low rate, readability wins): grab/release (with body ids so clients mirror the joint visually), checkpoint, puzzle triggers, emotes, pings, customization, level change, chat-less.

**Host migration**: host sends full `world.takeSnapshot()` + entity manifest hash every 2 s on the reliable channel (warm standby, ~gzip'd Uint8Array). Host heartbeat over `state` channel; 3 s silence → peers elect lowest peerId (deterministic), new host `World.restoreSnapshot(lastSnapshot)`, re-links `entityIds[]` map (index-ordered, see §5), re-signals mesh via RTDB, play resumes ≤2 s rewound.

**Determinism guard (§5.3 of spec)**: levels instantiated from JSON arrays in strict array order; zero `Object.keys`, zero `Math.random`, zero awaits during construction; `entityIds[]` manifest built in creation order; SHA-256 of manifest exchanged on join and after migration; mismatch → loud fatal overlay in dev, console.error + rejoin in prod.

## 5. Asset plan

**Decision: vendored.** `scripts/fetch-assets.mjs` (Node, no deps beyond `node:` built-ins + `yauzl`-style unzip — use `unzip` via child_process or `fflate`) reads `assets.manifest.json` `{id, source, url, license, author, sha256}` → downloads to `public/assets/`, verifies sha256 (first run records it), unpacks zips, idempotent. Committed to repo. Reasons: GH Pages self-containment, no CORS/hotlink/ratelimit risk at runtime, offline dev. Repo size managed by picking 1K–2K textures.

Concrete shopping list (all CC0 unless noted; final URLs resolved by the script via APIs):
- **HDRI** (Poly Haven, 1k HDR): `kloofendal_48d_partly_cloudy` (hub/construction), `industrial_sunset_puresky` (docks), `belfast_sunset` (castle dusk). Unique User-Agent header on every Poly Haven request.
- **PBR textures** (ambientCG, 1K JPG zips — unpack): Wood planks (`Planks021`), concrete (`Concrete034`), rusted metal (`Metal032`/`Rust004`), rope (`Rope001`), stone bricks (`Bricks075`/`PavingStones128`), corrugated metal (`CorrugatedSteel005`) — ids verified at fetch time via `api/v2/full_json`, nearest equivalent if renamed.
- **Character** (Quaternius, CC0): **Universal Base Characters** pack — rigged humanoid glTF, made for retargeting. Fallback: Ultimate Modular Men. 60-min skinning timebox.
- **Audio** (Kenney, CC0, no auth, plain zips): `Impact Sounds`, `UI Audio`, `Voiceover Pack`/grunt-adjacent, `Sci-Fi Sounds` skipped; ambient beds from Kenney `Music Jingles`+loops if adequate; else Freesound previews (only if token in env), else quiet procedural wind noise as documented fallback. **Music decision: ambient-only, no melodic soundtrack** — HFF-style games live on physics SFX and room tone; a looping melody gets annoying in a 20-min puzzle session. Documented in DECISIONS.md.
- Every asset → `docs/CREDITS.md` row (source URL, license, author). CC0/CC-BY only.

## 6. Level designs

Levels = declarative JSON (`src/levels/*.json`): arrays of `{type, id, transform, params}` for statics, dynamics, joints-contraptions, triggers, checkpoints, spawn points. One deterministic instantiation function.

**Hub — "The Yard"** (playground): flat grassy yard with sandbox toys — seesaw, giant soccer ball, stack of crates, swing (rope joints), trampoline (high-restitution pad), a climbing frame, wall-of-fame. **Grappling hook pickup lives here only** (spring joint from hand to raycast hit; toggled item). Three glowing portals (Construction / Docks / Castle) = trigger volumes with vote-to-enter (any player enters, 5 s countdown banner, others can pile in).

**1. Construction — "Site 7"**: linear-ish. Beats: (a) climb scaffold that wobbles (stacked dynamic planks); (b) plank bridge you must drag into place across a gap; (c) lever-operated lift platform (revolute motor toggled by trigger); (d) swinging crane hook — grab the hook, buddy pulls the crane lever to swing you across (solo: set lever, run, grab in time); (e) crate-stairs: stack 3 crates to reach the ledge; checkpoint after each beat. Exit portal.

**2. Docks — "Pier 4"**: water plane with buoyancy zone (upward force ∝ submerged depth on dynamic bodies; players flop-swim slowly, respawn only if sinking under the map). Beats: (a) rope swing across water; (b) container stack — shove a hanging container (crane, spherical joint) to knock a bridge down; (c) valve wheel (revolute + angle threshold) opens a sluice gate; (d) drawbridge held by rope — grab-and-hang on the counterweight rope, or two players heave; (e) buoyant raft ferry pushed by hand. Checkpoints per beat.

**3. Castle — "Flopstone Keep"**: verticality + medieval contraptions. Beats: (a) ledge-climb the outer wall via protruding stones (pure climb test); (b) portcullis winch — one player cranks (revolute motor engaged by grabbing + walking a circle) while others roll under (solo: winch has a ratchet with slow release — sprint); (c) chain + counterweight drawbridge over moat; (d) **catapult finale** — load a player (or crate) in the bucket, second pulls the release lever, human cannonball onto the ramparts (solo: heavy crate on lever timer). Confetti + emote prompt at the throne. Checkpoints per beat.

Every puzzle: solvable alone (documented solo path), faster/funnier co-op.

## 7. Architecture / repo layout

```
flop/
├─ index.html                 # menu + canvas + UI overlays
├─ vite.config.js             # base:'/flop/'
├─ assets.manifest.json
├─ scripts/fetch-assets.mjs
├─ src/
│  ├─ main.js                 # boot: RAPIER.init(), renderer, UI
│  ├─ game/                   # engine-agnostic sim (runs in Node AND browser)
│  │  ├─ tuning.js            # EVERY constant, one file
│  │  ├─ ragdoll.js           # bodies/joints/motors factory
│  │  ├─ balance.js           # PD upright + hover + gait + fall state
│  │  ├─ arms.js              # aim IK, grab/release joints, break force
│  │  ├─ sim.js               # fixed-step world, accumulator, entity registry+manifest
│  │  └─ levels.js            # deterministic JSON instancer, triggers, checkpoints
│  ├─ levels/{hub,construction,docks,castle}.json
│  ├─ net/                    # signalling.js (RTDB), peer.js (RTC), protocol.js (binary codec), host.js, client.js, migration.js
│  ├─ render/                 # scene.js, materials.js, ragdollView.js (capsules→skinned swap), water.js, fx.js
│  └─ ui/                     # menu, lobby, emote wheel, customizer, spectator cam, debug panel
├─ tests/                     # gate-a-ragdoll.mjs … gate-e-smoke.spec.js (Playwright)
└─ docs/ PLAN.md DECISIONS.md CREDITS.md
```
Key property: `src/game/` imports only rapier — the whole sim runs headless in Node for Gates A–D.

## 8. Hour-by-hour schedule

| Hours | Work | Gate |
|---|---|---|
| 0–1 | Repo via GitHub MCP, Vite + base path, Actions→Pages workflow, **spinning cube live on Pages URL**, Firebase project + RTDB + rules via Firebase MCP, fetch-assets skeleton, Node test harness + Playwright installed | **F early** |
| 1–3 | Ragdoll factory, balance controller, gait; tune in headless sim + debug HTML page | **A** |
| 3–4 | Camera, locomotion feel, arm aiming, grab/release/break, climb assist, jump, player-grabs-player | **B** |
| 4–5.5 | RTDB signalling, lobby UI, RTC channels, input protocol, binary snapshots, interpolation | **D** |
| 5.5–6 | Determinism manifest+hash, snapshot broadcast, host migration | **C** |
| 6–8 | Level instancer + hub + 3 levels (geometry, contraptions, checkpoints, portals) | |
| 8–9 | Add-ons ×4 (emote wheel, customizer, hub grapple, spectator cam); skinned mesh attempt (**60-min timebox**) | |
| 9–10 | Asset pass (textures/HDRI/audio wiring), UI polish, README, CREDITS, DECISIONS, full gate sweep, final deploy | **E, F** |

Commit + push after every gate minimum. Screenshots reviewed by eye at every gate.

## 9. Risk register

| Risk | Likelihood | Pre-authorized fallback |
|---|---|---|
| Ragdoll won't stand / explodes | Med | Lower motor stiffness + raise damping; strengthen pelvis hover spring; last resort: stronger marionette force (less floppy but shippable). All tuning in one file + debug UI |
| Rapier PidController awkward for orientation | High | Hand-rolled PD torque (simple, well-understood) |
| Climbing doesn't emerge | Med | Minimal assist: while both hands latched + W, apply upward pelvis force ≤ body weight ×0.6 |
| WebRTC fails on some NATs (no TURN) | Med | Ship with public STUN only; document "same-NAT/most home networks OK, symmetric-NAT users may fail" in README. No TURN server (no budget) |
| Snapshot restore scrambles bodies | Med | §5.3 guards; if still broken, migration falls back to respawn-at-checkpoint (session survives, positions reset) — logged cut of netcode polish |
| Skinned mesh fights back | High | **Capsules with character colors/hats**, pre-authorized, 60-min hard timebox |
| Freesound/Pixabay absent | Certain-ish | Kenney only; ambient = Kenney loops or documented procedural wind |
| ambientCG/Poly Haven id renamed/missing | Low | Script picks nearest same-category asset via API search, logs substitution in DECISIONS.md |
| 10 h overrun | Med | Triage order §7 of spec: ragdoll feel > levels (3→2→1) > add-ons > netcode polish. Multiplayer itself never cut. Log overrun |
| Intel MBP perf (Jurek's i9 + 5500M) | Med | 1K textures, capped shadow map 1024, no postprocessing except cheap fog; FPS gate ≥30 in Playwright |

## 10. Verification (Gates, built before game logic)

- **A** headless Node: ragdoll stands 600 ticks, no NaN, |linvel|<50, head above pelvis at t=10 s.
- **B** headless: arm drives to box → joint exists; release → falls; 500 kg box rips free.
- **C** headless: two builds → identical manifest hash; snapshot→restore→60 steps ≈ control world (ε=1e-3 quantization-aware).
- **D** two Node peers over local DataChannel shim (or wrtc if trivially installable; else loopback transport injected under the same protocol code — documented): join, 2 players visible, host drop → migration <3 s.
- **E** Playwright vs built `dist/`: loads, zero console errors, WebGL alive, screenshot each level, FPS>30.
- **F** live Pages URL 200 + boots.

## 11. Meta

- `docs/DECISIONS.md` appended throughout; every cut/fallback/synthesized asset logged.
- Conventional commits (EN), push after every gate.
- Vault: at build end, capture session lessons to `ClaudeMemory/inbox/` and create/refresh `projects/flop.md` (status: active). Per CLAUDE.md this happens in Phase 1 (plan mode forbids writes now).
