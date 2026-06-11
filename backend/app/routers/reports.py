from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Building, Report, ReportImage
from app.r2_storage import r2_client, r2_enabled, upload_via_api, wait_object_exists
from app.image_urls import thumb_url_for_report
from app.reporter import device_id_header, reporter_hash_from_device
from app.schemas import (
    ReportCreate,
    ReportCreated,
    ReportDetail,
    ReportListResponse,
    ReportSummary,
    ReportUpdate,
)
from app.storage import safe_join
from app.duplicate import find_possible_duplicate
from app.public_classify import apply_auto_classification, get_unspecified_crisis
from app.validation import validate_report_payload

router = APIRouter(prefix="/v1/reports", tags=["reports"])


def _validate_location(payload: ReportCreate) -> None:
    has_building = payload.building_id is not None
    has_geom = payload.geom is not None
    has_text = bool(payload.textual_location and payload.textual_location.strip())
    if not has_building and not has_geom and not has_text:
        raise HTTPException(
            status_code=422,
            detail="Provide building_id, geom, or textual_location",
        )


def _assert_owner(report: Report, x_device_id: str | None) -> None:
    did = device_id_header(x_device_id)
    if not did:
        raise HTTPException(status_code=401, detail="X-Device-Id required")
    expected = reporter_hash_from_device(did)
    if report.reporter_hash != expected:
        raise HTTPException(status_code=403, detail="Not your report")


@router.post("", response_model=ReportCreated, status_code=201)
def create_report(
    payload: ReportCreate,
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
) -> ReportCreated:
    _validate_location(payload)
    validate_report_payload(
        payload.damage_level,
        payload.infrastructure_types,
        payload.crisis_types,
        payload.description_language,
        payload.infrastructure_name,
    )

    unspecified = get_unspecified_crisis(db)
    existing = (
        db.query(Report)
        .filter(
            Report.crisis_id == unspecified.id,
            Report.client_generated_uuid == payload.client_generated_uuid,
        )
        .first()
    )
    if existing:
        return ReportCreated(
            report_id=existing.id,
            received_at_server=existing.received_at_server,
            possible_duplicate=False,
        )

    storage_crisis_id = unspecified.id

    if payload.building_id:
        b = db.query(Building).filter(Building.id == payload.building_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="Building not found")

    if r2_enabled(settings):
        if not upload_via_api(settings):
            client = r2_client(settings)
            if not wait_object_exists(client, settings.r2_bucket, payload.image.objectKey):
                raise HTTPException(
                    status_code=400,
                    detail="Image not uploaded (object key missing on server). Retry sync or check R2 CORS for PUT.",
                )
    else:
        base = Path(settings.storage_path)
        img_path = safe_join(base, payload.image.objectKey)
        if not img_path.is_file():
            raise HTTPException(status_code=400, detail="Image not uploaded (object key missing on server)")

    geom_col = None
    if payload.geom:
        try:
            g = shape(payload.geom)
            if g.geom_type != "Point":
                raise HTTPException(status_code=422, detail="geom must be a Point")
            geom_col = from_shape(g, srid=4326)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid geom: {exc}") from exc

    now = datetime.now(timezone.utc)
    did = device_id_header(x_device_id)
    reporter_hash = reporter_hash_from_device(did) if did else None
    prior_dup = find_possible_duplicate(
        db,
        crisis_id=storage_crisis_id,
        building_id=payload.building_id,
        reporter_hash=reporter_hash,
        before=now,
    )
    report = Report(
        client_generated_uuid=payload.client_generated_uuid,
        crisis_id=storage_crisis_id,
        building_id=payload.building_id,
        geom=geom_col,
        textual_location=payload.textual_location,
        damage_level=payload.damage_level,
        infrastructure_types=payload.infrastructure_types,
        infrastructure_name=payload.infrastructure_name,
        crisis_types=payload.crisis_types,
        debris_clearing_required=payload.debris_clearing_required,
        description=payload.description,
        description_language=payload.description_language,
        appendix_answers=payload.appendix_answers,
        captured_at_client=payload.captured_at_client,
        received_at_server=now,
        reporter_hash=reporter_hash,
    )
    db.add(report)
    db.flush()

    ri = ReportImage(
        report_id=report.id,
        object_key=payload.image.objectKey,
        mime_type=payload.image.mimeType,
        width=payload.image.width,
        height=payload.image.height,
        checksum_sha256=payload.image.checksumSha256,
    )
    db.add(ri)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        err = str(getattr(exc, "orig", exc))
        raise HTTPException(status_code=500, detail=f"Report constraint error: {err}") from exc
    db.refresh(report)
    try:
        apply_auto_classification(
            db,
            report_id=report.id,
            geom_geojson=payload.geom,
            building_id=payload.building_id,
            captured_at=payload.captured_at_client,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[BIH] auto_classify best-effort failed for {report.id}: {exc}")
    return ReportCreated(
        report_id=report.id,
        received_at_server=report.received_at_server,
        possible_duplicate=bool(prior_dup),
    )


def _geom_json(db: Session, report_id: UUID, building_id: UUID | None = None):
    gj = db.execute(
        text("SELECT ST_AsGeoJSON(geom)::json FROM reports WHERE id = :id AND geom IS NOT NULL"),
        {"id": report_id},
    ).scalar_one_or_none()
    if gj is not None:
        return gj
    if building_id:
        return db.execute(
            text(
                """
                SELECT ST_AsGeoJSON(ST_Centroid(geom))::json
                FROM buildings WHERE id = :bid
                """
            ),
            {"bid": building_id},
        ).scalar_one_or_none()
    return None


@router.get("", response_model=ReportListResponse)
def list_reports(
    crisis_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> ReportListResponse:
    rows = (
        db.query(Report)
        .filter(Report.crisis_id == crisis_id)
        .order_by(Report.received_at_server.desc())
        .limit(limit)
        .all()
    )
    items = [_row_to_summary(db, r) for r in rows]
    return ReportListResponse(items=items, nextCursor=None)


def _row_to_summary(db: Session, r: Report) -> ReportSummary:
    gj = _geom_json(db, r.id, r.building_id)
    return ReportSummary(
        id=r.id,
        crisis_id=r.crisis_id,
        building_id=r.building_id,
        damage_level=r.damage_level,
        captured_at_client=r.captured_at_client,
        received_at_server=r.received_at_server,
        geom=gj,
        description_preview=r.description[:120] + ("…" if len(r.description) > 120 else ""),
    )


@router.get("/latest", response_model=ReportListResponse)
def list_latest_reports(
    crisis_id: UUID,
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> ReportListResponse:
    """Latest effective report per building (UNDP versioning bias)."""
    ids = db.execute(
        text(
            """
            SELECT id FROM latest_report_per_building
            WHERE crisis_id = :cid
            ORDER BY received_at_server DESC
            LIMIT :lim
            """
        ),
        {"cid": str(crisis_id), "lim": limit},
    ).scalars().all()
    if not ids:
        return ReportListResponse(items=[], nextCursor=None)
    rows = db.query(Report).filter(Report.id.in_(list(ids))).all()
    row_map = {r.id: r for r in rows}
    items = [_row_to_summary(db, row_map[i]) for i in ids if i in row_map]
    return ReportListResponse(items=items, nextCursor=None)


@router.get("/{report_id}", response_model=ReportDetail)
def get_report(
    report_id: UUID,
    includeImageUrl: int = Query(0, alias="includeImageUrl"),
    db: Session = Depends(get_db),
) -> ReportDetail:
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    gj = _geom_json(db, r.id, r.building_id)

    img_url = None
    if includeImageUrl:
        img_url = thumb_url_for_report(db, r.id)

    return ReportDetail(
        id=r.id,
        crisis_id=r.crisis_id,
        building_id=r.building_id,
        damage_level=r.damage_level,
        captured_at_client=r.captured_at_client,
        received_at_server=r.received_at_server,
        geom=gj,
        description_preview=r.description[:120],
        textual_location=r.textual_location,
        infrastructure_types=list(r.infrastructure_types or []),
        infrastructure_name=r.infrastructure_name,
        crisis_types=list(r.crisis_types or []),
        debris_clearing_required=r.debris_clearing_required,
        description=r.description,
        description_language=r.description_language,
        appendix_answers=dict(r.appendix_answers or {}),
        image_url=img_url,
    )


@router.patch("/{report_id}", response_model=ReportDetail)
def update_report(
    report_id: UUID,
    payload: ReportUpdate,
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
) -> ReportDetail:
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_owner(r, x_device_id)

    data = payload.model_dump(exclude_unset=True)
    if "geom" in data and data["geom"] is not None:
        g = shape(data["geom"])
        if g.geom_type != "Point":
            raise HTTPException(status_code=422, detail="geom must be a Point")
        r.geom = from_shape(g, srid=4326)
        del data["geom"]
    elif "geom" in data:
        del data["geom"]

    for key, val in data.items():
        setattr(r, key, val)

    if payload.damage_level is not None:
        validate_report_payload(
            r.damage_level,
            list(r.infrastructure_types or []),
            list(r.crisis_types or []),
            r.description_language,
            r.infrastructure_name,
        )

    db.commit()
    db.refresh(r)
    return get_report(report_id, includeImageUrl=1, db=db)


@router.delete("/{report_id}", status_code=204)
def delete_report(
    report_id: UUID,
    db: Session = Depends(get_db),
    x_device_id: str | None = Header(None, alias="X-Device-Id"),
) -> None:
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    _assert_owner(r, x_device_id)
    db.query(ReportImage).filter(ReportImage.report_id == r.id).delete()
    db.delete(r)
    db.commit()
