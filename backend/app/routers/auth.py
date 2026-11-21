from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import UserRow, get_db
from app.schemas import User
from app.services.auth import COOKIE_NAME, authenticate, cookie_settings, create_session, current_user, end_session

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


def to_user(u: UserRow) -> User:
    initials = "".join(p[0] for p in u.name.split()[:2]).upper() or u.username[:2].upper()
    return User(id=str(u.id), name=u.name, business=u.business, email=u.email, initials=initials,
                segment=u.segment)


@router.post("/login", response_model=User)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    cookie: dict = Depends(cookie_settings),
) -> User:
    user = authenticate(db, body.username, body.password)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")
    token = create_session(db, user, settings.session_days)
    response.set_cookie(value=token, **cookie)
    return to_user(user)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> Response:
    end_session(db, session_cookie)
    response.status_code = 204
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.get("/me", response_model=User)
def me(user: UserRow = Depends(current_user)) -> User:
    return to_user(user)
