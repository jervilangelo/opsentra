"""Authorization from trusted Cognito claims (blueprint §5.1, §5.2).

API Gateway's JWT authorizer has already verified the token's signature,
issuer, audience/client and expiry before the handler runs. This module turns
the verified claims into a role. It never reads a role, user ID or permission
from the request body, query string or headers.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

Role = Literal["VIEWER", "OPERATOR", "ADMIN"]

ROLE_RANK: dict[Role, int] = {"VIEWER": 0, "OPERATOR": 1, "ADMIN": 2}

# Cognito group name -> role. Only these groups are trusted.
GROUP_TO_ROLE: dict[str, Role] = {
    "viewer": "VIEWER",
    "operator": "OPERATOR",
    "admin": "ADMIN",
}

# §5.2 role matrix, as the actions each role may perform.
_VIEWER_ACTIONS = ("read:live", "read:audit:limited")
_OPERATOR_ACTIONS = _VIEWER_ACTIONS + (
    "incident:acknowledge",
    "incident:investigate",
    "incident:close",
    "remediation:request",
)
_ADMIN_ACTIONS = _OPERATOR_ACTIONS + (
    "remediation:decide",
    "lab:start",
    "lab:reset",
    "read:audit:full",
)

PERMITTED_ACTIONS: dict[Role, tuple[str, ...]] = {
    "VIEWER": _VIEWER_ACTIONS,
    "OPERATOR": _OPERATOR_ACTIONS,
    "ADMIN": _ADMIN_ACTIONS,
}


class AuthError(Exception):
    """Raised when the caller is not authenticated (401) or not allowed (403)."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _parse_groups(raw: Any) -> list[str]:
    """API Gateway passes `cognito:groups` as a string like "[admin operator]"."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(g) for g in raw]
    text = str(raw).strip()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return [g for g in text.replace(",", " ").split() if g]


def claims_from_event(event: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """Verified JWT claims placed in the request context by the authorizer, if any."""
    ctx = event.get("requestContext") or {}
    authorizer = ctx.get("authorizer") or {}
    jwt = authorizer.get("jwt") or {}
    claims = jwt.get("claims")
    return claims if isinstance(claims, Mapping) else None


def role_from_claims(claims: Mapping[str, Any]) -> Role | None:
    """The highest role among the caller's trusted groups, or None."""
    roles = [GROUP_TO_ROLE[g] for g in _parse_groups(claims.get("cognito:groups")) if g in GROUP_TO_ROLE]
    if not roles:
        return None
    return max(roles, key=lambda r: ROLE_RANK[r])


def require_identity(event: Mapping[str, Any]) -> tuple[Mapping[str, Any], Role]:
    """Returns (claims, role) or raises AuthError.

    - No verified claims, or not an access token: 401.
    - Authenticated but in no trusted group: 403.
    """
    claims = claims_from_event(event)
    if not claims or not claims.get("sub"):
        raise AuthError(401, "UNAUTHENTICATED", "Sign in to use this endpoint.")
    if claims.get("token_use") != "access":
        raise AuthError(401, "INVALID_TOKEN", "An access token is required.")
    role = role_from_claims(claims)
    if role is None:
        raise AuthError(403, "FORBIDDEN", "Your account has no Opsentra role.")
    return claims, role


def require_role(actual: Role, required: Role) -> None:
    if ROLE_RANK[actual] < ROLE_RANK[required]:
        raise AuthError(403, "FORBIDDEN", f"This needs the {required.lower()} role.")
