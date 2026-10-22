# Security Policy

## Reporting a vulnerability

Please do not report security vulnerabilities in public issues. Use GitHub's private vulnerability reporting feature for this repository. Include the affected file or component, the impact, and steps to reproduce when possible.

## Secret handling

Keep credentials in cloud function environment variables or another secret manager. Never put secrets in client-side files, screenshots, example configuration, or commit history. Revoke exposed credentials immediately and contact the service provider if rotation is needed.

Security fixes should be submitted through a private report or a restricted pull request, depending on the impact.
