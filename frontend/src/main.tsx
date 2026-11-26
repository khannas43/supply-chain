import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { AppProvider } from './components/AppContext'
import { SelectionProvider } from './prototype/selection'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppProvider>
          <SelectionProvider>
            <App />
          </SelectionProvider>
        </AppProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
