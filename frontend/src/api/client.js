import axios from 'axios'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  timeout: 60000,
})

export const getSectors = () => client.get('/sectors')
export const createSector = (data) => client.post('/sectors', data)
export const updateSector = (id, data) => client.patch(`/sectors/${id}`, data)
export const deleteSector = (id) => client.delete(`/sectors/${id}`)

export const triggerJob = (language = 'en') => client.post('/jobs/trigger', { language })
export const getJob = (id) => client.get(`/jobs/${id}`)
export const getJobs = () => client.get('/jobs')

export const getReports = (jobId) => client.get('/reports', { params: { job_id: jobId } })
export const getReport = (tickerId) => client.get(`/reports/${tickerId}`)

export const getCompanies = () => client.get('/companies')
export const getCompany = (symbol, lang = 'en') => client.get(`/companies/${symbol}`, { params: { lang } })

export const getTargets = () => client.get('/targets')
export const createTarget = (data) => client.post('/targets', data)
export const deleteTarget = (id) => client.delete(`/targets/${id}`)

export const getJpStatus = () => client.get('/jquants/status')
export const refreshJpListings = () => client.post('/jquants/refresh/listings')
export const refreshJpPrices = () => client.post('/jquants/refresh/prices')
export const getJpStocks = (params) => client.get('/jquants/stocks', {
  params,
  paramsSerializer: { indexes: null },  // sector=A&sector=B (not sector[0]=A)
})
export const getJpStockChart = (code) => client.get(`/jquants/stocks/${code}/chart`)
export const getJpFilters = () => client.get('/jquants/filters')
export const getJpStockDetail = (code) => client.get(`/jquants/stocks/${code}/detail`)
export const refreshJpStock = (code) => client.post(`/jquants/stocks/${code}/refresh`)
export const fetchJpCompanyInfo = (code) => client.post(`/jquants/stocks/${code}/company-info`)
export const fetchJpYoutubeReport = (code, body = {}) => client.post(`/jquants/stocks/${code}/youtube`, body)
export const computeJpAqr = () => client.post('/jquants/compute/aqr')
