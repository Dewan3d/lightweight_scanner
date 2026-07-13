import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { Building2, ChevronRight, ArrowLeft, User } from 'lucide-react';

import { checkIsAdmin } from '../utils/admin';

export default function BranchSetupPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user && checkIsAdmin(user.email);
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedRole, setSelectedRole] = useState('DSA');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingBranches, setFetchingBranches] = useState(true);

  // Sync state with loaded profile
  useEffect(() => {
    if (profile) {
      setSelectedBranch(profile.branch_id || '');
      setSelectedRole(profile.role || 'DSA');
      setFullName(profile.full_name || '');
    } else if (user) {
      setFullName(user.email.split('@')[0]);
    }
  }, [profile, user]);

  useEffect(() => {
    async function loadBranches() {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name')
        .order('name');

      if (!error && data) {
        setBranches(data);
      }
      setFetchingBranches(false);
    }

    loadBranches();
  }, []);

  async function handleContinue() {
    if (!selectedBranch || !fullName.trim()) return;
    setLoading(true);

    try {
      /* Check if a profile row exists */
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();

      if (existingProfile) {
        /* Update existing profile */
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim(),
            branch_id: selectedBranch,
          })
          .eq('id', user.id);

        if (error) throw error;
      } else {
        /* Insert new profile */
        const { error } = await supabase.from('profiles').insert({
          id: user.id,
          full_name: fullName.trim(),
          branch_id: selectedBranch,
          role: isAdmin ? 'SCR' : 'DSA',
        });

        if (error) throw error;
      }

      await refreshProfile();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('Error saving branch:', err);
      alert('Failed to save setup. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (fetchingBranches) {
    return (
      <div className="app-container">
        <div className="page items-center justify-center">
          <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
        </div>
      </div>
    );
  }

  const hasSetupCompleted = !!profile?.branch_id;

  return (
    <div className="app-container">
      <div className="page" style={{ padding: '1.5rem' }}>
        {/* Back navigation button if editing settings */}
        {hasSetupCompleted && (
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              padding: 0,
              marginBottom: '1rem',
              minHeight: 'var(--min-touch)',
            }}
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
        )}

        <div className="flex flex-col items-center justify-center flex-1">
          <div className="text-center" style={{ marginBottom: '2rem' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: 'var(--color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
              }}
            >
              <User size={32} color="#fff" />
            </div>
            <h1 className="page-title">
              {hasSetupCompleted ? 'Edit Profile' : 'Complete Setup'}
            </h1>
            <p className="page-subtitle mt-1">
              {hasSetupCompleted
                ? 'Update your full name or branch'
                : 'Choose your details to get started'}
            </p>
          </div>

          <div className="card w-full" style={{ maxWidth: 400 }}>
            <div className="flex flex-col gap-4">
              <div>
                <label className="label" htmlFor="fullname-input">
                  Your Full Name
                </label>
                <input
                  id="fullname-input"
                  type="text"
                  className="input"
                  placeholder="e.g. John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="branch-select">
                  Assigned Branch
                </label>
                <select
                  id="branch-select"
                  className="select"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                >
                  <option value="">-- Select a branch --</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary mt-2"
                onClick={handleContinue}
                disabled={!selectedBranch || !fullName.trim() || loading}
              >
                {loading ? (
                  <div className="spinner" />
                ) : (
                  <>
                    Save &amp; Continue
                    <ChevronRight size={20} />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
