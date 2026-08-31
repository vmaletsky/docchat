from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_returns_200_with_correct_body():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_requires_no_auth():
    """Health endpoint must be reachable without an Authorization header."""
    response = client.get("/health")
    assert response.status_code == 200
