#!/usr/bin/env python3
"""Writes the failure fixtures in this folder (stdlib only): two errand.trace/1 sessions.

    python3 -I observatory/fixtures/make_fixtures.py

- cancel503-fixture: cancel's first call fails with a 503 and is retried with the same
  idempotency key, then the booking list confirms the cancellation (ticket 10's path).
- booktimeout-fixture: the first model call is overloaded and retried; a review-reader subagent
  runs on the Claude Code CLI (CLI-reported cost); book times out after succeeding and
  get_booking_status verifies the booking (ticket 07's path).

Records follow agent/instrumentation/run-trace.ts: each span is written when it starts and again
when it settles, with the same span ids, names and gen_ai.* / errand.* attributes. Costs use the
rates in src/adapters/tracing/prices.json. Real runs produce these sequences once tickets 07 and
10 land; until then these files are the only source of them.
"""
import datetime as dt
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PRICES = os.path.join(HERE, "..", "..", "src", "adapters", "tracing", "prices.json")
SCHEMA = "errand.trace/1"
T0 = int(dt.datetime.fromisoformat("2026-11-04T09:00:00+05:30").timestamp() * 1000)

with open(PRICES) as fh:
    RATES = json.load(fh)["models"]


def minimax_cost(inp, out, cache_read):
    r = RATES["MiniMax-M3"]
    uncached = max(inp - cache_read, 0)
    return round((uncached * r["input"] + cache_read * r["cacheRead"] + out * r["output"]) / 1e6, 9)


class Trace:
    def __init__(self, root):
        self.root = root
        self.lines = []  # (time ms, order, record)
        self.n = 0
        self.calls = 0

    def _put(self, t, rec):
        self.n += 1
        self.lines.append((t, self.n, dict({"schema": SCHEMA}, **rec)))

    def span(self, sid, span_id, parent, kind, name, start, end, attrs, end_attrs=None, status="ok"):
        base = {"type": "span", "traceId": self.root, "spanId": span_id, "sessionId": sid, "kind": kind, "name": name}
        if parent:
            base["parentSpanId"] = parent
        self._put(start, dict(base, status="running", startTimeMs=start, attributes=attrs))
        self._put(end, dict(base, status=status, startTimeMs=start, endTimeMs=end, durationMs=end - start,
                            attributes=dict(attrs, **(end_attrs or {}))))

    def event(self, sid, kind, name, t, attrs, span_id=None):
        rec = {"type": "event", "traceId": self.root, "eventId": "evt:%s:%d" % (sid, self.n), "sessionId": sid,
               "kind": kind, "name": name, "timeMs": t, "attributes": attrs}
        if span_id:
            rec["spanId"] = span_id
        self._put(t, rec)

    def turn(self, sid, seq, start, end, agent="errand-agent", parent=None, subagent=None):
        attrs = {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": agent, "gen_ai.conversation.id": self.root,
                 "errand.turn.id": "turn_%d" % seq, "errand.turn.sequence": seq}
        if subagent:
            attrs["errand.subagent.name"] = subagent
        span_id = "turn:%s:turn_%d" % (sid, seq)
        self.span(sid, span_id, parent, "agent", "invoke_agent " + agent, start, end, attrs, {"errand.turn.outcome": "completed"})
        return span_id

    def step(self, sid, turn_id, run, attempt, start, end, model, provider, outcome="completed", error=None):
        span_id = "step:%s:run_%d:%d" % (sid, run, attempt)
        attrs = {"gen_ai.request.model": model, "gen_ai.provider.name": provider, "errand.run.id": "run_%d" % run, "errand.run.attempt": attempt}
        end_attrs = {"errand.step.outcome": outcome}
        if error:
            end_attrs["error.type"] = error
        self.span(sid, span_id, turn_id, "step", "agent.step", start, end, attrs, end_attrs, "error" if error else "ok")
        return span_id

    def chat(self, sid, step_id, start, end, model, provider, inp, out, cache_read=0, cost=None, cost_source="price_table",
             reply=None, error=None, message=None):
        self.calls += 1
        span_id = "model:%s:%d" % (sid, self.calls)
        attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": provider, "gen_ai.request.model": model,
                 "errand.input.message_count": 1 + self.calls, "errand.input.tool_count": 8}
        if error:
            self.span(sid, span_id, step_id, "model", "chat " + model, start, end, attrs,
                      {"error.type": error, "errand.error.message": message}, "error")
            return
        if cost is None:
            cost = minimax_cost(inp, out, cache_read)
        parts = [{"type": "tool_call", "id": reply[0], "name": reply[1], "arguments": reply[2]}] if isinstance(reply, tuple) else [{"type": "text", "content": reply or ""}]
        self.span(sid, span_id, step_id, "model", "chat " + model, start, end, attrs, {
            "gen_ai.response.model": model, "gen_ai.response.id": "resp_" + span_id.replace(":", "_"),
            "gen_ai.response.finish_reasons": ["tool-calls" if isinstance(reply, tuple) else "stop"],
            "gen_ai.usage.input_tokens": inp, "gen_ai.usage.output_tokens": out,
            "gen_ai.usage.cache_read.input_tokens": cache_read, "gen_ai.usage.cache_creation.input_tokens": 0,
            "gen_ai.output.messages": [{"role": "assistant", "parts": parts}],
            "errand.cost.usd": cost, "errand.cost.source": cost_source,
        })

    def tool(self, sid, step_id, call_id, name, start, end, args, result, error=None, message=None):
        span_id = "tool:%s:%s" % (sid, call_id)
        attrs = {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name, "gen_ai.tool.call.id": call_id,
                 "gen_ai.tool.type": "function", "gen_ai.tool.call.arguments": args, "errand.tool.framework": False}
        end_attrs = {"gen_ai.tool.call.result": result, "errand.tool.outcome": "failed" if error else "completed",
                     "errand.tool.duration_ms": end - start}
        if error:
            end_attrs["error.type"] = error
            end_attrs["errand.error.message"] = message
        self.span(sid, span_id, step_id, "tool", "execute_tool " + name, start, end, attrs, end_attrs, "error" if error else "ok")
        return span_id

    def write(self, path):
        with open(path, "w") as fh:
            for _, _, rec in sorted(self.lines, key=lambda x: (x[0], x[1])):
                fh.write(json.dumps(rec, separators=(",", ":")) + "\n")


M, P = "MiniMax-M3", "minimax"


def cancel_503():
    sid = "cancel503-fixture"
    tr = Trace(sid)
    t = T0
    # turn 1: "cancel my AC servicing" -> list_bookings, propose_action(cancel)
    turn = tr.turn(sid, 0, t, t + 7400)
    st = tr.step(sid, turn, 0, 0, t + 20, t + 7380, M, P)
    tr.event(sid, "context", "model context", t + 25, {"errand.context.facts": 2, "errand.context.tokens": 1840}, st)
    tr.chat(sid, st, t + 30, t + 2130, M, P, 3120, 64, 2048, reply=("call_c1", "list_bookings", {}))
    tr.tool(sid, st, "call_c1", "list_bookings", t + 2140, t + 2190, {}, {"kind": "found", "bookings": [{"id": "bkg_fx_ac_1", "status": "upcoming"}]})
    tr.chat(sid, st, t + 2200, t + 4500, M, P, 3460, 92, 3072, reply=("call_c2", "propose_action", {"action": "cancel", "booking_id": "bkg_fx_ac_1"}))
    tr.tool(sid, st, "call_c2", "propose_action", t + 4510, t + 4580, {"action": "cancel", "booking_id": "bkg_fx_ac_1"},
            {"kind": "proposed", "proposalId": "prp_fx_cancel_1", "feeInr": 0})
    tr.event(sid, "state_transition", "errand proposing to awaiting_approval", t + 4590, {"errand.state.from": "proposing", "errand.state.to": "awaiting_approval"})
    tr.chat(sid, st, t + 4600, t + 7350, M, P, 3720, 58, 3072, reply="Here is the cancellation card.")
    # turn 2: the Approve click -> cancel (503), cancel again with the same key, list_bookings confirms
    t = T0 + 41000
    turn = tr.turn(sid, 1, t, t + 9800)
    st = tr.step(sid, turn, 1, 0, t + 15, t + 9780, M, P)
    key = {"booking_id": "bkg_fx_ac_1", "idempotency_key": "grant_fx_cancel_1"}
    tr.chat(sid, st, t + 20, t + 1920, M, P, 3910, 71, 3584, reply=("call_c3", "cancel", key))
    tr.tool(sid, st, "call_c3", "cancel", t + 1930, t + 2170, key, {"kind": "service_unavailable", "status": 503},
            error="service_unavailable", message="HTTP 503 Service Unavailable from the provider")
    tr.chat(sid, st, t + 2180, t + 3980, M, P, 4010, 71, 3584, reply=("call_c4", "cancel", key))
    tr.tool(sid, st, "call_c4", "cancel", t + 3990, t + 4120, key, {"kind": "cancelled", "bookingId": "bkg_fx_ac_1"})
    tr.chat(sid, st, t + 4130, t + 5900, M, P, 4100, 40, 3584, reply=("call_c5", "list_bookings", {}))
    tr.tool(sid, st, "call_c5", "list_bookings", t + 5910, t + 5960, {}, {"kind": "found", "bookings": [{"id": "bkg_fx_ac_1", "status": "cancelled"}]})
    tr.event(sid, "state_transition", "errand cancelling to cancelled", t + 5970, {"errand.state.from": "cancelling", "errand.state.to": "cancelled"})
    tr.chat(sid, st, t + 5980, t + 9760, M, P, 4260, 66, 3584, reply="Cancelled. The provider confirmed it.")
    return tr


def book_timeout():
    sid = "booktimeout-fixture"
    rr = sid + "-review-reader"
    tr = Trace(sid)
    t = T0 + 600000
    # turn 1: "book a plumber in Koramangala tomorrow morning"
    turn = tr.turn(sid, 0, t, t + 31000)
    st = tr.step(sid, turn, 0, 0, t + 20, t + 1530, M, P, outcome="retried", error="APICallError")
    tr.chat(sid, st, t + 30, t + 1520, M, P, 0, 0, error="APICallError", message="529 overloaded_error")
    st = tr.step(sid, turn, 0, 1, t + 2540, t + 30980, M, P)
    tr.event(sid, "context", "model context", t + 2545, {"errand.context.facts": 1, "errand.context.tokens": 1610}, st)
    args = {"service": "plumber", "area": "Koramangala", "date_range": {"from": "2026-11-05", "to": "2026-11-05"}}
    tr.chat(sid, st, t + 2550, t + 4900, M, P, 2980, 88, 2048, reply=("call_b1", "search_providers", args))
    tr.tool(sid, st, "call_b1", "search_providers", t + 4910, t + 4960, args, {"kind": "found", "providers": [{"id": "prv_plumber_koramangala_1"}]})
    tr.chat(sid, st, t + 4970, t + 7100, M, P, 3380, 61, 3072, reply=("call_b2", "get_provider_insight", {"provider_id": "prv_plumber_koramangala_1"}))
    ins = tr.tool(sid, st, "call_b2", "get_provider_insight", t + 7110, t + 19500, {"provider_id": "prv_plumber_koramangala_1"},
                  {"kind": "insight", "overallSentiment": "positive", "punctualityComplaint": False})
    # the review reader: a subagent on the Claude Code CLI, so the CLI reports its cost
    sub = tr.turn(rr, 0, t + 7140, t + 19460, agent="review-reader", parent=ins, subagent="review-reader")
    sst = tr.step(rr, sub, 0, 0, t + 7150, t + 19440, "haiku", "claude-code")
    tr.chat(rr, sst, t + 7160, t + 19420, "haiku", "claude-code", 1840, 120, cost=0.004812, cost_source="provider_reported",
            reply='{"overallSentiment":"positive"}')
    tr.chat(sid, st, t + 19510, t + 21800, M, P, 3720, 77, 3072, reply=("call_b3", "hold_slot", {"provider_id": "prv_plumber_koramangala_1", "slot_start": "2026-11-05T10:00:00+05:30"}))
    tr.tool(sid, st, "call_b3", "hold_slot", t + 21810, t + 21880, {"provider_id": "prv_plumber_koramangala_1", "slot_start": "2026-11-05T10:00:00+05:30"},
            {"kind": "held", "holdId": "hld_fx_1", "priceInr": 949})
    tr.chat(sid, st, t + 21890, t + 24300, M, P, 3900, 90, 3584, reply=("call_b4", "propose_action", {"action": "book", "hold_id": "hld_fx_1"}))
    tr.tool(sid, st, "call_b4", "propose_action", t + 24310, t + 24380, {"action": "book", "hold_id": "hld_fx_1"}, {"kind": "proposed", "proposalId": "prp_fx_book_1"})
    tr.event(sid, "state_transition", "errand proposing to awaiting_approval", t + 24390, {"errand.state.from": "proposing", "errand.state.to": "awaiting_approval"})
    tr.chat(sid, st, t + 24400, t + 30950, M, P, 4080, 64, 3584, reply="Here is the booking card.")
    # turn 2: the Approve click -> book times out after succeeding; get_booking_status verifies
    t = T0 + 690000
    turn = tr.turn(sid, 1, t, t + 18700)
    st = tr.step(sid, turn, 1, 0, t + 15, t + 18680, M, P)
    key = {"hold_id": "hld_fx_1", "idempotency_key": "grant_fx_book_1"}
    tr.chat(sid, st, t + 20, t + 1900, M, P, 4210, 70, 3584, reply=("call_b5", "book", key))
    tr.event(sid, "state_transition", "errand booking to verifying", t + 11950, {"errand.state.from": "booking", "errand.state.to": "verifying"})
    tr.tool(sid, st, "call_b5", "book", t + 1910, t + 11910, key, {"kind": "timeout"}, error="timeout", message="the provider did not answer within 10 s")
    tr.chat(sid, st, t + 11960, t + 13800, M, P, 4330, 52, 3584, reply=("call_b6", "get_booking_status", {"idempotency_key": "grant_fx_book_1"}))
    tr.tool(sid, st, "call_b6", "get_booking_status", t + 13810, t + 13860, {"idempotency_key": "grant_fx_book_1"}, {"kind": "booked", "bookingId": "bkg_fx_plumber_1"})
    tr.event(sid, "state_transition", "errand verifying to booked", t + 13870, {"errand.state.from": "verifying", "errand.state.to": "booked"})
    tr.chat(sid, st, t + 13880, t + 18660, M, P, 4420, 81, 3584, reply="Booked: Anand Plumbing Works, tomorrow 10:00.")
    return tr


if __name__ == "__main__":
    for tr in (cancel_503(), book_timeout()):
        path = os.path.join(HERE, tr.root + ".jsonl")
        tr.write(path)
        print("%s: %d records" % (os.path.relpath(path), len(tr.lines)))
