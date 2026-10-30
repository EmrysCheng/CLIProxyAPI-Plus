// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, type AuthPhase } from './AuthContext';

function Probe({ onChange }: { onChange?: (phase: AuthPhase) => void }) {
  const { phase } = useAuth();
  if (onChange) onChange(phase);
  return <div data-testid="phase">{phase}</div>;
}

function stateResponder(state: Record<string, unknown>) {
  return () =>
    Promise.resolve(new Response(JSON.stringify(state), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
}

describe('AuthContext phase machine', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('goes to setup when onboarding is required', async () => {
    vi.stubGlobal('fetch', vi.fn(stateResponder({ available: true, setup_required: true, authenticated: false })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('setup'));
  });

  it('goes to login when credentials exist', async () => {
    vi.stubGlobal('fetch', vi.fn(stateResponder({ available: true, setup_required: false, authenticated: false })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('login'));
  });

  it('goes to ready when authenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(stateResponder({ available: true, setup_required: false, authenticated: true })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('ready'));
  });

  it('goes to unavailable when the panel is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(stateResponder({ available: false })));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('unavailable'));
  });

  it('drops to login on a 401 event', async () => {
    vi.stubGlobal('fetch', vi.fn(stateResponder({ available: true, setup_required: false, authenticated: true })));
    let last: AuthPhase = 'loading';
    render(
      <AuthProvider>
        <Probe onChange={(p) => { last = p; }} />
      </AuthProvider>,
    );
    await waitFor(() => expect(last).toBe('ready'));
    window.dispatchEvent(new CustomEvent('panel:unauthorized'));
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('login'));
  });

  it('goes to unavailable on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('phase').textContent).toBe('unavailable'));
  });
});
