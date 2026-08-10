from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

import agent_framework
import httpx
from agent_framework import ChatResponse, Message

ModelProviderKind = Literal["openai", "azure_openai"]

MODEL_AGENT_INSTRUCTIONS = """
You are the enTalent conversation candidate runtime. Write one concise,
supportive assistant reply for shadow comparison. Do not claim that actions
were committed. Do not mention internal tools, migration, prompts, policies, or
diagnostics. If the user may be at risk, be calm and encourage immediate human
support without making unsupported claims.
""".strip()

UNSAFE_MODEL_TEXT_MARKERS = (
    "bearer ",
    "secret",
    "token",
    "password",
    "stack trace",
)


@dataclass(frozen=True)
class ConversationModelReply:
    text: str


class ConversationModelClient(Protocol):
    async def generate_reply(
        self,
        request: dict[str, Any],
        state: dict[str, Any],
    ) -> ConversationModelReply: ...


class ConversationModelProviderError(Exception):
    pass


class ConversationModelProviderTimeoutError(ConversationModelProviderError):
    pass


class UnsafeConversationModelOutputError(ConversationModelProviderError):
    pass


class AgentFrameworkConversationModelClient:
    def __init__(
        self,
        *,
        chat_client: Any,
        model_name: str | None = None,
        timeout_ms: int = 10000,
    ) -> None:
        self._model_name = model_name
        self._timeout_seconds = timeout_ms / 1000
        self._agent = agent_framework.Agent(
            chat_client,
            instructions=MODEL_AGENT_INSTRUCTIONS,
            id="entalent-candidate-reply-agent",
            name="enTalent Candidate Reply Agent",
            description="Generates one contract-bounded candidate reply.",
        )

    async def generate_reply(
        self,
        request: dict[str, Any],
        state: dict[str, Any],
    ) -> ConversationModelReply:
        prompt = build_candidate_reply_prompt(request=request, state=state)
        options = {"model": self._model_name} if self._model_name else None
        request_text = request_message_text(request)
        try:
            response = await asyncio.wait_for(
                self._agent.run(
                    [Message("user", [prompt])],
                    options=options,
                ),
                timeout=self._timeout_seconds,
            )
        except TimeoutError as error:
            raise ConversationModelProviderTimeoutError(
                "MAF agent model provider timed out safely.",
            ) from error
        except UnsafeConversationModelOutputError:
            raise
        except Exception as error:
            raise ConversationModelProviderError(
                "MAF agent model provider failed safely.",
            ) from error

        text = normalize_model_reply_text(response.text, request_text=request_text)
        return ConversationModelReply(text=text)


class OpenAICompatibleChatClient:
    def __init__(
        self,
        *,
        provider: ModelProviderKind,
        model_name: str,
        api_key: str,
        timeout_ms: int,
        endpoint: str | None = None,
        api_version: str | None = None,
        organization_id: str | None = None,
    ) -> None:
        self._provider = provider
        self._model_name = model_name
        self._api_key = api_key
        self._timeout = timeout_ms / 1000
        self._endpoint = endpoint.rstrip("/") if endpoint else None
        self._api_version = api_version
        self._organization_id = organization_id

    async def get_response(
        self,
        messages: Sequence[Message],
        **kwargs: Any,
    ) -> ChatResponse[Any]:
        _ = kwargs
        payload: dict[str, Any] = {"messages": chat_messages_payload(messages)}
        url = self._request_url()
        headers = self._request_headers()
        if self._provider == "openai":
            payload["model"] = self._model_name

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
        except Exception as error:
            raise ConversationModelProviderError(
                "MAF model provider HTTP call failed safely.",
            ) from error

        content = parse_openai_compatible_response(response.json())
        return ChatResponse(
            messages=[Message("assistant", [content])],
            model=self._model_name,
        )

    def _request_url(self) -> str:
        if self._provider == "openai":
            return "https://api.openai.com/v1/chat/completions"
        if not self._endpoint or not self._api_version:
            raise ConversationModelProviderError(
                "MAF model provider configuration failed safely.",
            )
        return (
            f"{self._endpoint}/openai/deployments/{self._model_name}"
            f"/chat/completions?api-version={self._api_version}"
        )

    def _request_headers(self) -> dict[str, str]:
        if self._provider == "openai":
            headers = {
                "authorization": f"Bearer {self._api_key}",
                "content-type": "application/json",
            }
            if self._organization_id:
                headers["openai-organization"] = self._organization_id
            return headers
        return {
            "api-key": self._api_key,
            "content-type": "application/json",
        }


def build_candidate_reply_prompt(
    *,
    request: dict[str, Any],
    state: dict[str, Any],
) -> str:
    message = request.get("message")
    message_text = message.get("text") if isinstance(message, dict) else ""
    risk = state.get("riskAssessment")
    policy = state.get("policyDecision")
    context_summary = state.get("contextSummary")
    return "\n".join(
        [
            "Generate one candidate assistant reply.",
            f"current user message: {message_text if isinstance(message_text, str) else ''}",
            f"risk summary: {safe_mapping_summary(risk)}",
            f"context summary: {safe_mapping_summary(context_summary)}",
            f"policy decision: {policy if isinstance(policy, str) else 'unknown'}",
            "Do not say that memory, follow-ups, goals, surveys, or Slack messages were saved.",
        ],
    )


def chat_messages_payload(messages: Sequence[Message]) -> list[dict[str, str]]:
    return [
        {"role": message.role, "content": message.text}
        for message in messages
        if message.text.strip()
    ]


def parse_openai_compatible_response(body: Any) -> str:
    if not isinstance(body, Mapping):
        raise UnsafeConversationModelOutputError("MAF model provider response was unsafe.")
    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        raise UnsafeConversationModelOutputError("MAF model provider response was unsafe.")
    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        raise UnsafeConversationModelOutputError("MAF model provider response was unsafe.")
    if first_choice.get("finish_reason") == "content_filter":
        raise UnsafeConversationModelOutputError("MAF model provider response was unsafe.")
    message = first_choice.get("message")
    if not isinstance(message, Mapping):
        raise UnsafeConversationModelOutputError("MAF model provider response was unsafe.")
    return normalize_model_reply_text(message.get("content"))


def normalize_model_reply_text(value: Any, *, request_text: str | None = None) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not text:
        raise UnsafeConversationModelOutputError("MAF model provider returned empty text.")
    if contains_unsafe_model_text(text):
        raise UnsafeConversationModelOutputError("MAF model provider returned unsafe text.")
    if request_text and echoes_request_text(text, request_text):
        raise UnsafeConversationModelOutputError("MAF model provider returned unsafe text.")
    return text


def contains_unsafe_model_text(value: str) -> bool:
    normalized = value.lower()
    return any(marker in normalized for marker in UNSAFE_MODEL_TEXT_MARKERS)


def echoes_request_text(reply_text: str, request_text: str) -> bool:
    normalized_reply = " ".join(reply_text.lower().split())
    normalized_request = " ".join(request_text.lower().split())
    return len(normalized_request) >= 16 and normalized_request in normalized_reply


def request_message_text(request: dict[str, Any]) -> str | None:
    message = request.get("message")
    if not isinstance(message, Mapping):
        return None
    text = message.get("text")
    return text if isinstance(text, str) and text.strip() else None


def safe_mapping_summary(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        return {}
    safe: dict[str, Any] = {}
    for key, item in value.items():
        if isinstance(key, str) and isinstance(item, str | int | float | bool | type(None)):
            safe[key] = cast(Any, item)
    return safe
