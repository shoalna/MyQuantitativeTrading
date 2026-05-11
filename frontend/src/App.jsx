import { useState } from 'react'
import Nav from './components/Nav'
import ConfigPage from './components/ConfigPage'
import JapanStocks from './components/JapanStocks'
import JapanWatchlist from './components/JapanWatchlist'
import JapanStockDetail from './components/JapanStockDetail'

export default function App() {
  const [page, setPage] = useState('japan')
  const [selectedJpCode, setSelectedJpCode] = useState(null)
  const [jpDetailFrom, setJpDetailFrom] = useState('japan')

  const handleSelectJpStock = (code, from = 'japan') => {
    setSelectedJpCode(code)
    setJpDetailFrom(from)
    setPage('japanDetail')
  }

  const handleJpBack = () => {
    setSelectedJpCode(null)
    setPage(jpDetailFrom)
  }

  const handleNav = (p) => {
    setPage(p)
    setSelectedJpCode(null)
  }

  return (
    <>
      <Nav
        page={page === 'japanDetail' ? jpDetailFrom : page}
        onNav={handleNav}
        onJobDone={() => setPage('home')}
      />
      {page === 'home' && <JapanWatchlist onSelectStock={(code) => handleSelectJpStock(code, 'home')} />}
      {page === 'config' && <ConfigPage />}
      {page === 'japan' && <JapanStocks onSelectStock={(code) => handleSelectJpStock(code, 'japan')} />}
      {page === 'japanDetail' && selectedJpCode && (
        <JapanStockDetail code={selectedJpCode} onBack={handleJpBack} />
      )}
    </>
  )
}
