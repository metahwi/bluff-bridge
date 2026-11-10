import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { SoundToggle } from './SoundToggle.tsx';
import { StageDemo } from './stage/StageDemo.tsx';
import 'galmuri/dist/galmuri.css';
import './styles.css';
import './stage/stage.css';

// 디자인 작업용: ?stage=idle | ?stage=chomp
// 대표 주소로 모으기: www나 예전 주소(…workers.dev)로 들어오면 같은 경로의 hamahama.net으로 보낸다.
// 로그인은 대표 주소에서만 동작한다. 이 PC에서 실행할 때(localhost)는 그대로 둔다.
const HOME_HOST = 'hamahama.net';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if (import.meta.env.PROD && !local && location.hostname !== HOME_HOST) {
  location.replace(`https://${HOME_HOST}${location.pathname}${location.search}`);
}

// 로컬 개발에서만 열린다(운영 사이트에서는 무시).
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('stage') : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SoundToggle />
    {demo ? <StageDemo mode={demo} /> : <App />}
  </StrictMode>,
);
