# Contributing to CARDZ3N Gateway for WooCommerce

Thanks for your interest in improving the plugin. This document covers the branching model, coding standards, commit conventions, and PR expectations.

## Branch model

We use a lightweight git-flow:

| Branch | Purpose | Protected? |
|---|---|---|
| `main` | Production. Every commit here is a released, tagged version. | Yes |
| `develop` | Integration branch. All feature branches merge here. | Yes |
| `release/x.y.z` | Stabilization for an upcoming release. Only bugfixes, docs, version bumps. | Yes |
| `feature/<slug>` | New work. Branch from `develop`, PR back into `develop`. | No |
| `fix/<slug>` | Bugfix. Branch from `develop` (or `release/*` for release bugs). | No |
| `hotfix/<slug>` | Critical production fix. Branch from `main`, PR into both `main` and `develop`. | No |

## Release flow

1. Cut `release/x.y.z` from `develop`.
2. Bump version in `cardz3n-gateway-woocommerce.php` header, `CARDZ3N_GW_VERSION` constant, `readme.txt` `Stable tag`, and `CHANGELOG.md`.
3. QA against `docs/QA-TEST-MATRIX.md`.
4. PR `release/x.y.z` → `main`. Merge with a merge commit.
5. Tag `vX.Y.Z` on `main`. GitHub Actions builds the release zip.
6. Back-merge `main` → `develop`.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(checkout): add Google Pay button to embedded form
fix(refund): void unsettled transactions before attempting refund
docs(install): clarify Collect.js tokenization-key setup
chore(ci): upgrade PHPCS to 3.9
```

Allowed scopes: `checkout`, `api`, `vault`, `refund`, `capture`, `level3`, `subs`, `preorders`, `wallet`, `ach`, `admin`, `settings`, `brand`, `i18n`, `ci`, `docs`, `deps`, `release`.

## Coding standards

- **PHP 7.4+** minimum; do not use 8.0+ syntax.
- Follow [WordPress Coding Standards](https://developer.wordpress.org/coding-standards/wordpress-coding-standards/php/).
- Every callable string passed to WordPress hooks must be escaped/sanitized; every DB write must be prepared.
- No inline JS/CSS. Enqueue everything.
- No `eval`, no `create_function`, no remote script loading outside Collect.js / Google Pay / Apple Pay SDKs.
- Wrap user-facing strings in `__()` / `esc_html__()` with text domain `cardz3n-gateway`.

Run PHPCS locally:

```bash
composer install
composer run lint
```

## Pull requests

1. PR target = `develop` (unless hotfix).
2. Fill out the PR template completely.
3. Link the issue (`Closes #123`).
4. Include test evidence — screenshots for UI, cURL / log excerpts for gateway flows.
5. Check that the relevant rows in `docs/QA-TEST-MATRIX.md` still pass.
6. Wait for CI green + 1 review approval.

## Reporting security issues

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).
