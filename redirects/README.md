# Legacy `moneyjs` redirects

SFCApp used to live at `johnnewto/moneyjs` and `moneyjs.pages.dev`. These folders keep the old URLs working.

## GitHub Pages (`/moneyjs/` → `/sfcapp/`)

After renaming the main repo to `sfcapp`, create (or update) a separate public repo `johnnewto/moneyjs` whose GitHub Pages source is `redirects/moneyjs-github-pages/`.

That site is served at `https://johnnewto.github.io/moneyjs/` and client-side-rewrites every path, query, and hash to `/sfcapp/`.

## Cloudflare Pages (`moneyjs.pages.dev` → `sfcapp.pages.dev`)

`.github/workflows/deploy-cloudflare-pages.yml` deploys `redirects/moneyjs-cloudflare/` to the existing Cloudflare Pages project `moneyjs`, so `https://moneyjs.pages.dev/*` 301s to `https://sfcapp.pages.dev/*`.
