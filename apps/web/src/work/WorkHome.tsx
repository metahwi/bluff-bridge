// 업무 모드의 첫 화면과 매칭 대기 화면. 하는 일은 게임 화면과 같고, 표 문서처럼 보인다.
import { RULES, rulesFor } from '@bluff-bridge/engine';

const MULTI = rulesFor(4);
import { NAME_MAX } from '@bluff-bridge/protocol/types';
import type { Me } from '../auth.ts';
import { MyRank, TierBadge, useRanking } from '../Rank.tsx';
import { WorkChrome } from './WorkChrome.tsx';

const REASON: Record<string, string> = { finish: '최종 승인', elimination: '안건 소진', forfeit: '자리 비움' };

export interface WorkHomeProps {
  me: Me;
  code: string;
  draft: string;
  invite: string;
  busy: boolean;
  error: string;
  /** 로그인 정보를 저장하지 못하는 앱 안 브라우저일 때, 다른 브라우저로 여는 단추를 보인다. */
  onOpenInBrowser: (() => void) | null;
  setDraft: (v: string) => void;
  setInvite: (v: string) => void;
  onQuick: () => void;
  /** 정기 평가(순위전) 줄에 선다. 회원만 가능. */
  onRanked: () => void;
  onCreate: () => void;
  onJoin: () => void;
  onEnter: () => void;
  onHome: () => void;
}

export function WorkHome(p: WorkHomeProps) {
  const r = p.me.records;
  const ready = !p.busy && !!p.draft.trim();
  const member = !!p.me.user && !p.me.user.isAnonymous;
  const ranking = useRanking();
  const guide = [
    `[다시 계산]을 누르면 1~${RULES.maxClaim} 또는 #N/A 값이 나옵니다. 값은 본인만 볼 수 있습니다. 여섯 번 중 두 번은 #N/A입니다.`,
    `1~${RULES.maxClaim} 중 하나를 보고합니다. 실제 값과 달라도 됩니다. #N/A가 나오면 반드시 임의의 값을 보고해야 합니다.`,
    '다른 참여자가 모두 승인하면 보고한 만큼 안건이 결재 단계를 진행합니다.',
    '누군가 감사를 요청하면 실제 값을 공개합니다. 허위 보고였으면 내 안건이, 정상 보고였으면 감사를 요청한 사람의 안건이 반려됩니다.',
    `안건 ${RULES.runners}건 중 ${RULES.finishesToWin}건을 먼저 최종 승인받으면 이번 분기 우수 담당자가 됩니다. 3~4명이면 ${MULTI.runners}건 중 ${MULTI.finishesToWin}건입니다.`,
  ];
  let row = 1;
  return (
    <WorkChrome cell="A1" formula={p.code ? `=OPEN("${p.code}")` : '=TODAY()'} status={r && r.played > 0 ? `개수: ${r.played}    승: ${r.won}` : undefined}>
      <table className="sheet home">
        <thead>
          <tr>
            <th className="corner" />
            <th>A</th>
            <th>B</th>
            <th>C</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{row++}</th>
            <td className="head">담당자</td>
            <td>
              <input aria-label="담당자 이름" value={p.draft} maxLength={NAME_MAX} placeholder="이름 입력" onChange={(e) => p.setDraft(e.target.value)} />
            </td>
            <td className="note hint">공유 시트에 표시될 이름</td>
          </tr>
          {p.code ? (
            <tr>
              <th>{row++}</th>
              <td className="head">공유 시트 {p.code}</td>
              <td>
                <button className="wbBtn primary" disabled={!ready} onClick={p.onEnter}>
                  {p.busy ? '여는 중…' : '열기'}
                </button>
                <button className="wbBtn" onClick={p.onHome}>
                  취소
                </button>
              </td>
              <td />
            </tr>
          ) : (
            <>
              <tr>
                <th>{row++}</th>
                <td className="head">새 작업</td>
                <td>
                  <button className="wbBtn primary" disabled={!ready} onClick={p.onQuick}>
                    자동 배정
                  </button>
                  <button className="wbBtn" disabled={!ready} onClick={p.onCreate}>
                    새 공유 시트
                  </button>
                </td>
                <td className="note hint">자동 배정: 지금 접속한 다른 담당자와 연결 / 새 공유 시트: 링크를 보내 초대(최대 4명)</td>
              </tr>
              <tr>
                <th>{row++}</th>
                <td className="head">정기 평가</td>
                <td>
                  <button className="wbBtn primary" disabled={!ready || !member} onClick={p.onRanked}>
                    평가 배정 (1대1)
                  </button>
                </td>
                <td className="note">{member && p.me.rank ? <MyRank rank={p.me.rank} work /> : '회원만 참여할 수 있습니다. 결과가 평가 점수와 직급에 반영됩니다.'}</td>
              </tr>
              <tr>
                <th>{row++}</th>
                <td className="head">공유받은 시트</td>
                <td>
                  <input
                    aria-label="공유 링크 또는 코드"
                    value={p.invite}
                    placeholder="공유 링크 또는 코드"
                    onChange={(e) => p.setInvite(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && p.onJoin()}
                  />
                </td>
                <td>
                  <button className="wbBtn" disabled={p.busy || !p.invite.trim()} onClick={p.onJoin}>
                    열기
                  </button>
                </td>
              </tr>
            </>
          )}
          {p.error && (
            <tr>
              <th>{row++}</th>
              <td colSpan={3} className="na" role="alert">
                {p.error}{' '}
                {p.onOpenInBrowser && (
                  <button className="wbBtn" onClick={p.onOpenInBrowser}>
                    다른 브라우저로 열기
                  </button>
                )}
              </td>
            </tr>
          )}
          <tr>
            <th>{row++}</th>
            <td className="head">계정</td>
            <td>{p.me.user && !p.me.user.isAnonymous ? `${p.me.user.name} (회원)` : '게스트'}</td>
            <td className="note">가입·로그인·탈퇴는 옵션에서 업무 모드를 끈 첫 화면 아래에서 할 수 있습니다.</td>
          </tr>
          <tr>
            <th>{row++}</th>
            <td colSpan={3} />
          </tr>
          <tr>
            <th>{row++}</th>
            <td className="head" colSpan={3}>
              작성 안내
            </td>
          </tr>
          {guide.map((g, i) => (
            <tr key={i}>
              <th>{row++}</th>
              <td className="num">{i + 1}</td>
              <td colSpan={2}>{g}</td>
            </tr>
          ))}
          {ranking && ranking.length > 0 && (
            <>
              <tr>
                <th>{row++}</th>
                <td colSpan={3} />
              </tr>
              <tr>
                <th>{row++}</th>
                <td className="head">평가 순위</td>
                <td className="head">담당자</td>
                <td className="head">직급 / 평가 점수</td>
              </tr>
              {ranking.map((e, i) => (
                <tr key={i} className={p.me.rank?.place === i + 1 ? 'mine' : ''}>
                  <th>{row++}</th>
                  <td className="num">{i + 1}</td>
                  <td>{e.name}</td>
                  <td>
                    <TierBadge tier={e.tier} work /> {e.rating}점 <span className="note">({e.wins}승 {e.losses}패)</span>
                  </td>
                </tr>
              ))}
            </>
          )}
          {r && r.played > 0 && (
            <>
              <tr>
                <th>{row++}</th>
                <td colSpan={3} />
              </tr>
              <tr>
                <th>{row++}</th>
                <td className="head">최근 실적</td>
                <td className="head">상대</td>
                <td className="head">
                  =COUNTIF(결과,"우수") → {r.won} / {r.played}
                </td>
              </tr>
              {r.recent.map((m, i) => (
                <tr key={i}>
                  <th>{row++}</th>
                  <td className={m.won ? 'ok' : 'bad'}>{m.won ? '우수' : '미달'}</td>
                  <td>{m.opponents || '?'}</td>
                  <td className="note">
                    {m.rounds}회 / {REASON[m.reason] ?? m.reason} / {new Date(m.endedAt).toLocaleDateString('ko-KR')}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </WorkChrome>
  );
}

/** 자동 배정(빠른 매칭) 대기 화면. */
export function WorkMatching({ seconds, expected, error, ranked = false, onCancel }: { seconds: number; expected: number; error: string; ranked?: boolean; onCancel: () => void }) {
  return (
    <WorkChrome
      cell="B2"
      formula='=WAIT("담당자 배정")'
      tools={
        <button className="wbBtn" onClick={onCancel}>
          취소
        </button>
      }
    >
      <table className="sheet home">
        <thead>
          <tr>
            <th className="corner" />
            <th>A</th>
            <th>B</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>1</th>
            <td className="head">상태</td>
            <td>{ranked ? '정기 평가 상대 배정 중…' : '담당자 배정 중…'}</td>
          </tr>
          <tr>
            <th>2</th>
            <td className="head">경과</td>
            <td className="num">{seconds}초</td>
          </tr>
          <tr>
            <th>3</th>
            <td className="head">예상 대기</td>
            <td className="num">약 {expected}초</td>
          </tr>
          {error && (
            <tr>
              <th>4</th>
              <td colSpan={2} className="na" role="alert">
                {error}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </WorkChrome>
  );
}
