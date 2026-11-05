"""Tax questions: live search of Taxheaven and official sites, with sources; can be handed to the accountant."""
from types import SimpleNamespace as NS

from app import ai


def test_tax_question_saved_and_commentable(client, monkeypatch):
    c = client
    seen = {}

    async def fake(q, history):
        seen["q"] = q
        return {"answer": "LED panels are taxed at 24%.", "sources": [{"url": "https://www.taxheaven.gr/x", "title": "ΦΠΑ"}]}

    monkeypatch.setattr(ai, "ask_tax", fake)
    r = c.post("/api/ask/tax", json={"question": "What VAT applies to LED panels?"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["answer"].startswith("LED") and out["sources"][0]["url"].startswith("https://www.taxheaven.gr") and out["id"]
    assert seen["q"] == "What VAT applies to LED panels?"
    assert c.post("/api/ask/tax", json={"question": "  "}).status_code == 400

    # The saved question can carry a comment thread (for "Ask my accountant")
    t = c.get(f"/api/comments?target_type=question&target_id={out['id']}").json()
    assert t["target"]["label"] == "What VAT applies to LED panels?" and t["target"]["page"] == "/app/ask"
    assert c.post("/api/comments", json={"target_type": "question", "target_id": out["id"], "text": "Is this right for us?"}).status_code == 200


def test_tax_question_ai_errors_become_503(client, monkeypatch):
    async def boom(q, history):
        raise ai.ScanError("AI isn't configured on the server (missing Anthropic API key).")
    monkeypatch.setattr(ai, "ask_tax", boom)
    r = client.post("/api/ask/tax", json={"question": "ΦΠΑ για LED;"})
    assert r.status_code == 503 and "configured" in r.json()["detail"]


def test_tax_sources_cited_first_and_deduplicated():
    cite = NS(url="https://www.aade.gr/a", title="ΑΑΔΕ")
    content = [
        NS(type="server_tool_use"),
        NS(type="web_search_tool_result", content=[NS(url="https://www.taxheaven.gr/b", title="TH"), NS(url="https://www.aade.gr/a", title="ΑΑΔΕ")]),
        NS(type="text", text="24%.", citations=[cite]),
        NS(type="web_search_tool_result", content=NS(error_code="max_uses_exceeded")),
    ]
    assert [s["url"] for s in ai._tax_sources(content)] == ["https://www.aade.gr/a", "https://www.taxheaven.gr/b"]


def test_tax_search_is_limited_to_trusted_sites():
    assert "taxheaven.gr" in ai.TAX_DOMAINS and "aade.gr" in ai.TAX_DOMAINS
    assert all("." in d and "/" not in d for d in ai.TAX_DOMAINS)
