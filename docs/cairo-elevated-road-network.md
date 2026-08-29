# Cairo elevated-road network

## Research translated into the map

The implemented network is an authored interpretation of central Cairo rather
than a claim of metre-perfect geography. Its structural language follows these
real references:

- The Arab Contractors' project record describes the 6th October Bridge as
  18.705 km long, 14–34 m wide, with 23 entrance/exit ramps, 9–22 m piers and
  construction methods chosen to keep traffic below moving. That supports a
  long urban viaduct with repeated hammerhead columns and multiple access
  points, not a short river prop. Source:
  <https://www.arabcont.com/English/project-119>
- The World Bank's Greater Cairo congestion study describes the roughly 22 km
  corridor flying over the CBD and identifies merges as real bottlenecks. That
  informed the continuous cross-city mainline and explicit merge nodes.
  Source:
  <https://documents1.worldbank.org/curated/en/650141468248419267/pdf/718450ESW0Whit0ing0Annexes00PUBLIC0.pdf>
- JICA's Greater Cairo transport study diagrams a parallel viaduct along 26th
  July Street, direct loop ramps, and stacked connections over existing ramps.
  That is the precedent for keeping Cairo's street frontage while putting
  access ramps above Corniche, Ramses and Dokki corridors. Source:
  <https://openjicareport.jica.go.jp/pdf/11928470_02.pdf>
- The Wikimedia Commons 6 October Bridge archive was used as a visual cross
  check for dusty concrete, dense urban surroundings, the bridge's
  relationship to the Nile and the older spans whose dark maintenance rail
  sits above a solid concrete crash base. Source:
  <https://commons.wikimedia.org/wiki/Category:6_October_Bridge>
- The Arab Contractors' 26th of July Axis gallery shows the same family on
  ramps and urban viaducts: a continuous concrete crash sill/toe with a
  close-spaced green metal railing above it. The rail is never left floating
  as an open substitute for the solid road edge. Source:
  <https://www.arabcont.com/English/project-88>

Those references produce a Cairo-specific treatment rather than one generic
box. All Cairo elevated roads use a warm, weathered, tapered concrete shell
with a wide traffic-side toe and a pale coping. A close-spaced, dull
green-black three-rail maintenance fence continues above that solid base on
the main span and ramps, matching the 6th October/26th July silhouette. The
edge runs stop before every merge mouth, so the stronger silhouette never
becomes a transverse visual or physical wall. Small amber studs face traffic
instead of being mounted invisibly on the outer face.

The user's Cairo aerial and New York elevated-rail photographs supplied the
composition target: elevated infrastructure woven through occupied streets,
with buildings remaining alongside and ordinary roads continuing beneath.

## Authored network

`cairo-sixth-october-bridge` is now a legal four-lane, 60 km/h road held at a
10.5 m deck through the main corridor. Six access sites connect it to the
directed lane graph, providing twelve movements in total:

| Access site | Host street | Elevated connection |
|---|---|---|
| West terminal | Charles De Gaulle Street (`cairo-west-nile-street`) | Separate one-way grades meet the west high terminal carrier at a 7 m braid. |
| Dokki | Al Dokki Street (`cairo-dokki-nile-drive`) | Separate one-way grades meet a high two-way stem. |
| Gezira | Al Saraya Street (`cairo-saray-el-gezira`) | Separate one-way grades meet a high two-way stem. |
| Corniche | Corniche El-Nil (`cairo-corniche-el-nil`) | Independent one-way entry and exit structures connect directly to the mainline. |
| Ramses | Ramsis Street (`cairo-ramses`) | Separate one-way grades meet a high two-way stem. |
| East terminal | Al-Galaa Street (`cairo-galaa-street`) | Separate one-way grades meet the east high terminal carrier at a 7 m braid. |

The terminal carriers are distinct two-way elevated roads between the 10.5 m
mainline crest and their 7 m directional braids. Each remains level through a
short collinear throat beyond the four-lane footprint before descending, so
the lane fan/funnel and its parapets cannot form a mismatched slab seam inside
the join. Below each braid, entry and
exit remain separate one-way grades and at-grade slips. On entry, the single
carrier lane fans into both same-direction mainline lanes; on exit, both
mainline lanes funnel into the single carrier lane. At the four intermediate
mainline connections, entries and exits use only the outer/curb-side travel
lane. The terminal fan/funnel is the deliberate exception. The former direct
centreline T-junctions are retired; terminal connections now obey the same
street-preserving access grammar as the four intermediate sites.

Every street connection is a local widening, not a replacement carriageway.
The original two-way street continues through two inserted topology nodes.
For the legal direction of travel, each 4.2 m auxiliary lane begins or ends on
the driver's right; opposite host directions therefore use opposite physical
kerbs. The entry may not cross the opposing host lane after leaving its mouth,
and an exit returns only to its direction-qualified host lane.

Each at-grade slip stays at zero elevation through the merge and widening.
The profiled ramp begins only after the host through lane is visibly and
physically continuous and the auxiliary lane has separated. Where the ramp
must turn through dense frontage, ascent and the turn are delayed until a full
vehicle envelope has cleared the live street and the coordinated frontage
setback. Where preserved frontage leaves only one vertical reservation, the
two ground slips braid into one two-way deck after leaving the street rather
than forcing two decks through buildings.

Several approaches are especially important regression examples:

- The Dokki access preserves Al Dokki Street as a complete two-way
  road. Its entrance climbs in a 4.2 m Nile-side auxiliary lane south of the
  merge; its exit descends in the same widened corridor farther north. The low
  grades never sit beside or on top of one another. Entry, shared stem and exit
  meet only at a 7 m-high directional braid, so the old low 7.6 m two-way slab
  cannot cover the continuing street. The complete waterfront and dense
  frontage rows remain. A coordinated setback creates the kerb-side lane
  without deleting individual buildings or routing the grade through façades.
  The one promenade palm whose measured crown reached the new grade is
  relocated along the same bank rather than filtered out.
- The Ramses access does not drop a two-way ramp onto the road
  centreline. Separate 4.2 m entry and exit grades follow opposite kerbs and
  remain distinct until they reach 7 m over the Turgoman clearance point. The
  existing Ramses lanes stay continuous underneath and the two grades braid
  only after they have cleared ground traffic and pedestrians.
- The Corniche entry leaves a ground-level auxiliary lane on the northbound
  driver's right, climbs straight beside that kerb, and begins its broad
  right-hand turn only after reaching full vehicle clearance. Its final span
  joins the eastbound mainline on the bridge tangent; the ramp mouth and low
  slab never cross or narrow either Corniche through lane. Two adjacent
  frontage bays step back by 3.2 m and 7 m, with their rear walls fixed,
  to make the auxiliary corridor read as an intentional street widening.
- The Corniche exit diverges at deck height, uses the open river corridor to
  descend, and does not turn back beneath the parent mainline until its soffit
  has a complete vehicle envelope. It then stays above 6 m while crossing the
  Corniche carriageway, reaches ground south of Champollion and continues as
  an at-grade auxiliary lane. Neither the mainline braid nor the continuing
  street is occupied by a low, impassable slab.
- The west and east terminal approaches keep their high carriers separate
  from both the four-lane mainline and the low one-way grades. This makes the
  two-to-one lane fan/funnel explicit at deck height while preserving Charles
  De Gaulle Street and Al-Galaa Street as ordinary two-way roads below.

The former bridge landmark and ramp-stub ids remain as non-rendered reservation
parcels. This preserves the exact deterministic building layout while the road
surface—not a landmark mesh—provides the drivable deck.

## Rendering and navigation contract

- Every lane and road-surface point carries the same elevation profile.
- Each Sixth October alignment is sampled once as a C1-continuous cubic path
  through its exact authored junction knots. Adaptive chords are no longer
  than 7.5 m and turn no more than 5 degrees; that one path feeds asphalt,
  lanes, paint, structure and both maps. The quality gate requires at least a
  14 m local radius, no more than 10.5% grade and no more than a 22-degree
  legal handoff.
- Asphalt strips and lane paint pitch with that shared curved profile.
- Player, NPC traffic, engine smoke, cockpit/chase cameras and mirrors use the
  occupied lane's interpolated height.
- Player projection carries the previous fixed step's height as layer
  ownership. Ground recovery considers all fully at-grade lanes but never an
  unrelated lane whose profile rises into bridge structure, even when the
  nearest ground centreline is more than 12 m away and a deck is directly
  overhead. A live player car can acquire a profiled ramp only through its
  current/adjacent lane or an immediate graph neighbour. For player level
  ownership that neighbourhood includes predecessors as well as successors,
  and its ramp heading is treated bidirectionally, so either an entrance or an
  exit can be climbed from its physical mouth. NPC routing, signs and wrong-way
  reporting continue to use the directed successor graph. Once a rising lane
  owns the car, a sub-lane heading/hysteresis band prevents an overlapping
  apron from stealing that ownership for one tick. The at-grade slips give
  every ramp a unique x/z approach before vertical separation begins.
- Any authored pose with a finite elevation is authoritative. In particular,
  `elevationM: 0` clears an old bridge projection before selecting the street
  below; zero is not treated as a missing value.
- Structural slabs and parapets are clipped below 0.65 m, leaving the complete
  merge taper open instead of erecting a concrete wall across its street end.
- Concrete slabs, edge girders, profiled parapets, coping, traffic-facing
  reflectors, tapered octagonal columns, caps and footings derive from the
  elevated road surfaces. Repeating marker and rail-post rhythms use
  accumulated surface distance, so they do not restart at every authored
  polyline segment.
- The solid parapet toe remains the gameplay boundary. Coping, marker plates
  and the maintenance rail are visual dressing attached to
  the same trimmed edge run; they never mint a second collider or span a merge
  opening.
- Physical parapet OBBs derive from those same trimmed edge runs. Slopes are
  divided into short local-height bands, so the visible wall contains a bridge
  car without becoming an invisible barrier for a ground car below it. Sharp
  internal bends trim the inside edge and extend the outside edge to their
  exact shared miter. Joined elevated mouths suppress terminal deck caps, keep
  the complete slab beneath every paved chord and overlap the next slab by
  0.175 m; parapet and fascia runs alone open around the legal mouth.
- Player roof collision uses the combined raised-asphalt/structural-clearance
  query at the centre and both ends of the real vehicle capsule. Low ramp
  aprons and soffits stop a lower-level car at their physical boundary; high
  spans remain open. Before the query chooses its lowest obstruction it removes
  the exact carrier surface plus the one-hop connected surface beneath each
  capsule edge in the direction that end of the car points; the centre sample
  retains both sides of the seam. Comparing player heading with stored lane
  heading swaps predecessor and successor for wrong-way travel, while an
  endpoint-distance gate confines the exemption to the handoff. This lets the
  player cross an entrance or exit handoff in either direction without
  treating a few centimetres of connected asphalt as an invisible wall, without blanket-
  exempting both connected roads across the whole roof envelope. Road tops
  within the same 0.35 m capture band as the tyres are pavement seams, not
  ceilings. These
  filters run inside the query, so an ignored carrier cannot conceal a
  genuinely separate stacked deck above it. Rendered model or seated-rider
  height supplies the required clearance. Pier impacts stay with the existing
  static support colliders instead of being applied twice.
- Column candidates are omitted anywhere their complete footing plus a 0.10 m
  visual margin would occupy another road's carriageway, local sidewalk or a
  lower elevated deck. The check uses each street's authored sidewalk width,
  not a city-wide minimum.
- Elevated expressways author zero sidewalk width and do not generate a second
  set of pavement rails or roadside scatter. Existing ground pavements remain
  usable below high spans. At each landing, a combined clearance query covers
  the pitched asphalt from its first rise as well as the later slab, parapets
  and piers; this closes the former 0–0.65 m apron seam that let ground walkers
  protrude through the bridge before structural headroom existed.
- Cairo signal heads, parked vehicles, roadside furniture, promenade props and
  park planting all test the rendered slab's headroom over an appropriate
  footprint. Height is specific to the selected object: low furniture may stay
  under a usable span while a tall signal, tree or utility pole is rejected or
  relocated.
- Low shoreline and at-grade bridge-parapet colliders stop at 3.5 m: street
  vehicles still meet the bank, while cars on the 10.5 m main deck pass over it.
- Regulatory signs and hidden traffic portals inherit their lane height. A
  split road-id seam is treated as continuous only when it has exactly one
  arriving one-way arm, one departing one-way arm and an explicit successor
  link; that authoring-only seam emits no duplicate junction signs. Real
  entry/exit mouths remain signed, and a bounded same-road/successor station
  search keeps correctly oriented `ONE WAY`, `DO NOT ENTER` and `WRONG WAY`
  posts on short first or last segments instead of silently dropping them.
  Local traffic can therefore enter the flyover without materialising below
  the deck, and inactive-level portals are excluded from the player's nearby
  population.
- NPC state and render interpolation carry previous/current elevation. Player,
  NPC and NPC/NPC swept contacts include swept height, so stacked plan-view
  crossings neither collide nor reserve one another's space.
- Pedestrian/cyclist impacts, trains, crossing barriers, destructible props,
  patrol witnessing and traffic cameras reject cross-level contact before any
  impact sound, pause, damage, fine or fall effect. Ground-only fuel, repair and
  gig interactions are likewise unavailable from the bridge above.
- A destructible sign or other elevated prop retains its elevation through
  collision, fall animation, light-pool movement and impact particles.
- Traffic-stop road selection considers height, and its player car, patrol car
  and officer path each sample the chosen road profile. A pull-over on a ramp
  follows the slope instead of staging every participant on a flat ground Y.
  Under a flyover, the chosen camera azimuth and the complete scene are tested
  against the real soffit; the camera ducks below a usable span, while a mark
  beneath a low ramp or support is advanced along the same street.
- The minimap and full map show both levels. The current level is strong; the
  other remains transparent but visible. The switch occurs at 3.5 m.
- Projection prefers the current layer at stacked x/z crossings. If a ground
  car is temporarily outside every compatible road envelope, it remains
  ground and becomes off-road instead of adopting the closest bridge height.
  The elevated-only 12 m recovery cutoff cannot lift a car below a wide deck.

## Preservation checks

The Cairo block census remains the exact original 1,505 ids. Host-street merge
nodes are topological only, so they do not re-segment the visible street or its
procedural frontage. A regression test compares every elevated deck segment's
oriented footprint with every block OBB and requires zero intersections. The
lane-corridor and full pavement-band audits also include every new slip. No
building or landmark asset was deleted. Only the exact frontage pieces that
intersect a reviewed auxiliary-lane envelope receive small explicit setbacks
or shallower footprints; unaffected neighbours remain fixed, and every
building id, height and material remains stable.
At Dokki, a 0.75 m façade guard is tested against every entry, stem and exit
segment so that the setback cannot regress into clipping or become a pretext
for deletion. The full-height exit now splays away from the still-rising
entrance before turning north, so the fix removes the physical slab overlap
rather than granting a broad collision exemption.
At Gezira, the opposing entry and exit curves are separated in plan before
their seven-metre braid. A 35-degree westward tangent keeps the complete entry
slab east of the descending exit, leaving over 0.68 m between the complete
decks below the high throat and at least 2.536 m above a lane-centred delivery
van on Al Saraya Street. The nearby Saray bays retain their complete street
frontages with at most a 1.43 m landward setback and a 0.15 m rear-depth trim.
The three high-carrier infill bays keep a measured 0.75 m-plus guard from the
full slab footprint.

The structural regression suite also checks signal headroom, model-specific
parked-car clearance, both west/east landing-apron pedestrian exclusion,
seeded crowd motion at those mouths, low-deck pedestrian exclusion and complete
coverage of each rendered parapet run by physical barrier chunks, without
barriers across trimmed merge openings. The topology regression pins all six
sites and twelve movements, and the structural-opening regression includes
both terminal-carrier joins as well as every intermediate mainline mouth.
Simulation regressions exercise
ground/elevated projection at the same x/z, swept cross-level traffic contacts,
same-level barrier response, enforcement filtering, elevation-aware
destructibles, 3D render-snap detection and exact Ramses/Corniche under-deck
plus slope-aware pull-over choreography. Ground-lock projection traces cover
the Qasr El Ainy underpass, the Dokki Nile Drive through route and the former
12 m capture-threshold edge beneath the west/main corridor. They must stay at
zero elevation and never capture the 6th October Bridge or a nearby ramp. A
directed entry fixture proves the legitimate Dokki on-ramp still acquires its
rising profile. Synthetic vehicle-envelope regressions separately prove that
a 1.38 m soffit and the pre-slab raised apron block a 1.5 m car, a high span
remains passable, and a connected ramp climb reaches the elevated level without
a false deck collision. Profile-derived production traces automatically
inventory and traverse every elevated 6th October mainline, carrier, entry,
stem and exit surface, including both terminals; a hand-maintained
intermediate-only list is not accepted. Reverse-direction traces cover all six
exit mouths uphill and all six entrances downhill; each follows its profile
monotonically while continuing to report wrong-way and emits no deck collision.
A dense
Corniche entry and exit sweeps use the delivery van's complete
rear/centre/front roof envelope. The entry check proves both through lanes are
untouched by its structure; the exit check verifies at least 2.26 m of usable
headroom where that ramp braids beneath the mainline.

Two production static-collider sweeps are mandatory and serve different
purposes. The all-map sweep samples every legal lane at no more than 2 m
intervals, interpolates the lane elevation and checks every production solid.
The Cairo bridge sweep samples every 6th October lane at no more than 0.5 m
intervals against the actual `roadBarrier` colliders. It uses the maximum
catalogue capsule radius and half-length, left/centre/right legal vehicle
positions and front/rear capsule discs. Together they prevent a clear
centreline from concealing a stale barrier, intrusive miter, transverse end cap
or non-barrier solid.

For the implementation order and required drive checklist before extending
this system to another city, see
[grade-separated-road-implementation-guide.md](grade-separated-road-implementation-guide.md).
