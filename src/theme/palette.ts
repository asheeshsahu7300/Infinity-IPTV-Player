/**
 * The Apple system palette, dark appearance.
 *
 * These are Apple's own published dark-mode values, not approximations of
 * them. They exist as a module of their own — rather than as more entries in
 * `THEME.colors` — because they are *reference data*: the point of naming a
 * colour `systemRed` is that it is the same `systemRed` everywhere, and a
 * value nobody may retune locally belongs somewhere nobody is tempted to
 * retune it.
 *
 * `THEME.colors` in `tokens.ts` is now a thin semantic layer over this file:
 * it says what a colour is *for* ("the focus ring", "muted body text") and
 * this file says what the colour *is*. Call sites should generally reach for
 * the semantic name; reach in here directly only for the status colours
 * (`systemRed` and friends), which have no semantic alias because their
 * meaning is already their name.
 *
 * ── Why dark-only ──
 * `app.json` sets `userInterfaceStyle: "automatic"`, but this app has never
 * had a light appearance and must not grow one by accident: it is a video
 * player whose content is letterboxed against the chrome, and a light chrome
 * around a dark picture is a worse experience than a consistently dark one on
 * every device it ships to. So there is one appearance here, and it is the
 * dark one. If a light tier is ever wanted, it belongs as a second export in
 * this file plus a resolver — not as useColorScheme() checks scattered across
 * forty screens.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * Tint
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The accent, and the single most load-bearing colour in the app.
 *
 * Achromatic, and deliberately so. This is the **tvOS** accent idiom rather
 * than the iOS one: Apple tints iOS with systemBlue, but on tvOS a focused
 * control fills near-white and inverts its label to dark, because the display
 * is metres away and a saturated hue cannot carry focus at that distance.
 * This app is a television app first, so it takes the television convention.
 *
 * `#F5F5F7` is Apple's own off-white — the one under their marketing pages —
 * rather than pure `#FFFFFF`. The two-point drop off white matters more than
 * it sounds on an OLED or a plasma: a full-white fill of any size blooms into
 * the black around it, and the off-white sits just below that threshold while
 * still reading as white.
 *
 * Note that `label` is pure `#FFFFFF` and this is not. That is not an
 * inconsistency — text is thin strokes on a dark ground and wants every scrap
 * of contrast, whereas this is a large filled area and wants slightly less.
 */
export const tint = '#F5F5F7';

/**
 * The tint at full strength, for a focused fill that has to beat a selected
 * one sitting next to it.
 *
 * Selection and focus are frequently both on screen — the category you are in
 * and the category the cursor is over — and with one accent they need two
 * steps. `tint` is the selected step and this is the focused one.
 */
export const tintStrong = '#FFFFFF';

/**
 * Ink that goes **on** a tint fill.
 *
 * This is the half of the pair that is easy to forget, and forgetting it is
 * invisible in code review and catastrophic on screen: an off-white fill with
 * `label` on top is white on white. Anywhere `tint` is used as a
 * `backgroundColor`, the text and glyphs above it take this.
 *
 * `#1C1C1E` rather than pure black, matching `systemGray6`, so the inverted
 * state reads as the palette's own dark rather than as a hole in the screen.
 */
export const onTint = '#1C1C1E';

/** Ink on a tint fill, one level down — the supporting line under a title. */
export const onTintSecondary = 'rgba(28, 28, 30, 0.65)';

/**
 * Tint at low alpha — selection washes, focus glows, tinted fills.
 *
 * White-based, so these lighten whatever is beneath rather than colouring it.
 * A wash at this alpha is how a surface says "active" without going all the
 * way to a filled, inverted state.
 */
export const tintFill = 'rgba(255, 255, 255, 0.16)';
export const tintFillStrong = 'rgba(255, 255, 255, 0.26)';
export const tintGlow = 'rgba(255, 255, 255, 0.45)';

/* ────────────────────────────────────────────────────────────────────────────
 * Status colours
 *
 * Dark-appearance values throughout. Several of these replace Tailwind
 * defaults that had drifted into the codebase (`#4ade80`, `#fbbf24`,
 * `#f87171`, `#22c55e`, `#ef4444`, `#dc2626`) — six different greens, ambers
 * and reds doing three jobs.
 *
 * **There is deliberately no `systemBlue` here, and no blue of any kind.**
 * Apple's own ramp includes one and this app does not want it: the accent is
 * achromatic (see `tint` above), and a blue defined but unused is an invitation
 * to reintroduce the thing that was removed. Status colours only — if a value
 * is not communicating success, warning or failure, it should be reaching for
 * `tint` or for one of the label levels, not for a hue.
 * ──────────────────────────────────────────────────────────────────────────*/

export const systemRed = '#FF453A';

/**
 * systemRed for ink sitting **on the off-white tint**, not on the dark ground.
 *
 * `systemRed` is a dark-appearance value, tuned to carry against black. On the
 * tint fill it manages about 2.9:1 — legible enough to notice, not enough to
 * read comfortably, which matters most for the one case that uses it: a
 * destructive row under the cursor, where the viewer is about to press OK.
 *
 * This is the same relationship `onTint` has with `label`: a colour needs a
 * second value once the ground inverts. It is the only status colour that does,
 * because red is the only one this app ever puts on the tint.
 */
export const systemRedOnTint = '#B3251B';
export const systemOrange = '#FF9F0A';
export const systemYellow = '#FFD60A';
export const systemGreen = '#32D74B';
// systemMint, systemTeal, systemCyan and systemIndigo are omitted along with
// systemBlue, for the same reason: they are the blue end of Apple's ramp and
// this app is achromatic apart from the three status colours above. The one
// place that had reached for cyan was a decorative clock glyph, which now
// takes `secondaryLabel` — it was never communicating anything by being blue.
export const systemPurple = '#BF5AF2';
export const systemPink = '#FF375F';
export const systemBrown = '#AC8E68';

/* ────────────────────────────────────────────────────────────────────────────
 * Greys
 *
 * Apple's dark-appearance grey ramp. `systemGray6` is the *lightest* here and
 * the darkest in the light appearance — the ramp inverts between appearances,
 * which is why the numbers look backwards next to the light-mode ones people
 * usually have memorised.
 * ──────────────────────────────────────────────────────────────────────────*/

export const systemGray = '#8E8E93';
export const systemGray2 = '#636366';
export const systemGray3 = '#48484A';
export const systemGray4 = '#3A3A3C';
export const systemGray5 = '#2C2C2E';
export const systemGray6 = '#1C1C1E';

/* ────────────────────────────────────────────────────────────────────────────
 * Backgrounds
 *
 * Two families, and picking the wrong one is the usual cause of a dark UI
 * looking muddy. `systemBackground` is for screens whose content sits directly
 * on the ground; `elevatedSystemBackground` is for content in a *raised*
 * container — a sheet, a popover, a card — which Apple lightens rather than
 * shadows, because a shadow is invisible on black.
 *
 * This app's ground stays pure black rather than moving to Apple's near-black:
 * it is a video player, and black chrome beside letterboxed video is the one
 * case where pure black is exactly right.
 * ──────────────────────────────────────────────────────────────────────────*/

export const systemBackground = '#000000';
export const secondarySystemBackground = '#1C1C1E';
export const tertiarySystemBackground = '#2C2C2E';

export const elevatedSystemBackground = '#1C1C1E';
export const secondaryElevatedSystemBackground = '#2C2C2E';
export const tertiaryElevatedSystemBackground = '#3A3A3C';

/* ────────────────────────────────────────────────────────────────────────────
 * Labels — the text hierarchy
 *
 * Four levels, and the alphas are the whole point: Apple's secondary and
 * tertiary label are not *grey text*, they are white-ish text at reduced
 * opacity, so they stay correctly related to whatever is behind them. Over
 * glass in particular, a flat `#B8B8B8` reads as a different colour from the
 * surface it sits on, while `rgba(235,235,245,0.6)` reads as the same colour
 * turned down.
 *
 * The `235,235,245` base is not white — it is very slightly blue, which is
 * what keeps large areas of secondary text from looking warm against a neutral
 * dark ground.
 *
 * Use `label` for anything that must be read, `secondaryLabel` for supporting
 * copy, `tertiaryLabel` for placeholders and disabled text, and
 * `quaternaryLabel` only for what is nearly decoration — separator glyphs,
 * empty-state watermarks.
 * ──────────────────────────────────────────────────────────────────────────*/

export const label = '#FFFFFF';
export const secondaryLabel = 'rgba(235, 235, 245, 0.60)';
export const tertiaryLabel = 'rgba(235, 235, 245, 0.30)';
export const quaternaryLabel = 'rgba(235, 235, 245, 0.18)';

/** Placeholder text in a field. Apple gives this its own name, equal to tertiary. */
export const placeholderText = 'rgba(235, 235, 245, 0.30)';

/* ────────────────────────────────────────────────────────────────────────────
 * Fills
 *
 * For shapes *behind* content: the grey capsule under a segmented control, the
 * track of a slider, the resting state of a soft button. Built on
 * `120,120,128` — a neutral that reads the same over light and dark — rather
 * than on white, so a fill does not brighten as it is layered.
 *
 * Not to be confused with the material fills in `materials.ts`: those describe
 * *glass*, these describe an opaque-ish shape drawn on top of one.
 * ──────────────────────────────────────────────────────────────────────────*/

export const systemFill = 'rgba(120, 120, 128, 0.36)';
export const secondarySystemFill = 'rgba(120, 120, 128, 0.32)';
export const tertiarySystemFill = 'rgba(118, 118, 128, 0.24)';
export const quaternarySystemFill = 'rgba(116, 116, 128, 0.18)';

/* ────────────────────────────────────────────────────────────────────────────
 * Separators
 * ──────────────────────────────────────────────────────────────────────────*/

/** A hairline you can see through — for rules *inside* a grouped surface. */
export const separator = 'rgba(84, 84, 88, 0.65)';
/** A hairline you cannot see through — for rules between opaque surfaces. */
export const opaqueSeparator = '#38383A';

/* ────────────────────────────────────────────────────────────────────────────
 * Glass edges
 *
 * The specular treatment that makes a translucent surface read as a physical
 * pane rather than as a tinted rectangle. Apple's glass is not bordered
 * uniformly: light catches the *top* edge and falls off, so a single even
 * border is the thing that most reliably makes hand-rolled glass look flat.
 *
 * `glassEdge` is the all-round hairline and `glassEdgeHighlight` the brighter
 * top specular that `GlassSurface` draws over it.
 * ──────────────────────────────────────────────────────────────────────────*/

export const glassEdge = 'rgba(255, 255, 255, 0.12)';
export const glassEdgeSoft = 'rgba(255, 255, 255, 0.07)';
export const glassEdgeHighlight = 'rgba(255, 255, 255, 0.28)';
export const glassEdgeFocused = tintStrong;

/** Full-screen scrim behind a modal. */
export const scrim = 'rgba(0, 0, 0, 0.55)';
/** Heavier scrim, for a modal that must fully detach from a busy screen. */
export const scrimHeavy = 'rgba(0, 0, 0, 0.72)';
