// Type-only: career.ts imports back from this module at runtime, but a
// type-level cycle is erased at compile time.
import type { CareerPersisted, CareerVehicleId } from "./career";
import type { ParkStyle } from "./parkLayouts";

export type TrafficSide = "left" | "right";
export type SteeringSide = TrafficSide;
export type SpeedUnit = "mph" | "kmh";
export type CameraMode = "first_person" | "third_person";
export type Gear = "drive" | "reverse";

export type CountryId = "us" | "uk" | "jp" | "eg";

export type DestinationId =
  | "us-nyc"
  | "uk-london"
  | "jp-tokyo"
  | "eg-cairo";

export type MapId =
  | "nyc-upper-west-side"
  | "london-south-kensington"
  | "tokyo-setagaya"
  | "cairo-central-nile";

export type FreeDriveId =
  | "free-us"
  | "free-uk-london"
  | "free-jp"
  | "free-eg";

export type RuleCode =
  | "collision"
  | "wrong_way"
  | "red_light"
  | "out_of_bounds"
  | "speeding"
  | "incomplete_stop"
  | "missing_indicator"
  | "unsafe_gap"
  | "following_distance"
  | "lane_misuse"
  | "box_junction"
  | "restricted_lane"
  | "one_way"
  | "roundabout_yield"
  | "merge"
  | "pedestrian_priority"
  | "cyclist_clearance"
  | "railway_crossing"
  | "observation";

export interface WorldPoint {
  readonly x: number;
  readonly z: number;
}

export interface WorldPose {
  readonly position: WorldPoint;
  readonly headingDeg: number;
}

export interface GeographicBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface OfficialRuleReference {
  readonly id: string;
  readonly title: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly url: string;
  readonly reviewedOn: string;
  readonly appliesTo: readonly RuleCode[];
}

export interface LanePolicy {
  readonly keepSide: TrafficSide;
  readonly passingSide: TrafficSide;
  readonly normalTravelLaneSide: TrafficSide;
  readonly turnOnRed: "permitted_after_stop_unless_signed" | "prohibited";
}

export interface RoundaboutPolicy {
  readonly circulation: "clockwise" | "counterclockwise";
  readonly yieldToTrafficFrom: TrafficSide;
  readonly entrySide: TrafficSide;
}

export interface CountryVisualTheme {
  readonly sky: string;
  readonly ground: string;
  readonly road: string;
  readonly laneMarking: string;
  readonly accent: string;
  readonly architecture: string;
  readonly roadsideDetails: readonly string[];
}

export interface CurrencyProfile {
  /** ISO 4217 code, e.g. "GBP". */
  readonly code: string;
  readonly symbol: string;
  /** Fraction digits for display/rounding — 2 for GBP/USD/EUR, 0 for JPY. */
  readonly minorUnits: number;
}

export interface CountryProfile {
  readonly id: CountryId;
  readonly countryCode: string;
  readonly countryName: string;
  readonly flagEmoji: string;
  readonly trafficSide: TrafficSide;
  readonly defaultSteeringSide: SteeringSide;
  readonly speedUnit: SpeedUnit;
  readonly currency: CurrencyProfile;
  /**
   * Colour this country paints between *opposing* streams of traffic. North
   * America uses yellow and reserves white for lanes running the same way, so
   * a white centre line there reads as "this street is one-way"; Europe and
   * Japan paint both in white. Lane dividers are white everywhere.
   */
  readonly centreLineColor: "white" | "yellow";
  readonly lanePolicy: LanePolicy;
  readonly roundaboutPolicy: RoundaboutPolicy;
  readonly priorityPolicy: string;
  readonly officialReferences: readonly OfficialRuleReference[];
  readonly reviewedOn: string;
}

export type DestinationPromotion = "featured" | "standard" | "specialist";

export interface DestinationProfile {
  readonly id: DestinationId;
  readonly countryId: CountryId;
  readonly destinationName: string;
  readonly destinationSubtitle: string;
  readonly mapId: MapId;
  readonly freeDriveId: FreeDriveId;
  readonly promotion: DestinationPromotion;
  readonly cityMark: string;
  readonly visualTheme: CountryVisualTheme;
}

export type LaneRole =
  | "travel"
  | "passing"
  | "entry"
  | "exit"
  | "connector"
  | "roundabout"
  | "one_way"
  | "rail_crossing"
  | "terminal";

export interface LaneNode {
  readonly id: string;
  readonly position: WorldPoint;
}

/** A stable location measured along a directed legal lane. */
export interface LaneAnchor {
  readonly laneId: string;
  readonly distanceAlongM: number;
}

/**
 * A short junction transition inside an otherwise established running lane.
 * Spawn and routing validation treat this range as connector geometry rather
 * than as a legal settled-lane position.
 */
export interface LaneConnectorRange {
  readonly startDistanceAlongM: number;
  readonly endDistanceAlongM: number;
  readonly conflictZoneId?: string;
}

export type RoadSurfaceType =
  | "standard"
  | "roundabout"
  | "shared_space"
  | "terminal";

export type RoadMarkingStyle =
  | "centre_dashed"
  | "centre_solid"
  | "lane_dashed"
  | "lane_solid"
  | "edge_solid"
  | "give_way"
  | "box_junction";

/** A physical road marking independent from the carriageway centreline. */
export interface RoadMarkingPath {
  readonly id: string;
  readonly style: RoadMarkingStyle;
  readonly points: readonly WorldPoint[];
  readonly color?: "white" | "yellow";
}

/** Visual carriageway geometry kept separate from legal lane centrelines. */
export interface RoadSurface {
  readonly id: string;
  readonly centerline: readonly WorldPoint[];
  readonly widthM: number;
  /**
   * Width of the walkable band beside this surface. Paved maps fall back to
   * `PAVED_SIDEWALK_WIDTH_M` when absent, preserving every existing city.
   */
  readonly sidewalkWidthM?: number;
  readonly laneIds: readonly string[];
  readonly surfaceType: RoadSurfaceType;
  readonly markings: readonly RoadMarkingPath[];
}

/** A non-drivable polygonal water surface rendered beneath authored bridges. */
export interface WaterBody {
  readonly id: string;
  readonly polygon: readonly WorldPoint[];
  readonly color: string;
  /** Cosmetic current direction for deterministic ripples and boat headings. */
  readonly flowHeadingDeg?: number;
  /**
   * Road surfaces explicitly permitted to cut openings through this body's
   * otherwise-solid shoreline. The simulation also derives parapet colliders
   * along the over-water span of each listed surface. An absent/empty list
   * means the shoreline has no vehicle portal.
   */
  readonly bridgePortalSurfaceIds?: readonly string[];
}

export interface LaneSegment {
  readonly id: string;
  readonly roadId: string;
  readonly widthM: number;
  readonly from: string;
  readonly to: string;
  readonly centerline: readonly WorldPoint[];
  readonly role: LaneRole;
  readonly trafficSide: TrafficSide;
  readonly speedLimit: number;
  /** Unit used by this lane's authored speed limit when it differs from the launch profile. */
  readonly localSpeedUnit?: SpeedUnit;
  readonly successors: readonly string[];
  readonly adjacentLaneIds?: readonly string[];
  readonly connectorRanges?: readonly LaneConnectorRange[];
}

export type TrafficControlType =
  | "stop"
  | "yield"
  | "signal"
  | "crosswalk"
  | "railway_signal"
  | "box_junction"
  | "restricted_lane";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ScenarioClock {
  readonly weekday: Weekday;
  readonly minutesAfterMidnight: number;
  readonly label: string;
}

export interface RestrictionWindow {
  readonly weekdays: readonly Weekday[];
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface LaneRestriction {
  readonly id: string;
  readonly laneId: string;
  readonly ruleCode: "restricted_lane";
  readonly activeWindows: readonly RestrictionWindow[];
  readonly sourceReferenceId: string;
}

export interface TrafficControl {
  readonly id: string;
  readonly type: TrafficControlType;
  readonly position: WorldPoint;
  readonly headingDeg: number;
  readonly laneIds: readonly string[];
  readonly conflictZoneIds?: readonly string[];
  readonly approaches: readonly TrafficControlApproach[];
  readonly installations: readonly TrafficControlInstallation[];
}

export interface TrafficControlApproach {
  readonly id: string;
  readonly laneIds: readonly string[];
  readonly stopLine: LaneAnchor;
  readonly conflictZoneIds?: readonly string[];
  readonly phaseGroup: string;
}

export type TrafficControlMounting =
  | "roadside_pole"
  | "mast_arm"
  | "secondary_pole"
  | "railway_crossing"
  | "road_marking";

export type TrafficControlVisualStyle =
  | "nyc_signal"
  | "uk_signal"
  | "egypt_signal"
  | "stop_sign"
  | "yield_sign"
  | "restricted_lane"
  | "crosswalk"
  | "box_junction"
  | "japan_railway";

export interface TrafficControlInstallation {
  readonly id: string;
  readonly position: WorldPoint;
  /** Direction of travel for the approach this head faces. */
  readonly headingDeg: number;
  /** Authored transverse span for road markings such as zebra crossings. */
  readonly spanM?: number;
  /** Direction from a curbside support toward an over-road mast head. */
  readonly armHeadingDeg?: number;
  readonly mounting: TrafficControlMounting;
  readonly style: TrafficControlVisualStyle;
  readonly role: "primary" | "secondary" | "companion" | "warning" | "marking";
  /** Signal approaches whose phase this physical head displays. */
  readonly approachIds?: readonly string[];
}

export interface ConflictZone {
  readonly id: string;
  readonly laneIds: readonly string[];
  readonly polygon: readonly WorldPoint[];
}

export interface AnchoredMapSpawnPoint {
  readonly id: string;
  readonly kind: "player" | "vehicle";
  readonly anchor: LaneAnchor;
}

export interface FreeMapSpawnPoint {
  readonly id: string;
  readonly kind: "pedestrian" | "cyclist";
  readonly pose: WorldPose;
  readonly laneId?: string;
}

export type MapSpawnPoint = AnchoredMapSpawnPoint | FreeMapSpawnPoint;

export interface LaneGraph {
  readonly nodes: readonly LaneNode[];
  readonly lanes: readonly LaneSegment[];
  readonly controls: readonly TrafficControl[];
  readonly conflictZones: readonly ConflictZone[];
  readonly spawnPoints: readonly MapSpawnPoint[];
  readonly restrictions?: readonly LaneRestriction[];
}

export interface FrozenMapSource {
  readonly boundingBox: GeographicBounds;
  readonly additionalBoundingBoxes?: readonly GeographicBounds[];
  readonly capturedOn: string;
  readonly sourceUrl: string;
  readonly checksum: string;
  readonly importerVersion: string;
  readonly attribution: string;
  readonly licenseName: string;
  readonly licenseUrl: string;
}

/** A block-local edge, named by the axis its outward normal points along. */
export type BlockStreetEdge = "+x" | "-x" | "+z" | "-z";

export interface ProceduralBlock {
  readonly id: string;
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  /** Clockwise yaw for diagonal/radial city blocks; defaults to zero. */
  readonly headingDeg?: number;
  /**
   * Which block-local edges carry a street wall. Absent means all four, which
   * is right for a city block with roads around it.
   *
   * A roadside strip has a road on **one** side, and naming that side is what
   * stops the opposite row facing open ground — and, on a parcel shallower than
   * two building depths, stops the two rows occupying the same space and
   * z-fighting. Only the instanced glb wall reads this; the procedural facade
   * grid has its own `frontageAxis`.
   */
  readonly streetEdges?: readonly BlockStreetEdge[];
  /**
   * Optional local edge that receives the block's façades. Roadside strips use
   * `z` because their local x-axis follows the carriageway; ordinary parcels
   * keep the nearest-edge heuristic when this is absent.
   */
  readonly frontageAxis?: "x" | "z";
  readonly heightRange: readonly [number, number];
  readonly density: number;
  readonly material: string;
  /**
   * Optional building-set id (see buildingSets.ts). When set, the block is
   * dressed with a street wall of instanced glb buildings from that set instead
   * of the procedural windowed facade boxes; unknown/absent falls back to boxes.
   * The mechanism for clustering towers vs brownstones vs houses per neighborhood.
   */
  readonly buildingSet?: string;
  /**
   * Whether `streetAddressesForMap` may probe this block for gig-pool
   * frontage. Defaults to true for backward compatibility — every existing
   * block already relies on being addressable. A gap-closure scenery block
   * (a corner cap, a backdrop strip authored only to stop a camera seeing
   * through to grey) should set this false unless it deliberately designs a
   * reachable kerb destination: `generateStreetAddresses` probes every
   * block's frontage blind to *why* the block exists, so an unrelated
   * closure can silently create or reorder a job (plan
   * `.claude/three-city-visual-gap-elimination-plan.md` Section 9.1).
   */
  readonly addressable?: boolean;
}

export interface ProceduralLandmark {
  readonly id: string;
  readonly kind:
    | "park"
    | "station"
    | "terminal"
    | "railway"
    | "tower"
    | "shops"
    | "museum"
    | "monument"
    | "cultural"
    | "bridge";
  readonly center: WorldPoint;
  readonly size: WorldPoint;
  /** Clockwise yaw for long diagonal landmarks such as elevated bridges. */
  readonly headingDeg?: number;
  /**
   * Ignored on `kind: "park"`, where every park shares one per-map grass
   * material. Still colours every other landmark kind.
   */
  readonly color: string;
  /**
   * Which dressing recipe a park takes (`parkLayouts.ts`). Absent means derived
   * from the id, the map and the park's proportions, which is what lets a new
   * city's park get a sensible layout with no content edit — set it only to
   * overrule that.
   */
  readonly parkStyle?: ParkStyle;
  /**
   * Opt in to a boundary wall that follows the roads it runs alongside rather
   * than being deleted by them — see `parkPerimeterPlan`. A park tucked to its
   * pavements needs this; one held well back does not, and the blanket veto is
   * the safer default.
   */
  readonly wallsFollowRoadEdges?: boolean;
}

/**
 * What a service point sells. Also the key its building is looked up by —
 * `PROP_MODEL_REGISTRY` for the imported gas station, `repairShopLayout.ts` for
 * the authored shop.
 *
 * Most machinery that walks `servicePoints` wants both kinds (the block carve
 * that keeps the lot drivable, the prop-scatter and street-address keep-outs).
 * The handful that is gas-specific must say so through `gasStationsOf` /
 * `repairShopsOf` in `servicePoints.ts` — an inline `kind === "gas_station"` is
 * how the next kind gets missed.
 */
export type ServicePointKind = "gas_station" | "repair_shop";

/** An interactive roadside service the player can pull up to (gas, repairs). */
export interface ServicePoint {
  readonly id: string;
  readonly kind: ServicePointKind;
  /** Curbside pose on the drivable lane graph the car pulls up to. */
  readonly anchor: LaneAnchor;
  /** Footprint (metres) for the rendered building/pumps. */
  readonly footprint: WorldPoint;
  readonly label: string;
  /** Metres the model is set back perpendicular from the anchored lane, so its
   * lot starts just past the shoulder instead of bleeding onto the carriageway.
   * Tuned per site because the gas-station model carries a large base slab and
   * some sites sit at cramped junction corners. Defaults to 16. */
  readonly setbackM?: number;
}

export type GigVenueKind =
  | "residence"
  | "restaurant"
  | "shop"
  | "office"
  | "depot";

/** A named place gig pickups and drop-offs happen at, on the lane graph. */
export interface GigVenue {
  readonly id: string;
  readonly kind: GigVenueKind;
  readonly anchor: LaneAnchor;
  readonly footprint: WorldPoint;
  readonly name: string;
  /** Metres the building is set back perpendicular from the anchored lane.
   * Tune it up to pull a venue off a neighbouring lot it would otherwise
   * intersect. Defaults to 13. */
  readonly setbackM?: number;
  /**
   * Prop-registry key for this venue's building, overriding `kind`. Lets two
   * restaurants on the same map be visibly different places rather than the
   * same glb twice, without inventing venue kinds that mean nothing to gigs.
   */
  readonly modelId?: string;
}

/** Timetable for one rail line; mirrored structurally into the simulation's
 * `SimulationRailSchedule` by the adapter. Times are simulation seconds. */
export interface RailLineSchedule {
  readonly mode: "shuttle" | "through";
  readonly speedMps: number;
  readonly trainLengthM: number;
  /** `through` only: seconds between same-direction departures. */
  readonly headwaySeconds?: number;
  /** `shuttle` only: seconds held at each terminus. */
  readonly dwellSeconds?: number;
  readonly offsetSeconds?: number;
  readonly warningLeadSeconds: number;
  readonly clearTrailSeconds: number;
}

/** A stretch of the line, by distance along it, carried on a structure
 * instead of ballast at grade: a water bridge or a viaduct over streets. */
export interface RailElevatedSpan {
  readonly startM: number;
  readonly endM: number;
  readonly kind: "bridge" | "viaduct";
}

/**
 * What runs on the line. The train is built procedurally from primitives
 * (`render/trainRender.ts`) — the repo's own convention for bespoke shapes —
 * so a consist is a recipe, not an asset: car kind, count and livery.
 * `tests/railCorridors.test.ts` checks the recipe's implied length against
 * the schedule's `trainLengthM`, which is what the crossings actually time.
 */
export interface RailConsist {
  readonly kind: "tram" | "emu" | "diesel_freight";
  readonly cars: number;
  /** Body colour, hex. */
  readonly liveryHex: string;
  /** Trim band / secondary colour, hex. */
  readonly accentHex?: string;
}

/**
 * One railway per map, at most. The polyline is the track centreline in
 * world metres; everything else in the game derives from it:
 *  - the simulation projects each listed `railway_signal` control onto the
 *    line and drives that crossing's lamps/barriers/citations from the
 *    timetable (`simulationAdapter.buildRailLines`);
 *  - the renderer lays ballast/rails/sleepers along it and moves the train
 *    on it;
 *  - the corridor (`corridorHalfWidthM` each side) is a build keep-out that
 *    parcel generators and the content audit enforce — the guarantee that
 *    tracks never run through a building.
 */
export interface RailLine {
  readonly id: string;
  readonly points: readonly WorldPoint[];
  /** Reserved right-of-way half-width, track plus structure clearance. */
  readonly corridorHalfWidthM: number;
  /** `railway_signal` controls that are this line's level crossings. */
  readonly crossingControlIds: readonly string[];
  readonly schedule: RailLineSchedule;
  readonly elevatedSpans?: readonly RailElevatedSpan[];
  /**
   * Constant deck height for a line carried on structure end-to-end
   * (London's viaduct). Roads pass UNDER such a line — the corridor audit
   * exempts elevated-span road crossings from needing a level crossing —
   * and the train is unhittable, so no crossings and no contact checks.
   * The line must be fully covered by `elevatedSpans` when this is set;
   * ramps between ground and deck are deliberately unsupported.
   */
  readonly elevationM?: number;
  /** Where the terminus stands, for a shuttle whose dwell end is a real
   * terminus rather than an off-map exit. `platforms` (the default) is a
   * pair of open passenger platforms + buffer stop; `depot_shed` is an
   * enclosed shed straddling the track so the dwelling consist waits out of
   * sight (Tokyo's Gotokuji stub — its platforms used to run straight
   * across the Yamashita St crossing). A shed terminus requires the covered
   * interval to be straight and at grade; its walls become solid
   * `railShed` obstacles derived in the adapter, never authored by hand. */
  readonly terminus?: {
    readonly at: "start" | "end";
    readonly style?: "platforms" | "depot_shed";
  };
  readonly consist: RailConsist;
}

export interface ProceduralMapGeometry {
  readonly worldSize: WorldPoint;
  readonly roadWidth: number;
  readonly shoulderWidth: number;
  readonly roadSurfaces: readonly RoadSurface[];
  readonly waterBodies?: readonly WaterBody[];
  readonly blocks: readonly ProceduralBlock[];
  readonly landmarks: readonly ProceduralLandmark[];
  readonly railLines?: readonly RailLine[];
  readonly servicePoints?: readonly ServicePoint[];
  readonly gigVenues?: readonly GigVenue[];
}

/**
 * How many ambient cars a map carries when its size makes the scenario's
 * density band the wrong answer.
 *
 * Density is authored per drive ("moderate"), not per city, so every map got
 * the same twelve cars whatever its size. That is a very different street on a
 * 600 m grid and on a 3 km one — the same cars spread over five times the road
 * leave it empty, and patrols with them, since a patrol is one car in five.
 */
export interface AmbientTrafficConfig {
  /** Cars on a desktop-class machine. The simulation core clamps at 32. */
  readonly desktop: number;
  /** Cars on a phone, where each one costs a good deal more. */
  readonly touch: number;
}

export interface MapPack {
  readonly id: MapId;
  readonly name: string;
  readonly areaLabel: string;
  readonly countryIds: readonly CountryId[];
  readonly source: FrozenMapSource;
  readonly geometry: ProceduralMapGeometry;
  readonly laneGraph: LaneGraph;
  readonly ambientTraffic?: AmbientTrafficConfig;
  /**
   * Display names for this city's streets, keyed by `RoadSurface.id` (which is
   * the same key space as `LaneSegment.roadId`).
   *
   * Optional, and deliberately partial: navigation falls back to naming no street
   * at all rather than blocking on a city nobody has named yet. Names live on
   * the pack rather than in one global table because they are authored content
   * like the geometry beside them — a central table would have to be kept in
   * step with every content file by hand.
   */
  readonly roadNames?: Readonly<Record<string, string>>;
}

/** What a solid obstacle is, for collision-event evidence and messaging. */
export type StaticObstacleTag =
  | "building"
  | "landmark"
  | "venue"
  | "shoreline"
  | "parkEdge"
  | "railBridge"
  | "railShed"
  | "worldEdge";

/**
 * Solid, movement-blocking world geometry the simulation resolves the player
 * car against — plain data with no renderer coupling. Built once per session
 * by the adapter from authored map-pack fields (blocks, building-like
 * landmarks, gig-venue lots, world edges). OBB axes are given explicitly as
 * the unit U (half-width) direction; V is its perpendicular (uz, -ux).
 */
export type StaticObstacle =
  | {
      readonly kind: "aabb";
      readonly id: string;
      readonly tag: StaticObstacleTag;
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    }
  | {
      readonly kind: "obb";
      readonly id: string;
      readonly tag: StaticObstacleTag;
      readonly x: number;
      readonly z: number;
      readonly ux: number;
      readonly uz: number;
      readonly halfU: number;
      readonly halfV: number;
    }
  | {
      readonly kind: "circle";
      readonly id: string;
      readonly tag: StaticObstacleTag;
      readonly x: number;
      readonly z: number;
      readonly radius: number;
    }
  | {
      readonly kind: "convex";
      readonly id: string;
      readonly tag: StaticObstacleTag;
      /** A closed convex polygon, wound consistently (clockwise, matching
       * this codebase's clockwise-yaw convention) at construction time —
       * normalized once by whatever built it, never re-checked per query. */
      readonly points: readonly WorldPoint[];
    };

export interface FreeDriveDefinition {
  readonly id: FreeDriveId;
  readonly countryId: CountryId;
  readonly destinationId: DestinationId;
  readonly mapId: MapId;
  readonly startSpawnId: string;
  readonly trafficSeed: number;
  readonly scenarioClock?: ScenarioClock;
}

export interface RuleEvent {
  readonly code: RuleCode;
  readonly correction: string;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

export interface AccessibilityPreferences {
  readonly visualHonkIndicator: boolean;
  readonly reducedMotion: boolean;
  readonly cameraShake: boolean;
  readonly headBob: boolean;
  readonly steeringSensitivity: number;
  readonly fieldOfView: number;
  readonly masterVolume: number;
  readonly effectsVolume: number;
  readonly musicVolume: number;
  /** Silences the music bed only; effects and engine keep their levels. */
  readonly musicMuted: boolean;
}

export interface PlayerProgressV2 {
  readonly version: 2;
  /** Money on hand per country, in that country's own currency units. */
  readonly walletByCountry: Readonly<Record<CountryId, number>>;
  /** Litres of fuel in the car, tracked per country. */
  readonly fuelByCountry: Readonly<Record<CountryId, number>>;
  readonly lastDestinationId: DestinationId;
  readonly preferredCamera: CameraMode;
  readonly accessibility: AccessibilityPreferences;
  /**
   * Career Mode's whole persisted state (null until a career starts, or the
   * corrupt marker when the stored slice fails its checksum). Career money is
   * fully separate from the free-drive wallets above; only the
   * writeCareer/clearCareer reducers may replace this field.
   */
  readonly career: CareerPersisted;
  /**
   * The garage's selection, remembered across reloads — a preference, not
   * career state, which is why it sits out here rather than inside the
   * checksummed slice. It holds whatever the garage last *showed*, including a
   * selection `garageDefaultVehicle` walked down, so reopening the game always
   * restores the ride the driver was actually looking at.
   */
  readonly lastCareerVehicleId: CareerVehicleId;
}
