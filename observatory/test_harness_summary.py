#!/usr/bin/env python3
"""Tests for the observatory analyzer (stdlib unittest). `pnpm check:observatory` runs them.

    python3 -I observatory/test_harness_summary.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)  # -I leaves the script's folder off the path; the analyzer sits beside it

import harness_summary as hs  # noqa: E402

FIXTURES = os.path.join(HERE, "fixtures")
ANALYZER = os.path.join(HERE, "harness_summary.py")


def summarise_dir(*args):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "s.json")
        # run from an empty folder, so no traces/ directory nearby joins in
        subprocess.run([sys.executable, "-I", ANALYZER, "--out", out, *args], check=True, capture_output=True, cwd=tmp)
        with open(out) as fh:
            return json.load(fh)


def span_line(**kw):
    rec = {"schema": "errand.trace/1", "type": "span", "traceId": "t1", "sessionId": "t1", "attributes": {}}
    rec.update(kw)
    return json.dumps(rec)


class FixtureFailures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = summarise_dir("--traces", FIXTURES)

    def spans(self, sid, kind="tool"):
        return [x for x in self.d["traces"][sid]["spans"] if x["k"] == kind]

    def test_a_503_on_cancel_is_a_failed_span_and_the_same_key_call_after_it_is_a_retry(self):
        cancels = [x for x in self.spans("cancel503-fixture") if x["n"] == "cancel"]
        self.assertEqual([(c["ok"], c["err"], c["r"]) for c in cancels], [(False, "service_unavailable", None), (True, None, 1)])

    def test_a_timeout_on_book_is_failed_and_the_status_check_after_it_is_a_verification(self):
        tools = {x["n"]: x for x in self.spans("booktimeout-fixture")}
        self.assertEqual((tools["book"]["ok"], tools["book"]["err"]), (False, "timeout"))
        self.assertEqual(tools["get_booking_status"]["v"], 1)
        self.assertIsNone(tools["get_booking_status"]["r"])

    def test_a_failed_model_call_is_failed_and_the_next_one_is_a_retry(self):
        llm = self.spans("booktimeout-fixture", "llm")
        self.assertFalse(llm[0]["ok"])
        self.assertEqual(llm[1].get("r"), 1)

    def test_cost_keeps_estimated_and_cli_reported_apart(self):
        rows = {s["id"]: s for s in self.d["sessions"]}
        reader = rows["booktimeout-fixture-review-reader"]
        self.assertTrue(reader["subagent"])
        self.assertEqual(reader["parent"], "booktimeout-fixture")
        self.assertEqual((reader["cost_usd"], reader["cost_source"]), (0.004812, "provider_reported"))
        self.assertEqual(rows["cancel503-fixture"]["cost_source"], "price_table")
        tool = self.d["tools"]["errand-agent"]
        self.assertAlmostEqual(tool["cost_usd"], sum(s["cost_usd"] for s in self.d["sessions"]), places=5)
        self.assertEqual(tool["retries"]["total"], 2)


class TraceReading(unittest.TestCase):
    def test_the_latest_finished_record_wins_and_a_late_running_record_never_reopens_a_span(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t1.jsonl")
            with open(path, "w") as fh:
                fh.write(span_line(spanId="a", kind="tool", name="execute_tool book", status="running", startTimeMs=1000) + "\n")
                fh.write(span_line(spanId="a", kind="tool", name="execute_tool book", status="ok", startTimeMs=1000, endTimeMs=1500) + "\n")
                fh.write(span_line(spanId="a", kind="tool", name="execute_tool book", status="running", startTimeMs=1000) + "\n")
                fh.write('{"schema":"errand.trace/1","type":"span","traceId":"t1","spanId":"b"')  # cut short by a crash
            spans, _ = hs.read_errand_records(path)
        self.assertEqual([(s["spanId"], s["status"]) for s in spans], [("a", "ok")])

    def test_a_transient_failure_returned_as_a_value_still_counts_as_failed(self):
        span = {"status": "ok", "attributes": {"gen_ai.tool.call.result": {"kind": "timeout"}}}
        self.assertEqual(hs.errand_error_type(span), "timeout")
        self.assertIsNone(hs.errand_error_type({"status": "ok", "attributes": {"gen_ai.tool.call.result": {"kind": "booked"}}}))


class ClaudeSessionsRedaction(unittest.TestCase):
    PROMPT = ("Please wire the zebra-quartz checkout flow to /Users/someone/code/secret-project and email "
              "ops@example.com the sk-abcdefghijklmnop1234 key, then summarise the twelve remaining steps")

    def test_only_matching_project_folders_are_read_and_prompts_are_kept_as_short_redacted_snippets(self):
        with tempfile.TemporaryDirectory() as root:
            for folder in ("-Users-me-code-errand-agent-wt-15", "-Users-me-code-unrelated"):
                os.makedirs(os.path.join(root, folder))
                with open(os.path.join(root, folder, "s-%s.jsonl" % folder[-2:]), "w") as fh:
                    fh.write(json.dumps({"type": "user", "timestamp": "2026-11-03T10:00:00Z", "cwd": "/Users/me/code/x",
                                         "message": {"role": "user", "content": self.PROMPT}}) + "\n")
                    fh.write(json.dumps({"type": "assistant", "timestamp": "2026-11-03T10:00:05Z",
                                         "message": {"id": "m1", "model": "claude-x", "content": [],
                                                     "usage": {"input_tokens": 10, "output_tokens": 5}}}) + "\n")
            d = summarise_dir("--claude-sessions", "--claude-root", root)
            blob = json.dumps(d)
        self.assertEqual(d["files_scanned"], {"claude-code": 1})
        self.assertNotIn(self.PROMPT, blob)
        for leak in ("secret-project", "ops@example.com", "sk-abcdefghijklmnop1234", "twelve remaining"):
            self.assertNotIn(leak, blob)
        snippets = [p["text"] for t in d["traces"].values() for p in t["prompt_snippets"]]
        self.assertTrue(snippets and all(len(s.replace(" …", "").split()) <= 10 for s in snippets))


if __name__ == "__main__":
    unittest.main(verbosity=1)
