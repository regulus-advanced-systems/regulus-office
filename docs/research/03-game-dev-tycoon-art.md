# Research: Game Dev Tycoon visual style (art-direction reference)

Research date: 2026-09-28. Reference screenshots are Greenheart Games' copyright and are NOT committed here. View them at https://store.steampowered.com/app/239820/ and the press kit http://greenheartgames.com/press/game_dev_tycoon/images/ ; ripped level backgrounds at https://www.spriters-resource.com/pc_computer/gamedevtycoon/ .

## 1. Camera / perspective
- True 30° isometric, 2D pre-drawn art (2.5D look, zero real 3D). Floor/wall base edges measured at 30.1-30.3° (tan 30° = 0.577), NOT the 2:1 pixel-art dimetric. In 3D terms: orthographic camera, yaw 45°, pitch down 35.264°.
- Fixed camera: no rotation, zoom or pan (desktop). Each office is one static "dollhouse" room: two back walls full height, two front walls cut to a low stub (~40-60 px) with a dark grey top cap; you look in from the south corner. The exterior face of the front-left stub wall shows the company name in large light-grey italic sans.
- Room centred with a large cream margin; HUD lives in that margin (top-centre, top-right). Room ≈ 56% of viewport width at 16:9, nearly full height.
- Level 4 is larger than the viewport and pans to the active zone.
- Painter's-algorithm layering: room background → furniture → workstations → characters → bubbles → HUD/dialogs.

## 2. Rendering / technology
- Plain HTML/JS/CSS in node-webkit (NW.js 0.8.6 for Steam), not Impact.js. Libraries: CreateJS/EaselJS (counter), jQuery + UI + Transit, SimpleModal, GSAP, Font Awesome. Font: Open Sans.
- Each office level is a single pre-composited PNG background (walls, floor, rugs, shelves, posters, kitchenette, CEO desk baked in); only workstation PCs, staff sprites, bubbles and name labels are separate layers. Animation = sprite-frame swaps or CSS/GSAP tweens (position, small wiggle, scale). UI is ordinary HTML/CSS.
- Art is digitally painted / vector-ish 2D illustration, smooth anti-aliased edges, not pixel art.

## 3. Art style details
Overall: warm, clean, friendly, toy-like "dollhouse" office. High saturation on floors/accent walls; cream/beige neutrals elsewhere. Mid-2000s web-illustration / Dribbble isometric icon look.

Palette (approximate hex):
- Viewport background: cream `#FFF6D9` with a soft radial vignette to darker tan at corners. THE signature colour.
- Garage: sage-green mottled walls `#B0D090`/`#90B070`, grey concrete floor `#A8A8A8`, teal rug `#70AFA4`, orange-brown wood `#B37A43`-`#905010`, wall cap `#55565A`.
- Office 2: teal carpet `#30B090`/`#50B090` with subtle scallop pattern, cream-yellow walls `#F0E0B0`-`#F0D0B0` with painted grime, wood `#905010`-`#C07020`, grey-purple filing cabinets `#6B6580`, beige CRTs `#EDE6D3` with royal-blue screens `#0000C0`, exterior wall tan `#D8B470`.
- Office 3: light oak plank floor `#D09050`/`#F0B070`, sky-blue wall `#3FA3E0`, orange wall `#F08030`, brick-red exterior `#903030`, red rug `#B03030`, turquoise bean bags `#1D8FB0`.
- Office 4: zoned floors lime `#7FBF3F`, mustard `#D9A03A`, orange `#E8803A`; crimson walls `#C0393B`; green screen `#20E020`.
- HUD accents: Bugs `#F26522`; Design `#F5A623`; Technology `#2DBFE8`; Research `#1E6FE0`; Hype `#B83159`; progress bar navy `#01008C` on grey `#A0A0A0`; cash green `#2E9E3E`.
- Dialogs: fill `#FFF9EF`, 3-4 px golden border `#F5C542` with cream outer glow, thin navy title rule; primary button gradient `#FA9F1A → #F47F20` white text; destructive `#E0303C`. Slider fills `#FF6766` / `#66FF66` / `#6665FE`.

Outlines: none. Shapes separated by value contrast and thin darker edges of the same hue; only wall caps and object shadows are strong dark lines.

Shading: soft painterly gradients (airbrush). Flat base colour per face plus light-to-dark gradient; smooth rounded shading on cylinders; walls have painted grime/streaks (not tiled textures); floors have subtle noise/pattern. Shadows: soft low-opacity blobs under objects (AO style) plus a longer soft shadow toward south-east. No hard cast shadows, no specular except tiny glints on screens/glass. Think toon shading with one soft ramp and baked AO.

Proportions: cartoon adults ~4.5-5 heads tall, slightly oversized heads/hands, thin limbs. Furniture at believable proportion.

Props: thick wooden slab desks with rounded corners; CEO L-shaped desk; staff share one big table with 4 beige CRTs (tower + monitor + keyboard + coiled cables + mugs + sticky notes), upgraded to black LCDs later; black mesh office chairs; wooden dining chairs; bean bags; windows in white frames with blurred foliage; Pong chalkboard; corkboard with sticky notes; movie-style posters; whiteboard with scribbles; wall signs ("R&D Lab"); potted palms in terracotta; filing cabinets; bookshelves with coloured spines; water cooler; microwave/sink/fridge; bistro table; CRT TV + console; foosball; lounge pool; green-screen set with lights.

Lighting: flat ambient, gentle top-left key, floor brighter toward centre, no time-of-day, no dynamic lights. Cream vignette sells a "spotlit diorama".

## 4. Layout progression & work visualisation
- Level 1 garage (1 person): grey concrete floor, sage walls, small wooden desk with CRT, bookshelf, Pong chalkboard, pegboard, workbench, DeLorean under a blue tarp. Player faces the back wall (we see the back of their head).
- Level 2 office (player + 4): cream walls with 4 windows per back wall, teal carpet, one big table with 4 CRTs (two facing away, two facing camera), CEO L-desk front-right, filing cabinets and palms left, water cooler/bistro table/kitchenette back-right, meeting table with 6 chairs and CRT TV right, coffee table front-left, double glass door with keypad on exterior wall.
- Level 3: same footprint re-skinned (wood floor, blue + orange walls, LCDs, GOALS sticky board, whiteboard, bean-bag lounge).
- Level 4: much larger multi-zone building with R&D and Hardware labs, foosball, lounge pool, mocap green screen.
- Seating: fixed seats; new hires take the next free seat. Seated characters drawn at iso angle, some back-to-camera, some facing. Chair is a separate sprite.
- Name labels: printed ON THE FLOOR next to the seat, large semi-transparent dark-grey bold sans, rotated to the iso axis (a floor decal, not a floating tag).
- Animations (minimal): typing (hands bob, head moves), drinking from a mug, idle wiggle, walking (few frames), whiteboard drawing, camera operating, mocap posing. Absent = disappears.
- Work visualisation: floating coloured bubbles (~20-28 px at 1080p, flat colour with darker rim) emitted from workstations: orange = Design, cyan = Technology, dark blue = Research, orange-red = Bugs. They drift upward with sway, sometimes carry a number, fly to the HUD counter which increments. No per-employee bars in the scene; progress lives in the HUD and dialogs.

## 5. UI style
- Flat web UI, Open Sans (light for titles, regular/bold for values), charcoal `#333` text, white space, rounded boxes, subtle 2012-era gradients.
- Top-centre HUD: wide white rounded rectangle with project name (~30 px light), genre (16 px), navy-on-grey progress bar with stage name. Flanked by coloured circles with 2 px black outline and count inside, each with a small rectangular label tab joined by a thin line. Greys to ~30% with "No Project" when idle.
- Top-right status box: white rounded panel: "93.7K Fans  Y10 M2 W1", "Cash: 4.3M" in green.
- Modals: centred, warm off-white, thick golden border with cream glow, large light title (~40 px) with thin navy rule, round white "X" with orange rim overlapping top-right. Vertical sliders, stacked allocation bar, orange gradient primary button, red destructive button. Scene dims with cream/grey overlay + slight blur.
- Staff cards: white with green efficiency bar, bold name, "Design: 500" amber, "Tech.: 338" blue.
- Notifications are golden-bordered modals with an icon, not in-scene speech balloons.

## 6. Character design
- Cartoon humans ~4.5-5 heads tall, rounded heads, dot eyes, simple noses, hair as solid shapes with 1-2 highlights, no outlines, soft shading. Simple clothes. Seated ~110-130 px tall at 1080p, standing ~150-170 px.
- CEO customizable (gender, skin/hair, clothing colours); staff from a small pre-drawn pool.

## 7. Asset dimensions
- Level sheets: Garage 1434x1146; Office 1 and 2 both 2372x1348 (same footprint). Office room is asymmetric (deeper on the right). Shown at ≈0.75x on 1080p, so source art is authored above 1080p.
- Back wall ≈ 316 px (garage) / 250 px (office); front stubs ≈ 45 px + 12-15 px dark cap. Floor edge slope exactly tan 30°.

## 8. Reproducing the look in a web engine (with FPV toggle)
Recommendation: real 3D scene in Three.js/R3F with an OrthographicCamera locked to GDT's angle for third-person and a PerspectiveCamera for first-person. Do NOT use a 2D iso sprite engine if FPV is required (it would need a second renderer and duplicate assets).

- Camera: orthographic, yaw 45°, pitch -35.264° (`camera.position.set(1,1,1).normalize().multiplyScalar(D); camera.lookAt(center)`), fixed yaw, optional slight zoom. `scene.background = 0xFFF6D9` plus a radial-gradient vignette. Snap the frustum so the room fills ~55-60% of the width.
- Room: box with only the two back walls full height; front walls are 0.4 m stubs with a dark grey cap. In FPV swap in full-height front walls (toggle visibility).
- Shading: `MeshToonMaterial` with a 3-4 step gradient map (or custom soft-ramp shader) + baked/SSAO ambient occlusion + soft contact shadows. One hemisphere light (warm sky, tan ground) + one directional key from upper-left; no specular. Skip outline passes (GDT has none); at most a faint darker-hue edge.
- Textures: flat colours with a tileable grime/noise decal multiplied at ~10-15% over walls/floors; carpet/wood as large-scale simple patterns.
- Bubbles: `THREE.Sprite` or CSS2D circles spawned at workstations, tween upward with sine sway, then fly to HUD counters in screen space.
- HUD/dialogs: plain HTML/CSS overlay with Open Sans and the exact hex values above (most faithful path since GDT's UI was HTML).
- Name decals: planar text on the floor at ~40% opacity rotated to the iso axis, or CSS2DObject.
- Characters: low-poly rigged glTF robots with the same toon material; clips idle / typing / walk / drink / wave; seated pose parented to the chair.
- Toggle: keep both cameras; tween ortho→perspective or crossfade; enable pointer-lock.
- Render at 1x, `NoToneMapping`, sRGB, no post except optional FXAA + subtle vignette.

## 9. Open-license asset packs
Furniture / props (CC0 unless noted):
- Kenney Furniture Kit (~140 models, glTF, also iso renders): https://kenney.nl/assets/furniture-kit
- Kenney Mini Arcade: https://kenney.nl/assets/mini-arcade
- KayKit Furniture Bits: https://kaylousberg.itch.io/furniture-bits ; Prototype/Resource Bits; KayKit Character Animations (idle, sit, walk, interact): https://kaylousberg.itch.io/kaykit-character-animations
- Poly Pizza "The Office Pack" bundle (mixed CC0/CC-BY, 127 models incl. whiteboard, standing desk, vending machine): https://poly.pizza/bundle/The-Office-Pack-UGIy7YcQP9
- Poly Pizza Elevator (CC-BY): https://poly.pizza/m/aZ7y77mq_u6 ; Boombox / Record player / Speaker (CC-BY) for jukebox inspiration; no CC0 jukebox found (model one: box + arch + coloured strips).
- Eclair Assets Furniture Kit GLB Pack (CC0 re-export of Kenney): https://eclair-assets.itch.io/furniture-kit-glb-pack-140-free-cc0-3d-models

Cute robot characters:
- Quaternius Animated LowPoly Robot (CC0): round-headed robot, 14 animations incl. sitting, wave, thumbs up, dance. Best single fit. https://quaternius.itch.io/lowpoly-robot , glTF https://poly.pizza/m/QCm7qe9uNJ
- Quaternius Universal Base Characters + Universal Animation Library (CC0) for retargeting.
- Kenney Blocky Characters (CC0, 27 animations, Minecraft-ish silhouette) retexturable as robots: https://kenney.nl/assets/blocky-characters
- Poly by Google Robot (CC-BY): https://poly.pizza/m/9A6cuitiB_4
- Curated CC0 lists: https://github.com/madjin/awesome-cc0

Licence notes: Kenney, KayKit, Quaternius = CC0. Poly by Google and most dook models = CC-BY (credit in an about screen). Check each Poly Pizza model page.

## Sources
- https://en.wikipedia.org/wiki/Game_Dev_Tycoon
- https://www.greenheartgames.com/credits/game-dev-tycoon/
- https://forum.greenheartgames.com/t/how-was-game-dev-tycoon-programmed/19620
- https://gamedevtycoon.fandom.com/wiki/Unlocks
- https://github.com/greenheartgames/gdt-modAPI/wiki
