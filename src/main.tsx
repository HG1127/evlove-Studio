import {initializeLocalProjects} from "./features/evolve/runtime/local-store";
import {initializeProductionSync} from "./features/evolve/runtime/production-sync";
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

async function start(){
 await initializeLocalProjects();
 createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
 )
 // Production sync enhances the control plane; it must not be a mount prerequisite.
 // Keep Studio usable when the remote API is unavailable or authentication is not connected yet.
 void initializeProductionSync().catch((error)=>{
   console.error("Production sync unavailable; continuing with local project state",error);
 });
}
void start().catch(error=>{const root=document.getElementById("root")!;root.textContent="无法读取本地项目存储，请刷新重试。未覆盖原有数据。"+String(error);});
