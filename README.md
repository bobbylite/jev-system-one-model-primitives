# Jev System One model primitives

Three demos of [Jev](https://docs.typesafe.ai/introduction) from TypeSafe, one per
primitive: **Noul** (is it a sandwich?), **Score** (how much of a cult is it?) and
**Choice** (route the chaos). Jev returns typed judgments and probabilities; plain
code owns the policy that turns them into decisions.

The original CLI version of the sandwich demo is `sandwich.py`. A web UI covering all three is below.

## Setup

```sh
python3 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env   # then put your key from https://console.typesafe.ai/ in .env
```

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

A dark, flat single-page UI (static HTML) backed by FastAPI. It shows every
signal Jev returned, the criteria behind each question, and the math the code
used to reach the verdict.

```sh
uv sync                                  # or: .venv/bin/pip install -e .
set -a; source .env; set +a
uv run uvicorn app:app --reload          # http://127.0.0.1:8000
```

The UI has tabs (`#sandwich`, `#cult`), one per Jev primitive:

| Tab | Primitive | Backend |
| --- | --- | --- |
| Sandwich | Noul (yes/no probabilities) | `sandwich.py`, `POST /api/classify` |
| Cult | Score (ordered levels + distribution) | `cult.py`, `POST /api/cult/score` |
| Chaos | Choice (pick one) + Noul + Score fan-out | `chaos.py`, `POST /api/chaos/route` |

- `app.py`: FastAPI + Pydantic backend
- `static/`: `index.html` shell, `style.css`, and one JS file per tab. No build step.
- Chaos tab: the auto-route confidence threshold is adjustable in the browser and flips the decision without calling Jev again.
- Cult tab: weights are adjustable in the browser and recompute the index without calling Jev again.

## Debug in VS Code

Open the folder, then use **Run and Debug** and pick:

- **Sandwich: built-in examples**
- **Sandwich: custom foods** (prompts for a food)
- **Web UI: FastAPI (debug)** (serves the UI on port 8000)

Both use `.venv` and load `TYPESAFE_API_KEY` from `.env`.

## Tuning

Edit `verdict()` in `sandwich.py` to change the weights and the 0.35 / 0.65
thresholds, or add questions to `QUESTIONS`.
