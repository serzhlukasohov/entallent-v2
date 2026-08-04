'use client';

import { useState } from 'react';
import { resetUser, forceCheckIn } from './actions';

export function DevControls({ userId, tenantId }: { userId: string; tenantId: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleReset(deep: boolean) {
    setStatus('loading');
    setMsg('');
    try {
      const result = await resetUser(userId, deep);
      setMsg(`Reset: backlog ${result.pulseBacklog}, evidence ${result.surveyEvidence}, memory ${result.memoryItems}${deep ? `, messages ${result.messages}` : ''}`);
      setStatus('done');
    } catch (e) {
      setMsg(String(e));
      setStatus('error');
    }
  }

  async function handleCheckIn() {
    setStatus('loading');
    setMsg('');
    try {
      await forceCheckIn(userId, tenantId);
      setMsg('Check-in triggered — watch for a message in Slack');
      setStatus('done');
    } catch (e) {
      setMsg(String(e));
      setStatus('error');
    }
  }

  const disabled = status === 'loading';

  return (
    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button
        onClick={() => handleReset(false)}
        disabled={disabled}
        style={btnStyle('#3b82f6', disabled)}
      >
        Reset backlog
      </button>
      <button
        onClick={() => handleReset(true)}
        disabled={disabled}
        style={btnStyle('#ef4444', disabled)}
      >
        Full reset
      </button>
      <button
        onClick={handleCheckIn}
        disabled={disabled}
        style={btnStyle('#10b981', disabled)}
      >
        ▶ Check-in
      </button>
      {status === 'loading' && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>...</span>
      )}
      {msg && (
        <span style={{ fontSize: 12, color: status === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
          {msg}
        </span>
      )}
    </div>
  );
}

function btnStyle(color: string, disabled: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: '4px 12px',
    borderRadius: 6,
    border: `1px solid ${color}`,
    color: disabled ? 'var(--text-muted)' : color,
    background: 'transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
