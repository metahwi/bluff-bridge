import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { StageDemo } from './stage/StageDemo.tsx';
import 'galmuri/dist/galmuri.css';
import './styles.css';
import './stage/stage.css';

// 디자인 작업용: ?stage=idle | ?stage=chomp
const demo = new URLSearchParams(location.search).get('stage');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{demo ? <StageDemo mode={demo} /> : <App />}</StrictMode>,
);
