import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { StageDemo } from './stage/StageDemo.tsx';
import 'galmuri/dist/galmuri.css';
import './styles.css';
import './stage/stage.css';

// 디자인 작업용: ?stage=idle | ?stage=chomp
// 로컬 개발에서만 열린다(운영 사이트에서는 무시).
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('stage') : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{demo ? <StageDemo mode={demo} /> : <App />}</StrictMode>,
);
