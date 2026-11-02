# dot 긴 입력 분할 조회 — 변경 제안 / 승인 대기

2026-11-02, 기준 main `3bc031e51c98928eb396837b7831859524d79f76`. **이 문서는 제안이며 승인된 계획/제품 코드가 아니다.** D5 실검증에서 발견한 입력 표시 절단을 해결하기 위한 D3/D4/D5 최소 보완안이다. Muse 연결, 기존 완료 답변8개 및 미확정 원래 요청을 보존한다.

## 관측과 원인 범위

- [동일 주제 재개 기록](../implementation/dot-mcp-resume-d5-20261102.md): 실제 dot이 get→claim→winning attempt의 get까지 성공했으나 `Warning: truncated output` 때문에 할당 주장12개의 원문을 모두 읽지 못해 답변 생성을 중단했다고 보고했다. submit 미호출 보고와 서버 receipt0이 일치한다. 별도 감시 실행의 종료 상태는 UNVERIFIED다.
- `src/connections/dot-mcp.ts::DotMcpAdapter.call`: 권한을 확인한 get이 고정 prompt/history 전체를 한 번에 반환한다. 페이지 인자는 없다. `dotInputDigest`와 현재 요청 검사로 입력은 고정돼 있다.
- 해당 입력은 prompt21,793자 + history14,019자=35,812자, canonical JSON69,621 UTF-8 bytes다. 원래 도구 반환값70,059 bytes, 전체 MCP envelope144,644 bytes다. 공개 문서에는 크기만 기록하고 원문/ID/키를 복사하지 않는다.
- `src/http/mcp-events.ts::McpEvents.handle`의 `tools/call`은 같은 값을 `content[].text`와 `structuredContent`에 모두 넣는다. 이는 응답 크기를 키우지만, **어느 계층의 정확한 출력 한도가 절단을 일으켰는지는 UNVERIFIED**다. 서버가 입력을 삭제하거나 API 오류를 반환한 것으로 기록하지 않는다.

공식 [MCP 서버 문서](https://developers.openai.com/plugins/build/mcp-server)는 두 결과 채널 및 간결한 구조화 결과와 호환 가능한 스키마 갱신을 설명한다. [Programmatic Tool Calling 문서](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)는 큰 중간 결과를 코드에서 처리하는 방법과 V8/Node 및 실행 간 상태의 제약을 설명한다. 이 문서들에서 해당 native dot의 정확한 출력 상한이나 영속 저장 helper 지원을 확인한 것은 아니다. 아래 페이지 크기/계약은 **우리 서비스의 제안**이며 OpenAI가 지정한 값이 아니다.

## 대안과 결론

| 대안 | 장점 | 한계/판정 |
| --- | --- | --- |
| 지침만 수정: 전체 envelope를 출력하지 않고 구조화 결과에서 원문을 나눠 읽기 | 제품 계약/DB 변경0, 2~3문서·40~90줄 | 실제 dot의 결과 보존 helper/출력 절단 위치 UNVERIFIED. 같은 get을 반복해 client에서 부분 추출할 수 있지만 매번 전체 원문을 전송한다. 긴 입력 수락의 유일한 보장으로 삼지 않는다. |
| **기존 get에 선택적 분할 조회 추가** | 같은 request/claim의 원문을 작은 응답으로 읽고, 모델 실행/감시를 새로 만들지 않음. client 전용 저장 helper 불필요 | 조회 스키마·반환 variant/감시 안내·긴 입력 회귀 보완 필요. **권장** |
| 원문 요약/절단 또는 timeout 확대 | 겉보기 요청량 감소/대기 증가 | 긴 답변/반론을 읽는 사용자 목표를 바꾸거나 원인을 해결하지 않음. 이번 범위에서 기각 |

## 제안 계약

1. `dot_turn_get`에 선택적 `inputPage` 정수를 추가한다. 생략한 기존 metadata/전체 입력 조회의 shape는 유지한다. 새 감시 지침은 winning attempt를 받은 뒤 page0부터 읽는다.
2. 페이지 조회에는 기존 requestId·attemptId·attemptToken이 모두 필요하다. 매 호출마다 기존 grant/identity/epoch/generation/revision/lease/Wiki 가시성을 검사한다. metadata-only 조회로 원문을 받지 못한다.
3. 원래 `JSON.stringify({prompt,history})`를 **내용 변경 없이** 분할한다. 각 응답은 requestId·inputDigest·pageIndex/pageCount·다음 페이지 또는 종료 표시·원문 조각을 반환한다. 정수 범위 밖 페이지는 오류다. 같은 요청/페이지를 다시 읽어도 동일 내용이며 새 claim/turn/추론/이벤트를 만들지 않는다.
4. 한 페이지의 완성된 MCP JSON 응답은 **UTF-8 12,000 bytes 이하**를 목표 수락값으로 삼는다. 중복 content/structured 표현과 JSON escaping을 포함해 검사한다. 한글/emoji·줄바꿈·역슬래시·surrogate 경계를 보존한다. 정확한 분할 함수/버전 표시는 구현에서 결정하되 이 상한과 무손실 계약은 유지한다.
5. 모든 페이지를 순서대로 읽고 같은 requestId/inputDigest·총 페이지·누락0을 확인한 후만 기존 JSON 답변을 생성한다. 합친 원문 전체를 다시 한 도구 출력으로 내보내지 않는다. 일부 페이지만 보고 답변하거나 지침/근거를 요약으로 대체하지 않는다.
6. 기존 180,000자 입력 한도·300초 timeout·claim/submit/receipt·중복 방지·미확정 대조·API 일일 한도·단일 실행 슬롯은 유지한다. 페이지 읽기에 시간이 부족하면 중단/대조하며 timeout을 자동 늘리지 않는다. 새 OAuth/도구/grant 권한·파일 서버·공개 ingress·추가 모델 호출 경로는 없다.

DB 모델/이관 **0**. 이미 저장된 고정 prompt/history와 digest에서 페이지를 계산한다. 페이지 조회 이력을 별도 업무 상태/발언으로 저장하지 않는다. 작은 순수 분할 helper와 기존 Adapter/권한 검사 Composition을 사용하며 provider/Store/토론 엔진을 재작성하지 않는다.

## 파일·후속 영향·변경량

| 범위 | 실재 대상 / 제안 신규 | 영향·예상 변경(add+delete) |
| --- | --- | --- |
| D3 입력 Adapter | `src/connections/dot-mcp.ts::DotMcpAdapter.call/list`; **제안** `src/connections/dot-input-pages.ts`; 필요 시 `src/http/mcp-events.ts::McpEvents.handle` 응답 크기 helper | 2~3파일·140~230줄. 선택 인자와 읽기 결과 variant만 추가. complete/claim/submit/Store/DB 유지 |
| D3/D5 회귀 | `tests/dot-mcp.test.mjs`, `tests/dot-mcp-restart.test.mjs`, `tests/dot-acceptance-fixture.mjs`, `tests/dot-acceptance.test.mjs`, 필요 시 `tests/browser/dot-mixed.test.mjs` | 3~5파일·180~300줄. 긴 고정 입력·권한/세대·재시작·실제 stdio 경로 |
| D4 연결 안내 | `plugins/webjjoku-dot/README.md`, `docs/dot-connection-runbook.md` | 2파일·50~90줄. 도구 새로 고침, 페이지 순서/누락 검사, 출력 경고 시 중단. 새 로그인/터널 생성 없음 |
| SSOT/수락 기록 | `docs/development-plan.md`, `docs/reviews/dot-official-mcp-events-impact-20261101.md`, 승인 후 구현 기록 | 3파일·80~130줄. D5 관문 유지, 원래50 gate 상태 보존 |
| **합계** | 중복 경로 합산 제거 | **10~14파일·450~750줄** 추정. 이 제안서/실검증 사실 기록은 별도. 구현 중 공개 계약/범위 증가 시 다시 보고 |

R1 영속/이관·R5 작업큐·R6 Codex·R7 Wiki의 타입/권한 변경은 없다. R2/R8의 토론/상주 발화가 같은 고정 입력을 소비하므로 긴 입력 무손실/동시1/미확정0 또는 대조 보존을 재검사한다. R3 GUI 변경0, R4는 Muse 구현 변경0이며 기존 원문 왕복 회귀를 실행한다. D1 grant/D2 Events 필터·outbox/소유자 인증 변경0, D3 선택적 조회 계약만 보완, D4 감시 안내 갱신, D5는 2라운드/후속·원래50 gate를 완화하지 않는다. R8/D5 이후 새 확정 페이즈를 만들지 않는다.

## 수락과 복귀

- **무손실:** 35,812자 규모 및 기존 상한에 가까운 합성 prompt/history를 한글·emoji·제어문자/escaping으로 구성. 모든 페이지 결합 결과와 원본 canonical JSON/digest 동일. 첫/중간/마지막 주장·반론 참조 누락0. 전체 RPC 응답 각12,000 bytes 이하. `node --test tests/dot-mcp.test.mjs`로 확인한다.
- **권한/재시작:** 다른 claim/잘못된 token/회수/off/구세대/Wiki 권한 변경 뒤 후속 페이지 조회0. 같은 page20회→새 turn/전송/공개0. 중간 재시작은 원래 held/미확정 규칙을 유지하고 자동 다시 보내지 않는다. 기존 restart fixture로 확인한다.
- **통합:** 실제 stdio fixture에서 페이지를 순서대로 읽은 원문으로 두 라운드 검토·한 번 submit/receipt. `npm run check`와 설치 Chrome MCP를 지정한 `npm run test:browser`로 기존 Muse와 단일 실행/50 gate 회귀를 확인한다. SKIP은 PASS로 세지 않는다.
- **실제 native:** 위 fixture 이후 별도 허용된 창에서 native dot의 모든 페이지 읽기→JSON submit/receipt/공개를 확인한다. 실제 플랫폼 한도/지연은 그때 관측한다. 이번 미확정 요청을 자동 재실행하거나 기존 완료8개를 삭제/덮어쓰지 않는다. 원래 실행 대조와 새 실계정 호출 범위는 제품 구현 승인과 분리한다.
- **복귀:** dot 발화 off→진행/미확정 대조→감시 종료/전용 grant·Tunnel 정리. 스키마를 되돌리면 감시 안내도 이전 get 계약으로 돌리고 도구를 새로 고친다. 새 DB가 없으므로 원문/receipt를 삭제하거나 백업을 덮어쓰지 않는다. Muse와 정상 웹 서비스는 유지한다.

사용자 승인 필요: **위 선택적 분할 조회 계약과 D3/D4/D5 계획 개정·구현**. 지침 보완만으로 실증되기 전 원문 수락 완료를 선언하지 않는다. 추가 timeout·OAuth·새 실제 모델 호출은 이 제안의 승인 범위가 아니다.
