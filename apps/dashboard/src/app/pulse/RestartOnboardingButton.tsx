'use client';

import { useState } from 'react';
import { restartOnboarding } from './onboarding-actions';

export function RestartOnboardingButton({ userId, tenantId, displayName }: { userId: string; tenantId: string; displayName: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleRestart() {
    if (!window.confirm(`Перезапустить онбординг для ${displayName}? Intro будет отправлено в Slack заново.`)) return;
    setStatus('loading');
    setMsg('');
    try {
      const response = await restartOnboarding(userId, tenantId);
      if (!response.ok) {
        setMsg(response.error);
        setStatus('error');
        return;
      }
      setMsg(response.result.introQueued
        ? 'Онбординг перезапущен, intro поставлено в очередь'
        : 'Онбординг перезапущен, но доставки для повторной отправки нет');
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
        onClick={handleRestart}
        disabled={disabled}
        style={{
          fontSize: 12,
          padding: '4px 12px',
          borderRadius: 6,
          border: '1px solid #f59e0b',
          color: disabled ? 'var(--text-muted)' : '#f59e0b',
          background: 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Перезапустить онбординг
      </button>
      {status === 'loading' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>...</span>}
      {msg && (
        <span style={{ fontSize: 12, color: status === 'error' ? '#ef4444' : 'var(--text-muted)' }}>
          {msg}
        </span>
      )}
    </div>
  );
}
