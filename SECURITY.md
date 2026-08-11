# Security Policy

## Supported versions

Chive remains in early development. The project applies security fixes only to the latest commit on `main`.

Tagged releases and older commits do not receive security fixes.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Public details can put users and their documents at risk.

Email `cfchou@gmail.com` with a subject that starts with `[Chive Security]`.

Include these details when possible:

- The affected commit or version
- The affected operating system
- The vulnerability description and impact
- The steps for reproduction
- A minimal proof of concept
- A possible fix or mitigation

Remove personal data and sensitive PDF content from the report. Use a minimal test file when the vulnerability requires a PDF.

The maintainer will confirm receipt and coordinate the next steps. Keep the report private until the maintainer approves disclosure.

## Security scope

Reports can cover the official app under `app/`, its Tauri commands, its PDF operations, and its direct dependencies.

Experiments under `spikes/` do not represent supported product behavior. Reports about a spike remain useful when the same issue affects `app/`.
