// Level data — deterministic build recipe input (§5.3). Edit as data only.
export default {
  "name": "The Yard",
  "sky": "day",
  "killY": -8,
  "grappleAllowed": true,
  "statics": [
    { "id": "park", "shape": "box", "pos": [0, -1.2, -120], "size": [12, 1, 8], "tex": "concrete" },
    { "id": "ground", "shape": "box", "pos": [0, -0.5, 0], "size": [26, 0.5, 26], "tex": "grass" },
    { "id": "wallN", "shape": "box", "pos": [0, 0.6, 25.6], "size": [26, 0.6, 0.4], "tex": "wood" },
    { "id": "wallS", "shape": "box", "pos": [0, 0.6, -25.6], "size": [26, 0.6, 0.4], "tex": "wood" },
    { "id": "wallE", "shape": "box", "pos": [25.6, 0.6, 0], "size": [0.4, 0.6, 26], "tex": "wood" },
    { "id": "wallW", "shape": "box", "pos": [-25.6, 0.6, 0], "size": [0.4, 0.6, 26], "tex": "wood" },
    { "id": "seesawBase", "shape": "box", "pos": [-8, 0.35, 4], "size": [0.25, 0.35, 0.8], "tex": "metal" },
    { "id": "trampoline", "shape": "box", "pos": [7, 0.25, -6], "size": [1.6, 0.25, 1.6], "tex": "plate", "restitution": 1.7, "color": 3368703 },
    { "id": "frameL", "shape": "box", "pos": [-6.5, 1.5, -9], "size": [0.15, 1.5, 0.15], "tex": "metal" },
    { "id": "frameR", "shape": "box", "pos": [-2.5, 1.5, -9], "size": [0.15, 1.5, 0.15], "tex": "metal" },
    { "id": "frameTop", "shape": "box", "pos": [-4.5, 3.0, -9], "size": [2.2, 0.12, 0.12], "tex": "metal" },
    { "id": "climb1", "shape": "box", "pos": [12, 0.5, 6], "size": [1.2, 0.5, 1.2], "tex": "wood" },
    { "id": "climb2", "shape": "box", "pos": [14, 1.2, 6], "size": [1.2, 1.2, 1.2], "tex": "wood" },
    { "id": "climb3", "shape": "box", "pos": [16.5, 2.0, 6], "size": [1.2, 2.0, 1.2], "tex": "wood" },
    { "id": "padConstruction", "shape": "box", "pos": [-7, 0.08, 22], "size": [1.8, 0.08, 1.8], "tex": "plate", "color": 16741194 },
    { "id": "padDocks", "shape": "box", "pos": [0, 0.08, 22], "size": [1.8, 0.08, 1.8], "tex": "plate", "color": 4886527 },
    { "id": "padCastle", "shape": "box", "pos": [7, 0.08, 22], "size": [1.8, 0.08, 1.8], "tex": "plate", "color": 11170047 },
    { "id": "grapplePad", "shape": "box", "pos": [-14, 0.15, -14], "size": [1.2, 0.15, 1.2], "tex": "plate", "color": 16766020 }
  ],
  "dynamics": [
    { "id": "seesawPlank", "shape": "box", "pos": [-8, 0.85, 4], "size": [2.4, 0.08, 0.5], "mass": 24, "tex": "wood" },
    { "id": "bigBall", "shape": "ball", "pos": [3, 1.0, 8], "size": [0.85], "mass": 22, "color": 15881250, "restitution": 0.7 },
    { "id": "crateA", "shape": "box", "pos": [10, 0.45, -2], "size": [0.45, 0.45, 0.45], "mass": 12, "tex": "wood" },
    { "id": "crateB", "shape": "box", "pos": [11, 0.45, -3.2], "size": [0.45, 0.45, 0.45], "mass": 12, "tex": "wood" },
    { "id": "crateC", "shape": "box", "pos": [10.4, 1.35, -2.6], "size": [0.45, 0.45, 0.45], "mass": 12, "tex": "wood" },
    { "id": "swingSeat", "shape": "box", "pos": [-4.5, 0.8, -9], "size": [0.5, 0.06, 0.3], "mass": 8, "tex": "wood" }
  ],
  "ropes": [
    { "id": "swingRopeL", "from": [-4.9, 2.95, -9], "segments": 4, "length": 2.0, "anchor": "s:frameTop", "attach": "d:swingSeat" },
    { "id": "swingRopeR", "from": [-4.1, 2.95, -9], "segments": 4, "length": 2.0, "anchor": "s:frameTop", "attach": "d:swingSeat" }
  ],
  "joints": [
    { "id": "seesawHinge", "type": "revolute", "a": "s:seesawBase", "b": "d:seesawPlank", "anchor": [-8, 0.82, 4], "axis": [0, 0, 1], "limits": [-0.45, 0.45] }
  ],
  "checkpoints": [
    { "pos": [0, 0.1, -3], "size": [4, 2, 4] }
  ],
  "portals": [
    { "pos": [-7, 1.0, 22], "size": [1.8, 1.2, 1.8], "target": "construction", "label": "Site 7" },
    { "pos": [0, 1.0, 22], "size": [1.8, 1.2, 1.8], "target": "docks", "label": "Pier 4" },
    { "pos": [7, 1.0, 22], "size": [1.8, 1.2, 1.8], "target": "castle", "label": "Flopstone Keep" }
  ],
  "grappleZone": { "pos": [-14, 1.0, -14], "size": [1.2, 1.5, 1.2] }
}
;
