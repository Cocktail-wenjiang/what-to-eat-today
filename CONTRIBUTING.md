# Contributing

## Workflow

1. Create a short-lived branch from `main`.
2. Keep changes focused and describe user-visible behavior in the pull request.
3. Run `node tools/validate_project.mjs` before opening a pull request.
4. Open a pull request against `main` and wait for the required checks.

## Secrets

- Never commit API keys, passwords, access tokens, certificates, or `.env` files.
- Configure service credentials in the relevant cloud function environment settings.
- If a credential is exposed, revoke or rotate it immediately. Removing it from a later commit does not remove it from Git history.

## Project checks

The validation script parses tracked JSON and JSONL files and checks JavaScript syntax. This repository does not currently define an npm build or test script; add one when the app gains a repeatable command-line build or test suite.
