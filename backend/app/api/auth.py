"""Auth endpoints — single-user."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from app.core.security import authenticate, create_access_token
from app.schemas import Token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/token", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends()) -> Token:
    if not authenticate(form.username, form.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    return Token(access_token=create_access_token(subject=form.username))
