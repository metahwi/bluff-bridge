// 관리자 페이지의 '한눈에 보기': 지금 이 순간의 현황과 최근 14일의 흐름을 한 화면에 모은다.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ago, useLoad, when } from './api.ts';

const TIERS = ['아기 하마', '꼬마 하마', '날쌘 하마', '대장 하마', '하마왕'];
const REASONS: Record<string, string> = { finish: '완주로 승리', elimination: '말 소진', forfeit: '기권·끊김' };

/** 판의 종류. 색은 종류마다 고정이다(순서나 개수가 바뀌어도 같은 종류는 같은 색). */
const MODES = [
  { key: 'friend', label: '친구 방', color: '#2a78d6' },
  { key: 'quick', label: '빠른 매칭', color: '#eb6834' },
  { key: 'ranked', label: '순위전', color: '#1baf7a' },
  { key: 'bot', label: '봇과', color: '#eda100' },
  { key: 'old', label: '종류 기록 전', color: '#a3a39c' },
] as const;
type ModeKey = (typeof MODES)[number]['key'];
const modeLabel = (key: string) => MODES.find((m) => m.key === key)?.label ?? key;

interface Live {
  now: number;
  queue: { quick: number; ranked: number };
  rooms: { code: string; mode: string; status: string; humans: number; online: number; bots: number; names: string; round: number; createdAt: number; updatedAt: number }[];
  playingRooms: number;
  playersOnline: number;
  playersInGame: number;
  botsInGame: number;
}
type Day = { d: string; plays: number; players: number; playerMembers: number; playerGuests: number; members: number; guests: number } & Record<ModeKey, number>;
/** 고유 인원(한 사람은 한 번만). */
interface Unique {
  all: number;
  members: number;
  guests: number;
}
interface Engagement {
  gamesPerPlayer: number;
  gamesPerPlayerToday: number;
  minutesPerGame: number | null;
  minutesPerPlayer: number | null;
  timedGames: number;
  nextDay: { base: number; back: number };
  nextDayWeek: { base: number; back: number };
}
interface Trends {
  engagement: Engagement;
  unique: { today: Unique; week: Unique; period: Unique; month: Unique };
  days: Day[];
  reasons: { reason: string; n: number; rounds: number; minutes: number | null }[];
  tiers: number[];
  recent: { id: string; endedAt: number; mode: string; rounds: number; reason: string; code: string; players: string }[];
  newest: { name: string; createdAt: string }[];
}
interface Totals {
  testUsers: number;
  members: number;
  guests: number;
  matches: number;
  chat: number;
  feedback: number;
}

const total = (d: Day) => MODES.reduce((n, m) => n + d[m.key], 0);

/** 오늘 값과 어제 대비 변화. */
function Kpi({ label, value, before, note, unit }: { label: string; value: number | null; before?: number; note?: string; unit?: string }) {
  const diff = before === undefined || value === null ? null : value - before;
  return (
    <div className="admCard">
      <span>{label}</span>
      <b>
        {value === null ? '–' : value.toLocaleString('ko-KR')}
        {value !== null && unit && <small>{unit}</small>}
      </b>
      <small>
        {diff !== null && (
          <span className={diff > 0 ? 'up' : diff < 0 ? 'down' : ''}>
            어제보다 {diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : '같음'}
          </span>
        )}
        {diff !== null && note ? ' · ' : ''}
        {note}
      </small>
    </div>
  );
}

/**
 * 날짜별 세로 막대. series가 여럿이면 쌓아서 그린다(사이에 2px 틈).
 * 막대에 마우스를 올리거나 초점을 주면 그날의 숫자가 뜨고, '표로 보기'로 같은 숫자를 표로 볼 수 있다.
 */
function Bars({
  title,
  days,
  series,
  unit,
  summary,
}: {
  title: string;
  days: Day[];
  series: { key: keyof Day; label: string; color: string }[];
  unit: string;
  /** 아무 막대도 가리키지 않을 때 제목 옆에 보일 글. 없으면 날짜별 값을 더한 합계를 보인다(더해도 되는 값일 때만). */
  summary?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sum = (d: Day) => series.reduce((n, s) => n + Number(d[s.key]), 0);
  const max = Math.max(1, ...days.map(sum));
  // 눈금은 보기 좋은 숫자 두 개(절반, 최대)
  const top = max <= 4 ? max : Math.ceil(max / 2) * 2;
  const shown = hover === null ? null : days[hover]!;
  const used = series.filter((s) => days.some((d) => Number(d[s.key]) > 0));
  return (
    <figure className="admChart">
      <figcaption>
        <b>{title}</b>
        <span className="admChartNow">
          {shown
            ? `${shown.d} · ${series.length > 1 ? used.filter((s) => Number(shown[s.key]) > 0).map((s) => `${s.label} ${shown[s.key]}`).join(', ') + ' · 합계 ' : ''}${sum(shown)}${unit}`
            : (summary ?? `14일 합계 ${days.reduce((n, d) => n + sum(d), 0).toLocaleString('ko-KR')}${unit}`)}
        </span>
      </figcaption>
      {series.length > 1 && (
        <ul className="admLegend">
          {used.map((s) => (
            <li key={String(s.key)}>
              <i style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="admPlot" onMouseLeave={() => setHover(null)}>
        <div className="admAxis" aria-hidden="true">
          <span>{top}</span>
          <span>{top / 2}</span>
          <span>0</span>
        </div>
        <div className="admCols">
          {days.map((d, i) => (
            <button
              key={d.d}
              type="button"
              className={'admCol' + (hover === i ? ' on' : '')}
              aria-label={`${d.d}: ${sum(d)}${unit}`}
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="admStack">
                {series.map(
                  (s) =>
                    Number(d[s.key]) > 0 && (
                      <i key={String(s.key)} style={{ height: `${(Number(d[s.key]) / top) * 100}%`, background: s.color }} />
                    ),
                )}
              </span>
              <em>{i % 2 === days.length % 2 ? '' : d.d.slice(3)}</em>
            </button>
          ))}
        </div>
      </div>
      <details>
        <summary>표로 보기</summary>
        <table className="admTable">
          <thead>
            <tr>
              <th>날짜</th>
              {series.map((s) => (
                <th key={String(s.key)}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.d}>
                <td>{d.d}</td>
                {series.map((s) => (
                  <td key={String(s.key)}>{d[s.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** 항목별 가로 막대(분포). 숫자를 막대 옆에 직접 적는다. */
function Rows({ title, rows, empty }: { title: string; rows: { label: string; value: number; note?: string }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const all = rows.reduce((n, r) => n + r.value, 0);
  return (
    <figure className="admChart">
      <figcaption>
        <b>{title}</b>
      </figcaption>
      {all === 0 ? (
        <p className="admEmpty">{empty}</p>
      ) : (
        <ul className="admRows">
          {rows.map((r) => (
            <li key={r.label}>
              <span>{r.label}</span>
              <span className="admTrack">
                <i style={{ width: `${(r.value / max) * 100}%` }} />
              </span>
              <b>
                {r.value}
                <small> {Math.round((r.value / all) * 100)}%</small>
              </b>
              {r.note && <small>{r.note}</small>}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="admSection">
      <h2>
        {title} {note && <small>{note}</small>}
      </h2>
      {children}
    </section>
  );
}

export function BirdsEye({ onForbidden }: { onForbidden: () => void }) {
  // 지금 현황은 10초마다, 추이는 1분마다 새로 읽는다.
  const live = useLoad<Live>('live', onForbidden, 10_000);
  const trends = useLoad<Trends>('trends', onForbidden, 60_000);
  const totals = useLoad<Totals>('overview', onForbidden, 60_000);
  const error = live.error || trends.error || totals.error;
  if (error) return <p className="admError">{error}</p>;
  if (!live.data || !trends.data || !totals.data) return <p>불러오는 중…</p>;

  const L = live.data;
  const T = trends.data;
  const E = T.engagement;
  const today = T.days.at(-1)!;
  const yesterday = T.days.at(-2) ?? today;
  const STATUS: Record<string, string> = { lobby: '대기실', playing: '게임 중', over: '결과 화면' };

  return (
    <div className="admEye">
      <Section title="지금" note={`${ago(L.now, Date.now())} 기준 · 10초마다 갱신`}>
        <div className="admLive">
          <div className={L.playingRooms > 0 ? 'hot' : ''}>
            <b>{L.playingRooms}</b>
            <span>진행 중인 판</span>
          </div>
          <div>
            <b>{L.playersInGame}</b>
            <span>게임 중인 사람</span>
          </div>
          <div>
            <b>{L.playersOnline}</b>
            <span>방에 접속한 사람</span>
          </div>
          <div>
            <b>{L.botsInGame}</b>
            <span>뛰고 있는 봇</span>
          </div>
          <div className={L.queue.quick + L.queue.ranked > 0 ? 'hot' : ''}>
            <b>
              {L.queue.quick} <small>/</small> {L.queue.ranked}
            </b>
            <span>매칭 대기 (빠른 / 순위전)</span>
          </div>
        </div>
        {L.rooms.length === 0 ? (
          <p className="admEmpty">지금 열려 있는 방이 없어요.</p>
        ) : (
          <div className="admScroll">
            <table className="admTable">
              <thead>
                <tr>
                  <th>방</th>
                  <th>종류</th>
                  <th>상태</th>
                  <th>사람</th>
                  <th>참가자</th>
                  <th>턴</th>
                  <th>열린 지</th>
                </tr>
              </thead>
              <tbody>
                {L.rooms.map((r) => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td>{modeLabel(r.mode)}</td>
                    <td>{STATUS[r.status] ?? r.status}</td>
                    <td>
                      {r.online}/{r.humans}명 접속{r.bots > 0 && ` · 봇 ${r.bots}`}
                    </td>
                    <td>{r.names || '-'}</td>
                    <td>{r.round || '-'}</td>
                    <td>{ago(r.createdAt, L.now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="오늘" note={`한국 시간 기준 · 사람 수는 모두 고유 인원(한 사람은 한 번만) · 봇과 점검용 계정 ${totals.data.testUsers.toLocaleString('ko-KR')}개 제외`}>
        <div className="admCards">
          <Kpi label="끝난 판" value={total(today)} before={total(yesterday)} note={`전체 ${totals.data.matches.toLocaleString('ko-KR')}판`} />
          <Kpi label="오늘 플레이한 사람 (DAU)" value={T.unique.today.all} before={yesterday.players} note={`회원 ${T.unique.today.members} · 게스트 ${T.unique.today.guests}`} />
          <Kpi label="최근 7일 (WAU)" value={T.unique.week.all} note={`회원 ${T.unique.week.members} · 게스트 ${T.unique.week.guests}`} />
          <Kpi
            label="최근 30일 (MAU)"
            value={T.unique.month.all}
            note={`회원 ${T.unique.month.members} · 매일 오는 비율 ${T.unique.month.all ? Math.round((T.unique.today.all / T.unique.month.all) * 100) : 0}%`}
          />
          <Kpi label="새 회원" value={today.members} before={yesterday.members} note={`전체 ${totals.data.members.toLocaleString('ko-KR')}명`} />
          <Kpi label="새 게스트" value={today.guests} before={yesterday.guests} note={`전체 ${totals.data.guests.toLocaleString('ko-KR')}명`} />
          <Kpi label="받은 의견" value={totals.data.feedback} note="의견 탭에서 확인" />
          <Kpi label="보관 중인 채팅" value={totals.data.chat} note="7일 뒤 자동 삭제" />
        </div>
      </Section>

      <Section title="얼마나 깊이 하는가" note="최근 14일 · 광고 노출 기회를 가늠하는 숫자">
        <div className="admCards">
          <Kpi label="1인당 하루 판 수" value={E.gamesPerPlayer} unit="판" note={`오늘은 ${E.gamesPerPlayerToday}판 · 플레이한 날 기준`} />
          <Kpi label="한 판 평균 시간" value={E.minutesPerGame} unit="분" note={E.timedGames ? `시간이 기록된 ${E.timedGames}판 기준` : '이번 배포 뒤의 판부터 기록됩니다'} />
          <Kpi label="1인당 하루 플레이 시간" value={E.minutesPerPlayer} unit="분" note="플레이한 날 기준" />
          <Kpi
            label="다음 날 재방문율"
            value={E.nextDay.base ? Math.round((E.nextDay.back / E.nextDay.base) * 100) : null}
            unit="%"
            note={
              E.nextDay.base
                ? `그저께 ${E.nextDay.base}명 중 ${E.nextDay.back}명이 어제 다시 함 · 7일 평균 ${E.nextDayWeek.base ? Math.round((E.nextDayWeek.back / E.nextDayWeek.base) * 100) : 0}%`
                : E.nextDayWeek.base
                  ? `그저께 플레이한 사람이 없음 · 7일 평균 ${Math.round((E.nextDayWeek.back / E.nextDayWeek.base) * 100)}%`
                  : '아직 계산할 만큼 기록이 없어요'
            }
          />
        </div>
        <small>게스트는 브라우저 단위로 세므로, 같은 사람이 기기를 바꾸면 다른 사람으로 잡힙니다. 재방문율은 그만큼 낮게 나올 수 있습니다.</small>
      </Section>

      <Section title="최근 14일">
        <div className="admGrid">
          <Bars title="끝난 판 (종류별)" days={T.days} unit="판" series={MODES.map((m) => ({ key: m.key, label: m.label, color: m.color }))} />
          <Bars
            title="플레이한 사람 (하루 고유 인원)"
            days={T.days}
            unit="명"
            // 같은 사람이 여러 날 하면 날짜마다 한 번씩 잡히므로, 날짜별 값을 더하지 않고 기간 전체의 고유 인원을 따로 센다.
            summary={`14일 동안 고유 ${T.unique.period.all.toLocaleString('ko-KR')}명 (회원 ${T.unique.period.members} · 게스트 ${T.unique.period.guests})`}
            series={[
              { key: 'playerMembers', label: '회원', color: '#2a78d6' },
              { key: 'playerGuests', label: '게스트', color: '#eb6834' },
            ]}
          />
          <Bars title="새 회원" days={T.days} unit="명" series={[{ key: 'members', label: '새 회원', color: '#2a78d6' }]} />
          <Rows
            title="판이 끝난 이유"
            empty="최근 14일에 끝난 판이 없어요."
            rows={T.reasons.map((r) => ({ label: REASONS[r.reason] ?? r.reason, value: r.n, note: `평균 ${r.rounds}턴${r.minutes === null ? '' : ` · ${r.minutes}분`}` }))}
          />
          <Rows title="순위전 티어 분포" empty="아직 배치를 마친 사람이 없어요." rows={TIERS.map((label, i) => ({ label, value: T.tiers[i] ?? 0 }))} />
        </div>
      </Section>

      <div className="admGrid two">
        <Section title="방금 끝난 판">
          {T.recent.length === 0 ? (
            <p className="admEmpty">아직 끝난 판이 없어요.</p>
          ) : (
            <ul className="admFeed">
              {T.recent.map((m) => (
                <li key={m.id}>
                  <span className="admTag">{modeLabel(m.mode)}</span>
                  <span className="admFeedMain">{m.players}</span>
                  <small>
                    {m.rounds}턴 · {REASONS[m.reason] ?? m.reason} · {when(m.endedAt)}
                  </small>
                </li>
              ))}
            </ul>
          )}
          <small>★ = 이긴 사람. [봇]은 이 화면에서만 보입니다.</small>
        </Section>
        <Section title="최근 가입한 회원">
          {T.newest.length === 0 ? (
            <p className="admEmpty">아직 가입한 회원이 없어요.</p>
          ) : (
            <ul className="admFeed">
              {T.newest.map((u, i) => (
                <li key={i}>
                  <span className="admFeedMain">{u.name}</span>
                  <small>{when(u.createdAt)}</small>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
