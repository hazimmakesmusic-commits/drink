# VOID — Enter the impossible.

A solo, interactive, psychedelic art piece that runs **entirely in the browser**. No server, no accounts, no paid services, no analytics.

## Open it
Double-click **`index.html`** (a single self-contained file). Works in current Chrome, Edge, Safari and Firefox on desktop and phone.
To try it on a phone, put `index.html` on any free static host (e.g. GitHub Pages, Netlify Drop, Cloudflare Pages).

## Worlds
1. **Liquid Dream** — a living chrome/glass organism. Double-tap changes its shape and palette.
2. **Cosmic Jelly** — translucent five-lobed jelly with silk veils; elastic, springy reactions.
3. **Melting Dimension** — warm, impossible architecture; your touches become gravity wells.

## Gestures
| Gesture | Effect |
|---|---|
| Tap | Wave of distortion through object + environment |
| Drag | Rotate / push the world (inertia) |
| Press and hold | Energy gathers at the touch point; release for a burst |
| Double-tap | Transform (shape, mood, or gravity flip) |
| Two-finger swipe, ← → keys, 1/2/3, or the three dots | Change world (portal transition) |
| `M` | Sound on/off |

Controls fade away when idle. The ◐ button reduces intensity (also on by default when the OS asks for reduced motion).

## Sound
Generated live in the browser (Web Audio) — no audio files, no licences. Starts after your first touch (browser rule); mute with the speaker icon.

## Quality
Auto-detects phone/desktop, and lowers resolution, bloom and particles if frame rate drops. `?q=low|mid|high` forces a tier.

## For developers (optional)
```
npm install
npm run build   # regenerates index.html from src/
npm run check   # TypeScript type-check
```
Stack: TypeScript, Three.js (MIT), custom GLSL, esbuild. Simplex noise by Ashima Arts / S. Gustavson (MIT).
