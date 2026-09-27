# 🧀 Cheese Chase! — Cat & Mouse Cartoon Game

A **100% offline**, single-file browser game starring **Whiskers the cat** and **Cheddar the mouse**
(original characters inspired by classic cat-and-mouse cartoon chases).

> No internet needed. No installs. No dependencies. One HTML file — download it, double-click it, play.

## 🎮 Play it

- **Easiest:** open `index.html` in any modern browser (Chrome, Edge, Firefox, Safari, mobile browsers).
- Or serve the folder: `python3 -m http.server 8080` → http://localhost:8080

## 🕹️ What's inside

**3D Worlds** (custom hand-written WebGL engine — no libraries!)
- 🛋️ **Living Room** — sofas, rug, bookshelf, TV… and a sneaky cat
- 🍳 **Kitchen** — counters, fridge, stove, snap traps
- 🌳 **Garden** — trees, pond, flowers, sunset
- Explore in real 3D with a chase camera, blob shadows, fog, animated characters built from scratch

**2D Worlds** (Canvas platformer with hand-drawn vector cartoon art)
- 🛋️ **Living Room Run**, 🍳 **Kitchen Climb**, 🌳 **Garden Gala**
- Double-jump platforming with a cat chasing you from behind, checkpoints, parallax backgrounds

**Gameplay:** grab all the cheese, then dash to your mouse hole. Dodge Whiskers —
he patrols, spots you, and hunts you down. Mousetraps stun you (and he *hears* the snap!).
Slip **under** tables where the cat can't follow, hop over traps, sprint with stamina.

## ⌨️ Controls

| Action | Keys |
|---|---|
| Move | `WASD` / Arrows (or on-screen joystick on touch) |
| Jump / hop (over traps!) | `Space` (twice = double jump in 2D) |
| Sprint | `Shift` |
| Pause | `P` / `Esc` |
| Restart level | `R` |
| Sound on/off | `M` |

## 📁 Project layout

```
index.html      ← THE GAME (self-contained, ~130 KB)
src/            ← readable source (concatenated by build.sh)
  00-core.js    utils, save game, input (keyboard+touch), procedural WebAudio SFX & music
  11-render3d.js  hand-rolled WebGL renderer (mat4, meshes, fog, shadows)
  12-world3d.js   3D characters, 3 levels, cat AI, physics, particles
  20-game2d.js    2D platformer engine + levels + vector art
  30-main.js      menus, HUD, state machine, game loop
tools/smoke.js  headless test harness (node tools/smoke.js)
build.sh        rebuilds index.html from src/
```

## 🛠️ Development

```bash
./build.sh            # rebuild index.html from src/
node tools/smoke.js   # run headless gameplay smoke tests
```

Everything (graphics, sound, music) is generated procedurally in code — no assets, no network calls,
works from `file://`. Progress & best times are saved in `localStorage` (when the browser allows it).

*Note: Tom & Jerry are copyrighted Warner Bros. characters — this game uses original
characters in the same beloved cat-and-mouse chase spirit instead.*
