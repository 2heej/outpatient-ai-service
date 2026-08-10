import datetime
import uuid

from sqlalchemy import ARRAY, Boolean, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Intake(Base):
    __tablename__ = "intakes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    disease_context: Mapped[str] = mapped_column(String(50))
    visit_purpose: Mapped[list[str]] = mapped_column(ARRAY(String))
    symptom_change: Mapped[str | None] = mapped_column(String(30), nullable=True)
    document_type: Mapped[list[str]] = mapped_column(ARRAY(String))
    document_destination: Mapped[list[str]] = mapped_column(ARRAY(String))
    patient_present: Mapped[bool] = mapped_column(Boolean)
    guardian_only: Mapped[bool] = mapped_column(Boolean)
    requested_consultation: Mapped[str | None] = mapped_column(Text, nullable=True)

    subjective_summary: Mapped[str] = mapped_column(Text)
    soap_summary: Mapped[str] = mapped_column(Text)

    raw_answers: Mapped[dict] = mapped_column(JSONB)
    llm_model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    fallback_used: Mapped[bool] = mapped_column(Boolean, default=False)
