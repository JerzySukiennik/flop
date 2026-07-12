# FLOP — Asset credits

Every third-party asset shipped with the game (vendored into `public/assets/`
by `scripts/fetch-assets.mjs` from `assets.manifest.json`).
Licence policy: **CC0 or CC-BY only.** All assets below are **CC0**.

| Asset id | Type | Source | Author | Licence |
|---|---|---|---|---|
| tex-wood | PBR texture (Planks021, 1K) | [ambientCG](https://ambientcg.com/view?id=Planks021) | ambientCG | CC0 |
| tex-concrete | PBR texture (Concrete034, 1K) | [ambientCG](https://ambientcg.com/view?id=Concrete034) | ambientCG | CC0 |
| tex-metal | PBR texture (Metal032, 1K) | [ambientCG](https://ambientcg.com/view?id=Metal032) | ambientCG | CC0 |
| tex-stone | PBR texture (Bricks097, 1K) | [ambientCG](https://ambientcg.com/view?id=Bricks097) | ambientCG | CC0 |
| tex-grass | PBR texture (Grass004, 1K) | [ambientCG](https://ambientcg.com/view?id=Grass004) | ambientCG | CC0 |
| tex-plate | PBR texture (MetalPlates006, 1K) | [ambientCG](https://ambientcg.com/view?id=MetalPlates006) | ambientCG | CC0 |
| hdri-day | HDRI (Kloofendal 48d Partly Cloudy Puresky, 1K) | [Poly Haven](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky) | Greg Zaal | CC0 |
| hdri-sunset | HDRI (Industrial Sunset Puresky, 1K) | [Poly Haven](https://polyhaven.com/a/industrial_sunset_puresky) | Jarod Guest, Sergej Majboroda | CC0 |
| hdri-dusk | HDRI (Belfast Sunset, 1K) | [Poly Haven](https://polyhaven.com/a/belfast_sunset) | Greg Zaal | CC0 |
| sfx-impact | Impact SFX (105 files) | [Kenney — Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney | CC0 |
| sfx-ui | UI SFX (17 files) | [Kenney — Interface Sounds](https://kenney.nl/assets/interface-sounds) | Kenney | CC0 |
| sfx-grunts | Fighter grunts (10 files) | [Kenney — Voiceover Pack: Fighter](https://kenney.nl/assets/voiceover-pack-fighter) | Kenney | CC0 |
| music-jingles | Jingles/stingers (17 files) | [Kenney — Music Jingles](https://kenney.nl/assets/music-jingles) | Kenney | CC0 |

**Synthesized (not sourced):** per-level ambient wind bed — generated at
runtime (filtered brown noise + LFO), see `src/render/audio.js` and the
rationale in [DECISIONS.md](DECISIONS.md). No other asset is synthesized.

Not shipped: Quaternius *Universal Base Characters* (CC0) was sourced and
inspected for the skinned-mesh attempt but cut with the pre-authorized
timebox fallback — nothing from the pack is in the repo or the build.
