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

Email delivery uses a Formspree form ID: configure and verify the recipient in
the author's Formspree account, then set the repository Actions variable
`CONTACT_FORM_ENDPOINT` to its `https://formspree.io/f/…` endpoint. Run **Landing
page** on `main` after changing this variable (variable edits do not trigger a
deployment). The recipient address belongs only in the service's private
configuration, never in HTML, JavaScript, repository history, or an endpoint URL.
No email credentials are shipped to the browser.

`node scripts/prepare-landing.mjs` copies the static site into `dist/landing/` and
writes only the validated public form endpoint into the contact page. The form
works without browser JavaScript. If unconfigured, the page offers the GitHub
profile instead of a non-working form. The native POST
goes to Formspree, which processes the sender's fields and handles submission
responses and spam challenges. The page links to its privacy policy. Check the
service dashboard's domain and spam settings when activating the form.

To disable email delivery, unset `CONTACT_FORM_ENDPOINT` and republish the landing.
Fixture tests use a fake endpoint and never submit messages. After activation,
have the owner verify a real message arrives; endpoint validation alone does not
prove email delivery. Keep contact destinations explicitly approved by the author
or already public on their profile; never copy a private Git configuration or
account email into the page.

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
