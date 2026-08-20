from agent_service.workflows.model_provider import (
    build_candidate_reply_prompt,
    candidate_reply_policy_violations,
)


def test_candidate_reply_prompt_includes_bounded_memory_context() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "What do you remember about project North-17?"},
            "context": {
                "memoryItems": [
                    {
                        "category": "project_context",
                        "content": 'The employee\'s new project has the codename "North-17".',
                    },
                    {
                        "category": "project_risk",
                        "content": "The main project risk is slow manager feedback.",
                    },
                ],
                "recentTurns": [
                    {"role": "user", "content": "Remember project North-17."},
                    {"role": "assistant", "content": "What exactly is risky there?"},
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
    assert "North-17" in prompt
    assert "slow manager feedback" in prompt
    assert "recent_user: Remember project North-17." in prompt
    assert "Use reference context only as factual background" in prompt


def test_candidate_reply_prompt_scopes_current_conversation_to_recent_turns() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "What do you know from this conversation?"},
            "context": {
                "memoryItems": [
                    {
                        "category": "scheduled_action",
                        "content": "Old reminder about manager priority ranking.",
                    },
                ],
                "recentTurns": [
                    {"role": "user", "content": "Today I am sorting a launch risk."},
                    {"role": "assistant", "content": "What risk is most exposed?"},
                ],
            },
        },
        state={},
    )

    assert "recent_user: Today I am sorting a launch risk." in prompt
    assert "recent_assistant: What risk is most exposed?" in prompt
    assert "Old reminder about manager priority ranking." not in prompt
    assert "memory[scheduled_action]" not in prompt


def test_candidate_reply_prompt_filters_unsafe_context_snippets() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "What do you remember?"},
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


def test_candidate_reply_prompt_filters_regression_control_markers() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "Hi"},
            "context": {
                "memoryItems": [
                    {
                        "category": "project_context",
                        "content": "Continue with main-memory-marker-20260812-0800.",
                    },
                    {
                        "category": "project_context",
                        "content": "Useful production context.",
                    },
                ],
                "recentTurns": [
                    {
                        "role": "assistant",
                        "content": (
                            "Production MAF regression says the control marker is "
                            "MAF-regression-20260813T102542Z-local."
                        ),
                    },
                    {"role": "user", "content": "Normal prior context."},
                ],
            },
        },
        state={},
    )

    assert "Useful production context." in prompt
    assert "Normal prior context." in prompt
    assert "main-memory-marker-20260812-0800" not in prompt
    assert "MAF-regression-20260813T102542Z-local" not in prompt
    assert "control marker" not in prompt


def test_candidate_reply_prompt_includes_bounded_style_context() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "Quick update please"},
            "context": {
                "memoryItems": [],
                "recentTurns": [],
                "styleAdaptation": {
                    "dimensions": {
                        "register": 1.8,
                        "humor": 0.45,
                        "verbosity": -0.25,
                        "emoji": 0.1,
                    },
                    "weight": 0.8,
                    "phrases": [
                        "quick read",
                        "net-net",
                        "secret token should not leak",
                    ],
                },
            },
        },
        state={},
    )

    assert "style: weight=0.40" in prompt
    assert "register=1.00" in prompt
    assert "verbosity=0.00" in prompt
    assert "quick read" in prompt
    assert "net-net" in prompt
    assert "secret token should not leak" not in prompt


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
            "context": {
                "memoryItems": [
                    {
                        "category": "project_context",
                        "content": (
                            "User is leading the onboarding rollout and cares "
                            "about clear ownership."
                        ),
                    },
                    {
                        "category": "communication_preference",
                        "content": "User prefers concise check-ins with one concrete question.",
                    },
                ],
                "recentTurns": [
                    {
                        "role": "assistant",
                        "content": (
                            "Last week you said the rollout was blocked by unclear "
                            "ownership."
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            "I am trying to define what success looks like for the "
                            "onboarding rollout."
                        ),
                    },
                ],
                "replyPolicy": {
                    "maxChars": 360,
                    "maxQuestions": 1,
                    "allowReflectiveOpener": False,
                    "allowListFormatting": False,
                },
            },
        },
        state={},
    )

    assert "agent initiated context" in prompt
    assert "Start a short, human pulse check-in" in prompt
    assert "Use the selected probe topic" in prompt
    assert "do not replace it with a generic check-in" in prompt
    assert "Probe topic: Role Clarity." in prompt
    assert "Ask what success looks like this week." in prompt
    assert "Do not mention survey mechanics, assessment language" in prompt
    assert "ask at most one question" in prompt
    assert "memory[project_context]" in prompt
    assert "onboarding rollout" in prompt
    assert "clear ownership" in prompt
    assert "memory[communication_preference]" in prompt
    assert "one concrete question" in prompt
    assert "recent_assistant: Last week you said the rollout was blocked" in prompt
    assert "recent_user: I am trying to define what success looks like" in prompt
    assert "Return only a compact JSON object" in prompt
    assert '"replyText":"assistant reply text","usesProbe":true|false' in prompt


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
                        "maxQuestions": 1,
                        "reason": "new_substance_allows_question",
                    },
                    "requiredGrounding": [],
                    "forbiddenMoves": ["comment_on_brevity"],
                },
                "replyPolicy": {
                    "maxChars": 180,
                    "maxQuestions": 1,
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
    assert "Continue one unresolved thread from the recent conversation" in prompt
    assert "end with exactly one specific follow-up question" in prompt
    assert "there is too much to do, so no time to rest" in prompt
    assert "reply constraints: max 180 characters" in prompt
    assert "ask at most one question" in prompt
    assert "reason: new_substance_allows_question" in prompt
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
    assert "Language invariant: reply in the employee's language" in prompt
    assert "If the current user message is in a different language" in prompt
    assert "If the employee asks what you know from this conversation" in prompt
    assert "Do not open with formulaic validation" in prompt
    assert "Do not use bullets, numbered steps, productivity frameworks" in prompt
    assert "do not describe operational status" in prompt


def test_candidate_reply_prompt_supports_emotion_without_coaching() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {
                "text": "It is hard to focus today, and I keep getting distracted."
            },
            "context": {"memoryItems": [], "recentTurns": []},
        },
        state={
            "classification": {
                "dialogueAct": "emotional_disclosure",
                "latestUserSubstance": (
                    "It is hard to focus today, and I keep getting distracted."
                ),
            },
            "riskAssessment": {"severity": "none"},
            "policyDecision": "allow",
        },
    )

    assert "emotional_disclosure: support the feeling briefly" in prompt
    assert "make one useful next conversational move" in prompt
    assert "Do not open by labeling or diagnosing the employee's state" in prompt
    assert "Avoid stock support phrases" in prompt
    assert "too generic" in prompt
    assert "Avoid frameworks and long tactics" in prompt
    assert "one small framing statement instead of an empathy-only dead end" in prompt


def test_candidate_reply_prompt_uses_support_emotion_reply_plan_policy() -> None:
    prompt = build_candidate_reply_prompt(
        request={
            "message": {"text": "It is hard to get moving today."},
            "context": {
                "memoryItems": [],
                "recentTurns": [],
                "replyPlan": {
                    "dialogueAct": "emotional_disclosure",
                    "latestUserSubstance": "It is hard to get moving today.",
                    "topicAnchor": None,
                    "memoryAnchors": [],
                    "responseMove": "support_emotion",
                    "mayInferFromBrevity": True,
                    "questionPolicy": {
                        "maxQuestions": 0,
                        "reason": "strategy_disallows_questions",
                    },
                    "requiredGrounding": [],
                    "forbiddenMoves": ["action_plan"],
                },
            },
        },
        state={
            "riskAssessment": {"severity": "none"},
            "policyDecision": "allow",
        },
    )

    assert "emotional_disclosure: support the feeling briefly" in prompt
    assert "ask zero questions" in prompt
    assert "questionPolicy=maxQuestions=0,reason=strategy_disallows_questions" in prompt
    assert "forbiddenMoves=action_plan" in prompt


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
        "ask no questions in this turn",
        "remove bullets, numbered steps, and checklist formatting",
    ]


def test_candidate_reply_policy_violations_require_typed_reply_policy() -> None:
    violations = candidate_reply_policy_violations(
        text=(
            "That, it seems, is the real root: overload.\n"
            "- First, write a plan?\n"
            "- Then align with your manager?"
        ),
        request={
            "message": {"text": "ok"},
            "context": {"memoryItems": [], "recentTurns": []},
        },
        state={
            "classification": {
                "dialogueAct": "acknowledgement",
                "latestUserSubstance": None,
            },
            "riskAssessment": {"severity": "none"},
        },
    )

    assert violations == []


def test_candidate_reply_policy_violations_allow_user_language() -> None:
    violations = candidate_reply_policy_violations(
        text="Понял, давай просто удержим фокус на самом срочном.",
        request={
            "message": {"text": "слишком много задач"},
            "user": {"locale": "ru"},
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
        state={},
    )

    assert violations == []


def test_candidate_reply_policy_violations_use_typed_reply_plan_question_policy() -> None:
    violations = candidate_reply_policy_violations(
        text="What changed?",
        request={
            "message": {"text": "ok"},
            "context": {
                "memoryItems": [],
                "recentTurns": [],
                "replyPlan": {
                    "dialogueAct": "acknowledgement",
                    "latestUserSubstance": None,
                    "topicAnchor": "too much to do",
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
            },
        },
        state={},
    )

    assert violations == ["ask no questions in this turn"]


def test_candidate_reply_policy_violations_apply_social_checkin_reply_policy() -> None:
    violations = candidate_reply_policy_violations(
        text=(
            "I am here and keeping things simple today, hoping for a little quiet "
            "and less rush. I hope you also get a chance to catch your breath later."
        ),
        request={
            "message": {"text": "How are you?"},
            "context": {
                "replyPolicy": {
                    "maxChars": 120,
                    "maxQuestions": 1,
                    "allowReflectiveOpener": False,
                    "allowListFormatting": False,
                },
            },
        },
        state={},
    )

    assert violations == [
        "keep the reply under 120 characters",
    ]


def test_candidate_reply_policy_violations_allow_non_latin_letters() -> None:
    non_latin_reply = "".join(chr(codepoint) for codepoint in (0x041F, 0x0440, 0x0438))

    violations = candidate_reply_policy_violations(
        text=non_latin_reply,
        request={"message": {"text": "Reply briefly."}, "context": {}},
        state={},
    )

    assert violations == []
