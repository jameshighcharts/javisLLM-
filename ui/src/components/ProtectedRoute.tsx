import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { session, isInitialized } = useAuth()
    const location = useLocation()

    if (!isInitialized) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: '#F2EDE6' }}>
                <div className="animate-pulse" style={{ color: '#8FBB93' }}>Loading...</div>
            </div>
        )
    }

    if (!session) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }

    return <>{children}</>
}
