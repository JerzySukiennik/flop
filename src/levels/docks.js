// Level data — deterministic build recipe input (§5.3). Edit as data only.
export default {
  "name": "Pier 4",
  "sky": "sunset",
  "killY": -14,
  "water": { "y": 0.32, "min": [-30, -30], "max": [30, 60], "buoyancy": 1.05 },
  "statics": [
    { "id": "park", "shape": "box", "pos": [0, -1.2, -120], "size": [12, 1, 8], "tex": "concrete" },
    { "id": "seabed", "shape": "box", "pos": [0, -2.5, 20], "size": [30, 0.5, 42], "tex": "stone" },
    { "id": "pierStart", "shape": "box", "pos": [0, 0.7, 0], "size": [4, 0.5, 5], "tex": "wood" },
    { "id": "gantryA", "shape": "box", "pos": [0, 3.6, 7.5], "size": [0.18, 2.4, 0.18], "tex": "metal" },
    { "id": "gantryArm", "shape": "box", "pos": [0, 5.9, 9.5], "size": [0.15, 0.15, 2.4], "tex": "metal" },
    { "id": "pierTwo", "shape": "box", "pos": [0, 0.7, 15], "size": [3, 0.5, 3], "tex": "wood" },

    { "id": "craneBase", "shape": "box", "pos": [6.5, 3.2, 21], "size": [0.5, 3.0, 0.5], "tex": "metal" },
    { "id": "craneJib", "shape": "box", "pos": [2.8, 6.05, 21], "size": [4.2, 0.22, 0.22], "tex": "metal" },
    { "id": "pierThree", "shape": "box", "pos": [0, 0.7, 27], "size": [3, 0.5, 3], "tex": "wood" },

    { "id": "sluiceFrameL", "shape": "box", "pos": [-1.9, 2.0, 31.5], "size": [0.25, 1.4, 0.4], "tex": "concrete" },
    { "id": "sluiceFrameR", "shape": "box", "pos": [1.9, 2.0, 31.5], "size": [0.25, 1.4, 0.4], "tex": "concrete" },
    { "id": "sluiceTop", "shape": "box", "pos": [0, 3.5, 31.5], "size": [2.2, 0.25, 0.4], "tex": "concrete" },
    { "id": "valveBase", "shape": "box", "pos": [-2.6, 1.55, 29.5], "size": [0.15, 0.35, 0.15], "tex": "metal" },
    { "id": "pierFour", "shape": "box", "pos": [0, 0.7, 36], "size": [3, 0.5, 4], "tex": "wood" },

    { "id": "bridgeFrame", "shape": "box", "pos": [0, 4.4, 42.5], "size": [0.2, 2.2, 0.2], "tex": "metal" },
    { "id": "pierFinal", "shape": "box", "pos": [0, 0.7, 50], "size": [4, 0.5, 4], "tex": "wood" },
    { "id": "exitPadBase", "shape": "box", "pos": [0, 1.3, 52.5], "size": [1.6, 0.1, 1.6], "tex": "plate", "color": 7864183 }
  ],
  "dynamics": [
    { "id": "container", "shape": "box", "pos": [2.8, 3.4, 21], "size": [1.1, 0.7, 0.7], "mass": 160, "color": 13391190 },
    { "id": "valveWheel", "shape": "cylinder", "pos": [-2.6, 2.3, 29.5], "size": [0.09, 0.55], "mass": 8, "rot": [0, 0, 90], "tex": "metal" },
    { "id": "sluiceGate", "shape": "box", "pos": [0, 1.7, 31.5], "size": [1.6, 1.1, 0.12], "mass": 90, "tex": "plate" },
    { "id": "drawbridge", "shape": "box", "pos": [0, 3.2, 40.3], "size": [1.2, 0.08, 2.2], "mass": 70, "tex": "wood" },
    { "id": "counterweight", "shape": "box", "pos": [0, 1.6, 44.5], "size": [0.55, 0.55, 0.55], "mass": 60, "tex": "metal" },
    { "id": "raft", "shape": "box", "pos": [5, 0.5, 44], "size": [1.3, 0.18, 1.3], "mass": 40, "tex": "wood" }
  ],
  "ropes": [
    { "id": "swingRope", "from": [0, 5.75, 9.5], "segments": 7, "length": 4.2, "anchor": "s:gantryArm", "segmentMass": 2 },
    { "id": "craneChain", "from": [0.6, 5.9, 21], "segments": 4, "length": 1.8, "anchor": "s:craneJib", "attach": "d:container", "segmentMass": 4 },
    { "id": "bridgeRope", "from": [0, 6.5, 42.5], "segments": 5, "length": 2.6, "anchor": "s:bridgeFrame", "attach": "d:counterweight", "segmentMass": 2 }
  ],
  "joints": [
    { "id": "valveHinge", "type": "revolute", "a": "s:valveBase", "b": "d:valveWheel", "anchor": [-2.6, 2.3, 29.5], "axis": [1, 0, 0], "motor": { "target": 0, "stiffness": 4, "damping": 6 } },
    { "id": "sluiceSlide", "type": "prismatic", "a": "s:sluiceTop", "b": "d:sluiceGate", "anchor": [0, 1.7, 31.5], "axis": [0, 1, 0], "limits": [0, 1.9], "motor": { "target": 0, "stiffness": 30000, "damping": 3000 } },
    { "id": "bridgeHinge", "type": "revolute", "a": "s:pierFinal", "b": "d:drawbridge", "anchor": [0, 1.25, 46], "axis": [1, 0, 0], "limits": [-1.5, 0.06] }
  ],
  "valves": [
    { "id": "sluiceValve", "joint": "valveHinge", "turns": 9.4, "gateJoint": "sluiceSlide",
      "gateMotor": { "closed": 0, "open": 1.9, "stiffness": 30000, "damping": 3000 } }
  ],
  "checkpoints": [
    { "pos": [0, 1.3, 0], "size": [4, 1.6, 5] },
    { "pos": [0, 1.3, 15], "size": [3, 1.6, 3] },
    { "pos": [0, 1.3, 27], "size": [3, 1.6, 3] },
    { "pos": [0, 1.3, 36], "size": [3, 1.6, 4] },
    { "pos": [0, 1.3, 50], "size": [4, 1.6, 4] }
  ],
  "portals": [
    { "pos": [0, 2.3, 52.5], "size": [1.6, 1.1, 1.6], "target": "hub", "label": "Back to the Yard" }
  ]
}
;
