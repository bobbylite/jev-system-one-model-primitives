# Jev System One model primitives

Three demos of [Jev](https://docs.typesafe.ai/introduction) from TypeSafe, one per
primitive: **Noul** (is it a sandwich?), **Score** (how much of a cult is it?) and
**Choice** (route the chaos). Jev returns typed judgments and probabilities; plain
code owns the policy that turns them into decisions.

Question text, weights, and the policy that turns Jev's answers into a verdict live in `src/worker/policy/`. A web UI covering all three is served by the same Worker.

## Live demo

https://jev-primitives.bobbylite.workers.dev

The site is one free-plan Worker named `jev-primitives`. Visitors sign in with the same PingOne application the estimator uses (`pi.flow`, confidential client, server-side only). `POST /api/classify`, `POST /api/cult/score`, and `POST /api/chaos/route` then run this sequence and stop at the first failure:

1. Signed-in session, or **401**.
2. Membership in `jev-pilot-program` when `AI_PILOT_GATE_ENABLED` is `true`, or **403** `pilot_required`.
3. The **$2 per UTC day** spend cap.
4. The per-user call limit and the per-IP limit.
5. The Jev call.

A 401 or 403 does not touch the spend Durable Object or the rate counters. `GET /api/config`, `GET /api/cult/config`, and `GET /api/chaos/config` stay public. The page itself is the login screen until a member is signed in.

`wrangler.jsonc` does **not** set `limits.cpu_ms`. Cloudflare rejects that key on the free plan (error 100328) and the deploy workflow fails. Leave it unset.

Pushing `main` (or running the Deploy workflow by hand) ships it. The workflow is `.github/workflows/deploy.yml`: a verify job (`npm ci`, typecheck, test, build) and then a deploy job. Deploy fails with the missing secret **names** if either of these repository secrets is absent:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

`TYPESAFE_API_KEY` and `PINGONE_CLIENT_SECRET` are Worker secrets, set once, never committed and never vars in `wrangler.jsonc`:

```sh
npx wrangler secret put TYPESAFE_API_KEY --name jev-primitives
npx wrangler secret put PINGONE_CLIENT_SECRET --name jev-primitives
```

While the TypeSafe key is unset, a signed-in member still gets **503**:

```json
{"detail":"Jev is switched off until an API key is set."}
```

Jev calls share a hard **$2 per UTC day** budget (`JEV_DAILY_BUDGET_USD`, default `"2"`, reset at midnight UTC). The counter is a SQLite Durable Object (`SpendLedger`). `wrangler deploy` applies the migration in `wrangler.jsonc`. A call under the cap reserves the rest of the day's budget first; the real token cost is written after Jev returns. If the counter cannot be read or written, the Worker refuses the call with 503 and does not reach Jev. The ledger checks the cap before it increments the per-IP counter. `JEV_IP_CALLS_PER_HOUR` (default `30`, `0` to disable) is that per-IP limit. After the cap allows the call, `AI_USER_CALLS_PER_HOUR` (default `30`) and `AI_USER_TOKENS_PER_DAY` (default `100000`) limit that signed-in user. Those counters live in the `SESSIONS` KV namespace. Cost is estimated the same way as estimator-demo: $15 / 1M input tokens and $60 / 1M output tokens, which sits high on purpose so the cap trips before real spend does.

`JEV_MOCK=true` and `PINGONE_MOCK=true` apply only to local `wrangler dev`. Both are ignored on the edge, where Cloudflare sets `cf-ray` before the Worker runs, so a production var of either name cannot turn a mock on. `request.cf` is not used for this check: wrangler dev fills it too. `wrangler.jsonc` sets `PINGONE_MOCK` to `"false"`.

## Sign in

The browser never redirects to a PingOne-hosted page and never sees an access token, refresh token, ID token, or client secret. The Worker is a confidential-client backend-for-frontend. It runs PingOne’s redirectionless `pi.flow` (`response_mode=pi.flow`), keeps the PingOne `ST` cookie and the app session in KV, and sets an httpOnly `meridian_session` cookie (`SameSite=Lax`, `Secure` on https). State-changing requests send `X-CSRF-Token`. A browser `Origin` must match this app.

Scopes are `openid profile email offline_access`, the same string the estimator sends. Authorize includes `code_challenge_method=S256`. The token request uses `Authorization: Basic` with the client secret and sends `code_verifier`. `redirect_uri` is omitted unless `PINGONE_REDIRECT_URI` is set, and then the **same** value is sent on authorize and on the token POST.

Sessions last 12 hours. When a refresh token is present and the groups check is older than five minutes, the Worker refreshes and re-reads the ID token, and fails closed if that refresh does not return an ID token. When PingOne did not issue a refresh token, the sign-in membership stamp is trusted until `accessExpiresAt`, then the call returns **401** `reauth_required` (`Sign in again to keep using Jev.`) and the page shows **Sign in again**. The Worker logs `pingone.refresh_token.missing` with no token contents. A failed PingOne step logs `pingone.auth.failed` with PingOne’s id, code, message, details, and correlation id. Passwords, cookies, and tokens are not in that line.

Non-members see **You’re not in the Jev pilot.** The API returns **403** with `kind: "pilot_required"` and `detail: "You're not in the Jev pilot."`

Plain vars in `wrangler.jsonc` (public ids, safe to commit):

| Var | Value |
| --- | --- |
| `PINGONE_ENV_ID` | `c74a4945-1364-4966-9a68-abeaa3e7b767` |
| `PINGONE_CLIENT_ID` | `55833d59-268f-4355-a46c-030fdf10c206` |
| `PINGONE_AUTH_HOST` | `https://auth.pingone.com` (North America) |
| `PINGONE_SCOPES` | `openid profile email offline_access` |
| `PINGONE_MOCK` | `false` |
| `AI_PILOT_GATE_ENABLED` | `true` |
| `AI_PILOT_GROUP` | `jev-pilot-program` |
| `AI_PILOT_GROUPS_CLAIM` | `groups` |
| `AI_USER_CALLS_PER_HOUR` | `30` |
| `AI_USER_TOKENS_PER_DAY` | `100000` |
| `JEV_DAILY_BUDGET_USD` | `2` |
| `JEV_IP_CALLS_PER_HOUR` | `30` |

KV binding `SESSIONS`, id `4961d23b1e7a4703b6b67e6ce3a713db`. Do not commit `PINGONE_CLIENT_SECRET` or `TYPESAFE_API_KEY`.

`AI_PILOT_GATE_ENABLED` is the string `true` or it is off. Any other value lets every signed-in user call Jev, still inside the spend cap and the rate limits. Unsigned visitors still get the login page.

Local mock (`PINGONE_MOCK=true` in `.dev.vars`, and only on a request without `cf-ray`):

| | |
| --- | --- |
| Pilot member | `robert@meridian.test` / `stake-demo` |
| MFA | same username, password `mfa-demo`, then code `482913` |
| Outside the group | create `ada@meridian.test` / `Stake-1847`, then code `18472639` |

The login card labels this **Fake PingOne**. It does not call the tenant.

### What Robert changes in PingOne

The client id above is the estimator’s existing OIDC **Web** application. Do not create a second application. Do these by hand on that app, in the North America environment `c74a4945-1364-4966-9a68-abeaa3e7b767`.

**Redirect URI.** `pi.flow` does not send the browser anywhere, and this Worker does not send `redirect_uri` until `PINGONE_REDIRECT_URI` is set. PingOne still requires `redirect_uri` when the application already has one or more redirect URIs registered (the estimator’s are). If authorize fails with `INVALID_VALUE` and target `redirect_uri`, add this URL on the application’s **Redirect URIs** and set the Worker var to the same characters, including the path:

`https://jev-primitives.bobbylite.workers.dev/oauth/callback`

```sh
npx wrangler secret put PINGONE_REDIRECT_URI --name jev-primitives
```

Paste that URL when prompted. It is not a secret, but a secret slot is a fine place to set it without a code change. A var in the dashboard named `PINGONE_REDIRECT_URI` is the same thing. The Worker then sends that exact value on `GET /as/authorize` and again on `POST /as/token`. A mismatch fails the token exchange. Leave the var unset only if authorize succeeds without `redirect_uri`.

**Allowed origins / CORS.** Not required for this login. The browser never calls `auth.pingone.com`. The Worker does. Do not add the Jev origin to PingOne CORS unless a future browser SDK starts calling PingOne directly. There is no CORS change to make for `pi.flow`.

**Group.** Directory → Groups → create `jev-pilot-program` if it is not there. Open the group → Users → Add Individually → add yourself. The gate compares the ID-token `groups` claim to that name, case-insensitive. The estimator’s attribute mapping (`groups` → Group Names, on the ID token) is reused because this is the same application. If that mapping is missing, Applications → the app → Attribute Mappings → Add → attribute name `groups`, mapping **Group Names**, claim on the ID token, save.

**Refresh token.** The application needs the Refresh Token grant, and `offline_access` on the OpenID resource grant when that grant exists. With a refresh token, removing someone from `jev-pilot-program` takes effect on the next Jev call after the five-minute check. Without a refresh token, membership stays as it was at sign-in until the access token expires, then the user must sign in again.

**Registration (optional).** The sign-up form is on the login page. It works only if the sign-on policy attached to this application includes the Registration action, a population, and email verification. If `user.register` is missing, the page says registration is off. No new redirect URI is involved. The browser stays on Jev.

**Sign-on policy.** Username and password, plus MFA if you want the OTP step. Password reset and FIDO are reported as an unsupported step and are not collected here.

After those console changes, the next request uses them. No redeploy is required for a new group member. A new `PINGONE_REDIRECT_URI` value takes effect when the Worker var or secret is saved.

## Why TypeSafe and Jev are powerful

Most "AI features" today are a prompt, a text reply, and a parser that hopes the reply
is well formed. TypeSafe flips that around. Its **System One** models are built to
make fast, structured decisions that software can use directly, and **Jev** is the
first of them. Instead of writing prose, Jev returns **typed answers and
probabilities**. It doesn't write replies, produce code, or explain itself. Your code
stays in charge and Jev supplies the common sense that ordinary code can't.
See [System One](https://docs.typesafe.ai/concepts/system-one) for the full concept.

Why that is useful, and where this repo shows it:

- **Typed output, no parsing.** Answers arrive as a `Noul` probability, a `Score`
  position on ordered levels, or a `Choice` among options (see
  [primitives](https://docs.typesafe.ai/primitives)). There's no prompt-and-parse
  step to break, so `resp.nouls["bread"].noul` is just a float you can multiply.
- **Calibrated probabilities.** The models are trained so their probabilities reflect
  real uncertainty. That makes thresholds meaningful: the Chaos tab auto-routes only
  when `Choice` [confidence](https://docs.typesafe.ai/confidence) clears a bar, and
  sends everything else to human triage.
- **Atomic questions, composed in code.** One broad question hides several judgments.
  Sandwich asks five narrow yes/no questions and combines them with plain arithmetic
  you can read, test and change. This is the core of
  [how to build with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one):
  control flow, rules and side effects stay in code.
- **Re-tune policy without re-running inference.** The raw judgments are reusable
  data. Drag the weights in the Cult tab or the threshold in the Chaos tab and the
  verdict changes instantly in the browser, with no new API call. That's the
  [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring) pattern.
- **Fan out in one round trip.** Independent questions over the same state run in
  parallel. Chaos asks a `Choice`, a `Noul` and a `Score` together and lets code use
  the answers it needs, which is
  [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out). The trade-off is
  that you pay tokens for answers you may discard.
- **Inspectable, so debuggable.** Every signal, criterion and probability is visible
  in the UI. When a verdict looks wrong you can see whether the model, the question
  wording or your own weights caused it.

Typed output guarantees the *interface*, not the truth. Validate thresholds on your
own data before trusting them.

### What is Jev?

Jev is TypeSafe's flagship model and the first **System One** model: a model built
to answer typed *questions* about some *state* and return structured results
directly, with no text generation and no parsing. You ask in plain English and get
back a Noul probability, a Score, or a Choice with probabilities and confidence.

**How it's trained: RLCD.** TypeSafe trains its models with **reinforcement learning
for calibrated decisions (RLCD)**. The docs contrast it with RLHF, the method behind
most chat assistants:

| | RLHF (chat models) | RLCD (Jev) |
| --- | --- | --- |
| Teaches the model to | Say things people prefer | Make constrained decisions with calibrated uncertainty |
| Output | Generated text | Decisions and probabilities |
| Optimized for | Conversation | Production systems where code needs a narrow decision it can inspect and act on |

The goal is that a higher probability really does mean a greater chance the answer is
correct. That's what *calibrated* means: outcomes Jev scores at 0.2 should happen
about 20% of the time, outcomes at 0.8 about 80%, and so on. It's what makes the
thresholds in this repo (auto-route at 0.70 confidence, the 0.35 / 0.65 sandwich
cutoffs) something you can reason about instead of guess at.

Sources: [System One](https://docs.typesafe.ai/concepts/system-one) and the
[AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer). The
docs don't publish Jev's size, architecture or base model, so this README doesn't
make claims about them. Calibration is a design goal, so check it on your own data.

### Is Jev just another classifier?

Partly. Jev's output has the same shape as a classifier's: a label or a probability
instead of free text. The difference is in how you get to that output.

**A regular classifier** is a model trained for one fixed task. You collect labeled
examples ("spam" / "not spam"), train it, and it can only answer the question it was
trained on, with the labels it was trained on. Changing the question, adding a label
or changing what a label means usually means new data and retraining. It's a good
fit when you have lots of labeled data and a stable task, and it is often cheap to run
once built.

**Jev** is a general decision model that you point at a different question on every
request. Look at `src/worker/policy/sandwich.ts`, `cult.ts` and `chaos.ts`: each one hands Jev some
`state` plus questions written in plain English with their own `criteria`. There is
no dataset, no training run and no label list baked into the model. Add a question,
reword a criterion or swap a Choice option and the next request uses it.

| | Regular classifier | Jev |
| --- | --- | --- |
| Question | Fixed at training time | Written in your code, per request |
| Labels / levels | Fixed set the model was trained on | Defined by you in `criteria` |
| To change behavior | Relabel data and retrain | Edit the question text |
| Needs labeled data to start | Yes | No (you still want test cases to validate it) |
| Output | A label, often with an uncalibrated score | A typed [Noul / Score / Choice](https://docs.typesafe.ai/primitives) with probabilities |
| Several judgments per input | One model per judgment | Many questions in one parallel request |

It also differs from a general LLM. An LLM generates text that you then have to
coerce into a decision and parse. Jev
[returns the decision directly](https://docs.typesafe.ai/introduction) and is trained
for calibrated probabilities, so "0.8" should be right about 80% of the time (see
the [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer)).

So the honest answer is that Jev is not special because it classifies. It is special
because it is a *programmable* classifier: the question is code you can write,
version and test, and the answers are typed values you can combine with ordinary
logic. A trained classifier can still win when you have lots of labeled data, a
fixed task and tight cost or latency limits. And whatever you choose, measure the accuracy and
calibration on your own data instead of assuming them.

### The three primitives in this repo

| Primitive | Question it answers | Demo | Code owns |
| --- | --- | --- | --- |
| [Noul](https://docs.typesafe.ai/primitives/noul) | Does this condition hold? (probability of yes) | Is it a sandwich? | `Sandwich` weights and the sandwich / contested / not thresholds |
| [Score](https://docs.typesafe.ai/primitives/score) | How much, along an ordered scale? | How much of a cult is it? | `Cult` dimension weights and tier labels |
| [Choice](https://docs.typesafe.ai/primitives/choice) | Which one of these? | Route the chaos | `Chaos` confidence cutoff and priority from urgency and anger |

### TypeSafe documentation

- [Documentation index](https://docs.typesafe.ai/llms.txt) and [introduction](https://docs.typesafe.ai/introduction)
- [System One](https://docs.typesafe.ai/concepts/system-one) and [how to build with it](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [State](https://docs.typesafe.ai/concepts/state) and [use-case map](https://docs.typesafe.ai/concepts/use-case-map)
- Primitives: [overview](https://docs.typesafe.ai/primitives), [Noul](https://docs.typesafe.ai/primitives/noul), [Score](https://docs.typesafe.ai/primitives/score), [Choice](https://docs.typesafe.ai/primitives/choice)
- [Confidence](https://docs.typesafe.ai/confidence)
- Patterns: [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
- SDKs: [JavaScript](https://docs.typesafe.ai/sdk/javascript), [Python](https://docs.typesafe.ai/sdk/python), and the [HTTP API](https://docs.typesafe.ai/api) this Worker calls
- [Get an API key](https://console.typesafe.ai/)

## Setup

Prerequisite: Node 22.12+ (needed by Vite, tldraw, and Wrangler). One command does everything and is safe to re-run:

```sh
bash scripts/setup.sh    # npm deps, .dev.vars from .dev.vars.example, UI build
```

Then put your key from https://console.typesafe.ai/ in `.dev.vars` as `TYPESAFE_API_KEY`.
That file is gitignored. Wrangler reads it for local dev. The script warns if the key
isn't set. `.dev.vars.example` turns on `PINGONE_MOCK` and `JEV_MOCK` for local dev.
With the key empty and `JEV_MOCK` unset, a signed-in POST returns the same 503
as production: `Jev is switched off until an API key is set.` Unsigned requests get 401 first.

On a deployed Worker the key is a secret, not a var in `wrangler.jsonc`:

```sh
npx wrangler secret put TYPESAFE_API_KEY --name jev-primitives
```

Set `JEV_MOCK=true` in `.dev.vars` when you want the UI without a key. That returns
canned answers labeled `local-mock` and does not call TypeSafe. It only applies to
local `wrangler dev` requests. Leave it unset once the key is real.

## Run

The API and the built UI are one Cloudflare Worker on the free plan. `wrangler.jsonc` does not set `limits.cpu_ms` (Cloudflare error 100328). Build the UI, then start Wrangler:

```sh
npm test                                 # policy math and the HTTP contract
npm run build                            # typecheck + Vite build into web/dist
npx wrangler dev                         # http://127.0.0.1:8787 serves /api and the UI
```

`npm run size` is `wrangler deploy --dry-run`. It prints the compressed Worker size and does not deploy.

For front-end work, run `npx wrangler dev` and, in a second terminal, `npm run dev`.
Vite serves the UI with hot reload at http://localhost:5173 and proxies `/api` to
the Worker on port 8787. `npm run typecheck` runs `tsc` for the UI and the Worker.

**Whiteboard:** the icon in the top-right corner opens a [tldraw](https://tldraw.dev/)
whiteboard in a dark-themed modal. It's lazy-loaded, so tldraw is only downloaded the
first time you open it, and drawings persist in the browser (IndexedDB). tldraw runs in
development mode for free, but production deployments need a
[license key](https://tldraw.dev/pricing). Put it in `.env.local` as
`VITE_TLDRAW_LICENSE_KEY=...` before building.

The UI has tabs (`#sandwich`, `#cult`, `#chaos`), one per Jev primitive:

| Tab | Primitive | Backend |
| --- | --- | --- |
| Sandwich | Noul (yes/no probabilities) | `Sandwich`, `POST /api/classify` |
| Cult | Score (ordered levels + distribution) | `Cult`, `POST /api/cult/score` |
| Chaos | Choice (pick one) + Noul + Score fan-out | `Chaos`, `POST /api/chaos/route` |

- `src/worker/`: Hono on a Worker. `routes/auth.ts` is the PingOne BFF (ported from estimator-demo). `routes/api.ts` is the `/api` router. Session and pilot checks run in middleware in front of the three Jev POSTs. `jev/client.ts` POSTs `https://api.typesafe.ai/v1/systemone`, the same HTTP call estimator-demo uses, with `fetch.bind(globalThis)` so workerd does not throw `Illegal invocation`. The JS SDK would retry and add weight this free-plan Worker does not need. `policy/` holds the questions and the verdict math.
- `web/`: the React + TypeScript app (`src/views/` has one component per tab, `src/api.ts` has the typed API contract, `src/Whiteboard.tsx` is the tldraw modal)
- `web/dist/`: the build output the Worker serves as static assets (git-ignored)
- Chaos tab: the auto-route confidence threshold is adjustable in the browser and flips the decision without calling Jev again.
- Cult tab: weights are adjustable in the browser and recompute the index without calling Jev again.

The Python FastAPI app and the `sandwich.py` CLI are gone. The CLI only existed to print the same policy the Worker now owns, and it depended on the Python SDK. The numbers are pinned by `npm test` instead.

## Use it from other devices on your network

```sh
npm run build
npx wrangler dev --ip 0.0.0.0 --port 8787
```

Then open `http://<this-machine's-LAN-IP>:8787` from another laptop on the same Wi-Fi.
The login page is in front. With `PINGONE_MOCK=true`, that laptop can use the fake PingOne account above. Your TypeSafe key stays in `.dev.vars` and is never sent to browsers.

## Debug in VS Code

Open the folder, then use **Run and Debug** and pick:

- **Worker: wrangler dev**: runs setup, builds the UI, and serves http://127.0.0.1:8787
- **Web UI: Vite dev server**: hot reload on port 5173. Start the Worker first so `/api` has somewhere to go.

Each one runs a **Setup** task first (`scripts/setup.sh`), so a fresh clone works
without any manual steps. The tasks are also available from **Terminal → Run Task**.
**Worker: wrangler dev** is there too, if you already built the UI.

## Tuning

Edit `Sandwich.explain()` to change the weights and the 0.35 / 0.65 thresholds, or add questions on `Sandwich.questions`. Cult weights and tiers are `Cult.defaultWeights` and `Cult.tiers`. Chaos cutoffs are `Chaos.confidenceAt` and `Chaos.priorityCuts`.
