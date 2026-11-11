import type { ReactNode } from 'react';
import { SettingsButton } from '../Settings.tsx';

/**
 * 업무 모드의 겉모습: 스프레드시트 프로그램처럼 보이는 틀.
 * 제목 표시줄 → 메뉴 → 도구 모음 → 수식 입력줄 → (내용) → 시트 탭 → 상태 표시줄.
 * 실제 제품의 이름이나 로고는 쓰지 않는다.
 */
export function WorkChrome({
  cell,
  formula,
  tools,
  status,
  sheet = '실적',
  children,
}: {
  /** 이름 상자에 보일 셀 주소(방 코드 등). */
  cell: string;
  /** 수식 입력줄에 보일 글. 지금 무엇을 할 차례인지를 수식처럼 적는다. */
  formula: string;
  /** 도구 모음에 놓을 단추들. */
  tools?: ReactNode;
  /** 상태 표시줄 오른쪽에 보일 요약(합계 등). */
  status?: string;
  sheet?: string;
  children: ReactNode;
}) {
  return (
    <div className="wb">
      <div className="wbTitle">
        <span className="wbDoc">4분기 실적집계.xlsx</span>
        <span className="wbSaved">저장됨</span>
        <SettingsButton />
      </div>
      <div className="wbMenu" aria-hidden="true">
        {['파일', '홈', '삽입', '수식', '데이터', '검토', '보기'].map((m) => (
          <span key={m} className={m === '홈' ? 'on' : ''}>
            {m}
          </span>
        ))}
      </div>
      <div className="wbTools">
        {tools}
        <div className="wbDecor" aria-hidden="true">
          <span>맑은 고딕</span>
          <span>11</span>
          <span>
            <b>가</b>
          </span>
          <span>
            <i>가</i>
          </span>
          <span>
            <u>가</u>
          </span>
          <span>자동 합계</span>
        </div>
      </div>
      <div className="wbFormula">
        <span className="wbName">{cell}</span>
        <span className="wbFx" aria-hidden="true">
          fx
        </span>
        <span className="wbExpr">{formula}</span>
      </div>
      <div className="wbBody">{children}</div>
      <div className="wbTabs" aria-hidden="true">
        {['실적', '결재라인', '변경 내역'].map((t) => (
          <span key={t} className={t === sheet ? 'on' : ''}>
            {t}
          </span>
        ))}
        <span className="plus">+</span>
      </div>
      <div className="wbStatus">
        <span>준비</span>
        <span>{status}</span>
      </div>
    </div>
  );
}

/** 열 머리글(A, B, C…)을 만든다. */
export const columnName = (i: number) => String.fromCharCode(65 + i);
