// 에러 코드 중앙 관리. 렌더러에는 { ok:false, code, message } 형태로만 전달한다.
const ErrorCode = Object.freeze({
  PROMPT_INVALID: 'ERR_PROMPT_INVALID',
  BACKEND_UNKNOWN: 'ERR_BACKEND_UNKNOWN',
  BACKEND_NOT_INSTALLED: 'ERR_BACKEND_NOT_INSTALLED',
  BACKEND_LOGIN_REQUIRED: 'ERR_BACKEND_LOGIN_REQUIRED',
  BACKEND_BUSY: 'ERR_BACKEND_BUSY',
  BACKEND_RATE_LIMIT: 'ERR_BACKEND_RATE_LIMIT',
  BACKEND_TIMEOUT: 'ERR_BACKEND_TIMEOUT',
  BACKEND_CANCELLED: 'ERR_BACKEND_CANCELLED',
  BACKEND_FAILED: 'ERR_BACKEND_FAILED',
  BRIDGE_DRAFT: 'ERR_BRIDGE_DRAFT',
  BRIDGE_FAILED: 'ERR_BRIDGE_FAILED',
});

const messages = {
  [ErrorCode.PROMPT_INVALID]: () => '질문은 1~30,000자여야 합니다.',
  [ErrorCode.BACKEND_UNKNOWN]: () => '알 수 없는 AI 연결 방식입니다.',
  [ErrorCode.BACKEND_NOT_INSTALLED]: ({ label, hint }) => `${label}이(가) 설치되어 있지 않습니다.${hint ? ' 설치 방법: ' + hint : ''}`,
  [ErrorCode.BACKEND_LOGIN_REQUIRED]: ({ label, hint }) => `${label}에 로그인이 필요합니다.${hint ? ' 터미널에서 ' + hint + '을(를) 실행해 주세요.' : ''}`,
  [ErrorCode.BACKEND_BUSY]: () => '이전 답변을 기다리고 있습니다.',
  [ErrorCode.BACKEND_RATE_LIMIT]: ({ label }) => `${label} 사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.`,
  [ErrorCode.BACKEND_TIMEOUT]: ({ seconds = 180 }) => `답변 대기 시간(${seconds}초)이 초과되었습니다.`,
  [ErrorCode.BACKEND_CANCELLED]: () => '답변 수신을 취소했습니다.',
  [ErrorCode.BACKEND_FAILED]: ({ label, detail }) => `${label} 호출에 실패했습니다.${detail ? ' ' + detail : ''}`,
  [ErrorCode.BRIDGE_DRAFT]: ({ detail }) => detail || 'Claude 입력창에 보내지 않은 초안이 있습니다.',
  [ErrorCode.BRIDGE_FAILED]: ({ detail }) => detail || 'Claude 데스크톱 연결에 실패했습니다.',
};

class BackendError extends Error {
  constructor(code, context = {}) {
    super((messages[code] || (() => code))(context));
    this.code = code;
    this.context = context;
  }
}

function fail(code, context = {}) { return { ok: false, code, message: (messages[code] || (() => code))(context) }; }
function toResult(error) {
  if (error instanceof BackendError) return fail(error.code, error.context);
  return fail(ErrorCode.BACKEND_FAILED, { label: 'AI', detail: String((error && error.message) || error).slice(0, 200) });
}

module.exports = { ErrorCode, BackendError, fail, toResult };
