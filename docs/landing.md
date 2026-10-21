# Public landing page

The English product landing lives in `site/` and is published at
<https://giuliastro.github.io/token-harness/> by `.github/workflows/pages.yml`.
It is static HTML, CSS and browser JavaScript, with no build dependencies,
accounts, analytics or external font requests.

## Edit and preview

Serve `site/` with a local static HTTP server. Use relative paths so the same files
work below GitHub Pages' `/token-harness/` project prefix. Keep content and download
links usable when JavaScript or the GitHub release API is unavailable.

The screenshots originate in `docs/images/`. Keep their example caption and the
distinction between measured output reduction, estimates and allowance balances.
Do not turn screenshot figures into general savings claims.

## Publication and rollback

Pull requests syntax-check the browser script. Only a push to `main` or a manual
run on `main` can publish a Pages artifact; PRs have no deployment credentials.
GitHub Pages uses the Actions publishing source and the `github-pages` environment.

After publication, verify the public page, local assets, keyboard navigation,
mobile layout, both themes and the GitHub/download links. The release API may
rate-limit anonymous requests; links must retain the latest-release page fallback.

To roll back a page change, revert its commit on `main`. The push republishes the
previous version through the same workflow. A manual run on `main` can republish
the current source without changing the application release or its installers.
