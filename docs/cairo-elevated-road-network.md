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
  check for dusty concrete, long low parapets, dense urban surroundings and
  the bridge's relationship to the Nile. Source:
  <https://commons.wikimedia.org/wiki/Category:6_October_Bridge>

The user's Cairo aerial and New York elevated-rail photographs supplied the
composition target: elevated infrastructure woven through occupied streets,
with buildings remaining alongside and ordinary roads continuing beneath.

## Authored network

`cairo-sixth-october-bridge` is now a legal four-lane, 60 km/h road. It rises
from the west-bank road network to a 10.5 m deck, crosses both Nile channels,
continues above the central city and descends into Al-Galaa Street. Four access
locations connect it to the rest of the directed lane graph:

- paired one-way Dokki entrance/exit slips feeding a two-way ramp;
- paired one-way Gezira entrance/exit slips feeding a two-way ramp;
- separate one-way Corniche entrance and exit ramps, each with its own slip;
- paired one-way Ramses entrance/exit slips feeding a two-way ramp.

Every street connection is a local widening, not a replacement carriageway.
The original two-way street continues through two inserted topology nodes. A
4.2 m auxiliary lane peels toward a lift point 40–70 m away, and only there
does it meet the elevated ramp. Direction-qualified turn grants admit the
entry from the correct host lane and return the exit to the correct travel
direction; the opposite side of the street cannot make an implausible turn
through the ramp. Where Cairo's preserved frontage leaves only one vertical
reservation, the two ground slips braid into one two-way deck after leaving
the street rather than forcing two decks through buildings.

Two approaches are especially important regression examples:

- The far-east Ramses access does not drop a two-way ramp onto the road
  centreline. Separate 4.2 m entry and exit grades follow opposite kerbs and
  remain distinct until they reach 7 m over the Turgoman clearance point. The
  existing Ramses lanes stay continuous underneath and the two grades braid
  only after they have cleared ground traffic and pedestrians.
- The Corniche exit diverges from the mainline before descending, curves away
  from the continuing street, reaches ground south of Champollion and then
  runs as an at-grade auxiliary lane to its merge. The street therefore does
  not appear to continue underneath a low slab that physically occupies its
  full width.

The former bridge landmark and ramp-stub ids remain as non-rendered reservation
parcels. This preserves the exact deterministic building layout while the road
surface—not a landmark mesh—provides the drivable deck.

## Rendering and navigation contract

- Every lane and road-surface point carries the same elevation profile.
- Asphalt strips and lane paint pitch with that profile.
- Player, NPC traffic, engine smoke, cockpit/chase cameras and mirrors use the
  occupied lane's interpolated height.
- Player projection carries the previous fixed step's height as layer
  ownership. Ground recovery considers all fully at-grade lanes but never an
  unrelated lane whose profile rises into bridge structure, even when the
  nearest ground centreline is more than 12 m away and a deck is directly
  overhead. A live ground car can acquire a profiled ramp only through its
  current/adjacent lane or a directed successor; predecessors are excluded so
  a nearby exit cannot be climbed backward. The at-grade slips give every
  legal entry a unique x/z approach before vertical separation begins.
- Any authored pose with a finite elevation is authoritative. In particular,
  `elevationM: 0` clears an old bridge projection before selecting the street
  below; zero is not treated as a missing value.
- Structural slabs and parapets are clipped below 0.65 m, leaving the complete
  merge taper open instead of erecting a concrete wall across its street end.
- Concrete slabs, edge girders, parapets, reflectors, tapered octagonal columns,
  caps and footings derive from the elevated road surfaces.
- Physical parapet OBBs derive from those same trimmed edge runs. Slopes are
  divided into short local-height bands, so the visible wall contains a bridge
  car without becoming an invisible barrier for a ground car below it.
- Player roof collision uses the combined raised-asphalt/structural-clearance
  query at the centre and both ends of the real vehicle capsule. Low ramp
  aprons and soffits stop a lower-level car at their physical boundary; high
  spans remain open. The prospective directed lane projection exempts the
  player's own connected ramp, while rendered model or seated-rider height
  supplies the required clearance. Pier impacts stay with the existing static
  support colliders instead of being applied twice.
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
- Regulatory signs and hidden traffic portals inherit their lane height. Local
  traffic can therefore enter the flyover without materialising below the deck,
  and inactive-level portals are excluded from the player's nearby population.
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
building or landmark asset was deleted or relocated to make room for the
network.

The structural regression suite also checks signal headroom, model-specific
parked-car clearance, both west/east landing-apron pedestrian exclusion,
seeded crowd motion at those mouths, low-deck pedestrian exclusion and complete coverage of
each rendered parapet run by physical barrier chunks, without barriers across
trimmed merge openings. Simulation regressions exercise
ground/elevated projection at the same x/z, swept cross-level traffic contacts,
same-level barrier response, enforcement filtering, elevation-aware
destructibles, 3D render-snap detection and exact Ramses/Corniche under-deck
plus slope-aware pull-over choreography. Additional production-map regressions
drive the Qasr El Ainy underpass from `(318, 215)` through `(416, 203)` and the
Dokki Nile Drive through route from `z=511` to `z=440`; both must stay at zero
elevation and must never capture the 6th October Bridge or Dokki ramp. A
separate Al-Galaa threshold trace crosses `z=308.25` to `z=308.00`, where the
old 12 m cutoff lifted the car from zero to 10.5 m in one 25 cm move. A directed
entry fixture proves the legitimate Dokki on-ramp still
acquires its rising profile. Synthetic vehicle-envelope regressions separately
prove that a 1.38 m soffit and the pre-slab raised apron block a 1.5 m car, a
high span remains passable, and a connected ramp climb reaches the elevated
level without a false deck collision.

For the implementation order and required drive checklist before extending
this system to another city, see
[grade-separated-road-implementation-guide.md](grade-separated-road-implementation-guide.md).
