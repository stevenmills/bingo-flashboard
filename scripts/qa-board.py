#!/usr/bin/env python3
"""
Smoke-test a Bingo Flashboard board over HTTP.

Usage:
  python3 scripts/qa-board.py
  python3 scripts/qa-board.py --base http://192.168.4.1
  python3 scripts/qa-board.py --pin 1975

Exit 0 if all tests pass, 1 if any fail. Skipped tests do not fail the run.
Restores screensaver enabled/LED test/text/type from the initial snapshot when possible.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Optional


REQUIRED_STATE_KEYS = (
    "current",
    "called",
    "remaining",
    "gameStyle",
    "gameType",
    "callingStyle",
    "gameEstablished",
    "screensaverEnabled",
    "screensaverActive",
    "ledTestMode",
    "brightness",
    "theme",
)


@dataclass
class Client:
    base: str
    timeout: float
    token: Optional[str] = None

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[bytes] = None,
        content_type: Optional[str] = None,
        auth: bool = True,
    ) -> tuple[int, Any]:
        url = f"{self.base.rstrip('/')}{path}"
        headers: dict[str, str] = {}
        if content_type:
            headers["Content-Type"] = content_type
        if auth and self.token:
            headers["X-Board-Token"] = self.token

        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
                status = resp.status
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
        except urllib.error.URLError as exc:
            raise ConnectionError(str(exc.reason)) from exc

        if not raw:
            return status, None
        try:
            return status, json.loads(raw.decode())
        except json.JSONDecodeError:
            return status, raw.decode(errors="replace")

    def get_state(self, auth: bool = False) -> dict[str, Any]:
        _, data = self._request("GET", "/api/state", auth=auth)
        if not isinstance(data, dict):
            raise RuntimeError("GET /api/state did not return JSON object")
        return data

    def post_json(self, path: str, payload: dict[str, Any], *, auth: bool = True) -> tuple[int, Any]:
        body = json.dumps(payload).encode()
        return self._request("POST", path, body=body, content_type="application/json", auth=auth)

    def post_form(self, path: str, fields: dict[str, str], *, auth: bool = True) -> tuple[int, Any]:
        body = urllib.parse.urlencode(fields).encode()
        return self._request(
            "POST",
            path,
            body=body,
            content_type="application/x-www-form-urlencoded",
            auth=auth,
        )

    def unlock(self, pin: str) -> None:
        status, data = self.post_json("/auth/board/unlock", {"pin": pin}, auth=False)
        if status != 200 or not isinstance(data, dict) or not data.get("token"):
            raise RuntimeError(f"unlock failed: HTTP {status} {data!r}")
        self.token = str(data["token"])

    def ensure_unlocked(self, pin: str) -> None:
        if not self.token:
            self.unlock(pin)
            return
        status, _ = self.post_form("/screensaver", {"enabled": "0"})
        if status in (401, 403):
            self.unlock(pin)


@dataclass
class Results:
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    step: int = 0

    def _emit(self, status: str, name: str, detail: str = "") -> None:
        self.step += 1
        label = f"[{self.step:02d}] {status:<5}  {name}"
        print(label, flush=True)
        if detail:
            print(f"       {detail}", flush=True)

    def ok(self, name: str, detail: str = "") -> None:
        self.passed += 1
        self._emit("PASS", name, detail)

    def fail(self, name: str, detail: str) -> None:
        self.failed += 1
        self._emit("FAIL", name, detail)

    def skip(self, name: str, reason: str) -> None:
        self.skipped += 1
        self._emit("SKIP", name, reason)


def run_test(results: Results, name: str, fn: Callable[[], None]) -> None:
    try:
        fn()
        results.ok(name)
    except AssertionError as exc:
        results.fail(name, str(exc) or "assertion failed")
    except Exception as exc:  # noqa: BLE001 — QA harness should catch and report
        results.fail(name, f"{type(exc).__name__}: {exc}")


def assert_eq(label: str, got: Any, expected: Any) -> None:
    if got != expected:
        raise AssertionError(f"{label}: expected {expected!r}, got {got!r}")


def assert_true(label: str, value: bool) -> None:
    if not value:
        raise AssertionError(label)


def assert_status_ok(name: str, status: int) -> None:
    if status < 200 or status >= 300:
        raise AssertionError(f"{name}: expected 2xx, got HTTP {status}")


def assert_status(name: str, status: int, expected: int) -> None:
    if status != expected:
        raise AssertionError(f"{name}: expected HTTP {expected}, got HTTP {status}")


def main() -> int:
    parser = argparse.ArgumentParser(description="QA smoke tests for Bingo Flashboard board API")
    parser.add_argument("--base", default="http://bingo.local", help="Board base URL (default: http://bingo.local)")
    parser.add_argument("--pin", default="1975", help="Board unlock PIN (default: 1975)")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout seconds (default: 20)")
    args = parser.parse_args()

    client = Client(base=args.base, timeout=args.timeout)
    results = Results()
    snapshot: dict[str, Any] = {}

    print(f"Target: {args.base}", flush=True)
    print("-" * 60, flush=True)

    # --- connectivity ---
    def test_state_reachable() -> None:
        nonlocal snapshot
        snapshot = client.get_state()
        assert_true("state is dict", isinstance(snapshot, dict))

    run_test(results, "connectivity.state_reachable", test_state_reachable)
    if results.failed:
        print("-" * 60, flush=True)
        print("Aborting: board unreachable", flush=True)
        return 1

    def test_state_required_fields() -> None:
        missing = [k for k in REQUIRED_STATE_KEYS if k not in snapshot]
        if missing:
            raise AssertionError(f"missing keys: {', '.join(missing)}")

    run_test(results, "connectivity.state_required_fields", test_state_required_fields)

    # --- auth ---
    # Unauthenticated rejection + lockout first; unlock after lockout clears.
    def test_control_endpoints_require_auth() -> None:
        probe = Client(base=args.base, timeout=args.timeout)
        checks: list[tuple[str, Callable[[], tuple[int, Any]]]] = [
            ("draw", lambda: probe.post_json("/draw", {}, auth=False)),
            ("reset", lambda: probe.post_json("/reset", {}, auth=False)),
            ("call", lambda: probe.post_json("/call", {"number": 1}, auth=False)),
            ("declare-winner", lambda: probe.post_json("/declare-winner", {}, auth=False)),
            ("brightness", lambda: probe.post_form("/brightness", {"value": "128"}, auth=False)),
            ("screensaver", lambda: probe.post_form("/screensaver", {"enabled": "1"}, auth=False)),
            ("wifi", lambda: probe.post_json("/wifi", {"ssid": ""}, auth=False)),
            ("device-id", lambda: probe._request("GET", "/api/device-id", auth=False)),
        ]
        for name, fn in checks:
            status, _ = fn()
            assert_true(f"{name} rejected without token", status in (401, 403))

    def test_screensaver_requires_auth() -> None:
        probe = Client(base=args.base, timeout=args.timeout)
        status, _ = probe.post_form("/screensaver", {"enabled": "1"}, auth=False)
        assert_true("unauthenticated screensaver rejected", status in (401, 403))

    def test_unlock_invalid_pin() -> None:
        probe = Client(base=args.base, timeout=args.timeout)
        status, _ = probe.post_json("/auth/board/unlock", {"pin": "0000"}, auth=False)
        assert_true("invalid pin rejected", status in (401, 403, 429))

    def test_unlock_lockout_after_failures() -> None:
        probe = Client(base=args.base, timeout=args.timeout)
        saw_429 = False
        last_status = 0
        for _ in range(12):
            status, _ = probe.post_json("/auth/board/unlock", {"pin": "0000"}, auth=False)
            last_status = status
            if status == 429:
                saw_429 = True
                break
            assert_true("invalid pin before lockout", status in (401, 403))
        assert_true(f"lockout 429 (last={last_status})", saw_429)
        status, _ = probe.post_json("/auth/board/unlock", {"pin": args.pin}, auth=False)
        assert_true("valid pin blocked during lockout", status == 429)

    def wait_unlock_lockout_clear() -> None:
        import time

        probe = Client(base=args.base, timeout=args.timeout)
        deadline = time.time() + 40
        while time.time() < deadline:
            status, _ = probe.post_json("/auth/board/unlock", {"pin": args.pin}, auth=False)
            if status == 200:
                # Discard this session; test_unlock_valid_pin unlocks fresh.
                return
            if status != 429:
                return
            time.sleep(1)

    if snapshot.get("boardAccessRequired", True):
        run_test(results, "auth.control_endpoints_require_token", test_control_endpoints_require_auth)
        run_test(results, "auth.screensaver_requires_token", test_screensaver_requires_auth)
        run_test(results, "auth.unlock_invalid_pin_rejected", test_unlock_invalid_pin)
        run_test(results, "auth.unlock_lockout_after_failures", test_unlock_lockout_after_failures)
        wait_unlock_lockout_clear()
    else:
        results.skip("auth.control_endpoints_require_token", "boardAccessRequired is false")
        results.skip("auth.screensaver_requires_token", "boardAccessRequired is false")
        results.skip("auth.unlock_invalid_pin_rejected", "boardAccessRequired is false")
        results.skip("auth.unlock_lockout_after_failures", "boardAccessRequired is false")

    def test_unlock_valid_pin() -> None:
        client.unlock(args.pin)
        assert_true("token set", bool(client.token))

    run_test(results, "auth.unlock_valid_pin", test_unlock_valid_pin)

    def ensure_auth() -> None:
        client.ensure_unlocked(args.pin)

    def test_housey_game_selection() -> None:
        ensure_auth()
        before = client.get_state()
        if before.get("gameEstablished") and not before.get("winnerDeclared"):
            raise AssertionError("skip-needed: game in progress")
        status, _ = client.post_json(
            "/game-selection",
            {"gameStyle": "housey", "gameType": "battleship"},
        )
        assert_status_ok("select housey battleship", status)
        state = client.get_state()
        assert_eq("gameStyle", state.get("gameStyle"), "housey")
        assert_eq("gameType", state.get("gameType"), "battleship")
        status, _ = client.post_json(
            "/game-selection",
            {"gameStyle": "bingo", "gameType": "cover_all"},
        )
        assert_status_ok("restore bingo cover_all", status)
        state = client.get_state()
        assert_eq("gameStyle back", state.get("gameStyle"), "bingo")
        assert_eq("gameType back", state.get("gameType"), "cover_all")

    run_test(results, "game.housey_selection_roundtrip", test_housey_game_selection)

    # --- screensaver (regression-prone) ---
    initial_ss = bool(snapshot.get("screensaverEnabled"))
    initial_led_test = bool(snapshot.get("ledTestMode"))
    initial_ss_text = str(snapshot.get("screensaverText") or "BINGO")
    initial_ss_type = str(snapshot.get("screensaverType") or "text")
    initial_called_len = len(snapshot.get("called") or [])

    def test_screensaver_form_enable() -> None:
        ensure_auth()
        status, _ = client.post_form("/screensaver", {"enabled": "1"})
        assert_status_ok("enable", status)
        state = client.get_state()
        assert_eq("screensaverEnabled", state.get("screensaverEnabled"), True)
        assert_eq("screensaverActive", state.get("screensaverActive"), not state.get("ledTestMode"))

    run_test(results, "screensaver.form_enable", test_screensaver_form_enable)

    def test_screensaver_preserves_game() -> None:
        state = client.get_state()
        assert_eq("called count unchanged", len(state.get("called") or []), initial_called_len)

    run_test(results, "screensaver.enable_preserves_called_numbers", test_screensaver_preserves_game)

    def test_screensaver_json_does_not_enable() -> None:
        ensure_auth()
        client.post_form("/screensaver", {"enabled": "0"})
        before = client.get_state()
        assert_eq("precondition disabled", before.get("screensaverEnabled"), False)

        status, _ = client.post_json("/screensaver", {"enabled": True})
        assert_true("json post rejected or ignored", status in (400, 401, 403) or status == 200)
        after = client.get_state()
        assert_eq("screensaverEnabled after json", after.get("screensaverEnabled"), False)
        assert_eq("called count after json", len(after.get("called") or []), initial_called_len)

    run_test(results, "screensaver.json_post_does_not_silently_enable", test_screensaver_json_does_not_enable)

    def test_screensaver_missing_param_400() -> None:
        ensure_auth()
        status, _ = client.post_form("/screensaver", {})
        assert_status("missing enabled param", status, 400)

    run_test(results, "screensaver.missing_enabled_returns_400", test_screensaver_missing_param_400)

    def test_screensaver_form_disable() -> None:
        ensure_auth()
        client.post_form("/screensaver", {"enabled": "1"})
        status, _ = client.post_form("/screensaver", {"enabled": "0"})
        assert_status_ok("disable", status)
        state = client.get_state()
        assert_eq("screensaverEnabled", state.get("screensaverEnabled"), False)
        assert_eq("screensaverActive", state.get("screensaverActive"), False)

    run_test(results, "screensaver.form_disable", test_screensaver_form_disable)

    calling_style = str(snapshot.get("callingStyle", "automatic"))
    pool_empty = int(snapshot.get("remaining", 0)) <= 0

    if calling_style == "automatic" and not pool_empty:
        def test_screensaver_draw_disables() -> None:
            ensure_auth()
            client.post_form("/screensaver", {"enabled": "1"})
            before = client.get_state()
            assert_eq("enabled before draw", before.get("screensaverEnabled"), True)

            status, body = client.post_json("/draw", {})
            assert_status_ok("draw", status)
            after = client.get_state() if not isinstance(body, dict) else body
            if not isinstance(after, dict):
                after = client.get_state()

            assert_eq("screensaver disabled by draw", after.get("screensaverEnabled"), False)
            assert_eq("screensaver inactive after draw", after.get("screensaverActive"), False)
            assert_true(
                "called count increased or game continued",
                len(after.get("called") or []) >= initial_called_len,
            )

        run_test(results, "screensaver.draw_disables_without_wiping_game", test_screensaver_draw_disables)

        def test_draw_then_undo() -> None:
            ensure_auth()
            before = client.get_state()
            if int(before.get("remaining", 0)) <= 0:
                raise AssertionError("pool empty")
            called_before = len(before.get("called") or [])
            status, _ = client.post_json("/draw", {})
            assert_status_ok("draw", status)
            mid = client.get_state()
            assert_true("draw added call", len(mid.get("called") or []) == called_before + 1)

            status, _ = client.post_json("/undo", {})
            assert_status_ok("undo", status)
            after = client.get_state()
            assert_eq("undo restored call count", len(after.get("called") or []), called_before)

        run_test(results, "game.draw_then_undo", test_draw_then_undo)
    else:
        reason = "pool empty" if pool_empty else f"callingStyle={calling_style}"
        results.skip("screensaver.draw_disables_without_wiping_game", reason)
        results.skip("game.draw_then_undo", reason)

    # --- LED test vs screensaver display flag ---
    def test_led_test_clears_screensaver_active() -> None:
        ensure_auth()
        client.post_form("/screensaver", {"enabled": "1"})
        status, _ = client.post_json("/led-test", {"enabled": True})
        assert_status_ok("led test on", status)
        state = client.get_state()
        assert_eq("screensaver still enabled", state.get("screensaverEnabled"), True)
        assert_eq("screensaverActive false during led test", state.get("screensaverActive"), False)

        status, _ = client.post_json("/led-test", {"enabled": False})
        assert_status_ok("led test off", status)
        state = client.get_state()
        assert_eq("screensaverActive restored", state.get("screensaverActive"), True)

    run_test(results, "led.test_mode_suppresses_screensaver_active", test_led_test_clears_screensaver_active)

    # --- settings form endpoints (frontend uses postForm) ---
    def test_brightness_form() -> None:
        ensure_auth()
        before = int(client.get_state().get("brightness", 128))
        target = 200 if before != 200 else 180
        status, _ = client.post_form("/brightness", {"value": str(target)})
        assert_status_ok("brightness", status)
        assert_eq("brightness updated", int(client.get_state().get("brightness")), target)
        client.post_form("/brightness", {"value": str(before)})

    run_test(results, "settings.brightness_form_roundtrip", test_brightness_form)

    def test_screensaver_text_form_roundtrip() -> None:
        ensure_auth()
        before = str(client.get_state().get("screensaverText") or "BINGO")
        probe = "__qa__" if before != "__qa__" else "__qb__"
        status, _ = client.post_form("/screensaver-text", {"text": probe})
        assert_status_ok("screensaver-text", status)
        assert_eq("text updated", client.get_state().get("screensaverText"), probe)
        status, _ = client.post_form("/screensaver-text", {"text": before})
        assert_status_ok("screensaver-text restore", status)
        assert_eq("text restored", client.get_state().get("screensaverText"), before)

    run_test(results, "settings.screensaver_text_form_roundtrip", test_screensaver_text_form_roundtrip)

    def test_screensaver_type_form_roundtrip() -> None:
        ensure_auth()
        before = str(client.get_state().get("screensaverType") or "text")
        probe = "rainbow" if before != "rainbow" else "text"
        status, _ = client.post_form("/screensaver-type", {"type": probe})
        assert_status_ok("screensaver-type", status)
        assert_eq("type updated", client.get_state().get("screensaverType"), probe)
        status, _ = client.post_form("/screensaver-type", {"type": before})
        assert_status_ok("screensaver-type restore", status)
        assert_eq("type restored", client.get_state().get("screensaverType"), before)

    run_test(results, "settings.screensaver_type_form_roundtrip", test_screensaver_type_form_roundtrip)

    # --- restore snapshot toggles ---
    def restore() -> None:
        ensure_auth()
        client.post_form("/screensaver", {"enabled": "1" if initial_ss else "0"})
        client.post_form("/screensaver-text", {"text": initial_ss_text})
        client.post_form("/screensaver-type", {"type": initial_ss_type})
        status, _ = client.post_json("/led-test", {"enabled": initial_led_test})
        if status not in (200, 204):
            raise RuntimeError(f"restore led-test failed: HTTP {status}")

    run_test(results, "cleanup.restore_initial_toggles", restore)

    print("-" * 60, flush=True)
    total = results.passed + results.failed + results.skipped
    print(
        f"{results.passed} passed, {results.failed} failed, {results.skipped} skipped "
        f"({total} total)",
        flush=True,
    )

    return 1 if results.failed else 0


if __name__ == "__main__":
    sys.exit(main())
