import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { exportToXlsx } from '../utils/exportXlsx';
import {
  Camera,
  Download,
  List,
  LogOut,
  User,
  ShieldAlert,
} from 'lucide-react';

export default function DashboardPage() {
  const { user, profile, branch, signOut } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);

  /* If no branch set yet, redirect to setup */
  if (!profile?.branch_id) {
    navigate('/setup', { replace: true });
    return null;
  }

  const isDSA = profile.role === 'DSA';
  const isSCR = profile.role === 'SCR';
  const displayName = profile.full_name || user?.email?.split('@')[0] || 'User';

  async function handleExport() {
    setExporting(true);
    try {
      let query = supabase
        .from('scans')
        .select('id, barcode, paygo, scanned_by, branch_id, created_at, profiles ( full_name ), branches ( name )')
        .order('created_at', { ascending: false });

      if (isDSA) {
        query = query.eq('scanned_by', user.id);
      } else {
        query = query.eq('branch_id', profile.branch_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        alert('No scans to export.');
        return;
      }

      const formatted = data.map((s) => ({
        barcode: s.barcode,
        paygo: s.paygo,
        scanned_by_name: s.profiles?.full_name || s.scanned_by,
        branch_name: s.branches?.name || s.branch_id,
        created_at: s.created_at,
      }));

      const filename = isDSA
        ? `my_scans_${new Date().toISOString().slice(0, 10)}`
        : `branch_scans_${branch?.name || 'export'}_${new Date().toISOString().slice(0, 10)}`;

      exportToXlsx(formatted, filename);
    } catch (err) {
      console.error('Export error:', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  async function handleLogout() {
    await signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-container">
      <div className="page">
        {/* Header */}
        <div
          className="page-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h1 className="page-title">Welcome, {displayName}</h1>
            <div
              className="flex mt-2"
              style={{ gap: '0.5rem', flexWrap: 'wrap' }}
            >
              <span className="badge badge-blue">
                {profile.role === 'SCR' ? 'Service Centre Representative' : 'Direct Sales Agent'}
              </span>
              <span className="badge badge-gray">{branch?.name || 'No branch'}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {user?.email === 'gabrieldewan365@gmail.com' && (
              <button
                onClick={() => navigate('/admin')}
                className="btn-outline"
                style={{
                  width: 'auto',
                  padding: '0.5rem',
                  minHeight: 40,
                  borderRadius: '0.5rem',
                  background: 'rgba(239, 68, 68, 0.08)',
                  border: '1.5px solid var(--color-error)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Admin Panel"
              >
                <ShieldAlert size={20} color="var(--color-error)" />
              </button>
            )}
            <button
              onClick={() => navigate('/setup')}
              className="btn-outline"
              style={{
                width: 'auto',
                padding: '0.5rem',
                minHeight: 40,
                borderRadius: '0.5rem',
                background: 'none',
                border: '1.5px solid var(--color-border)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Edit Profile"
            >
              <User size={20} color="var(--color-text-muted)" />
            </button>
            <button
              onClick={handleLogout}
              className="btn-outline"
              style={{
                width: 'auto',
                padding: '0.5rem',
                minHeight: 40,
                borderRadius: '0.5rem',
                background: 'none',
                border: '1.5px solid var(--color-border)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Sign out"
            >
              <LogOut size={20} color="var(--color-text-muted)" />
            </button>
          </div>
        </div>

        {/* Primary Action — SCAN */}
        <button
          className="btn btn-primary"
          onClick={() => navigate('/scan')}
          style={{
            minHeight: 200,
            fontSize: '1.5rem',
            borderRadius: '1.25rem',
            flexDirection: 'column',
            gap: '1rem',
            marginTop: '1rem',
            boxShadow: '0 8px 30px rgba(37, 99, 235, 0.25)',
          }}
        >
          <Camera size={56} strokeWidth={1.5} />
          SCAN
        </button>

        {/* Secondary Actions */}
        <div className="flex flex-col gap-3 mt-6">
          {isDSA && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleExport}
                disabled={exporting}
                style={{ borderRadius: '1rem' }}
              >
                {exporting ? (
                  <div className="spinner" />
                ) : (
                  <>
                    <Download size={20} />
                    EXPORT MY SCANS
                  </>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => navigate('/lists')}
                style={{ borderRadius: '1rem' }}
              >
                <List size={20} />
                VIEW MY SCANS
              </button>
            </>
          )}

          {isSCR && (
            <>
              <button
                className="btn btn-secondary"
                onClick={handleExport}
                disabled={exporting}
                style={{ borderRadius: '1rem' }}
              >
                {exporting ? (
                  <div className="spinner" />
                ) : (
                  <>
                    <Download size={20} />
                    EXPORT BRANCH SCANS
                  </>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => navigate('/lists')}
                style={{ borderRadius: '1rem' }}
              >
                <List size={20} />
                VIEW BRANCH LISTS
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
