import hmac
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)


def verify_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    secret = os.environ.get("PARSER_API_SECRET", "")
    token = credentials.credentials if credentials is not None else ""
    if not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
