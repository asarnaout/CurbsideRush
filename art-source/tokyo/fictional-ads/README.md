# Tokyo fictional advertising source art

These 28 editable v2 WebP cells were generated with OpenAI ImageGen on
2026-08-30. They are source art, not screenshots or complete signs. The game
adds all Japanese/bilingual copy, frames and light emission at runtime.

The portrait and landscape atlases in `public/art/tokyo/` are rebuilt by:

```bash
node tools/import-tokyo-ad-art.mjs <28 ordered image paths>
```

The first 20 inputs are normalized to 384×576 portrait cells; the final eight
are normalized to 768×432 landscape cells. The importer builds a 4×5 portrait
atlas and 4×2 landscape atlas. Keep this order aligned with the `artIndex`
values in `TOKYO_AD_CREATIVES`.

## Shared generation brief

Each image used the appropriate 2:3 portrait or 16:9 landscape form of this
brief, with a separate fictional subject description:

> Use case: ads and marketing. Create flat, front-facing game-billboard
> artwork only: full bleed, no frame, no street-scene mockup. The supplied
> Tokyo photographs are reference only for the city's varied, high-energy
> commercial-advertising atmosphere; do not copy any brand, person, artwork or
> layout. Use a premium contemporary Japanese-market campaign style with a
> bold composition readable from a moving vehicle. Keep the palette bright,
> high-key, saturated and display-ready; the game provides the physical bloom.
> Leave one calm area for runtime copy. Show no words, letters, numbers,
> pseudo-writing, logos, trademarks, brands or watermarks; no political,
> religious, sexual or suggestive material; no alcohol, tobacco, gambling or
> weapons; and no recognisable real person. Avoid isolated products on dark
> gradients, wet reflective floors, neon-bar bokeh, black catalogue
> backgrounds and the repeated cyan/magenta luxury-packshot treatment.

The supplied reference photographs are not bundled. They guided only scale,
colour, variety and the contrast between stacked vertical signs and large
digital screens.

## Ordered subjects

Portrait cells 01–20 are:

1. graphic men's street-fashion editorial in cobalt, red and white;
2. friendly original robot mascot on yellow and turquoise;
3. high-key ramen campaign in red and cream;
4. bright beauty editorial with a fictional model;
5. energetic original music-group illustration;
6. luminous aquarium and jellyfish experience;
7. graphic city runner campaign;
8. cheerful Shiba companion campaign;
9. colourful fruit-parfait café campaign;
10. optimistic daytime rail-travel campaign;
11. quiet contemporary reading campaign;
12. playful creator/art-collage campaign;
13. bright neighbourhood florist campaign;
14. city photographer lifestyle campaign;
15. calm green-tea lifestyle campaign;
16. graphic bicycle-commuter campaign;
17. family-friendly illustrated fantasy game;
18. original science-fiction cinema campaign;
19. social coffee-break lifestyle campaign; and
20. graphic women's street-fashion editorial.

Landscape cells 21–28 are:

1. colourful city-friends lifestyle campaign;
2. original mascot ensemble;
3. horizontal beauty editorial;
4. cinematic night-train travel campaign;
5. bright shared-food feast;
6. abstract kinetic LED colour field;
7. bright home/interior lifestyle scene; and
8. secular seasonal fireworks celebration.

All visible Japanese and bilingual campaign copy is defined in
`app/game/tokyoAdvertising.ts` and remains auditable independently of these
pixels.
