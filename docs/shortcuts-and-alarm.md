# 카드 단축키 · 고양이 시계/알람 비행 기능 명세

작성일: 2026.09.17. Orbit 데스크톱 데모의 세 기능(카드 단축키, 고양이 시계, 알람과 비행)의 동작 명세와 검증 체크리스트다. 외부 API·네트워크 호출은 없다.

## 1. 카드 단축키

| 단축키 | 조건 | 동작 |
| --- | --- | --- |
| `Ctrl+W` (macOS `Cmd+W`) | 캔버스에 선택한 카드가 있음 | 선택한 카드만 삭제. 자식 카드는 삭제된 카드의 부모에 다시 연결. 저장 후 다시 그림 |
| `Ctrl+W` | 선택한 카드가 없음 | 아무 동작 없음. Electron 기본 메뉴의 "창 닫기"도 실행되지 않음 |
| `Ctrl+C` (macOS `Cmd+C`) | 카드 선택, 글자 선택 없음 | 카드의 질문과 답변을 `질문\n\n답변` 텍스트로 클립보드에 복사하고 토스트 표시 |
| `Ctrl+C` | 입력창 또는 화면에서 글자를 선택 중 | 기본 복사 동작 유지(선택한 글자만 복사) |

`Alt`/`Shift`가 함께 눌리거나 한글 조합 중(`isComposing`)이면 무시한다. 키 판별은 `key`가 영문자일 때는 `key`, 한글 IME처럼 `ㅈ`/`ㅊ`가 올 때는 물리 키 `code`(`KeyW`/`KeyC`)를 사용한다.

```
사용자 Ctrl+W
   │
   ▼
main.cjs  before-input-event ──(Ctrl/Cmd + W?)──▶ preventDefault ─▶ 'card-shortcut' IPC('delete')
   │  (렌더러 keydown·메뉴 단축키 모두 차단)                               │
   ▼                                                                      ▼
그 외 키는 렌더러로 전달                                  app.js deleteCard(selected)
                                                                           │  선택 없음 → 종료
                                                                           ▼
                                                            nodes 갱신 → save() → render()
```

| 항목 | 기대 결과 | 테스트 |
| --- | --- | --- |
| 카드 선택 후 `Ctrl+W` | 카드 수 −1, 삭제한 카드 텍스트 사라짐, 캔버스 창 유지 | `smoke.cjs`, `native-smoke.cjs` |
| 선택 없음 상태에서 `Ctrl+W` | 카드 수 변화 없음, 캔버스 창 유지 | `smoke.cjs` |
| 카드 선택 후 `Ctrl+C` | 클립보드 = `질문\n\n답변` | `smoke.cjs` (Linux) |
| 입력창 글자 선택 후 `Ctrl+C` | 클립보드 = 선택한 글자만 | `smoke.cjs` (Linux) |

## 2. 고양이 시계

| 항목 | 명세 |
| --- | --- |
| 표시 위치 | 고양이 창의 `⠿ ORBIT` 손잡이와 고양이 머리 사이, 알약 모양 버튼 |
| 표시 형식 | 시스템 로컬 시간 `HH:MM`(24시간). `<time datetime>`에 ISO 시각 기록 |
| 갱신 주기 | 매 분 경계(+50ms)에 갱신. 창 포커스 시 즉시 갱신. 고양이 창은 `backgroundThrottling: false`로 가려져도 타이머가 늦어지지 않음 |
| 클릭 | 알람 패널 열기/닫기. 울리는 중이면 첫 클릭은 알람 확인 |
| 창 크기 | 고양이 창 180×250(기존 230) × 배율. 망토 시작점 세로 117px × 배율 |

## 3. 알람과 비행

### 알람 데이터

`localStorage['orbit-alarm']`에 JSON 한 개: `{ at, time, label, repeat, sound }`

| 필드 | 의미 |
| --- | --- |
| `at` | 다음에 울릴 시각(epoch ms). 0이면 알람 없음 |
| `time` | 설정한 기준 시각 `HH:MM`. 반복·다시 울림의 기준 |
| `label` | 메모(최대 20자) |
| `repeat` | 매일 반복 여부 |
| `sound` | 알림 소리 여부(기본 켬) |

### 동작 규칙

| 입력 | 결과 |
| --- | --- |
| 시각 `HH:MM` + `설정` | `at` = 그 시각이 다음에 오는 때(이미 지났으면 내일). `time` = 입력값 |
| `+5분` / `+30분` / `+1시간` | `at` = 지금 + n분, `time` = 그 시각, 반복 끔 |
| `해제` | `at` = 0, 반복 끔 |
| `at` 도달 | 반복이면 `at` = 다음 날 `time`, 아니면 0. 지연 10분 미만이면 울림(비행 + 소리) |
| 지연 10분 이상(잠자기 등) | 울리지 않고 `놓쳤습니다` 표시 |
| 앱 재시작, `at`가 과거 | 반복이면 다음 `time`으로 재예약, 아니면 해제 |
| 울리는 중 `확인`/시계 클릭 | 울림 종료 |
| 울리는 중 `5분 뒤 다시` | 울림 종료, `at` = 지금 + 5분, `time`·`repeat` 유지 |
| 확인 없이 2분 경과 | 자동 종료 |

### 비행 경로(main.cjs `flyAround`)

```
모든 모니터 workArea 합집합 ─▶ 창 크기만큼 안쪽으로 들인 사각형 R
현재 위치 P ─▶ R의 가장자리에서 가장 가까운 점 Q
경로: P → Q → (시계 방향으로 네 모서리) → Q → P
길이 L, 시간 = clamp(L / 1200px/s, 3.5s, 10s), easeInOutQuad
매 프레임(16ms):
  위치 = 경로 위 점 + 진행 방향에 수직인 물결(±12px · sin)
  가장 가까운 모니터 workArea 안으로 clamp   ← 모니터 사이 빈 공간·높이 차 보정
  pet.setPosition(); 진행 각도(머리가 진행 방향) 변화 시 'pet-fly' {angle} 전송
종료: 각도를 0°로 되돌린 뒤 400ms 후 원위치 setBounds, alwaysOnTop 레벨 복원, 'end' 전송
```

비행 중에는 main이 `pet-drag`/`pet-resize`를 무시하고 렌더러가 클릭(망토 던지기)을 막는다. 시작 시 `setAlwaysOnTop(true,'pop-up-menu')`와 `moveTop()`으로 캔버스 위로 올린다.

### 렌더러 비행 자세(pet.css `.pet.flying`)

고양이 전체를 `--fly-angle`만큼 회전(머리가 진행 방향), 망토는 뒤로 1.8배 늘려 펄럭임, 팔은 앞으로 뻗음, 꼬리는 0.4초 주기로 흔들림, 손잡이·힌트·크기 조절은 숨김.

### 검증 체크리스트

| 항목 | 기대 결과 | 테스트 |
| --- | --- | --- |
| 시계 표시 | `HH:MM` 형식이며 렌더러의 현재 시각(또는 직전 분)과 일치 | `smoke.cjs`, `native-smoke.cjs` |
| 알람 설정 | 07:30 입력 → `at`는 다음 07:30:00, `time/label/repeat/sound` 저장, 배지 `⏰ 07:30` | `smoke.cjs`, `native-smoke.cjs` |
| 재시작 유지 | 페이지 새로 고침 후 같은 알람 | `smoke.cjs` |
| 상태 문구 | `오늘|내일 07:30 (n분 후) · 회의 · 매일` | `smoke.cjs` |
| 프리셋 | `+30분` → `at` ≈ 지금 + 30분(±3초) | `smoke.cjs` |
| 해제 | `at` = 0, 배지 사라짐 | `smoke.cjs`, `native-smoke.cjs` |
| 알람 도달 | `ringing` + `flying`, 배지 `⏰ HH:MM 회의`, 창이 이동 후 원위치 복귀 | `smoke.cjs`, `native-smoke.cjs` |
| 반복 재예약 | 울린 뒤 `at`가 다음 07:30 | `smoke.cjs` |
| 착지 후 패널 | `확인`/`5분 뒤 다시` 표시. `5분 뒤 다시` → `at` ≈ 지금 + 5분, `time`·`repeat` 유지 | `smoke.cjs`, `native-smoke.cjs` |
| 부작용 없음 | 비행 후 캔버스가 열리지 않음 | `smoke.cjs` |
| 다중 모니터 | 두 번째 모니터 영역까지 도달(테스트 로그의 farthest 좌표) | `native-smoke.cjs` |

`window.orbitPet`은 테스트·디버그용 훅(`setAlarm`, `setAlarmAt`, `clearAlarm`, `snooze`, `fly`, `alarm`)이며 렌더러 내부에서만 접근 가능하다. 테스트는 소리를 끄고 실행한다.
