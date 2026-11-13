import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { StageDemo } from './stage/StageDemo.tsx';
import { Legal } from './Legal.tsx';
import 'galmuri/dist/galmuri.css';
import './styles.css';
import './stage/stage.css';
import './work/work.css';

// 디자인 작업용: ?stage=idle | ?stage=chomp
// 대표 주소로 모으기: www나 예전 주소(…workers.dev)로 들어오면 같은 경로의 hamahama.net으로 보낸다.
// 로그인은 대표 주소에서만 동작한다. 이 PC에서 실행할 때(localhost)는 그대로 둔다.
// 보안 연결이 아닌 http:// 로 들어온 경우도 https:// 로 보낸다. http에서는 브라우저가 로그인 쿠키를
// 저장하지 않아서, 닉네임을 넣고 입장할 때 "Unauthorized" 오류가 난다(주소를 손으로 치거나
// 메신저가 'hamahama.net/…'을 http 링크로 바꿔 줄 때 생긴다).
const HOME_HOST = 'hamahama.net';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if (import.meta.env.PROD && !local && (location.hostname !== HOME_HOST || location.protocol !== 'https:')) {
  location.replace(`https://${HOME_HOST}${location.pathname}${location.search}`);
}

// 로컬 개발에서만 열린다(운영 사이트에서는 무시).
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('stage') : null;

// 이용약관(/terms)과 개인정보 처리방침(/privacy)
const legal = location.pathname === '/terms' ? 'terms' : location.pathname === '/privacy' ? 'privacy' : null;

// 관리자 페이지(/admin). 게임을 하는 사람은 받지 않도록 따로 떼어 불러온다.
const Admin = location.pathname.replace(/\/$/, '') === '/admin' ? lazy(() => import('./admin/Admin.tsx')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Admin ? (
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    ) : legal ? (
      <Legal page={legal} />
    ) : demo ? (
      <StageDemo mode={demo} />
    ) : (
      <App />
    )}
  </StrictMode>,
);
