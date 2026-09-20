import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAuthSession } from '../components/app/useAuthSession';
import {
  serverPageHash,
  useServerPageRoute,
} from '../components/serverSettings/useServerPageRoute';
import { ACTIVE_SERVER, openFleet } from '../utils/nodeContext';
import { apiClient } from '../utils/api';

function Routes() {
  const { route, navigate } = useServerPageRoute();
  if (!ACTIVE_SERVER || !route) return <h1>Fleet</h1>;
  return (
    <>
      <h1>{ACTIVE_SERVER.name}</h1>
      <output>{route.tab}</output>
      {(['console', 'filemanager', 'backup'] as const).map((tab) => (
        <a
          key={tab}
          href={serverPageHash({ ...route, tab })}
          onClick={(event) => {
            event.preventDefault();
            navigate({ ...route, tab });
          }}
        >
          {tab}
        </a>
      ))}
      <button onClick={() => void apiClient.getServer(ACTIVE_SERVER.runtimeId)}>
        Read runtime
      </button>
      <button onClick={openFleet}>Fleet</button>
    </>
  );
}
function Fixture() {
  const session = useAuthSession();
  if (session.authChecking) return <p>Loading</p>;
  if (!session.isAuthenticated)
    return (
      <button
        onClick={() => {
          localStorage.setItem('auth_token', 'test-token');
          location.reload();
        }}
      >
        Sign in
      </button>
    );
  return <Routes />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
