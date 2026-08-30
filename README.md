# sc4mapper-web

Browser tool: drop a **16-bit grayscale PNG** heightmap, auto-build a SimCity 4 region grid, download a ZIP of `.sc4` cities plus `config.bmp`.

Logic is a TypeScript port of [SC4Mapper-2026](https://github.com/caspervg/SC4Mapper-2026) (QFS, DBPF city save, `BuildBestConfig` grid). Blank city templates are the same `City - Small/Medium/Large.sc4` files.

## Run

```sh
npm install
npm run dev
```

Open the URL Vite prints. Unzip the download into `Documents/SimCity 4/Regions/`.

PNG size must be `tiles×64+1` (example: 1025×1025 → 16×16).

## Scope

In: 16-bit PNG → grid → region ZIP.

Out: open existing regions, SC4M, 8-bit/RGB import, desktop UI.
