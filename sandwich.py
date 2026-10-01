"""Is it a sandwich? A small Jev demo.

Jev answers narrow yes/no questions (Nouls) about each food. Our code owns the
policy that turns those probabilities into a verdict.

    export TYPESAFE_API_KEY=...
    python sandwich.py                 # run the built-in examples
    python sandwich.py "gyro" "pizza"  # or pass your own foods
"""
import asyncio
import sys

from typesafe_sdk import AsyncTypeSafeClient, Noul

FOODS = ["BLT", "hot dog", "burrito", "pop-tart", "pizza", "open-faced tuna melt",
         "hamburger", "ice cream sandwich", "taco", "cheese sandwich"]

# Independent properties, asked together in a single request.
QUESTIONS = {
    "bread": Noul(
        instructions="Does `food` contain bread (sliced bread, a bun, a roll, or similar baked bread) as its casing?",
        criteria={
            "true": "Made with sliced bread, a bun, roll, baguette, or similar bread",
            "false": "No bread: tortilla, pastry, dough crust, cookie, or no wrapper at all",
        },
    ),
    "filling": Noul(
        instructions="Does `food` have a distinct filling placed between or on top of its bread or bread-like pieces?"
    ),
    "two_pieces": Noul(
        instructions="Is `food` built from two or more separate pieces of bread-like casing, rather than a single folded or rolled piece?"
    ),
    "handheld": Noul(instructions="Is `food` normally eaten by hand?"),
    "sandwich_by_name": Noul(
        instructions="Would most people, at a casual lunch counter, simply call `food` a sandwich?"
    ),
}


STRUCTURAL_WEIGHT, NAME_WEIGHT = 0.6, 0.4
SANDWICH_AT, NOT_SANDWICH_AT = 0.65, 0.35


def explain(p: dict[str, float]) -> dict:
    """Code owns the policy: structural definition plus common-usage signal."""
    pieces = max(p["two_pieces"], 0.5)  # a single folded piece is only a mild penalty
    structural = p["bread"] * p["filling"] * p["handheld"] * pieces
    score = STRUCTURAL_WEIGHT * structural + NAME_WEIGHT * p["sandwich_by_name"]
    if score >= SANDWICH_AT:
        label = "SANDWICH"
    elif score <= NOT_SANDWICH_AT:
        label = "NOT A SANDWICH"
    else:
        label = "CONTESTED"
    return {"label": label, "score": score, "structural": structural, "pieces_factor": pieces}


def verdict(p: dict[str, float]) -> tuple[str, float]:
    r = explain(p)
    return r["label"], r["score"]


async def classify(client: AsyncTypeSafeClient, food: str) -> None:
    resp = await client.system_one(state={"food": food}, questions=QUESTIONS)
    p = {k: resp.nouls[k].noul for k in QUESTIONS}
    label, score = verdict(p)
    signals = "  ".join(f"{k}={v:.2f}" for k, v in p.items())
    print(f"{food:24} -> {label} ({score:.2f})\n{'':27}{signals}\n")


async def main() -> None:
    foods = sys.argv[1:] or FOODS
    async with AsyncTypeSafeClient() as client:  # reads TYPESAFE_API_KEY
        await asyncio.gather(*(classify(client, f) for f in foods))


if __name__ == "__main__":
    asyncio.run(main())
