import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Download from './pages/Download'
import Subtitles from './pages/Subtitles'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

function Protected({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

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
        <Route
          path="/"
          element={
            <Protected>
              <Download />
            </Protected>
          }
        />
        <Route path="/download" element={<Navigate to="/" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/subtitles"
          element={
            <Protected>
              <Subtitles />
            </Protected>
          }
        />
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
