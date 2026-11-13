"""Live analytics (blueprint §4.5; ADR-019). Pure functions over DTO-shaped rows,
so every number can be reconciled with its source items.

Definitions (same as Demo Mode, apps/dashboard/src/domain/analytics.ts):
  * an incident is in range when detectedAt (else openedAt) is in [from, to];
  * MTTA = mean(acknowledgedAt - detectedAt) over acknowledged incidents only;
  * MTTR = mean(verifiedHealthyAt - detectedAt) over verified incidents only,
    never runbook completion; excluded incidents are counted, not dropped;
  * median when n >= 3, p90 (nearest rank) when n >= 10;
  * runbook outcomes: SUCCEEDED / FAILED / REJECTED requests of in-range
    incidents (pending or running ones have no outcome yet);
  * recoveries: how each verified recovery was proven, from HEALTH_VERIFIED
    evidence (a remediation requestId, or a self-heal afterClear);
  * availability: healthy probes / probes received in range (Nginx over HTTP,
    not EC2 running); absent when there are no probes, never 0 or 100 %;
    coverage = probes received / minutes in range.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
ACTIVE = ("OPEN", "ACKNOWLEDGED", "INVESTIGATING", "AWAITING_APPROVAL", "REMEDIATING", "VERIFYING", "ESCALATED")
MAX_RANGE = timedelta(days=92)
PROBE_INTERVAL = timedelta(minutes=1)
LOW_COVERAGE = 0.9


class RangeError(ValueError):
    pass


def parse(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise RangeError("Timestamps must include a UTC offset, e.g. 2026-11-13T00:00:00Z.")
    return dt.astimezone(UTC)


def iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_range(raw_from: Any, raw_to: Any, now: datetime) -> tuple[datetime, datetime]:
    """Defaults to the last 30 days. At most 92 days; `to` at most 5 min ahead."""
    try:
        to = parse(str(raw_to)) if raw_to else now
        frm = parse(str(raw_from)) if raw_from else to - timedelta(days=30)
    except ValueError as err:
        raise RangeError(str(err) if isinstance(err, RangeError) else "from and to must be ISO-8601 UTC.") from err
    if frm >= to:
        raise RangeError("from must be before to.")
    if to - frm > MAX_RANGE:
        raise RangeError("The range can be at most 92 days.")
    if to > now + timedelta(minutes=5):
        raise RangeError("to cannot be in the future.")
    return frm, to


def js_round(x: float) -> int:
    """Math.round semantics (halves up), so Live and Demo agree to the second;
    Python's round() rounds halves to even."""
    return math.floor(x + 0.5)


def _percentile(sorted_values: list[float], q: float) -> float:
    """Nearest-rank percentile (q in (0, 1])."""
    return sorted_values[max(0, math.ceil(q * len(sorted_values)) - 1)]


def mean_duration(incidents: Iterable[Mapping[str, Any]], end_field: str) -> dict[str, Any]:
    rows = list(incidents)
    durations: list[float] = []
    for i in rows:
        start, stop = i.get("detectedAt"), i.get(end_field)
        if start and stop:
            durations.append((parse(stop) - parse(start)).total_seconds())
    out: dict[str, Any] = {"count": len(durations), "excluded": len(rows) - len(durations)}
    if not durations:
        return out
    durations.sort()
    out["meanSeconds"] = js_round(sum(durations) / len(durations))
    if len(durations) >= 3:
        mid = len(durations) // 2
        median = durations[mid] if len(durations) % 2 else (durations[mid - 1] + durations[mid]) / 2
        out["medianSeconds"] = js_round(median)
    if len(durations) >= 10:
        out["p90Seconds"] = js_round(_percentile(durations, 0.9))
    return out


def compute(
    incidents: Iterable[Mapping[str, Any]],
    remediations: Iterable[Mapping[str, Any]],
    evidence: Mapping[str, Mapping[str, Any]],
    probes: Mapping[str, int] | None,
    frm: datetime,
    to: datetime,
) -> dict[str, Any]:
    """`evidence`: incidentId -> HEALTH_VERIFIED detail. `probes`:
    {"healthy": n, "total": n}, or None when the metric could not be read."""
    in_range = [
        i for i in incidents if (stamp := i.get("detectedAt") or i.get("openedAt")) and frm <= parse(str(stamp)) <= to
    ]
    by_severity = dict.fromkeys(SEVERITIES, 0)
    for i in in_range:
        if i.get("severity") in by_severity:
            by_severity[i["severity"]] += 1

    ids = {i["id"] for i in in_range}
    runbooks = {"succeeded": 0, "failed": 0, "rejected": 0, "total": 0}
    for r in remediations:
        if r.get("incidentId") not in ids:
            continue
        key = {"SUCCEEDED": "succeeded", "FAILED": "failed", "REJECTED": "rejected"}.get(str(r.get("status")))
        if key:
            runbooks[key] += 1
            runbooks["total"] += 1

    verified = [i for i in in_range if i.get("verifiedHealthyAt")]
    recoveries = {"afterRunbook": 0, "selfHealed": 0, "unknown": 0}
    for i in verified:
        detail = evidence.get(i["id"]) or {}
        if detail.get("requestId"):
            recoveries["afterRunbook"] += 1
        elif detail.get("afterClear"):
            recoveries["selfHealed"] += 1
        else:
            recoveries["unknown"] += 1

    out: dict[str, Any] = {
        "from": iso(frm),
        "to": iso(to),
        "incidentCount": len(in_range),
        "bySeverity": by_severity,
        "active": sum(1 for i in in_range if i.get("state") in ACTIVE),
        "escalated": sum(1 for i in in_range if i.get("state") == "ESCALATED"),
        "mtta": mean_duration(in_range, "acknowledgedAt"),
        "mttr": mean_duration(in_range, "verifiedHealthyAt"),
        "runbooks": runbooks,
        "recoveries": recoveries,
    }

    notes: list[str] = []
    expected = max(1, int((to - frm) / PROBE_INTERVAL))
    if probes is None:
        notes.append("Availability is unknown: the probe metric could not be read.")
    elif probes.get("total", 0) == 0:
        notes.append("Availability is unknown: no health probes ran in this range (the lab was not deployed).")
    else:
        out["availability"] = {
            "healthyProbes": int(probes["healthy"]),
            "totalProbes": int(probes["total"]),
            "expectedProbes": expected,
        }
        coverage = probes["total"] / expected
        if coverage < LOW_COVERAGE:
            notes.append(
                f"Probes cover {'less than 1%' if coverage < 0.01 else f'{coverage:.0%}'} of this range; "
                "minutes without a probe are unknown, "
                "not counted as up or down."
            )
    if out["mtta"]["excluded"]:
        notes.append(f"{out['mtta']['excluded']} incident(s) were never acknowledged and are excluded from MTTA.")
    if out["mttr"]["excluded"]:
        notes.append(f"{out['mttr']['excluded']} incident(s) have no verified recovery and are excluded from MTTR.")
    if recoveries["unknown"]:
        notes.append(f"{recoveries['unknown']} verified recovery(ies) have no recorded evidence type.")
    out["dataQuality"] = notes
    return out
