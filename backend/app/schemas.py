from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    ok: bool = True
    postgis: bool = True


class CrisisOut(BaseModel):
    id: UUID
    slug: str
    name: dict[str, Any]
    bounds: dict[str, Any] | None = None


class PresignQuery(BaseModel):
    crisisId: UUID
    mimeType: str
    checksumSha256: str
    bytes: int = Field(..., ge=1, le=50 * 1024 * 1024)


class PresignResponse(BaseModel):
    putUrl: str
    objectKey: str
    expiresAt: datetime


class ImagePayload(BaseModel):
    objectKey: str
    mimeType: str
    width: int | None = None
    height: int | None = None
    checksumSha256: str


class ReportCreate(BaseModel):
    client_generated_uuid: UUID
    crisis_id: UUID
    building_id: UUID | None = None
    geom: dict[str, Any] | None = None  # GeoJSON Point
    textual_location: str | None = None
    damage_level: str
    infrastructure_types: list[str]
    infrastructure_name: str
    crisis_types: list[str]
    debris_clearing_required: bool
    description: str
    description_language: str
    captured_at_client: datetime
    appendix_answers: dict[str, Any] = Field(default_factory=dict)
    image: ImagePayload
    reporter_fingerprint: str | None = None


class ReportCreated(BaseModel):
    report_id: UUID
    received_at_server: datetime
    possible_duplicate: bool = False


class MyContributionOut(BaseModel):
    crisis_id: UUID
    report_count: int
    distinct_locations: int
    possible_duplicate_recent: int


class ReportSummary(BaseModel):
    id: UUID
    crisis_id: UUID
    building_id: UUID | None
    damage_level: str
    site_status: str = "affected"
    captured_at_client: datetime
    received_at_server: datetime
    geom: dict[str, Any] | None = None
    description_preview: str
    is_mine: bool = False


class ReportListResponse(BaseModel):
    items: list[ReportSummary]
    nextCursor: str | None = None


class OpsReportSummary(ReportSummary):
    admin_reviewed: bool = False
    admin_flagged: bool = False


class ReportUpdate(BaseModel):
    damage_level: str | None = None
    description: str | None = None
    description_language: str | None = None
    captured_at_client: datetime | None = None
    infrastructure_types: list[str] | None = None
    infrastructure_name: str | None = None
    crisis_types: list[str] | None = None
    debris_clearing_required: bool | None = None
    appendix_answers: dict[str, Any] | None = None
    building_id: UUID | None = None
    geom: dict[str, Any] | None = None
    textual_location: str | None = None


class ReportDetail(ReportSummary):
    textual_location: str | None
    infrastructure_types: list[str]
    infrastructure_name: str
    crisis_types: list[str]
    debris_clearing_required: bool
    description: str
    description_language: str
    appendix_answers: dict[str, Any]
    image_url: str | None = None
