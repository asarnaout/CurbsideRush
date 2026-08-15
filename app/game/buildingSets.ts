/**
 * Building-set zoning + placement math for the NYC overhaul (Phase 2/3).
 *
 * A `ProceduralBlock` may name a `buildingSet`; each set is a list of catalogue
 * models (see {@link ./buildingCatalog}) with a per-model placement config
 * (scale + ground offset, derived from each glb's measured native bounding box).
 * {@link slotBlockBuildings} lays a set's models around a block's perimeter as a
 * street wall facing the surrounding roads — pure and deterministic, so the
 * renderer just instantiates what it returns and the layout is unit-testable.
 *
 * Renderer-agnostic (no Babylon imports): GameCanvas instantiates GPU instances
 * (`instantiateModelInstanced`) at the positions/rotations produced here.
 */
import { ALL_ENV_MODELS } from "./buildingCatalog";
import type { BlockStreetEdge } from "./types";
import { seededUnit, type VisualPoint } from "./visuals";

/** Per-model placement: uniform scale + ground offset + post-scale footprint. */
export interface BuildingPlacementConfig {
  /** Uniform scale that normalises the glb to a real-world footprint. */
  readonly scale: number;
  /** Y offset (m) that sits the model's base on the ground (= -nativeMinY·scale). */
  readonly groundY: number;
  /** Post-scale frontage (m) along the kerb — what spaces the street wall. */
  readonly footprintM: number;
  /**
   * Post-scale depth (m) into the block, when it differs from the frontage.
   * Defaults to `footprintM`.
   *
   * These are two different measurements and one number cannot be both. The
   * frontage decides how tightly buildings pack along the kerb; the depth
   * decides how far each is inset from the block edge, and therefore whether a
   * building on one edge reaches into a building on the next. Cairo's slim
   * block is 5.6 m wide and 10.8 m deep — spaced by its depth it leaves a 5 m
   * hole in the wall, inset by its frontage it stands inside its neighbour.
   */
  readonly depthM?: number;
  /**
   * Facing correction (radians) added to the holder yaw. The instancing path
   * rotates a building so its front faces the street; models whose authored
   * front is not on local -Z (the glTF-loader-flipped default) set this.
   */
  readonly frontOffset: number;
  /**
   * Derotation (radians) baked into the merged master so the model's walls run
   * parallel to the street grid — for assets authored rotated off their own
   * axes. Measured from the merged master's wall normals (#143).
   */
  readonly squareUpYaw?: number;
  /**
   * Post-scale roof height (m) = native height × scale. Set only on models that
   * should receive Cairo's rooftop clutter — the water tanks and satellite
   * dishes that the procedural facade boxes grow and that a glb street wall
   * would otherwise lose. Absent means "nothing goes on this roof": the KayKit
   * walk-ups already model their own tank, and a water tank on a 60 m Corniche
   * hotel would be wrong.
   */
  readonly roofY?: number;
}

// Scales/ground offsets derived from each glb's native bounds (see tools note in
// buildingCatalog): Kenney towers are authored ~1 unit, the art-deco tower ~147
// units, the houses ~100+ units — so scales span two orders of magnitude. Ground
// offsets sit each base on y=0. Footprints are the post-scale plan size used to
// space the street wall. frontOffset is tuned per model from in-game captures.
const PLACEMENTS: Record<string, BuildingPlacementConfig> = {
  // Downtown towers
  "nyc-tower-a": { scale: 13, groundY: 0, footprintM: 16, frontOffset: 0 },
  "nyc-tower-b": { scale: 12, groundY: 0, footprintM: 14, frontOffset: 0 },
  "nyc-tower-c": { scale: 16, groundY: 0, footprintM: 19, frontOffset: 0 },
  "nyc-tower-artdeco": { scale: 0.15, groundY: 0.22, footprintM: 22, frontOffset: 0 },
  "nyc-tower-spire": { scale: 17, groundY: 29.2, footprintM: 12, frontOffset: 0 },
  // Mid-rise
  "nyc-midrise-a": { scale: 7, groundY: 0, footprintM: 9, frontOffset: 0 },
  "nyc-midrise-b": { scale: 8, groundY: 0, footprintM: 18, frontOffset: 0 },
  "nyc-midrise-low": { scale: 9, groundY: 0, footprintM: 6, frontOffset: 0 },
  // Brownstone / rowhouse (scaled by width so heights vary for a real rowhouse run)
  // These low-poly kits author their facade (windows/awning/fire escape) on
  // local +Z, not the -Z the slotting assumes — so they need a half-turn to
  // face the street (verified per-model from a 4-side render).
  "nyc-brownstone-a": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-b": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-c": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-brownstone-d": { scale: 5.5, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  "nyc-tenement": { scale: 1.1, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  // Detached houses
  // house-a's door is on local -Z (already faces the street); house-b's is on +Z.
  // house-a's glb also bakes a 10° yaw (walls sit -10° off the grid in master
  // space, 100% of wall area) — squared up at master build so the house isn't
  // skewed against the kerb.
  "nyc-house-a": { scale: 0.095, groundY: 0.11, footprintM: 11, frontOffset: 0, squareUpYaw: (10 * Math.PI) / 180 },
  "nyc-house-b": { scale: 0.44, groundY: 0, footprintM: 11, frontOffset: Math.PI },
  // Ground-floor retail (storefront on local +Z)
  "nyc-shop-corner": { scale: 7.5, groundY: 0, footprintM: 10, frontOffset: Math.PI },

  // ---- Cairo ----
  // Every Cairo model measured square to its own axes (>=94% of wall area at 0°),
  // so none needs a squareUpYaw. Most bases sit at y=0 natively; six dip below
  // by up to 8cm at placement scale (cairo-block-slim and -terrace the worst),
  // which BUILDING_GROUND_LIFT still clears off the ground plane.
  //
  // Facing: the Quaternius pack puts its doors and ground-floor glazing on local
  // +Z (measured from the Wood/DarkWood/Glass submesh centroids, not guessed),
  // and the KayKit walk-ups match NYC's brownstones — so both take the half-turn.
  // Kenney's towers are symmetrical box slabs and need none.
  //
  // Scales run taller than the NYC equivalents on purpose: Downtown Cairo and
  // Zamalek are 6-8 storeys where the Upper West Side is 4-5, and these are
  // 2-4-storey models being asked to read as the taller thing.
  // roofY is native height × scale, so rooftop clutter lands on the parapet
  // rather than floating over it or sinking into the top floor.
  "cairo-tower-a": { scale: 15, groundY: 0, footprintM: 18.7, frontOffset: 0 },
  "cairo-tower-b": { scale: 15, groundY: 0, footprintM: 18.7, frontOffset: 0 },
  "cairo-block-4story": { scale: 4.6, groundY: 0, footprintM: 11.2, depthM: 11.7, frontOffset: Math.PI, roofY: 23.4 },
  "cairo-block-4story-centre": { scale: 4.6, groundY: 0, footprintM: 11.2, depthM: 11.7, frontOffset: Math.PI, roofY: 23.4 },
  // Several of these are markedly deeper than they are wide, so they carry both
  // measurements. Every figure is the merged master's real post-scale bound, not
  // an estimate: the authored guesses understated slim by 4.8 m, which stood it
  // inside whatever sat on the next edge.
  "cairo-block-slim": { scale: 5, groundY: 0, footprintM: 5.7, depthM: 10.8, frontOffset: Math.PI, roofY: 20 },
  "cairo-block-small": { scale: 5, groundY: 0, footprintM: 9.6, depthM: 9.9, frontOffset: Math.PI, roofY: 19.3 },
  "cairo-block-colonnade": { scale: 5.2, groundY: 0, footprintM: 11.3, depthM: 13.0, frontOffset: Math.PI, roofY: 14.4 },
  "cairo-block-balcony": { scale: 5.2, groundY: 0, footprintM: 11.3, depthM: 13.2, frontOffset: Math.PI, roofY: 15.3 },
  "cairo-block-terrace": { scale: 4.8, groundY: 0, footprintM: 18.4, depthM: 10.9, frontOffset: Math.PI, roofY: 13.2 },
  "cairo-walkup-a": { scale: 6, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  "cairo-walkup-b": { scale: 6, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  "cairo-residence-kay": { scale: 6, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  "cairo-residence-quaternius": { scale: 4.8, groundY: 0, footprintM: 10.4, depthM: 12.1, frontOffset: Math.PI, roofY: 20.2 },
  // Long, shallow Quaternius terraces (native 6.83 wide x ~2.3-2.7 deep) that
  // previously served only as venue props. As street wall they read as one
  // continuous ministry/warehouse run — depth kept under every host set's
  // buildingSetDepthM so promoting them cannot move a single parcel.
  "cairo-office-block": { scale: 3.6, groundY: 0.09, footprintM: 24.6, depthM: 9.8, frontOffset: Math.PI, roofY: 18.5 },
  "cairo-depot": { scale: 4, groundY: 0.07, footprintM: 27.4, depthM: 9.1, frontOffset: Math.PI, roofY: 10.9 },
  // KayKit corner shop at its venue scale; models its own awning, no roofY.
  "cairo-shop": { scale: 4, groundY: 0, footprintM: 8, frontOffset: Math.PI },

  // ---- London ----
  // Every figure is the glb's measured post-scale bound (accessor min/max folded
  // through node transforms), not an estimate — the Cairo slim block's 4.8 m
  // understatement is the shipped lesson. Facing follows the packs' conventions
  // verified for Cairo: Quaternius and KayKit doors sit on local +Z (half-turn),
  // Kenney towers are symmetric slabs. No roofY anywhere: rooftop clutter is
  // Cairo's, and nothing sits on a pitched roof.
  //
  // Scales pick real London heights: 2-storey-plus-roof sources at ~4x read as
  // the 3-4 storey Victorian terraces of the reference streets; the wide
  // 4-storey source lands at mansion-block height; the 1-storey sources stay
  // low on purpose (mews cottages and corner pubs between the terraces).
  "london-terrace-a": { scale: 4, groundY: 0.06, footprintM: 8.6, depthM: 9.5, frontOffset: Math.PI },
  "london-terrace-b": { scale: 4.2, groundY: 0.06, footprintM: 8.9, depthM: 8.9, frontOffset: Math.PI },
  "london-terrace-c": { scale: 3.4, groundY: 0.08, footprintM: 23.2, depthM: 9.2, frontOffset: Math.PI },
  "london-terrace-d": { scale: 3.4, groundY: 0.02, footprintM: 7.2, depthM: 8.1, frontOffset: Math.PI },
  "london-terrace-e": { scale: 3.5, groundY: 0.05, footprintM: 7.3, depthM: 7.4, frontOffset: Math.PI },
  // Stucco runs a touch grander than brick — Chelsea's terraces stand taller
  // than Earls Court's, and the extra height keeps the two districts from
  // reading as a palette swap of each other.
  "london-stucco-a": { scale: 4.4, groundY: 0.07, footprintM: 9.5, depthM: 10.5, frontOffset: Math.PI },
  "london-stucco-b": { scale: 4.4, groundY: 0.07, footprintM: 9.3, depthM: 9.4, frontOffset: Math.PI },
  "london-stucco-c": { scale: 3.5, groundY: 0.09, footprintM: 23.9, depthM: 9.4, frontOffset: Math.PI },
  "london-stucco-d": { scale: 3.6, groundY: 0.02, footprintM: 7.6, depthM: 8.6, frontOffset: Math.PI },
  // City towers: 46-63 m — above NYC's downtown (scale 13) and level with
  // Cairo's Corniche (15), which is what a City cluster wants.
  "london-tower-a": { scale: 15, groundY: 0, footprintM: 18.6, frontOffset: 0 },
  "london-tower-b": { scale: 14, groundY: 0, footprintM: 17.4, frontOffset: 0 },
  "london-tower-c": { scale: 16, groundY: 0, footprintM: 19.8, frontOffset: 0 },
  // KayKit shopfronts at their Cairo scales — identical source geometry.
  "london-shop": { scale: 4, groundY: 0, footprintM: 8, frontOffset: Math.PI },
  "london-walkup-a": { scale: 6, groundY: 0, footprintM: 12, frontOffset: Math.PI },
  "london-walkup-b": { scale: 6, groundY: 0, footprintM: 12, frontOffset: Math.PI },

  // ---- Tokyo (P1 — import-only; not yet referenced by any BuildingSetId,
  // see TOKYO_ENV_MODELS's header). Every figure is the styled/committed
  // glb's real merged-master bound (NullEngine + getBuildingMaster's own
  // recipe: instantiate at the scale below, MergeMeshes, orientMerged-
  // FacesOutward, recentreMergedMasterXZ), not an estimate.
  //
  // `MergeMeshes` crashes on tokyo-apato-b/tokyo-ramen (the documented
  // heterogeneous-submesh-attribute failure — some of their Sketchfab-
  // exported submeshes carry TANGENT/extra UV sets, others don't), exactly
  // the case docs/rendering.md predicts needs `instantiateModelInstanced`
  // at render time; their footprint/depth here were measured as the union
  // of every submesh's own Babylon-loaded world bound instead
  // (translation-invariant, so it agrees with what a successful merge would
  // report — merging doesn't move geometry). tokyo-house-d used to be the
  // third member until its mismatch (dead secondary UVs only, no TANGENT)
  // was stripped at the asset level — see MERGE_INCOMPATIBLE_MODEL_IDS's
  // own comment; its measured figures below are unchanged by that (the
  // strip touches no geometry).
  //
  // Facing (frontOffset) has no shared cross-author convention in this
  // batch (13 independent Sketchfab authors) — each was measured from the
  // best available signal: a named door/glass/sign submesh's position
  // relative to the model's own bound (HIGH/MED confidence below), or,
  // failing that, the offset between the vertex-count-weighted centroid and
  // the AABB centre (a small asymmetric feature — porch, canopy — pulls the
  // bound outward on the front side more than it pulls the mean; MED/LOW
  // confidence). Two street-facing models (tokyo-shop-b, tokyo-izakaya)
  // measured their door/sign on a *side* axis rather than front/back —
  // this catalogue's first frontOffset of +-pi/2 rather than 0/pi, which
  // also swaps which native axis is footprintM vs depthM (a 90 degree turn,
  // unlike the 180 degree case every other model in this repo needed).
  // **None of this is live-verified against a rendered view** (no visual
  // renderer was available to measure with, only NullEngine) — re-confirm
  // every LOW/MED-confidence entry below with a live drive-by before P2
  // places any of them.
  "tokyo-house-a": {
    // Confidence: HIGH — re-confirmed live (Tokyo authenticity plan P2, as
    // the catalogue's own header instructed before P2 ever placed one of
    // these). The P1 measurement's signal (a "consistent, fairly strong +X
    // mass-centroid offset (0.31, vs 0.08 on Z)" across all three
    // same-author houses a/b/c) was real, but its CONCLUSION was backwards:
    // a live drive-by at frontOffset Math.PI/2 showed the entrance (door +
    // steps + two windows) squarely on world +X, not on the outward-facing
    // side the parcel needed — i.e. the model's real front was on the
    // DEFAULT local -Z all along (frontOffset 0, no rotation), and the +X
    // mass pull the blind heuristic found was something else (a garage-like
    // ridged panel, visually confirmed on the model's -X side) that outweighs
    // the entrance in vertex count without being it. house-c shares this
    // exact fix (0); house-b does NOT (-Math.PI/2, its own comment) — "same
    // author/series/signal" predicted a shared blind-measurement MISTAKE,
    // not a shared correct answer, so each of the three was live-checked
    // individually rather than assumed. See tests/tokyoContent.test.ts's
    // re-baselined coverage numbers for the knock-on effect.
    scale: 0.01,
    groundY: 0.02,
    footprintM: 8.11,
    depthM: 9.21,
    frontOffset: 0,
  },
  "tokyo-house-b": {
    // Confidence: HIGH — re-confirmed live (P2), but NOT the same fix as
    // house-a despite the shared author/series/signal: a live drive-by at
    // frontOffset 0 (house-a's fix) showed this model's entrance facing 90°
    // off the parcel's outward direction, not on it — this specific model's
    // true front sits a quarter-turn from house-a's, confirmed by testing
    // 0 first (wrong) then -Math.PI/2 (door squarely on the street) from the
    // same fixed "stand on the kerb, look at the parcel" viewpoint every
    // other entry in this file was checked from. A reminder that "same
    // series" predicts a shared MEASUREMENT ARTIFACT, not a shared correct
    // answer — each model still needs its own live confirmation.
    scale: 0.01,
    groundY: 0.0,
    footprintM: 6.01,
    depthM: 8.16,
    frontOffset: -Math.PI / 2,
  },
  "tokyo-house-c": {
    // Confidence: HIGH — re-confirmed live (P2); shares house-a's fix (0),
    // confirmed independently rather than assumed (see house-b's own
    // comment for why the assumption alone isn't trustworthy) — a live
    // drive-by at frontOffset 0 showed a door + vent squarely on the
    // parcel's outward-facing side.
    scale: 0.01,
    groundY: 0.0,
    footprintM: 11.45,
    depthM: 11.8,
    frontOffset: 0,
  },
  "tokyo-house-d": {
    // Confidence: HIGH (was MED-HIGH; re-confirmed live in P2 — a drive-by
    // showed the door + steps squarely on the parcel's outward side, no
    // change needed). Named "Puerta" (door) + "Marco_puerta" (door
    // frame) submeshes sit toward -Z relative to the house's own structural
    // mass (Casa_1) centre — the dominant axis of that door-to-centre
    // vector, by a wide margin over its X component. footprintM/depthM
    // measure the model's FULL fenced lot (the house keeps its own low
    // property wall — "tiny setbacks behind low block walls" is literally
    // this map's own residential flavour, see the plan's section 4.3), not
    // just the house structure alone. groundY is referenced off the
    // property wall's own consistent base (native y=-100 across all three
    // Muro_* wall meshes, where 178/287 of the model's meshes cluster
    // around the y=+50 "main floor" level above it) rather than the
    // absolute geometric minimum (native y=-129.9), which belongs to one
    // sunken exterior stair tread, not the ground plane the wall meets.
    scale: 0.01,
    groundY: 1.0,
    footprintM: 13.69,
    depthM: 11.82,
    frontOffset: 0,
  },
  "tokyo-apato-a": {
    // Confidence: HIGH (was LOW; re-confirmed live in P2 — a drive-by
    // showed the decorated ground-floor frontage, shop shutters, vending
    // machine and signage squarely on the parcel's outward side, no change
    // needed — the no-evidence default happened to be right). No door
    // submesh; the one positional signal (a bundled "PSX Vending Machine"
    // prop, kept as authentic Setagaya street furniture per the plan's own
    // section 4.3) sits in a CORNER, not centred on one edge (offsetFrac
    // x=0.34, z=0.35 — comparable magnitudes, no dominant axis), so it
    // doesn't resolve which side is "front" — hence the codebase's own
    // no-evidence baseline (front already on local -Z, no rotation).
    scale: 1,
    groundY: 0,
    footprintM: 7.39,
    depthM: 4.79,
    frontOffset: 0,
  },
  "tokyo-apato-b": {
    // Confidence: LOW-MED. No door submesh (purely architectural node
    // names — Wall/Slab/Floor/Ceiling/Moulding); a modest +Z mass-centroid
    // offset (0.18, vs a weak 0.09 on X) is the only signal.
    scale: 1,
    groundY: 0.2,
    footprintM: 9.85,
    depthM: 17.1,
    frontOffset: Math.PI,
  },
  "tokyo-konbini": {
    // Confidence: HIGH — re-confirmed live (P2). The P1 mass-centroid
    // signal (a strong +X offset, 0.47 vs a weak -0.09 on Z — the fascia
    // band's own asymmetric oversail, correctly spotted) picked the right
    // AXIS but the wrong of its two directions: frontOffset Math.PI/2 put
    // the striped fascia awning a quarter-turn off the parcel's outward
    // side; a live drive-by confirmed the half-turn-further Math.PI puts it
    // squarely on the street. (This model never actually landed on a real
    // nakamise-yokocho parcel in the live P2 build — every one of the 4
    // slots that reached it drew a different tokyo-shotengai model instead
    // — so this was checked via a temporary one-model SETS override,
    // reverted before committing; see the PR body.)
    scale: 1,
    groundY: 0.1,
    footprintM: 13.33,
    depthM: 8.92,
    frontOffset: Math.PI,
  },
  "tokyo-shop-a": {
    // Confidence: HIGH — re-confirmed live (P2). The P1 mass-centroid
    // signal was genuinely too weak to call (x=-0.11, z=-0.15, no dominant
    // axis) and its no-evidence default (0) was wrong: a live drive-by
    // showed the decorated front (Japanese signage, red awning, string
    // lights, window) squarely on the opposite side from the parcel's
    // outward direction — a half-turn, not the no-rotation default.
    scale: 0.01,
    groundY: -0.09,
    footprintM: 2.48,
    depthM: 3.98,
    frontOffset: Math.PI,
  },
  "tokyo-shop-b": {
    // Confidence: HIGH, re-confirmed live in P2 — a drive-by showed a full
    // storefront (Japanese signage, shop window, balcony) squarely on the
    // parcel's outward side, no change needed. Two lantern submeshes ("farolJapanese_7/2") and the
    // shop's own sign text ("JapaneseText_0") all sit within ~5-15% of the
    // model's -X extreme (not near either Z extreme) — the entrance/
    // signage face is a SIDE axis, not front/back. This catalogue's first
    // +-90 degree frontOffset: footprintM/depthM are swapped from the
    // model's native X/Z sizes accordingly (native X was the door-normal
    // axis, so it becomes depth; native Z, parallel to the door face,
    // becomes the kerb-facing footprint).
    scale: 1,
    groundY: 0,
    footprintM: 7.0,
    depthM: 5.4,
    frontOffset: -Math.PI / 2,
  },
  "tokyo-shop-c": {
    // Confidence: HIGH (was MED-HIGH; re-confirmed live in P2 — a drive-by
    // showed a full storefront, Japanese signage and a roll-down shutter
    // squarely on the parcel's outward side, no change needed). A named
    // "1. sign" submesh sits at the model's +Z extreme (a shop's sign is a
    // strong front-facade indicator); the "1 back" submesh (presumably the
    // rear wall material) sits near the model's Z centre rather than the
    // opposite extreme, so it does not contradict this.
    scale: 1,
    groundY: 0,
    footprintM: 8.16,
    depthM: 8.21,
    frontOffset: Math.PI,
  },
  "tokyo-shop-d": {
    // Confidence: LOW-MED, checked live in P2 but genuinely inconclusive —
    // NOT upgraded. A drive-by swept all four sides (two of them from a
    // close, near-wall distance, given this model's real size) and found
    // no decorated face on any of them: plain brick to the north and
    // south, bare concrete to the east, one barred window to the west —
    // none of the "kanji signage at three heights" the baseColor texture
    // shows (see below) was actually visible from outside at this
    // orientation, on any side. Left at the original no-evidence default
    // (0) rather than guessed into a specific wrong turn; a case for a
    // closer look (or a different placement instance) in a later phase,
    // not a confirmed bug. No door submesh (one merged mesh); mass-centroid
    // offset is weak on both axes (x=-0.05, z=-0.12). The baseColor texture
    // (a trim-sheet atlas, not a spatial photo) shows repeated kanji
    // signage at three different heights plus AC units and a mailbox —
    // real signage, but not resolvable to a world-facing side without a
    // rendered view. Measures noticeably larger than its "small shopfront"
    // plan role (22.4 x 23.1 x 12.9 m) — trusted over the plan's guess,
    // matching this repo's own "measure, don't estimate" rule; still a
    // valid street-wall model, just a taller one than expected.
    scale: 1,
    groundY: -0.52,
    footprintM: 22.41,
    depthM: 12.91,
    frontOffset: 0,
  },
  "tokyo-izakaya": {
    // Confidence: HIGH. Named "Sign" + "Door Window" + "sign support"
    // submeshes all sit within ~6-13% of the model's -X extreme (and only
    // 30-43% into its Z range — nowhere near a Z extreme), the same
    // side-axis pattern as tokyo-shop-b. groundY is referenced off the
    // model's own floor level (native y=~0) after stripping the diorama
    // "Floor" ground-slab node (tools/style-tokyo-buildings.mjs) — without
    // that strip the absolute minimum would have been the slab's underside
    // instead of the building's real floor.
    scale: 0.01,
    groundY: 0,
    footprintM: 6.87,
    depthM: 7.9,
    frontOffset: -Math.PI / 2,
  },
  "tokyo-ramen": {
    // Confidence: LOW. No door submesh; mass-centroid offset is present on
    // both axes at comparable magnitude (x=0.27, z=0.20) with no clear
    // dominant side, the same corner-like ambiguity as tokyo-apato-a.
    // groundY is referenced off the main shell mesh's ("Box002") own floor
    // (native y=-259.56) rather than the absolute geometric minimum
    // (native y=-305.4), which belongs to a handful of "Bar" stool/table-leg
    // tips poking slightly through the floor — a low-poly modelling
    // artifact, not the ground plane.
    scale: 0.01,
    groundY: 2.6,
    footprintM: 13.67,
    depthM: 17.35,
    frontOffset: 0,
  },

  // ---- Tokyo authenticity plan P3a (import-only; not yet referenced by any
  // BuildingSetId — see TOKYO_ENV_MODELS's header). Measured the same way as
  // P1's own batch: NullEngine + getBuildingMaster's exact recipe
  // (instantiate real clones, Mesh.MergeMeshes, orientMergedFacesOutward,
  // squareUpMergedMaster, recentreMergedMasterXZ) at the scale below, then
  // reading the merged master's real post-scale bound. None of these six
  // hit the heterogeneous-submesh MergeMeshes crash (unlike three of P1's
  // batch) — every one merges cleanly, so none needs
  // MERGE_INCOMPATIBLE_MODEL_IDS/instantiateModelInstanced.
  //
  // tokyo-zakkyo-{a..f}: each file is a small CLUSTER of 3-4 buildings
  // (tools/split-asian-city-pack.mjs), laid out as one street-facing row and
  // re-origined at the row's own base-centre — footprintM here is the whole
  // row's width, not one building's. Scale (0.18, shared across all six so
  // their relative height ordering from the source stays intact) is a
  // judgement call with no live renderer to check it against yet: it trades
  // off two things pulling in opposite directions — taller reads more like
  // the plan's "apartments, offices, skyscrapers," but a wider row eats more
  // of a single street-wall slot than any other model in this catalogue
  // (the previous widest, cairo-depot, is 27.4 m; these run 22-37 m). Landed
  // on 0.18 for a height range (33-54 m) in the same band as this
  // catalogue's own towers (43-63 m) while keeping every row's footprint
  // under 37 m. **Confidence: LOW on frontOffset for all six** — these are
  // generic multi-building night-skyline clusters with no door/sign submesh
  // or other orientation signal (unlike P1's shop/house imports), so
  // frontOffset stays the no-evidence default (0); confidence on scale
  // itself is a design choice, not a measurement, and should be revisited
  // once P3b can actually place one and look at it. Both flagged for P3b's
  // live drive-by, exactly like P1 flagged its own low-confidence entries
  // for P2.
  "tokyo-zakkyo-a": { scale: 0.18, groundY: 0, footprintM: 35.83, depthM: 8.95, frontOffset: 0 },
  "tokyo-zakkyo-b": { scale: 0.18, groundY: 0, footprintM: 32.13, depthM: 7.99, frontOffset: 0 },
  "tokyo-zakkyo-c": { scale: 0.18, groundY: 0, footprintM: 34.01, depthM: 6.85, frontOffset: 0 },
  "tokyo-zakkyo-d": { scale: 0.18, groundY: 0, footprintM: 36.72, depthM: 16.67, frontOffset: 0 },
  "tokyo-zakkyo-e": { scale: 0.18, groundY: 0, footprintM: 33.23, depthM: 14.05, frontOffset: 0 },
  "tokyo-zakkyo-f": { scale: 0.18, groundY: 0, footprintM: 22.19, depthM: 8.07, frontOffset: 0 },

  // tokyo-nippori-bldg: a real-Tokyo photogrammetry scan, kept at its own
  // apparent native scale (1) — its unscaled footprint (22.35 x 9.77 m) and
  // height (25.0 m) already read as a plausible real mixed-use building, the
  // kind of coincidence photogrammetry occasionally gives when the capture
  // pipeline was itself calibrated to real-world units. groundY is large
  // (147.78) because the scan's own coordinate origin sits nowhere near its
  // footprint's base — both native Y bounds are negative (-147.8..-122.8),
  // so the whole mesh needs lifting, not dropping, to reach y=0. **Confidence:
  // LOW on frontOffset** — a single unlit merged mesh with no named
  // door/sign submesh to signal a side, the same no-evidence default as
  // several of P1's own low-signal entries; flagged for P3b's live check
  // before ever placing this (also still an explicitly optional model per
  // the plan — perf may cut it regardless, see plan section 10).
  "tokyo-nippori-bldg": { scale: 1, groundY: 147.78, footprintM: 22.35, depthM: 9.77, frontOffset: 0 },

  // ---- Restyle backbone (P3a): re-imports of already-committed CC0
  // sources, so geometry is IDENTICAL to an already-measured, already-live
  // model — only the palette changed. Facing/scale below are inherited from
  // that source's own entry, not re-derived, and carry that entry's own
  // confidence (HIGH: cairo-walkup-a/b and nyc-tower-a are both already
  // placed and driven-past in Cairo/NYC's own live maps). footprintM/depthM/
  // groundY are still fresh NullEngine measurements of the actual committed
  // tokyo-*.glb (never copied from the other city's manifest) — "never trust
  // a manifest against itself" applies to cross-file assumptions too, not
  // just a file's own claims, and this exact batch is also why: the
  // restyle's own bytes could in principle have drifted even though the
  // recipe says they shouldn't.
  "tokyo-walkup-a": { scale: 6, groundY: 0, footprintM: 12.04, frontOffset: Math.PI },
  "tokyo-walkup-b": { scale: 6, groundY: 0, footprintM: 12.04, frontOffset: Math.PI },
  // Scale 15, not NYC's own 13: London/Cairo's copies of this same source
  // both already use 15 for their tallest single glassy slab, and the plan
  // casts this one as "the scramble backdrop" — the same prominent-anchor
  // role, so it follows their number rather than NYC's more modest one.
  "tokyo-tower-a": { scale: 15, groundY: 0, footprintM: 18.6, frontOffset: 0 },
  "tokyo-block-slim": { scale: 5, groundY: 0.08, footprintM: 5.58, depthM: 10.77, frontOffset: Math.PI },
  "tokyo-block-small": { scale: 5, groundY: 0.07, footprintM: 9.54, depthM: 9.87, frontOffset: Math.PI },
  "tokyo-block-4story": { scale: 4.6, groundY: 0.02, footprintM: 11.14, depthM: 11.65, frontOffset: Math.PI },
};

export type BuildingSetId =
  | "nyc-downtown"
  | "nyc-midrise"
  | "nyc-brownstone"
  | "nyc-house"
  | "nyc-shop"
  | "cairo-corniche"
  | "cairo-downtown"
  | "cairo-zamalek"
  | "cairo-westbank"
  | "london-terrace"
  | "london-stucco"
  | "london-highstreet"
  | "london-city"
  | "tokyo-house"
  | "tokyo-shotengai"
  | "tokyo-zakkyo"
  | "tokyo-manshon"
  | "tokyo-apato";

/** Which catalogue models make up each zone's street wall. */
const SETS: Record<BuildingSetId, readonly string[]> = {
  "nyc-downtown": [
    "nyc-tower-a", "nyc-tower-b", "nyc-tower-c", "nyc-tower-artdeco",
    "nyc-tower-spire", "nyc-midrise-b",
  ],
  "nyc-midrise": [
    "nyc-midrise-a", "nyc-midrise-b", "nyc-midrise-low", "nyc-tenement",
    "nyc-tower-a", "nyc-shop-corner",
  ],
  "nyc-brownstone": [
    "nyc-brownstone-a", "nyc-brownstone-b", "nyc-brownstone-c",
    "nyc-brownstone-d", "nyc-tenement",
  ],
  "nyc-house": ["nyc-house-a", "nyc-house-b"],
  "nyc-shop": ["nyc-shop-corner", "nyc-brownstone-a", "nyc-tenement"],

  // Cairo. Every set mixes at least four models: a Corniche run is long enough
  // that a two-model set reads as copy-paste from the driver's seat.
  "cairo-corniche": [
    "cairo-tower-a", "cairo-tower-b", "cairo-block-4story",
    "cairo-block-4story-centre", "cairo-residence-quaternius",
  ],
  "cairo-downtown": [
    "cairo-block-4story", "cairo-block-4story-centre", "cairo-block-colonnade",
    "cairo-block-slim", "cairo-residence-quaternius", "cairo-walkup-a",
    "cairo-office-block",
  ],
  "cairo-zamalek": [
    "cairo-block-balcony", "cairo-block-colonnade", "cairo-block-small",
    "cairo-walkup-a", "cairo-walkup-b", "cairo-residence-kay",
    "cairo-shop",
  ],
  "cairo-westbank": [
    "cairo-block-small", "cairo-block-terrace", "cairo-block-slim",
    "cairo-walkup-b", "cairo-block-4story", "cairo-office-block",
    "cairo-depot",
  ],

  // London. Brick and stucco are the same five pitched sources in two renders —
  // separate files, separate sets, so Chelsea and Earls Court never blend on
  // one street. The high street interleaves a brick terrace between shopfronts,
  // which is how the real thing reads (shops at ground level, homes above and
  // between); the City's three Kenney slabs cover only eight glass parcels, so
  // three variants carry it.
  "london-terrace": [
    "london-terrace-a", "london-terrace-b", "london-terrace-c",
    "london-terrace-d", "london-terrace-e",
  ],
  "london-stucco": [
    "london-stucco-a", "london-stucco-b", "london-stucco-c", "london-stucco-d",
  ],
  "london-highstreet": [
    "london-shop", "london-walkup-a", "london-walkup-b", "london-terrace-a",
  ],
  "london-city": ["london-tower-a", "london-tower-b", "london-tower-c"],

  // Tokyo authenticity plan. P2 wired the first two sets, mixing five to six
  // of P1's 13 catalogued models — Cairo's own "a long run reads as
  // copy-paste from the driver's seat with only two models" rationale
  // applies just as much to a residential web or a shotengai. P3b (this
  // pass) adds the downtown/zakkyo backbone and the manshon mid-rise mix,
  // both wired live in `tokyoRoadsideBuildingSet` (cities/tokyo.ts) — see
  // that function's own doc comment for the zone->set mapping.
  "tokyo-house": [
    "tokyo-house-a", "tokyo-house-b", "tokyo-house-c", "tokyo-house-d",
    "tokyo-apato-a",
  ],
  "tokyo-shotengai": [
    "tokyo-shop-a", "tokyo-shop-b", "tokyo-shop-c", "tokyo-shop-d",
    "tokyo-konbini", "tokyo-house-a",
  ],
  // The downtown/ring backbone: the six-way zakkyo-pack split plus the three
  // restyled Quaternius mid-rise blocks. `tokyo-nippori-bldg` (the optional
  // 59.6k-tri hero) is deliberately NOT a member here — a street-wall set
  // gets drawn repeatedly along every qualifying run, which is right for a
  // 6-35 m building but wrong for a one-of-a-kind hero; see the P3b PR body
  // for whether/where it got a hand-placed instance instead.
  "tokyo-zakkyo": [
    "tokyo-zakkyo-a", "tokyo-zakkyo-b", "tokyo-zakkyo-c", "tokyo-zakkyo-d",
    "tokyo-zakkyo-e", "tokyo-zakkyo-f", "tokyo-block-slim", "tokyo-block-small",
    "tokyo-block-4story",
  ],
  // Riverside + higashi: "mixed mid-rise, 8-22 m" (plan section 6.1) — the
  // restyled KayKit walk-ups for the lower end, the restyled Quaternius
  // 4-storey block and the restyled NYC/London/Cairo glass tower for the
  // taller end.
  //
  // `tokyo-apato-b` is deliberately EXCLUDED, contrary to the plan's own
  // suggested membership list — live-measured (headless CDP, paired
  // before/after at the Tokyo scramble pose, P3b's own perf pass), not a
  // guess: including it nearly DOUBLED the scramble's drawCallsPerFrame
  // (391 -> 777 avg of 3 samples x 2 repeats each, both pairs reproducing
  // within 0.5%, so not session noise). Root cause: `tokyo-apato-b` is one
  // of `MERGE_INCOMPATIBLE_MODEL_IDS` (its glb's own architectural BIM-style
  // export names each wall panel/moulding segment as its own submesh —
  // "purely architectural node names — Wall/Slab/Floor/Ceiling/Moulding",
  // buildingCatalog.ts's own comment), so it renders through
  // `instantiateModelInstanced`'s per-submesh path instead of
  // `getBuildingMaster`'s single merged mesh. A live mesh census at the
  // scramble pose found 99 DISTINCT submesh families from this one model
  // alone (`instance of Wall_<guid>`, `instance of Roof Gable_<guid>`,
  // `instance of Slab_<guid>`, `instance of Crown/Base Right Moulding_<guid>`,
  // ...), each its own draw call batched across placements — a ~99-draw
  // FIXED tax the moment even one instance is in range, not a per-instance
  // cost `slotBlockBuildings`' cheap-marginal-cost assumption (plan section
  // 10) holds for every other model in this catalogue. Confirmed by a
  // controlled experiment: removing it from this SETS entry alone (nothing
  // else changed) dropped the scramble to 372 draws — BELOW the pre-plan
  // baseline, delivering the improvement the plan hypothesized. Unlike
  // `tokyo-nippori-bldg` (a tri-count cost that scales with instance count,
  // so limiting placements helps), this is a submesh-count cost that does
  // NOT scale down with fewer placements, so there is no sparse-placement
  // compromise available short of re-processing the source glb to consolidate
  // its submeshes (which would very likely hit the same heterogeneous-
  // vertex-attribute `MergeMeshes` crash `MERGE_INCOMPATIBLE_MODEL_IDS`
  // already documents) — out of this phase's scope. `tokyo-apato-b` stays
  // catalogued and PLACEMENTS-configured but unreferenced by any set, the
  // same status it has had since P1.
  "tokyo-manshon": [
    "tokyo-walkup-a", "tokyo-walkup-b", "tokyo-block-4story",
    "tokyo-tower-a",
  ],
  // Tokyo authenticity plan P6 (Region C): the plan's own section 6.1 table
  // always intended a fifth Tokyo set — "apāto (walk-up apartments with
  // external stairs/corridors)... denser web edges", membership "apato-a/b,
  // walkup-a/b, house-c" — but P3b's own scope was tokyo-zakkyo/tokyo-manshon
  // only (see that commit's title) and no road ever referenced this one, so
  // it was never grouped into a real `BuildingSetId` until now, when
  // Sumiregaoka's own collector (`jp-sumiregaoka-dori`,
  // `tokyoRoadsideBuildingSet` in cities/tokyo.ts) becomes the first road to
  // actually use it. `tokyo-apato-b` is deliberately EXCLUDED here too, same
  // reason as `tokyo-manshon` above (its own comment): it is one of
  // `MERGE_INCOMPATIBLE_MODEL_IDS`, a ~99-draw fixed tax per instance in
  // range, not a per-placement cost the sparse-placement compromise can
  // absorb. Every model kept here is already a live member of another set
  // (tokyo-house/tokyo-manshon), each already re-confirmed live (HIGH
  // confidence, `buildingSets.ts`'s own PLACEMENTS comments) — this set adds
  // no new glb parsing, no new merge-crash risk and no new preload weight
  // (every url it needs is already fetched for those other sets' sake), only
  // a new grouping/labelling of models already proven on this map.
  "tokyo-apato": [
    "tokyo-apato-a", "tokyo-walkup-a", "tokyo-walkup-b", "tokyo-house-c",
  ],
};

const URL_BY_ID = new Map(ALL_ENV_MODELS.map((m) => [m.id, m.url]));

export const ALL_BUILDING_SET_IDS = Object.keys(SETS) as BuildingSetId[];

export function isBuildingSetId(id: string): id is BuildingSetId {
  return id in SETS;
}

/** Model ids that make up a set's street wall (for tests / tooling). */
export function buildingSetModelIds(setId: BuildingSetId): readonly string[] {
  return SETS[setId];
}

/**
 * Set-referenced model ids that lack a catalogue URL or a placement config —
 * a typo guard: any non-empty result would silently drop that building.
 */
export function missingBuildingConfigs(): string[] {
  const missing = new Set<string>();
  for (const ids of Object.values(SETS)) {
    for (const id of ids) {
      if (!URL_BY_ID.has(id) || !PLACEMENTS[id]) missing.add(id);
    }
  }
  return [...missing];
}

/**
 * How deep a block must be to hold this set's street wall.
 *
 * A parcel shallower than its deepest model does not merely look tight — the
 * model overhangs the block on both sides, into whatever stands behind it. The
 * Corniche set is 4.7 m deeper than the mid-rise sets, which is the difference
 * between a clean rank gap and towers standing in each other.
 */
export function buildingSetDepthM(setId: BuildingSetId): number {
  return Math.max(
    ...SETS[setId].map((id) => {
      const cfg = PLACEMENTS[id];
      return cfg ? (cfg.depthM ?? cfg.footprintM) : 0;
    }),
  );
}

/** Placement config for a catalogue model id (for tests / tooling). */
export function buildingPlacementConfig(
  id: string,
): BuildingPlacementConfig | undefined {
  return PLACEMENTS[id];
}

/** A street-life prop (vendor cart) placed on the sidewalk, instanced like a
 * building. Scale/groundY derived from each glb's measured native bounds. */
export interface StreetPropConfig {
  readonly url: string;
  readonly scale: number;
  readonly groundY: number;
  /** Post-scale footprint (m) — used to keep vendors clear of each other. */
  readonly footprintM: number;
}

const VENDOR_CONFIGS: Record<string, Omit<StreetPropConfig, "url">> = {
  "vendor-stand": { scale: 2.1, groundY: 0, footprintM: 2.5 },
  "vendor-cart": { scale: 2.4, groundY: 0, footprintM: 2.2 },
  "vendor-food": { scale: 0.8, groundY: 1.2, footprintM: 3.6 },
};

/** Light street-vendor carts placed along the sidewalks (market-stalls is left
 * out here — it's a heavy cluster, reserved for the odd hero spot). */
export const NYC_VENDORS: readonly StreetPropConfig[] = Object.entries(
  VENDOR_CONFIGS,
)
  .map(([id, cfg]) => {
    const url = URL_BY_ID.get(id);
    return url ? { url, ...cfg } : null;
  })
  .filter((v): v is StreetPropConfig => v !== null);

export function nycVendorUrls(): string[] {
  return NYC_VENDORS.map((v) => v.url);
}

/** De-duplicated glb URLs referenced by the given sets (for map-scoped preload). */
export function buildingSetUrls(setIds: readonly BuildingSetId[]): string[] {
  const urls = new Set<string>();
  for (const id of setIds) {
    for (const modelId of SETS[id]) {
      const url = URL_BY_ID.get(modelId);
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

/** A single placed building instance the renderer should instantiate. */
export interface PlacedBuilding {
  readonly modelId: string;
  readonly url: string;
  readonly x: number;
  readonly z: number;
  /** Holder yaw (already folds in facing-the-street + the model's frontOffset). */
  readonly yaw: number;
  readonly scale: number;
  readonly groundY: number;
  /** Which block-local edge this slot belongs to. */
  readonly edge: BlockStreetEdge;
  /** Zero-based running slot index within this one edge — resets per edge,
   * unlike `blockSlot`. Feeds the stable `building:<blockId>:slot:<edge>:<edgeSlot>`
   * id (plan Section 6.4). */
  readonly edgeSlot: number;
  /** Zero-based running slot index across the whole block (all edges, in
   * edge-array order), before keep-out removal — never resets. The stable
   * low-spec `assetDetailScore` selection is derived from this, so it must
   * stay identical across quality/load outcomes for the same authored input. */
  readonly blockSlot: number;
}

interface Edge {
  /** Which block-local edge this is, for `edges` filtering. */
  readonly id: BlockStreetEdge;
  /** Outward street direction as a heading atan2(dx,dz): +Z=0, +X=π/2. */
  readonly outward: number;
  /** Fixed coordinate of the edge line + which axis it runs along. */
  readonly runAxis: "x" | "z";
  readonly runStart: number;
  readonly runEnd: number;
  readonly fixed: number;
  /** Unit inward direction (into the block) as (dx,dz). */
  readonly inX: number;
  readonly inZ: number;
}

const GAP_M = 1.6;

/**
 * The deterministic low-spec keep score for a block-wide slot index — one
 * formula, shared by `slotBlockBuildings`'s own thinning below and by
 * `geometry/buildingLayout.ts`'s `assetDetailScore` (the planner calls this
 * with `keepFraction` fixed at 1, so it never thins, but still needs the
 * identical per-slot score for the renderer to apply later). A slot is kept
 * at fraction `f` iff `assetDetailScoreForBlockSlot(blockSlot) < f`.
 */
export function assetDetailScoreForBlockSlot(blockSlot: number): number {
  return ((blockSlot * 2654435761) >>> 0) / 4294967296;
}

/**
 * Lays a set's models around a block's perimeter as a street wall: buildings hug
 * each edge, inset so their front sits at the block edge and faces the road.
 * Deterministic in `seed`. N/S edges run full width; E/W edges are trimmed by a
 * building's reach at each end so corners don't double up.
 *
 * All four edges is the default because a city block has roads all round it. A
 * roadside strip does not, and must name its one road-facing edge: buildings are
 * inset by half their footprint, so on a parcel shallower than two footprints
 * the opposite rows overlap — Cairo's 28-34 m strips against footprints up to
 * 18.5 m put roughly 9 m of building inside another building, which reads as a
 * white flicker that worsens with camera motion. The far row also faces open
 * ground no driver ever reaches, so it is pure cost.
 */
export function slotBlockBuildings(
  center: VisualPoint,
  size: VisualPoint,
  setId: BuildingSetId,
  seed: number,
  /** Fraction of the street wall to keep (1 = full). Weak devices thin it for
   * frame rate; deterministic so the same buildings survive each load. */
  keepFraction = 1,
  /** Block-local edges to populate. Omitted/empty = all four. */
  edges_?: readonly BlockStreetEdge[],
): PlacedBuilding[] {
  const models = SETS[setId]
    .map((id) => ({ id, url: URL_BY_ID.get(id), cfg: PLACEMENTS[id] }))
    .filter((m): m is { id: string; url: string; cfg: BuildingPlacementConfig } =>
      Boolean(m.url && m.cfg),
    );
  if (!models.length) return [];
  const rng = seededUnit(seed);
  const halfW = size.x / 2;
  const halfD = size.z / 2;
  // The E/W trim is about how far a N/S building reaches *into* the block, so it
  // is the deepest model that sets it, not the widest.
  const maxDepth = Math.max(
    ...models.map((m) => m.cfg.depthM ?? m.cfg.footprintM),
  );

  const allEdges: Edge[] = [
    // North (+Z)
    { id: "+z", outward: 0, runAxis: "x", runStart: center.x - halfW, runEnd: center.x + halfW, fixed: center.z + halfD, inX: 0, inZ: -1 },
    // South (-Z)
    { id: "-z", outward: Math.PI, runAxis: "x", runStart: center.x - halfW, runEnd: center.x + halfW, fixed: center.z - halfD, inX: 0, inZ: 1 },
    // East (+X), trimmed so N/S corner buildings own the corners
    { id: "+x", outward: Math.PI / 2, runAxis: "z", runStart: center.z - halfD + maxDepth, runEnd: center.z + halfD - maxDepth, fixed: center.x + halfW, inX: -1, inZ: 0 },
    // West (-X)
    { id: "-x", outward: -Math.PI / 2, runAxis: "z", runStart: center.z - halfD + maxDepth, runEnd: center.z + halfD - maxDepth, fixed: center.x - halfW, inX: 1, inZ: 0 },
  ];
  // An empty list would silently erase the block's whole street wall, so it is
  // read as "unspecified" — same as omitting the argument.
  const edges = edges_?.length
    ? allEdges.filter((edge) => edges_.includes(edge.id))
    : allEdges;

  // Cairo, London and Tokyo pack their run ends: when the drawn model would
  // overshoot the run, redraw among the models that still fit instead of
  // leaving up to a whole footprint of bare kerb — a terrace (or a Setagaya
  // house row) with a random gap at one end is exactly the broken-tooth
  // look none of those three streets can have. NYC keeps draw-or-break —
  // its blocks are ringed by streets so the waste hides at corners, and
  // consuming extra rng draws would silently reshuffle every shipped NYC
  // street. (London, and then Tokyo — Tokyo authenticity plan P2 — both
  // opted in while zero blocks referenced their own sets, for the same
  // reason: this flag changes the rng draw sequence, so it is free exactly
  // once.)
  const packRunEnds =
    setId.startsWith("cairo") || setId.startsWith("london") || setId.startsWith("tokyo");

  const placed: PlacedBuilding[] = [];
  let slot = 0;
  for (const edge of edges) {
    let cursor = edge.runStart;
    let edgeSlot = 0;
    // Guard against absurd loops on degenerate blocks.
    let guard = 0;
    while (cursor < edge.runEnd && guard++ < 256) {
      let model = models[Math.floor(rng() * models.length)];
      if (
        packRunEnds &&
        cursor + model.cfg.footprintM > edge.runEnd + 0.01
      ) {
        const fitting = models.filter(
          (m) => cursor + m.cfg.footprintM <= edge.runEnd + 0.01,
        );
        if (fitting.length) {
          model = fitting[Math.floor(rng() * fitting.length)];
        }
      }
      const foot = model.cfg.footprintM;
      const depth = model.cfg.depthM ?? foot;
      const along = cursor + foot / 2;
      if (along + foot / 2 > edge.runEnd + 0.01) break;
      // Thin the wall on weak devices: advance the cursor regardless so spacing
      // stays stable, but skip this slot when it falls outside keepFraction.
      const blockSlot = slot;
      const keep =
        keepFraction >= 1 || assetDetailScoreForBlockSlot(blockSlot) < keepFraction;
      slot += 1;
      if (keep) {
        const inset = depth / 2;
        const x = edge.runAxis === "x" ? along : edge.fixed + edge.inX * inset;
        const z = edge.runAxis === "z" ? along : edge.fixed + edge.inZ * inset;
        // Front is on local -Z (glTF-loader flip); front world dir = yaw+π, so to
        // face outward `edge.outward` set yaw = outward - π (+ per-model offset).
        const yaw = edge.outward - Math.PI + model.cfg.frontOffset;
        placed.push({
          modelId: model.id,
          url: model.url,
          x,
          z,
          yaw,
          scale: model.cfg.scale,
          groundY: model.cfg.groundY,
          edge: edge.id,
          edgeSlot,
          blockSlot,
        });
      }
      edgeSlot += 1;
      cursor = along + foot / 2 + GAP_M;
    }
  }
  return placed;
}
