# Public landing page

The English product landing lives in `site/` and is published at
<https://giuliastro.github.io/token-harness/> by `.github/workflows/pages.yml`.
It is static HTML, CSS and browser JavaScript, with no build dependencies,
visitor accounts, analytics or external font requests.

## Download counts

All desktop download buttons resolve to assets in this repository's GitHub
Releases. When the release API is unavailable, they open the latest release page.
Keep this route: GitHub's native `download_count` then includes downloads from
both the landing and GitHub, without a separate tracker or a duplicate counter.
These are download requests, not unique users or completed installations. GitHub
does not separate landing referrals in this counter.

To see totals and a breakdown by release and asset, open
[Download statistics](https://github.com/giuliastro/token-harness/actions/workflows/download-stats.yml),
choose **Run workflow** on `main`, then open the completed run's summary. The report
reads the current counters; it neither downloads binaries nor increments them.
It includes installers and portable desktop archives from published stable
releases, excluding checksums, source archives and npm tarballs. npm registry
installs are separate. Deleting an asset or release removes it from future reports.

With GitHub CLI installed, the same read-only report is available locally:

```sh
gh api --paginate --slurp 'repos/giuliastro/token-harness/releases?per_page=100' | node scripts/download-stats.mjs
```

The counter comes from the official
[GitHub release asset API](https://docs.github.com/en/rest/releases/assets).

## Author and contact

The author section identifies giuliastro as an AI and token saving expert, with a
dedicated `contact/` page and a public GitHub profile link.

The contact page opens the author's published Google Form and also links to X
and GitHub. The site remains static: no email credentials, recipient address,
third-party embed, or form backend configuration is shipped with Pages. The
form's questions, access settings, responses and notification recipient stay in
Google Forms. Verify the responder URL in a signed-out browser when changing it.

For a form open to everyone, use **Anyone with the link** responder access and
check settings that require sign-in, including **Limit to 1 response** and verified
email collection. Keep response summaries private when collecting contact messages.
Google documents [publishing and responder access](https://support.google.com/docs/answer/2839588).

To receive emails, the owner must enable **Responses → More → Get email
notifications for new responses** in Google Forms. A published form alone does
not prove notifications are enabled or that email arrives. The owner should
verify delivery with a real submission; automated checks never send messages.
See Google's [response notification instructions](https://support.google.com/docs/answer/139706).

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
