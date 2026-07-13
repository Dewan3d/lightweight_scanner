import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { checkIsAdmin } from '../utils/admin';

export default function AdminGuard({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="page items-center justify-center">
        <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  // Strictly verify email addresses of administrators
  const isAdmin = user && checkIsAdmin(user.email);

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
