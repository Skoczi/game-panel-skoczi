import './panel-update.css';
import localReleaseNotes from '../../docs/pro/RELEASE-2.0.57.md?raw';
import { getAppVersion } from '../utils/appInfo';
import { useState, useEffect } from 'react';
import { ConfirmationModal } from './ConfirmationModal';
import { RefreshCw } from 'lucide-react';
import {
  AppButton,
  AppModal,
  AppModalBody,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
} from '../src/ui/components';
import { useTheme } from '../contexts/ThemeContext';
import { useBodyScrollLock } from '../src/ui/utils/useBodyScrollLock';
import { apiClient, type PanelUpdateCheck, type ReleaseNotes } from '../utils/api';
import { Markdown } from './Markdown';

interface PanelUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: PanelUpdateCheck | null;
}

function ReleaseNotesBlock({ release, isDark, heading }: { release: ReleaseNotes; isDark: boolean; heading?: string }) {
  const hasMeta = heading || release.prerelease || release.htmlUrl;
  return (
    <div className="space-y-1.5">
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-2">
          {heading && (
            <span className={`text-xs font-medium uppercase tracking-wide ${isDark ? 'text-slate-500' : 'text-[#94a3b8]'}`}>
              {heading}
            </span>
          )}
          {release.prerelease && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
              pre-release
            </span>
          )}
          {release.htmlUrl && (
            <a
              href={release.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[11px] text-[#157EEA] hover:underline"
            >
              View on GitHub
            </a>
          )}
        </div>
      )}
      {release.body
        ? <Markdown className={isDark ? 'text-slate-300' : 'text-[#475569]'}>{release.body}</Markdown>
        : <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-[#94a3b8]'}`}>No release notes available.</p>}
    </div>
  );
}

export function PanelUpdateModal({ isOpen, onClose, updateInfo }: PanelUpdateModalProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  useBodyScrollLock(isOpen);
  const [checked, setChecked] = useState<PanelUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [starting, setStarting] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateRunning, setUpdateRunning] = useState(false);
  const [uncertainStart, setUncertainStart] = useState(false);
  const info = checked ?? updateInfo;
  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    const poll = async () => {
      try {
        const result = await apiClient.getPanelUpdateStatus();
        if (disposed) return;
        setUpdateRunning(result.running);
        if (result.job) setUpdateStatus(result.job.errorMessage || result.job.message || result.job.status);
      } catch { if (!disposed && updateRunning) setUpdateStatus('Panel reconnecting. Do not submit the update again.'); }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, [isOpen, updateRunning]);
  const startUpdate = async () => {
    if (!info?.latestVersion || starting || uncertainStart) return;
    setConfirmUpdate(false); setStarting(true); setError('');
    try {
      await apiClient.startPanelUpdate(info.latestVersion);
      setUpdateRunning(true); setUpdateStatus('Update queued. This page reconnects after the panel restarts.');
    } catch {
      setUncertainStart(true);
      setError('The update request was not confirmed. Check operation status or reload before trying again.');
    } finally { setStarting(false); }
  };
  const check = async () => {
    setChecking(true); setError('');
    try { setChecked(await apiClient.checkPanelUpdate()); }
    catch { setError('GitHub could not be reached. Version status is unknown; the installed changelog remains available.'); }
    finally { setChecking(false); }
  };
  const status = !info ? 'Version status has not been checked.'
    : !info.latestVersion ? 'No published stable release found on GitHub. Version status is not yet available.'
    : info.updateAvailable ? `A newer stable release is available: ${info.latestVersion}.`
    : !info.currentRelease ? `Installed version is not a published GitHub release. Latest stable: ${info.latestVersion}.`
    : `Your panel is up to date — ${info.currentVersion}.`;
  return (
    <>
    <AppModal open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <AppModalContent className="gp-panel-update max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden">
        <AppModalHeader>
          <AppModalTitle>Game Panel PRO · Version & changelog</AppModalTitle>
        </AppModalHeader>
        <AppModalBody className="space-y-4 overflow-y-auto">
          <p className="text-sm">Installed version: <strong>{getAppVersion()}</strong></p>
          <p role="status" className="text-sm">{error || status}</p>
          <AppButton onClick={() => void check()} disabled={checking}>
            <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking…' : 'Check GitHub'}
          </AppButton>
          <p className="text-xs opacity-70">{info?.managedUpdates?.reason || 'Checking GitHub does not change this installation. Managed updates require the standalone installer.'}</p>
          {info?.updateAvailable && info.managedUpdates?.enabled && <AppButton disabled={starting || updateRunning || uncertainStart} onClick={() => setConfirmUpdate(true)}>Update to {info.latestVersion}</AppButton>}
          {updateStatus && <p role="status" className="text-sm">{updateStatus}</p>}
          {getAppVersion() === '2.0.57' && <details open className="text-sm"><summary className="cursor-pointer font-medium">Installed changelog · 2.0.57</summary><Markdown>{localReleaseNotes}</Markdown></details>}
          {info?.newerReleases?.map(release => <ReleaseNotesBlock key={release.version} release={release} isDark={isDark} heading={release.version} />)}
          {info?.currentRelease && getAppVersion() !== '2.0.57' && <ReleaseNotesBlock release={info.currentRelease} isDark={isDark} heading="Installed release" />}
          <AppButton onClick={onClose}>Close</AppButton>
        </AppModalBody>
      </AppModalContent>
    </AppModal>
    {confirmUpdate && <ConfirmationModal isOpen title="Update Game Panel PRO?" message={`Install ${info?.latestVersion} from Skoczi/game-panel-skoczi? The panel will restart. A rollback snapshot is created first; running game containers are left alone.`} confirmText="Install update" onClose={() => setConfirmUpdate(false)} onConfirm={startUpdate} />}
    </>
  );
}
