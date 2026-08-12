from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Never, Protocol, cast
from uuid import UUID

import agent_framework
from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler

from agent_service.contracts.runtime_contract import validate_runtime_result
from agent_service.workflows.model_provider import (
    ConversationModelClient,
    ConversationModelProviderError,
    ConversationModelProviderTimeoutError,
    UnsafeConversationModelOutputError,
)

ConversationWorkflowStepName = Literal[
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

RuntimeErrorCategory = Literal[
    "unavailable",
    "validation_error",
    "timeout",
    "duplicate_request",
    "dependency_failed",
    "unsafe_partial_result",
]
ConversationWorkflowState = dict[str, Any]
ConversationWorkflowStepHandler = Callable[[ConversationWorkflowState], ConversationWorkflowState]
RISK_SEVERITY_ORDER = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
    "critical": 4,
}
SAFE_RISK_TYPES = {
    "burnout",
    "crisis",
    "harassment",
    "privacy",
    "stress",
}
SENSITIVE_TEXT_MARKERS = (
    "bearer ",
    "secret",
    "token",
    "password",
)
ACKNOWLEDGEMENT_MARKERS = (
    "ok",
    "okay",
    "thank",
    "thanks",
    "thanks!",
    "got it",
    "gotcha",
    "sure",
    "sure.",
    "yes",
    "yep",
    "all good",
    "fine",
    "great",
    "alright",
)
EMOTIONAL_KEYWORDS = (
    "feel",
    "feeling",
    "anxious",
    "worried",
    "stressed",
    "depressed",
    "sad",
    "scared",
    "overwhelmed",
    "burnout",
)


class ContextTool(Protocol):
    async def read_context(self, request: dict[str, Any]) -> dict[str, Any]: ...


@dataclass(frozen=True)
class ConversationWorkflowStep:
    name: ConversationWorkflowStepName
    handler: ConversationWorkflowStepHandler


class ConversationWorkflowError(Exception):
    def __init__(
        self,
        *,
        error_category: RuntimeErrorCategory,
        retryable: bool,
        fallback_allowed: bool,
        message: str,
    ) -> None:
        super().__init__(message)
        self.error_category = error_category
        self.retryable = retryable
        self.fallback_allowed = fallback_allowed
        self.safe_message = message


class ConversationWorkflow:
    def __init__(
        self,
        steps: Sequence[ConversationWorkflowStep] | None = None,
        context_tool: ContextTool | None = None,
        model_client: ConversationModelClient | None = None,
    ) -> None:
        self._steps = list(steps) if steps is not None else self._build_default_steps()
        self._context_tool = context_tool
        self._executed_steps: list[ConversationWorkflowStepName] = []
        self._framework_runner = MicrosoftAgentFrameworkWorkflowRunner(
            steps=self._steps,
            context_tool=context_tool,
            load_context_from_tool=self._load_context_from_tool,
            generate_response_from_model=self._generate_response_from_model,
            model_client=model_client,
        )
        self._run_lock: asyncio.Lock | None = None
        self._model_client = model_client

    @property
    def executed_steps(self) -> list[ConversationWorkflowStepName]:
        return list(self._executed_steps)

    @property
    def framework_name(self) -> str:
        return self._framework_runner.framework_name

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            raise ConversationWorkflowError(
                error_category="validation_error",
                retryable=False,
                fallback_allowed=True,
                message="Use run_async inside async contexts.",
            )

        return asyncio.run(self.run_async(request))

    async def run_async(self, request: dict[str, Any]) -> dict[str, Any]:
        lock = self._get_run_lock()
        try:
            async with lock:
                state = await self._framework_runner.run(request)
                self._executed_steps = self._framework_runner.executed_steps
        except ConversationWorkflowError:
            raise
        except Exception as error:
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=True,
                fallback_allowed=True,
                message="MAF core workflow failed safely.",
            ) from error

        return self._result_from_state(state)

    def _get_run_lock(self) -> asyncio.Lock:
        if self._run_lock is None:
            self._run_lock = asyncio.Lock()
        return self._run_lock

    def _run_sync(self, request: dict[str, Any]) -> dict[str, Any]:
        self._executed_steps = []
        state: ConversationWorkflowState = {
            "request": request,
            "memoryCandidates": [],
            "proposedActions": [],
            "toolCalls": 0,
        }

        try:
            for step in self._steps:
                self._executed_steps.append(step.name)
                state = step.handler(state)
        except ConversationWorkflowError:
            raise
        except Exception as error:
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=True,
                fallback_allowed=True,
                message="MAF core workflow failed safely.",
            ) from error

        return self._result_from_state(state)

    def _build_default_steps(self) -> list[ConversationWorkflowStep]:
        return [
            ConversationWorkflowStep(name="load_context", handler=self._load_context),
            ConversationWorkflowStep(name="classify_intent", handler=self._classify_intent),
            ConversationWorkflowStep(name="detect_risk", handler=self._detect_risk),
            ConversationWorkflowStep(name="extract_memory", handler=self._extract_memory),
            ConversationWorkflowStep(
                name="apply_deterministic_policy",
                handler=self._apply_deterministic_policy,
            ),
            ConversationWorkflowStep(name="generate_response", handler=self._generate_response),
            ConversationWorkflowStep(name="plan_follow_up", handler=self._plan_follow_up),
            ConversationWorkflowStep(name="validate_actions", handler=self._validate_actions),
            ConversationWorkflowStep(name="prepare_result", handler=self._prepare_result),
        ]

    def _load_context(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        context = request.get("context")
        if not isinstance(context, dict):
            raise ConversationWorkflowError(
                error_category="validation_error",
                retryable=False,
                fallback_allowed=True,
                message="Runtime request context is invalid.",
            )

        state["contextSummary"] = {
            "recentTurnCount": len(context.get("recentTurns", []))
            if isinstance(context.get("recentTurns"), list)
            else 0,
            "memoryItemCount": len(context.get("memoryItems", []))
            if isinstance(context.get("memoryItems"), list)
            else 0,
            "goalCount": len(context.get("goals", []))
            if isinstance(context.get("goals"), list)
            else 0,
        }
        return state

    async def _load_context_from_tool(
        self,
        state: ConversationWorkflowState,
    ) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        state["toolCalls"] = int(state.get("toolCalls", 0)) + 1
        if self._context_tool is None:
            return self._load_context(state)

        context = await self._context_tool.read_context(request)
        state["context"] = context
        state["contextSummary"] = {
            "recentTurnCount": len(context.get("recentTurns", []))
            if isinstance(context.get("recentTurns"), list)
            else 0,
            "memoryItemCount": len(context.get("memoryItems", []))
            if isinstance(context.get("memoryItems"), list)
            else 0,
            "goalCount": len(context.get("goals", []))
            if isinstance(context.get("goals"), list)
            else 0,
        }
        return state

    def _classify_intent(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        message = request.get("message")
        message_text = message.get("text") if isinstance(message, dict) else None
        message_text_value = self._safe_string(message_text)
        primary_intent = self._infer_situation_intent(message_text)
        urgency = self._classify_urgency(primary_intent)
        latest_user_substance = self._latest_user_substance(message_text_value)
        dialogue_act = self._infer_dialogue_act(message_text_value, latest_user_substance)
        topic_anchor = self._infer_topic_anchor(
            latest_user_substance,
            request.get("context"),
        )

        state["intent"] = primary_intent
        state["classification"] = {
            "primaryIntent": primary_intent,
            "secondaryIntents": [],
            "emotionalState": [],
            "urgency": urgency,
            "confidence": 0.62,
            "requiresSafetyCheck": primary_intent in {"potential_crisis", "burnout_signal", "harassment_signal", "conflict"},
            "surveyAllowed": primary_intent not in {"potential_crisis", "burnout_signal", "harassment_signal"},
            "reasoningSummary": f"Python workflow classified intent as {primary_intent}.",
            "reminderRequest": None,
            "dialogueAct": dialogue_act,
            "latestUserSubstance": latest_user_substance,
            "topicAnchor": topic_anchor,
        }
        return state

    def _infer_situation_intent(self, message_text: Any) -> str:
        message_text_value = self._safe_string(message_text)
        if not message_text_value:
            return "casual_conversation"

        normalized = message_text_value.lower()
        if "how are you" in normalized or "thank" in normalized or "appreciate" in normalized:
            return "feedback_request"
        if "goal" in normalized or "plan" in normalized or "milestone" in normalized:
            return "goal_setting"
        if "harass" in normalized or "bully" in normalized or "discriminat" in normalized:
            return "harassment_signal"
        if "crisis" in normalized or "danger" in normalized or "hurt myself" in normalized:
            return "potential_crisis"
        if "conflict" in normalized or "argument" in normalized:
            return "conflict"
        if "feedback" in normalized:
            return "feedback_request"
        if "coach" in normalized or "help me" in normalized:
            return "coaching"
        if "survey" in normalized:
            return "survey_opportunity"
        return "casual_conversation"

    def _classify_urgency(self, primary_intent: str) -> str:
        if primary_intent == "potential_crisis":
            return "critical"
        if primary_intent in {"burnout_signal", "harassment_signal"}:
            return "high"
        return "low"

    def _detect_risk(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        risk_signals = self._risk_signals_from_state(state)
        if risk_signals:
            strongest_signal = max(
                risk_signals,
                key=lambda signal: RISK_SEVERITY_ORDER.get(
                    self._risk_severity(signal.get("severity")),
                    0,
                ),
            )
            signal_type = self._safe_risk_type(strongest_signal.get("type"))
            severity = self._risk_severity(strongest_signal.get("severity"))
            confidence = self._confidence(strongest_signal.get("confidence"))
            recommended_action = self._safe_string(
                strongest_signal.get("recommendedAction"),
            )
            proactive_pause = severity in {"high", "critical"} or (
                recommended_action == "pause_proactive_messages"
            )
            survey_blocked = severity in {"high", "critical"}
            safe_signal_type = signal_type or "detected"
            evidence = [f"risk_signal:{safe_signal_type}"]
            if proactive_pause:
                evidence.append("policy:proactive_messages_paused")

            state["riskAssessment"] = {
                "type": safe_signal_type,
                "severity": severity,
                "confidence": confidence,
                "evidence": evidence,
                "immediateResponseRequired": severity == "critical",
                "escalationRecommended": severity in {"high", "critical"},
                "surveyMustBeBlocked": survey_blocked,
                "proactiveMessagesMustBePaused": proactive_pause,
            }
            return state

        state["riskAssessment"] = {
            "type": None,
            "severity": "none",
            "confidence": 0,
            "evidence": [],
            "immediateResponseRequired": False,
            "escalationRecommended": False,
            "surveyMustBeBlocked": False,
            "proactiveMessagesMustBePaused": False,
        }
        return state

    def _extract_memory(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        message = request.get("message")
        message_id = message.get("id") if isinstance(message, dict) else None
        message_text = message.get("text") if isinstance(message, dict) else None
        if (
            not isinstance(message_id, str)
            or not message_id
            or self._contains_sensitive_text(message_text)
        ):
            state["memoryCandidates"] = []
            return state

        state["memoryCandidates"] = [
            {
                "actionId": f"memory-candidate-{message_id}",
                "type": "conversation_signal",
                "content": "Candidate memory proposed from current conversation turn.",
                "confidence": 0.4,
                "sensitivity": "normal",
                "sourceMessageIds": [message_id],
            },
        ]
        return state

    def _apply_deterministic_policy(
        self,
        state: ConversationWorkflowState,
    ) -> ConversationWorkflowState:
        risk = state.get("riskAssessment")
        context = self._context_from_state(state)
        reason_codes: list[str] = []
        if isinstance(risk, dict) and risk.get("surveyMustBeBlocked") is True:
            reason_codes.append("RISK_SURVEY_BLOCKED")
        if (
            isinstance(risk, dict)
            and risk.get("proactiveMessagesMustBePaused") is True
        ):
            reason_codes.append("RISK_PROACTIVE_MESSAGES_PAUSED")
        if self._proactive_messaging_disabled(context):
            reason_codes.append("PROACTIVE_MESSAGING_DISABLED")

        state["policyDecision"] = "block_proactive_follow_up" if reason_codes else "allow"
        state["policyReasonCodes"] = reason_codes
        return state

    def _generate_response(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        reply_text = "MAF candidate response prepared for shadow comparison."
        state["reply"] = {
            "text": reply_text,
            "mode": "candidate",
            **self._reply_metadata_for_request(state, reply_text),
        }
        return state

    async def _generate_response_from_model(
        self,
        state: ConversationWorkflowState,
    ) -> ConversationWorkflowState:
        if self._model_client is None:
            return self._generate_response(state)
        try:
            reply = await self._model_client.generate_reply(
                self._request_from_state(state),
                state,
            )
        except UnsafeConversationModelOutputError as error:
            state["modelCalls"] = int(state.get("modelCalls", 0)) + 1
            raise ConversationWorkflowError(
                error_category="unsafe_partial_result",
                retryable=False,
                fallback_allowed=True,
                message="MAF model provider produced an unsafe result.",
            ) from error
        except ConversationModelProviderTimeoutError as error:
            state["modelCalls"] = int(state.get("modelCalls", 0)) + 1
            raise ConversationWorkflowError(
                error_category="timeout",
                retryable=True,
                fallback_allowed=True,
                message="MAF model provider timed out safely.",
            ) from error
        except ConversationModelProviderError as error:
            state["modelCalls"] = int(state.get("modelCalls", 0)) + 1
            raise ConversationWorkflowError(
                error_category="dependency_failed",
                retryable=True,
                fallback_allowed=True,
                message="MAF model provider failed safely.",
            ) from error

        state["modelCalls"] = int(state.get("modelCalls", 0)) + 1
        state["reply"] = {
            "text": reply.text,
            "mode": "candidate",
            **self._reply_metadata_for_request(state, reply.text),
        }
        return state

    def _reply_metadata_for_request(
        self,
        state: ConversationWorkflowState,
        reply_text: str,
    ) -> dict[str, Any]:
        request = self._request_from_state(state)
        if request.get("requestPurpose") != "proactive_check_in":
            return {}

        proactive_context = request.get("proactiveContext")
        if not isinstance(proactive_context, dict):
            return {}

        probe_question = proactive_context.get("probeQuestion")
        if not isinstance(probe_question, dict):
            return {}

        question_id = probe_question.get("id")
        if not isinstance(question_id, str) or not question_id.strip():
            return {}

        if not _reply_contains_probe_content(reply_text, probe_question):
            return {}

        return {
            "metadata": {
                "containsSurveyProbe": True,
                "surveyProbeQuestionId": question_id,
            },
        }

    def _plan_follow_up(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        message = request.get("message")
        message_id = message.get("id") if isinstance(message, dict) else None
        created_at = message.get("createdAt") if isinstance(message, dict) else None
        execute_at = self._follow_up_execute_at(created_at)
        if not isinstance(message_id, str) or execute_at is None:
            state["plannedFollowUps"] = []
            return state

        state["plannedFollowUps"] = [
            {
                "actionId": f"schedule-follow-up-{message_id}",
                "aggregateType": "follow_up",
                "actionType": "schedule_follow_up",
                "idempotencyKey": f"action:schedule-follow-up-{message_id}",
                "payload": {
                    "executeAt": execute_at,
                    "intent": "candidate_follow_up",
                    "deduplicationKey": f"followup:{message_id}",
                },
                "validationResult": {
                    "status": "pending",
                    "reasonCodes": [],
                },
                "executionStatus": "not_started",
                "commitMarker": None,
            },
        ]
        return state

    def _validate_actions(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        actions = [
            *self._memory_actions_from_state(state),
            *self._goal_actions_from_state(state),
            *self._follow_up_actions_from_state(state),
        ]
        state["proposedActions"] = [
            self._policy_validated_action(state, action) for action in actions
        ]
        return state

    def _prepare_result(self, state: ConversationWorkflowState) -> ConversationWorkflowState:
        request = self._request_from_state(state)
        result: dict[str, Any] = {
            "reply": state["reply"],
            "riskAssessment": state["riskAssessment"],
            "memoryCandidates": state["memoryCandidates"],
            "proposedActions": state["proposedActions"],
            "classification": state["classification"],
            "diagnostics": {
                "traceId": request["traceId"],
                "runtimeVersion": f"agent-service-maf-core/{agent_framework.__version__}",
                "runtimeAttempt": request["runtimeAttempt"],
                "modelCalls": int(state.get("modelCalls", 0)),
                "toolCalls": int(state.get("toolCalls", 0)),
                "latencyMs": 0,
                "retryCount": 0,
                "modelRetryCount": int(state.get("modelRetryCount", 0)),
                "toolRetryCount": 0,
                "httpRetryCount": 0,
            },
        }
        state["result"] = result
        return state

    def _context_from_state(self, state: ConversationWorkflowState) -> dict[str, Any]:
        context = state.get("context")
        if isinstance(context, dict):
            return context
        request = self._request_from_state(state)
        request_context = request.get("context")
        return request_context if isinstance(request_context, dict) else {}

    def _risk_signals_from_state(
        self,
        state: ConversationWorkflowState,
    ) -> list[dict[str, Any]]:
        context = self._context_from_state(state)
        risk_signals = context.get("riskSignals")
        if not isinstance(risk_signals, list):
            return []
        return [signal for signal in risk_signals if isinstance(signal, dict)]

    def _memory_actions_from_state(
        self,
        state: ConversationWorkflowState,
    ) -> list[dict[str, Any]]:
        actions: list[dict[str, Any]] = []
        for candidate in state.get("memoryCandidates", []):
            if not isinstance(candidate, dict):
                continue
            candidate_id = candidate.get("actionId")
            if not isinstance(candidate_id, str) or not candidate_id:
                continue
            message_id = self._message_id_from_state(state)
            if message_id is None:
                continue
            actions = [
                *actions,
                {
                    "actionId": f"save-memory-{message_id}",
                    "aggregateType": "memory",
                    "actionType": "save_memory",
                    "idempotencyKey": f"action:save-memory-{message_id}",
                    "payload": {"memoryCandidateId": candidate_id},
                    "validationResult": {
                        "status": "pending",
                        "reasonCodes": [],
                    },
                    "executionStatus": "not_started",
                    "commitMarker": None,
                },
            ]
        return actions

    def _goal_actions_from_state(
        self,
        state: ConversationWorkflowState,
    ) -> list[dict[str, Any]]:
        context = self._context_from_state(state)
        goals = context.get("goals")
        if not isinstance(goals, list):
            return []
        for goal in goals:
            if not isinstance(goal, dict):
                continue
            if not self._has_supported_goal_change_signal(goal):
                continue
            goal_id = goal.get("id")
            if not isinstance(goal_id, str) or not self._is_uuid(goal_id):
                continue
            return [
                {
                    "actionId": f"update-goal-{goal_id}",
                    "aggregateType": "goal",
                    "actionType": "update_goal",
                    "idempotencyKey": f"action:update-goal-{goal_id}",
                    "payload": {
                        "goalId": goal_id,
                        "changes": {"status": "active"},
                    },
                    "validationResult": {
                        "status": "pending",
                        "reasonCodes": [],
                    },
                    "executionStatus": "not_started",
                    "commitMarker": None,
                },
            ]
        return []

    def _follow_up_actions_from_state(
        self,
        state: ConversationWorkflowState,
    ) -> list[dict[str, Any]]:
        planned = state.get("plannedFollowUps")
        if not isinstance(planned, list):
            return []
        return [action for action in planned if isinstance(action, dict)]

    def _policy_validated_action(
        self,
        state: ConversationWorkflowState,
        action: dict[str, Any],
    ) -> dict[str, Any]:
        reason_codes = state.get("policyReasonCodes")
        if action.get("actionType") != "schedule_follow_up" or not isinstance(
            reason_codes,
            list,
        ) or not reason_codes:
            return action

        return {
            **action,
            "validationResult": {
                "status": "invalid",
                "reasonCodes": reason_codes,
                "message": "Deterministic policy blocked proactive follow-up.",
            },
            "executionStatus": "blocked",
            "commitMarker": None,
        }

    def _message_id_from_state(self, state: ConversationWorkflowState) -> str | None:
        request = self._request_from_state(state)
        message = request.get("message")
        message_id = message.get("id") if isinstance(message, dict) else None
        return message_id if isinstance(message_id, str) and message_id else None

    def _follow_up_execute_at(self, created_at: Any) -> str | None:
        if not isinstance(created_at, str):
            return None
        try:
            parsed = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError:
            return None

        execute_at = parsed + timedelta(days=1)
        return execute_at.astimezone(UTC).isoformat().replace("+00:00", "Z")

    def _risk_severity(self, value: Any) -> str:
        if isinstance(value, str) and value in RISK_SEVERITY_ORDER:
            return value
        return "none"

    def _confidence(self, value: Any) -> float:
        if isinstance(value, int | float) and not isinstance(value, bool):
            return max(0, min(1, float(value)))
        return 0

    def _safe_string(self, value: Any) -> str | None:
        if isinstance(value, str) and value:
            return value
        return None

    def _latest_user_substance(self, message_text: str | None) -> str | None:
        if not isinstance(message_text, str):
            return None

        cleaned = message_text.strip()
        if not cleaned:
            return None

        if self._contains_sensitive_text(cleaned):
            return None

        if self._looks_like_acknowledgement(cleaned):
            return None

        latest_user_substance = cleaned[:240]
        return latest_user_substance if latest_user_substance else None

    def _looks_like_acknowledgement(self, value: str) -> bool:
        normalized = re.sub(r"[^a-z0-9 ]", " ", value.lower()).strip()
        if not normalized:
            return False
        if normalized in ACKNOWLEDGEMENT_MARKERS:
            return True

        return any(
            normalized.startswith(f"{marker} ")
            for marker in ACKNOWLEDGEMENT_MARKERS
            if marker not in {"got it", "all good"}
        )

    def _infer_dialogue_act(
        self,
        message_text: str | None,
        latest_user_substance: str | None,
    ) -> str:
        if not isinstance(message_text, str):
            return "new_substance"

        if latest_user_substance is None and self._looks_like_acknowledgement(message_text):
            return "acknowledgement"

        lowered = message_text.lower()
        if any(keyword in lowered for keyword in EMOTIONAL_KEYWORDS):
            return "emotional_disclosure"
        if "?" in message_text:
            return "request"

        return "new_substance"

    def _infer_topic_anchor(
        self,
        latest_user_substance: str | None,
        context: Any,
    ) -> str | None:
        if latest_user_substance is not None:
            return None
        if not isinstance(context, dict):
            return None

        recent_turns = context.get("recentTurns")
        if not isinstance(recent_turns, list):
            return None

        for turn in reversed(recent_turns):
            if not isinstance(turn, dict):
                continue
            if turn.get("role") != "user":
                continue
            content = self._safe_string(turn.get("content"))
            if not content:
                continue
            if self._contains_sensitive_text(content):
                continue
            return content[:140]

        return None

    def _safe_risk_type(self, value: Any) -> str | None:
        if isinstance(value, str) and value in SAFE_RISK_TYPES:
            return value
        return None

    def _contains_sensitive_text(self, value: Any) -> bool:
        if not isinstance(value, str):
            return False
        normalized = value.lower()
        return any(marker in normalized for marker in SENSITIVE_TEXT_MARKERS)

    def _proactive_messaging_disabled(self, context: dict[str, Any]) -> bool:
        user_profile = context.get("userProfile")
        if not isinstance(user_profile, dict):
            return False
        return user_profile.get("proactiveMessagingEnabled") is False

    def _has_supported_goal_change_signal(self, goal: dict[str, Any]) -> bool:
        return goal.get("candidateStatus") == "active"

    def _is_uuid(self, value: str) -> bool:
        try:
            UUID(value)
        except ValueError:
            return False
        return True

    def _result_from_state(self, state: ConversationWorkflowState) -> dict[str, Any]:
        result = state.get("result")
        if not isinstance(result, dict):
            raise ConversationWorkflowError(
                error_category="unsafe_partial_result",
                retryable=False,
                fallback_allowed=True,
                message="MAF core workflow produced an unsafe result.",
            )
        if validate_runtime_result(result) != {"ok": True}:
            raise ConversationWorkflowError(
                error_category="unsafe_partial_result",
                retryable=False,
                fallback_allowed=True,
                message="MAF core workflow produced an unsafe result.",
            )

        return result

    def _request_from_state(self, state: ConversationWorkflowState) -> dict[str, Any]:
        request = state.get("request")
        if not isinstance(request, dict):
            raise ConversationWorkflowError(
                error_category="validation_error",
                retryable=False,
                fallback_allowed=True,
                message="Runtime request is invalid.",
            )
        return request


class MicrosoftAgentFrameworkWorkflowRunner:
    def __init__(
        self,
        *,
        steps: Sequence[ConversationWorkflowStep],
        context_tool: ContextTool | None,
        load_context_from_tool: Callable[
            [ConversationWorkflowState],
            Awaitable[ConversationWorkflowState],
        ],
        generate_response_from_model: Callable[
            [ConversationWorkflowState],
            Awaitable[ConversationWorkflowState],
        ],
        model_client: ConversationModelClient | None,
    ) -> None:
        self._executor = MicrosoftAgentFrameworkConversationExecutor(
            steps=steps,
            context_tool=context_tool,
            load_context_from_tool=load_context_from_tool,
            generate_response_from_model=generate_response_from_model,
            model_client=model_client,
        )

    @property
    def framework_name(self) -> str:
        return "agent_framework"

    @property
    def executed_steps(self) -> list[ConversationWorkflowStepName]:
        return self._executor.executed_steps

    async def run(self, request: dict[str, Any]) -> ConversationWorkflowState:
        self._executor.reset()
        workflow = WorkflowBuilder(
            name="entalent-conversation-turn",
            description="Contract-preserving MAF core workflow for one conversation turn.",
            start_executor=self._executor,
            output_from=[self._executor],
        ).build()
        result = await workflow.run(request)
        outputs = result.get_outputs()
        if len(outputs) != 1 or not isinstance(outputs[0], dict):
            raise ConversationWorkflowError(
                error_category="unsafe_partial_result",
                retryable=False,
                fallback_allowed=True,
                message="MAF core workflow produced an unsafe result.",
            )

        return cast(ConversationWorkflowState, outputs[0])


class MicrosoftAgentFrameworkConversationExecutor(Executor):
    def __init__(
        self,
        *,
        steps: Sequence[ConversationWorkflowStep],
        context_tool: ContextTool | None,
        load_context_from_tool: Callable[
            [ConversationWorkflowState],
            Awaitable[ConversationWorkflowState],
        ],
        generate_response_from_model: Callable[
            [ConversationWorkflowState],
            Awaitable[ConversationWorkflowState],
        ],
        model_client: ConversationModelClient | None,
    ) -> None:
        self._steps = list(steps)
        self._context_tool = context_tool
        self._load_context_from_tool = load_context_from_tool
        self._generate_response_from_model = generate_response_from_model
        self._model_client = model_client
        self._executed_steps: list[ConversationWorkflowStepName] = []
        self._logger = logging.getLogger(__name__)
        super().__init__(id="conversation_turn")

    @property
    def executed_steps(self) -> list[ConversationWorkflowStepName]:
        return list(self._executed_steps)

    def reset(self) -> None:
        self._executed_steps = []

    @handler
    async def process(
        self,
        request: dict[str, Any],
        ctx: WorkflowContext[Never, ConversationWorkflowState],
    ) -> None:
        state: ConversationWorkflowState = {
            "request": request,
            "memoryCandidates": [],
            "proposedActions": [],
            "toolCalls": 0,
        }

        for step in self._steps:
            self._executed_steps.append(step.name)
            if step.name == "load_context" and self._context_tool is not None:
                try:
                    state = await self._load_context_from_tool(state)
                except Exception as error:
                    self._logger.warning(
                        "Workflow step failed",
                        extra={
                            "step": "load_context",
                            "trace_id": _trace_id_from_state(state),
                            "error": error.__class__.__name__,
                        },
                    )
                    raise
            elif step.name == "generate_response" and self._model_client is not None:
                try:
                    state = await self._generate_response_from_model(state)
                except Exception as error:
                    self._logger.warning(
                        "Workflow step failed",
                        extra={
                            "step": "generate_response",
                            "trace_id": _trace_id_from_state(state),
                            "error": error.__class__.__name__,
                        },
                    )
                    raise
            else:
                state = step.handler(state)

        await ctx.yield_output(state)


def _trace_id_from_state(state: ConversationWorkflowState) -> str | None:
    request = state.get("request")
    if isinstance(request, dict):
        trace_id = request.get("traceId")
        if isinstance(trace_id, str) and trace_id:
            return trace_id
    return None


def _reply_contains_probe_content(reply_text: str, probe_question: dict[str, Any]) -> bool:
    reply_tokens = _significant_probe_tokens(reply_text)
    if not reply_tokens:
        return False

    title = probe_question.get("title")
    title_tokens = _significant_probe_tokens(title) if isinstance(title, str) else set()
    if title_tokens and len(reply_tokens & title_tokens) >= min(2, len(title_tokens)):
        return True

    strategies = probe_question.get("probeStrategies")
    if not isinstance(strategies, Sequence) or isinstance(strategies, (str, bytes)):
        return False

    for strategy in strategies:
        if not isinstance(strategy, str):
            continue
        strategy_tokens = _significant_probe_tokens(strategy)
        if len(strategy_tokens) < 2:
            continue
        if len(reply_tokens & strategy_tokens) >= min(3, len(strategy_tokens)):
            return True

    return False


def _significant_probe_tokens(value: str) -> set[str]:
    stop_words = {
        "about",
        "ask",
        "does",
        "have",
        "internal",
        "like",
        "mention",
        "survey",
        "that",
        "this",
        "what",
        "when",
        "with",
        "your",
    }
    tokens: set[str] = set()
    for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_'-]{2,}", value.lower()):
        if token in stop_words:
            continue
        if len(token) > 3 and token.endswith("s"):
            token = token[:-1]
        tokens.add(token)
    return tokens
