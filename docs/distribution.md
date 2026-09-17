# Orbit 배포·수익화 검토

확인일: 2026-09-17. 아래 순위와 가격은 제품 제안이며 매출 보장이 아니다.

| 채널 | 적합한 방향 | 공식 확인된 비용/특징 | 제안 |
| --- | --- | --- | --- |
| Microsoft Store | Windows 생산성 도구, AI 마인드맵 | Microsoft 결제 사용 시 앱 수수료 15%. 비게임 앱 자체 결제는 Microsoft 매출 배분 0%(결제 업체 비용 등은 별도). MSIX 호스팅·서명·업데이트 지원. | 안정화 후 주력 유통 채널 |
| Steam | 데스크톱 캐릭터, 망토·스킨·애니메이션 | Steam Direct 앱당 US$100. 조정 총수익 US$1,000 이상에 도달하면 해당 비용 회수 조건. Desktop Mate 등 실제 데스크톱 캐릭터 제품 존재. 매출 배분은 등록 시 계약 확인 필요. | 캐릭터 매력이 구매 이유라면 우선순위 상승 |
| itch.io | 유료 초기 버전, 피드백 수집 | 플랫폼 매출 배분 0~100% 선택, 기본 예시 10%. 결제 처리 수수료 별도. 최소 가격 이상 자유 지불 지원. | 첫 유료 베타를 빠르게 검증 |

출처:
- https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/why-distribute-through-store
- https://learn.microsoft.com/en-us/windows/apps/publish/faq/open-developer-account
- https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/
- https://partner.steamgames.com/doc/gettingstarted/appfee
- https://store.steampowered.com/app/3301060/Desktop_Mate/
- https://itch.io/docs/creators/payments
- https://itch.io/docs/creators/pricing

가격 실험 제안: 무료 기본 고양이/소규모 지도 + 일회성 Pro 9,900~19,900원 + 별도 캐릭터/망토 꾸미기. 우선 itch.io 유료 베타에서 사용 지속률과 지불 의사를 확인하고, Windows 설치/업데이트를 갖춘 Microsoft Store로 확장한다. 캐릭터 반응이 더 강하면 Steam을 병행한다. AI 사용권을 재판매하는 상품으로 표현하지 않는다.

## 자동 연결과 상용 배포

현재 Claude 어댑터는 사용자가 자신의 로그인된 Windows 앱에서 질문 버튼을 눌렀을 때 UI Automation으로 입력/전송/답변을 읽는 실험적 기능이다. 별도 API 키와 클립보드를 쓰지 않는다. Claude의 UI/언어 변경에 따라 유지보수가 필요하며, 다른 AI 앱의 호환성을 보장하지 않는다.

Anthropic의 소비자 약관 3항은 API 또는 명시적으로 허용된 경우 외 자동화 접근을 제한한다. 개인 데모의 기술적 동작 확인은 상용 배포 허가를 뜻하지 않는다. 이 연결 기능을 판매 제품의 핵심으로 삼기 전 Anthropic의 허용 범위 또는 제휴/공식 통합 경로를 확인해야 한다. 본 문서는 법률 의견이 아니다.

공식 약관: https://www.anthropic.com/legal/consumer-terms

## 수익화 모델 제안 (2026-09-17 추가)

제품이 "망토 고양이 데스크톱 펫 + 마인드맵 브레인스토밍 + 알람/비행"으로 정리됐다. 데스크톱 펫 시장은 Desktop Mate처럼 **무료 기본 + 유료 캐릭터 DLC** 구조가 검증되어 있다. 캐릭터가 구매 동기이고, 매일 쓰는 유틸리티(시계·알람)가 체류 동기다. 아래는 그 구조를 Orbit에 맞춘 제안이며 매출 보장이 아니다.

### 수익원

| 수익원 | 내용 | 가격(제안) | 채널 |
| --- | --- | --- | --- |
| 무료 기본 | 고양이 1종, 지도 1개(카드 30장), 알람 1개 | 0원 | 전 채널 |
| Orbit Pro (일회성) | 지도 무제한, 알람 여러 개·요일별 반복, Markdown/PNG 내보내기, 테마 | 9,900~14,900원 | itch.io → Microsoft Store |
| 캐릭터·망토 스킨 팩 | 계절/테마 망토, 새 캐릭터(날다람쥐·슈가 글라이더), 비행 이펙트·착지 모션 | 팩당 2,900~4,900원 | Steam DLC, Microsoft Store 추가 기능 |
| 크리에이터 커스텀 | 스트리머·팀 마스코트 펫 제작(로고 망토, 전용 모션, 정각 인사말) | 건당 견적 | 직접 판매 |
| 후원 | 최소 가격 이상 자유 지불 | 자유 | itch.io |

### 단계별 계획

1. **itch.io 유료 베타(5,000원 안팎)**: 7일 유지율, 알람·비행 사용률, 지불 의사를 먼저 본다. 지표 없이 다음 단계로 가지 않는다.
2. **Steam**: 캐릭터 반응이 강하면 Steam Direct(US$100) 등록. DLC와 Workshop(사용자 제작 망토)으로 확장한다.
3. **Microsoft Store**: 생산성 도구로 포지셔닝(알람·집중 타이머·브레인스토밍). MSIX 자동 업데이트, Microsoft 결제 시 수수료 15%.

### 다음에 붙일 유료 기능 후보

- 알람 여러 개·요일별 반복·집중 타이머(포모도로): 알람 데이터 모델(`{at,time,label,repeat,sound}`)을 배열로 확장하면 된다.
- 지도 내보내기(Markdown/PNG)와 지도 여러 개 전환.
- 비행 경로·착지 모션 커스터마이즈, 정각 인사말.

### 원칙과 리스크

- **AI 사용권을 팔지 않는다.** Claude 자동 연결은 "이미 쓰는 AI 앱과 함께 동작"으로만 설명하고 유료 기능의 조건으로 삼지 않는다. 상용화 전 Anthropic 소비자 약관과 공식 통합 경로(Claude 데스크톱 확장, MCP 서버 등)를 확인해야 한다. UI Automation 방식은 앱 업데이트마다 깨질 수 있어 유지비가 든다.
- 데스크톱 펫은 재방문 이유가 약하면 삭제된다. 시계·알람처럼 매일 쓰는 기능이 체류를 만들고, 스킨 판매는 캐릭터가 매력적일 때만 작동한다. 베타 피드백에서 캐릭터 만족도를 먼저 본다.
- 전 채널에서 개인 개발자 등록·세금 신고 절차와 환불 정책을 미리 확인한다.
