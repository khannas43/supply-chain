from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..deps import get_session
from ..models import Person
from ..schemas import PersonDirectoryOut

router = APIRouter(prefix="/api/people", tags=["people"])


@router.get("", response_model=list[PersonDirectoryOut])
def list_people(session: Session = Depends(get_session)) -> list[PersonDirectoryOut]:
    """People who can own an action. With real sign-in this is everyone who has signed in; demo
    identities are listed only in dev mode."""
    query = select(Person).order_by(Person.name)
    if get_settings().auth_mode == "keycloak":
        query = query.where(Person.source == "login")
    return [PersonDirectoryOut.model_validate(p) for p in session.scalars(query)]
