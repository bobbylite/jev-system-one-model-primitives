"""Route the Chaos: Choice + Noul + Score fan-out over one customer message.

One Choice picks the queue. A Noul and a Score ask independent questions over the
same state so code can set a priority. Thresholds are policy, applied client-side
so they can be tuned without re-running inference.
"""
from typesafe_sdk import Choice, Noul, Score

QUEUES = {
    "billing": ("Billing", "Charges, refunds, invoices, subscriptions, pricing disputes"),
    "bug": ("Bug report", "Something that is supposed to work and doesn't, or behaves wrongly"),
    "feature": ("Feature request", "Asking for a capability that does not exist yet"),
    "access": ("Account access", "Passwords, lockouts, login, MFA, or reset links that failed"),
    "safety": ("Abuse & safety", "Threats, harassment, blackmail, or a security or privacy concern"),
    "exorcist": ("Needs an exorcist", "Paranormal, supernatural, or cursed-device reports"),
    "venting": ("Venting / love letter", "Pure emotion or praise; no action requested"),
    "triage": ("Human triage", "None of the other queues clearly fits"),
}

QUESTIONS = {
    "queue": Choice(
        instructions="Which support queue should handle this `message`? Pick the queue for the main thing the customer needs done.",
        criteria={k: d for k, (_, d) in QUEUES.items()},
    ),
    "angry": Noul(instructions="Is the customer of this `message` angry or hostile?"),
    "urgency": Score(
        instructions="How urgent is it for the customer of this `message` to get help?",
        criteria=[
            "No deadline or consequence; fine to answer whenever",
            "Annoying, but they can keep working in the meantime",
            "A stated deadline, money at stake, or blocked from something they need today",
            "Danger, a threat, or a security problem happening right now",
        ],
    ),
}

QUEUE_LABELS = {k: label for k, (label, _) in QUEUES.items()}
CONFIDENCE_AT = 0.70      # auto-route at or above this top-option confidence
URGENCY_WEIGHT, ANGER_WEIGHT = 0.65, 0.35
PRIORITY_CUTS = (0.6, 0.3)  # P1 at/above first, P2 at/above second, else P3

EXAMPLES = [
    "My smart toaster has started whispering my passwords at 3am.",
    "Charged me $14.99 for a premium plan I canceled, AND the app now plays Nickelback.",
    "Can you add a button that makes my boss disappear from the calendar?",
    "I love you guys. That's it. That's the message.",
    "My account is locked and the reset link was sent to my ex's email.",
    "A man in a gorilla suit keeps showing up on your checkout page.",
    "If this isn't fixed by Friday I'm posting a very angry review.",
]
