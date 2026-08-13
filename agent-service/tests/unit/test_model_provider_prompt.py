from agent_service.workflows.model_provider import (
    build_candidate_reply_prompt,
    candidate_reply_policy_violations,
    has_reflective_reply_opener,
)


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
    assert "Start a short, human pulse check-in" in prompt
    assert "Do not force the probe" in prompt
    assert "Probe topic: Role Clarity." in prompt
    assert "Ask what success looks like this week." in prompt
    assert "Do not mention survey mechanics, assessment language" in prompt


def test_candidate_reply_prompt_includes_acknowledgement_policy() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "ok"},
            "context": {
                "memoryItems": [],
                "recentTurns": [
                    {"role": "user", "content": "there is too much to do, so no time to rest"},
                    {
                        "role": "assistant",
                        "content": "What is the smallest piece that can wait until tomorrow?",
                    },
                ],
                "replyPlan": {
                    "dialogueAct": "acknowledgement",
                    "latestUserSubstance": None,
                    "topicAnchor": "there is too much to do, so no time to rest",
                    "memoryAnchors": [],
                    "responseMove": "continue_existing_thread",
                    "mayInferFromBrevity": False,
                    "questionPolicy": {
                        "maxQuestions": 0,
                        "reason": "acknowledgement_no_new_substance",
                    },
                    "requiredGrounding": [],
                    "forbiddenMoves": ["comment_on_brevity"],
                },
                "replyPolicy": {
                    "maxChars": 180,
                    "maxQuestions": 0,
                    "allowReflectiveOpener": False,
                    "allowListFormatting": False,
                },
            },
        },
        state={
            "classification": {
                "dialogueAct": "acknowledgement",
                "latestUserSubstance": None,
                "topicAnchor": "there is too much to do, so no time to rest",
            },
            "riskAssessment": {"severity": "none"},
            "contextSummary": {"memoryItemCount": 0, "recentTurnCount": 2},
            "policyDecision": "allow",
        },
    )

    assert "acknowledgement: treat the latest message as a backchannel" in prompt
    assert "Do not say 'glad to hear back'" in prompt
    assert "Do not add a checklist or action plan" in prompt
    assert "there is too much to do, so no time to rest" in prompt
    assert "reply constraints: max 180 characters" in prompt
    assert "ask zero questions" in prompt
    assert "reason: acknowledgement_no_new_substance" in prompt
    assert "replyPlan: dialogueAct=acknowledgement" in prompt


def test_candidate_reply_prompt_bans_generic_assistant_moves() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "there is too much to do, so no time to rest"},
            "context": {"memoryItems": [], "recentTurns": []},
        },
        state={
            "classification": {
                "dialogueAct": "emotional_disclosure",
                "latestUserSubstance": "there is too much to do, so no time to rest",
            },
            "riskAssessment": {"severity": "none"},
            "policyDecision": "allow",
        },
    )

    assert "do not paraphrase the employee back to themselves" in prompt
    assert "Do not open with formulaic validation" in prompt
    assert "Do not use bullets, numbered steps, productivity frameworks" in prompt


def test_candidate_reply_policy_violations_find_old_provider_gates() -> None:
    violations = candidate_reply_policy_violations(
        text=(
            "That, it seems, is the real root: overload.\n"
            "- First, write a plan?\n"
            "- Then align with your manager?"
        ),
        request={
            "message": {"text": "ok"},
            "context": {
                "memoryItems": [],
                "recentTurns": [],
                "replyPolicy": {
                    "maxChars": 180,
                    "maxQuestions": 0,
                    "allowReflectiveOpener": False,
                    "allowListFormatting": False,
                },
            },
        },
        state={
            "classification": {
                "dialogueAct": "acknowledgement",
                "latestUserSubstance": None,
            },
            "riskAssessment": {"severity": "none"},
        },
    )

    assert violations == [
        "open with substance, not formulaic validation or paraphrase",
        "ask no questions in this turn",
        "remove bullets, numbered steps, and checklist formatting",
    ]


def test_reflective_reply_opener_matches_old_provider_antipatterns() -> None:
    assert has_reflective_reply_opener(
        "That, it seems, is the real root: decisions keep bouncing."
    )
    assert has_reflective_reply_opener("Sounds like a classic overload.")
    assert has_reflective_reply_opener("What you're describing is burnout.")
    assert has_reflective_reply_opener("That's the real root of it.")
    assert not has_reflective_reply_opener("That sounds hard.")
    assert not has_reflective_reply_opener(
        "Your role seems clear enough, but decisions still route through Roma."
    )
