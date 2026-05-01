"""Single-user auth: bootstrap creds in env -> JWT bearer token."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

ALGORITHM = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token", auto_error=False)
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def authenticate(username: str, password: str) -> bool:
    """Compare against env-configured creds."""
    return username == settings.APP_USERNAME and password == settings.APP_PASSWORD


def create_access_token(subject: str, expires_minutes: int | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.APP_SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: Annotated[str | None, Depends(oauth2_scheme)]) -> str:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise creds_exc
    try:
        payload = jwt.decode(token, settings.APP_SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if not sub:
            raise creds_exc
        return sub
    except JWTError as e:
        raise creds_exc from e


CurrentUser = Annotated[str, Depends(get_current_user)]
