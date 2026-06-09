import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class Crisis(Base):
    __tablename__ = "crises"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug = Column(String, unique=True, nullable=False)
    name = Column(JSONB, nullable=False)
    bounds = Column(Geometry("POLYGON", srid=4326), nullable=True)
    archive_status = Column(String, nullable=False, default="draft")
    archive_window_start = Column(DateTime(timezone=True), nullable=True)
    archive_window_end = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Building(Base):
    __tablename__ = "buildings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    crisis_id = Column(UUID(as_uuid=True), ForeignKey("crises.id", ondelete="CASCADE"), nullable=False)
    external_ref = Column(Text, nullable=True)
    geom = Column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
    name = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Report(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_generated_uuid = Column(UUID(as_uuid=True), nullable=False)
    crisis_id = Column(UUID(as_uuid=True), ForeignKey("crises.id", ondelete="CASCADE"), nullable=False)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=True)
    geom = Column(Geometry("POINT", srid=4326), nullable=True)
    textual_location = Column(Text, nullable=True)
    damage_level = Column(String, nullable=False)
    infrastructure_types = Column(ARRAY(Text), nullable=False)
    infrastructure_name = Column(Text, nullable=False)
    crisis_types = Column(ARRAY(Text), nullable=False)
    debris_clearing_required = Column(Boolean, nullable=False)
    description = Column(Text, nullable=False)
    description_language = Column(String, nullable=False)
    appendix_answers = Column(JSONB, nullable=False, default=dict)
    captured_at_client = Column(DateTime(timezone=True), nullable=False)
    received_at_server = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    reporter_hash = Column(Text, nullable=True)
    duplicate_of = Column(UUID(as_uuid=True), ForeignKey("reports.id"), nullable=True)
    admin_reviewed = Column(Boolean, nullable=False, default=False)
    admin_flagged = Column(Boolean, nullable=False, default=False)

    images = relationship("ReportImage", back_populates="report", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("crisis_id", "client_generated_uuid", name="uq_report_client_uuid"),)


class ReportImage(Base):
    __tablename__ = "report_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id = Column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False)
    object_key = Column(Text, nullable=False)
    thumb_object_key = Column(Text, nullable=True)
    mime_type = Column(Text, nullable=False)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    checksum_sha256 = Column(Text, nullable=False)

    report = relationship("Report", back_populates="images")


class Zone(Base):
    __tablename__ = "zones"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    parent_zone_id = Column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)
    geom = Column(Geometry("POLYGON", srid=4326), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class OpsUser(Base):
    __tablename__ = "ops_users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    display_name = Column(Text, nullable=True)
    role = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class UserZoneAssignment(Base):
    __tablename__ = "user_zone_assignments"

    user_id = Column(UUID(as_uuid=True), ForeignKey("ops_users.id", ondelete="CASCADE"), primary_key=True)
    zone_id = Column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True)
    assignment_role = Column(String, nullable=False, default="coordinator")
    assigned_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class ReportCrisisLink(Base):
    __tablename__ = "report_crisis_links"

    report_id = Column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), primary_key=True)
    crisis_id = Column(UUID(as_uuid=True), ForeignKey("crises.id", ondelete="CASCADE"), primary_key=True)
    linked_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    linked_by = Column(UUID(as_uuid=True), ForeignKey("ops_users.id", ondelete="SET NULL"), nullable=True)
    link_source = Column(String, nullable=False, default="batch_archive")


class OpsAuditLog(Base):
    __tablename__ = "ops_audit_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id = Column(UUID(as_uuid=True), ForeignKey("ops_users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=True)
    detail = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
