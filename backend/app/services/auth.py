"""Passwords and login sessions.

Passwords: PBKDF2-HMAC-SHA256 with a random salt (standard library, no extra dependency).
Sessions: a random token in an HttpOnly cookie; only its SHA-256 hash is stored in the database.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import SessionRow, UserRow, get_db

COOKIE_NAME = "duckbank_session"
_ITERATIONS = 240_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations))
    return hmac.compare_digest(digest.hex(), digest_hex)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def authenticate(db: Session, username: str, password: str) -> UserRow | None:
    user = db.scalar(select(UserRow).where(UserRow.username == username.strip().lower()))
    # Verify even when the user does not exist, so timing does not reveal valid usernames.
    ok = verify_password(password, user.password_hash if user else hash_password("x"))
    return user if user and ok else None


def create_session(db: Session, user: UserRow, days: int) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    db.execute(delete(SessionRow).where(SessionRow.expires_at < now))  # tidy up expired ones
    db.add(SessionRow(token_hash=_token_hash(token), user_id=user.id, created_at=now,
                      expires_at=now + timedelta(days=days)))
    db.commit()
    return token


def end_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(SessionRow).where(SessionRow.token_hash == _token_hash(token)))
        db.commit()


def user_for_token(db: Session, token: str | None) -> UserRow | None:
    if not token:
        return None
    row = db.get(SessionRow, _token_hash(token))
    if row is None or row.expires_at < datetime.utcnow():
        return None
    return db.get(UserRow, row.user_id)


def current_user(
    db: Session = Depends(get_db),
    session_cookie: str | None = Cookie(default=None, alias=COOKIE_NAME),
    authorization: str | None = Header(default=None),
) -> UserRow:
    """FastAPI dependency: the logged-in user (cookie, or `Authorization: Bearer <token>`)."""
    token = session_cookie
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    user = user_for_token(db, token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user


def cookie_settings(settings: Settings = Depends(get_settings)) -> dict:
    return {
        "key": COOKIE_NAME,
        "httponly": True,
        "samesite": "lax",
        "secure": settings.cookie_secure,
        "max_age": settings.session_days * 86_400,
        "path": "/",
    }
