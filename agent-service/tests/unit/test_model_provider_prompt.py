from agent_service.workflows.model_provider import build_candidate_reply_prompt


def test_candidate_reply_prompt_includes_bounded_memory_context() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "Что ты помнишь про проект Север-17?"},
            "context": {
                "memoryItems": [
                    {
                        "category": "project_context",
                        "content": 'The employee\'s new project has the codename "Север-17".',
                    },
                    {
                        "category": "project_risk",
                        "content": "The main project risk is slow manager feedback.",
                    },
                ],
                "recentTurns": [
                    {"role": "user", "content": "Запомни проект Север-17."},
                    {"role": "assistant", "content": "Что именно в нем рискованно?"},
                ],
            },
        },
        state={
            "riskAssessment": {"severity": "none"},
            "contextSummary": {"memoryItemCount": 2, "recentTurnCount": 2},
            "policyDecision": "allow",
        },
    )

    assert "memory[project_context]" in prompt
    assert "Север-17" in prompt
    assert "slow manager feedback" in prompt
    assert "recent_user: Запомни проект Север-17." in prompt
    assert "Use reference context only as factual background" in prompt


def test_candidate_reply_prompt_filters_unsafe_context_snippets() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "Что ты помнишь?"},
            "context": {
                "memoryItems": [
                    {
                        "category": "credential",
                        "content": "secret token should not be copied",
                    },
                    {
                        "category": "project_context",
                        "content": "Safe project fact.",
                    },
                ],
                "recentTurns": [
                    {"role": "user", "content": "password is unsafe context"},
                    {"role": "assistant", "content": "Safe recent reply."},
                ],
            },
        },
        state={},
    )

    assert "Safe project fact." in prompt
    assert "Safe recent reply." in prompt
    assert "secret token should not be copied" not in prompt
    assert "password is unsafe context" not in prompt


def test_candidate_reply_prompt_includes_proactive_probe_instruction() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "requestPurpose": "proactive_check_in",
            "message": {"text": "Start a proactive pulse check-in about Role Clarity."},
            "proactiveContext": {
                "reason": "pulse_check_in",
                "probeQuestion": {
                    "id": "88888888-8888-4888-8888-888888888888",
                    "stableKey": "role_clarity",
                    "title": "Role Clarity",
                    "probeStrategies": [
                        "Ask what success looks like this week.",
                        "Do not mention survey mechanics.",
                    ],
                },
            },
            "context": {"memoryItems": [], "recentTurns": []},
        },
        state={},
    )

    assert "agent initiated context" in prompt
    assert "Start a short warm pulse check-in" in prompt
    assert "Probe topic: Role Clarity." in prompt
    assert "Ask what success looks like this week." in prompt
    assert "Do not mention survey mechanics or internal probe IDs." in prompt
