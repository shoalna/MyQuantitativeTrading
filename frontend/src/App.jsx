import { useState } from 'react'
import Nav from './components/Nav'
import CompanyList from './components/CompanyList'
import CompanyDetail from './components/CompanyDetail'
import ConfigPage from './components/ConfigPage'
import JapanStocks from './components/JapanStocks'
import JapanStockDetail from './components/JapanStockDetail'

export default function App() {
  const [page, setPage] = useState('japan')
  const [selectedSymbol, setSelectedSymbol] = useState(null)
  const [selectedJpCode, setSelectedJpCode] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  const handleSelectCompany = (symbol) => {
    setSelectedSymbol(symbol)
    setPage('detail')
  }

  const handleBack = () => {
    setSelectedSymbol(null)
    setPage('home')
  }

  const handleSelectJpStock = (code) => {
    setSelectedJpCode(code)
    setPage('japanDetail')
  }

  const handleJpBack = () => {
    setSelectedJpCode(null)
    setPage('japan')
  }

  const handleNav = (p) => {
    setPage(p)
    setSelectedSymbol(null)
    setSelectedJpCode(null)
  }

  return (
    <>
      <Nav
        page={page === 'detail' ? 'home' : page === 'japanDetail' ? 'japan' : page}
        onNav={handleNav}
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
      {page === 'japan' && <JapanStocks onSelectStock={handleSelectJpStock} />}
      {page === 'japanDetail' && selectedJpCode && (
        <JapanStockDetail code={selectedJpCode} onBack={handleJpBack} />
      )}
    </>
  )
}
