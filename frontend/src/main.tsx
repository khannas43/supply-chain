import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { AppProvider } from './components/AppContext'
import { StoreProvider } from './data/store'
import { PipelineProvider } from './data/pipelineStore'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StoreProvider>
          <PipelineProvider>
            <AppProvider>
              <App />
            </AppProvider>
          </PipelineProvider>
        </StoreProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
