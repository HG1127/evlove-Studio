import {initializeLocalProjects} from "./features/evolve/runtime/local-store";
import {initializeProductionSync} from "./features/evolve/runtime/production-sync";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

async function start(){
await initializeLocalProjects();
 await initializeProductionSync();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

}
void start().catch(error=>{const root=document.getElementById("root")!;root.textContent="无法读取完整项目存储，请刷新重试。未覆盖原有数据。"+String(error);});
