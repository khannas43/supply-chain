from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit
from ..auth import Actor, require_role
from ..deps import get_session
from ..ids import next_id
from ..models import CommodityForm, Country, CountryAlias, UnitConversion
from ..schemas import ConversionIn, ConversionOut, CountryOut, FormOut, ReferenceOut

router = APIRouter(prefix="/api/reference", tags=["reference data"])


def _conversion(c: UnitConversion) -> ConversionOut:
    return ConversionOut(id=c.id, from_unit=c.from_unit, to_unit=c.to_unit, factor=c.factor, effective_from=c.effective_from, source=c.source)


@router.get("", response_model=ReferenceOut)
def reference(session: Session = Depends(get_session)) -> ReferenceOut:
    aliases: dict[str, list[str]] = {}
    for a in session.scalars(select(CountryAlias).order_by(CountryAlias.alias)):
        aliases.setdefault(a.country_code, []).append(a.alias)
    return ReferenceOut(
        countries=[CountryOut(code=c.code, name=c.name, aliases=aliases.get(c.code, [])) for c in session.scalars(select(Country).order_by(Country.code))],
        forms=[FormOut.model_validate(f) for f in session.scalars(select(CommodityForm).order_by(CommodityForm.commodity, CommodityForm.form))],
        conversions=[_conversion(c) for c in session.scalars(select(UnitConversion).order_by(UnitConversion.effective_from, UnitConversion.id))],
    )


@router.post("/conversions", response_model=ConversionOut, status_code=201)
def add_conversion(
    body: ConversionIn,
    actor: Actor = Depends(require_role("steward", "admin")),
    session: Session = Depends(get_session),
) -> ConversionOut:
    """Add a dated conversion factor. Existing rows are never changed; a new effective date adds a new row."""
    row = UnitConversion(
        id=next_id(session, UnitConversion.id, "CV-"), from_unit=body.from_unit, to_unit=body.to_unit,
        factor=body.factor, effective_from=body.effective_from, source=body.source,
    )
    session.add(row)
    audit.record(session, actor.name, "reference.conversion_added", row.id, f"{row.from_unit} -> {row.to_unit} x {row.factor} from {row.effective_from}")
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "A conversion for these units and this effective date already exists") from None
    return _conversion(row)
