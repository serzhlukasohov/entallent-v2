from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVICE_ROOT = REPO_ROOT / "agent-service"
APP_SRC_ROOTS = [
    REPO_ROOT / "apps/api/src",
    REPO_ROOT / "apps/worker/src",
    REPO_ROOT / "apps/dashboard/src",
]
PRE_EXISTING_SHADOW_OR_CANARY_FILES = {
    REPO_ROOT / "apps/worker/src/conversation/shadow-diagnostics.repository.ts",
    REPO_ROOT / "apps/worker/src/conversation/shadow-diagnostics.repository.test.ts",
    REPO_ROOT / "apps/worker/src/conversation/shadow-readiness-report.service.ts",
    REPO_ROOT / "apps/worker/src/conversation/shadow-readiness-report.service.test.ts",
}


def test_epic_5_scope_allows_only_current_maf_surfaces() -> None:
    maf_client = REPO_ROOT / "packages/application/src/use-cases/maf-agent-runtime-client.ts"
    workflows_root = SERVICE_ROOT / "src/agent_service/workflows"
    dashboard_shadow_files = list((REPO_ROOT / "apps/dashboard/src").glob("**/*shadow*"))
    dashboard_admin_files = list((REPO_ROOT / "apps/dashboard/src").glob("**/*admin*"))

    assert maf_client.exists()
    assert workflows_root.exists()
    assert (workflows_root / "conversation_workflow.py").exists()
    assert (SERVICE_ROOT / "src/agent_service/tools/context_tool.py").exists()
    assert not (SERVICE_ROOT / "src/agent_service/sessions").exists()
    assert not (SERVICE_ROOT / "src/agent_service/checkpoints").exists()
    assert not (SERVICE_ROOT / "src/agent_service/infrastructure/auth.py").exists()
    assert (SERVICE_ROOT / "src/agent_service/infrastructure/internal_auth.py").exists()
    assert (SERVICE_ROOT / "src/agent_service/infrastructure/runtime_state.py").exists()
    assert not (SERVICE_ROOT / "src/agent_service/infrastructure/session_store.py").exists()
    assert not (SERVICE_ROOT / "src/agent_service/infrastructure/checkpoint_store.py").exists()
    assert (SERVICE_ROOT / "Dockerfile").exists()
    assert not (SERVICE_ROOT / "railway.toml").exists()
    assert dashboard_shadow_files == []
    assert dashboard_admin_files == []


def test_story_5_5_allows_only_shadow_candidate_maf_http_execution() -> None:
    router_source = (
        REPO_ROOT / "packages/application/src/use-cases/agent-runtime-router.ts"
    ).read_text()
    maf_client_source = (
        REPO_ROOT / "packages/application/src/use-cases/maf-agent-runtime-client.ts"
    ).read_text()
    worker_sources = "\n".join(
        path.read_text()
        for path in (REPO_ROOT / "apps/worker/src").glob("**/*.ts")
        if path not in PRE_EXISTING_SHADOW_OR_CANARY_FILES
    )

    assert "this.mafRuntime.processMessage" not in router_source
    assert "runtime/process-message" not in router_source
    assert "agent-service" not in router_source
    assert "fetch(" not in router_source
    assert "runtime/process-message" not in worker_sources
    assert "processCandidate(request" in maf_client_source
    assert "runtime/process-message" in maf_client_source
    assert "this.options.fetch" in maf_client_source
    assert "decision.mode !== 'maf_shadow'" in router_source
    assert "this.mafRuntime.processCandidate(request)" in router_source
    assert "decision.mode === 'maf_canary'" in router_source
    assert "throw new MafAgentRuntimeConfigurationError" in maf_client_source


def test_story_5_2_has_health_runtime_endpoint_and_workflow_skeleton() -> None:
    assert (SERVICE_ROOT / "src/agent_service/api/health.py").exists()
    assert (SERVICE_ROOT / "src/agent_service/api/runtime.py").exists()
    assert (SERVICE_ROOT / "src/agent_service/workflows/conversation_workflow.py").exists()

    health_source = (SERVICE_ROOT / "src/agent_service/api/health.py").read_text()
    runtime_source = (SERVICE_ROOT / "src/agent_service/api/runtime.py").read_text()

    assert '"/live"' in health_source
    assert '"/ready"' in health_source
    assert '"/process-message"' in runtime_source
    assert '"/ready"' not in runtime_source


def test_story_5_2_does_not_add_active_root_deploy_or_aggregate_write_paths() -> None:
    forbidden_deploy_files = [
        REPO_ROOT / "Dockerfile.agent-service",
        REPO_ROOT / "railway.toml",
        REPO_ROOT / "infra/agent-service",
        REPO_ROOT / "infra/docker/agent-service.Dockerfile",
    ]
    aggregate_write_matches = [
        *SERVICE_ROOT.glob("src/agent_service/**/*repository*.py"),
        *SERVICE_ROOT.glob("src/agent_service/**/*aggregate*.py"),
        *SERVICE_ROOT.glob("src/agent_service/**/*write*.py"),
        *REPO_ROOT.glob("packages/domain/src/**/*maf*.ts"),
        *REPO_ROOT.glob("packages/domain/src/**/*runtime*.ts"),
    ]
    canary_or_shadow_matches = [
        *(path for root in APP_SRC_ROOTS for path in root.glob("**/*canary*")),
        *(path for root in APP_SRC_ROOTS for path in root.glob("**/*shadow*")),
        *SERVICE_ROOT.glob("**/*canary*"),
        *SERVICE_ROOT.glob("**/*shadow*"),
    ]

    assert all(not path.exists() for path in forbidden_deploy_files)
    assert aggregate_write_matches == []
    assert set(canary_or_shadow_matches) <= PRE_EXISTING_SHADOW_OR_CANARY_FILES


def test_story_4_3_adds_auth_primitives_without_internal_tool_endpoints() -> None:
    internal_auth_root = REPO_ROOT / "apps/api/src/internal-auth"
    sources = [path.read_text() for path in internal_auth_root.glob("*.ts")]
    combined_source = "\n".join(sources)

    assert internal_auth_root.exists()
    assert "InternalServiceAuthService" in combined_source
    assert "RequireInternalServiceAuth" in combined_source
    assert "@Controller" not in combined_source
    assert "MafAgentRuntimeClient" not in combined_source


def test_story_4_4_adds_runtime_state_primitives_without_maf_workflow() -> None:
    runtime_state_source = (
        SERVICE_ROOT / "src/agent_service/infrastructure/runtime_state.py"
    ).read_text()
    runtime_endpoint_source = (
        SERVICE_ROOT / "src/agent_service/api/runtime.py"
    ).read_text()

    assert "SqliteRuntimeStateStore" in runtime_state_source
    assert "create_session_key" in runtime_state_source
    assert "agent_framework" not in runtime_state_source
    assert "RuntimeStateStore" not in runtime_endpoint_source
    assert "create_runtime_state_store" not in runtime_endpoint_source


def test_story_5_3_adds_only_read_only_context_tooling() -> None:
    tools_root = SERVICE_ROOT / "src/agent_service/tools"
    tool_sources = "\n".join(path.read_text() for path in tools_root.glob("**/*.py"))
    api_context_root = REPO_ROOT / "apps/api/src/internal-maf-context"
    api_context_sources = "\n".join(path.read_text() for path in api_context_root.glob("*.ts"))

    assert sorted(path.name for path in tools_root.glob("**/*.py")) == [
        "__init__.py",
        "context_tool.py",
    ]
    assert 'permissions=("read",)' in tool_sources
    assert 'endpoint_allowlist=resolve_context_endpoint_allowlist(' in tool_sources
    assert 'INTERNAL_MAF_CONTEXT_READ_ENDPOINT' in tool_sources
    assert '"command"' not in tool_sources
    assert "RequireInternalServiceAuth({ permission: 'read' })" in api_context_sources
    assert "permission: 'command'" not in api_context_sources
    assert "eq(users.tenantId, request.tenantId)" in api_context_sources
    assert "eq(userStyleProfiles.tenantId, request.tenantId)" in api_context_sources
    assert "eq(memoryItems.tenantId, request.tenantId)" in api_context_sources
    assert "eq(userGoals.tenantId, request.tenantId)" in api_context_sources
    assert "eq(riskSignals.tenantId, request.tenantId)" in api_context_sources
    assert "eq(surveyWindows.tenantId, request.tenantId)" in api_context_sources
    assert "eq(messages.tenantId, request.tenantId)" in api_context_sources
    assert "eq(messages.conversationId, request.conversationId)" in api_context_sources
    assert ".insert(" not in api_context_sources
    assert ".update(" not in api_context_sources
    assert ".delete(" not in api_context_sources
    assert "InjectQueue" not in api_context_sources


def test_story_5_4_workflow_adds_proposals_without_writes_or_hosting() -> None:
    scoped_runtime_sources = [
        *(SERVICE_ROOT / "src/agent_service/workflows").glob("**/*.py"),
        SERVICE_ROOT / "src/agent_service/api/runtime.py",
        *(SERVICE_ROOT / "src/agent_service/tools").glob("**/*.py"),
    ]
    combined_source = "\n".join(path.read_text() for path in scoped_runtime_sources)

    forbidden_runtime_fragments = [
        "RuntimeStateStore",
        "SqliteRuntimeStateStore",
        "create_runtime_state_store",
        "requests",
        "fetch",
        "agent_framework_hosting",
        '"committed"',
        "'committed'",
        "RuntimeStateStore(",
        "create_session",
        "create_checkpoint",
    ]

    for fragment in forbidden_runtime_fragments:
        assert fragment not in combined_source
    assert '"actionType": "save_memory"' in combined_source
    assert '"actionType": "schedule_follow_up"' in combined_source
    assert '"actionType": "update_goal"' in combined_source
    assert '"executionStatus": "not_started"' in combined_source
    assert '"executionStatus": "blocked"' in combined_source
    assert '"commitMarker": None' in combined_source


def test_story_7_2_uses_agent_framework_model_provider_without_hosting_or_writes() -> None:
    pyproject_source = (SERVICE_ROOT / "pyproject.toml").read_text()
    workflow_sources = "\n".join(
        path.read_text()
        for path in (SERVICE_ROOT / "src/agent_service/workflows").glob("**/*.py")
    )
    runtime_sources = "\n".join(
        path.read_text()
        for root in [
            SERVICE_ROOT / "src/agent_service/workflows",
            SERVICE_ROOT / "src/agent_service/tools",
            SERVICE_ROOT / "src/agent_service/api",
        ]
        for path in root.glob("**/*.py")
    )
    router_source = (
        REPO_ROOT / "packages/application/src/use-cases/agent-runtime-router.ts"
    ).read_text()
    forbidden_runtime_fragments = [
        "agent_framework_hosting",
    ]
    forbidden_write_fragments = [
        '"committed"',
        "'committed'",
        ".insert(",
        ".update(",
        ".delete(",
    ]

    assert '"agent-framework-core>=1.13,<1.14"' in pyproject_source
    assert "import agent_framework" in workflow_sources
    assert "MicrosoftAgentFrameworkWorkflowRunner" in workflow_sources
    assert "AgentFrameworkConversationModelClient" in runtime_sources
    assert "agent_framework.Agent" in runtime_sources
    assert "modelCalls" in runtime_sources
    assert "decision.mode === 'maf_canary'" in router_source
    assert "this.mafRuntime.processMessage" not in router_source
    for fragment in forbidden_runtime_fragments:
        assert fragment not in runtime_sources
    for fragment in forbidden_write_fragments:
        assert fragment not in runtime_sources


def test_story_8_1_live_smoke_harness_stays_candidate_only() -> None:
    smoke_sources = "\n".join(
        path.read_text()
        for root in [
            SERVICE_ROOT / "src/agent_service/smoke",
            SERVICE_ROOT / "scripts",
        ]
        for path in root.glob("**/*.py")
    )
    router_source = (
        REPO_ROOT / "packages/application/src/use-cases/agent-runtime-router.ts"
    ).read_text()
    dashboard_shadow_files = list((REPO_ROOT / "apps/dashboard/src").glob("**/*shadow*"))
    dashboard_admin_files = list((REPO_ROOT / "apps/dashboard/src").glob("**/*admin*"))

    assert "create_app" in smoke_sources
    assert '"/runtime/process-message"' in smoke_sources
    assert "validate_runtime_result" in smoke_sources
    assert "replyDigest" in smoke_sources
    assert "decision.mode === 'maf_canary'" in router_source
    assert "this.mafRuntime.processMessage" not in router_source
    assert dashboard_shadow_files == []
    assert dashboard_admin_files == []
    for fragment in [
        "agent_framework_hosting",
        ".insert(",
        ".update(",
        ".delete(",
        "railway",
        "RequireInternalServiceAuth({ permission: 'command' })",
    ]:
        assert fragment not in smoke_sources
