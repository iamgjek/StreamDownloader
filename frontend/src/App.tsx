import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Subtitles from './pages/Subtitles'
import FormatConvert from './pages/FormatConvert'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  if (!user?.is_admin) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Subtitles />} />
        <Route path="/subtitles" element={<Navigate to="/" replace />} />
        <Route path="/download" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/convert" element={<FormatConvert />} />
        <Route
          path="/dashboard"
          element={
            <AdminOnly>
              <Dashboard />
            </AdminOnly>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
