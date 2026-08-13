# Umbra

Interactive atlas of solar eclipses, computed entirely in the browser — no server, no build step, no dependencies.

**Live site: https://germaincasse.github.io/Umbra/**

## Features

- Shadow paths on a world map or an orthographic globe, from year −1999 to 3000
- Sun and Moon positions from the Meeus series; Besselian elements derived directly from the geometry; ΔT after Espenak & Meeus
- Local circumstances at any point (type, magnitude, obscuration, duration) — click anywhere on the map
- Shadow animation, timeline ribbon, GeoJSON export of the computed paths
- Interface in French and English (FR/EN toggle, top of the sidebar)

## Structure

| File | Role |
|---|---|
| `index.html` | markup |
| `css/style.css` | styles |
| `js/geodata.js` | coastline and border polylines |
| `js/engine.js` | astronomy engine: Sun, Moon, Besselian elements, ΔT, central paths, local circumstances |
| `js/i18n.js` | interface strings (FR/EN) |
| `js/app.js` | interface: rendering, projections, interactions |

Open `index.html` in a browser — that is all it takes.

## Accuracy

Typical deviation from the NASA canon is a few tens of kilometres on the path for the modern era, growing to more than that beyond a few centuries from the present.
