"""Test manuel du flux SSE contre un backend lancé : CALHOME_TOKEN=<jwt> python tests/test_sse.py (ignoré par pytest sans serveur)."""
import json
import os

import pytest
import requests

BASE = os.environ.get("CALHOME_URL", "http://localhost:9050")


def _server_up() -> bool:
    try:
        requests.get(f"{BASE}/api/auth/status", timeout=1)
        return True
    except requests.RequestException:
        return False


@pytest.mark.skipif(not _server_up() or not os.environ.get("CALHOME_TOKEN"), reason="backend lancé + CALHOME_TOKEN requis")
def test_sse():
    headers = {"Authorization": f"Bearer {os.environ['CALHOME_TOKEN']}"}
    ticket = requests.post(f"{BASE}/api/auth/sse-ticket", headers=headers).json()["ticket"]
    with requests.get(f"{BASE}/api/events", params={"ticket": ticket}, stream=True) as response:
        for line in response.iter_lines():
            if line and line.decode().startswith("data: "):
                assert isinstance(json.loads(line.decode()[6:]), list)
                break


if __name__ == "__main__":
    test_sse()
