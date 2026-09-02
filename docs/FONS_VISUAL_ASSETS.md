# FONS — visual assets brief

The site is built so that it is **complete without a single photograph**. Every
background is a CSS gradient, every object is SVG. The assets below are upgrades
that drop into fixed paths and layer on top; a missing file never breaks a page.

Fill them in the order listed — the first two change the most.

---

## 1. Backgrounds

### 1.1 Page scene (highest impact)

**Path:** `web/public/assets/scene/meadow.webp`
**Size:** 2880 × 1800, WebP, quality 82, under 400 KB
**Wire it up:** in `web/src/styles/base.css` set

```css
.scene { --scene-image: url("/assets/scene/meadow.webp"); --scene-opacity: 0.55; }
```

The layer is already masked so it fades out by 78% down the page and never
fights the text.

> **Prompt**
> A wide photographic landscape of a soft green meadow at early morning, shot on
> a medium-format camera with a 50mm lens at f/4. Low rolling hills recede into
> pale mist on the horizon. Fine grass in the foreground, a scattering of small
> white daisies, tiny dew highlights catching the light. The sun is just above
> the hills behind a thin haze, so the whole frame is bright, low-contrast and
> slightly overexposed toward the top. Colour palette: pale sage green, warm
> cream, soft off-white sky, no saturated colour anywhere. No people, no
> animals, no buildings, no path, no trees in the centre. Calm, clean, minimal,
> lots of empty sky in the upper half for text to sit over. Natural light,
> photorealistic, no HDR, no vignette, no filter. 16:10 aspect ratio.

### 1.2 Footer horizon (optional)

**Path:** `web/public/assets/scene/horizon.webp`
**Size:** 2400 × 900

> **Prompt**
> A very wide, very soft photograph of distant hills at sunrise, seen through
> morning haze. Almost abstract: three or four overlapping bands of pale green
> and warm grey fading into a cream sky. Extremely low contrast, no detail in
> the foreground, no sharp edges. Shot on a long lens so the layers compress.
> Colour palette: sage, oat, warm white. Photorealistic, natural light, no
> vignette. 8:3 aspect ratio.

### 1.3 Animated background (optional, from fragcoord.xyz)

If you want motion instead of a photograph, pick a shader from
<https://fragcoord.xyz/explore> that is **slow, pale and low-contrast** — look
for soft caustics, flowing gradients or gentle noise fields. Avoid anything dark,
neon or fast; it will fight the glass.

To use one I need from you:

- the **GLSL fragment shader source** (copy it out of the site), and
- confirmation of its **licence** — I will record it in `docs/THIRD_PARTY_UI.md`

I would render it in a small raw-WebGL canvas, which adds no dependency
(`three` and `@splinetool` stay forbidden per `AGENTS.md`). It would pause
off-screen, in a hidden tab, and under `prefers-reduced-motion`, like every other
loop in the app. Budget: it must hold 60fps on an integrated GPU or it does not
ship.

---

## 2. Glass objects

The interface draws its own glass mark in SVG, so these are optional set-dressing
for the landing page.

### 2.1 The mark as a rendered object

**Path:** `web/public/assets/brand/mark-glass.webp` — 1600 × 1600, transparent

> **Prompt**
> Two interlocking rings made of thick clear glass, overlapping like a Venn
> diagram, standing upright. The left ring is tinted warm amber-gold, the right
> ring is tinted cool pale blue. Where they overlap, a small perfectly clear
> glass bead sits at the intersection, catching a bright specular highlight.
> Studio product photography on a plain very light warm-grey background, soft
> large diffused light from the upper left, gentle contact shadow beneath.
> Photorealistic thick glass with visible refraction, caustics and internal
> reflections. Minimal, calm, premium. Square composition, object centred with
> generous empty margin.

### 2.2 The character, restyled in glass (optional)

The hooded figure from the previous design is **parked, not deleted** — the
component is still at `web/src/components/brand/BornMascot.tsx`. He does not fit
this visual language as brown ink, but he would as glass. If you want him back,
generate this and tell me; I will wire him in beside the mark.

**Path:** `web/public/assets/brand/born-glass.webp` — 1200 × 1800, transparent

> **Prompt**
> A small hooded figure sculpted entirely from thick clear glass, standing
> upright, seen from the front. Long simple robe with a deep hood; the hood
> opening is empty and dark, like an unfilled cavity in the glass. No face, no
> hands. The whole form is smooth and rounded with soft edges, faintly tinted
> pale sage green, with strong refraction, caustics and bright specular
> highlights along the shoulders and hood edge. Studio product photography on a
> plain very light warm-grey background, large soft diffused light from the upper
> left, subtle contact shadow at the feet. Photorealistic glass sculpture, calm
> and quiet, no text. Vertical composition, generous empty margin.

---

## 3. Logo — three directions

Same brief for all three: a mark for **FONS**, a Solana launchpad where two
existing tokens are mixed into one new one. It must read at 24 px in a browser
tab and hold up at billboard size. Deliver on a transparent background, square,
2048 × 2048.

Ask for **one object, centred, no text in the image** — the wordmark is set
separately in the interface.

### Direction A — "The bead"

Two things become one; the mark is the moment they touch.

> **Prompt**
> A logo object: two thick glass rings of equal size overlapping side by side
> like a Venn diagram, standing upright. The left ring is tinted warm honey
> amber, the right ring cool pale blue-grey. At the intersection sits a single
> small perfectly clear glass sphere, brighter than everything around it, with a
> sharp specular highlight. Studio product render on a plain very light warm
> background, soft large diffused key light from the upper left, faint contact
> shadow. Photorealistic glass with visible refraction and caustics. Extremely
> minimal, no text, no background scenery. Symmetrical, centred, square
> composition with wide empty margin. Premium, calm, quiet.

### Direction B — "The seed"

Softer and more organic: the launchpad as something that grows rather than fires.

> **Prompt**
> A logo object: a single teardrop-shaped seed sculpted from thick clear glass,
> standing upright, with two slender glass leaves curving away from its base in
> opposite directions — one leaf tinted warm amber, one tinted cool pale blue.
> The seed body is clear with a bright core highlight, as if light is caught
> inside it. Studio product render on a plain very light warm-grey background,
> large soft diffused light from above left, gentle contact shadow. Thick
> photorealistic glass, strong refraction, subtle caustics on the surface below.
> Minimal, botanical, calm. No text, no soil, no pot. Centred, square
> composition with generous empty margin.

### Direction C — "The lens"

The most abstract and the most scalable: a mark that reads as a single glyph.

> **Prompt**
> A logo object: a thick lens-shaped disc of clear glass, seen at a slight
> three-quarter angle so its depth is visible, with a single perfectly round
> hole through its centre. The glass body is faintly tinted pale sage green; a
> warm amber highlight catches the upper left edge and a cool blue reflection the
> lower right, so the two colours meet inside the same object. Studio product
> render on a plain very light warm background, large soft diffused light, faint
> contact shadow. Photorealistic thick glass, refraction visible through the
> hole. Extremely minimal and geometric, no text. Centred, square composition
> with wide empty margin.

**How to choose:** shrink each to 24 px before deciding. A keeps the product
story most literally, C survives shrinking best, B is the warmest and the least
crypto-looking.

---

## 4. What I did not need

- **No icon set.** Every glyph in the interface is inline SVG or a mono glyph.
- **No illustration set.** The process steps are CSS glass stones.
- **No photography of people or product screens.**
- **No new font.** The system uses Geist (display and UI) and IBM Plex Mono
  (labels), both already self-hosted via Fontsource. Instrument Serif and Space
  Grotesk are no longer imported.

---

## 5. Constraints any asset must respect

- **CSP:** `img-src 'self' data: blob: https:` — assets must be committed to the
  repo, not hot-linked from a CDN. `script-src 'self'`, so no remote embeds.
- **Weight:** the landing page budget is 500 KB of imagery total. WebP, not PNG,
  for anything photographic.
- **No dark frames.** This palette has no black. If an image comes back with a
  dark or saturated background it will punch a hole in the page.
- **Reduced motion:** anything animated must have a still fallback.
