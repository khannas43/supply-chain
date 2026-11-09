#!/usr/bin/env python3
"""Create the `supplychain` realm in a Keycloak server and give the seed users a password.

Works against any Keycloak: the optional container in this repo, or an existing instance reached
through `kubectl port-forward`. Standard library only.

    python3 keycloak/setup.py --url http://127.0.0.1:8180 --admin-user admin --admin-password '...'

The admin password can also come from KEYCLOAK_ADMIN_PASSWORD. Seed users get DEMO_USER_PASSWORD if
set, otherwise a random password that is printed once. Nothing secret is written to a file.
Realm settings are only applied when the realm does not exist; an existing realm is left alone.
"""

import argparse
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REALM_FILE = Path(__file__).with_name("supplychain-realm.json")


def call(method, url, token=None, body=None, form=None):
    data, headers = None, {"Accept": "application/json"}
    if form is not None:
        data, headers["Content-Type"] = urllib.parse.urlencode(form).encode(), "application/x-www-form-urlencoded"
    elif body is not None:
        data, headers["Content-Type"] = json.dumps(body).encode(), "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")


def wait_for(url, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=3)
            return True
        except (urllib.error.URLError, OSError):
            time.sleep(2)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8180", help="Keycloak base URL as reachable from here")
    ap.add_argument("--admin-user", default=os.environ.get("KEYCLOAK_ADMIN", "admin"))
    ap.add_argument("--admin-password", default=os.environ.get("KEYCLOAK_ADMIN_PASSWORD"))
    ap.add_argument("--realm-file", default=str(REALM_FILE))
    ap.add_argument("--keep-passwords", action="store_true", help="do not set seed user passwords")
    ap.add_argument("--wait", type=int, default=120, help="seconds to wait for Keycloak to come up")
    a = ap.parse_args()
    if not a.admin_password:
        sys.exit("Give the admin password with --admin-password or KEYCLOAK_ADMIN_PASSWORD")
    base = a.url.rstrip("/")
    realm_def = json.loads(Path(a.realm_file).read_text())
    realm = realm_def["realm"]

    if not wait_for(f"{base}/realms/master", a.wait):
        sys.exit(f"Keycloak did not answer at {base}")
    status, tok = call("POST", f"{base}/realms/master/protocol/openid-connect/token",
                       form={"grant_type": "password", "client_id": "admin-cli", "username": a.admin_user, "password": a.admin_password})
    if status != 200:
        sys.exit(f"Admin login failed ({status}). Check the admin user and password.")
    token = tok["access_token"]

    status, _ = call("GET", f"{base}/admin/realms/{realm}", token)
    created = status == 404
    if created:
        status, body = call("POST", f"{base}/admin/realms", token, realm_def)
        if status not in (200, 201):
            sys.exit(f"Creating the realm failed ({status}): {body}")
        print(f"Created realm '{realm}' with {len(realm_def['roles']['realm'])} roles, {len(realm_def['clients'])} clients and {len(realm_def['users'])} users.")
    elif status == 200:
        print(f"Realm '{realm}' already exists; its settings were left as they are.")
    else:
        sys.exit(f"Could not check the realm ({status})")

    if a.keep_passwords:
        return
    password = os.environ.get("DEMO_USER_PASSWORD") or secrets.token_urlsafe(12)
    for u in realm_def["users"]:
        status, found = call("GET", f"{base}/admin/realms/{realm}/users?username={urllib.parse.quote(u['username'])}&exact=true", token)
        if status != 200 or not found:
            print(f"  ! user {u['username']} not found, skipped")
            continue
        status, body = call("PUT", f"{base}/admin/realms/{realm}/users/{found[0]['id']}/reset-password", token,
                            {"type": "password", "value": password, "temporary": False})
        if status not in (200, 204):
            sys.exit(f"Setting the password for {u['username']} failed ({status}): {body}")
    print(f"\nSeed users can sign in with this password (shown once, not stored): {password}")
    print("\n  user                   roles            scope")
    for u in realm_def["users"]:
        scope = ",".join(u.get("attributes", {}).get("commodity_scope", [])) or "all"
        print(f"  {u['username']:<22} {','.join(u['realmRoles']):<16} {scope}")


if __name__ == "__main__":
    main()
