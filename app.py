"""FastAPI backend: exposes everything Jev used to decide, for the UI.

    uv run uvicorn app:app --reload
"""
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typesafe_sdk import AsyncTypeSafeClient, JSONContent

import chaos
import cult
import sandwich

STATIC = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncTypeSafeClient() as client:  # reads TYPESAFE_API_KEY
        app.state.client = client
        yield


app = FastAPI(title="Is it a sandwich?", lifespan=lifespan)


class ClassifyRequest(BaseModel):
    food: str = Field(min_length=1, max_length=80)


class CultRequest(BaseModel):
    group: str = Field(min_length=1, max_length=80)


class Signal(BaseModel):
    id: str
    instructions: str
    true_criterion: str | None
    false_criterion: str | None
    probability: float


class Verdict(BaseModel):
    food: str
    label: str
    score: float
    structural: float
    pieces_factor: float
    latency_ms: int
    signals: list[Signal]


class Policy(BaseModel):
    structural_weight: float
    name_weight: float
    sandwich_at: float
    not_sandwich_at: float


def _text(content: JSONContent | None) -> str | None:
    """Question text may be a string or structured JSON; the UI shows it as text."""
    if content is None or isinstance(content, str):
        return content
    return json.dumps(content)


def _signal(qid: str, prob: float) -> Signal:
    q = sandwich.QUESTIONS[qid]
    crit = q.criteria or {}
    return Signal(id=qid, instructions=_text(q.instructions) or "", true_criterion=_text(crit.get("true")),
                  false_criterion=_text(crit.get("false")), probability=prob)


@app.get("/api/config")
async def config():
    return {
        "examples": sandwich.FOODS,
        "policy": Policy(structural_weight=sandwich.STRUCTURAL_WEIGHT, name_weight=sandwich.NAME_WEIGHT,
                         sandwich_at=sandwich.SANDWICH_AT, not_sandwich_at=sandwich.NOT_SANDWICH_AT),
        "questions": [_signal(k, 0).model_dump(exclude={"probability"}) for k in sandwich.QUESTIONS],
    }


@app.post("/api/classify", response_model=Verdict)
async def classify(req: ClassifyRequest):
    food = req.food.strip()
    start = time.perf_counter()
    try:
        resp = await app.state.client.system_one(state={"food": food}, questions=sandwich.QUESTIONS)
    except Exception as e:  # surface service errors to the UI
        raise HTTPException(502, f"Jev request failed: {e}") from e
    latency = int((time.perf_counter() - start) * 1000)
    p = {k: resp.nouls[k].noul for k in sandwich.QUESTIONS}
    r = sandwich.explain(p)
    return Verdict(food=food, latency_ms=latency, signals=[_signal(k, v) for k, v in p.items()], **r)


class Level(BaseModel):
    level: int
    description: str
    probability: float


class Dimension(BaseModel):
    id: str
    instructions: str
    score: float
    max_level: int
    confidence: float
    levels: list[Level]


class CultResult(BaseModel):
    group: str
    dimensions: list[Dimension]
    overall: Dimension
    latency_ms: int


@app.get("/api/cult/config")
async def cult_config():
    return {
        "examples": cult.EXAMPLES,
        "weights": cult.DEFAULT_WEIGHTS,
        "tiers": [{"max": m, "label": l} for m, l in cult.TIERS],
        "dimensions": [{"id": k, "instructions": cult.QUESTIONS[k].instructions} for k in cult.DIMENSIONS],
    }


def _dimension(qid: str, ans) -> Dimension:
    q = cult.QUESTIONS[qid]
    probs = {int(k): v for k, v in ans.probabilities.items()}
    levels = [Level(level=i, description=str(d), probability=probs.get(i, 0.0)) for i, d in enumerate(q.criteria)]
    return Dimension(id=qid, instructions=_text(q.instructions) or "", score=ans.score, max_level=len(q.criteria) - 1,
                     confidence=ans.confidence, levels=levels)


@app.post("/api/cult/score", response_model=CultResult)
async def cult_score(req: CultRequest):
    group = req.group.strip()
    start = time.perf_counter()
    try:
        resp = await app.state.client.system_one(state={"group": group}, questions=cult.QUESTIONS)
    except Exception as e:
        raise HTTPException(502, f"Jev request failed: {e}") from e
    latency = int((time.perf_counter() - start) * 1000)
    dims = {k: _dimension(k, resp.scores[k]) for k in cult.QUESTIONS}
    return CultResult(group=group, dimensions=[dims[k] for k in cult.DIMENSIONS], overall=dims["overall"], latency_ms=latency)


class ChaosRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class Option(BaseModel):
    id: str
    label: str
    description: str
    probability: float


class ChaosResult(BaseModel):
    message: str
    options: list[Option]
    choice: str
    confidence: float
    angry: float
    urgency: float
    urgency_max: int
    latency_ms: int


@app.get("/api/chaos/config")
async def chaos_config():
    return {
        "examples": chaos.EXAMPLES,
        "confidence_at": chaos.CONFIDENCE_AT,
        "urgency_weight": chaos.URGENCY_WEIGHT,
        "anger_weight": chaos.ANGER_WEIGHT,
        "priority_cuts": chaos.PRIORITY_CUTS,
        "urgency_legend": [str(c) for c in chaos.QUESTIONS["urgency"].criteria],
        "queues": [{"id": k, "label": l, "description": d} for k, (l, d) in chaos.QUEUES.items()],
        "questions": {k: q.instructions for k, q in chaos.QUESTIONS.items()},
    }


@app.post("/api/chaos/route", response_model=ChaosResult)
async def chaos_route(req: ChaosRequest):
    message = req.message.strip()
    start = time.perf_counter()
    try:
        resp = await app.state.client.system_one(state={"message": message}, questions=chaos.QUESTIONS)
    except Exception as e:
        raise HTTPException(502, f"Jev request failed: {e}") from e
    latency = int((time.perf_counter() - start) * 1000)
    ch = resp.choices["queue"]
    options = [Option(id=k, label=l, description=d, probability=ch.probabilities.get(k, 0.0))
               for k, (l, d) in chaos.QUEUES.items()]
    options.sort(key=lambda o: -o.probability)
    return ChaosResult(message=message, options=options, choice=ch.choice, confidence=ch.confidence,
                       angry=resp.nouls["angry"].noul, urgency=resp.scores["urgency"].score,
                       urgency_max=len(chaos.QUESTIONS["urgency"].criteria) - 1, latency_ms=latency)


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
