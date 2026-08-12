from typing import Any

import pytest

from agent_service.workflows.model_provider import (
    UnsafeConversationModelOutputError,
    normalize_model_reply_text,
    parse_openai_compatible_response,
)


def test_openai_compatible_response_rejects_content_filter_finish_reason() -> None:
    body: dict[str, Any] = {
        "choices": [
            {
                "finish_reason": "content_filter",
                "message": {"content": "Filtered text"},
            }
        ]
    }

    with pytest.raises(UnsafeConversationModelOutputError):
        parse_openai_compatible_response(body)


def test_model_reply_rejects_direct_user_text_echo() -> None:
    with pytest.raises(UnsafeConversationModelOutputError):
        normalize_model_reply_text(
            "I need a private salary adjustment",
            request_text="I need a private salary adjustment",
        )


def test_openai_compatible_response_rejects_unsafe_payload_content() -> None:
    body: dict[str, Any] = {
        "choices": [
            {
                "message": {
                    "content": "Bearer secret-token in model reply payload",
                },
            },
        ],
    }

    with pytest.raises(UnsafeConversationModelOutputError):
        parse_openai_compatible_response(body)


def test_openai_compatible_response_rejects_empty_payload_content() -> None:
    body: dict[str, Any] = {
        "choices": [
            {
                "message": {"content": ""},
            },
        ],
    }

    with pytest.raises(UnsafeConversationModelOutputError):
        parse_openai_compatible_response(body)
