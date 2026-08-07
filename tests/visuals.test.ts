import { describe, expect, it } from "vitest";
import {
  buildAsphaltTextureSpec,
  buildGrassDetailSpec,
  buildGrassTextureSpec,
  buildHorizonSilhouetteSpec,
  buildPlanarUVs,
  buildRiverWaveField,
  distanceToPolylineM,
  generateRoadsidePropPlacements,
  hashStringToSeed,
  mixHexColors,
  resolveCameraFarPlane,
  resolveEffectiveFogRange,
  resolveFogRange,
  resolveMapVisualKey,
  resolveMapVisualPalette,
  resolveMapVisualProfile,
  sampleRiverWaveField,
  seededUnit,
  skyGradientStops,
  type PropScatterInput,
} from "../app/game/visuals";
import { ALL_BUILDING_SET_IDS, isBuildingSetId } from "../app/game/buildingSets";
import {
  CHARACTER_PALETTE_SLOTS,
  CHARACTER_RAMP_LENGTH,
} from "../app/game/characterPalettes";
import { CAIRO_MAP_PACK } from "../app/game/cities/cairo";
import { LONDON_MAP_PACK } from "../app/game/cities/london";
import { NYC_MAP_PACK } from "../app/game/cities/nyc";
import { TOKYO_MAP_PACK } from "../app/game/cities/tokyo";

const HEX_PATTERN = /^#[\da-f]{6}$/i;

const STRAIGHT_ROAD = {
  id: "straight",
  centerline: [
    { x: -100, z: 0 },
    { x: 100, z: 0 },
  ],
  widthM: 7,
} as const;

const SCATTER_FIXTURE: PropScatterInput = {
  roadSurfaces: [STRAIGHT_ROAD],
  blocks: [{ center: { x: 40, z: 20 }, size: { x: 30, z: 16 } }],
  landmarks: [{ center: { x: -50, z: -22 }, size: { x: 18, z: 12 } }],
  worldSize: { x: 240, z: 120 },
  shoulderWidthM: 1.2,
  seed: 1234,
  kinds: [
    {
      kind: "tree",
      spacingM: 14,
      jitterM: 4,
      lateralMarginM: 2,
      bothSides: true,
      variants: 3,
      minScale: 0.85,
      maxScale: 1.3,
    },
    {
      kind: "streetlight",
      spacingM: 22,
      jitterM: 3,
      lateralMarginM: 1,
      bothSides: false,
      alternateSides: true,
      variants: 1,
      faceRoad: true,
    },
  ],
};

describe("map visual palettes", () => {
  it("resolves the expected visual key for every shipped map", () => {
    expect(resolveMapVisualKey("nyc-upper-west-side")).toBe("nyc");
    expect(resolveMapVisualKey("london-south-kensington")).toBe("london");
    expect(resolveMapVisualKey("tokyo-setagaya")).toBe("tokyo");
    expect(resolveMapVisualKey("cairo-central-nile")).toBe("cairo");
  });

  it("throws on an id with no registered profile instead of guessing", () => {
    // The trap this replaced: a substring match that fell back to "nyc" for
    // anything it didn't recognise, so a typo'd or new map id silently
    // borrowed NYC's palette. A misspelling of a real id must fail exactly
    // like a wholly unrelated one — "close but wrong" is still wrong.
    for (const badId of ["", "nyc", "nyc-upper-west-sid", "mars-base-one"]) {
      expect(() => resolveMapVisualKey(badId)).toThrow(badId || undefined);
      expect(() => resolveMapVisualPalette(badId)).toThrow();
      expect(() => resolveMapVisualProfile(badId)).toThrow();
    }
  });

  it("provides complete hex palettes and ordered sky gradients", () => {
    for (const mapId of [
      "nyc-upper-west-side",
      "london-south-kensington",
      "tokyo-setagaya",
      "cairo-central-nile",
    ]) {
      const palette = resolveMapVisualPalette(mapId);
      for (const value of Object.values(palette)) {
        // Palettes are all hex colours except the optional `paved` boolean flag.
        if (typeof value !== "string") continue;
        expect(value).toMatch(HEX_PATTERN);
      }
      const stops = skyGradientStops(palette);
      expect(stops[0]).toEqual({ offset: 0, color: palette.skyTop });
      expect(stops.at(-1)).toEqual({ offset: 1, color: palette.skyHorizon });
      for (let index = 1; index < stops.length; index += 1) {
        expect(stops[index].offset).toBeGreaterThan(stops[index - 1].offset);
        expect(stops[index].color).toMatch(HEX_PATTERN);
      }
    }
  });

  it("mixes hex colors channel-wise", () => {
    expect(mixHexColors("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHexColors("#204060", "#204060", 0.7)).toBe("#204060");
    expect(mixHexColors("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHexColors("#000000", "#ffffff", 1)).toBe("#ffffff");
  });
});

// Issue #291: the per-city visual profile widened from #286's bare
// `{ visualKey }` to also carry the plate/building/nature/character
// selectors every render-side seam used to derive with its own mapId-sniffing
// switch or substring match. These are the registry's own data-integrity
// checks; per-seam behaviour parity (which paint/model/palette a seam
// actually renders) stays pinned in that seam's own test file
// (vehicleVisuals.test.ts, characterPalettes.test.ts, natureAssets.test.ts)
// plus the four-city mesh/material fingerprint in
// fourCityRenderCharacterization.test.tsx.
describe("per-city visual profile", () => {
  const REAL_MAP_PACKS = [NYC_MAP_PACK, LONDON_MAP_PACK, TOKYO_MAP_PACK, CAIRO_MAP_PACK];

  it("gives every shipped map a plate region, drawn from the real four", () => {
    expect(resolveMapVisualProfile("nyc-upper-west-side").plateRegion).toBe("us");
    expect(resolveMapVisualProfile("london-south-kensington").plateRegion).toBe("uk");
    expect(resolveMapVisualProfile("tokyo-setagaya").plateRegion).toBe("jp");
    expect(resolveMapVisualProfile("cairo-central-nile").plateRegion).toBe("eg");
  });

  it("only lists real building-set ids, and only for the cities that use instanced sets", () => {
    for (const mapPack of REAL_MAP_PACKS) {
      const profile = resolveMapVisualProfile(mapPack.id);
      for (const setId of profile.buildingSets) {
        expect(isBuildingSetId(setId), `${mapPack.id} -> ${setId}`).toBe(true);
        // A city's allow-list may only name sets that share its own prefix —
        // this is exactly the leak the registry exists to make impossible:
        // NYC content quietly drawing from a Cairo catalogue or vice versa.
        expect(setId.startsWith(profile.visualKey === "nyc" ? "nyc-" : "cairo-")).toBe(
          true,
        );
      }
    }
    expect(resolveMapVisualProfile("london-south-kensington").buildingSets).toEqual([]);
    expect(resolveMapVisualProfile("tokyo-setagaya").buildingSets).toEqual([]);
    // Every catalogued set belongs to exactly one city's allow-list.
    const claimed = REAL_MAP_PACKS.flatMap(
      (mapPack) => resolveMapVisualProfile(mapPack.id).buildingSets,
    );
    expect([...claimed].sort()).toEqual([...ALL_BUILDING_SET_IDS].sort());
  });

  it("never lets a city's authored blocks reference another city's building set", () => {
    // The invariant `buildingSets.ts` alone cannot check: SETS only knows
    // model catalogues, not which map is allowed to point at which set. A
    // typo'd cross-city buildingSet on a block would previously render
    // silently (or drop the block if the id were bogus); this at least makes
    // a *wrong-but-valid* set id fail a test instead of shipping quietly.
    for (const mapPack of REAL_MAP_PACKS) {
      const allowed = new Set(resolveMapVisualProfile(mapPack.id).buildingSets);
      for (const block of mapPack.geometry.blocks) {
        if (!block.buildingSet) continue;
        expect(
          allowed.has(block.buildingSet as (typeof ALL_BUILDING_SET_IDS)[number]),
          `${mapPack.id} block ${block.id} references ${block.buildingSet}`,
        ).toBe(true);
      }
    }
  });

  it("gives every shipped map a non-empty nature-set draw list", () => {
    for (const mapPack of REAL_MAP_PACKS) {
      expect(resolveMapVisualProfile(mapPack.id).natureSets.length).toBeGreaterThan(0);
    }
  });

  it("gives every shipped map complexion/hair weight rows that sum to a full palette", () => {
    for (const mapPack of REAL_MAP_PACKS) {
      const profile = resolveMapVisualProfile(mapPack.id);
      for (const weights of [profile.complexionWeights, profile.hairWeights]) {
        expect(weights).toHaveLength(CHARACTER_RAMP_LENGTH);
        expect(weights.reduce((total, weight) => total + weight, 0)).toBe(
          CHARACTER_PALETTE_SLOTS,
        );
        for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("fog ranges", () => {
  it("clamps small maps to a gentle band", () => {
    expect(resolveFogRange({ x: 140, z: 110 })).toEqual({ start: 70, end: 340 });
  });

  it("stretches with a long city but stays bounded", () => {
    expect(resolveFogRange({ x: 1500, z: 300 })).toEqual({
      start: 160,
      end: 1100,
    });
  });

  it("tightens the night band, and only the night band", () => {
    // NYC-sized night grid: both ends hit the night caps.
    expect(resolveEffectiveFogRange(true, { x: 1080, z: 3000 })).toEqual({
      start: 100,
      end: 440,
    });
    // Same world by day keeps the plain range.
    expect(resolveEffectiveFogRange(false, { x: 1080, z: 3000 })).toEqual(
      resolveFogRange({ x: 1080, z: 3000 }),
    );
    // A small night map already under the caps is untouched.
    expect(resolveEffectiveFogRange(true, { x: 180, z: 180 })).toEqual({
      start: 81,
      end: 340,
    });
  });

  it("lets a day palette cap its own far end — Cairo's dust haze", () => {
    // Cairo's world size with its palette cap: the 1100 m formula result
    // hazes down to 650, start untouched.
    expect(resolveEffectiveFogRange(false, { x: 1770, z: 1830 }, 650)).toEqual({
      start: 160,
      end: 650,
    });
    // A cap wider than the formula's band is a no-op.
    expect(resolveEffectiveFogRange(false, { x: 1770, z: 1830 }, 2000)).toEqual(
      resolveFogRange({ x: 1770, z: 1830 }),
    );
    // No cap: unchanged behaviour.
    expect(resolveEffectiveFogRange(false, { x: 1770, z: 1830 })).toEqual(
      resolveFogRange({ x: 1770, z: 1830 }),
    );
    // The cap composes with night's own tightening rather than fighting it.
    expect(resolveEffectiveFogRange(true, { x: 1770, z: 1830 }, 650)).toEqual({
      start: 100,
      end: 440,
    });
  });
});

describe("camera far plane", () => {
  it("rides 20m past the effective fog end", () => {
    // Night NYC: fog fully swallows the world at 440.
    expect(resolveCameraFarPlane(true, { x: 1080, z: 3000 })).toBe(460);
    // A long daylit corridor, where the far plane rides the unclamped band.
    expect(resolveCameraFarPlane(false, { x: 1500, z: 300 })).toBe(1120);
    // A compact daylit world remains inside the base range.
    expect(resolveCameraFarPlane(false, { x: 180, z: 180 })).toBe(360);
    // Cairo's palette-capped haze: 650 + the 20 m margin.
    expect(resolveCameraFarPlane(false, { x: 1770, z: 1830 }, 650)).toBe(670);
  });
});

describe("horizon silhouettes", () => {
  it("is deterministic and stays in normalised bounds", () => {
    for (const mapId of [
      "nyc-upper-west-side",
      "london-south-kensington",
      "tokyo-setagaya",
      "cairo-central-nile",
    ]) {
      const seed = hashStringToSeed(mapId);
      const first = buildHorizonSilhouetteSpec(mapId, seed);
      const second = buildHorizonSilhouetteSpec(mapId, seed);
      expect(second).toEqual(first);
      expect(first.length).toBeGreaterThan(0);
      for (const shape of first) {
        expect(shape.x).toBeGreaterThanOrEqual(0);
        expect(shape.x).toBeLessThanOrEqual(1);
        expect(shape.w).toBeGreaterThan(0);
        expect(shape.h).toBeGreaterThan(0);
        expect(shape.h).toBeLessThanOrEqual(1);
        expect([0, 1]).toContain(shape.layer);
      }
    }
  });

  it("keeps recognisable per-map ingredients", () => {
    const seed = 99;
    const tokyoKinds = new Set(
      buildHorizonSilhouetteSpec("tokyo-setagaya", seed).map((shape) => shape.kind),
    );
    expect(tokyoKinds.has("pylon")).toBe(true);
    const nycKinds = new Set(
      buildHorizonSilhouetteSpec("nyc-upper-west-side", seed).map((shape) => shape.kind),
    );
    expect(nycKinds.has("box")).toBe(true);
    expect(nycKinds.has("spike")).toBe(true);
    const cairoKinds = new Set(
      buildHorizonSilhouetteSpec("cairo-central-nile", seed).map(
        (shape) => shape.kind,
      ),
    );
    expect(cairoKinds.has("box")).toBe(true);
    expect(cairoKinds.has("spike")).toBe(true);
    expect(cairoKinds.has("pylon")).toBe(true);
  });
});

describe("texture specs", () => {
  it("builds deterministic asphalt and grass specs in bounds", () => {
    expect(buildAsphaltTextureSpec(7)).toEqual(buildAsphaltTextureSpec(7));
    expect(buildGrassTextureSpec(7)).toEqual(buildGrassTextureSpec(7));
    const asphalt = buildAsphaltTextureSpec(7);
    expect(asphalt.cracks.length).toBeGreaterThanOrEqual(6);
    for (const crack of asphalt.cracks) {
      for (const point of crack.points) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThan(1);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThan(1);
      }
    }
    const grass = buildGrassTextureSpec(11);
    expect(grass.blobs.length).toBeGreaterThan(100);
  });

  it("layers the grass spec from distance tones down to blades", () => {
    const grass = buildGrassTextureSpec(11);
    // Each layer answers a different viewing distance: patches survive
    // mipping and carry the far read, blades carry the close one. Losing
    // either is how the ground goes back to being one flat green card.
    expect(grass.patches.length).toBeGreaterThan(8);
    expect(grass.blades.length).toBeGreaterThan(1500);
    expect(grass.flora.length).toBeGreaterThan(0);
    expect(grass.bare.length).toBeGreaterThan(0);

    for (const layer of [grass.patches, grass.bare, grass.flora]) {
      for (const item of layer) {
        expect(item.x).toBeGreaterThanOrEqual(0);
        expect(item.x).toBeLessThan(1);
        expect(item.y).toBeGreaterThanOrEqual(0);
        expect(item.y).toBeLessThan(1);
        expect(item.r).toBeGreaterThan(0);
      }
    }
    for (const patch of grass.patches) {
      expect(patch.tone).toBeGreaterThanOrEqual(0);
      expect(patch.tone).toBeLessThan(3);
    }
    for (const blade of grass.blades) {
      expect(blade.x).toBeGreaterThanOrEqual(0);
      expect(blade.x).toBeLessThan(1);
      expect(blade.y).toBeGreaterThanOrEqual(0);
      expect(blade.y).toBeLessThan(1);
      expect(blade.length).toBeGreaterThan(0);
      expect(blade.width).toBeGreaterThan(0);
      // The painter indexes a four-entry ramp and steps one lighter for the
      // tip, so an out-of-range tone would silently paint the wrong colour.
      expect(blade.tone).toBeGreaterThanOrEqual(0);
      expect(blade.tone).toBeLessThan(4);
    }
  });

  it("leans blades together rather than pointing them randomly", () => {
    // A lawn is read by its combing. Uniformly random angles paint noise, so
    // the correlation is the effect — assert it rather than trusting it.
    const blades = buildGrassTextureSpec(11).blades;
    const meanX =
      blades.reduce((sum, blade) => sum + Math.cos(blade.angle), 0) /
      blades.length;
    const meanY =
      blades.reduce((sum, blade) => sum + Math.sin(blade.angle), 0) /
      blades.length;
    // Circular mean resultant length: ~0 for uniform angles, 1 for identical.
    expect(Math.hypot(meanX, meanY)).toBeGreaterThan(0.5);
  });

  it("builds a deterministic mid-grey detail spec", () => {
    expect(buildGrassDetailSpec(5)).toEqual(buildGrassDetailSpec(5));
    const detail = buildGrassDetailSpec(5);
    expect(detail.length).toBeGreaterThan(100);
    // Coarser than the base tile's blades: it is sampled at a ~3 m repeat
    // against the base tile's 12 m, so equal-sized strokes would vanish.
    const base = buildGrassTextureSpec(5).blades;
    const mean = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(detail.map((blade) => blade.width))).toBeGreaterThan(
      mean(base.map((blade) => blade.width)),
    );
  });
});

describe("river wave field", () => {
  // The Nile's heading: 0 = +z, so 180° flows toward -z and its crests must
  // line up with the z axis.
  const NILE = { seed: 4242, flowHeadingRad: Math.PI };

  it("quantises every component to a seamless integer lattice", () => {
    const waves = buildRiverWaveField({ ...NILE, count: 20, minCycles: 1, maxCycles: 9 });
    expect(waves.length).toBeGreaterThan(15);
    for (const wave of waves) {
      expect(Number.isInteger(wave.cyclesU)).toBe(true);
      expect(Number.isInteger(wave.cyclesV)).toBe(true);
      expect(wave.cyclesU === 0 && wave.cyclesV === 0).toBe(false);
      expect(Math.hypot(wave.cyclesU, wave.cyclesV)).toBeLessThanOrEqual(10);
      expect(wave.phase).toBeGreaterThanOrEqual(0);
      expect(wave.phase).toBeLessThan(Math.PI * 2);
    }
    expect(waves).toEqual(
      buildRiverWaveField({ ...NILE, count: 20, minCycles: 1, maxCycles: 9 }),
    );
  });

  it("runs its crests along the current, not across it", () => {
    const waves = buildRiverWaveField({
      ...NILE,
      count: 40,
      minCycles: 2,
      maxCycles: 8,
      crossFraction: 0.25,
    });
    // A crest along the flow (here the z axis) is a wave vector across it,
    // which for this heading means most of the energy sits on cyclesU.
    const alongFlow = waves.filter(
      (wave) => Math.abs(wave.cyclesU) > Math.abs(wave.cyclesV),
    );
    expect(alongFlow.length).toBeGreaterThan(waves.length * 0.6);
    // ...but not all of it, or the surface reads as combed rather than choppy.
    expect(alongFlow.length).toBeLessThan(waves.length);
  });

  it("samples a normalised tile that wraps in both axes", () => {
    const waves = buildRiverWaveField({ ...NILE, count: 12, minCycles: 1, maxCycles: 6 });
    const size = 32;
    const field = sampleRiverWaveField(waves, size);
    expect(field).toHaveLength(size * size);
    let peak = 0;
    for (const value of field) peak = Math.max(peak, Math.abs(value));
    expect(peak).toBeCloseTo(1, 6);

    // The separable expansion has to agree with the direct evaluation, and
    // sampling one tile beyond the edge has to land back on the first row and
    // column — that is what keeps a repeating tile from seaming.
    const direct = (u: number, v: number) =>
      waves.reduce(
        (sum, wave) =>
          sum +
          wave.amplitude *
            Math.sin(
              2 * Math.PI * (wave.cyclesU * u + wave.cyclesV * v) + wave.phase,
            ),
        0,
      );
    let peakDirect = 0;
    for (let v = 0; v < size; v += 1) {
      for (let u = 0; u < size; u += 1) {
        peakDirect = Math.max(peakDirect, Math.abs(direct(u / size, v / size)));
      }
    }
    for (const [u, v] of [[0, 0], [7, 3], [31, 18], [12, 31]] as const) {
      expect(field[v * size + u]).toBeCloseTo(
        direct(u / size, v / size) / peakDirect,
        5,
      );
      expect(direct(u / size + 1, v / size + 1)).toBeCloseTo(
        direct(u / size, v / size),
        6,
      );
    }
  });

  it("returns a flat tile rather than throwing on an empty field", () => {
    expect([...sampleRiverWaveField([], 4)]).toEqual(new Array(16).fill(0));
  });
});

describe("planar UVs", () => {
  it("maps world x/z through the scale", () => {
    expect(buildPlanarUVs([0, 0.07, 0, 10, 0.07, 20], 0.1)).toEqual([
      0, 0, 1, 2,
    ]);
  });
});

describe("distanceToPolylineM", () => {
  it("measures point-to-segment distance", () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(distanceToPolylineM({ x: 5, z: 0 }, line)).toBe(0);
    expect(distanceToPolylineM({ x: 5, z: 4 }, line)).toBeCloseTo(4, 6);
    expect(distanceToPolylineM({ x: -3, z: 4 }, line)).toBeCloseTo(5, 6);
    expect(distanceToPolylineM({ x: 2, z: 1 }, [{ x: 0, z: 0 }])).toBeCloseTo(
      Math.hypot(2, 1),
      6,
    );
  });
});

describe("roadside prop scatter", () => {
  it("is deterministic for the same seed", () => {
    expect(generateRoadsidePropPlacements(SCATTER_FIXTURE)).toEqual(
      generateRoadsidePropPlacements(SCATTER_FIXTURE),
    );
  });

  it("produces placements that respect every clearance rule", () => {
    const placements = generateRoadsidePropPlacements(SCATTER_FIXTURE);
    expect(placements.length).toBeGreaterThan(6);
    const clearance =
      STRAIGHT_ROAD.widthM / 2 + SCATTER_FIXTURE.shoulderWidthM + 0.6;
    for (const placement of placements) {
      expect(
        distanceToPolylineM(
          { x: placement.x, z: placement.z },
          STRAIGHT_ROAD.centerline,
        ),
      ).toBeGreaterThanOrEqual(clearance);
      for (const rect of [
        ...SCATTER_FIXTURE.blocks,
        ...SCATTER_FIXTURE.landmarks,
      ]) {
        const inside =
          Math.abs(placement.x - rect.center.x) <= rect.size.x / 2 + 1 &&
          Math.abs(placement.z - rect.center.z) <= rect.size.z / 2 + 1;
        expect(inside).toBe(false);
      }
      expect(Math.abs(placement.x)).toBeLessThanOrEqual(240 / 2 - 4);
      expect(Math.abs(placement.z)).toBeLessThanOrEqual(120 / 2 - 4);
    }
    for (const [index, placement] of placements.entries()) {
      for (const other of placements.slice(index + 1)) {
        expect(
          Math.hypot(placement.x - other.x, placement.z - other.z),
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("turns face-road props toward the carriageway", () => {
    const placements = generateRoadsidePropPlacements(SCATTER_FIXTURE).filter(
      (placement) => placement.kind === "streetlight",
    );
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      // Local +z maps to (sin rotationY, cos rotationY); on a straight road
      // along x the carriageway sits at z = 0, so the facing vector must point
      // from the prop back toward the centreline.
      const facingZ = Math.cos(placement.rotationY);
      expect(facingZ * -Math.sign(placement.z)).toBeGreaterThan(0.99);
    }
  });

  // Scatter walks road geometry, so a riverside road offers candidates on its
  // water side exactly like any other. Nothing rejected them, and Cairo grew
  // trees in the Nile.
  it("never stands a prop in open water", () => {
    const river = [
      { x: -120, z: 4 },
      { x: 120, z: 4 },
      { x: 120, z: 60 },
      { x: -120, z: 60 },
    ];
    const placements = generateRoadsidePropPlacements({
      ...SCATTER_FIXTURE,
      waterPolygons: [river],
    });
    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) {
      expect(
        placement.z < 4 || placement.z > 60,
        `prop at z=${placement.z.toFixed(1)} is in the river`,
      ).toBe(true);
    }
    // And the dry bank still gets its share, rather than the whole road going
    // bare because one side is water.
    expect(placements.filter((p) => p.z < 4).length).toBeGreaterThan(4);
  });

  it("respects hand-placed furniture through occupiedPoints", () => {
    const occupiedPoints: { x: number; z: number }[] = [];
    for (let x = -104; x <= 104; x += 2) {
      for (const z of [-6.5, 6.5]) {
        occupiedPoints.push({ x, z });
      }
    }
    const placements = generateRoadsidePropPlacements({
      ...SCATTER_FIXTURE,
      kinds: [
        {
          kind: "streetlight",
          spacingM: 22,
          jitterM: 3,
          lateralMarginM: 1,
          bothSides: false,
          alternateSides: true,
          variants: 1,
          faceRoad: true,
        },
      ],
      occupiedPoints,
    });
    expect(placements).toEqual([]);
  });

  it("uses each road's own sidewalk width and rotated block footprint", () => {
    const block = {
      center: { x: 0, z: 12 },
      size: { x: 42, z: 5 },
      headingDeg: 38,
    };
    const placements = generateRoadsidePropPlacements({
      ...SCATTER_FIXTURE,
      roadSurfaces: [{ ...STRAIGHT_ROAD, sidewalkWidthM: 7 }],
      blocks: [block],
      landmarks: [],
      worldSize: { x: 240, z: 100 },
      kinds: [
        {
          kind: "palm",
          spacingM: 9,
          jitterM: 1,
          lateralMarginM: 1,
          bothSides: true,
          variants: 2,
        },
      ],
    });
    expect(placements.length).toBeGreaterThan(4);
    const heading = (block.headingDeg * Math.PI) / 180;
    for (const placement of placements) {
      expect(
        distanceToPolylineM(placement, STRAIGHT_ROAD.centerline),
      ).toBeGreaterThanOrEqual(STRAIGHT_ROAD.widthM / 2 + 7 + 0.6);
      const dx = placement.x - block.center.x;
      const dz = placement.z - block.center.z;
      const localX = dx * Math.cos(heading) - dz * Math.sin(heading);
      const localZ = dx * Math.sin(heading) + dz * Math.cos(heading);
      expect(
        Math.abs(localX) <= block.size.x / 2 + 1 &&
          Math.abs(localZ) <= block.size.z / 2 + 1,
      ).toBe(false);
    }
  });
});

describe("deterministic seeds", () => {
  it("hashes strings to stable non-zero seeds", () => {
    expect(hashStringToSeed("nyc-upper-west-side")).toBe(
      hashStringToSeed("nyc-upper-west-side"),
    );
    expect(hashStringToSeed("a")).not.toBe(hashStringToSeed("b"));
    expect(hashStringToSeed("")).toBeGreaterThan(0);
  });

  it("seededUnit repeats its stream and stays in [0, 1)", () => {
    const first = seededUnit(42);
    const second = seededUnit(42);
    for (let index = 0; index < 32; index += 1) {
      const value = first();
      expect(second()).toBe(value);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
