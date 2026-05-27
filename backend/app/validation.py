"""UNDP core field validation."""

from fastapi import HTTPException

VALID_DAMAGE = frozenset({"minimal", "partial", "complete"})
VALID_INFRA = frozenset(
    {
        "residential",
        "commercial",
        "government",
        "utility",
        "transport_communication",
        "community",
        "public_recreation",
        "other",
    }
)
VALID_CRISIS = frozenset(
    {
        "earthquake",
        "flood",
        "tsunami",
        "hurricane_cyclone",
        "wildfire",
        "explosion",
        "chemical",
        "conflict",
        "civil_unrest",
    }
)
# Keep in sync with frontend/src/config/questionnaire.ts DESCRIPTION_LANGUAGES
VALID_DESC_LANG = frozenset({"en", "zh", "zh-Hant", "de", "pt", "ar", "fr", "ru", "es"})
VALID_SITE_STATUS = frozenset({"affected", "repaired", "demolished"})


def site_status_from_appendix(appendix: dict | None) -> str:
    raw = (appendix or {}).get("site_status", "affected")
    return raw if raw in VALID_SITE_STATUS else "affected"


def validate_report_payload(
    damage_level: str,
    infrastructure_types: list[str],
    crisis_types: list[str],
    description_language: str,
    infrastructure_name: str,
) -> None:
    if damage_level not in VALID_DAMAGE:
        raise HTTPException(status_code=422, detail=f"Invalid damage_level: {damage_level}")
    if not infrastructure_types:
        raise HTTPException(status_code=422, detail="infrastructure_types required")
    bad_infra = [t for t in infrastructure_types if t not in VALID_INFRA]
    if bad_infra:
        raise HTTPException(status_code=422, detail=f"Invalid infrastructure_types: {bad_infra}")
    if not crisis_types:
        raise HTTPException(status_code=422, detail="crisis_types required")
    bad_crisis = [t for t in crisis_types if t not in VALID_CRISIS]
    if bad_crisis:
        raise HTTPException(status_code=422, detail=f"Invalid crisis_types: {bad_crisis}")
    if description_language not in VALID_DESC_LANG:
        raise HTTPException(status_code=422, detail=f"Invalid description_language: {description_language}")
    if not infrastructure_name or not infrastructure_name.strip():
        raise HTTPException(status_code=422, detail="infrastructure_name required")
