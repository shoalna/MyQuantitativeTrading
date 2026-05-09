import { useState } from 'react'
import Nav from './components/Nav'
import CompanyList from './components/CompanyList'
import CompanyDetail from './components/CompanyDetail'
import ConfigPage from './components/ConfigPage'
import JapanStocks from './components/JapanStocks'

export default function App() {
  const [page, setPage] = useState('japan')
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleSelectCompany = (symbol) => {
    setSelectedSymbol(symbol)
    setPage('detail')
  }

  const handleBack = () => {
    setSelectedSymbol(null)
    setPage('home')
  }

  return (
    <>
      <Nav
        page={page === 'detail' ? 'home' : page}
        onNav={(p) => { setPage(p); setSelectedSymbol(null) }}
        onJobDone={() => {
          setPage('home')
          setRefreshTrigger((n) => n + 1)
        }}
      />
      {page === 'home' && <CompanyList onSelect={handleSelectCompany} />}
      {page === 'detail' && selectedSymbol && (
        <CompanyDetail symbol={selectedSymbol} onBack={handleBack} />
      )}
      {page === 'config' && <ConfigPage />}
      {page === 'japan' && <JapanStocks />}
    </>
  )
}
