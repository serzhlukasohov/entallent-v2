from __future__ import annotations

import sys
import types
from dataclasses import dataclass
from typing import Any, Sequence


if "agent_framework" not in sys.modules:
    agent_framework = types.ModuleType("agent_framework")

    @dataclass(frozen=True)
    class Message:
        role: str
        content: Sequence[Any]

        @property
        def text(self) -> str:
            return " ".join(str(part) for part in self.content)

    @dataclass(frozen=True)
    class ChatResponse:
        messages: Sequence[Message]
        model: str | None = None

        @property
        def text(self) -> str:
            return self.messages[0].text if self.messages else ""

    class Agent:
        def __init__(self, chat_client: Any, **kwargs: Any) -> None:
            self._chat_client = chat_client
            self._kwargs = kwargs

        async def run(self, messages: Sequence[Message], **kwargs: Any) -> ChatResponse:
            response = await self._chat_client.get_response(messages, **kwargs)
            if isinstance(response, ChatResponse):
                return response
            return ChatResponse(messages=[Message("assistant", [str(response)])])

    class WorkflowContext:
        def __init__(self) -> None:
            self.outputs: list[Any] = []

        async def yield_output(self, value: Any) -> None:
            self.outputs.append(value)

        def get_outputs(self) -> list[Any]:
            return self.outputs

    class Executor:
        def __init__(self, *, id: str) -> None:
            self.id = id

    class _Workflow:
        def __init__(self, start_executor: Executor) -> None:
            self._start_executor = start_executor

        async def run(self, request: dict[str, Any]) -> WorkflowContext:
            context = WorkflowContext()
            process = getattr(self._start_executor, "process", None)
            if process is None:
                raise RuntimeError("agent_framework executor is missing process")

            result = process(request, context)
            if hasattr(result, "__await__"):
                await result
            return context

    class WorkflowBuilder:
        def __init__(self, *_, start_executor: Executor, **__) -> None:
            self._start_executor = start_executor

        def build(self) -> _Workflow:
            return _Workflow(self._start_executor)

    def handler(func: Any) -> Any:
        return func

    agent_framework.__version__ = "1.13.0"
    agent_framework.Message = Message
    agent_framework.ChatResponse = ChatResponse
    agent_framework.Agent = Agent
    agent_framework.WorkflowContext = WorkflowContext
    agent_framework.Executor = Executor
    agent_framework.WorkflowBuilder = WorkflowBuilder
    agent_framework.handler = handler
    sys.modules["agent_framework"] = agent_framework
