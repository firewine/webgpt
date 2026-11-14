import { DotConnectionsView } from './dot-connections.js';
import type { DotConnectionStatus } from '../workspace/dot-mcp-model.js';
import type { Connection, Member, Discussion, ExecutionBinding, CodexJob, DurableEvent, Phase, MaterialPackage, ProviderKind, DeviceSignin } from '../workspace/model.js';
import { RoomView, scopedCommandReady, scopedCommandStatus, scopedCommandConfirmation, resetScopedCommandConfirmations } from './room-view.js';
import type { ScopedCommandApproval } from '../execution/execution-model.js';
import { TopicChatView } from './topic-chat-view.js';
import type { RoomSnapshot } from './room-view.js';
import type { DiscoveryPage, DiscoveryResult } from '../connections/browser-discovery-model.js';
type Authority = { version: 1; epoch: number; issuedAt: string; expiresAt: string; revokedAt: string | null };
type Capture = NonNullable<CodexJob['capture']>;
type EvidencePage = Omit<Capture, 'version'> & { pageIndex: number; nextPage: number | null; text: string };
type DraftReview = { status: 'unchanged' | 'ready' | 'blocked'; reason: string | null; manifestDigest?: string; diffDigest?: string;
  files: { path: string; beforeDigest: string | null; afterDigest: string | null; diff: string }[] };
type EvidenceView = { capture: Capture; page: EvidencePage | null; loading: boolean; error: string | null };
type DraftView = { review: DraftReview | null; loading: boolean; error: string | null };
type Snapshot = { dotMcp?: { enabled: boolean; connections: DotConnectionStatus[] }; cursor: number; connections: Connection[]; participants: Member[]; discussions: Pick<Discussion, 'id' | 'topic' | 'status' | 'phase' | 'revision' | 'createdAt' | 'updatedAt'>[];
  bindings: ExecutionBinding[]; jobs: CodexJob[]; browserPaused: boolean; grants: { id: string; participantId: string; discussionId: string; revoked: boolean; tools: string[]; authority?: Authority }[];
  capabilities: { sourceFetch: boolean; browserConfigured: boolean; noVncConfigured: boolean; codexConfigured: boolean };
  materialPackages: { id: string; label: string; createdAt: string; files: Omit<MaterialPackage['files'][number], 'text' | 'identity'>[] }[]; materialRoots: string[]; resident: RoomSnapshot['resident']; apiDaily: RoomSnapshot['apiDaily'] };
type View = 'room' | 'discussion' | 'connections' | 'execution';
const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
let state: Snapshot | null = null; let current: Discussion | null = null; let selected = sessionStorage.getItem('wj.chat.selection') ?? localStorage.getItem('wj.chat.selection') ?? localStorage.getItem('wj.discussion') ?? '';
let tab = 'timeline'; let view: View = 'room'; let stream: EventSource | null = null;
let composingTopic = false;
const evidenceViews = new Map<string, EvidenceView>(), draftViews = new Map<string, DraftView>();
let applyConfirmation: { jobId: string; review: DraftReview; commandId: string; submitting: boolean; error: string | null } | null = null;
let authorityTimer = 0;
let viewChosen = false; let focusRoomId: string | null = null;
type AuthStatus = { passwordConfigured: boolean; canSetup: boolean };
let authStatus: AuthStatus | null = null; let authSequence = 0; let setupToken = '';
function consumeSetupLink(): boolean {
  if (!location.hash.startsWith('#password-setup=')) return false;
  const value = location.hash.slice('#password-setup='.length); setupToken = /^[\w-]{43}$/.test(value) ? value : '';
  history.replaceState(null, '', location.pathname + location.search); return true;
}
consumeSetupLink();
const effortOptions = [{ value: 'low', label: 'Low · 낮음' }, { value: 'medium', label: 'Medium · 보통' }, { value: 'high', label: 'High · 높음' }, { value: 'xhigh', label: 'Extra high · 매우 높음' }];
const gptKind = (kind?: ProviderKind) => kind === 'openai-oauth' || kind === 'codex-oauth';
const reasoningKind = (kind?: ProviderKind) => gptKind(kind) || kind === 'deepseek';
const deepseekEffortOptions = [{ value: 'default', label: '제공처 기본값' }, { value: 'none', label: 'None · 사고 끄기' }, { value: 'low', label: 'Low · 낮음' }, { value: 'high', label: 'High · 높음' }, { value: 'max', label: 'Max · 최대' }];
let deviceTimer = 0; let deviceLogin: { connectionId: string; attemptId: string } | null = null;
let deviceSequence = 0;
function effortLabel(value: string): string { return [...effortOptions, ...deepseekEffortOptions].find(o => o.value === value)?.label ?? value; }
function savedEffort(p: Member): string { return p.reasoningEffort ?? (p.kind === 'deepseek' ? 'default' : 'xhigh'); }
function outputMaximum(c: Connection | undefined, modelId: string): number { const cap = c?.models.find(m => m.id === modelId)?.outputTokenLimit; return typeof cap === 'number' && Number.isSafeInteger(cap) && cap > 0 ? Math.min(32768, cap) : 32768; }
function outputNote(c: Connection | undefined, modelId: string): string { const cap = c?.models.find(m => m.id === modelId)?.outputTokenLimit; return `비우면 기본 4,096토큰. 앱 입력 범위 512~32,768. ${cap ? '모델 목록 최대 출력 ' + cap.toLocaleString('ko-KR') + '토큰.' : '제공처 최대 출력은 확인되지 않았습니다.'} 사고 깊이는 별도로 유지합니다.`; }
function outputValue(value: string): number | 'default' { return value.trim() === '' ? 'default' : Number(value); }
function effortChoices(c: Connection | undefined, modelId: string): { value: string; label: string }[] {
  const allowed = c?.models.find(m => m.id === modelId)?.reasoningEfforts ?? [];
  return c?.kind === 'deepseek' ? deepseekEffortOptions.filter(o => o.value === 'default' || allowed.some(v => v === o.value)) : c?.kind === 'codex-oauth' ? effortOptions.filter(o => allowed.some(v => v === o.value)) : effortOptions;
}
let cursor = 0; let refreshTask: Promise<void> | null = null; let again = false; let timer = 0; let choiceSignature = ''; let noticeTimer = 0;
let materialSignature = '';
let pendingMaterialSelection: string | null = null;
let browserPages: DiscoveryPage[] = []; let browserCandidate: DiscoveryResult | null = null; let browserDiscoveryConnection = ''; let browserChoices = '';
let browserDiscoveryRevision = 0;
const phases: Record<Phase, string> = { independent: '초기안', cross_review: '상호 검토', verification: '검증', revision: '수정안', synthesis: '종합', summary_review: '종합안 검토' };
const states: Record<string, string> = { running: '진행 중', paused: '일시정지', blocked: '확인 필요', completed: '완료', partial: '부분 완료', cancelled: '취소',
  prepared: '전송 준비', pending: '대기', failed: '실패', unconfirmed: '결과 미확인', stale: '이전 조건의 응답', connected: '연결됨', auth_required: '로그인 필요', unverified: '미확인', error: '연결 오류',
  observed: '자료 관측됨', reported: '참여자 보고', not_run: '미실행', queued: '실행 대기', blocked_approval: '승인 대기', reconciling: '실행 확인 필요', interrupted: '중단됨', ready: '준비됨', fixture: '모의', not_applicable: '해당 없음', waiting: '대기' };
const errors: Record<string, string> = { dot_version_conflict: '다른 화면에서 연결 권한이 바뀌었습니다. 최신 상태에서 다시 확인하세요.', dot_owner_confirmation_required: '대상 dot과 권한 범위를 확인해 주세요.', dot_disabled: '서버의 상주 기능을 켠 뒤 공식 dot을 등록하세요.', dot_credential_write_failed: '권한 키 저장을 확인하지 못했습니다. 연결 상태를 대조하세요.', authentication_required: '비밀번호를 확인해 주세요.', password_mismatch: '두 비밀번호가 일치하지 않습니다.', invalid_password: '비밀번호는 6~128자로 입력하세요. 한글과 공백도 사용할 수 있습니다.', password_setup_not_authorized: '최초 설정 링크를 서버에서 열거나 기존 소유자 로그인으로 접속해 주세요.', password_setup_changed: '설정이 먼저 변경됐거나 링크가 만료됐습니다. 새 설정 링크를 열어 주세요.', password_already_set: '이미 비밀번호가 설정돼 있습니다. 비밀번호로 로그인하거나 서버에서 재설정 링크를 여세요.', password_verification_failed: '현재 비밀번호를 확인해 주세요.', login_rate_limited: '잠시 후 다시 시도해 주세요. 연속 시도 또는 다른 로그인 처리가 진행 중입니다.', root_workflow_busy: '진행 중인 토의를 먼저 완료하거나 취소해 주세요.', two_participants_required: '참여자를 2명 이상 선택해 주세요.',
  api_daily_not_configured: 'API 일일 한도를 먼저 저장해 주세요. GPT 대화는 계속할 수 있습니다.', api_daily_exhausted: 'API 일일 한도에 도달했습니다. 다음 KST 자정까지 API만 기다립니다.', api_daily_version_conflict: '다른 화면에서 API 한도가 바뀌었습니다. 창을 닫고 최신 한도를 다시 확인하세요.', api_daily_policy_requires_idle: '진행·미확정 API 발언을 먼저 확인한 뒤 한도를 변경하세요.', dot_existing_chat_required: '이전 browser 연결은 확인한 ChatGPT 대화가 필요합니다. 공식 dot은 전용 플러그인 연결을 사용하세요.',
  invalid_output_limit: '출력 한도는 512~32,768 범위의 정수로 지정하세요.', output_limit_requires_deepseek: '출력 한도 설정은 DeepSeek 연결에서 지원합니다.', output_limit_not_supported: '모델 목록이 보고한 최대 출력을 넘었습니다. 출력 한도를 직접 조절해 주세요.', participant_output_requires_idle: '진행·미확정 발언을 먼저 확인한 뒤 출력 한도를 변경하세요.',
  device_login_unavailable: 'ChatGPT 보안 설정 또는 workspace에서 기기 코드 로그인을 허용해 주세요.', device_login_expired: '기기 코드가 만료됐습니다. 같은 계정에서 새 로그인을 시작해 주세요.', device_login_interrupted: '서버가 재시작됐거나 이전 요청이 끝났습니다. 같은 계정에서 다시 시작해 주세요.', device_login_start_failed: '기기 코드를 받지 못했습니다. 연결 상태를 확인해 주세요.', device_login_poll_failed: '로그인 승인 상태를 확인하지 못했습니다.', codex_version_required: '설정한 Codex 실행 파일의 버전을 확인하지 못했습니다.', codex_refresh_failed: '이 계정의 인증을 갱신하지 못했습니다. 연결 상태를 확인해 주세요.',
  signin_pending: '이미 시작한 로그인이 있습니다. 서버 Chrome 화면에서 진행해 주세요.', signin_account_pending: '진행 중 로그인과 다른 계정을 지정했습니다. 기존 로그인을 마치거나 이 계정을 로그아웃한 뒤 다시 시작해 주세요.',
  account_email_required: '로그인할 웹 GPT 계정 이메일을 입력해 주세요.', invalid_account_email: '웹 GPT 계정 이메일을 확인해 주세요.',
  auth_required: '이 연결의 로그인 또는 API 키 권한을 확인해 주세요.',
  invalid_api_service: 'API 제공처를 다시 선택해 주세요.', deepseek_model_unavailable: '이 API 키에서 사용 가능한 DeepSeek 모델을 찾지 못했습니다. 제공처의 모델 권한을 확인해 주세요.',
  anthropic_workspace_required: '이 Anthropic 키에 맞는 Workspace ID를 확인해 주세요. 여러 workspace용 키에는 ID가 필요합니다.', invalid_anthropic_workspace: 'Anthropic Workspace ID 형식을 확인해 주세요.', reasoning_requires_supported_model: '사고 깊이는 설정을 지원하는 GPT·DeepSeek 모델에서 조절할 수 있습니다. 기존 웹 대화는 원래 서비스에서 조절하세요.',
  coralbricks_verification_required: 'CoralBricks에서 계정 검증을 위한 결제수단 등록을 요구합니다. 공식 사이트에서 검증 후 모델 확인을 다시 눌러 주세요.',
  model_access_denied: '제공처가 모델 조회 권한을 거절했습니다. 해당 계정의 모델·앱 접근 권한을 확인해 주세요.', model_rate_limited: '제공처의 조회 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.', provider_credits_required: '제공처의 잔액이 부족합니다. 공식 사이트에서 사용 한도를 확인해 주세요.', model_catalog_not_found: '제공처의 모델 조회 주소를 찾지 못했습니다.', model_provider_unavailable: '제공처 서버가 모델 목록을 반환하지 못했습니다. 잠시 후 다시 확인해 주세요.', model_discovery_failed: '모델 목록을 확인하지 못했습니다. 연결 카드의 오류와 제공처 상태를 확인해 주세요.',
  connection_in_use: '이 연결이 참여 중인 방을 끄고 진행 중인 토의를 완료하거나 취소한 뒤 삭제해 주세요.', connection_not_found: '이미 삭제됐거나 찾을 수 없는 연결입니다. 연결 목록을 다시 확인해 주세요.', connection_cleanup_failed: '연결은 해제됐지만 서버의 인증 파일 정리가 끝나지 않았습니다. 같은 삭제 요청을 다시 확인해 주세요.',
  wiki_version_conflict: '다른 편집이 먼저 반영됐습니다. 내 입력은 Wiki 변경 기록의 충돌 제안으로 보존했습니다.', wiki_sources_required: 'Wiki의 근거가 된 공개 원문을 선택해 주세요.', wiki_source_not_public: '같은 방과 허용 범위의 공개 출처만 참조할 수 있습니다.', wiki_context_requires_handoff: '이전 Wiki 맥락의 접근 범위가 바뀌었습니다. 원래 기록을 보존하고 문맥 인계 후 다시 시작하세요.', resident_scope_changed: '역할·문맥 세대·방 상태가 바뀌었습니다. 최신 기록으로 범위를 다시 확인하세요.', wiki_context_requires_selection: '고정한 Wiki 원문이 입력 한도를 넘습니다. 고정 문서를 줄여 주세요.', invalid_grant_expiry: '접근 권한의 만료 시각을 현재부터 7일 이내로 정해 주세요.',
  work_execution_scope_changed: '방·역할·업무 버전이 바뀌어 이 실행의 승인을 보류했습니다. 원래 실행과 현재 배정을 확인하세요.', work_execution_immutable_input: '업무 실행의 입력은 고정돼 있습니다. 실행을 대조한 뒤 반려·새 시도로 변경 내용을 남겨 주세요.', work_execution_link_required: '원래 업무 입력과 실행의 연결을 확인할 수 없습니다. 새 실행을 만들지 말고 원래 기록을 대조하세요.', work_write_safety_unverified: '저장소의 비밀·링크·출력 경계 검증 전에는 쓰기 업무를 실행할 수 없습니다.', room_tool_budget_exhausted: '방의 실행 한도나 현재 진행 상태를 확인해 주세요.',
  work_version_conflict: '다른 화면에서 업무 배정이나 일감이 바뀌었습니다. 새 기록을 확인한 뒤 다시 수정하세요.', work_not_ready: '완료 조건·의존성·허용 범위를 확인해 주세요.', work_room_not_ready: '방을 켜고 진행 한도와 현재 토론 상태를 확인해 주세요.', work_slot_or_scope_unavailable: '선택한 참여자의 업무 범위나 사용 중인 슬롯을 확인해 주세요.', work_source_not_public: '같은 방에 공개된 발언만 일감 근거로 사용할 수 있습니다.', work_dependency_cycle: '선행 일감이 서로를 기다리는 순환입니다. 의존성을 바꿔 주세요.', work_attempt_requires_reconciliation: '진행 중이거나 미확정인 업무를 먼저 대조해 주세요.', work_report_conflict: '현재 보고가 바뀌었습니다. 최신 산출물에서 다시 검토해 주세요.', work_scope_not_found: '이 방 또는 등록한 작업 공간만 범위로 선택할 수 있습니다.', work_action_not_authorized: '배정된 역할과 업무 범위가 이 동작을 허용하지 않습니다.', work_independent_review_required: '산출물 작성자와 다른 검토자가 필요합니다.',
  material_path_not_allowed: '서버의 WJ_MATERIAL_ROOTS에서 허용한 파일·폴더만 읽을 수 있습니다.', material_path_protected: '인증 정보와 보호 파일은 참고 자료로 읽을 수 없습니다.', material_changed: '파일이 수집 후 변경됐습니다. 새 자료로 다시 읽어 주세요.', material_path_unavailable_or_link: '파일이 없거나 읽을 수 없는 링크 경로입니다.', material_regular_unlinked_file_required: '일반 파일만 지원하며 하드링크는 허용하지 않습니다.', material_file_too_large: '파일 하나는 32 KiB 이하여야 합니다.', material_package_too_large: '한 토의의 로컬 자료는 최대 8개 파일, 합계 64 KiB입니다.', material_context_budget_exceeded: '참고 자료를 포함한 입력이 문맥 한도를 넘습니다. 파일 수나 내용을 줄여 주세요.', material_utf8_required: 'UTF-8 텍스트 파일만 첨부할 수 있습니다.', material_text_required: '바이너리 또는 제어 문자가 있는 파일은 첨부할 수 없습니다.', material_directory_too_large: '항목이 100개 이하인 폴더를 선택해 주세요.', material_directory_required: '탐색할 폴더의 경로를 입력해 주세요.',
  invalid_reasoning_effort: '지원하는 사고 깊이 값을 선택해 주세요.', reasoning_effort_not_supported: '선택한 모델이 이 사고 깊이를 지원하지 않습니다. 설정을 바꾼 뒤 이어가세요.', reasoning_requires_oauth: '사고 깊이 요청 설정은 OAuth GPT 토커에 적용됩니다. 기존 dot·Muse는 해당 서비스에서 설정하세요.', participant_settings_require_pause: '일시정지 후 현재 응답이 확정되면 사고 깊이를 바꿀 수 있습니다.', oauth_account_mismatch: '선택한 로그인 계정이 지정한 계정과 다릅니다. 웹 GPT용 계정으로 로그인해 주세요.', isolated_login_unavailable: '현재 Chrome 도구가 분리된 로그인 공간을 지원하지 않습니다. 도구 설정을 확인해 주세요.',
  connection_not_ready: '먼저 연결과 모델 목록을 확인해 주세요.', browser_not_configured: '서버의 Chrome 연결 명령을 설정해 주세요.', browser_manual_control: 'Chrome 수동 조작을 마친 뒤 자동 입력을 재개해 주세요.',
  browser_discovery_unsupported_dom: '이 화면은 프리셋으로 확인할 수 없습니다. 고급 연결에서 실제 선택자를 확인해 주세요.', browser_discovery_ambiguous: '입력란·계정·대화 후보가 여러 개입니다. 서버 Chrome에서 연결할 대화 하나를 확인해 주세요.', browser_discovery_draft_present: '작성 중인 초안이 있습니다. 초안을 보존했습니다. 서버 Chrome에서 직접 확인한 뒤 다시 탐지하세요.', browser_discovery_changed: '탐지 후 화면·초안·응답 상태가 달라졌습니다. 다시 확인해 주세요.', browser_discovery_expired: '탐지 결과가 만료됐습니다. 읽기 전용 확인을 다시 진행해 주세요.', browser_discovery_page_missing: '선택한 페이지 또는 프로필이 바뀌었습니다. 페이지 목록을 다시 확인해 주세요.', browser_discovery_confirmation_required: '프로필·계정·대화 ID가 맞는지 직접 확인해 주세요.', browser_binding_changed: '다른 화면에서 연결이 갱신됐습니다. 새 연결 상태를 확인해 주세요.', browser_identity_change_not_allowed: '등록한 계정·에이전트·대화는 갱신으로 바꿀 수 없습니다. 다른 대화는 새 연결을 사용하세요.',
  browser_turn_active: '진행 중인 Chrome 응답이 끝난 뒤 수동 조작을 시작할 수 있습니다.', browser_target_mismatch: '대화 주소 또는 계정 식별 문구가 일치하지 않습니다.',
  browser_selectors_invalid: '실제 입력란과 전송 버튼 선택자를 확인해 주세요.', browser_not_ready: 'Chrome 대화가 응답 가능한 상태인지 확인해 주세요.',
  reconciliation_required: '미확인 응답이나 실행 결과를 먼저 대조해 주세요.', workspace_not_allowed: '서버에서 허용한 작업 경로 안의 디렉터리를 등록해 주세요.',
  dot_stop_confirmation_required: '원래 dot 실행이 중단됐고 답변을 제출하지 않았는지 확인해 주세요.', dot_retry_requires_native_topic: '공식 dot의 주제 토의에서만 중단 확인 후 재시도를 준비할 수 있습니다.', dot_retry_reply_exists: '이미 받은 답변이 있습니다. 원래 결과를 먼저 대조해 주세요.', dot_retry_scope_changed: '과제나 문맥 상태가 바뀌었습니다. 원래 요청과 현재 토의를 대조해 주세요.', dot_retry_input_changed: '원래 입력이나 자료 접근 범위가 바뀌어 같은 과제를 재시도할 수 없습니다.',
  dot_failed_submit_stop_confirmation_required: '제출 오류 뒤 원래 dot 실행이 멈췄고 추가 제출이 없는지 확인해 주세요.', dot_retry_prior_grant_not_revoked: '원래 dot 연결 권한을 먼저 회수한 뒤 재시도를 준비해 주세요.',
  dot_unverified_execution_acceptance_required: '원격 실행 종료·제출 이력 미확인과 옛 실행자의 새 요청 접근 위험을 수락해야 합니다.', dot_monitor_disabled_confirmation_required: '현재 dot 감시가 비활성인지 확인해 주세요.', dot_retry_prior_subscription_active: '원래 dot 권한의 감시 등록이 아직 유효합니다. 권한 회수 상태를 다시 확인해 주세요.',
  session_target_mismatch: 'Codex 세션의 작업 경로·호스트·사용자가 일치하지 않습니다.', feature_branch_required: '파일 수정은 작업 브랜치에서만 허용됩니다.',
  existing_browser_context_preserved: '기존 dot·Muse 대화의 문맥은 자동 교체하지 않습니다.', revision_conflict: '다른 변경이 반영됐습니다. 새 상태에서 다시 시도해 주세요.',
  context_limit_requires_handoff: '문맥이 길어졌습니다. 원본과 복구에서 체크포인트를 적용해 주세요.', source_fetch_disabled: '서버에서 공개 출처 조회가 꺼져 있습니다.',
  checkpoint_requires_selection: '체크포인트가 허용 크기를 넘었습니다. 기존 문맥은 보존됩니다. 원본을 내려받아 확인해 주세요.', session_busy: 'Codex 세션에 실행 중인 작업이 있습니다.',
  rpc_disconnected: '도구 연결이 끊겼습니다. 실행 결과를 확인한 후 다시 진행해 주세요.', rpc_unconfirmed: '도구 응답이 미확인입니다. 자동으로 재전송하지 않았습니다.',
  request_unconfirmed: '요청 결과를 확인하지 못했습니다. 기록을 새로 확인해 주세요. 자동으로 재전송하지 않았습니다.', procedure_completed: '토의 절차가 완료되었습니다.', budget_exhausted: '설정한 진행 한도에 도달했습니다.',
  invalid_tool_deadline: '도구 실행 종료 시각을 현재보다 뒤로 지정해 주세요.', room_settings_required: '방의 대화 속도 설정을 확인해 주세요.', room_members_required: '발언에 참여할 멤버를 선택해 주세요.', room_version_conflict: '다른 방 설정이 반영됐습니다. 갱신된 상태를 확인하고 다시 적용해 주세요.', room_configuration_requires_off: '방을 끄고 진행 중·미확정 응답을 대조한 뒤 설정을 바꿀 수 있습니다.', resident_disabled: '상주 기능이 꺼져 있습니다.', resident_account_change_requires_new_participant: '기존 상주 이력이 있는 토커의 계정을 바꿀 때는 새 참여자로 등록해 주세요.',
  participant_excluded: '일부 참여자를 제외한 결과입니다.', user_cancelled: '사용자가 토의를 취소했습니다.', partial_unstructured_reply: '일부 응답의 형식을 확인하지 못했습니다.' };
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; }
function button(text: string, action: () => Promise<unknown> | unknown, className = ''): HTMLButtonElement {
  const n = node('button', text, className); n.type = 'button'; n.addEventListener('click', () => { n.disabled = true; void Promise.resolve().then(action).catch(report).finally(() => { n.disabled = false; }); }); return n;
}
function badge(value: string): HTMLElement { return node('span', states[value] ?? value, `badge ${['failed', 'error'].includes(value) ? 'error' : ['blocked', 'unconfirmed', 'auth_required', 'not_run', 'partial', 'blocked_approval', 'reconciling'].includes(value) ? 'warning' : ''}`); }
function announce(text: string, error = false): void { clearTimeout(noticeTimer); const n = $('#notice'); n.textContent = text; n.className = `notice${error ? ' error' : ''}`; n.hidden = false; noticeTimer = window.setTimeout(() => { n.hidden = true; }, error ? 15000 : 6500); }
function report(error: unknown): void { const key = error instanceof Error ? error.message : 'request_failed'; announce(errors[key] ?? `처리하지 못했습니다: ${key}`, true); }
async function api<T>(path: string, body?: unknown, requestId: string = crypto.randomUUID()): Promise<T> {
  let response: Response;
  try { response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify(body) }); }
  catch { throw new Error('request_unconfirmed'); }
  const result = await response.json().catch(() => { throw new Error('request_unconfirmed'); }) as T & { error?: { code: string } };
  if (!response.ok) { if (response.status === 401) lock(); throw new Error(result.error?.code ?? 'request_failed'); }
  return result;
}
function lock(load = true): void { clearExecutionPrivate(); dotView.clear(); stream?.close(); stream = null; topicChat.clear(); $<HTMLDialogElement>('#topic-details-dialog').close(); roomView.clear(); closeDeviceScreen(); $('#device-code').textContent = ''; $<HTMLDialogElement>('#oauth-login-dialog').close(); $<HTMLDialogElement>('#password-dialog').close(); $<HTMLFormElement>('#password-change-form').reset(); $('#oauth-desktop').replaceChildren(); $('#oauth-result').replaceChildren(); $('#login').hidden = false; $('#workspace').hidden = true; if (load) { authStatus = null; void loadLogin().catch(report); } }
async function loadLogin(): Promise<void> { const sequence = ++authSequence; $<HTMLButtonElement>('#login-submit').disabled = true; const result = await api<AuthStatus>('/api/auth'); if (sequence === authSequence) { authStatus = result; renderLogin(); } }
function renderLogin(): void {
  const setup = !authStatus?.passwordConfigured || !!setupToken, allowed = !setup || !!setupToken || !!authStatus?.canSetup;
  $('#login-title').textContent = setup ? setupToken && authStatus?.passwordConfigured ? '비밀번호 재설정' : '처음 비밀번호 설정' : '작업실 로그인';
  $('#login-password-label').textContent = setup ? '새 비밀번호' : '비밀번호';
  $<HTMLInputElement>('#login-password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#login-confirm-label').hidden = !setup; const confirmation = $<HTMLInputElement>('#login-confirm'); confirmation.disabled = !setup; confirmation.required = setup;
  $<HTMLButtonElement>('#login-submit').disabled = !allowed; $('#login-submit').textContent = setup ? '비밀번호 설정하고 시작' : '작업실 열기';
  $('#login-note').textContent = setup ? '새 비밀번호와 바로 아래 확인란에 같은 비밀번호를 입력하세요. 6~128자, 한글·공백을 사용할 수 있습니다.' : '이 작업실에 설정한 비밀번호를 입력하세요. 로그인은 12시간 유지됩니다.';
  $('#login-setup-help').hidden = allowed;
}
function checkPasswords(password: string, confirmation: string): void {
  if (password !== confirmation) throw new Error('password_mismatch');
  const count = [...password.normalize('NFC')].length; if (count < 6 || count > 128) throw new Error('invalid_password');
}
function form(id: string, handler: (data: Record<string, string>, form: HTMLFormElement) => Promise<unknown>): void {
  $(id).addEventListener('submit', event => { event.preventDefault(); const el = event.currentTarget as HTMLFormElement; const submit = el.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])'); if (submit) submit.disabled = true;
    const data = Object.fromEntries(new FormData(el).entries()) as Record<string, string>;
    void handler(data, el).catch(report).finally(() => { if (submit) submit.disabled = false; if (id === '#login-form') renderLogin(); if (id === '#discussion-form') renderFocusBudget(); if (id === '#job-form') renderRunAccess(); if (id === '#draft-apply-form') renderApplyConfirmation(); }); });
}
function showView(next: View): void {
  if (next === 'discussion') { if (current) openTopicDetails(); else beginTopic(); return; }
  viewChosen = true; view = next; for (const id of ['room', 'connections', 'execution']) $(`#view-${id}`).hidden = id !== next;
  if (next !== 'room') $<HTMLDialogElement>('#topic-details-dialog').close();
  if (next !== 'connections') dotView.clear();
  roomView.setSelectedTopic(current, !!selected); roomView.setActive(next === 'room'); localStorage.setItem('wj.room.view', next);
  for (const el of document.querySelectorAll<HTMLElement>('[data-view]')) el.classList.toggle('selected', el.dataset.view === next);
  if (state) topicChat.render(state.discussions, current, next === 'room', selected);
}
function connect(): void {
  stream?.close(); stream = new EventSource(`/api/events?after=${cursor}`);
  stream.addEventListener('open', () => { $('#connection-status').textContent = '● 실시간 연결'; $('#connection-status').classList.add('online'); scheduleRefresh(); });
  stream.addEventListener('error', () => { $('#connection-status').textContent = '재연결 중 · 작업은 유지'; $('#connection-status').classList.remove('online'); });
  stream.addEventListener('change', event => { const e = JSON.parse((event as MessageEvent<string>).data) as DurableEvent;
    if (e.id <= cursor) return; cursor = e.id; scheduleRefresh(); });
}
function scheduleRefresh(): void { if (timer) return; timer = window.setTimeout(() => { timer = 0; void refresh().catch(report); }, 250); }
function refresh(): Promise<void> {
  // An awaiting mutation needs a read started after it committed. Join one
  // following cycle, rather than waiting for an active stream to become quiet.
  if (refreshTask) { again = true; return refreshTask.then(() => refreshTask ?? refresh()); }
  if (timer) { clearTimeout(timer); timer = 0; }
  again = false;
  refreshTask = (async () => {
    if (!authStatus) await loadLogin();
    if (!authStatus?.passwordConfigured || setupToken) { lock(false); renderLogin(); return; }
    const selection = selected; const snapshot = await api<Snapshot>('/api/state');
    if (selection !== selected) { again = true; return; }
    const discussion = selection && snapshot.discussions.some(d => d.id === selection) ? (await api<{ discussion: Discussion }>(`/api/discussions/${selection}`)).discussion : null;
    // A connection/SSE refresh may have captured state before a just-created or
    // newly chosen topic. Discard that view rather than erase the user's choice.
    if (selection !== selected) { again = true; return; }
    state = snapshot; cursor = Math.max(cursor, state.cursor); current = discussion;
    if (!viewChosen) { const saved = localStorage.getItem('wj.room.view'); view = saved && ['room', 'connections', 'execution'].includes(saved) ? saved as View : 'room'; }
    if (!current) selected = '';
    $('#login').hidden = true; $('#workspace').hidden = false; render(); await roomView.refresh(state); topicChat.render(state.discussions, current, view === 'room', selected); if (!stream) connect();
  })().finally(() => { refreshTask = null; if (again) { again = false; scheduleRefresh(); } });
  return refreshTask;
}
function details(title: string, value: string, key = title): HTMLDetailsElement { const d = node('details'); d.dataset.key = key; d.append(node('summary', title), node('pre', value)); return d; }
function preserve(container: HTMLElement, render: () => void): void { const opened = [...container.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d => d.dataset.key); render(); for (const d of container.querySelectorAll<HTMLDetailsElement>('details')) d.open = opened.includes(d.dataset.key); }
function labelFor(id: string | null): string { return current?.members.find(p => p.id === id)?.label ?? state?.participants.find(p => p.id === id)?.label ?? '공통 자료'; }
function time(value: string): string { return new Date(value).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function selectOptions(select: HTMLSelectElement, options: { id: string; label: string }[], empty?: string): void {
  const previous = select.value; select.replaceChildren(); if (empty !== undefined) { const option = node('option', empty); option.value = ''; select.append(option); }
  for (const item of options) { const option = node('option', item.label); option.value = item.id; select.append(option); }
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function render(): void {
  if (!state) return;
  const signature = JSON.stringify([focusRoomId, state.participants, state.connections.map(c => [c.id, c.status, c.models, c.browser?.discovery]), state.bindings, state.discussions.map(d => [d.id, d.topic])]);
  if (signature !== choiceSignature) {
    const picker = $('#participant-picker'); const checked = new Set([...picker.querySelectorAll<HTMLInputElement>('input:checked')].map(e => e.value)); const first = !choiceSignature; picker.replaceChildren();
    for (const p of state.participants) { const label = node('label', '', 'participant-option'); const check = node('input'); check.type = 'checkbox'; check.name = 'participantId'; check.value = p.id; check.checked = checked.has(p.id) || first && p.kind === 'fake';
      const text = node('span', p.label); text.append(node('small', p.kind === 'fake' ? '모의 · 외부 호출 없음' : p.modelId)); label.append(check, text); picker.append(label); }
    updateConnections();
    selectOptions($('#discussion-binding'), state.bindings, '연결 없이 진행'); selectOptions($('#job-binding'), state.bindings);
    selectOptions($('#grant-discussion'), state.discussions.map(d => ({ id: d.id, label: d.topic }))); choiceSignature = signature;
  }
  $('#composer').hidden = !composingTopic; $('#discussion-detail').hidden = composingTopic || !current;
  dotView.render(state); if (current) renderDiscussion(); renderConnections(); renderJobs(); renderMaterials(); renderFocusBudget(); showView(view); scheduleAuthorityExpiry();
}
async function selectTopic(id: string): Promise<void> {
  roomView.closeNavigation(); $<HTMLDialogElement>('#topic-details-dialog').close(); if (selected !== id) current = null; selected = id;
  sessionStorage.setItem('wj.chat.selection', id); localStorage.setItem('wj.chat.selection', id); localStorage.setItem('wj.discussion', id); showView('room'); await refresh();
}
function openTopicDetails(next = tab): void {
  if (!current) return; composingTopic = false; tab = next; render(); $('#topic-dialog-title').textContent = '주제의 비교·근거·제어';
  $<HTMLDialogElement>('#topic-details-dialog').showModal();
}
function beginTopic(roomId?: string): void {
  roomView.closeNavigation();
  composingTopic = true; focusRoomId = roomId ?? (state?.resident.enabled ? state.resident.rooms[0]?.id ?? null : null);
  $<HTMLFormElement>('#discussion-form').reset(); choiceSignature = ''; showView('room'); render();
  $('#topic-dialog-title').textContent = '새 주제'; $<HTMLDialogElement>('#topic-details-dialog').showModal(); $('#topic').focus();
}
const dotView = new DotConnectionsView({ api, refresh, report });
const roomView = new RoomView({ api, refresh, report, openView: showView,
  openDiscussion: async id => { await selectTopic(id); openTopicDetails(); }, startFocus: beginTopic,
  setupConnection: id => {
    showView('connections'); clearParticipantEdit(); const c = state?.connections.find(c => c.id === id); if (!c) return;
    $<HTMLSelectElement>('#participant-mode').value = connectionMode(c); updateConnections(); $<HTMLSelectElement>('#participant-connection').value = c.id; updateModels();
    $<HTMLSelectElement>('#participant-model').dataset.explicitConnection = c.id; updateModels(); $<HTMLSelectElement>('#participant-model').value = ''; updateEffort();
    $<HTMLInputElement>('#participant-form [name=label]').value = c.label;
    if (c.status === 'connected' && c.models.length) $('#participant-form').scrollIntoView(); else [...document.querySelectorAll<HTMLElement>('#connections-list [data-connection-id]')].find(card => card.dataset.connectionId === c.id)?.scrollIntoView();
  },
});
const topicChat = new TopicChatView({ select: selectTopic, details: openTopicDetails, report, control: action => control({ action }),
  opinion: text => control({ action: 'revise', text }),
});
function dailyFocus(): boolean { return state?.resident.rooms.some(r => r.id === focusRoomId) ?? false; }
function renderFocusBudget(): void {
  const daily = dailyFocus();
  for (const key of ['maxRequests', 'maxMinutes']) { const input = $<HTMLInputElement>(`#discussion-form [name=${key}]`); input.disabled = daily; input.closest('label')!.hidden = daily; }
  $('#discussion-mode').hidden = !focusRoomId;
  $('#discussion-mode').textContent = daily ? '같은 방의 API 일일 한도를 공유합니다. GPT/dot/Muse 채팅 한도는 제외하며 검토 라운드와 도구 한도·승인은 유지합니다. API 소진 시 부분 완료로 방에 돌아옵니다.' : '이 채팅방 안에서 주제 토론을 시작합니다. 마치면 같은 방으로 돌아갑니다.';
  const room = state?.resident.rooms.find(r => r.id === focusRoomId);
  $<HTMLButtonElement>('#discussion-form .composer-bottom button').disabled = !!focusRoomId && (!room?.desiredOn || !!room.topicLink);
  if (focusRoomId && !room?.desiredOn) $('#discussion-mode').textContent = '방을 켠 뒤 이 주제를 시작할 수 있습니다. 먼저 창을 닫고 방 설정을 확인하세요.';
}
function renderMaterials(): void {
  if (!state) return;
  $('#material-roots').textContent = state.materialRoots.length ? '허용 경로: ' + state.materialRoots.join(', ') : '읽기 허용 경로가 없습니다. 서버의 WJ_MATERIAL_ROOTS에 공유할 파일·폴더를 지정하면 사용할 수 있습니다.';
  const signature = JSON.stringify(state.materialPackages); const target = $('#material-picker');
  if (signature !== materialSignature) {
    materialSignature = signature; const checked = new Set([...target.querySelectorAll<HTMLInputElement>('input:checked')].map(i => i.value)); target.replaceChildren();
    for (const pack of state.materialPackages) {
      const card = node('section', '', 'material-package'); const label = node('label', '', 'check'); const check = node('input'); check.type = 'checkbox'; check.value = pack.id; check.checked = checked.has(pack.id); label.append(check, node('span', pack.label));
      card.append(label, details('수집한 파일과 해시', pack.files.map(f => f.path + '\n' + f.size + ' bytes · ' + time(f.observedAt) + ' · 전체 파일\nSHA-256 ' + f.digest).join('\n\n'), pack.id)); target.append(card);
    }
  }
  const prepared = [...target.querySelectorAll<HTMLInputElement>('input')].find(i => i.value === pendingMaterialSelection);
  if (prepared) { prepared.checked = true; pendingMaterialSelection = null; }
}
async function browseMaterials(path: string): Promise<void> {
  const result = await api<{ path: string; entries: { name: string; directory: boolean }[] }>('/api/materials/list', { path });
  $<HTMLInputElement>('#material-folder').value = result.path; const target = $('#material-directory'); target.replaceChildren();
  for (const entry of result.entries) {
    const child = result.path.replace(/\/$/, '') + '/' + entry.name;
    target.append(button((entry.directory ? '폴더 · ' : '추가 · ') + entry.name, async () => {
      if (entry.directory) await browseMaterials(child);
      else { const input = $<HTMLTextAreaElement>('#material-paths'); input.value = [...new Set([...input.value.split('\n').filter(Boolean), child])].join('\n'); }
    }));
  }
}
function connectionMode(c: Connection): string {
  if (gptKind(c.kind)) return 'gpt';
  if (c.kind === 'dot-mcp') return 'dot';
  if (c.kind === 'browser' && c.browser) {
    try { if (new URL(c.browser.url).hostname === 'chatgpt.com') return 'web-gpt'; } catch { return 'other'; }
  }
  return 'other';
}
function updateConnections(): void {
  const mode = $<HTMLSelectElement>('#participant-mode').value;
  const connections = state?.connections.filter(c => c.status === 'connected' && connectionMode(c) === mode) ?? [];
  selectOptions($('#participant-connection'), connections.map(c => ({ id: c.id, label: `${c.label} · ${c.kind === 'browser' ? c.browser?.agentLabel ?? '기존 대화' : c.kind}` })), '연결 선택');
  if (connections.length === 1) $<HTMLSelectElement>('#participant-connection').value = connections[0]!.id;
  $('#participant-dot-connect').hidden = mode !== 'dot';
  $('#participant-web-connect').hidden = mode !== 'web-gpt';
  const fields = $<HTMLFieldSetElement>('#participant-fields'); fields.hidden = mode === 'dot'; fields.disabled = mode === 'dot';
  $('#participant-mode-note').textContent = mode === 'dot' ? '공식 dot 전용 연결에서 방·토커를 함께 등록합니다. 기존 ChatGPT 웹 대화는 dot으로 간주하지 않습니다.' : mode === 'web-gpt' ? '서버 Chrome의 실제 ChatGPT 웹 대화에서 질문을 보내고 답변을 받습니다. 연결할 계정과 대화를 먼저 확인하세요.' : mode === 'gpt' ? 'OAuth 또는 기기 코드로 모델을 호출하며 앱이 대화 이력을 관리합니다. ChatGPT 웹 대화와 별도의 구독 사용 제한이 적용될 수 있습니다.' : 'API와 Muse 등 등록한 기존 연결을 선택합니다. 기존 웹 연결의 원문과 기록은 그대로 유지됩니다.';
  updateModels();
}
function updateModels(): void { const c = state?.connections.find(c => c.id === $<HTMLSelectElement>('#participant-connection').value); const select = $<HTMLSelectElement>('#participant-model'); selectOptions(select, c?.models ?? [], c && select.dataset.explicitConnection === c.id ? '모델을 선택하세요' : undefined); updateEffort(); }
function updateEffort(): void {
  const c = state?.connections.find(c => c.id === $<HTMLSelectElement>('#participant-connection').value); const select = $<HTMLSelectElement>('#participant-effort'); select.disabled = !reasoningKind(c?.kind);
  select.closest('label')!.hidden = c?.kind === 'browser';
  const modelId = $<HTMLSelectElement>('#participant-model').value, previous = select.value, changed = select.dataset.kind !== (c?.kind ?? ''); select.dataset.kind = c?.kind ?? '';
  selectOptions(select, (c?.kind === 'deepseek' ? effortChoices(c, modelId) : effortOptions).map(o => ({ id: o.value, label: o.label })));
  const allowed: readonly string[] = c?.kind === 'codex-oauth' ? c.models.find(m => m.id === $<HTMLSelectElement>('#participant-model').value)?.reasoningEfforts ?? [] : effortOptions.map(e => e.value);
  for (const option of select.options) option.disabled = c?.kind !== 'deepseek' && !allowed.includes(option.value);
  if (c?.kind === 'deepseek' && (changed || !select.value)) select.value = 'default';
  else if (c?.kind === 'codex-oauth' && (changed || !allowed.includes(previous))) select.value = effortOptions.filter(e => allowed.includes(e.value)).at(-1)?.value ?? '';
  else if (gptKind(c?.kind) && (changed || !allowed.includes(previous))) select.value = 'xhigh';
  const source = c?.models.find(m => m.id === modelId)?.reasoningSource;
  const output = $<HTMLInputElement>('#participant-output'); output.disabled = c?.kind !== 'deepseek'; $('#participant-output-controls').hidden = output.disabled; output.max = String(outputMaximum(c, modelId)); if (changed) output.value = ''; $('#participant-output-note').textContent = outputNote(c, modelId);
  $('#participant-effort-note').textContent = c?.kind === 'deepseek' ? source ? `제공처 기본값은 요청을 덮어쓰지 않습니다. ${source === 'catalog' ? '실제 모델 목록' : '제공처 공식 문서'}에서 확인한 값만 선택합니다.` : '사고 설정 지원 정보가 없어 제공처 기본값만 표시합니다. 연결 카드에서 모델 확인을 눌러 주세요.' : c?.kind === 'browser' ? connectionMode(c) === 'web-gpt' ? '모델과 사고 깊이는 원래 ChatGPT 웹 화면에서 조절합니다.' : '기존 웹 대화의 모델과 사고 깊이는 원래 서비스에서 조절합니다.' : c?.kind === 'codex-oauth' ? '이 계정의 모델 목록에서 확인한 사고 깊이만 선택합니다. Extra high를 지원하면 기본으로 사용합니다.' : gptKind(c?.kind) ? '기본 Extra high. 모델이 지원하지 않는 값은 오류로 표시합니다.' : '이 연결은 제공처의 기본 사고 설정을 사용합니다.';
}
function control(body: Record<string, unknown>): Promise<unknown> { if (!current) return Promise.resolve(); return api(`/api/discussions/${current.id}/control`, { expectedRevision: current.revision, ...body }).then(refresh); }
function renderDiscussion(): void {
  if (!current) return; const d = current;
  $('#discussion-title').textContent = d.topic; $('#discussion-meta').textContent = `DISCUSSION / REVISION ${d.revision} · ${time(d.createdAt)}`;
  const unknownUsage = Math.max(d.used.unknownUsage, d.turns.filter(t => t.dispatchStartedAt && !['prepared', 'running'].includes(t.status) && t.usage === null).length);
  const stateLine = $('#discussion-state'); stateLine.replaceChildren(badge(d.status), node('span', `${d.budgetMode === 'api-daily' ? '요청 ' + d.used.requests + '회 · API 일일 공통 한도' : '요청 ' + d.used.requests + '/' + d.limits.maxRequests} · 토큰 ${d.used.inputTokens + d.used.outputTokens} · 사용량 미확인 ${unknownUsage}회`, 'small muted'));
  if (d.reason) stateLine.append(node('span', errors[d.reason] ?? d.reason, 'small muted'));
  const track = $('#phase-track'); track.replaceChildren(); const order = Object.keys(phases) as Phase[];
  for (const [index, phase] of order.entries()) track.append(node('div', `${String(index + 1).padStart(2, '0')} ${phases[phase]}`, `phase-step ${phase === d.phase ? 'current' : index < order.indexOf(d.phase) ? 'past' : ''}`));
  const controls = $('#run-controls'); controls.replaceChildren();
  if (d.status === 'running') controls.append(button('일시정지', () => control({ action: 'pause' })));
  if (['paused', 'blocked'].includes(d.status)) controls.append(button('이어가기', () => control({ action: 'resume' }), 'primary'));
  if (['running', 'paused', 'blocked'].includes(d.status)) controls.append(button('조건 보완', () => modal('토의 조건 보완', [{ name: 'text', label: '추가 조건', multiline: true }], values => control({ action: 'revise', ...values }))), button('토의 취소', () => modal('토의 취소', [], () => control({ action: 'cancel' }), '이미 전송된 응답과 Codex 실행은 기록에 남습니다. Codex 중단은 실행 화면에서 별도로 요청할 수 있습니다.')));
  controls.append(node('span', `${(d.used.activeMs / 60000).toFixed(1)}${d.budgetMode === 'api-daily' ? '분 경과' : ' / ' + d.limits.maxActiveMs / 60000 + '분'} · 실행 ${d.used.toolJobs}/${d.limits.maxToolJobs}`, 'small muted'));
  const members = $('#member-status'); members.replaceChildren();
  for (const p of d.members) { const context = d.contexts.find(c => c.participantId === p.id)!; const card = node('article', '', 'member-card'); const head = node('div', '', 'inline'); head.append(node('span', p.kind === 'fake' ? 'F' : gptKind(p.kind) ? 'G' : p.kind === 'deepseek' ? 'D' : p.label.slice(0, 1), 'avatar'), node('span', p.label, 'name'));
    card.append(head, node('div', `${d.excludedIds.includes(p.id) ? '참여 제외 · ' : ''}${p.modelId} · 문맥 ${context.generation}`, 'small muted'));
    if (reasoningKind(p.kind)) {
      card.append(node('p', '사고 깊이 · ' + effortLabel(savedEffort(p)), 'small muted'));
      card.append(button('사고 깊이 변경', () => { if (!['paused', 'blocked'].includes(d.status)) { announce('토의를 일시정지하고 현재 발언이 끝난 뒤 변경하세요.', true); return; }
        modal('이 토의의 사고 깊이', [{ name: 'reasoningEffort', label: '사고 깊이', options: effortChoices(state?.connections.find(c => c.id === p.connectionId), p.modelId), value: savedEffort(p) }], values => control({ action: 'configure_participant', participantId: p.id, ...values }), '완료된 발언은 보존하고 이후 발언부터 적용합니다.'); }));
    }
    if (p.kind === 'deepseek') {
      card.append(node('p', '출력 한도 · ' + (p.maxOutputTokens ?? 4096).toLocaleString('ko-KR') + '토큰', 'small muted'));
      card.append(button('출력 한도 변경', () => { if (!['paused', 'blocked'].includes(d.status) || d.turns.some(t => ['prepared', 'running', 'unconfirmed'].includes(t.status))) { announce('토의를 일시정지하고 진행·미확정 응답을 확인한 뒤 변경하세요.', true); return; }
        const c = state?.connections.find(c => c.id === p.connectionId);
        modal('이 토의의 출력 한도', [{ name: 'maxOutputTokens', label: '출력 한도 (토큰)', required: false, number: { min: 512, max: outputMaximum(c, p.modelId) }, value: p.maxOutputTokens?.toString() ?? '' }], values => control({ action: 'configure_participant', participantId: p.id, maxOutputTokens: outputValue(values.maxOutputTokens ?? '') }), outputNote(c, p.modelId) + ' 완료된 발언은 보존하고 이후 발언부터 적용합니다.'); }));
    }
    const job = state?.jobs.filter(j => j.discussionId === d.id && d.tasks.some(t => t.id === j.taskId && t.participantId === p.id)).at(-1); const toolState = job?.status ?? context.observation.tool;
    card.append(node('div', `연결 ${states[context.observation.connection] ?? context.observation.connection} / 응답 ${states[context.observation.response] ?? context.observation.response}\n도구 ${states[toolState] ?? toolState} / 업무 ${states[d.status] ?? d.status}`, 'observations')); members.append(card); }
  for (const el of document.querySelectorAll<HTMLElement>('[data-tab]')) el.classList.toggle('selected', el.dataset.tab === tab);
  preserve($('#discussion-content'), () => {
    const target = $('#discussion-content'); target.replaceChildren();
    if (tab === 'timeline') renderTimeline(target, d); else if (tab === 'comparison') renderComparison(target, d);
    else if (tab === 'evidence') renderEvidence(target, d); else if (tab === 'tasks') renderTasks(target, d); else renderRecords(target, d);
  });
}
function renderTimeline(target: HTMLElement, d: Discussion): void {
  if (!d.turns.length) target.append(node('div', '참여자의 첫 제안을 기다리고 있습니다.', 'empty'));
  for (const t of d.turns) {
    const card = node('article', '', 'turn'); const head = node('header', '', 'turn-header'); const who = node('div', '', 'inline'); who.append(node('strong', labelFor(t.participantId)), node('span', `${phases[t.phase]} · ${t.round}회`, 'muted')); head.append(who, badge(t.status));
    card.append(head, node('div', (t.reply?.text ?? t.text) || (t.status === 'failed' ? '완료된 응답이 없습니다. 실패 기록을 확인해 주세요.' : t.status === 'unconfirmed' ? '응답 수신 여부를 원래 요청과 대조해야 합니다.' : '응답을 기다리고 있습니다…'), 'reply'));
    if (t.reply?.uncertainty.length) card.append(node('div', t.reply.uncertainty.join('\n'), 'uncertainty'));
    if (t.reply?.reviews.length) { const reviews = node('div'); for (const r of t.reply.reviews) reviews.append(node('p', `${r.stance === 'challenge' ? '반론' : r.stance === 'support' ? '지지' : '미확인'} · ${d.claims.find(c => c.id === r.claimId)?.text ?? r.claimId}\n${r.reason}`, 'small')); card.append(reviews); }
    card.append(node('footer', `revision ${t.revision} · 문맥 ${t.generation} · ${time(t.startedAt)}${t.reasoningEffort ? ' · 요청 사고 깊이 ' + effortLabel(t.reasoningEffort) : ''}${t.error ? ` · ${t.error}` : ''}${t.providerFinishReason ? ' · ' + ({ stop: '제공처 stop 수신 · 스트림 완료 미확정', length: '응답 출력 한도 도달', content_filter: '제공처 필터로 종료', tool_calls: '도구 호출로 종료', function_call: '함수 호출로 종료', other: '제공처의 기타 종료' }[t.providerFinishReason]) : ''}`));
    if (t.maxOutputTokens !== undefined) card.append(node('p', '요청 출력 한도 · ' + t.maxOutputTokens.toLocaleString('ko-KR') + '토큰', 'small muted'));
    card.append(details('원본 응답과 수신 기록', JSON.stringify({ turnId: t.id, receipt: t.receipt, usage: t.usage, maxOutputTokens: t.maxOutputTokens ?? null, evidenceIds: t.evidenceIds, promptDigest: t.promptDigest, raw: t.text }, null, 2), t.id)); target.append(card);
  }
}
function renderComparison(target: HTMLElement, d: Discussion): void {
  target.append(node('p', '합의는 사실 검증을 뜻하지 않습니다. 아래 결과와 근거 탭의 실제 관측 기록을 함께 확인하세요.', 'small muted'));
  const grid = node('div', '', 'comparison-grid');
  for (const p of d.members) { const card = node('article', '', 'panel'); card.append(node('h2', p.label)); for (const phase of ['independent', 'revision'] as const) {
      const t = d.turns.filter(t => t.participantId === p.id && t.revision === d.revision && t.phase === phase && t.status === 'completed').at(-1);
      card.append(node('p', phase === 'independent' ? 'INITIAL / 초기안' : 'REVISED / 수정안', 'comparison-label'), node('div', t?.reply?.text ?? t?.text ?? '아직 작성되지 않았습니다.', 'reply'));
      if (t?.reply?.uncertainty.length) card.append(node('div', t.reply.uncertainty.join('\n'), 'uncertainty')); }
    grid.append(card); } target.append(grid);
  for (const t of d.turns.filter(t => t.revision === d.revision && ['synthesis', 'summary_review'].includes(t.phase))) { const card = node('article', '', 'panel'); card.append(node('h2', `${phases[t.phase]} · ${labelFor(t.participantId)}`), node('div', t.reply?.text ?? t.text ?? '대기', 'reply')); target.append(card); }
}
function renderEvidence(target: HTMLElement, d: Discussion): void {
  const claims = node('section', '', 'panel'); claims.append(node('h2', '검토할 주장'));
  for (const c of d.claims.filter(c => c.revision === d.revision)) { const item = node('div', '', 'claim'); item.append(node('p', c.text, 'reply'), node('span', `${labelFor(c.participantId)} · ${c.id}`, 'small muted')); if (c.assumptions.length) item.append(node('p', `가정: ${c.assumptions.join(' / ')}`, 'small muted')); const evidence = d.evidence.filter(e => e.claimIds.includes(c.id)); item.append(node('p', evidence.length ? `연결된 자료 ${evidence.length}개 · 관측 ${evidence.filter(e => e.status === 'observed').length}개` : '독립 검증 자료 없음', 'small')); claims.append(item); } target.append(claims);
  if (!d.evidence.length) target.append(node('div', '아직 수집한 근거가 없습니다.', 'empty'));
  for (const e of d.evidence) { const card = node('article', '', 'panel'); const head = node('div', '', 'inline'); head.append(badge(e.status), node('span', e.kind, 'small muted')); card.append(head, node('p', e.source, 'small'));
    if (e.material) card.append(node('p', e.material.size + ' bytes · 전체 파일 사본 · 주장 검증과 별개', 'small muted'));
    if (/^https?:\/\//.test(e.source)) { const a = node('a', '출처 원문 열기 ↗'); a.href = e.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; card.append(a); }
    card.append(node('div', e.text || '실제로 얻은 자료가 없습니다.', 'reply'), node('p', `${e.reason ?? ''} · ${time(e.observedAt)} · revision ${e.revision}`, 'small muted'), details('근거 ID와 원문 해시', `${e.id}\n${e.digest}\nclaims: ${e.claimIds.join(', ')}`, e.id)); target.append(card); }
}
function renderTasks(target: HTMLElement, d: Discussion): void {
  const tasks = d.tasks.filter(t => t.revision === d.revision); if (!tasks.length) target.append(node('p', '배정된 과제가 없습니다.', 'empty'));
  for (const t of tasks) { const item = node('article', '', 'task'); const body = node('div'); body.append(node('strong', `${phases[t.phase]} · ${labelFor(t.participantId)}`), node('p', t.question || (t.claimIds.length ? `대상 주장: ${t.claimIds.join(', ')}` : '주제와 공통 기준에 따라 검토')),
      node('p', `${t.method ?? '대화'} · ${t.id}${t.jobId ? ` · ${t.jobId}` : ''}${t.reason ? ` · ${t.reason}` : ''}`, 'muted')); item.append(body, badge(t.status)); target.append(item); }
}
function renderRecords(target: HTMLElement, d: Discussion): void {
  for (const t of d.turns.filter(t => t.status === 'unconfirmed')) { const card = node('section', '', 'panel'); card.append(node('h2', `응답 대조 · ${labelFor(t.participantId)}`), node('p', '기존 대화와 수신 기록을 확인하고 처리합니다. 새 응답을 보내지 않습니다.', 'small muted'), details('미확인 요청', JSON.stringify(t, null, 2), t.id)); const row = node('div', '', 'toolbar');
    row.append(button('완료 응답 반영', () => modal('원격 완료 기록 반영', [{ name: 'text', label: '실제 JSON 응답 원문', multiline: true }, { name: 'receipt', label: '대화 URL 또는 응답 ID' }], data => control({ action: 'reconcile', turnId: t.id, resolution: 'completed', ...data }))),
      button('전송되지 않음 확인', () => modal('미전송 확인', [], () => control({ action: 'reconcile', turnId: t.id, resolution: 'not_sent' }), '원격 대화에 요청이 없음을 직접 확인했을 때 적용하세요. 이어가기를 누르면 새 요청을 보냅니다.')),
      button('이 응답 건너뛰기', () => control({ action: 'reconcile', turnId: t.id, resolution: 'skip' })));
    if (d.members.find(p => p.id === t.participantId)?.kind === 'dot-mcp' && ['paused', 'blocked'].includes(d.status)) row.append(button('중단 확인 후 재시도 준비', () => modal('dot 재시도 준비', [
      { name: 'stoppedWithoutSubmit', label: '원래 dot 실행이 중단됐고 답변을 제출하지 않았음을 확인했습니다.', checkbox: true },
      { name: 'note', label: '확인한 실행 시각·중단 단계·미제출 근거', multiline: true },
    ], async data => { await control({ action: 'reconcile', turnId: t.id, resolution: 'retry_after_stop', stoppedWithoutSubmit: data.stoppedWithoutSubmit === 'on', note: data.note }); announce('재시도를 준비했습니다. dot 연결·방 설정을 확인하고 이어가기를 누르세요.'); },
    '감시 비활성이나 방 끄기만으로 실행 종료를 판단하지 마세요. 원래 실패와 완료된 답변은 보존합니다. 지금 새 요청을 보내지 않으며, 이어가기를 눌러야 실행합니다.', '재시도 준비')),
      button('제출 오류 후 재시도 준비', () => modal('dot 제출 오류 재시도 준비', [
        { name: 'stoppedAfterFailedSubmit', label: '제출 오류 뒤 원래 dot 실행이 중단됐고 추가 제출이 없음을 확인했습니다.', checkbox: true },
        { name: 'note', label: '확인한 실행 시각·제출 오류·중단 근거', multiline: true },
      ], async data => { await control({ action: 'reconcile', turnId: t.id, resolution: 'retry_after_failed_submit', stoppedAfterFailedSubmit: data.stoppedAfterFailedSubmit === 'on', note: data.note }); announce('제출 오류를 기록하고 재시도를 준비했습니다. dot 연결·방 설정을 확인하고 이어가기를 누르세요.'); },
      '제출이 오류로 끝나고 원래 dot 실행이 멈춘 경우에 사용합니다. 기존 dot 연결의 권한을 먼저 회수하세요. 확인된 답변이나 영수증이 있으면 원래 결과를 대조해야 합니다. 원래 실패와 완료된 답변은 보존하며, 이어가기를 눌러야 새 요청을 보냅니다.', '재시도 준비')));
    if (d.members.find(p => p.id === t.participantId)?.kind === 'dot-mcp' && ['paused', 'blocked'].includes(d.status)) row.append(button('종료 미확인·권한 회수 후 재시도 준비', () => modal('dot 종료 미확인 재시도 준비', [
      { name: 'acceptUnverifiedExecution', label: '원격 실행 종료·제출 이력 미확인과 옛 실행자가 새 요청에 접근할 위험을 이해하고 수락합니다.', checkbox: true },
      { name: 'monitorDisabled', label: '현재 dot 감시가 비활성임을 확인했습니다.', checkbox: true },
      { name: 'note', label: '권한 회수·감시 비활성 확인 근거와 미확인 이력 (1~1,000자)', multiline: true, maxLength: 1000 },
    ], async data => {
      if (data.acceptUnverifiedExecution !== 'on') throw new Error('dot_unverified_execution_acceptance_required');
      if (data.monitorDisabled !== 'on') throw new Error('dot_monitor_disabled_confirmation_required');
      const note = data.note?.trim() ?? ''; if (!note || note.length > 1000) throw new Error('확인 근거를 1~1,000자로 입력해 주세요.');
      await control({ action: 'reconcile', turnId: t.id, resolution: 'retry_after_authority_revoked', acceptUnverifiedExecution: true, monitorDisabled: true, note });
      announce('종료·제출 이력 미확인을 기록하고 재시도를 준비했습니다. dot 연결·방 설정을 확인한 뒤 별도로 이어가기를 누르세요.');
    }, '원격 실행의 종료와 제출 이력은 확인되지 않았습니다. 먼저 원래 dot 연결 권한을 회수하세요. 권한 회수는 옛 요청의 결과 반영을 차단하지만, 잠들어 있던 옛 실행자가 갱신된 전달기를 통해 새 요청을 조회·점유하는 것까지 막는다고 보장하지 않습니다. 감시 비활성은 원격 종료의 증거가 아닙니다. 완료된 답변과 원래 기록은 보존하며 토의는 확인 필요·일시정지 상태를 유지합니다. 지금 새 요청을 보내지 않으며, 별도로 이어가기를 눌러야 실행합니다.', '재시도 준비')));
    card.append(row); target.append(card); }
  for (const t of d.turns.filter(t => t.error === 'owner_confirmed_retry_after_authority_revoked')) {
    const card = node('section', '', 'panel'); card.dataset.recoveryTurnId = t.id;
    card.append(node('h2', `권한 회수 후 앱 대조 종료 · ${labelFor(t.participantId)}`), node('p', '원격 종료·제출 이력 미확인', 'uncertainty'),
      node('p', '앱에서 옛 요청의 대조를 마쳤습니다. 원격 dot 실행의 종료나 미제출을 확인한 기록이 아닙니다. 원래 기록의 종료 시각은 앱의 기존 처리 시각이며 원격 종료 시각이 아닙니다.', 'small'),
      details('대조한 원래 요청과 앱 처리 기록', JSON.stringify(t, null, 2), t.id)); target.append(card);
  }
  const handoff = node('section', '', 'panel'); handoff.append(node('h2', '문맥과 참여자 관리'), node('p', '문맥 전환은 기존 원문·근거·미해결 과제를 보존합니다. 주제 revision과 별도로 기록합니다.', 'small muted'));
  for (const p of d.members) { const row = node('div', '', 'toolbar'); row.append(node('span', p.label)); if (p.kind !== 'browser') row.append(button('체크포인트 적용', () => control({ action: 'handoff', participantId: p.id, expectedGeneration: d.contexts.find(c => c.participantId === p.id)!.generation })));
    if (!d.excludedIds.includes(p.id) && ['running', 'paused', 'blocked'].includes(d.status)) row.append(button('참여 제외', () => modal('참여자 제외', [], () => control({ action: 'exclude', participantId: p.id }), `${p.label}의 기존 결과는 남기고, 이후 과제에서 제외합니다.`))); handoff.append(row); } target.append(handoff);
  for (const cp of d.checkpoints) target.append(details(`${labelFor(cp.participantId)} · 문맥 ${cp.generation} · ${cp.reason}`, JSON.stringify(cp, null, 2), cp.id));
  const download = button('전체 토의 JSON 내려받기', () => { const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = `${d.id}.json`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }); target.append(download);
}
function renderConnections(): void {
  if (!state) return; const target = $('#connections-list'); target.replaceChildren();
  for (const c of state.connections) { const service = c.kind === 'deepseek' ? ({ deepseek: 'DeepSeek 공식 API', coralbricks: 'CoralBricks · DeepSeek', river: 'River · DeepSeek' }[c.apiService ?? 'deepseek']) : c.kind === 'codex-oauth' ? 'GPT · 기기 코드 연결 (Codex)' : c.kind === 'anthropic' ? 'Anthropic · Claude API' : c.kind;
    const card = c.kind === 'dot-mcp' ? dotView.card(c) : node('article', '', 'connection-card'); card.dataset.connectionId = c.id; if (c.kind !== 'dot-mcp') card.append(node('h3', c.label), badge(c.status), node('p', `${service}${c.email ? ` · ${c.email}` : ''}`, 'muted'), node('p', `${c.models.length}개 모델${c.error ? ` · ${errors[c.error] ?? c.error}` : ''}`, 'small'));
    if (c.modelError) card.append(node('p', `모델 조회 HTTP ${c.modelError.httpStatus}${c.modelError.providerCode ? ' · ' + c.modelError.providerCode : ''}`, 'small muted'));
    if (c.apiService === 'coralbricks' && c.error === 'coralbricks_verification_required') {
      const link = node('a', 'CoralBricks 계정 검증 페이지 열기 ↗'); link.href = 'https://www.coralbricks.ai/organization/billing'; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link);
    }
    if (c.browser?.thread) card.append(node('p', `연결된 대화 ID: ${c.browser.thread.value}`, 'small muted'));
    const row = node('div', '', 'toolbar'); if (c.kind !== 'dot-mcp') row.append(button('모델 확인', async () => { await api(`/api/connections/${c.id}/models`, {}); await refresh(); }));
    if (c.kind === 'openai-oauth') row.append(button('다시 로그인', async () => {
      const start = async (expectedEmail: string) => { await showOAuth(await api('/api/connections/oauth', { label: c.label, connectionId: c.id, expectedEmail })); };
      if (c.expectedEmail || c.email) await start(c.expectedEmail || c.email!);
      else modal('로그인할 GPT 계정 확인', [{ name: 'expectedEmail', label: '웹 GPT 계정 이메일', email: true }], async values => { await start(values.expectedEmail!); }, '등록된 계정 ID는 유지합니다. dot과 다른 계정의 이메일을 입력하세요.');
    }), button('이 계정 로그아웃', async () => { const result = await api<{ revoked: boolean }>(`/api/connections/${c.id}/logout`, {}); announce(result.revoked ? '계정 연결을 해제했습니다.' : '로컬 인증 정보를 지웠습니다. 원격 폐기 여부는 확인하지 못했습니다.'); await refresh(); }));
    if (c.kind === 'deepseek' || c.kind === 'anthropic') row.append(button('API 키 갱신', () => modal(`${service} 키 갱신`, [{ name: 'key', label: '새 API 키', secret: true }], async values => { await api(`/api/connections/${c.id}/credential`, values); await refresh(); })));
    if (c.kind === 'browser' && c.browser) { const browserBinding = c.browser; row.append(button('기존 대화 다시 찾기', async () => {
      $<HTMLDetailsElement>('#browser-connection-panel').open = true; await loadBrowserPages(); $<HTMLSelectElement>('#browser-discovery-connection').value = c.id; invalidateDiscovery(); $('#browser-discovery-form').scrollIntoView();
    }), button('페이지·선택자 갱신', () => { const form = $<HTMLFormElement>('#browser-form'); const owner = form.closest('details')!; owner.open = true; $<HTMLDetailsElement>('#browser-connection-panel').open = true;
      let hidden = form.elements.namedItem('connectionId') as HTMLInputElement | null; if (!hidden) { hidden = node('input'); hidden.type = 'hidden'; hidden.name = 'connectionId'; form.append(hidden); } hidden.value = c.id;
      for (const [key, value] of Object.entries({ label: c.label, ...browserBinding, threadSelector: browserBinding.thread?.selector ?? '', threadAttribute: browserBinding.thread?.attribute ?? '', threadValue: browserBinding.thread?.value ?? '', threadJsonKey: browserBinding.thread?.jsonKey ?? '', sendAppearsAfterInput: !!browserBinding.sendAppearsAfterInput })) {
        const input = form.elements.namedItem(key) as HTMLInputElement | null; if (input) { if (input.type === 'checkbox') input.checked = value === true; else input.value = String(value); }
      } owner.scrollIntoView({ behavior: 'smooth' }); })); }
    if (c.kind === 'codex-oauth') row.append(button('기기 코드 로그인', async () => { await startDevice({ label: c.label, expectedEmail: c.expectedEmail ?? c.email ?? '', connectionId: c.id }); }), button('이 계정 로그아웃', async () => { await api(`/api/connections/${c.id}/logout`, {}); announce('로컬 연결을 해제했습니다. 원격 인증 폐기 여부는 확인하지 못했습니다.'); await refresh(); }));
    row.append(button('연결 삭제', () => {
      const requestId = crypto.randomUUID();
      modal(`연결 삭제 · ${c.label}`, [], async () => {
        await api(`/api/connections/${c.id}/remove`, {}, requestId);
        if (deviceLogin?.connectionId === c.id) closeDeviceScreen();
        await refresh(); announce('연결과 이 서버의 인증 정보를 삭제했습니다. 기존 대화와 토커 기록은 보존했습니다.');
      }, `${service} · ${c.email ?? c.label} 연결을 목록에서 지우고 이 서버의 인증 정보를 삭제합니다. 기존 대화·토커·원래 Chrome 대화는 보존됩니다. 외부 서비스의 로그인 권한 폐기는 확인하지 않습니다. 사용 중이거나 미확정 응답이 있으면 삭제할 수 없습니다.`, '삭제');
    }, 'danger'));
    card.append(row); target.append(card); }
  if (!state.connections.length) target.append(node('p', '등록된 실제 계정이 없습니다. 사용할 연결을 추가해 주세요.', 'small muted'));
  const participants = $('#participants-list'); participants.replaceChildren();
  for (const p of state.participants.filter(p => p.kind !== 'fake')) {
    const connection = state.connections.find(c => c.id === p.connectionId); const card = node('article', '', 'connection-card');
    card.append(node('h3', p.label), node('p', '계정 · ' + (connection?.email ?? connection?.browser?.accountLabel ?? connection?.label ?? '연결 삭제됨 · 이전 대화 기록 보존'), 'small muted'), node('p', p.modelId + (reasoningKind(p.kind) ? ' · ' + effortLabel(savedEffort(p)) : ''), 'small'));
    if (p.kind === 'deepseek') card.append(node('p', '출력 한도 · ' + (p.maxOutputTokens ?? 4096).toLocaleString('ko-KR') + '토큰', 'small'));
    card.append(button(p.kind === 'dot-mcp' ? '공식 dot 연결 설정' : '토커 설정 변경', () => { if (p.kind === 'dot-mcp') { dotView.open(); return; } if (connection?.status !== 'connected') { announce('먼저 해당 계정을 로그인하고 모델을 확인해 주세요.', true); return; }
      const form = $<HTMLFormElement>('#participant-form'); let hidden = form.elements.namedItem('participantId') as HTMLInputElement | null;
      if (!hidden) { hidden = node('input'); hidden.type = 'hidden'; hidden.name = 'participantId'; form.append(hidden); } hidden.value = p.id;
      $<HTMLSelectElement>('#participant-mode').value = connectionMode(connection); updateConnections(); $<HTMLSelectElement>('#participant-connection').value = p.connectionId!; updateModels(); $<HTMLSelectElement>('#participant-model').value = p.modelId;
      (form.elements.namedItem('label') as HTMLInputElement).value = p.label; (form.elements.namedItem('role') as HTMLInputElement).value = p.role;
      $<HTMLSelectElement>('#participant-effort').value = savedEffort(p); updateEffort(); $<HTMLInputElement>('#participant-output').value = p.maxOutputTokens?.toString() ?? ''; $('#participant-save').textContent = '토커 설정 저장'; $('#participant-edit-cancel').hidden = false; form.scrollIntoView({ behavior: 'smooth' });
    })); participants.append(card);
  }
  $('#browser-state').textContent = `${state.capabilities.browserConfigured ? 'Chrome 명령 설정됨' : 'Chrome 명령 미설정'} · ${state.browserPaused ? '수동 조작 중 · 자동 입력 잠김' : '자동 입력 가능'} · ${state.capabilities.noVncConfigured ? '화면 연결 설정됨' : '화면 연결 미설정'}`;
  const browserSignature = JSON.stringify(state.connections.filter(c => c.kind === 'browser').map(c => [c.id, c.label, c.browser]));
  if (browserSignature !== browserChoices) { browserChoices = browserSignature; selectOptions($('#browser-discovery-connection'), state.connections.filter(c => c.kind === 'browser'), '새 연결'); }
  const grants = $('#grants-list'); grants.replaceChildren();
  for (const grant of state.grants) {
    const row = node('section', '', 'authority-card'); row.dataset.grantId = grant.id;
    const reason = grant.revoked ? 'execution_authority_revoked' : authorityReason(grant.authority);
    row.append(node('p', `${grant.participantId} · ${reason ? executionReason(reason) : '권한 유효'}`, 'small'), node('p', authorityExpiry(grant.authority), 'small muted'), node('p', grant.tools.join(', '), 'small muted'));
    if (!grant.revoked && !grant.authority?.revokedAt) row.append(button('폐기', async () => { await api('/api/grants/revoke', { id: grant.id }); await refresh(); }));
    grants.append(row);
  }
}
function closeDeviceScreen(): void { clearTimeout(deviceTimer); deviceTimer = 0; deviceLogin = null; deviceSequence++; $('#device-code').textContent = ''; $('#device-actions').hidden = true; $<HTMLDialogElement>('#device-login-dialog').close(); }
async function startDevice(input: Record<string, string>): Promise<void> {
  closeDeviceScreen(); const sequence = deviceSequence; const dialog = $<HTMLDialogElement>('#device-login-dialog');
  $('#device-code').textContent = ''; $('#device-actions').hidden = true; $('#device-status').textContent = '로그인 코드를 준비하고 있습니다.'; dialog.showModal();
  try {
    const result = await api<DeviceSignin>('/api/connections/codex-oauth', input);
    if (sequence !== deviceSequence) return; deviceLogin = { connectionId: result.connectionId, attemptId: result.attemptId }; await showDevice(result); await refresh();
  } catch (e) { if (sequence === deviceSequence) $('#device-status').textContent = errors[e instanceof Error ? e.message : ''] ?? '로그인을 시작하지 못했습니다. 계정 카드와 오류 알림을 확인해 주세요.'; throw e; }
}
async function showDevice(result: DeviceSignin): Promise<void> {
  const active = deviceLogin; if (!active || active.connectionId !== result.connectionId || active.attemptId !== result.attemptId) return;
  clearTimeout(deviceTimer); deviceTimer = 0;
  $('#device-actions').hidden = result.status !== 'pending'; $('#device-code').textContent = result.status === 'pending' ? result.userCode ?? '' : '';
  if (result.status === 'pending') {
    if (result.verificationUrl !== $<HTMLAnchorElement>('#device-open').href || !result.userCode) throw new Error('device_login_start_failed');
    $('#device-status').textContent = `이 기기에서 인증 페이지를 열고 위 코드를 입력하세요. 서버 Chrome은 필요하지 않습니다. 만료 ${new Date(result.expiresAt).toLocaleTimeString('ko-KR')}`;
    deviceTimer = window.setTimeout(() => { void pollDevice(active).catch(report); }, 2000); return;
  }
  if (result.status === 'completed') {
    $('#device-status').textContent = '계정 로그인이 완료됐습니다. 사용 가능한 모델을 확인하고 있습니다.';
    try { await api(`/api/connections/${active.connectionId}/models`, {}); if (deviceLogin === active) $('#device-status').textContent = '로그인·모델 확인을 마쳤습니다. 대화 참여자를 등록할 수 있습니다.'; }
    catch (e) { if (deviceLogin === active) $('#device-status').textContent = '로그인은 완료됐지만 모델 목록을 확인하지 못했습니다. 계정 카드에서 모델 확인을 다시 눌러 주세요.'; report(e); }
  } else $('#device-status').textContent = result.status === 'cancelled' ? '로그인을 취소했습니다.' : errors[result.error ?? ''] ?? `로그인 상태: ${result.status}. 같은 계정 카드에서 다시 확인해 주세요.`;
  await refresh();
}
async function pollDevice(active: NonNullable<typeof deviceLogin>): Promise<void> {
  if (deviceLogin !== active) return;
  try { const result = await api<DeviceSignin>(`/api/connections/${active.connectionId}/device-signin?attemptId=${encodeURIComponent(active.attemptId)}`); if (deviceLogin === active) await showDevice(result); }
  catch (e) { if (deviceLogin === active) { $('#device-status').textContent = '연결 상태를 다시 확인하고 있습니다. 로그인 요청은 다시 보내지 않습니다.'; deviceTimer = window.setTimeout(() => { void pollDevice(active).catch(report); }, 5000); } throw e; }
}
async function showOAuth(result: { authorizationUrl: string; connectionId: string }): Promise<void> {
  const target = $('#oauth-result'); target.replaceChildren(node('p', '로그인을 시작하면 서버 Chrome 화면을 바로 표시합니다. 화면을 닫았으면 아래 버튼으로 다시 열 수 있습니다.', 'small'));
  target.append(button('별도 로그인 창 열기', () => openOAuthScreen(result)), details('서버에서 열 승인 주소', result.authorizationUrl), button('로그인 완료 · 모델 확인', async () => { await api(`/api/connections/${result.connectionId}/models`, {}); await refresh(); }));
  await openOAuthScreen(result);
}
async function openOAuthScreen(result: { authorizationUrl: string; connectionId: string }): Promise<void> {
  // The gateway requires the existing manual-control lease. It refuses takeover
  // while a browser participant is responding; opening OAuth never bypasses it.
  await api('/api/browser/control', { paused: true }); await refresh();
  const desktop = $('#oauth-desktop'); desktop.replaceChildren();
  if (state?.capabilities.noVncConfigured) {
    const frame = node('iframe'); frame.id = 'oauth-desktop-frame'; frame.title = 'GPT OAuth 서버 로그인 화면'; frame.src = $('#browser-link').getAttribute('href')!; desktop.append(frame);
  } else desktop.append(node('p', '원격 화면이 설정되지 않았습니다. 같은 Ubuntu 서버의 Chrome에서 로그인해 주세요.', 'small'));
  const status = $('#oauth-screen-status'); status.textContent = '분리된 GPT 로그인 창을 준비하고 있습니다. Chrome 자동 입력은 잠겨 있습니다.';
  $<HTMLDialogElement>('#oauth-login-dialog').showModal();
  try { await api('/api/browser/open-auth', { url: result.authorizationUrl, connectionId: result.connectionId });
    status.textContent = '아래 서버 Chrome에서 로그인·동의를 완료하세요. 기존 dot·Muse 대화와 로그인은 유지됩니다. 완료 후 화면을 닫고 모델을 확인하세요.';
  } catch (error) { status.textContent = '로그인 창을 열지 못했습니다. 서버 화면과 오류 알림을 확인하세요. 자동 입력은 잠긴 상태로 유지합니다.'; throw error; }
}
const executionReasons: Record<string, string> = {
  execution_authority_legacy: '이전 권한 · 만료 정보가 없어 재등록·재발급이 필요합니다.',
  execution_authority_invalid: '권한 정보를 확인할 수 없어 재등록·재발급이 필요합니다.',
  execution_authority_expired: '권한 만료 · 기간을 선택해 재등록·재발급하세요.',
  execution_authority_revoked: '권한 회수됨 · 새 실행에는 재등록·재발급이 필요합니다.',
  execution_authority_changed: '실행 당시 권한과 현재 권한이 다릅니다. 원래 실행 기록을 대조하세요.',
  execution_grant_revoked_or_changed: '이 실행의 참여자 권한이 만료·회수되었거나 변경되었습니다.',
  execution_binding_not_ready: '실행할 세션을 등록하고 연결 상태를 확인하세요.',
  managed_session_lost: '새 세션 연결이 끊겼습니다. 기존 권한을 회수하고 연결 방식을 직접 선택해 다시 등록하세요. 자동으로 새 세션을 만들지 않습니다.',
  protected_readonly_profile_required: '최소 읽기 범위를 확인해야 하는 등록입니다. 실행 권한을 회수하고 다시 등록하세요.',
  execution_evidence_changed: '원문 페이지의 실행·수집본·digest가 일치하지 않습니다. 최신 수집 기록을 확인하세요.',
  execution_draft_changed: '확인한 diff가 현재 기록과 다릅니다. 새 diff를 직접 열고 다시 확인하세요.',
  execution_draft_not_ready: '원격 실행 완료와 보호 사본의 반영 대기 상태를 먼저 확인하세요.',
  execution_draft_single_file_required: '기존 일반 텍스트 파일 1개의 내용 수정만 반영할 수 있습니다.',
  execution_capture_incomplete: '원문 수집이 불완전하거나 확인되지 않아 원본에 반영할 수 없습니다.',
  protected_draft_required: '보호 사본 기록이 없어 원본에 반영할 수 없습니다.',
  draft_not_applicable: '확인한 diff나 반영 조건이 달라졌습니다. 최신 상태와 새 diff를 확인하세요.',
  protected_approval_requires_scoped_support: '보호 사본의 경로·범위를 검증하는 실행 승인은 아직 지원하지 않습니다. 이 요청은 거절하거나 취소할 수 있습니다.',
  execution_approval_changed: '확인한 명령이나 승인 상태가 바뀌었습니다. 최신 요청을 열고 범위를 다시 확인하세요.',
  scoped_approval_scope_changed: '확인한 명령이나 승인 상태가 바뀌었습니다. 최신 요청을 열고 범위를 다시 확인하세요.',
  scoped_approval_runtime_changed: '실행 연결이나 보호 범위가 바뀌었습니다. 원래 실행 기록을 대조하세요.',
  protected_approval_confirmation_required: '명령·작업 경로·보호 프로필을 확인한 뒤 소유자 확인란을 체크하세요.',
  scoped_approval_reconciliation_required: '승인 전달 결과가 미확정입니다. 원래 실행과 전달 기록을 대조하세요.',
  approval_not_pending: '이 승인 요청은 더 이상 대기 상태가 아닙니다. 최신 실행 기록을 확인하세요.',
  protected_workspace_stale_diff: '보호 사본의 diff가 바뀌었습니다. 새 diff를 직접 확인하세요.',
  protected_workspace_source_changed: '원본 파일이 실행 기준 뒤에 변경되어 반영을 거절했습니다. 원본과 보호 사본을 대조하세요.',
  protected_workspace_source_repository_changed: '원본 저장소의 브랜치·기준이 바뀌어 반영을 거절했습니다. 실행 당시 기준과 대조하세요.',
  protected_workspace_exactly_one_file_required: '여러 파일이 변경되어 반영할 수 없습니다. 기존 텍스트 파일 1개의 내용 수정만 지원합니다.',
  protected_workspace_copy_structure_changed: '보호 사본에 파일 생성·삭제나 경로 변경이 있어 반영할 수 없습니다.',
  protected_workspace_copy_mode_changed: '보호 사본의 파일 권한이 바뀌어 반영할 수 없습니다.',
  protected_workspace_draft_not_ready: '보호 사본이 반영 가능한 상태가 아닙니다. 새 diff와 차단 사유를 확인하세요.',
  protected_workspace_apply_already_attempted: '이미 원본 반영을 시도한 기록이 있습니다. 원래 반영 결과와 영수증을 대조하세요.',
  protected_workspace_source_apply_lease_exists: '이 원본의 다른 반영 시도가 남아 있습니다. 원래 반영 결과를 대조하세요.',
  execution_original_unavailable: '이 실행의 보존된 수집 원문을 확인할 수 없습니다.',
  workspace_busy: '같은 작업 공간에 진행 중인 실행·반영이 있습니다. 원래 실행 상태를 먼저 확인하세요.',
};
Object.assign(errors, executionReasons, { invalid_execution_expiry: '권한 기간은 1~168시간의 정수로 선택하세요.' });
function executionReason(reason: string): string { return executionReasons[reason] ?? errors[reason] ?? reason; }
function authorityReason(a: Authority | undefined): string | null {
  if (!a) return 'execution_authority_legacy';
  const issued = Date.parse(a.issuedAt), expires = Date.parse(a.expiresAt);
  if (a.version !== 1 || !Number.isSafeInteger(a.epoch) || a.epoch < 1 || !Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued || expires - issued > 168 * 3_600_000 || a.revokedAt !== null && !Number.isFinite(Date.parse(a.revokedAt))) return 'execution_authority_invalid';
  if (a.revokedAt) return 'execution_authority_revoked';
  return expires <= Date.now() || issued > Date.now() ? 'execution_authority_expired' : null;
}
function authorityExpiry(a: Authority | undefined): string {
  return a && Number.isFinite(Date.parse(a.expiresAt)) ? `만료 · ${new Date(a.expiresAt).toLocaleString('ko-KR')} (이 기기 시각)` : '만료 정보 없음 · 이전 권한';
}
function bindingReason(b: ExecutionBinding | undefined): string | null {
  return b ? authorityReason(b.authority) ?? (b.managedSession?.state === 'lost' ? 'managed_session_lost' : b.status === 'ready' ? null : 'execution_binding_not_ready') : 'execution_binding_not_ready';
}
function bindingSessionNote(b: ExecutionBinding): string {
  if (b.managedSession?.state === 'lost') return executionReason('managed_session_lost');
  return b.managedSession?.state === 'initial' ? '새 세션 준비됨 · 아직 첫 요청을 보내지 않았습니다. 등록만으로 자동 실행하지 않으며, 첫 요청 전에 연결이 끊기면 재등록이 필요합니다.' : '';
}
function jobAuthorityReason(job: CodexJob): string | null {
  const binding = state?.bindings.find(b => b.id === job.bindingId), reason = bindingReason(binding);
  if (reason) return reason;
  const a = job.authority;
  if (!a || a.version !== 1 || a.binding.id !== binding!.id || a.binding.epoch !== binding!.authority!.epoch || a.binding.expiresAt !== binding!.authority!.expiresAt) return 'execution_authority_changed';
  if (a.grant) {
    const grant = state?.grants.find(g => g.id === a.grant!.id);
    if (!grant || grant.revoked || authorityReason(grant.authority) || a.grant.epoch !== grant.authority!.epoch || a.grant.expiresAt !== grant.authority!.expiresAt) return 'execution_grant_revoked_or_changed';
  }
  return null;
}
function scopedApprovalReason(job: CodexJob | undefined, approvalId: string, shown: ScopedCommandApproval): string | null {
  const approval = job?.approvals.find(a => a.id === approvalId), scope = approval?.scope;
  if (!job || !(job.draft || job.readCopy) || job.status !== 'blocked_approval' || approval?.status !== 'pending' || !scopedCommandReady(scope) || scope.digest !== shown.digest || scope.command !== shown.command || scope.cwd !== shown.cwd || scope.profileId !== shown.profileId) return 'execution_approval_changed';
  return jobAuthorityReason(job) ?? job.resultScopeReason ?? null;
}
function scheduleAuthorityExpiry(): void {
  clearTimeout(authorityTimer); if (!state) return;
  const next = [...state.bindings, ...state.grants].map(b => Date.parse(b.authority?.expiresAt ?? '')).filter(t => t > Date.now());
  if (next.length) authorityTimer = window.setTimeout(() => { if (!$('#workspace').hidden) render(); }, Math.min(2_147_483_647, Math.max(1, Math.min(...next) - Date.now() + 1)));
}
function renderRunAccess(): void {
  const select = $<HTMLSelectElement>('#job-binding'), binding = state?.bindings.find(b => b.id === select.value), reason = bindingReason(binding);
  $('#job-access-note').textContent = reason ? executionReason(reason) : [authorityExpiry(binding?.authority), binding && bindingSessionNote(binding), binding?.readProtection === 1 && !binding.allowWrite ? '최소 읽기 범위 확인 · 읽기 전용' : '쓰기 작업은 보호 사본에서 실행하고 원본 반영은 별도로 확인합니다.'].filter(Boolean).join(' · ');
  $<HTMLButtonElement>('#job-form button[type=submit]').disabled = !!reason;
  for (const id of ['#job-binding', '#discussion-binding']) {
    for (const option of $<HTMLSelectElement>(id).options) {
      const b = state?.bindings.find(b => b.id === option.value); if (!b) continue;
      const unavailable = bindingReason(b); option.textContent = b.label + (unavailable ? ` · ${executionReason(unavailable)}` : '');
      if (id === '#discussion-binding') option.disabled = !!unavailable;
    }
  }
}
function renderBindingSessionMode(): void {
  const existing = $<HTMLSelectElement>('#binding-session-mode').value !== 'new';
  const thread = $<HTMLInputElement>('#binding-form [name=threadId]'); thread.required = existing; thread.disabled = !existing;
  $('#binding-thread-field').hidden = !existing; $('#binding-new-session-note').hidden = existing;
  $('#binding-form button[type=submit]').textContent = existing ? '세션 대조 후 등록' : '새 세션 준비 후 등록';
}
function prefillBinding(b: ExecutionBinding): void {
  const form = $<HTMLFormElement>('#binding-form');
  $<HTMLSelectElement>('#binding-session-mode').value = 'existing'; renderBindingSessionMode();
  for (const name of ['label', 'cwd', 'threadId'] as const) (form.elements.namedItem(name) as HTMLInputElement).value = b[name];
  (form.elements.namedItem('allowWrite') as HTMLInputElement).checked = b.allowWrite;
  (form.elements.namedItem('expiresInHours') as HTMLInputElement).value = '24';
  form.scrollIntoView({ block: 'center' }); (form.elements.namedItem('expiresInHours') as HTMLInputElement).focus();
  announce('기존 등록 내용을 채웠습니다. 권한 기간과 수정 범위를 확인한 뒤 등록하세요.');
}
function clearExecutionPrivate(): void {
  resetScopedCommandConfirmations($('#jobs-list'));
  clearTimeout(authorityTimer); evidenceViews.clear(); draftViews.clear(); applyConfirmation = null;
  $<HTMLDialogElement>('#draft-apply-dialog').close(); $('#draft-apply-summary').replaceChildren(); $('#draft-apply-state').textContent = '';
  $<HTMLFormElement>('#draft-apply-form').reset(); $('#jobs-list').replaceChildren(); $('#grant-result').textContent = '';
}
function sameCapture(a: Capture, b: Capture | undefined): boolean {
  return !!b && a.version === b.version && a.jobId === b.jobId && a.artifactId === b.artifactId && a.digest === b.digest && a.byteLength === b.byteLength && a.pageCount === b.pageCount && a.complete === b.complete && a.reason === b.reason;
}
async function loadEvidence(jobId: string, pageIndex: number): Promise<void> {
  const job = state?.jobs.find(j => j.id === jobId); if (!job?.capture || job.capture.jobId !== jobId) throw new Error('execution_evidence_changed');
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= job.capture.pageCount || evidenceViews.get(jobId)?.loading) return;
  const entry: EvidenceView = { capture: { ...job.capture }, page: null, loading: true, error: null }; evidenceViews.set(jobId, entry); renderJobs();
  try {
    const page = await api<EvidencePage>(`/api/jobs/${encodeURIComponent(jobId)}/evidence?page=${pageIndex}`);
    if (evidenceViews.get(jobId) !== entry) return;
    if (!sameCapture(entry.capture, state?.jobs.find(j => j.id === jobId)?.capture) || page.jobId !== jobId || page.artifactId !== entry.capture.artifactId || page.digest !== entry.capture.digest || page.byteLength !== entry.capture.byteLength || page.pageCount !== entry.capture.pageCount || page.complete !== entry.capture.complete || page.reason !== entry.capture.reason || page.pageIndex !== pageIndex || page.nextPage !== (pageIndex + 1 < page.pageCount ? pageIndex + 1 : null) || typeof page.text !== 'string') throw new Error('execution_evidence_changed');
    entry.page = page;
  } catch (error) { if (evidenceViews.get(jobId) === entry) entry.error = error instanceof Error ? error.message : 'request_failed'; }
  finally { if (evidenceViews.get(jobId) === entry) { entry.loading = false; renderJobs(); } }
}
function renderExecutionEvidence(job: CodexJob, card: HTMLElement): void {
  const capture = job.capture, section = node('section', '', 'execution-private');
  section.append(node('h3', '소유자 전용 비공개 원문'), node('p', '직접 요청한 페이지 하나만 표시합니다. 공유 채팅·참여자·Wiki로 옮기지 않습니다.', 'small muted'));
  if (!capture) { section.append(node('p', '보존된 원문 수집 기록이 없습니다.', 'small muted')); card.append(section); return; }
  section.append(node('p', `수집 ${capture.complete ? '완료' : '불완전'} · ${capture.byteLength.toLocaleString('ko-KR')} bytes · ${capture.pageCount}페이지`, 'small'), node('p', `전체 수집본 digest · ${capture.digest}`, 'small execution-digest'));
  if (capture.reason) section.append(node('p', executionReason(capture.reason), 'small muted'));
  let entry = evidenceViews.get(job.id);
  if (entry && !sameCapture(entry.capture, capture)) { evidenceViews.delete(job.id); entry = undefined; }
  const row = node('div', '', 'toolbar');
  if (entry?.loading) row.append(node('p', '원문 한 페이지를 불러오는 중…', 'small'));
  else if (entry?.page) {
    const page = entry.page;
    section.append(node('p', `원문 ${page.pageIndex + 1} / ${page.pageCount}페이지 · 현재 페이지만 표시`, 'small'), node('pre', page.text, 'execution-raw'));
    if (page.pageIndex > 0) row.append(button('이전 원문 페이지', () => loadEvidence(job.id, page.pageIndex - 1)));
    if (page.nextPage !== null) row.append(button('다음 원문 페이지', () => loadEvidence(job.id, page.nextPage!)));
  } else if (capture.pageCount > 0 && capture.jobId === job.id) row.append(button('원문 첫 페이지 보기', () => loadEvidence(job.id, 0)));
  if (entry) row.append(button('원문 닫기', () => { evidenceViews.delete(job.id); renderJobs(); }));
  if (entry?.error) section.append(node('p', executionReason(entry.error), 'small execution-warning'));
  section.append(row); card.append(section);
}
function reviewChanged(job: CodexJob, review: DraftReview): boolean {
  return !!(job.draft?.diffDigest && job.draft.diffDigest !== review.diffDigest || job.draft?.manifestDigest && job.draft.manifestDigest !== review.manifestDigest);
}
function applyReason(job: CodexJob | undefined, review: DraftReview): string | null {
  if (!job || reviewChanged(job, review)) return 'execution_draft_changed';
  const reason = jobAuthorityReason(job); if (reason) return reason;
  if (job.resultScopeReason) return job.resultScopeReason;
  if (job.status !== 'completed' || job.draft?.status !== 'pending') return 'execution_draft_not_ready';
  if (!job.capture?.complete || job.capture.jobId !== job.id) return 'execution_capture_incomplete';
  if (review.status !== 'ready' || !review.manifestDigest || !review.diffDigest || review.files.length !== 1 || !review.files[0]?.path || !review.files[0].beforeDigest || !review.files[0].afterDigest || review.files[0].beforeDigest === review.files[0].afterDigest || !review.files[0].diff) return 'execution_draft_single_file_required';
  return null;
}
async function loadDraft(jobId: string): Promise<void> {
  if (draftViews.get(jobId)?.loading) return;
  const entry: DraftView = { review: null, loading: true, error: null }; draftViews.set(jobId, entry); renderJobs();
  try {
    const review = await api<DraftReview>(`/api/jobs/${encodeURIComponent(jobId)}/draft`);
    if (draftViews.get(jobId) !== entry) return;
    if (!['ready', 'blocked', 'unchanged'].includes(review.status) || !Array.isArray(review.files)) throw new Error('execution_draft_not_ready');
    entry.review = review;
  } catch (error) { if (draftViews.get(jobId) === entry) entry.error = error instanceof Error ? error.message : 'request_failed'; }
  finally { if (draftViews.get(jobId) === entry) { entry.loading = false; renderJobs(); } }
}
function openApplyConfirmation(job: CodexJob, review: DraftReview): void {
  const reason = applyReason(state?.jobs.find(j => j.id === job.id), review); if (reason) throw new Error(reason);
  applyConfirmation = { jobId: job.id, review, commandId: crypto.randomUUID(), submitting: false, error: null };
  $<HTMLFormElement>('#draft-apply-form').reset();
  const file = review.files[0]!; $('#draft-apply-summary').replaceChildren(node('p', `실행 · ${job.id}`, 'small'), node('p', `파일 · ${file.path}`), node('p', `확인한 diff digest · ${review.diffDigest}`, 'small execution-digest'), node('p', `수정 전 · ${file.beforeDigest}\n수정 후 · ${file.afterDigest}`, 'small execution-digest'));
  renderApplyConfirmation(); $<HTMLDialogElement>('#draft-apply-dialog').showModal();
}
function renderApplyConfirmation(): void {
  const c = applyConfirmation, reason = c ? c.error ?? applyReason(state?.jobs.find(j => j.id === c.jobId), c.review) : 'execution_draft_not_ready';
  $('#draft-apply-state').textContent = c?.submitting ? '원본 반영 결과를 확인하는 중…' : reason ? executionReason(reason) : '위에서 확인한 diff만 반영합니다. 파일이 변경됐다면 서버가 거절합니다.';
  $<HTMLButtonElement>('#draft-apply-form button[type=submit]').disabled = !c || c.submitting || !!reason;
}
function renderDraft(job: CodexJob, card: HTMLElement): void {
  if (!job.draft) return;
  const section = node('section', '', 'execution-draft'); section.append(node('h3', '보호 사본의 변경 확인'), node('p', '기존 일반 텍스트 파일 1개의 내용 수정만 지원합니다. 생성·삭제·다중 파일·바이너리는 반영할 수 없습니다. 모델은 원본을 자동 반영하지 않습니다.', 'small muted'));
  const entry = draftViews.get(job.id);
  if (!['preparing', 'running', 'applying', 'applied'].includes(job.draft.status)) section.append(button(entry?.loading ? 'diff 확인 중…' : entry?.review ? 'diff 다시 확인' : '보호 사본 diff 확인', () => loadDraft(job.id)));
  if (entry?.review) {
    const review = entry.review;
    if (review.reason) section.append(node('p', executionReason(review.reason), 'small execution-warning'));
    if (review.status === 'unchanged') section.append(node('p', '보호 사본의 내용 변경이 없습니다.', 'small'));
    if (review.status === 'blocked') section.append(node('p', '원본 반영이 차단되었습니다.', 'small'));
    if (review.status === 'ready') {
      section.append(node('p', `확인한 diff digest · ${review.diffDigest ?? '확인 불가'}`, 'small execution-digest'));
      for (const file of review.files) section.append(node('h4', file.path), node('p', `수정 전 · ${file.beforeDigest ?? '기존 파일 없음'}\n수정 후 · ${file.afterDigest ?? '파일 없음'}`, 'small execution-digest'), node('pre', file.diff, 'execution-diff'));
      const reason = applyReason(job, review);
      if (reason) section.append(node('p', executionReason(reason), 'small execution-warning'));
      else section.append(button('원본 반영 확인…', () => openApplyConfirmation(job, review)));
    }
  }
  if (entry?.error) section.append(node('p', executionReason(entry.error), 'small execution-warning'));
  card.append(section);
}
function renderJobs(): void {
  if (!state || $('#workspace').hidden) return; const bindings = $('#bindings-list');
  preserve(bindings, () => {
    bindings.replaceChildren();
    for (const b of state!.bindings) {
      const section = node('section', '', 'panel authority-card'), reason = bindingReason(b); section.dataset.bindingId = b.id;
      section.append(node('h3', b.label), node('p', `${b.allowWrite ? '보호 사본 수정 · 원본은 별도 확인' : '읽기 전용'} · ${b.branch}`, 'small'), node('p', reason ? executionReason(reason) : '권한 유효', 'small'), node('p', authorityExpiry(b.authority), 'small muted'), details('등록한 세션·작업 경로', JSON.stringify(b, null, 2), b.id));
      const sessionNote = bindingSessionNote(b); if (sessionNote && sessionNote !== (reason && executionReason(reason))) section.append(node('p', sessionNote, 'small muted'));
      if (b.readProtection === 1 && !b.allowWrite) section.append(node('p', '최소 읽기 범위 확인 · 읽기 전용', 'small muted'));
      const row = node('div', '', 'toolbar');
      if (reason) row.append(button('이 설정으로 재등록', () => prefillBinding(b)));
      if (!b.authority?.revokedAt) row.append(button('실행 권한 회수', async () => { await api(`/api/bindings/${encodeURIComponent(b.id)}/revoke`, {}); await refresh(); }));
      section.append(row); bindings.append(section);
    }
  });
  for (const id of evidenceViews.keys()) if (!state.jobs.some(j => j.id === id)) evidenceViews.delete(id);
  for (const id of draftViews.keys()) if (!state.jobs.some(j => j.id === id)) draftViews.delete(id);
  renderRunAccess(); renderApplyConfirmation();
  preserve($('#jobs-list'), () => { const target = $('#jobs-list'); resetScopedCommandConfirmations(target); target.replaceChildren();
    for (const job of state!.jobs.toReversed()) { const card = node('section', '', 'panel execution-job'); card.dataset.jobId = job.id;
      const head = node('div', '', 'inline'); head.append(node('h2', state!.bindings.find(b => b.id === job.bindingId)?.label ?? 'Codex 작업')); card.append(head, node('p', `${job.id} · ${job.turnId ?? 'turn 수신 전'}`, 'small muted'));
      const statuses = node('dl', '', 'execution-status'); statuses.append(node('dt', '원격 실행'), node('dd', states[job.status] ?? job.status));
      const draftLabels: Record<string, string> = { preparing: '보호 사본 준비 중', running: '보호 사본에서 실행 중', pending: '소유자 확인·반영 대기', unchanged: '내용 변경 없음', blocked: '반영 차단', applying: '반영 중 · 결과 확인 필요', applied: '원본 반영 완료', conflict: '충돌 · 원본 반영 안 됨', unconfirmed: '반영 결과 미확정 · 대조 필요' };
      statuses.append(node('dt', '원본 반영'), node('dd', job.draft ? draftLabels[job.draft.status] ?? job.draft.status : state!.bindings.find(b => b.id === job.bindingId)?.allowWrite ? '보호 사본 기록 없음 · 반영 불가' : '반영 대상 없음'));
      card.append(statuses);
      for (const reason of [job.resultScopeReason, job.draft?.reason, jobAuthorityReason(job)]) if (reason) card.append(node('p', executionReason(reason), 'small execution-warning'));
      if (job.draft?.receipt) { const r = job.draft.receipt; card.append(details('원본 반영 영수증', `${r.path}\n수정 전 · ${r.beforeDigest}\n수정 후 · ${r.afterDigest}\n반영 시각 · ${r.appliedAt}`, `${job.id}:receipt`)); }
      card.append(details('보낸 명령', job.prompt, `${job.id}:prompt`), node('h3', '가려진 결과 미리보기'), node('p', '민감한 값을 가리고 길이를 제한한 표시용 결과입니다. 원문 수집 완료 여부와 별개입니다.', 'small muted'));
      if (job.previewTruncated) card.append(node('p', '미리보기 일부 생략 · 수집 원문은 별도로 확인하세요.', 'small execution-warning'));
      card.append(node('div', job.text || '실행 결과를 기다리고 있습니다.', 'reply job-output'));
      renderExecutionEvidence(job, card); renderDraft(job, card);
      const controls = node('div', '', 'toolbar');
      if (['queued', 'running', 'blocked_approval'].includes(job.status)) controls.append(button('중단 요청', async () => { await api(`/api/jobs/${job.id}/cancel`, {}); await refresh(); }));
      if (job.status === 'running' && !job.draft && !job.readCopy && !jobAuthorityReason(job)) controls.append(button('진행 중 지시 보완', () => modal('현재 실행에 지시 추가', [{ name: 'text', label: '추가 지시', multiline: true }], async values => { const reason = jobAuthorityReason(state?.jobs.find(j => j.id === job.id) ?? job); if (reason) throw new Error(reason); await api(`/api/jobs/${job.id}/steer`, { expectedTurnId: job.turnId, ...values }); await refresh(); })));
      if (job.status === 'reconciling') controls.append(button('실제 turn 결과 대조', async () => { if (!job.turnId) modal('수신되지 않은 Codex turn 대조', [{ name: 'turnId', label: '실제 세션에서 확인한 turn ID' }], async data => { await api(`/api/jobs/${job.id}/reconcile`, data); await refresh(); }, '원격 기록의 입력·시각·세션·완료 상태를 함께 검사합니다. 새 실행을 시작하지 않습니다.'); else { await api(`/api/jobs/${job.id}/reconcile`, {}); await refresh(); } })); card.append(controls);
      for (const approval of job.approvals.filter(a => a.status === 'pending')) {
        const section = node('section', '', 'panel'); section.append(node('h3', '실행 승인 요청'), node('pre', JSON.stringify(approval.params, null, 2)));
        if (job.draft || job.readCopy) {
          const scope = approval.scope;
          if (scope) section.append(node('p', scopedCommandStatus(scope), 'small scoped-command-status'));
          if (scopedCommandReady(scope)) section.append(scopedCommandConfirmation(scope, async digest => {
            const reason = scopedApprovalReason(state?.jobs.find(j => j.id === job.id), approval.id, scope); if (reason) throw new Error(reason);
            await api(`/api/jobs/${job.id}/approve`, { approvalId: approval.id, decision: 'accept', expectedScopeDigest: digest, ownerConfirmed: true }); await refresh();
          }, report, !!scopedApprovalReason(job, approval.id, scope)));
          else if (!scope) section.append(node('p', executionReason('protected_approval_requires_scoped_support'), 'small execution-warning'));
        }
        const row = node('div', '', 'toolbar'), decisions = [...(job.draft || job.readCopy ? [] : [['accept', '이번 요청 승인']]), ['decline', '거절'], ['cancel', '취소']];
        for (const [decision, label] of decisions) {
          const action = button(label!, async () => {
            if (decision === 'accept') { const latest = state?.jobs.find(j => j.id === job.id) ?? job; if (latest.draft || latest.readCopy) throw new Error('protected_approval_requires_scoped_support'); const reason = jobAuthorityReason(latest); if (reason) throw new Error(reason); }
            await api(`/api/jobs/${job.id}/approve`, { approvalId: approval.id, decision }); await refresh();
          }); action.disabled = decision === 'accept' && !!jobAuthorityReason(job); row.append(action);
        }
        section.append(row); card.append(section);
      }
      for (const activity of job.activities) {
        const item = details(`${activity.type} · ${activity.status}${activity.truncated ? ' · 표시 일부 생략' : ''}`, activity.text, `${job.id}:${activity.id}`);
        item.append(node('p', activity.truncated ? '이 활동의 표시용 본문·출력 일부가 생략되었습니다. 원문 수집 완료 여부와 별개입니다.' : '민감한 값을 가리고 길이를 제한한 활동 미리보기입니다.', 'small muted'));
        if (activity.command) {
          item.append(node('h4', '관측된 명령·종료 상태'), node('pre', activity.command.command ?? '명령 미관측'), node('p', `종료 코드 · ${activity.command.exitCode ?? '미관측'}`, 'small'));
          if (activity.command.output !== null) item.append(node('pre', activity.command.output));
        }
        card.append(item);
      }
      if (job.error) card.append(node('p', executionReason(job.error), 'small muted')); target.append(card); }
  });
}
type Field = { name: string; label: string; multiline?: boolean; required?: boolean; secret?: boolean; email?: boolean; checkbox?: boolean; maxLength?: number; number?: { min: number; max: number }; options?: { value: string; label: string }[]; value?: string };
let modalAction: ((values: Record<string, string>) => Promise<unknown>) | null = null;
function modal(title: string, fields: Field[], action: (values: Record<string, string>) => Promise<unknown>, note?: string, submitLabel = '적용'): void {
  $<HTMLButtonElement>('#action-form button[type=submit]').textContent = submitLabel;
  $('#action-title').textContent = title; const target = $('#action-fields'); target.replaceChildren(); if (note) target.append(node('p', note, 'small muted'));
  for (const field of fields) { const label = node('label', field.label); const input = field.options ? node('select') : field.multiline ? node('textarea') : node('input'); input.name = field.name; input.required = field.required !== false; if (input instanceof HTMLTextAreaElement) input.rows = 6; else if (input instanceof HTMLInputElement && field.secret) { input.type = 'password'; input.autocomplete = 'off'; }
    if (input instanceof HTMLInputElement && field.checkbox) input.type = 'checkbox';
    if (field.maxLength !== undefined && (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) input.maxLength = field.maxLength;
    if (input instanceof HTMLInputElement && field.number) { input.type = 'number'; input.min = String(field.number.min); input.max = String(field.number.max); input.step = '1'; }
    if (input instanceof HTMLSelectElement && field.options) selectOptions(input, field.options.map(o => ({ id: o.value, label: o.label }))); if (field.value !== undefined) input.value = field.value; label.append(input); target.append(label); }
  for (const field of fields.filter(f => f.email)) (target.querySelector(`[name="${field.name}"]`) as HTMLInputElement).type = 'email';
  modalAction = action; $<HTMLDialogElement>('#action-dialog').showModal();
}
form('#action-form', async values => { await modalAction?.(values); $<HTMLDialogElement>('#action-dialog').close(); $('#action-fields').replaceChildren(); });
$('#action-cancel').addEventListener('click', () => $<HTMLDialogElement>('#action-dialog').close());
form('#login-form', async (values, el) => {
  const setup = !authStatus?.passwordConfigured || !!setupToken;
  if (setup) checkPasswords(values.password!, values.confirmPassword!);
  try { await api(setup ? '/api/password/setup' : '/api/login', { password: values.password, ...(setup ? { confirmPassword: values.confirmPassword, ...(setupToken ? { setupToken } : {}) } : {}) }); }
  catch (error) { if (setup) { await loadLogin(); if (authStatus?.passwordConfigured) { setupToken = ''; el.reset(); renderLogin(); } } throw error; }
  setupToken = ''; authSequence++; authStatus = { passwordConfigured: true, canSetup: true }; el.reset(); await refresh(); announce(setup ? '비밀번호를 저장했습니다.' : '로그인했습니다.');
});
form('#password-change-form', async (values, el) => {
  checkPasswords(values.password!, values.confirmPassword!); await api('/api/password/change', values); el.reset(); $<HTMLDialogElement>('#password-dialog').close(); stream?.close(); stream = null; await refresh(); announce('비밀번호를 변경했습니다. 다른 기기는 다시 로그인해 주세요.');
});
form('#discussion-form', async values => { const participantIds = [...document.querySelectorAll<HTMLInputElement>('#participant-picker input:checked')].map(i => i.value);
  if (values.executionBindingId) { const reason = bindingReason(state?.bindings.find(b => b.id === values.executionBindingId)); if (reason) throw new Error(reason); }
  const materialPackageIds = [...document.querySelectorAll<HTMLInputElement>('#material-picker input:checked')].map(i => i.value);
  const targetRoom = focusRoomId;
  const result = await api<{ id?: string; discussionId?: string }>(targetRoom ? `/api/rooms/${targetRoom}/focus` : '/api/discussions', { topic: values.topic, criteria: values.criteria, materials: values.materials, materialPackageIds, participantIds, executionBindingId: values.executionBindingId || null,
    limits: { maxRounds: Number(values.maxRounds), ...(dailyFocus() ? {} : { maxRequests: Number(values.maxRequests), maxActiveMs: Number(values.maxMinutes) * 60_000 }) } }); selected = (result.id ?? result.discussionId)!; current = null; focusRoomId = null; composingTopic = false; $<HTMLDialogElement>('#topic-details-dialog').close(); $('#discussion-mode').hidden = true; localStorage.setItem('wj.discussion', selected); localStorage.setItem('wj.chat.selection', selected); sessionStorage.setItem('wj.chat.selection', selected); showView('room'); await refresh(); });
form('#oauth-form', async values => { await showOAuth(await api('/api/connections/oauth', values)); await refresh(); });
form('#codex-oauth-form', startDevice);
form('#deepseek-form', async (values, el) => { try { await api('/api/connections/deepseek', values); await refresh(); } finally { (el.elements.namedItem('key') as HTMLInputElement).value = ''; } });
form('#anthropic-form', async (values, el) => { try { await api('/api/connections/anthropic', values); await refresh(); } finally { (el.elements.namedItem('key') as HTMLInputElement).value = ''; } });
function clearParticipantEdit(): void { $('#participant-form').querySelector('[name=participantId]')?.remove(); $<HTMLFormElement>('#participant-form').reset(); delete $<HTMLSelectElement>('#participant-model').dataset.explicitConnection; $('#participant-save').textContent = '참여자 등록'; $('#participant-edit-cancel').hidden = true; updateConnections(); }
form('#participant-form', async values => { const { participantId, ...settings } = values; await api(participantId ? '/api/participants/' + participantId : '/api/participants', { ...settings, ...(settings.maxOutputTokens !== undefined ? { maxOutputTokens: outputValue(settings.maxOutputTokens) } : {}) }); clearParticipantEdit(); announce(participantId ? '설정을 저장했습니다. 새 토의와 이후 상주 발언부터 적용합니다.' : '참여자를 등록했습니다.'); await refresh(); });
$('#participant-edit-cancel').addEventListener('click', clearParticipantEdit);
form('#browser-form', async (values, form) => {
  const { label, connectionId, threadSelector, threadAttribute, threadValue, threadJsonKey, sendAppearsAfterInput, ...binding } = values;
  const hasThread = [threadSelector, threadAttribute, threadValue, threadJsonKey].some(Boolean);
  if (hasThread && (!threadSelector || !threadAttribute || !threadValue)) throw new Error('대화 ID·확인 선택자·속성을 모두 입력하세요.');
  await api('/api/connections/browser', { label, connectionId, binding: { ...binding, pageId: Number(binding.pageId), sendAppearsAfterInput: sendAppearsAfterInput === 'on',
    ...(hasThread ? { thread: { selector: threadSelector, attribute: threadAttribute, value: threadValue, ...(threadJsonKey ? { jsonKey: threadJsonKey } : {}) } } : {}) } });
  form.querySelector('[name=connectionId]')?.remove(); await refresh();
});
function invalidateDiscovery(): void { browserDiscoveryRevision++; browserCandidate = null; browserDiscoveryConnection = ''; $('#browser-discovery-result').hidden = true; $<HTMLFormElement>('#browser-discovery-confirm-form').reset(); }
async function loadBrowserPages(): Promise<void> {
  invalidateDiscovery();
  const data = await api<{ pages: DiscoveryPage[] }>('/api/browser/discovery/pages'); browserPages = data.pages;
  selectOptions($('#browser-discovery-page'), data.pages.map(p => ({ id: String(p.pageId), label: `페이지 ${p.pageId} · ${p.profile === 'default' ? '서버 기본 프로필' : p.profile} · ${p.title || p.url}` })), '연결할 기존 대화를 선택하세요');
  $('#browser-discovery-state').textContent = data.pages.length ? `허용된 페이지 ${data.pages.length}개 · 페이지와 프로필을 직접 선택하세요.` : '허용된 기존 대화 페이지가 없습니다. 서버 Chrome에서 기존 대화를 열어 주세요.';
}
for (const id of ['#browser-discovery-page', '#browser-discovery-preset', '#browser-discovery-connection']) $(id).addEventListener('change', invalidateDiscovery);
form('#browser-discovery-form', async values => {
  invalidateDiscovery(); const revision = browserDiscoveryRevision;
  const page = browserPages.find(p => String(p.pageId) === values.pageId); if (!page) throw new Error('browser_discovery_page_missing');
  const candidate = await api<DiscoveryResult>('/api/browser/discovery', { pageId: page.pageId, profile: page.profile, presetId: values.presetId, ...(values.connectionId ? { connectionId: values.connectionId } : {}) });
  if (revision !== browserDiscoveryRevision) return;
  $('#browser-discovery-state').textContent = candidate.status === 'ready' ? '기존 대화를 확인했습니다.' : errors[candidate.reason ?? ''] ?? '이 화면을 자동으로 확인할 수 없습니다. 고급 연결을 사용하세요.';
  const evidence = $('#browser-discovery-evidence'); evidence.replaceChildren();
  for (const text of [`프로필 · ${candidate.page.profile === 'default' ? '서버 기본 프로필' : candidate.page.profile}`, `주소 · ${candidate.page.url}`, `계정 식별 문구 · ${candidate.identityText ?? '확인 불가'}`, `에이전트 표시 · ${candidate.agentLabel ?? '확인 불가'}`, `대화 ID · ${candidate.threadValue ?? '확인 불가'}`, `관측 · ${time(candidate.observedAt)}`]) evidence.append(node('p', text));
  $('#browser-discovery-result').hidden = false; $('#browser-discovery-confirm-form').hidden = candidate.status !== 'ready';
  if (candidate.status === 'ready') {
    browserCandidate = candidate; browserDiscoveryConnection = values.connectionId ?? '';
    const existing = state?.connections.find(c => c.id === values.connectionId); ($<HTMLFormElement>('#browser-discovery-confirm-form').elements.namedItem('label') as HTMLInputElement).value = existing?.label ?? candidate.agentLabel ?? '';
  }
});
form('#browser-discovery-confirm-form', async values => {
  if (!browserCandidate?.id) throw new Error('browser_discovery_expired');
  await api('/api/browser/discovery/confirm', { discoveryId: browserCandidate.id, label: values.label, confirmed: values.confirmed === 'on', ...(browserDiscoveryConnection ? { connectionId: browserDiscoveryConnection } : {}) });
  invalidateDiscovery(); announce('기존 대화를 연결했습니다. 참여자를 등록해 방에 초대할 수 있습니다.'); await refresh();
});
$('#binding-session-mode').addEventListener('change', renderBindingSessionMode); renderBindingSessionMode();
form('#binding-form', async values => {
  const { threadId, sessionMode = 'existing', ...settings } = values;
  await api('/api/bindings', { ...settings, sessionMode, ...(sessionMode === 'existing' ? { threadId } : {}), allowWrite: values.allowWrite === 'on', expiresInHours: expiryHours(values.expiresInHours) }); await refresh();
});
form('#job-form', async values => { const reason = bindingReason(state?.bindings.find(b => b.id === values.bindingId)); if (reason) throw new Error(reason); await api('/api/jobs', values); await refresh(); });
$('#job-binding').addEventListener('change', renderRunAccess);
function expiryHours(value: string | undefined): number { const hours = Number(value); if (!Number.isSafeInteger(hours) || hours < 1 || hours > 168) throw new Error('invalid_execution_expiry'); return hours; }
form('#grant-form', async values => { const tools = ['task_get', 'context_get', 'result_submit', 'capabilities_get', ...(values.codex === 'on' ? ['codex_send', 'codex_status', 'codex_result', 'codex_cancel'] : [])];
  const result = await api<{ id: string; token: string }>('/api/grants', { ...values, tools, expiresInHours: expiryHours(values.expiresInHours) }); $('#grant-result').textContent = `한 번만 표시되는 접근 키입니다. 대화 본문에 붙여 넣지 마세요.\nMCP URL: ${location.origin}/mcp\nAuthorization: Bearer ${result.token}\nGrant: ${result.id}`; await refresh(); });
form('#draft-apply-form', async () => {
  const c = applyConfirmation; if (!c || c.submitting || c.error) return;
  const reason = applyReason(state?.jobs.find(j => j.id === c.jobId), c.review); if (reason) { renderApplyConfirmation(); throw new Error(reason); }
  if (!$<HTMLInputElement>('#draft-owner-confirmed').checked) return;
  c.submitting = true; renderApplyConfirmation();
  try {
    await api(`/api/jobs/${encodeURIComponent(c.jobId)}/apply`, { expectedDiffDigest: c.review.diffDigest }, c.commandId);
    if (applyConfirmation !== c) return;
    draftViews.delete(c.jobId); await refresh();
    if (applyConfirmation === c) { $<HTMLDialogElement>('#draft-apply-dialog').close(); announce('원본 반영 요청을 처리했습니다. 반영 상태와 영수증을 확인하세요.'); }
  } catch (error) {
    if (applyConfirmation === c) { c.error = error instanceof Error ? error.message : 'request_unconfirmed'; draftViews.delete(c.jobId); renderJobs(); }
    throw error;
  } finally { c.submitting = false; renderApplyConfirmation(); }
});
$('#draft-apply-close').addEventListener('click', () => $<HTMLDialogElement>('#draft-apply-dialog').close());
$('#draft-apply-dialog').addEventListener('close', () => { applyConfirmation = null; $('#draft-apply-summary').replaceChildren(); $('#draft-apply-state').textContent = ''; $<HTMLFormElement>('#draft-apply-form').reset(); });
$('#participant-connection').addEventListener('change', updateModels);
$('#participant-mode').addEventListener('change', () => {
  const mode = $<HTMLSelectElement>('#participant-mode').value;
  if ($('#participant-form [name=participantId]')) { clearParticipantEdit(); $<HTMLSelectElement>('#participant-mode').value = mode; announce('대화 방식을 바꿀 때는 새 참여자로 등록합니다. 기존 기록과 업무 역할·권한은 원래 참여자에게 남습니다.'); }
  updateConnections();
});
click('#participant-dot-connect', async () => dotView.open());
click('#participant-web-connect', async () => {
  $<HTMLDetailsElement>('#browser-connection-panel').open = true; $<HTMLSelectElement>('#browser-discovery-preset').value = 'chatgpt-v1';
  await loadBrowserPages(); $('#browser-connection-panel').scrollIntoView({ block: 'start' }); $('#browser-discovery-page').focus();
});
$('#participant-model').addEventListener('change', updateEffort);
for (const el of document.querySelectorAll<HTMLElement>('[data-view]')) el.addEventListener('click', () => showView(el.dataset.view as View));
for (const el of document.querySelectorAll<HTMLElement>('[data-tab]')) el.addEventListener('click', () => { tab = el.dataset.tab!; renderDiscussion(); });
$('#new-discussion').addEventListener('click', () => beginTopic());
$('#chat-new-topic').addEventListener('click', () => beginTopic());
$('#topic-details-close').addEventListener('click', () => $<HTMLDialogElement>('#topic-details-dialog').close());
function click(id: string, action: () => Promise<unknown>): void { $(id).addEventListener('click', () => { void action().catch(report); }); }
const prepareButton = button('파일 읽고 자료 저장', async () => {
  const paths = $<HTMLTextAreaElement>('#material-paths').value.split('\n').map(p => p.trim()).filter(Boolean);
  const result = await api<{ id: string }>('/api/materials', { label: $<HTMLInputElement>('#material-label').value, paths });
  pendingMaterialSelection = result.id; announce('파일 사본을 저장했습니다. 다음 토의의 자료 선택을 반영하고 있습니다.'); await refresh();
  announce('파일 사본을 저장하고 다음 토의의 자료로 선택했습니다.');
}); prepareButton.id = 'material-prepare'; $('#material-prepare').replaceWith(prepareButton);
const browseButton = button('폴더 확인', () => browseMaterials($<HTMLInputElement>('#material-folder').value)); browseButton.id = 'material-browse'; $('#material-browse').replaceWith(browseButton);
type CapabilityView = { observedAt: string; os: { platform: string; release: string; arch: string };
  tools: Record<string, { status: string; version: string | null } | null>;
  materials: { access: string; allowedPaths?: string[] };
  connections: { label: string; kind: string; status: string; lastCheckedAt: string | null }[];
  execution: { allowedPaths?: string[]; bindings: { label: string; cwd: string; allowWrite: boolean; status: string }[]; jobs: { id: string; status: string; pendingApprovals: number }[] } };
click('#capabilities-refresh', async () => {
  const report = await api<CapabilityView>('/api/capabilities'); const target = $('#capabilities-report'); target.replaceChildren();
  target.append(node('p', report.os.platform + ' ' + report.os.release + ' · ' + report.os.arch + ' · ' + time(report.observedAt), 'small muted'));
  for (const [name, tool] of Object.entries(report.tools)) target.append(node('p', name + ': ' + (tool?.version ?? (tool?.status === 'unavailable' ? '실행 파일 확인 실패' : tool?.status === 'unknown' ? '버전 확인 불가' : '미설정')), 'small'));
  target.append(node('p', '자료 읽기 허용: ' + (report.materials.allowedPaths?.join(', ') || '없음'), 'small'), node('p', 'Codex 등록 허용 경로: ' + (report.execution.allowedPaths?.join(', ') || '없음'), 'small'));
  for (const b of report.execution.bindings) target.append(node('p', b.label + ' · ' + b.cwd + ' · ' + (b.allowWrite ? '수정 허용' : '읽기 전용') + ' · ' + (states[b.status] ?? b.status), 'small'));
  for (const c of report.connections) target.append(node('p', c.label + ' · ' + c.kind + ' · ' + (states[c.status] ?? c.status) + ' · ' + (c.lastCheckedAt ? '마지막 확인 ' + time(c.lastCheckedAt) : '확인 시각 없음'), 'small'));
  target.append(node('p', '기록된 실행 ' + report.execution.jobs.length + '개 · 승인 대기 ' + report.execution.jobs.reduce((n, j) => n + j.pendingApprovals, 0) + '건', 'small'));
  for (const j of report.execution.jobs) target.append(node('p', j.id + ' · ' + (states[j.status] ?? j.status) + ' · 승인 대기 ' + j.pendingApprovals + '건', 'small'));
  target.append(node('p', '명령 네트워크: turn sandbox 정책으로 차단. Codex App Server: 인증용 호스트 네트워크 사용. 호스트 파일 읽기: private state·Chrome profile 가림을 요구하는 정책. 실제 격리 성공은 별도 실행 검증이 필요합니다.', 'small muted'), details('조회 원문', JSON.stringify(report, null, 2)));
});
click('#logout', async () => { $<HTMLFormElement>('#login-form').reset(); setupToken = ''; authSequence++; await api('/api/logout', {}); lock(); });
click('#change-password', async () => { $<HTMLFormElement>('#password-change-form').reset(); $<HTMLDialogElement>('#password-dialog').showModal(); });
click('#password-cancel', async () => { $<HTMLFormElement>('#password-change-form').reset(); $<HTMLDialogElement>('#password-dialog').close(); });
$('#password-dialog').addEventListener('close', () => $<HTMLFormElement>('#password-change-form').reset());
window.addEventListener('hashchange', () => { if (consumeSetupLink()) { lock(false); void loadLogin().catch(report); } });
click('#browser-manual', async () => { await api('/api/browser/control', { paused: true }); await refresh(); });
click('#browser-automatic', async () => { await api('/api/browser/control', { paused: false }); await refresh(); });
$('#device-close').addEventListener('click', closeDeviceScreen);
$('#device-login-dialog').addEventListener('close', () => { if ($<HTMLDialogElement>('#device-login-dialog').open) return; clearTimeout(deviceTimer); deviceTimer = 0; deviceLogin = null; deviceSequence++; $('#device-code').textContent = ''; });
click('#device-cancel', async () => { const active = deviceLogin; if (!active) return; await api(`/api/connections/${active.connectionId}/device-signin/cancel`, { attemptId: active.attemptId }); if (deviceLogin === active) await pollDevice(active); });
click('#device-copy', async () => { const code = $('#device-code').textContent; if (!code || !deviceLogin) return; try { await navigator.clipboard.writeText(code); announce('기기 코드를 복사했습니다.'); } catch { announce('자동 복사를 사용할 수 없습니다. 화면의 코드를 직접 선택해 복사하세요.', true); } });
click('#oauth-screen-resume', async () => { await api('/api/browser/control', { paused: false }); $<HTMLDialogElement>('#oauth-login-dialog').close(); await refresh(); });
$('#oauth-screen-close').addEventListener('click', () => $<HTMLDialogElement>('#oauth-login-dialog').close());
$('#oauth-login-dialog').addEventListener('close', () => { $('#oauth-desktop').replaceChildren(); });
click('#browser-pages', async () => { $('#browser-output').textContent = (await api<{ text: string }>('/api/browser/pages')).text; });
click('#browser-discovery-pages', loadBrowserPages);
click('#browser-snapshot', async () => { const id = new FormData($<HTMLFormElement>('#browser-form')).get('pageId'); $('#browser-output').textContent = (await api<{ text: string }>(`/api/browser/snapshot?pageId=${encodeURIComponent(String(id))}`)).text; });
void refresh().catch(error => { if (!(error instanceof Error) || error.message !== 'authentication_required') report(error); });
