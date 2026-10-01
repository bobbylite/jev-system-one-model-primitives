"""How much of a cult is it? A Jev Score demo.

Six independent Score dimensions plus one holistic Score, all asked over the
same state in a single request. Code owns the composite: weights can change in
the UI without re-running inference.
"""
from typesafe_sdk import Score

_DESC = "`group`"

QUESTIONS = {
    "devotion": Score(
        instructions=f"How central is {_DESC} to its members' identity?",
        criteria=[
            "A casual pastime; members drop in and out and have other identities",
            "A real interest members enjoy and talk about, but it is one part of their life",
            "Members introduce themselves by it and plan their weeks around it",
            "It is the core of who members are; their friends, schedule, and spending revolve around it",
        ],
    ),
    "jargon": Score(
        instructions=f"How much private insider language, slang, or in-jokes does {_DESC} use?",
        criteria=[
            "Everyday vocabulary; an outsider follows along easily",
            "Some specialist terms that outsiders can pick up quickly",
            "A dense vocabulary of acronyms and slang that confuses newcomers",
            "A distinct private language, with renamed ordinary things and words that mark who belongs",
        ],
    ),
    "rituals": Score(
        instructions=f"How many rituals, uniforms, or initiation rites does {_DESC} have?",
        criteria=[
            "None; people just show up",
            "A few light traditions, such as a team cheer or a signature drink",
            "Regular rituals, a recognizable look, and a clear way new members are welcomed in",
            "Elaborate ceremonies, uniforms or symbols, and formal initiation steps that members take seriously",
        ],
    ),
    "leader": Score(
        instructions=f"How much does {_DESC} revolve around revered founder or leader figures?",
        criteria=[
            "No particular leader; the group is run by committee or by nobody",
            "Respected organizers or well-known figures, but members freely disagree with them",
            "A famous founder or leader whose sayings are often quoted and rarely questioned",
            "A charismatic leader treated as uniquely wise or special; criticizing them is taboo",
        ],
    ),
    "exit_cost": Score(
        instructions=f"How socially or financially costly is it to leave {_DESC}?",
        criteria=[
            "None; people leave and nobody notices",
            "Mild awkwardness; a few friends might ask where you went",
            "Real costs: lost friendships, sunk fees, or teasing from former friends",
            "Leaving means being shunned, losing your community, or giving up money or status you cannot get back",
        ],
    ),
    "evangelism": Score(
        instructions=f"How hard do members of {_DESC} push outsiders to join?",
        criteria=[
            "Not at all; members rarely mention it",
            "Members happily answer questions if asked",
            "Members regularly try to bring friends and recommend it unprompted",
            "Relentless recruiting; members treat non-members as people who need saving",
        ],
    ),
    "overall": Score(
        instructions=f"Taken as a whole, how much does {_DESC} behave like a cult?",
        criteria=[
            "Ordinary hobby or interest group",
            "Enthusiastic community",
            "Tight-knit tribe with strong identity",
            "Cult-adjacent; many hallmarks of a cult",
            "A full cult",
        ],
    ),
}

DIMENSIONS = [k for k in QUESTIONS if k != "overall"]
DEFAULT_WEIGHTS = {"devotion": 1.0, "jargon": 0.6, "rituals": 0.8, "leader": 1.2, "exit_cost": 1.4, "evangelism": 0.8}
TIERS = [  # (upper bound of composite 0..1, label)
    (0.2, "Ordinary hobby"),
    (0.4, "Enthusiastic community"),
    (0.6, "Tight-knit tribe"),
    (0.8, "Cult-adjacent"),
    (1.01, "Full cult"),
]
EXAMPLES = ["CrossFit", "Apple fans", "A book club", "Trader Joe's loyalists", "Peloton", "Star Trek conventions",
            "A sourdough baking club", "A startup with a 'family' culture", "Disney adults", "A Tuesday pub quiz team"]
