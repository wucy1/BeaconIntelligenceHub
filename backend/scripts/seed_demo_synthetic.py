#!/usr/bin/env python3
"""Wipe non-system demo data and seed synthetic crises / footprints / reports.

Keeps: unspecified crisis, ops_users, org settings (if present).
Deletes: other crises (cascade buildings/zones/reports), orphan report graphs,
         saved queries, audit log, zone/crisis assignments.

Usage (from backend/, with DATABASE_URL in .env pointing at the demo DB):

  python scripts/seed_demo_synthetic.py
  python scripts/seed_demo_synthetic.py --yes

Neon tip: seeding prefers the *direct* host (strips ``-pooler``) because PgBouncer
poolers often drop long script sessions on Windows.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

from app.config import settings  # noqa: E402
from app.db_url import normalize_database_url  # noqa: E402
from app.models import (  # noqa: E402
    Building,
    Crisis,
    CrisisLeadAssignment,
    OpsAuditLog,
    OpsSavedReport,
    OpsUser,
    Report,
    ReportCrisisLink,
    ReportImage,
    UserZoneAssignment,
    Zone,
)


def _pg_text_array(values: list[str]) -> str:
    """Literal for PostgreSQL text[] via CAST(:x AS text[])."""
    escaped = [v.replace("\\", "\\\\").replace('"', '\\"') for v in values]
    return "{" + ",".join(f'"{v}"' for v in escaped) + "}"


UNSPECIFIED_ID = uuid.UUID("a0000000-0000-0000-0000-000000000001")
NOW = datetime.now(timezone.utc)


def _neon_direct_url(url: str) -> str:
    """Prefer Neon direct endpoint over PgBouncer pooler for scripts."""
    u = normalize_database_url(url)
    scheme_prefix = "postgresql+psycopg2://"
    rest = u[len(scheme_prefix) :] if u.startswith(scheme_prefix) else u
    parsed = urlparse("postgresql://" + rest)
    host = parsed.hostname or ""
    if "-pooler." not in host:
        return u
    new_host = host.replace("-pooler.", ".", 1)
    userinfo = ""
    if parsed.username is not None:
        userinfo = parsed.username
        if parsed.password is not None:
            userinfo += f":{parsed.password}"
        userinfo += "@"
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{userinfo}{new_host}{port}"
    rebuilt = urlunparse(("postgresql", netloc, parsed.path, "", parsed.query, ""))
    return normalize_database_url(rebuilt)


def _make_session_factory(database_url: str):
    connect_args: dict = {"connect_timeout": 60}
    if "neon.tech" in database_url:
        connect_args["sslmode"] = "require"
        connect_args["keepalives"] = 1
        connect_args["keepalives_idle"] = 30
    eng = create_engine(
        database_url,
        poolclass=NullPool,
        pool_pre_ping=True,
        connect_args=connect_args,
    )
    return eng, sessionmaker(autocommit=False, autoflush=False, bind=eng)


def _connect_with_retries(SessionLocal, attempts: int = 5):
    last_err: Exception | None = None
    for i in range(1, attempts + 1):
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            return db
        except Exception as exc:  # noqa: BLE001 — retry any connect failure
            last_err = exc
            db.close()
            wait = min(2**i, 20)
            print(f"DB connect failed (attempt {i}/{attempts}): {exc.__class__.__name__}")
            print(f"Retrying in {wait}s…")
            time.sleep(wait)
    assert last_err is not None
    raise last_err


def _poly(coords: list[tuple[float, float]]) -> str:
    ring = ", ".join(f"{lon} {lat}" for lon, lat in coords)
    return f"POLYGON(({ring}))"


def _mpoly(coords: list[tuple[float, float]]) -> str:
    return f"MULTIPOLYGON((({', '.join(f'{lon} {lat}' for lon, lat in coords)})))"


def _point(lon: float, lat: float) -> str:
    return f"POINT({lon} {lat})"


def wipe(db) -> None:
    db.query(ReportCrisisLink).delete(synchronize_session=False)
    db.query(ReportImage).delete(synchronize_session=False)
    db.query(Report).delete(synchronize_session=False)
    db.query(OpsSavedReport).delete(synchronize_session=False)
    db.query(OpsAuditLog).delete(synchronize_session=False)
    db.query(UserZoneAssignment).delete(synchronize_session=False)
    db.query(CrisisLeadAssignment).delete(synchronize_session=False)
    db.query(Zone).delete(synchronize_session=False)
    db.query(Building).delete(synchronize_session=False)
    db.query(Crisis).filter(Crisis.id != UNSPECIFIED_ID).delete(synchronize_session=False)
    db.execute(
        text(
            "UPDATE crises SET archive_status = 'active', "
            "archive_window_start = NULL, archive_window_end = NULL "
            "WHERE id = :id"
        ),
        {"id": str(UNSPECIFIED_ID)},
    )
    db.commit()


def _ensure_unspecified(db) -> None:
    row = db.get(Crisis, UNSPECIFIED_ID)
    if row:
        return
    db.execute(
        text(
            """
            INSERT INTO crises (id, slug, name, bounds, archive_status)
            VALUES (
              :id,
              'unspecified',
              CAST(:name AS jsonb),
              NULL,
              'active'
            )
            """
        ),
        {
            "id": str(UNSPECIFIED_ID),
            "name": (
                '{"en":"Unspecified event (open reporting)",'
                '"zh":"未指定事件（开放回报）",'
                '"zh-Hant":"未指定事件（開放回報）"}'
            ),
        },
    )
    db.commit()


def _insert_crisis(
    db,
    *,
    slug: str,
    name: dict,
    bounds_coords: list[tuple[float, float]],
) -> uuid.UUID:
    cid = uuid.uuid4()
    db.execute(
        text(
            """
            INSERT INTO crises (id, slug, name, bounds, archive_status,
                                archive_window_start, archive_window_end)
            VALUES (
              :id, :slug, CAST(:name AS jsonb),
              ST_GeomFromText(:bounds, 4326),
              'active', :ws, :we
            )
            """
        ),
        {
            "id": str(cid),
            "slug": slug,
            "name": json.dumps(name, ensure_ascii=False),
            "bounds": _poly(bounds_coords),
            "ws": NOW - timedelta(days=45),
            "we": NOW + timedelta(days=15),
        },
    )
    return cid


def _insert_zone(
    db,
    *,
    crisis_id: uuid.UUID,
    name: str,
    description: str,
    coords: list[tuple[float, float]],
) -> uuid.UUID:
    zid = uuid.uuid4()
    db.execute(
        text(
            """
            INSERT INTO zones (id, crisis_id, name, description, geom)
            VALUES (:id, :cid, :name, :desc, ST_GeomFromText(:geom, 4326))
            """
        ),
        {
            "id": str(zid),
            "cid": str(crisis_id),
            "name": name,
            "desc": description,
            "geom": _poly(coords),
        },
    )
    return zid


def _insert_building(
    db,
    *,
    crisis_id: uuid.UUID,
    name: str,
    coords: list[tuple[float, float]],
    external_ref: str,
) -> uuid.UUID:
    bid = uuid.uuid4()
    db.execute(
        text(
            """
            INSERT INTO buildings (id, crisis_id, external_ref, geom, name)
            VALUES (:id, :cid, :ref, ST_GeomFromText(:geom, 4326), :name)
            """
        ),
        {
            "id": str(bid),
            "cid": str(crisis_id),
            "ref": external_ref,
            "geom": _mpoly(coords),
            "name": name,
        },
    )
    return bid


def _square(lon: float, lat: float, half: float = 0.00035) -> list[tuple[float, float]]:
    return [
        (lon - half, lat - half),
        (lon + half, lat - half),
        (lon + half, lat + half),
        (lon - half, lat + half),
        (lon - half, lat - half),
    ]


def _insert_report(
    db,
    *,
    crisis_id: uuid.UUID,
    building_id: uuid.UUID | None,
    lon: float,
    lat: float,
    damage: str,
    infra_types: list[str],
    infra_name: str,
    crisis_types: list[str],
    debris: bool,
    description: str,
    hours_ago: int,
    reviewed: bool = False,
    textual_location: str | None = None,
) -> uuid.UUID:
    rid = uuid.uuid4()
    captured = NOW - timedelta(hours=hours_ago)
    db.execute(
        text(
            """
            INSERT INTO reports (
              id, client_generated_uuid, crisis_id, building_id, geom,
              textual_location, damage_level, infrastructure_types,
              infrastructure_name, crisis_types, debris_clearing_required,
              description, description_language, appendix_answers,
              captured_at_client, received_at_server, admin_reviewed, admin_flagged
            ) VALUES (
              :id, :cgu, :cid, :bid, ST_GeomFromText(:geom, 4326),
              :loc, :dmg, CAST(:itypes AS text[]), :iname, CAST(:ctypes AS text[]), :debris,
              :desc, 'en', CAST('{}' AS jsonb),
              :cap, :recv, :rev, false
            )
            """
        ),
        {
            "id": str(rid),
            "cgu": str(uuid.uuid4()),
            "cid": str(crisis_id),
            "bid": str(building_id) if building_id else None,
            "geom": _point(lon, lat),
            "loc": textual_location,
            "dmg": damage,
            "itypes": _pg_text_array(infra_types),
            "iname": infra_name,
            "ctypes": _pg_text_array(crisis_types),
            "debris": debris,
            "desc": description,
            "cap": captured,
            "recv": captured + timedelta(minutes=3),
            "rev": reviewed,
        },
    )
    return rid


def _link(db, report_id: uuid.UUID, crisis_id: uuid.UUID) -> None:
    db.execute(
        text(
            """
            INSERT INTO report_crisis_links (report_id, crisis_id, link_source)
            VALUES (:rid, :cid, 'batch_archive')
            ON CONFLICT DO NOTHING
            """
        ),
        {"rid": str(report_id), "cid": str(crisis_id)},
    )


def seed(db) -> dict[str, int]:
    _ensure_unspecified(db)

    nyc_bounds = [
        (-74.02, 40.70),
        (-73.97, 40.70),
        (-73.97, 40.74),
        (-74.02, 40.74),
        (-74.02, 40.70),
    ]
    nyc_id = _insert_crisis(
        db,
        slug="demo-nyc-flood-2026",
        name={
            "en": "Demo: NYC coastal flood 2026",
            "zh": "演示：纽约海岸洪水 2026",
            "zh-Hant": "示範：紐約海岸洪水 2026",
        },
        bounds_coords=nyc_bounds,
    )
    nyc_zone = _insert_zone(
        db,
        crisis_id=nyc_id,
        name="Lower Manhattan zone",
        description="Synthetic ops zone for demo archive/browse flows.",
        coords=nyc_bounds,
    )

    nyc_sites = [
        ("Battery Park pavilion", -74.0165, 40.7033),
        ("Financial District block", -74.0105, 40.7078),
        ("South Street warehouse", -74.0038, 40.7062),
        ("Brooklyn Bridge approach", -73.9985, 40.7089),
    ]
    nyc_buildings: list[uuid.UUID] = []
    for i, (name, lon, lat) in enumerate(nyc_sites, start=1):
        nyc_buildings.append(
            _insert_building(
                db,
                crisis_id=nyc_id,
                name=name,
                coords=_square(lon, lat),
                external_ref=f"demo-nyc-{i}",
            )
        )

    nyc_reports = [
        (0, -74.0164, 40.7034, "partial", ["building"], "Battery Park pavilion", ["flood"], True,
         "Synthetic: floodwater entered ground floor; interior damp.", 20, True),
        (1, -74.0104, 40.7077, "complete", ["building", "road"], "Financial District block", ["flood"], True,
         "Synthetic: facade failure and street debris after surge.", 36, True),
        (2, -74.0037, 40.7061, "partial", ["building"], "South Street warehouse", ["flood"], False,
         "Synthetic: basement utilities offline; upper floors usable.", 12, False),
        (3, -73.9986, 40.7088, "minimal", ["road", "bridge"], "Brooklyn Bridge approach", ["flood"], False,
         "Synthetic: standing water on approach lane; traffic slowed.", 8, False),
        (None, -74.0080, 40.7110, "partial", ["power", "telecom"], "Utility cabinet near Fulton", ["flood"], True,
         "Synthetic: outdoor cabinet submerged; outage reported nearby.", 5, False),
        (None, -74.0140, 40.7050, "minimal", ["water_supply"], "Hydrant line — West St", ["flood"], False,
         "Synthetic: minor leak after pressure surge; no collapse.", 48, True),
    ]
    linked = 0
    for bid_i, lon, lat, dmg, types, iname, ctypes, debris, desc, hrs, reviewed in nyc_reports:
        bid = nyc_buildings[bid_i] if isinstance(bid_i, int) else None
        rid = _insert_report(
            db,
            crisis_id=nyc_id if bid else UNSPECIFIED_ID,
            building_id=bid,
            lon=lon,
            lat=lat,
            damage=dmg,
            infra_types=types,
            infra_name=iname,
            crisis_types=ctypes,
            debris=debris,
            description=desc,
            hours_ago=hrs,
            reviewed=reviewed,
            textual_location=iname,
        )
        if bid is not None or reviewed:
            _link(db, rid, nyc_id)
            linked += 1
        elif bid_i is None and hrs <= 12:
            _link(db, rid, nyc_id)
            linked += 1

    mnl_bounds = [
        (120.97, 14.55),
        (121.01, 14.55),
        (121.01, 14.59),
        (120.97, 14.59),
        (120.97, 14.55),
    ]
    mnl_id = _insert_crisis(
        db,
        slug="demo-manila-quake-2026",
        name={
            "en": "Demo: Manila earthquake 2026",
            "zh": "演示：马尼拉地震 2026",
            "zh-Hant": "示範：馬尼拉地震 2026",
        },
        bounds_coords=mnl_bounds,
    )
    mnl_zone = _insert_zone(
        db,
        crisis_id=mnl_id,
        name="Ermita–Malate sample zone",
        description="Synthetic zone covering central Manila demo footprints.",
        coords=mnl_bounds,
    )

    mnl_sites = [
        ("Rizal Park pavilion", 120.9843, 14.5763),
        ("Malate mid-rise", 120.9888, 14.5698),
        ("Ermita clinic annex", 120.9923, 14.5823),
        ("Roxas Blvd arcade", 120.9808, 14.5651),
    ]
    mnl_buildings: list[uuid.UUID] = []
    for i, (name, lon, lat) in enumerate(mnl_sites, start=1):
        mnl_buildings.append(
            _insert_building(
                db,
                crisis_id=mnl_id,
                name=name,
                coords=_square(lon, lat, 0.00035),
                external_ref=f"demo-mnl-{i}",
            )
        )

    mnl_reports = [
        (0, 120.9843, 14.5763, "partial", ["building"], "Rizal Park pavilion", ["earthquake"], True,
         "Synthetic: shear cracks on columns; pavilion closed pending inspection.", 30, True),
        (1, 120.9888, 14.5698, "complete", ["building"], "Malate mid-rise", ["earthquake"], True,
         "Synthetic: soft-story collapse risk; cordon established.", 40, True),
        (2, 120.9923, 14.5823, "minimal", ["building", "health"], "Ermita clinic annex", ["earthquake"], False,
         "Synthetic: fallen ceiling tiles; outpatient services continue.", 18, False),
        (3, 120.9808, 14.5651, "partial", ["building", "commerce"], "Roxas Blvd arcade", ["earthquake"], True,
         "Synthetic: facade tiles fallen onto pedestrian path.", 10, False),
        (None, 120.9950, 14.5750, "minimal", ["road"], "Taft Ave lane closure", ["earthquake"], False,
         "Synthetic: temporary barrier for debris clearance.", 6, False),
    ]
    for bid_i, lon, lat, dmg, types, iname, ctypes, debris, desc, hrs, reviewed in mnl_reports:
        bid = mnl_buildings[bid_i] if isinstance(bid_i, int) else None
        rid = _insert_report(
            db,
            crisis_id=mnl_id if bid else UNSPECIFIED_ID,
            building_id=bid,
            lon=lon,
            lat=lat,
            damage=dmg,
            infra_types=types,
            infra_name=iname,
            crisis_types=ctypes,
            debris=debris,
            description=desc,
            hours_ago=hrs,
            reviewed=reviewed,
            textual_location=iname,
        )
        _link(db, rid, mnl_id)
        linked += 1

    for lon, lat, desc, hrs in [
        (-73.9857, 40.7484, "Synthetic open pin: cracked sidewalk near Empire State area.", 3),
        (120.9842, 14.5995, "Synthetic open pin: cracked masonry near Quiapo; no injuries reported.", 2),
    ]:
        _insert_report(
            db,
            crisis_id=UNSPECIFIED_ID,
            building_id=None,
            lon=lon,
            lat=lat,
            damage="minimal",
            infra_types=["building"],
            infra_name="Open report (demo)",
            crisis_types=["other"],
            debris=False,
            description=desc,
            hours_ago=hrs,
            reviewed=False,
        )

    # Rebuild ops permission edges from existing active users
    _rebuild_permissions(db, crisis_ids=[nyc_id, mnl_id], zone_ids=[nyc_zone, mnl_zone])

    db.commit()
    return {
        "crises": 2,
        "buildings": len(nyc_buildings) + len(mnl_buildings),
        "reports": len(nyc_reports) + len(mnl_reports) + 2,
        "links": linked,
    }


def _rebuild_permissions(
    db,
    *,
    crisis_ids: list[uuid.UUID],
    zone_ids: list[uuid.UUID],
) -> None:
    """Recreate crisis_lead + zone assignments from existing ops_users."""
    admins_leads = (
        db.query(OpsUser)
        .filter(OpsUser.is_active.is_(True), OpsUser.role.in_(("system_admin", "crisis_lead")))
        .all()
    )
    for user in admins_leads:
        for cid in crisis_ids:
            db.execute(
                text(
                    """
                    INSERT INTO crisis_lead_assignments (user_id, crisis_id)
                    VALUES (:uid, :cid)
                    ON CONFLICT DO NOTHING
                    """
                ),
                {"uid": str(user.id), "cid": str(cid)},
            )

    coordinators = (
        db.query(OpsUser)
        .filter(OpsUser.is_active.is_(True), OpsUser.role == "coordinator")
        .all()
    )
    if coordinators:
        for user in coordinators:
            for zid in zone_ids:
                db.execute(
                    text(
                        """
                        INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
                        VALUES (:uid, :zid, 'coordinator')
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"uid": str(user.id), "zid": str(zid)},
                )
    else:
        # Fallback: assign system_admins as zone leads so demos have coverage
        for user in admins_leads:
            if user.role != "system_admin":
                continue
            for zid in zone_ids:
                db.execute(
                    text(
                        """
                        INSERT INTO user_zone_assignments (user_id, zone_id, assignment_role)
                        VALUES (:uid, :zid, 'lead')
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {"uid": str(user.id), "zid": str(zid)},
                )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip interactive confirmation (required for non-interactive runs).",
    )
    parser.add_argument(
        "--keep-pooler",
        action="store_true",
        help="Do not rewrite Neon -pooler host to direct (default: use direct).",
    )
    args = parser.parse_args()

    raw_url = settings.database_url
    url = raw_url if args.keep_pooler else _neon_direct_url(raw_url)
    host_hint = url.split("@")[-1] if "@" in url else url
    print(f"Target database: …@{host_hint}")
    if not args.yes:
        reply = input(
            "This will DELETE existing demo reports/crises "
            "(keep unspecified + ops users). Type YES: "
        )
        if reply.strip() != "YES":
            print("Aborted.")
            return 1

    _engine, SessionLocal = _make_session_factory(url)
    db = None
    try:
        print("Connecting…")
        db = _connect_with_retries(SessionLocal)
        print("Wiping…")
        wipe(db)
        print("Seeding synthetic demo…")
        counts = seed(db)
        print(
            "Done:",
            f"{counts['crises']} crises,",
            f"{counts['buildings']} buildings,",
            f"{counts['reports']} reports,",
            f"{counts['links']} archive links.",
        )
        return 0
    finally:
        if db is not None:
            db.close()
        _engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
