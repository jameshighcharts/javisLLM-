import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../components/AuthProvider'

export default function Login() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')
    const { signInWithOtp } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    const from = location.state?.from?.pathname || '/dashboard'

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setMessage('')
        setError('')

        const { error } = await signInWithOtp(email)

        if (error) {
            setError(error.message)
        } else {
            setMessage('Check your email for the login link!')
        }
        setLoading(false)
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F2EDE6' }}>
            {/* Brand & Form Container */}
            <div
                className="max-w-md w-full p-8 rounded-2xl shadow-xl flex flex-col gap-6"
                style={{ background: '#FDFCF8', border: '1px solid #DDD0BC' }}
            >
                <div className="text-center space-y-2">
                    <div className="flex justify-center mb-4">
                        <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center p-0.5 overflow-hidden shadow-sm"
                            style={{ background: '#4A6B4E', border: '1px solid rgba(255,255,255,0.12)' }}
                        >
                            <img src="/app-icon.jpg" alt="Javis" className="w-full h-full object-cover rounded-lg" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-semibold tracking-tight" style={{ color: '#2A3A2C' }}>
                        Welcome to Javis
                    </h2>
                    <p className="text-sm" style={{ color: '#7A8E7C' }}>
                        The AI Visibility Tracker
                    </p>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: '#3D5C40' }}>
                            Email address
                        </label>
                        <input
                            id="email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            className="w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-colors"
                            style={{
                                borderColor: '#DDD0BC',
                                background: '#FFFFFF',
                                color: '#2A3A2C'
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#8FBB93')}
                            onBlur={(e) => (e.target.style.borderColor = '#DDD0BC')}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium focus:outline-none transition-colors"
                        style={{
                            background: loading ? '#8FBB93' : '#3D5C40',
                            color: '#FDFCF8',
                            opacity: loading ? 0.7 : 1,
                        }}
                        onMouseEnter={(e) => !loading && ((e.currentTarget as HTMLButtonElement).style.background = '#2A3A2C')}
                        onMouseLeave={(e) => !loading && ((e.currentTarget as HTMLButtonElement).style.background = '#3D5C40')}
                    >
                        {loading ? 'Sending magic link...' : 'Send magic link'}
                    </button>
                </form>

                {message && (
                    <div className="p-3 rounded-lg text-sm transition-opacity" style={{ background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>
                        {message}
                    </div>
                )}
                {error && (
                    <div className="p-3 rounded-lg text-sm transition-opacity" style={{ background: '#FEF2F2', color: '#B91C1C', border: '1px solid #FECACA' }}>
                        {error}
                    </div>
                )}
            </div>
        </div>
    )
}
