# Jev System One model primitives

Three demos of [Jev](https://docs.typesafe.ai/introduction) from TypeSafe, one per
primitive: **Noul** (is it a sandwich?), **Score** (how much of a cult is it?) and
**Choice** (route the chaos). Jev returns typed judgments and probabilities; plain
code owns the policy that turns them into decisions.

The original CLI version of the sandwich demo is `sandwich.py`. A web UI covering all three is below.

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
request. Look at `sandwich.py`, `cult.py` and `chaos.py`: each one hands Jev some
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
| [Noul](https://docs.typesafe.ai/primitives/noul) | Does this condition hold? (probability of yes) | Is it a sandwich? | Weights and the sandwich / contested / not thresholds |
| [Score](https://docs.typesafe.ai/primitives/score) | How much, along an ordered scale? | How much of a cult is it? | Dimension weights and tier labels |
| [Choice](https://docs.typesafe.ai/primitives/choice) | Which one of these? | Route the chaos | Confidence cutoff and priority from urgency and anger |

### TypeSafe documentation

- [Documentation index](https://docs.typesafe.ai/llms.txt) and [introduction](https://docs.typesafe.ai/introduction)
- [System One](https://docs.typesafe.ai/concepts/system-one) and [how to build with it](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
- [State](https://docs.typesafe.ai/concepts/state) and [use-case map](https://docs.typesafe.ai/concepts/use-case-map)
- Primitives: [overview](https://docs.typesafe.ai/primitives), [Noul](https://docs.typesafe.ai/primitives/noul), [Score](https://docs.typesafe.ai/primitives/score), [Choice](https://docs.typesafe.ai/primitives/choice)
- [Confidence](https://docs.typesafe.ai/confidence)
- Patterns: [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring), [speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)
- [Python SDK](https://docs.typesafe.ai/sdk/python) and [HTTP API](https://docs.typesafe.ai/api)
- [Get an API key](https://console.typesafe.ai/)

## Setup

Prerequisites: Python 3.11+, Node 22.12+ (needed by Vite and tldraw), and optionally
[uv](https://docs.astral.sh/uv/). One command does everything and is safe to re-run:

```sh
bash scripts/setup.sh    # venv + Python deps, npm deps, .env from .env.example, UI build
```

Then put your key from https://console.typesafe.ai/ in `.env`. The script checks your
Python and Node versions, uses `uv sync` if uv is installed (otherwise `venv` + `pip`),
and warns if `TYPESAFE_API_KEY` isn't set.

## Run

```sh
set -a; source .env; set +a                  # load the API key
.venv/bin/python sandwich.py                 # built-in examples
.venv/bin/python sandwich.py "gyro" "pizza"  # your own foods
```

Example output format:

```
BLT                      -> SANDWICH (0.9x)
                           bread=0.99  filling=0.99  ...
```

## Web UI

A dark, flat single-page UI built with React 19, TypeScript and Vite, backed by
FastAPI. It shows every signal Jev returned, the criteria behind each question,
and the math the code used to reach the verdict.

```sh
uv sync                                  # Python deps (or: .venv/bin/pip install -e .)
npm install && npm run build             # builds the UI into web/dist
set -a; source .env; set +a
uv run uvicorn app:app --reload          # http://127.0.0.1:8000 serves the API and the built UI
```

For front-end work, run the API as above and, in a second terminal, `npm run dev`.
Vite serves the UI with hot reload at http://localhost:5173 and proxies `/api` to
FastAPI on port 8000. `npm run typecheck` runs `tsc`.

**Whiteboard:** the icon in the top-right corner opens a [tldraw](https://tldraw.dev/)
whiteboard in a dark-themed modal. It's lazy-loaded, so tldraw is only downloaded the
first time you open it, and drawings persist in the browser (IndexedDB). tldraw runs in
development mode for free, but production deployments need a
[license key](https://tldraw.dev/pricing). Put it in `.env.local` as
`VITE_TLDRAW_LICENSE_KEY=...` before building.

The UI has tabs (`#sandwich`, `#cult`, `#chaos`), one per Jev primitive:

| Tab | Primitive | Backend |
| --- | --- | --- |
| Sandwich | Noul (yes/no probabilities) | `sandwich.py`, `POST /api/classify` |
| Cult | Score (ordered levels + distribution) | `cult.py`, `POST /api/cult/score` |
| Chaos | Choice (pick one) + Noul + Score fan-out | `chaos.py`, `POST /api/chaos/route` |

- `app.py`: FastAPI + Pydantic backend
- `web/`: the React + TypeScript app (`src/views/` has one component per tab, `src/api.ts` has the typed API contract, `src/Whiteboard.tsx` is the tldraw modal)
- `web/dist/`: the build output FastAPI serves (git-ignored)
- Chaos tab: the auto-route confidence threshold is adjustable in the browser and flips the decision without calling Jev again.
- Cult tab: weights are adjustable in the browser and recompute the index without calling Jev again.

## Debug in VS Code

Open the folder, then use **Run and Debug** and pick:

- **Web UI: build + FastAPI (debug)**: sets everything up, builds the UI, starts the
  API with the debugger attached and opens http://127.0.0.1:8000
- **Full stack: FastAPI + Vite (hot reload)**: runs setup, then the API and the Vite
  dev server together (the browser opens on port 5173; stopping one stops both)
- **Sandwich: built-in examples** / **Sandwich: custom foods** (prompts for a food): the CLI demo

Each one runs the **Setup** task first (`scripts/setup.sh`), so a fresh clone works
without any manual steps. Python launches use `.venv` and load `TYPESAFE_API_KEY` from `.env`.
The tasks are also available from **Terminal → Run Task**.

## Tuning

Edit `verdict()` in `sandwich.py` to change the weights and the 0.35 / 0.65
thresholds, or add questions to `QUESTIONS`.
