#!/usr/bin/env python3
"""Poll GitHub Actions runs for folio-pdf-reader (no output truncation)."""
import json
import sys
import urllib.request

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://backend.composio.dev/api/v3"
ACCOUNT = "ca_yyblpg3kyjIi"


def call(slug, arguments):
    payload = {"arguments": arguments, "connected_account_id": ACCOUNT, "user_id": "default"}
    r = urllib.request.Request(
        BASE + "/tools/execute/" + slug,
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    add_surrogate_to_request(r, "custom.composio", allowed_hosts=["backend.composio.dev"])
    with urllib.request.urlopen(r, timeout=60) as resp:
        return read_json_response(resp)["data"]


def main():
    d = call("GITHUB_LIST_WORKFLOW_RUNS_FOR_A_REPOSITORY",
             {"owner": "TheYuvrajMishra", "repo": "folio-pdf-reader", "per_page": 8})
    runs = d.get("workflow_runs", [])
    for r in runs:
        print(f"{r['id']} | {r.get('event')} | {r.get('head_branch')} | "
              f"{r.get('status')} | {r.get('conclusion')} | {r.get('created_at')} | {r.get('html_url')}")


if __name__ == "__main__":
    main()
