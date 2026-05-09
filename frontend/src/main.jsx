import React from 'react'
import ReactDOM from 'react-dom/client'
import { LangProvider } from './context/LangContext'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>,
)
