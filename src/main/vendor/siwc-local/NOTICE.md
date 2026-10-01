# Vendored: `@siwc/local` (Sign in with ChatGPT DevKit)

- Source: https://github.com/openai/sign-in-with-chatgpt-devkit — `packages/local/src`
- Commit: `f723814abdccec135b519c451fb6e1992ee5e933` (2026-09-29)
- Copyright 2026 OpenAI
- License: **Sign-in with ChatGPT DevKit Noncommercial License v1.0** — see [`LICENSE`](./LICENSE).
  These files (and Snap Notes' modifications to them) may be used and distributed **only for
  Noncommercial Purposes** as defined in that license. Commercial use requires a separate
  written agreement with OpenAI. The rest of Snap Notes is not covered by this license.

`@siwc/local` is not published to npm (it is a private workspace package in the DevKit),
so it is vendored here, as the DevKit README suggests for local integrations.

## Changes made by Snap Notes (license section 4(b))

Each changed file carries a header comment. Changes, all additive:

| File | Change |
| --- | --- |
| `types.ts` | `ResponseContentPart` (`input_text` / `input_image`) so messages can carry an image, which the SIWC docs allow "when the selected model accepts them"; `ResponseUsage`; optional `ChatGPTModel.inputModalities`. |
| `responses.ts` | Validation accepts content-part arrays (images only as `data:image/...` URLs); keeps the `retry-after` header on errors; returns token usage from `response.completed` when the event includes it. Request body (`store: false`, `stream: true`) unchanged. |
| `errors.ts` | `ChatGPTError.retryAfterSeconds`, filled only from an official `retry-after` header. |
| `models.ts` | Passes through `input_modalities` / `modalities` from the model catalog **only if present**. Nothing is inferred. |
| `index.ts` | Re-exports the new types. |

No change touches OAuth, PKCE, token storage, refresh or revocation.
