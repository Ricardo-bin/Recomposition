# Theme assets

One folder per theme. Put your own files here with **exactly these names**
(configured in `themeAssets.js`):

```text
assets/themes/
├── batman/              (Batman Dark)
│   ├── logo.svg         vector logo
│   ├── hero.webp
│   ├── dashboard.webp
│   ├── profile.webp
│   ├── background.webp
│   ├── decorative.webp
│   └── texture.webp
└── linkin-park/         (Linkin Park Light)
    └── ...same seven files...
```

- **Logos:** SVG. **Artwork / backgrounds / textures:** WebP.
- **Keep them small for phones:** backgrounds around 1080 px wide and under ~250 KB,
  textures small and tileable, hero/dashboard/profile around 800-1200 px wide.
- A file that is not there is simply skipped: nothing breaks, and a theme never
  borrows the other theme's file.
- Nothing is loaded until a page element asks for it
  (`<img data-theme-asset="hero">` or a CSS rule using `var(--theme-asset-hero)`).
