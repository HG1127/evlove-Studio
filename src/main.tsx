import {initializeLocalProjects} from "./features/evolve/runtime/local-store";
import {OperatorSessionGate} from "./components/operator-session-gate";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

async function start(){
 await initializeLocalProjects();
 createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OperatorSessionGate><App /></OperatorSessionGate>
  </StrictMode>,
 )
}
void start().catch(error=>{const root=document.getElementById("root")!;root.textContent="无法读取本地项目存储，请刷新重试。未覆盖原有数据。"+String(error);});
