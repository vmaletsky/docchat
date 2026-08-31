import os

import pytest


@pytest.fixture(autouse=True, scope="session")
def set_test_secret():
    os.environ.setdefault("PARSER_API_SECRET", "test-secret-abc123")
