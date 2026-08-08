/**
 * Procedural curbside street addresses — the places gigs actually get delivered
 * to.
 *
 * A map authors only a handful of named gig venues (NYC has four across 0.82
 * km²), which meant every delivery and every fare shuttled between the same few
 * points. Real residents live in the hundreds of buildings the street-wall
 * system already renders, so rather than hand-author more venues this module
 * derives drop-off points from the lane graph itself: walk each street, take the
 * kerb on the driver's right, and keep the spots that genuinely front a
 * building.
 *
 * Renderer-agnostic (no Babylon imports) and pure/deterministic in `mapId`, so
 * the same map always yields the same addresses and the whole thing is
 * unit-testable — same contract as {@link ./buildingSets}.
 *
 * The load-bearing rule is the **frontage probe**: a candidate is kept only if a
 * point a little further past the kerb lands inside a `ProceduralBlock`. That
 * single test does most of the work — it rejects inner lanes (whose "kerb" is
 * really the next carriageway over), it rejects the Central Park side of Central
 * Park West, and it hands back the block's `buildingSet` so the address can
 * describe itself as a residence, an office or a shop.
 */
import { resolveSimulationLaneAnchor } from "./simulationAdapter";
import type { GigVenueKind, WorldPoint } from "./types";
import { distanceToPolylineM, hashStringToSeed, seededUnit } from "./visuals";

/**
 * The only lane fields address generation needs. Both the authored
 * `LaneSegment` and the renderer's lighter `GameCanvasLane` satisfy it — hence
 * the optional fields, which the renderer's type leaves off. A lane missing
 * either simply gets no addresses.
 */
export interface AddressLane {
  readonly id: string;
  /** Groups lanes into a street; drives the address's street name. */
  readonly roadId?: string;
  readonly centerline: readonly WorldPoint[];
  readonly role?: string;
  /** Which side of the road this lane's traffic keeps to. Absent means the
   * right, which is what every map but London drives on. */
  readonly trafficSide?: string;
}

/** A zoned city block. `ProceduralBlock` satisfies it. */
export interface AddressBlock {
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  readonly buildingSet?: string;
  /** Clockwise yaw, for a parcel that follows a street rather than an axis. */
  readonly headingDeg?: number;
  /** Facade material, which is how a city with no building sets zones. */
  readonly material?: string;
}

/** A park/museum/station footprint that must never host an address. */
export interface AddressLandmark {
  readonly kind: string;
  readonly center: WorldPoint;
  readonly size: WorldPoint;
}

/** A painted carriageway, which a kerb spot has to stay off. */
export interface AddressRoadSurface {
  readonly centerline: readonly WorldPoint[];
  readonly widthM: number;
}

export interface StreetAddressInput {
  /** Seeds the RNG, so a map's addresses are stable across runs. */
  readonly mapId: string;
  readonly lanes: readonly AddressLane[];
  readonly blocks: readonly AddressBlock[];
  readonly landmarks: readonly AddressLandmark[];
  readonly roadSurfaces: readonly AddressRoadSurface[];
  /** Display names by `roadId`. A profiled street with no name here generates
   * nothing — the address would have no street to be on. */
  readonly roadNames?: Readonly<Record<string, string>>;
  /** Authored venue + service-point anchors to keep clear of. */
  readonly occupiedPoints?: readonly WorldPoint[];
  /** Mean distance between addresses along one kerb. Defaults to 150 m. */
  readonly spacingM?: number;
}

/** One generated drop-off point, shaped to slot straight into a gig. */
export interface StreetAddress {
  readonly id: string;
  /** Display name, e.g. "214 Amsterdam Ave". */
  readonly name: string;
  readonly kind: GigVenueKind;
  /** The street this address is on (`LaneSegment.roadId`). */
  readonly roadId: string;
  /** Which kerb of that street: the two sides are -1 and +1. */
  readonly side: -1 | 1;
  readonly laneId: string;
  readonly distanceAlongM: number;
  /** Lane-centreline point — the gig arrival target, matching authored venues. */
  readonly x: number;
  readonly z: number;
  /** Kerb point, where a rider waits and the drop-off marker stands. */
  readonly kerbX: number;
  readonly kerbZ: number;
  /** Kerb facing, looking back across the carriageway. */
  readonly facing: number;
}

/** Enough of a map pack to derive its addresses. Both the authored `MapPack`
 * and the renderer's `GameCanvasMapPack` satisfy this. */
export interface AddressMapPack {
  readonly id: string;
  readonly geometry: {
    readonly blocks?: readonly AddressBlock[];
    readonly landmarks?: readonly AddressLandmark[];
    readonly roadSurfaces?: readonly AddressRoadSurface[];
    readonly gigVenues?: readonly {
      readonly anchor: { readonly laneId: string; readonly distanceAlongM: number };
    }[];
    readonly servicePoints?: readonly {
      readonly anchor: { readonly laneId: string; readonly distanceAlongM: number };
    }[];
  };
  readonly laneGraph: { readonly lanes: readonly AddressLane[] };
  readonly roadNames?: Readonly<Record<string, string>>;
}

const ADDRESSES_BY_MAP = new Map<string, readonly StreetAddress[]>();

/**
 * A map's addresses, derived once and cached.
 *
 * Three callers need the identical list — gig selection, the renderer (which
 * stands riders and the drop-off marker on their kerbs) and the tests — and
 * they must agree exactly, since a gig refers to a stop by id. Deriving it
 * here rather than at each call site is what guarantees that, and saves walking
 * the whole lane graph on every payout.
 */
export function streetAddressesForMap(
  pack: AddressMapPack,
): readonly StreetAddress[] {
  const cached = ADDRESSES_BY_MAP.get(pack.id);
  if (cached) return cached;
  const lanes = pack.laneGraph.lanes;
  const addresses = generateStreetAddresses({
    mapId: pack.id,
    lanes,
    blocks: pack.geometry.blocks ?? [],
    landmarks: pack.geometry.landmarks ?? [],
    roadSurfaces: pack.geometry.roadSurfaces ?? [],
    roadNames: pack.roadNames,
    occupiedPoints: [
      ...(pack.geometry.gigVenues ?? []),
      ...(pack.geometry.servicePoints ?? []),
    ].flatMap((poi) => {
      const pose = resolveSimulationLaneAnchor(lanes, poi.anchor);
      return pose ? [{ x: pose.x, z: pose.z }] : [];
    }),
  });
  ADDRESSES_BY_MAP.set(pack.id, addresses);
  return addresses;
}

/** Lanes carrying real traffic. Connectors and roundabout arms get no addresses. */
const ADDRESSABLE_ROLES = new Set(["travel", "one_way"]);

/**
 * How far past the lane the rider stands. Matches the 4.5 m the renderer already
 * uses for a waiting passenger at a venue, nudged out to clear a paved sidewalk.
 */
const KERB_OFFSET_M = 5;

/**
 * Distances past the lane probed for building frontage. Blocks are inset from
 * the carriageway by roughly a road half-width plus a sidewalk, and that inset
 * varies per street, so probe a span rather than a single distance and take the
 * first block that answers.
 */
const FRONTAGE_PROBE_M = [12, 15, 18, 22] as const;

/**
 * Clearance from each end of a lane. Lanes meet at intersections, and a drop-off
 * in the middle of a junction is both unreachable and unreadable. Deliberately
 * far larger than the authored `connectorRanges`, which are only ~2 m node
 * spans and would let an address sit right on the crossing.
 */
export const JUNCTION_CLEARANCE_M = 32;

/**
 * Minimum gap between two addresses **on the same kerb** — roughly a couple of
 * brownstone frontages, so a street reads as a street rather than a row of
 * pins.
 */
export const MIN_SEPARATION_M = 40;

/**
 * Minimum gap between any two addresses regardless of side.
 *
 * This is deliberately much smaller than {@link MIN_SEPARATION_M}, because
 * separation is measured at the *lane* point and the two carriageways of a
 * two-way street are only ~3.4 m apart. Judging both kerbs by the same 40 m
 * rule meant whichever lane the walk reached first claimed the whole street and
 * the opposite kerb was left nearly empty. Two addresses facing each other
 * across a road is exactly what real streets look like, and it is harmless
 * here: only one address is ever the live gig target, so they cannot compete
 * over the arrival radius.
 */
export const MIN_OPPOSITE_KERB_M = 12;

/** How far an address must stay from an authored venue or a gas station. */
const POI_CLEARANCE_M = 30;

/**
 * Margin the kerb spot must keep beyond a carriageway edge. This is what stops
 * an *inner* lane from generating: its right-hand "kerb" is really the next
 * lane over, and while such a spot can still find building frontage further
 * out, a rider standing there would be stood in live traffic.
 *
 * The test is "at least this much clear", not "more than". The difference is
 * not pedantry: NYC's narrow one-way side streets are 9 m with their single
 * lane on the centreline, so `KERB_OFFSET_M` lands the rider at exactly 5 m —
 * the edge plus exactly this margin. Rejecting on equality silently excluded
 * every one of those six streets from having addresses at all, which read as
 * "side streets have no frontage" rather than as an off-by-a-boundary.
 */
const CARRIAGEWAY_CLEARANCE_M = 0.5;

/**
 * House numbering for a street, keyed by `LaneSegment.roadId`.
 *
 * **Presence in `STREET_PROFILES` is what makes a street addressable**, so this
 * table gates gig drop-offs and is not merely descriptive. The display name
 * deliberately does *not* live here any more: it moved to `MapPack.roadNames`
 * so that naming a street for turn-by-turn navigation cannot silently start
 * generating gigs on it. Keep the two apart — a road wants a name in far more
 * cities than it wants house numbers.
 */
interface StreetProfile {
  /** Which world axis the street runs along; numbering counts along it. */
  readonly axis: "x" | "z";
  /** House number at `axis = 0`. */
  readonly baseNumber: number;
  /** -1 when numbers count down as the axis rises (Manhattan's cross streets
   * number up as they run *west*, away from Central Park). */
  readonly axisSign?: -1 | 1;
  /** House numbers per metre. Cross streets number far faster than avenues:
   * a cross street covers one short block per number run, an avenue covers
   * fourteen. */
  readonly numbersPerM: number;
}

/**
 * Upper West Side streets. Numbers are in the right range for the real
 * neighbourhood — Broadway is in the 2100s up here, the avenues a little below
 * it, and the cross streets start from the park and count west.
 */
const AVENUE = { axis: "z", numbersPerM: 0.3 } as const;
/** Cross streets number west from the park, and far faster than an avenue.
 * `baseNumber` is rebased for the -700 x-shift in `cities/nyc.ts` (200 -
 * 0.55*700 = -185) so every existing address number is preserved exactly —
 * see .claude/nyc-east-expansion-plan.md section 3.1. */
const CROSS_STREET = {
  axis: "x",
  baseNumber: -185,
  axisSign: -1,
  numbersPerM: 0.55,
} as const;

/**
 * East cross streets number east from Fifth Avenue, the mirror of the west
 * rule — house #1 lands at Fifth (x -140): 78 + round(-140 * 0.55) = 1.
 */
const EAST_CROSS_STREET = {
  axis: "x",
  baseNumber: 78,
  axisSign: 1,
  numbersPerM: 0.55,
} as const;

/**
 * Bank streets number east from Vernon Blvd, the same shape as
 * `EAST_CROSS_STREET` but anchored so house #1 lands at Vernon (x 800):
 * 1 - round(800 * 0.42) = -335. Numbers run slower per metre than
 * Manhattan's side streets — a wider borough block, not a narrow one.
 */
const BOROUGH_CROSS_STREET = {
  axis: "x",
  baseNumber: -335,
  axisSign: 1,
  numbersPerM: 0.42,
} as const;

/**
 * London numbers modestly and slowly: a few hundred at most on a long street,
 * rather than Manhattan's four digits. Each road picks its own base so two
 * neighbouring streets do not read as the same numbers twice.
 */
const LONDON_EW = { axis: "x", numbersPerM: 0.2 } as const;
const LONDON_NS = { axis: "z", numbersPerM: 0.2 } as const;

const STREET_PROFILES: Record<string, StreetProfile> = {
  "nyc-riverside": { ...AVENUE, baseNumber: 250 },
  "nyc-west-end": { ...AVENUE, baseNumber: 500 },
  "nyc-broadway": { ...AVENUE, baseNumber: 2150 },
  "nyc-amsterdam": { ...AVENUE, baseNumber: 2050 },
  "nyc-columbus": { ...AVENUE, baseNumber: 1950 },
  "nyc-central-park-west": { ...AVENUE, baseNumber: 300 },
  // Every cross street, wide crosstown and narrow side street alike. The side
  // streets were held back while they had no names; now that they have them,
  // leaving them out only made the city's drop-offs cluster on six avenues.
  "nyc-west-59": CROSS_STREET,
  "nyc-west-61": CROSS_STREET,
  "nyc-west-65": CROSS_STREET,
  "nyc-west-68": CROSS_STREET,
  "nyc-west-72": CROSS_STREET,
  "nyc-west-75": CROSS_STREET,
  "nyc-west-79": CROSS_STREET,
  "nyc-west-82": CROSS_STREET,
  "nyc-west-86": CROSS_STREET,
  "nyc-west-91": CROSS_STREET,
  "nyc-west-96": CROSS_STREET,
  "nyc-west-100": CROSS_STREET,
  "nyc-west-106": CROSS_STREET,
  // East of the park (NYC east expansion, section 3.8). UES-ish magnitudes.
  "nyc-fifth": { ...AVENUE, baseNumber: 990 },
  "nyc-madison": { ...AVENUE, baseNumber: 940 },
  "nyc-park-ave": { ...AVENUE, baseNumber: 760 },
  "nyc-lexington": { ...AVENUE, baseNumber: 1140 },
  "nyc-third": { ...AVENUE, baseNumber: 1310 },
  "nyc-east-61": EAST_CROSS_STREET,
  "nyc-east-72": EAST_CROSS_STREET,
  "nyc-east-86": EAST_CROSS_STREET,
  "nyc-east-91": EAST_CROSS_STREET,
  "nyc-east-100": EAST_CROSS_STREET,
  // The borough (NYC east expansion, section 3.8). Four-digit bases read as
  // a different numbering district from Manhattan's, the way the real outer
  // boroughs' addresses do. Bridges and the esplanade stay unprofiled
  // deliberately — no doors open over water.
  "nyc-vernon": { ...AVENUE, baseNumber: 4000 },
  "nyc-crescent": { ...AVENUE, baseNumber: 4050 },
  "nyc-steinway": { ...AVENUE, baseNumber: 4100 },
  "nyc-bank-40": BOROUGH_CROSS_STREET,
  "nyc-bank-44": BOROUGH_CROSS_STREET,
  "nyc-bank-48": BOROUGH_CROSS_STREET,
  "nyc-bank-52": BOROUGH_CROSS_STREET,
  "nyc-bank-56": BOROUGH_CROSS_STREET,

  // London. Every road here is one a driver would recognise by name, which is
  // the point: a delivery reads "84 King's Road", not "the second block past
  // the roundabout". The quarter's three Cromwell Road surfaces share a name
  // and so share a number line; the generator steps past a collision rather
  // than dropping the address, so no two doors carry the same one.
  "london-cromwell-far-west": { ...LONDON_EW, baseNumber: 260 },
  "london-cromwell-west": { ...LONDON_EW, baseNumber: 260 },
  "london-cromwell-east": { ...LONDON_EW, baseNumber: 260 },
  "london-queen-gate": { ...LONDON_NS, baseNumber: 120 },
  "london-gloucester": { ...LONDON_NS, baseNumber: 150 },
  "london-gloucester-south": { ...LONDON_NS, baseNumber: 150 },
  "london-kensington": { ...LONDON_EW, baseNumber: 210 },
  "london-drayton-gardens": { ...LONDON_NS, baseNumber: 90 },
  "london-kings-road": { ...LONDON_EW, baseNumber: 330 },
  "london-old-brompton": { ...LONDON_EW, baseNumber: 340 },
  "london-earls-court-road": { ...LONDON_NS, baseNumber: 190 },
  "london-warwick-road": { ...LONDON_NS, baseNumber: 230 },
  "london-royal-hospital-road": { ...LONDON_EW, baseNumber: 190 },
  "london-sydney-street": { ...LONDON_NS, baseNumber: 70 },
  "london-chelsea-embankment": { ...LONDON_EW, baseNumber: 360 },
  "london-victoria-embankment": { ...LONDON_EW, baseNumber: 120 },
  "london-riverbank": { ...LONDON_EW, baseNumber: 340 },
  "london-battersea-road": { ...LONDON_EW, baseNumber: 380 },
  "london-knightsbridge": { ...LONDON_EW, baseNumber: 150 },
  "london-brompton-road": { ...LONDON_NS, baseNumber: 130 },
  "london-park-lane": { ...LONDON_NS, baseNumber: 40 },
  "london-bayswater": { ...LONDON_EW, baseNumber: 220 },
  "london-piccadilly": { ...LONDON_EW, baseNumber: 60 },
  "london-regent": { ...LONDON_NS, baseNumber: 100 },
  "london-oxford-street": { ...LONDON_EW, baseNumber: 90 },
  "london-euston": { ...LONDON_EW, baseNumber: 260 },
  "london-great-portland": { ...LONDON_NS, baseNumber: 60 },
  "london-buckingham-palace-road": { ...LONDON_EW, baseNumber: 180 },
  "london-victoria-street": { ...LONDON_EW, baseNumber: 100 },
  "london-whitehall": { ...LONDON_NS, baseNumber: 70 },
  "london-bishopsgate": { ...LONDON_NS, baseNumber: 110 },
  "london-london-wall": { ...LONDON_EW, baseNumber: 80 },
  "london-leadenhall": { ...LONDON_EW, baseNumber: 60 },
  "london-upper-street": { ...LONDON_NS, baseNumber: 130 },
  "london-canonbury": { ...LONDON_EW, baseNumber: 60 },
  "london-shoreditch": { ...LONDON_NS, baseNumber: 80 },
  // The back streets. Left out at first and the map's drop-offs clustered on
  // the arterials, which is the same mistake NYC made with its side streets:
  // a residential address belongs on a residential street.
  "london-chelsea-manor": { ...LONDON_NS, baseNumber: 40 },
  "london-flood-street": { ...LONDON_NS, baseNumber: 30 },
  "london-smith-street": { ...LONDON_NS, baseNumber: 30 },
  "london-cheyne-mews": { ...LONDON_EW, baseNumber: 40 },
  "london-nevern-place": { ...LONDON_EW, baseNumber: 50 },
  // The Notting Hill grid. Serpentine Road stays unprofiled on purpose: a
  // park drive has no letterboxes, and a profiled street that yields no
  // addresses fails `streetNames`.
  "london-notting-hill": { ...LONDON_EW, baseNumber: 1 },
  "london-porchester": { ...LONDON_NS, baseNumber: 2 },
  "london-westbourne": { ...LONDON_NS, baseNumber: 1 },
  "london-pembroke-crescent": { ...LONDON_EW, baseNumber: 70 },
  "london-lots-road": { ...LONDON_NS, baseNumber: 50 },
  "london-oakley-street": { ...LONDON_NS, baseNumber: 40 },
  "london-parkgate": { ...LONDON_NS, baseNumber: 40 },
  "london-nine-elms": { ...LONDON_NS, baseNumber: 60 },
  "london-tooley-street": { ...LONDON_NS, baseNumber: 60 },
  "london-cornmarket": { ...LONDON_NS, baseNumber: 40 },
  "london-king-william": { ...LONDON_NS, baseNumber: 50 },
  "london-minories": { ...LONDON_NS, baseNumber: 40 },
  "london-grosvenor": { ...LONDON_NS, baseNumber: 60 },
  "london-mall": { ...LONDON_EW, baseNumber: 30 },
  // No profile for a bridge: no doors open over water (the same rule keeps
  // NYC's two crossings address-free).
};

/**
 * Every street the generator is opted into, by display name.
 *
 * Derived from the profiles **intersected with the map's names**, not from the
 * names alone: a street can be named for navigation in a city that generates no
 * addresses at all, and listing those here would claim addresses that never
 * appear. A road with no profile produces nothing, silently, so this is
 * exported for tests to assert each profiled street really does yield some —
 * the only way that omission ever surfaces.
 */
export function addressableStreetNames(
  roadNames: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  if (!roadNames) return [];
  return [
    ...new Set(
      Object.keys(STREET_PROFILES)
        .map((roadId) => roadNames[roadId])
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

/** What a block's zoning makes the people living on its frontage. */
/**
 * London zones by facade *material* rather than by building set, because it
 * has no instanced sets: its street wall is procedural, and the material is
 * exactly what says which district a parcel is in. Consulted only when a
 * block names no building set, so it cannot change any NYC or Cairo address.
 */
const KINDS_BY_BLOCK_MATERIAL: Record<string, readonly GigVenueKind[]> = {
  "london-brick": ["residence"],
  "london-stock-brick": ["residence", "residence", "shop"],
  "white-stucco": ["residence"],
  // Whitehall and the City: offices, with the odd flat above.
  "london-portland-stone": ["office", "office", "residence"],
  "london-glass-curtain": ["office"],
};

const KINDS_BY_BUILDING_SET: Record<string, readonly GigVenueKind[]> = {
  "nyc-brownstone": ["residence"],
  "nyc-house": ["residence"],
  // Mid-rise is genuinely mixed-use: apartments over ground-floor offices.
  "nyc-midrise": ["residence", "residence", "office"],
  "nyc-downtown": ["office", "office", "residence"],
  "nyc-shop": ["shop", "residence"],
  // London's rows landed WITH the sets, before any block referenced them: this
  // table wins over KINDS_BY_BLOCK_MATERIAL the moment a block names a set, so
  // a set without a row here silently re-zones the whole block to plain
  // residences. Same kinds the material table assigns those districts today.
  // Terraces keep the corner-shop mix the stock-brick material row carried
  // before the sets took over the zoning — a terrace street with the odd
  // shop is the reference-photo look, and dropping it would quietly shrink
  // the delivery pool.
  "london-terrace": ["residence", "residence", "shop"],
  "london-stucco": ["residence"],
  "london-highstreet": ["shop", "residence"],
  "london-city": ["office", "office", "residence"],
};

const polylineLength = (points: readonly WorldPoint[]): number =>
  points.slice(1).reduce(
    (total, point, index) =>
      total + Math.hypot(point.x - points[index].x, point.z - points[index].z),
    0,
  );

/**
 * Rotation-aware, because London's roadside parcels are rotated: they follow
 * streets that bend, so `headingDeg` is the norm rather than the exception
 * there. An axis-aligned test against a long thin parcel lying at 40 degrees
 * answers for a bounding box twice its area — it finds frontage across the
 * road and misses frontage right in front of the probe.
 */
const isInsideRect = (
  point: WorldPoint,
  rect: {
    readonly center: WorldPoint;
    readonly size: WorldPoint;
    readonly headingDeg?: number;
  },
): boolean => {
  const dx = point.x - rect.center.x;
  const dz = point.z - rect.center.z;
  if (!rect.headingDeg) {
    return Math.abs(dx) <= rect.size.x / 2 && Math.abs(dz) <= rect.size.z / 2;
  }
  // Same convention the collider builder uses: local +x maps to world
  // (cos, -sin), so projecting a world point back is (cos, +sin).
  const yaw = (rect.headingDeg * Math.PI) / 180;
  const along = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const across = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return (
    Math.abs(along) <= rect.size.x / 2 && Math.abs(across) <= rect.size.z / 2
  );
};

/**
 * A house number for a kerb point. Derived from the world position rather than
 * `distanceAlongM`, because opposing lanes on the same street measure distance
 * from opposite ends — numbering off the lane would run the two sides of a
 * street in opposite directions. Parity marks the side, the way real streets do.
 */
function houseNumber(
  profile: StreetProfile,
  point: WorldPoint,
  kerb: WorldPoint,
): number {
  const along = (profile.axis === "z" ? point.z : point.x) * (profile.axisSign ?? 1);
  const across = profile.axis === "z" ? kerb.x - point.x : kerb.z - point.z;
  const raw = profile.baseNumber + Math.round(along * profile.numbersPerM);
  const number = Math.max(2, raw);
  // Manhattan's convention: even numbers run down the west side of an avenue
  // and the south side of a cross street — the negative side on both axes.
  const wantEven = across < 0;
  return number % 2 === (wantEven ? 0 : 1) ? number : number + 1;
}

/**
 * Curbside drop-off points across a map's streets.
 *
 * Walks every addressable lane by arclength, takes the kerb on the lane's
 * right-hand side (the same normal the renderer sets venues back along, so an
 * address lands on the side of the road you'd actually pull over on), and keeps
 * the candidates that front a real block, clear of junctions, parks, authored
 * venues and each other.
 */
export function generateStreetAddresses(
  input: StreetAddressInput,
): StreetAddress[] {
  const spacing = input.spacingM ?? 150;
  const rng = seededUnit(hashStringToSeed(input.mapId));
  const accepted: StreetAddress[] = [];
  const usedNames = new Set<string>();

  // Sorted for a stable walk order regardless of how the map authored its lanes.
  //
  // The gate is `STREET_PROFILES`, never the name table: names exist for whole
  // cities that generate no addresses at all, and gating on those would opt
  // every one of them in at once.
  const lanes = [...input.lanes]
    .filter((lane) => ADDRESSABLE_ROLES.has(lane.role ?? ""))
    .filter((lane) => STREET_PROFILES[lane.roadId ?? ""])
    .filter((lane) => input.roadNames?.[lane.roadId ?? ""])
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const lane of lanes) {
    const profile = STREET_PROFILES[lane.roadId ?? ""];
    const streetName = input.roadNames?.[lane.roadId ?? ""] ?? "";
    const length = polylineLength(lane.centerline);
    const usable = length - JUNCTION_CLEARANCE_M * 2;
    if (usable <= 0) continue;

    // Spread the block's addresses evenly across its usable run and centre them
    // in their own share of it, rather than starting at the junction clearance
    // and striding off. Striding put every short lane's single address at
    // exactly JUNCTION_CLEARANCE_M — a rigid ring of drop-offs on the corners,
    // since NYC's cross-street lanes are shorter than one stride.
    const count = Math.max(1, Math.round(usable / spacing));
    const step = usable / count;
    for (let index = 0; index < count; index += 1) {
      const distance =
        JUNCTION_CLEARANCE_M +
        step * (index + 0.5) +
        (rng() - 0.5) * step * 0.5;
      const pose = resolveSimulationLaneAnchor([lane], {
        laneId: lane.id,
        distanceAlongM: distance,
      });
      if (!pose) continue;

      // The kerb is the lane's NEARSIDE — the driver's right where traffic
      // drives on the right, and their left where it drives on the left.
      //
      // Venue set-back is always the driver's right regardless (an authored
      // venue picks its kerb by choosing which direction's lane to anchor
      // on), but an address has no author to make that choice: the generator
      // walks every addressable lane and has to find the kerb *that lane*
      // actually runs beside. On a two-way British street the right-hand
      // normal points across the centreline into the opposing carriageway,
      // so every probe landed in live traffic and was rejected — London
      // generated no addresses at all on any two-way road.
      const nearside = lane.trafficSide === "left" ? -1 : 1;
      const normalX = Math.cos(pose.heading) * nearside;
      const normalZ = -Math.sin(pose.heading) * nearside;
      const kerb = {
        x: pose.x + normalX * KERB_OFFSET_M,
        z: pose.z + normalZ * KERB_OFFSET_M,
      };

      // A rider has to be able to stand here.
      if (
        input.roadSurfaces.some(
          (surface) =>
            distanceToPolylineM(kerb, surface.centerline) <
            surface.widthM / 2 + CARRIAGEWAY_CLEARANCE_M,
        )
      ) {
        continue;
      }

      // Frontage probe: does anything actually face this kerb?
      const block = FRONTAGE_PROBE_M.map((reach) => ({
        x: pose.x + normalX * reach,
        z: pose.z + normalZ * reach,
      })).reduce<AddressBlock | null>(
        (found, probe) =>
          found ?? input.blocks.find((candidate) => isInsideRect(probe, candidate)) ?? null,
        null,
      );
      if (!block) continue;

      // Parks and museum grounds have frontage but nobody lives there.
      if (input.landmarks.some((landmark) => isInsideRect(kerb, landmark))) continue;

      // Which kerb of the street this is: -1 and +1 are the two sides.
      const side =
        profile.axis === "z"
          ? Math.sign(kerb.x - pose.x)
          : Math.sign(kerb.z - pose.z);
      const crowded = accepted.some((existing) => {
        const gap = Math.hypot(existing.x - pose.x, existing.z - pose.z);
        if (gap < MIN_OPPOSITE_KERB_M) return true;
        return (
          existing.roadId === lane.roadId &&
          existing.side === side &&
          gap < MIN_SEPARATION_M
        );
      });
      if (crowded) continue;
      if (
        (input.occupiedPoints ?? []).some(
          (occupied) => Math.hypot(occupied.x - pose.x, occupied.z - pose.z) < POI_CLEARANCE_M,
        )
      ) {
        continue;
      }

      const kinds =
        KINDS_BY_BUILDING_SET[block.buildingSet ?? ""] ??
        KINDS_BY_BLOCK_MATERIAL[block.material ?? ""] ??
        ["residence"];
      // Two kerbs a block apart can round to the same number. Step along the
      // street's own parity until one is free rather than dropping the address,
      // so every name the HUD prints identifies exactly one place.
      let number = houseNumber(profile, pose, kerb);
      while (usedNames.has(`${number} ${streetName}`)) number += 2;
      const name = `${number} ${streetName}`;
      usedNames.add(name);

      accepted.push({
        id: `addr-${lane.roadId}-${number}`,
        name,
        kind: kinds[Math.floor(rng() * kinds.length)] ?? "residence",
        roadId: lane.roadId ?? "",
        side: side === 0 ? 1 : side < 0 ? -1 : 1,
        laneId: lane.id,
        distanceAlongM: distance,
        x: pose.x,
        z: pose.z,
        kerbX: kerb.x,
        kerbZ: kerb.z,
        // Look back across the carriageway, matching the renderer's rider spot.
        facing: Math.atan2(-normalX, -normalZ),
      });
    }
  }

  return accepted;
}
