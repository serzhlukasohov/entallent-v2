import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from agent_service.contracts.runtime_contract import validate_runtime_result
from agent_service.workflows.conversation_workflow import (
    ConversationWorkflow,
    ConversationWorkflowError,
    ConversationWorkflowStep,
)
from agent_service.workflows.model_provider import AgentFrameworkConversationModelClient

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTRACT_ROOT = REPO_ROOT / "packages/contracts/runtime"
EXPECTED_STEP_NAMES = [
    "load_context",
    "classify_intent",
    "detect_risk",
    "extract_memory",
    "apply_deterministic_policy",
    "generate_response",
    "plan_follow_up",
    "validate_actions",
    "prepare_result",
]


def read_fixture(relative_path: str) -> Any:
    return json.loads((CONTRACT_ROOT / "fixtures" / relative_path).read_text())


def test_workflow_executes_required_steps_in_order() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    workflow = ConversationWorkflow()

    result = workflow.run(request_body)

    assert workflow.framework_name == "agent_framework"
    assert workflow.executed_steps == EXPECTED_STEP_NAMES
    assert validate_runtime_result(result) == {"ok": True}
    assert result["reply"] == {
        "text": "MAF candidate response prepared for shadow comparison.",
        "mode": "candidate",
    }
    assert result["riskAssessment"] == {
        "type": None,
        "severity": "none",
        "confidence": 0,
        "evidence": [],
        "immediateResponseRequired": False,
        "escalationRecommended": False,
        "surveyMustBeBlocked": False,
        "proactiveMessagesMustBePaused": False,
    }
    assert result["memoryCandidates"] == [
        {
            "actionId": "memory-candidate-44444444-4444-4444-8444-444444444444",
            "type": "conversation_signal",
            "content": "Candidate memory proposed from current conversation turn.",
            "confidence": 0.4,
            "sensitivity": "normal",
            "sourceMessageIds": ["44444444-4444-4444-8444-444444444444"],
        }
    ]
    assert result["proposedActions"] == [
        {
            "actionId": "save-memory-44444444-4444-4444-8444-444444444444",
            "aggregateType": "memory",
            "actionType": "save_memory",
            "idempotencyKey": "action:save-memory-44444444-4444-4444-8444-444444444444",
            "payload": {
                "memoryCandidateId": "memory-candidate-44444444-4444-4444-8444-444444444444",
            },
            "validationResult": {
                "status": "pending",
                "reasonCodes": [],
            },
            "executionStatus": "not_started",
            "commitMarker": None,
        },
        {
            "actionId": "schedule-follow-up-44444444-4444-4444-8444-444444444444",
            "aggregateType": "follow_up",
            "actionType": "schedule_follow_up",
            "idempotencyKey": "action:schedule-follow-up-44444444-4444-4444-8444-444444444444",
            "payload": {
                "executeAt": "2026-08-06T11:58:01Z",
                "intent": "candidate_follow_up",
                "deduplicationKey": "followup:44444444-4444-4444-8444-444444444444",
            },
            "validationResult": {
                "status": "pending",
                "reasonCodes": [],
            },
            "executionStatus": "not_started",
            "commitMarker": None,
        },
    ]
    assert result["diagnostics"]["traceId"] == request_body["traceId"]
    assert result["diagnostics"]["runtimeAttempt"] == request_body["runtimeAttempt"]
    assert result["diagnostics"]["modelCalls"] == 0
    assert result["diagnostics"]["toolCalls"] == 0
    assert result["diagnostics"]["retryCount"] == 0
    assert result["diagnostics"]["runtimeVersion"].startswith("agent-service-maf-core/")
    assert result["classification"] == {
        "primaryIntent": "casual_conversation",
        "secondaryIntents": [],
        "emotionalState": [],
        "urgency": "low",
        "confidence": 0.62,
        "requiresSafetyCheck": False,
        "surveyAllowed": True,
        "reasoningSummary": "Python workflow classified intent as casual_conversation.",
        "reminderRequest": None,
        "dialogueAct": "new_substance",
        "latestUserSubstance": "Synthetic message for runtime contract validation.",
        "topicAnchor": None,
    }


def test_workflow_marks_acknowledgement_as_anchor_candidate() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "ok"
    workflow = ConversationWorkflow()

    result = workflow.run(request_body)

    assert result["classification"]["latestUserSubstance"] is None
    assert result["classification"]["dialogueAct"] == "acknowledgement"
    assert result["classification"]["topicAnchor"] == "Synthetic previous user message."


def test_workflow_uses_injected_maf_agent_model_client_for_reply() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    chat_client = FakeChatClient("MAF agent generated candidate reply.")
    model_client = AgentFrameworkConversationModelClient(
        chat_client=chat_client,
        model_name="test-model",
    )
    workflow = ConversationWorkflow(model_client=model_client)

    result = workflow.run(request_body)

    assert validate_runtime_result(result) == {"ok": True}
    assert result["reply"] == {
        "text": "MAF agent generated candidate reply.",
        "mode": "candidate",
    }
    assert result["diagnostics"]["modelCalls"] == 1
    assert result["diagnostics"]["modelRetryCount"] == 0
    assert chat_client.calls == 1
    assert chat_client.last_user_message is not None
    assert "current user message:" in chat_client.last_user_message


def test_workflow_regenerates_reply_once_for_deterministic_policy_violation() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "ok"
    request_body["context"]["replyPolicy"] = {
        "maxChars": 180,
        "maxQuestions": 0,
        "allowReflectiveOpener": False,
        "allowListFormatting": False,
    }
    chat_client = SequentialFakeChatClient(
        [
            "That, it seems, is the real root: overload. What is your action plan?",
            "Leave that thread where it is for now.",
        ]
    )
    model_client = AgentFrameworkConversationModelClient(
        chat_client=chat_client,
        model_name="test-model",
    )
    workflow = ConversationWorkflow(model_client=model_client)

    result = workflow.run(request_body)

    assert result["reply"] == {
        "text": "Leave that thread where it is for now.",
        "mode": "candidate",
    }
    assert chat_client.calls == 2
    assert chat_client.last_user_message is not None
    assert "Regenerate the reply once" in chat_client.last_user_message
    assert "ask no questions in this turn" in chat_client.last_user_message
    assert result["diagnostics"]["modelCalls"] == 2
    assert result["diagnostics"]["modelRetryCount"] == 1


def test_workflow_uses_typed_social_reply_without_model_call() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "как ты?\n*Sent using* <@U0BPHHA21GC|ChatGPT>"
    request_body["context"]["replyPlan"] = {
        "dialogueAct": "social_checkin",
        "latestUserSubstance": None,
        "topicAnchor": None,
        "memoryAnchors": [],
        "responseMove": "social_reply",
        "mayInferFromBrevity": False,
        "questionPolicy": {
            "maxQuestions": 1,
            "reason": "social_checkin_returns_question",
        },
        "requiredGrounding": [],
        "forbiddenMoves": ["operational_status"],
    }
    request_body["context"]["replyPolicy"] = {
        "maxChars": 120,
        "maxQuestions": 1,
        "allowReflectiveOpener": False,
        "allowListFormatting": False,
    }
    chat_client = SequentialFakeChatClient(
        [
            (
                "Потихоньку, но держусь. Сегодня хочется чего-то совсем простого — "
                "тишины и без спешки. Надеюсь, у тебя тоже будет шанс хотя бы немного "
                "выдохнуть."
            ),
            "Потихоньку, но держусь. Сегодня всё ещё хочется тишины.",
        ]
    )
    model_client = AgentFrameworkConversationModelClient(
        chat_client=chat_client,
        model_name="test-model",
    )
    workflow = ConversationWorkflow(model_client=model_client)

    result = workflow.run(request_body)

    assert result["reply"] == {
        "text": "Нормально, спасибо. А ты как?",
        "mode": "candidate",
    }
    assert chat_client.calls == 0
    assert result["diagnostics"]["modelCalls"] == 0
    assert result["diagnostics"]["modelRetryCount"] == 0
    assert result["diagnostics"]["replyRenderer"] == "deterministic_social_reply"


def test_workflow_model_failure_raises_safe_error_without_provider_detail() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "normal request text"
    chat_client = FailingChatClient(RuntimeError("Bearer secret-token provider stack trace"))
    model_client = AgentFrameworkConversationModelClient(chat_client=chat_client)
    workflow = ConversationWorkflow(model_client=model_client)

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(request_body)

    assert error.value.error_category == "dependency_failed"
    assert error.value.retryable is True
    assert error.value.fallback_allowed is True
    serialized = json.dumps({"message": str(error.value)})
    assert "Bearer secret-token" not in serialized
    assert "provider stack trace" not in serialized
    assert "normal request text" not in serialized


def test_workflow_rejects_empty_model_reply() -> None:
    model_client = AgentFrameworkConversationModelClient(chat_client=FakeChatClient("   "))
    workflow = ConversationWorkflow(model_client=model_client)

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(read_fixture("valid/process-message-request.json"))

    assert error.value.error_category == "unsafe_partial_result"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True


def test_workflow_rejects_unsafe_model_reply() -> None:
    model_client = AgentFrameworkConversationModelClient(
        chat_client=FakeChatClient("Bearer secret-token raw Slack user text"),
    )
    workflow = ConversationWorkflow(model_client=model_client)

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(read_fixture("valid/process-message-request.json"))

    assert error.value.error_category == "unsafe_partial_result"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True


def test_workflow_rejects_model_reply_that_echoes_user_text() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "I need a private salary adjustment"
    model_client = AgentFrameworkConversationModelClient(
        chat_client=FakeChatClient("I need a private salary adjustment"),
    )
    workflow = ConversationWorkflow(model_client=model_client)

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(request_body)

    assert error.value.error_category == "unsafe_partial_result"
    serialized = json.dumps({"message": str(error.value)})
    assert "private salary" not in serialized


def test_workflow_times_out_hung_maf_agent_model_client() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    model_client = AgentFrameworkConversationModelClient(
        chat_client=HangingChatClient(),
        timeout_ms=1,
    )
    workflow = ConversationWorkflow(model_client=model_client)

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(request_body)

    assert error.value.error_category == "timeout"
    assert error.value.retryable is True
    assert error.value.fallback_allowed is True


def test_workflow_result_does_not_echo_request_content() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "Bearer secret-token raw Slack user text"
    workflow = ConversationWorkflow()

    result = workflow.run(request_body)

    serialized = json.dumps(result)
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized
    assert result["memoryCandidates"] == []
    assert all(
        action["actionType"] != "save_memory"
        for action in result["proposedActions"]
    )


def test_workflow_risk_assessment_does_not_echo_context_signal_text() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    sensitive_signal = "Bearer secret-token raw Slack user text"
    tool = FakeContextTool(
        {
            "userProfile": {"proactiveMessagingEnabled": True},
            "memoryItems": [],
            "goals": [],
            "recentTurns": [],
            "surveyState": None,
            "riskSignals": [
                {
                    "type": sensitive_signal,
                    "severity": "critical",
                    "confidence": 0.95,
                    "recommendedAction": "pause_proactive_messages",
                }
            ],
            "diagnostics": {"counts": {"riskSignals": 1}},
        }
    )
    workflow = ConversationWorkflow(context_tool=tool)

    result = asyncio.run(workflow.run_async(request_body))

    serialized = json.dumps(result)
    assert validate_runtime_result(result) == {"ok": True}
    assert sensitive_signal not in serialized
    assert result["riskAssessment"]["type"] == "detected"
    assert result["riskAssessment"]["evidence"][0] == "risk_signal:detected"


def test_workflow_candidate_actions_remain_proposals_only() -> None:
    workflow = ConversationWorkflow()

    result = workflow.run(read_fixture("valid/process-message-request.json"))

    for action in result["proposedActions"]:
        assert action["executionStatus"] != "committed"
        assert action["commitMarker"] is None


def test_workflow_blocks_proactive_follow_up_from_risk_context() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    tool = FakeContextTool(
        {
            "userProfile": {"proactiveMessagingEnabled": True},
            "memoryItems": [],
            "goals": [],
            "recentTurns": [],
            "surveyState": {"status": "active"},
            "riskSignals": [
                {
                    "type": "crisis",
                    "severity": "critical",
                    "confidence": 0.95,
                    "recommendedAction": "pause_proactive_messages",
                }
            ],
            "diagnostics": {"counts": {"riskSignals": 1}},
        }
    )
    workflow = ConversationWorkflow(context_tool=tool)

    result = asyncio.run(workflow.run_async(request_body))

    assert validate_runtime_result(result) == {"ok": True}
    assert result["riskAssessment"] == {
        "type": "crisis",
        "severity": "critical",
        "confidence": 0.95,
        "evidence": ["risk_signal:crisis", "policy:proactive_messages_paused"],
        "immediateResponseRequired": True,
        "escalationRecommended": True,
        "surveyMustBeBlocked": True,
        "proactiveMessagesMustBePaused": True,
    }
    follow_up_actions = [
        action
        for action in result["proposedActions"]
        if action["actionType"] == "schedule_follow_up"
    ]
    assert follow_up_actions == [
        {
            "actionId": "schedule-follow-up-44444444-4444-4444-8444-444444444444",
            "aggregateType": "follow_up",
            "actionType": "schedule_follow_up",
            "idempotencyKey": "action:schedule-follow-up-44444444-4444-4444-8444-444444444444",
            "payload": {
                "executeAt": "2026-08-06T11:58:01Z",
                "intent": "candidate_follow_up",
                "deduplicationKey": "followup:44444444-4444-4444-8444-444444444444",
            },
            "validationResult": {
                "status": "invalid",
                "reasonCodes": [
                    "RISK_SURVEY_BLOCKED",
                    "RISK_PROACTIVE_MESSAGES_PAUSED",
                ],
                "message": "Deterministic policy blocked proactive follow-up.",
            },
            "executionStatus": "blocked",
            "commitMarker": None,
        }
    ]
    assert result["diagnostics"]["toolCalls"] == 1
    assert result["diagnostics"]["retryCount"] == (
        result["diagnostics"]["modelRetryCount"]
        + result["diagnostics"]["toolRetryCount"]
        + result["diagnostics"]["httpRetryCount"]
    )


def test_workflow_blocks_follow_up_when_proactivity_is_disabled() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    tool = FakeContextTool(
        {
            "userProfile": {"proactiveMessagingEnabled": False},
            "memoryItems": [],
            "goals": [],
            "recentTurns": [],
            "surveyState": None,
            "riskSignals": [],
            "diagnostics": {"counts": {}},
        }
    )
    workflow = ConversationWorkflow(context_tool=tool)

    result = asyncio.run(workflow.run_async(request_body))

    follow_up_action = next(
        action
        for action in result["proposedActions"]
        if action["actionType"] == "schedule_follow_up"
    )
    assert follow_up_action["validationResult"] == {
        "status": "invalid",
        "reasonCodes": ["PROACTIVE_MESSAGING_DISABLED"],
        "message": "Deterministic policy blocked proactive follow-up.",
    }
    assert follow_up_action["executionStatus"] == "blocked"
    assert follow_up_action["commitMarker"] is None


def test_workflow_omits_follow_up_when_message_timestamp_is_invalid() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["createdAt"] = "not-a-date-time"
    workflow = ConversationWorkflow()

    first_result = workflow.run(request_body)
    second_result = workflow.run(request_body)

    assert first_result == second_result
    assert all(
        action["actionType"] != "schedule_follow_up"
        for action in first_result["proposedActions"]
    )


def test_workflow_omits_goal_update_without_supported_change_signal() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    workflow = ConversationWorkflow()

    result = workflow.run(request_body)

    assert all(
        action["actionType"] != "update_goal"
        for action in result["proposedActions"]
    )


def test_workflow_emits_goal_update_with_supported_change_signal() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["context"]["goals"][0]["candidateStatus"] = "active"
    workflow = ConversationWorkflow()

    result = workflow.run(request_body)

    goal_actions = [
        action
        for action in result["proposedActions"]
        if action["actionType"] == "update_goal"
    ]
    assert goal_actions == [
        {
            "actionId": "update-goal-77777777-7777-4777-8777-777777777777",
            "aggregateType": "goal",
            "actionType": "update_goal",
            "idempotencyKey": "action:update-goal-77777777-7777-4777-8777-777777777777",
            "payload": {
                "goalId": "77777777-7777-4777-8777-777777777777",
                "changes": {"status": "active"},
            },
            "validationResult": {
                "status": "pending",
                "reasonCodes": [],
            },
            "executionStatus": "not_started",
            "commitMarker": None,
        }
    ]


def test_workflow_converts_step_failures_to_safe_error() -> None:
    def fail_step(_: dict[str, Any]) -> dict[str, Any]:
        raise ConversationWorkflowError(
            error_category="dependency_failed",
            retryable=True,
            fallback_allowed=True,
            message="Safe workflow failure.",
        )

    workflow = ConversationWorkflow(
        steps=[
            ConversationWorkflowStep(name="load_context", handler=fail_step),
        ]
    )

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(read_fixture("valid/process-message-request.json"))

    assert error.value.error_category == "dependency_failed"
    assert error.value.retryable is True
    assert error.value.fallback_allowed is True
    assert str(error.value) == "Safe workflow failure."


def test_workflow_run_inside_running_event_loop_raises_safe_error() -> None:
    async def invoke_sync_run_inside_loop() -> None:
        workflow = ConversationWorkflow()
        with pytest.raises(ConversationWorkflowError) as error:
            workflow.run(read_fixture("valid/process-message-request.json"))

        assert error.value.error_category == "validation_error"
        assert error.value.retryable is False
        assert error.value.fallback_allowed is True
        assert str(error.value) == "Use run_async inside async contexts."

    asyncio.run(invoke_sync_run_inside_loop())


def test_workflow_serializes_concurrent_runs_on_one_instance() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    workflow = ConversationWorkflow()

    async def run_twice() -> list[dict[str, Any]]:
        first, second = await asyncio.gather(
            workflow.run_async(request_body),
            workflow.run_async(request_body),
        )
        return [first, second]

    results = asyncio.run(run_twice())

    assert results[0] == results[1]
    assert workflow.executed_steps == EXPECTED_STEP_NAMES


def test_workflow_rejects_framework_output_with_invalid_runtime_result() -> None:
    def incomplete_result_step(state: dict[str, Any]) -> dict[str, Any]:
        state["result"] = {"diagnostics": {"traceId": "trace-only"}}
        return state

    workflow = ConversationWorkflow(
        steps=[
            ConversationWorkflowStep(
                name="prepare_result",
                handler=incomplete_result_step,
            ),
        ],
    )

    with pytest.raises(ConversationWorkflowError) as error:
        workflow.run(read_fixture("valid/process-message-request.json"))

    assert error.value.error_category == "unsafe_partial_result"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True
    assert str(error.value) == "MAF core workflow produced an unsafe result."


def test_workflow_load_context_calls_injected_tool_and_counts_attempt() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["tenant"]["id"] = "00000000-0000-4000-8000-000000000000"
    request_body["tenant"]["workspaceId"] = "T01234567"
    tool = FakeContextTool(
        {
            "recentTurns": [{"id": "turn-1"}],
            "memoryItems": [{"id": "memory-1"}],
            "goals": [{"id": "goal-1"}],
            "riskSignals": [],
        }
    )
    workflow = ConversationWorkflow(context_tool=tool)

    result = asyncio.run(workflow.run_async(request_body))

    assert tool.calls == [request_body]
    assert validate_runtime_result(result) == {"ok": True}
    assert result["memoryCandidates"][0]["actionId"] == (
        "memory-candidate-44444444-4444-4444-8444-444444444444"
    )
    assert [action["actionType"] for action in result["proposedActions"]] == [
        "save_memory",
        "schedule_follow_up",
    ]
    assert result["diagnostics"]["toolCalls"] == 1
    assert result["diagnostics"]["toolRetryCount"] == 0


def test_workflow_context_tool_failure_raises_safe_error_without_request_content() -> None:
    request_body = read_fixture("valid/process-message-request.json")
    request_body["message"]["text"] = "Bearer secret-token raw Slack user text"
    workflow = ConversationWorkflow(
        context_tool=FailingContextTool(
            ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=False,
                fallback_allowed=True,
                message="MAF context tool authorization failed safely.",
            )
        )
    )

    with pytest.raises(ConversationWorkflowError) as error:
        asyncio.run(workflow.run_async(request_body))

    assert error.value.error_category == "dependency_failed"
    assert error.value.retryable is False
    assert error.value.fallback_allowed is True
    serialized = json.dumps({"message": str(error.value)})
    assert "Bearer secret-token" not in serialized
    assert "raw Slack user text" not in serialized


class FakeContextTool:
    def __init__(self, response: dict[str, Any]) -> None:
        self._response = response
        self.calls: list[dict[str, Any]] = []

    async def read_context(self, request: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(request)
        return self._response


class FailingContextTool:
    def __init__(self, error: ConversationWorkflowError) -> None:
        self._error = error

    async def read_context(self, request: dict[str, Any]) -> dict[str, Any]:
        _ = request
        raise self._error


class FakeChatClient:
    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0
        self.last_user_message: str | None = None

    async def get_response(self, messages: Any, **kwargs: Any) -> Any:
        from agent_framework import ChatResponse, Message

        _ = kwargs
        self.calls += 1
        self.last_user_message = messages[-1].text
        return ChatResponse(messages=[Message("assistant", [self._reply])])


class SequentialFakeChatClient:
    def __init__(self, replies: list[str]) -> None:
        self._replies = replies
        self.calls = 0
        self.last_user_message: str | None = None

    async def get_response(self, messages: Any, **kwargs: Any) -> Any:
        from agent_framework import ChatResponse, Message

        _ = kwargs
        self.last_user_message = messages[-1].text
        reply = self._replies[min(self.calls, len(self._replies) - 1)]
        self.calls += 1
        return ChatResponse(messages=[Message("assistant", [reply])])


class FailingChatClient:
    def __init__(self, error: Exception) -> None:
        self._error = error

    async def get_response(self, messages: Any, **kwargs: Any) -> Any:
        _ = messages
        _ = kwargs
        raise self._error


class HangingChatClient:
    async def get_response(self, messages: Any, **kwargs: Any) -> Any:
        _ = messages
        _ = kwargs
        await asyncio.Event().wait()
