"""Authentification intégrée : comptes locaux (nom + mot de passe, hachés avec bcrypt) et jetons JWT.

Aucun service externe. Le premier compte est créé depuis l'interface au premier lancement (`/api/auth/setup`).
"""
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from jwt import PyJWTError as JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from . import database

_bearer = HTTPBearer(auto_error=False)

TOKEN_EXPIRE_HOURS = 24
ALGORITHM = "HS256"

# Durée maximale d'une session : /auth/refresh prolonge le jeton, mais pas au-delà de cette durée depuis la connexion initiale.
SESSION_MAX_HOURS = 24 * 7

MIN_PASSWORD_LENGTH = 8

# Haché une fois : sert à dépenser le même temps de calcul quand le nom d'utilisateur n'existe pas (pas de sondage des comptes par le temps de réponse).
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password", bcrypt.gensalt()).decode()


# --- Tickets SSE : EventSource ne sait pas envoyer d'en-tête, on évite de mettre le JWT dans l'URL (journaux d'un éventuel proxy) ---
_SSE_TTL = 60.0
_sse_tickets: dict[str, float] = {}
_sse_lock = threading.Lock()


def issue_sse_ticket() -> str:
    now = time.monotonic()
    ticket = secrets.token_urlsafe(24)
    with _sse_lock:
        for t in [t for t, exp in _sse_tickets.items() if exp < now]:
            del _sse_tickets[t]
        _sse_tickets[ticket] = now + _SSE_TTL
    return ticket


def consume_sse_ticket(ticket: str) -> bool:
    """Usage unique."""
    with _sse_lock:
        exp = _sse_tickets.pop(ticket, None)
    return exp is not None and exp >= time.monotonic()


# --- Limitation des essais de connexion (par IP, en mémoire) ---
_LOGIN_MAX_FAILS = 5
_LOGIN_WINDOW = 300.0
_login_fails: dict[str, list[float]] = {}
_login_lock = threading.Lock()


def login_blocked(ip: str) -> bool:
    now = time.monotonic()
    with _login_lock:
        fails = [t for t in _login_fails.get(ip, []) if now - t < _LOGIN_WINDOW]
        _login_fails[ip] = fails
        return len(fails) >= _LOGIN_MAX_FAILS


def login_failed(ip: str) -> None:
    with _login_lock:
        _login_fails.setdefault(ip, []).append(time.monotonic())


def login_succeeded(ip: str) -> None:
    with _login_lock:
        _login_fails.pop(ip, None)


# --- Mots de passe ---

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode(), hashed_password.encode())
    except ValueError:
        return False


def authenticate(username: str, password: str) -> Optional[str]:
    """Nom d'utilisateur normalisé si le couple est valide, sinon None."""
    username = database.normalize_username(username)
    hashed = database.get_user_hash(username)
    if hashed is None:
        verify_password(password, _DUMMY_HASH)
        return None
    return username if verify_password(password, hashed) else None


def check_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Le mot de passe doit faire au moins {MIN_PASSWORD_LENGTH} caractères")
    if len(password.encode()) > 72:
        raise HTTPException(status_code=400, detail="Le mot de passe est trop long (72 octets maximum)")


def check_username(username: str) -> str:
    username = database.normalize_username(username)
    if not database.USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="Nom d'utilisateur invalide : 3 à 32 caractères (lettres, chiffres, point, tiret, souligné)")
    return username


# --- Jetons ---

def create_token(username: str, auth_time: Optional[int] = None) -> str:
    """auth_time : instant de la connexion initiale (conservé par les rafraîchissements, pour borner la durée de session)."""
    secret = database.get_setting("JWT_SECRET")
    now = datetime.now(timezone.utc)
    expire = now + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire, "auth_time": auth_time or int(now.timestamp())}, secret, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Contenu du jeton s'il est valide (signature, expiration), sinon None."""
    try:
        return jwt.decode(token, database.get_setting("JWT_SECRET"), algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


def user_from_token(token: str) -> Optional[str]:
    """Nom d'utilisateur du jeton s'il est valide ET si le compte existe encore (un compte supprimé perd son accès aussitôt)."""
    payload = decode_token(token)
    username = payload.get("sub") if payload else None
    if not username or database.get_user_hash(username) is None:
        return None
    return username


def validate_token(token: str) -> bool:
    return user_from_token(token) is not None


def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
):
    if credentials is None or not validate_token(credentials.credentials):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing token",
            headers={"WWW-Authenticate": "Bearer"},
        )
