# Legacy `moneyjs` redirects

SFCApp used to live at `johnnewto/moneyjs`. This folder keeps the old GitHub Pages path working.

## GitHub Pages (`/moneyjs/` → `/sfcapp/`)

After renaming the main repo to `sfcapp`, create (or update) a separate public repo `johnnewto/moneyjs` whose GitHub Pages source is `redirects/moneyjs-github-pages/`.

That site is served at `https://johnnewto.github.io/moneyjs/` and client-side-rewrites every path, query, and hash to `/sfcapp/`.
